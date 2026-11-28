// Run after check-onboarding-ui against the same disposable backend and local mail folder.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { browserChecks } from './browser-check-client.mjs'

const b = await browserChecks('cross-workspace')
const owner = process.env.UI_OWNER_EMAIL || 'owner@onboarding.test'
const ownerPassword = process.env.DEV_OWNER_PASSWORD
const residentPassword = 'Browser-resident-password42'
const guardEmail = `support-guard-${Date.now()}@example.test`
const guardPassword = 'Browser-cross-workspace-guard42'
const supportSubject = `Billing question ${Date.now()}`
const noticeTitle = `Front desk hours ${Date.now()}`
const packageDescription = `Cross-workspace parcel ${Date.now()}`
const mail = path.resolve(process.env.UI_MAIL_DIR || '../haruhay-backend/haruhay-backend/target/onboarding-mail')
assert.ok(ownerPassword, 'Set the disposable owner password.')

async function wait(expression) {
  for (let i = 0; i < 100; i++) {
    if (await b.evaluate(expression)) return
    await b.pause(100)
  }
  throw new Error(`Timed out waiting for ${expression}\n${await b.evaluate('document.body.innerText.slice(-1800)')}`)
}
const text = value => wait(`document.body.innerText.includes(${JSON.stringify(value)})`)
const dialog = (selector = '') => `dialog[open]${selector ? ' ' + selector : ''}`
async function button(label, scope = '', { prefix = false } = {}) {
  const test = prefix ? `button.textContent.trim().startsWith(${JSON.stringify(label)})` : `button.textContent.trim() === ${JSON.stringify(label)}`
  const find = `[...document.querySelectorAll(${JSON.stringify(scope ? scope + ' button' : 'button')})].find(button => !button.disabled && button.getClientRects().length && ${test})`
  await wait(`Boolean(${find})`)
  await b.evaluate(`(() => { const button = ${find}; button.focus(); button.click() })()`)
  await b.pause()
}
async function api(endpoint, data, method = data === undefined ? 'GET' : 'POST') {
  return b.evaluate(`(async () => {
    const data = ${JSON.stringify(data)};
    const headers = {};
    if (data !== undefined) {
      const token = await (await fetch('/api/auth/csrf')).json();
      headers[token.headerName] = token.token;
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(${JSON.stringify('/api' + endpoint)}, {
      method: ${JSON.stringify(method)}, headers, body: data === undefined ? undefined : JSON.stringify(data)
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  })()`)
}
async function login(email, password, destination) {
  await b.navigate('/login')
  await api('/auth/logout', {})
  await b.reload()
  await wait('Boolean(document.querySelector("input[name=password]"))')
  await b.fill('input[name=email]', email)
  await b.fill('input[name=password]', password)
  await b.submit('form[aria-label="Sign in to your account"]')
  await wait(`location.hash === ${JSON.stringify('#' + destination)}`)
  const workspace = destination.startsWith('/resident') ? '.resident-workspace'
    : destination.startsWith('/admin') ? '.admin-workspace' : '.guard-shell'
  await wait(`Boolean(document.querySelector(${JSON.stringify(workspace)}))`)
}
async function closeDialog() {
  await b.click(dialog('[aria-label="Close dialog"]'))
  assert.equal(await b.evaluate('Boolean(document.querySelector("dialog[open]"))'), false, 'A successfully saved conversation should close without an unsaved-changes warning.')
}
async function support() {
  await wait('Boolean(document.querySelector("button.resident-support"))')
  if (await b.evaluate('innerWidth < 981')) await b.click('.resident-menu-button')
  await b.click('button.resident-support')
  await text('My support requests')
}
const noOverflow = async () => assert.equal(await b.evaluate('document.documentElement.scrollWidth > innerWidth + 1'), false)
const asOwner = () => login(owner, ownerPassword, '/admin/dashboard')

