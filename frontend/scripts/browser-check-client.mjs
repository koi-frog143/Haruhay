import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function browserChecks(folder = 'admin') {
  const origin = process.env.UI_ORIGIN || 'http://127.0.0.1:5173'
  const debug = process.env.UI_DEBUG || 'http://127.0.0.1:9227'
  const output = path.resolve('.ui-verification', folder)
  const downloads = path.join(output, 'downloads', String(Date.now()))
  await mkdir(downloads, { recursive: true })
  const target = await (await fetch(`${debug}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  let nextId = 0
  const jobs = new Map()
  const errors = []
  const checks = []
  ws.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
    if (!message.id) return
    const job = jobs.get(message.id)
    jobs.delete(message.id)
    if (message.error) job?.reject(new Error(JSON.stringify(message.error)))
    else job?.resolve(message.result)
  }
  function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++nextId; const timeout = setTimeout(() => { jobs.delete(id); reject(new Error('Timeout: ' + method)) }, 15000); jobs.set(id, { resolve: value => { clearTimeout(timeout); resolve(value) }, reject: error => { clearTimeout(timeout); reject(error) } }); ws.send(JSON.stringify({ id, method, params })) }) }
  const pause = (ms = 180) => new Promise(resolve => setTimeout(resolve, ms))
  async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value }
  async function navigate(route) { await send('Page.navigate', { url: `${origin}/#${route}` }); await pause(350); await evaluate('document.fonts.ready.then(() => true)') }
  async function reload() {
    await evaluate('window.haruhayBeforeReload = true')
    await send('Page.reload')
    for (let attempt = 0; attempt < 100; attempt++) {
      const loaded = await evaluate('!window.haruhayBeforeReload && document.readyState !== "loading"').catch(() => false)
      if (loaded) return
      await pause(100)
    }
    throw new Error('The reloaded page did not become ready.')
  }
  async function route(route) { await evaluate(`location.hash = ${JSON.stringify(route)}`); await pause() }
  async function click(selector) { await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('Missing element: ' + ${JSON.stringify(selector)}); e.focus(); e.click(); })()`); await pause() }
  async function fill(selector, value) { await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('Missing field: ' + ${JSON.stringify(selector)}); const proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : e.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles:true })); e.dispatchEvent(new Event('change', { bubbles:true })); })()`); await pause(40) }
  async function submit(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`); await pause() }
  async function contains(text) { assert.ok(await evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`), 'Missing text: ' + text) }
  async function key(key, code, virtual, modifiers = 0) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual, modifiers }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual, modifiers }); await pause(60) }
  async function escape() { await key('Escape', 'Escape', 27); await pause() }
  async function tab(shift = false) { await key('Tab', 'Tab', 9, shift ? 8 : 0) }
  async function screenshot(name) { const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(path.join(output, `${name}.png`), Buffer.from(data, 'base64')) }
  async function viewport(width, height = width > 700 ? 900 : 844) { await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await pause() }
  async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name) }
  async function download(filename) { for (let i = 0; i < 40; i++) { if ((await readdir(downloads)).includes(filename)) return readFile(path.join(downloads, filename), 'utf8'); await pause(100) } throw new Error('Missing download: ' + filename) }
  async function finish(extra = {}) { assert.deepEqual(errors, [], 'Browser runtime errors'); await writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: checks.length, checks, errors, ...extra }, null, 2)); console.log(`${checks.length} checks passed. Artifacts: ${output}`) }
  async function close() { await send('Page.close').catch(() => {}); ws.close() }
  await send('Page.enable'); await send('Runtime.enable'); await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
  return { origin, output, send, pause, evaluate, navigate, reload, route, click, fill, submit, contains, escape, tab, screenshot, viewport, check, download, finish, close }
}
