// Run against a disposable dev server with local-file email delivery and a test-only owner.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { browserChecks } from './browser-check-client.mjs'

const owner = process.env.UI_OWNER_EMAIL || 'owner@onboarding.test'
const ownerPassword = process.env.DEV_OWNER_PASSWORD
assert.ok(ownerPassword, 'Set the disposable owner password.')
const stamp = Date.now()
const resident = 'resident-tenancy-' + stamp + '@example.test'
const newEmail = 'resident-updated-' + stamp + '@example.test'
const password = 'Browser-resident-password42'
const mailDir = path.resolve(process.env.UI_MAIL_DIR || '../haruhay-backend/haruhay-backend/target/tenancy-browser-mail')
const b = await browserChecks('live-tenancy')

async function wait(expression) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await b.evaluate(expression)) return
    await b.pause(100)
  }
  throw new Error('Timed out: ' + expression + '\n' + await b.evaluate('document.body.innerText'))
}
const text = value => wait('document.body.innerText.includes(' + JSON.stringify(value) + ')')
async function button(label, scope = 'body') {
  const element = `[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled)`
  await wait('Boolean(' + element + ')')
  await b.evaluate(`(()=>{const button=${element};button.focus();button.click()})()`)
}
async function response(endpoint, body) {
  return b.evaluate(`(async()=>{
    const body=${JSON.stringify(body)}, headers={}
    if(body!==undefined){
      const csrf=await(await fetch('/api/auth/csrf')).json()
      headers[csrf.headerName]=csrf.token
      headers['Content-Type']='application/json'
    }
    const response=await fetch('/api'+${JSON.stringify(endpoint)},{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)})
    return {status:response.status,data:response.status===204?null:await response.json()}
  })()`)
}
async function api(endpoint, body) {
  const result = await response(endpoint, body)
  assert.ok(result.status >= 200 && result.status < 300, endpoint + ': ' + JSON.stringify(result.data))
  return result.data
}
async function login(email, secret) {
  await b.navigate('/login')
  await api('/auth/logout', {})
  await b.evaluate('window.beforeTenancyLoginReload = true')
  await b.send('Page.reload')
  await wait('!window.beforeTenancyLoginReload && Boolean(document.querySelector("form[aria-label=\\\"Sign in to your account\\\"] input[name=email]"))')
  await b.fill('input[name=email]', email)
  await b.fill('input[name=password]', secret)
  await b.submit('form[aria-label="Sign in to your account"]')
  await wait('!location.hash.endsWith("/login") && Boolean(document.querySelector(".admin-heading,.resident-page-heading"))')
}
async function fit() {
  assert.equal(await b.evaluate('document.documentElement.scrollWidth>innerWidth+1'), false)
  assert.equal(await b.evaluate('!document.querySelector("dialog[open]") || document.querySelector("dialog[open]").scrollWidth<=document.querySelector("dialog[open]").clientWidth+2'), true)
}
async function room(propertyId, label, monthlyRent) {
  const { id } = await api('/owner/rooms', { propertyId, label, capacity: 1 })
  const details = await api('/owner/rooms/' + id + '/details', {
    version: 1, label, capacity: 1, roomType: 'PRIVATE', description: 'Tenancy test room',
    published: true, acceptingApplications: true, pricingBasis: 'PER_PERSON', monthlyRent,
    securityDeposit: monthlyRent, advanceMonths: 1, inclusions: 'Wi-Fi and desk', houseRules: 'Quiet after 10 pm', charges: [],
  })
  return details
}
async function mailRoute(id, suffix) {
  const mail = await readFile(path.join(mailDir, id + suffix), 'utf8')
  const match = mail.match(/#(\/account\/verify(?:-email-change)?\?token=[A-Za-z0-9_-]+)/)
  assert.ok(match, 'Expected a local verification link.')
  return match[1]
}

try {
  await b.viewport(1440)
  await login(owner, ownerPassword)
  const property = await api('/owner/properties', { name: 'Tenancy House ' + stamp })
  const oldRoom = await room(property.id, 'Garden room', 2500)
  const newRoom = await room(property.id, 'Upper room', 3200)
  await api('/auth/logout', {})
  const application = await api('/public/accounts/signup', {
    email: resident, fullName: 'Tenancy Browser Resident', contact: '09171234567', password,
    propertyId: property.id, roomId: oldRoom.id, roomVersion: oldRoom.terms_version, acceptedTerms: true,
  })
  await login(resident, password)
  const account = await api('/account')
  await b.navigate(await mailRoute(account.id, '.txt'))
  await button('Verify my email')
  await text('Email verified')
  await login(owner, ownerPassword)
  const app = application.applicationId
  await api('/owner/admissions/' + app + '/approve', { roomId: oldRoom.id, reason: 'Browser fixture' })
  const details = '/admin/residents/' + app
  const period = '2026-08'
  const bill = await api('/owner/bills', { applicationId: app, period, dueDate: period + '-10' })

  await b.check('Owner proposes an available room using the live resident record', async () => {
    await b.navigate(details)
    await text('Tenancy management')
    await fit()
    await b.screenshot('1440-owner-resident')
    await button('Propose room transfer')
    await wait('Boolean(document.querySelector("dialog select"))')
    await b.fill('dialog select', newRoom.id)
    await b.click('dialog details summary')
    await text('Your monthly rent')
    await button('Send transfer proposal', 'dialog')
    await text('Waiting for the resident to accept')
    assert.equal((await api('/public/rooms/' + newRoom.id)).available, 1)
  })

  await b.check('Resident reviews and accepts the transfer on a narrow screen', async () => {
    await login(resident,password)
    await b.viewport(390)
    await b.navigate('/resident/profile')
    await text('My Haruhay profile')
    await button('Review transfer terms')
    await wait('document.activeElement?.matches("dialog h2")')
    await fit()
    await b.screenshot('390-transfer-terms')
    await b.tab(true)
    assert.equal(await b.evaluate('Boolean(document.activeElement.closest("dialog"))'), true)
    await b.click('dialog input[type=checkbox]')
    await button('Accept transfer terms', 'dialog')
    await text('You accepted these terms')
    await b.escape()
    await text('Waiting for owner')
    assert.equal(await b.evaluate('Boolean(document.activeElement.closest(".tenancy-panel"))'), true)
  })

  await b.check('Profile updates persist and sign-in email switches only after verification', async () => {
    await button('Edit profile')
    await b.fill('dialog input[name=fullName]', 'Updated Browser Resident')
    await b.fill('dialog input[name=mobile]', '09991234567')
    await button('Save profile','dialog')
    await text('Your profile was saved.')
    await b.send('Page.reload')
    await text('Updated Browser Resident')
    await text('09991234567')
    await button('Change sign-in email')
    await b.fill('dialog input[name=email]', newEmail)
    await b.fill('dialog input[name=password]', password)
    await fit()
    await b.screenshot('390-email-change')
    await button('Send confirmation link','dialog')
    await text('No email was sent')
    assert.equal((await api('/account')).email,resident)
    await b.navigate(await mailRoute(account.id, '.email-change.txt'))
    await button('Confirm my new email')
    await text('Your email address is updated')
    assert.equal((await response('/account')).status,401)
    await login(newEmail,password)
    assert.equal((await api('/account')).id,account.id)
  })

  await b.check('Completing the transfer refreshes the directory and preserves posted terms', async () => {
    await b.viewport(1440)
    await login(owner,ownerPassword)
    await b.navigate(details)
    await text('Updated Browser Resident')
    await button('Review & complete transfer')
    await button('Confirm room transfer','dialog')
    await text('Room transfer completed')
    await text('Transfer history (1)')
    const row = (await api('/owner/admissions')).find(row => row.id === app)
    assert.equal(row.room_id,newRoom.id)
    assert.equal(row.tenancy_offer.terms.applicant_monthly_rent,3200)
    assert.equal((await api('/owner/bills')).find(row => row.id === bill.id).room_label,oldRoom.label)
  })

  await b.check('Move-out releases the slot and former residents can report the final bill and open receipts', async () => {
    await b.viewport(390)
    await button('End tenancy')
    await text('Outstanding bills')
    await text('Guests still inside')
    await fit()
    await b.screenshot('390-move-out')
    await b.fill('dialog textarea[name=reason]','Move-out confirmed with the resident')
    await b.click('dialog input[type=checkbox]')
    await button('Confirm end tenancy','dialog')
    await text('Tenancy ended. The room slot was released.')
    assert.equal((await api('/public/rooms/' + newRoom.id)).available,1)
    await login(newEmail,password)
    await text('Posted bills')
    assert.deepEqual(await b.evaluate('[...document.querySelectorAll(".resident-nav a")].map(a=>a.hash)'),['#/resident/payments'])
    await b.navigate('/resident/maintenance')
    await text('Posted bills')
    assert.equal(await b.evaluate('location.hash'),'#/resident/payments')
    await b.send('Page.reload')
    await text('Posted bills')
    await fit()
    await b.screenshot('390-former-payments')
    await button('Report a payment')
    await b.fill('dialog select[name=method]','GCASH')
    await b.fill('dialog input[name=reference]','Moveout-' + stamp)
    await button('Submit payment report','dialog')
    await text('Waiting for verification')
    const pending = (await api('/resident/payments')).find(payment => payment.bill_id === bill.id)
    assert.ok(pending)
    await login(owner,ownerPassword)
    assert.equal((await response('/owner/bills',{ applicationId: app, period: '2026-09', dueDate: '2026-09-10' })).status,404)
    await b.navigate('/admin/payments/approvals')
    await wait('Boolean(document.querySelector(".payment-queue-toolbar input"))')
    await b.fill('.payment-queue-toolbar input','Moveout-' + stamp)
    await button('Review payment')
    await wait('Boolean(document.querySelector("dialog .payment-verification input"))')
    await b.click('dialog .payment-verification input')
    await button('Approve payment','dialog')
    await wait('!document.querySelector("dialog[open]")')
    await login(newEmail,password)
    const receipt = '/resident/payments/receipt/' + pending.id
    await b.navigate(receipt)
    await text('Payment acknowledgment')
    await text('Moveout-' + stamp)
    await fit()
    await b.screenshot('390-former-receipt')
    await b.send('Page.reload')
    await text('Moveout-' + stamp)
  })
  await b.finish()
} finally { await b.close() }