try {
  await b.viewport(1440)
  await asOwner()
  const { body: applications } = await api('/owner/admissions')
  const resident = applications.find(item => item.tenancy_status === 'ACTIVE' && item.email.startsWith('resident-'))
  assert.ok(resident, 'Run the onboarding browser suite first.')
  const property = resident.property_id
  const asResident = () => login(resident.email, residentPassword, '/resident/dashboard')
  const asGuard = password => login(guardEmail, password || guardPassword, '/guard/logbook')

  await b.check('Live billing defaults and schedule persist, and occupancy has a downloadable CSV', async () => {
    await b.navigate('/admin/settings')
    await b.click('[aria-label="Manage Monthly billing rules"]')
    await wait(`Boolean(document.querySelector(${JSON.stringify(dialog('input[name=dueDay]'))}))`)
    await b.fill(dialog('input[name=dueDay]'), '21')
    await b.fill(dialog('input[name=graceDays]'), '3')
    if (!await b.evaluate('document.querySelector("dialog input[name=automaticEnabled]").checked')) {
      await b.click(dialog('input[name=automaticEnabled]'))
    }
    await b.fill(dialog('input[name=postingDay]'), '5')
    await button('Save settings', dialog())
    await text('Property settings saved.')
    const settings = await api(`/owner/properties/${property}/settings`)
    assert.deepEqual(settings.body.billing, { dueDay: 21, graceDays: 3, automaticEnabled: true, postingDay: 5 })
    await b.click('[aria-label="Manage Export & reports"]')
    await wait('document.querySelectorAll("dialog select").length === 2')
    await b.fill(dialog('select'), property)
    await b.fill(dialog('.owner-report-filters label:nth-child(2) select'), 'OCCUPANCY')
    await button('Preview report', dialog())
    await wait('Boolean(document.querySelector(".owner-report-result"))')
    await button('Download CSV report', dialog())
    assert.match(await b.download('haruhay-occupancy-current.csv'), /Room capacity|Capacity/)
  })

  await b.check('A published announcement appears on the Community Board and its inbox read state survives refresh', async () => {
    const response = await api('/owner/announcements', {
      requestId: crypto.randomUUID(), propertyId: property,
      content: { title: noticeTitle, category: 'GENERAL', summary: 'Updated office hours.', message: 'The front desk closes at 8 pm.' },
      publish: true,
    })
    assert.equal(response.status, 200)
    await asResident()
    await b.navigate('/resident/community')
    await text(noticeTitle)
    await b.click('button[aria-label^="Notifications"]')
    await text(noticeTitle)
    await b.click(`button[aria-label=${JSON.stringify('Mark as read: ' + noticeTitle)}]`)
    await wait(`!document.querySelector(${JSON.stringify(`button[aria-label="${'Mark as read: ' + noticeTitle}"]`)})`)
    await b.reload()
    await wait('Boolean(document.querySelector("button[aria-label^=Notifications]"))')
    await b.click('button[aria-label^="Notifications"]')
    await wait(`[...document.querySelectorAll(".resident-inbox li")].some(row => row.innerText.includes(${JSON.stringify(noticeTitle)}) && row.innerText.includes("· Read"))`)
  })

  await b.check('A resident can retry a failed support submission and the owner can reply', async () => {
    await b.navigate('/resident/dashboard')
    await b.viewport(390)
    await support()
    await button('New support request', dialog())
    await b.fill(dialog('input[name=subject]'), supportSubject)
    await b.fill(dialog('textarea[name=message]'), 'Can I pay at the front desk?')
    await b.evaluate(`(() => {
      const original = window.fetch.bind(window);
      window.fetch = (url, init) => {
        if (url === '/api/resident/support' && init?.method === 'POST') {
          window.fetch = original;
          return Promise.resolve(new Response(JSON.stringify({ message: 'Temporary support connection failure.' }), { status: 503 }));
        }
        return original(url, init);
      };
    })()`)
    await button('Submit request', dialog())
    await text('Temporary support connection failure.')
    assert.equal(await b.evaluate('document.querySelector("dialog textarea").value'), 'Can I pay at the front desk?')
    await button('Submit request', dialog())
    await text('Support request submitted.')
    assert.equal(await b.evaluate(`(() => {
      const items = [...document.querySelectorAll('.support-conversation .support-summary > *')].map(element => element.getBoundingClientRect());
      return items.length === 3 && items[1].top >= items[0].bottom && items[2].top >= items[1].bottom;
    })()`), true, 'The subject, property and status should stack in the narrow dialog.')
    await noOverflow()
    await b.screenshot('390-resident-support')
    await b.viewport(1440)
    await asOwner()
    await b.navigate('/admin/support')
    await b.fill('input[name=query]', supportSubject)
    await button('Apply filters')
    const requestButton = `button[aria-label=${JSON.stringify('Open request ' + supportSubject)}]`
    await wait(`Boolean(document.querySelector(${JSON.stringify(requestButton)}))`)
    await b.click(requestButton)
    await text('Can I pay at the front desk?')
    await b.fill(dialog('textarea'), 'Yes, during office hours.')
    await b.click(dialog('[aria-label="Close dialog"]'))
    await text('You have unsaved changes.')
    await button('Keep editing', dialog())
    assert.equal(await b.evaluate('document.querySelector("dialog textarea").value'), 'Yes, during office hours.')
    await button('Send reply', dialog())
    await text('Reply sent.')
    await button('Mark as waiting for resident', dialog())
    await text('Request status updated.')
    await closeDialog()

    await asResident()
    await support()
    await wait(`Boolean(document.querySelector(${JSON.stringify(requestButton)}))`)
    await b.click(requestButton)
    await text('Yes, during office hours.')
    await b.fill(dialog('textarea'), 'Thanks, that answers my question.')
    await button('Send reply', dialog())
    await text('Status changed from Waiting for resident to Open.')
    await closeDialog()
  })

  await b.check('The Holding Station records and releases a real test parcel and keeps its collection history', async () => {
    await asOwner()
    await b.navigate('/admin/holding-station')
    await button('Record held item')
    await b.fill(dialog('select[name=residentId]'), resident.id)
    await b.fill(dialog('input[name=description]'), packageDescription)
    await b.fill(dialog('input[name=sender]'), 'Test courier')
    const slot = await b.evaluate('[...document.querySelector("dialog select[name=slot]").options].find(option => !option.disabled && option.value)?.value')
    assert.ok(slot, 'The disposable property has an available shelf')
    await b.fill(dialog('select[name=slot]'), slot)
    await button('Save holding record', dialog())
    await text('Holding record saved. Ready for pickup.')
    await asResident()
    await b.navigate('/resident/holding-station')
    await text(packageDescription)
    await asOwner()
    await b.navigate('/admin/holding-station')
    await text(packageDescription)
    await b.fill('input[type=search]', packageDescription)
    await button('Release', '.hs-table')
    await b.fill(dialog('select[name=idType]'), 'Student ID')
    await b.fill(dialog('input[name=idLastFour]'), '1234')
    await b.click(dialog('input[name=verifiedId]'))
    await b.click(dialog('input[name=signed]'))
    await button('Confirm release', dialog())
    await text('Item released and transaction recorded.')
    await asResident()
    await b.navigate('/resident/holding-station')
    await button('History', '.hs-history-heading', { prefix: true })
    await text('Collection history')
    await text(packageDescription)
  })

  await b.check('A guard records resident movement and the resident exports it', async () => {
    const { body: history } = await api('/resident/access-history')
    const movement = history?.[0]?.direction === 'ENTRY' ? 'EXIT' : 'ENTRY'
    await asOwner()
    assert.equal((await api(`/logbook/properties/${property}/guards`, {
      email: guardEmail, fullName: 'System test guard', password: guardPassword, canReview: false,
    })).status, 204)
    await asGuard()
    await b.viewport(390)
    await button('Record resident entry or exit')
    await b.fill(dialog('input[type=search]'), 'Browser Resident')
    await button('Find resident', dialog())
    await button('Select Browser Resident', dialog(), { prefix: true })
    await b.fill(dialog('select[name=direction]'), movement)
    await b.fill(dialog('input[name=entryPoint]'), 'Cross-workspace entrance')
    await b.click(dialog('input[name=identity]'))
    await button('Confirm movement', dialog())
    await text((movement === 'ENTRY' ? 'Entry' : 'Exit') + ' recorded for Browser Resident.')
    await noOverflow()
    await asResident()
    await b.navigate('/resident/logbook/access-history')
    await text('Cross-workspace entrance')
    await button('Download log')
    const dates = await b.evaluate('[...document.querySelectorAll("dialog input[type=date]")].map(field => field.value)')
    await button('Download CSV', dialog())
    const csv = await b.download(`haruhay-access-history-${dates[0]}-to-${dates[1]}.csv`)
    assert.match(csv, /Cross-workspace entrance/)
  })

  await b.check('Live password recovery uses a local mail link and signs the guard in with the new password', async () => {
    await asGuard()
    const { body: guard } = await api('/account')
    await api('/auth/logout', {})
    await b.navigate('/login')
    await b.click('a[href="#/forgot-password"]')
    await b.fill('input[name=email]', guardEmail)
    await button('Send reset link')
    await text('Local development delivery')
    let message
    for (let i = 0; i < 80 && !message; i++) {
      message = await readFile(path.join(mail, guard.id + '.password-reset.txt'), 'utf8').catch(() => null)
      if (!message) await b.pause(100)
    }
    assert.ok(message, 'Expected a local password reset email file.')
    const resetLink = message.match(/#(\/reset-password\?token=[A-Za-z0-9_-]+)/)?.[1]
    assert.ok(resetLink)
    await b.navigate(resetLink)
    const nextPassword = 'Updated-system-test-guard42'
    await b.fill('input[name=password]', nextPassword)
    await b.fill('input[name=confirmation]', nextPassword)
    await button('Update password')
    await text('Password updated. Sign in with your new password.')
    await asGuard(nextPassword)
    await b.navigate(resetLink)
    await b.fill('input[name=password]', nextPassword)
    await b.fill('input[name=confirmation]', nextPassword)
    await button('Update password')
    await text('This reset link is invalid, expired, or already used.')
    await noOverflow()
  })

  await b.finish({ database: 'Disposable, with local-only email delivery', widths: [1440, 390] })
} catch (error) {
  await b.screenshot('failure')
  throw error
} finally {
  await b.close()
}
