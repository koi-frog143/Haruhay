import assert from 'node:assert/strict'
import { browserChecks } from './browser-check-client.mjs'

// Run after check-onboarding-ui against the same disposable test database.
const base = process.env.UI_BASE_ORIGIN
const owner = process.env.UI_OWNER_EMAIL || 'owner@onboarding.test'
const password = process.env.DEV_OWNER_PASSWORD
assert.ok(password, 'Set the disposable owner password')
const b = await browserChecks('ux-redesign')

async function wait(expression) {
  for (let i = 0; i < 120; i++) {
    if (await b.evaluate(expression)) return
    await b.pause(80)
  }
  throw Error('Timed out: ' + expression + '\n' + await b.evaluate('document.body.innerText.slice(0, 1200)'))
}
async function text(value) {
  await wait('document.body.innerText.includes(' + JSON.stringify(value) + ')')
}
async function route(path) {
  await b.navigate(path)
  await wait('Boolean(document.querySelector("h1"))')
}
async function button(label) {
  await b.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === ${JSON.stringify(label)});
    if (!button) throw Error('Button missing');
    button.focus(); button.click();
  })()`)
}
async function login(email, secret) {
  await b.navigate('/login')
  await b.evaluate(`(async()=>{const c=await(await fetch('/api/auth/csrf')).json();
    await fetch('/api/auth/logout',{method:'POST',headers:{[c.headerName]:c.token}})})()`)
  await b.send('Page.reload')
  await b.pause(350)
  await wait('Boolean(document.querySelector("input[name=password]"))')
  await b.fill('input[name=email]', email)
  await b.fill('input[name=password]', secret)
  await b.submit('form[aria-label="Sign in to your account"]')
  await wait('location.hash.endsWith("/dashboard") || location.hash === "#/guard/logbook"')
}
async function geometry() {
  assert.equal(await b.evaluate('document.documentElement.scrollWidth > innerWidth + 1'), false)
}

try {
  await b.check('Public room browsing and sign-in are visible at phone, tablet and desktop widths', async () => {
    for (const width of [320, 390, 768, 1440]) {
      await b.viewport(width)
      if (base && (width === 390 || width === 1440)) {
        await b.send('Page.navigate', { url: base + '/#/' })
        await wait('Boolean(document.querySelector(".landing-hero h1"))')
        await b.evaluate('document.fonts.ready.then(()=>true)')
        await b.screenshot('before-' + width + '-landing')
      }
      await route('/')
      await text('Browse rooms')
      await geometry()
      assert.equal(await b.evaluate('document.querySelector(".landing-cta a").hash'), '#/register')
      if (width === 390 || width === 1440) await b.screenshot('after-' + width + '-landing')
    }
  })
  await b.check('Validation summary focuses the invalid field and preserves the email entry', async () => {
    await login(owner, password)
    await b.evaluate(`(async()=>{const c=await(await fetch('/api/auth/csrf')).json();
      await fetch('/api/auth/logout',{method:'POST',headers:{[c.headerName]:c.token}})})()`)
    await b.viewport(390)
    await route('/login')
    await b.fill('input[name=email]', 'bad-email')
    await b.submit('form[aria-label="Sign in to your account"]')
    await text('Check the highlighted fields')
    await wait('document.activeElement.matches(".ux-error-summary")')
    await b.click('.ux-error-summary a')
    assert.equal(await b.evaluate('document.activeElement.name'), 'email')
    assert.equal(await b.evaluate('document.activeElement.value'), 'bad-email')
    assert.equal(await b.evaluate('document.activeElement.getAttribute("aria-invalid")'), 'true')
    await b.screenshot('after-390-validation')
  })
  await b.check('Owner application refresh preserves keyboard access and queue filters', async () => {
    await login(owner, password)
    await b.viewport(1440)
    await route('/admin/applications')
    await text('Resident applications')
    await b.fill('select[aria-label="Filter applications"]', 'APPROVED')
    await b.fill('input[aria-label="Search applications"]', 'Browser')
    await button('Refresh records')
    await wait('document.querySelector("select[aria-label=\\"Filter applications\\"]").value === "APPROVED"')
    assert.equal(await b.evaluate('document.querySelector("input[aria-label=\\"Search applications\\"]").value'), 'Browser')
    await b.click('.ux-skip')
    assert.equal(await b.evaluate('document.activeElement.id'), 'admin-main')
    await b.screenshot('after-1440-applications')
    await b.viewport(768)
    await geometry()
    await b.viewport(390)
    await geometry()
    await b.screenshot('after-390-applications')
  })
  await b.check('Resident form protects unsaved input and links departure errors to the field', async () => {
    const residents = await b.evaluate('(async()=>await(await fetch("/api/owner/admissions")).json())()')
    const resident = residents.find(account => account.status === 'APPROVED' && account.email.startsWith('resident-'))
    assert.ok(resident)
    await login(resident.email, 'Browser-resident-password42')
    await route('/resident/dashboard')
    await wait('Boolean(document.querySelector(".resident-next-task a"))')
    await geometry()
    await b.screenshot('after-390-resident')
    await route('/resident/logbook/register')
    await text('Register a visitor')
    await b.fill('input[name=fullName]', 'Friction Test Visitor')
    await b.fill('input[name=arrival]', '2099-12-04T16:00')
    await b.fill('input[name=departure]', '2099-12-04T15:00')
    await b.submit('dialog form')
    await text('Choose a time after expected arrival.')
    await b.escape()
    await text('You have unsaved changes.')
    await button('Keep editing')
    assert.equal(await b.evaluate('document.querySelector("input[name=fullName]").value'), 'Friction Test Visitor')
    await b.escape()
    await button('Discard changes')
    await wait('!document.querySelector("dialog[open]")')
  })
  await b.finish({ widths: [320, 390, 768, 1440], archivedBaseline: Boolean(base) })
} finally {
  await b.close()
}
