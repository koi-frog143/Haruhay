// This suite requires a fresh disposable dev database. It creates its own property, rooms and accounts.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { browserChecks } from './browser-check-client.mjs'

assert.ok(process.env.DEV_OWNER_PASSWORD, 'Set the disposable backend DEV_OWNER_PASSWORD.')
const owner = process.env.UI_OWNER_EMAIL || 'owner@onboarding.test'
const password = process.env.DEV_OWNER_PASSWORD
const residentPassword = 'Browser-resident-password42'
const email = 'resident-' + Date.now() + '@example.test'
const rejectedEmail = 'rejected-' + Date.now() + '@example.test'
const mailDirectory = path.resolve(process.env.UI_MAIL_DIR || '../haruhay-backend/haruhay-backend/target/onboarding-mail')
const b = await browserChecks('onboarding')
const { check, navigate, route, evaluate, viewport, fill, submit, screenshot, contains, pause, tab, escape, send } = b
async function until(expression, description) {
  for (let n = 0; n < 120; n++) { if (await evaluate(expression)) return; await pause(100) }
  throw new Error('Timed out: ' + description + '\n' + await evaluate('document.body.innerText'))
}
const text = value => until('document.body.innerText.includes(' + JSON.stringify(value) + ')', value)
async function button(value) {
  await until(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(value)}&&!b.disabled)`, 'button ' + value)
  await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(value)});b.focus();b.click()})()`)
  await pause()
}
async function api(endpoint, body) {
  return evaluate(`(async()=>{const headers={};const body=${JSON.stringify(body)};
    if(body!==undefined){const c=await(await fetch('/api/auth/csrf')).json();headers[c.headerName]=c.token;headers['Content-Type']='application/json'}
    const r=await fetch('/api'+${JSON.stringify(endpoint)},{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,data:r.status===204?null:await r.json()}})()`)
}
async function login(address, secret) {
  await navigate('/login'); await text('Welcome back'); await fill('input[name=email]', address); await fill('input[name=password]', secret); await submit('form[aria-label="Sign in to your account"]')
  await until('Boolean(document.querySelector(".admin-heading,.resident-page-heading"))', 'signed-in account')
  await navigate(address === owner ? '/admin/applications' : '/account/status'); const approved = address !== owner && (await api('/account/admissions')).data.some(a => a.status === 'APPROVED'); await text(address === owner ? 'Resident applications' : approved ? 'Welcome home' : 'Your account')
}
async function logout() { assert.equal((await api('/auth/logout', {})).status, 204); await navigate('/login'); await text('Welcome back') }
async function signup(address) {
  await navigate('/register'); await text('Create your account')
  await until('document.querySelector("select[name=propertyId]")?.options.length>1', 'property available')
  await fill('input[name=fullName]', 'Browser Resident'); await fill('input[name=contact]', '09171234567')
  await fill('input[name=email]', address); await fill('input[name=password]', residentPassword)
  const propertyId = await evaluate('document.querySelector("select[name=propertyId]").options[1].value')
  await fill('select[name=propertyId]', propertyId); await until('Boolean(document.querySelector(".room-card .admin-primary"))','room cards'); await b.click('.room-card .admin-primary');await b.click('input[name=acceptedTerms]'); await submit('form[aria-label="Create your account"]'); await text('Your application is on its way')
}
async function verifyAccount(address) {
  await login(address, residentPassword)
  const account = (await api('/account')).data
  const mail = await readFile(path.join(mailDirectory, account.id + '.txt'), 'utf8')
  const fragment = mail.match(/#(\/account\/verify\?token=[A-Za-z0-9_-]+)/)[1]
  await navigate(fragment); await text('Verify my email'); await button('Verify my email'); await text('Email verified')
  await navigate('/account/status'); await text('Pending owner approval')
  return account.id
}
async function reviewNotes(reason) { await fill('dialog textarea[name=reason]', reason); await submit('dialog form'); await until('!document.querySelector("dialog")', 'review saved') }
let propertyId, roomId, applicantId, appId
try {
  await viewport(1440); await navigate('/login'); await api('/auth/logout', {}); await navigate('/login')
  await check('Canonical login uses Figma branding and real sign-in', async () => {
    await text('Welcome back'); assert.equal(await evaluate('Boolean(document.querySelector(".welcome-panel .brand-mark"))'), true)
    const assets = await evaluate('[...document.images].map(i=>({src:i.getAttribute("src"),loaded:i.complete&&i.naturalWidth>0,w:i.getBoundingClientRect().width,h:i.getBoundingClientRect().height}))')
    assert.ok(assets.every(a => a.loaded)); assert.equal(assets.find(a => a.src.includes('FallbackMark')).w, 56)
    assert.equal(assets.find(a => a.src.includes('FallbackWordmark')).w, 172)
    await screenshot('1440-login')
  })
  await check('Signup starts empty and never offers fake properties', async () => {
    await navigate('/register'); await text('Create your account'); await text('No properties are accepting applications yet.')
    assert.equal(await evaluate('document.querySelector("select[name=propertyId]").options.length'), 1)
    assert.equal(await evaluate('[...document.querySelectorAll("input")].every(i=>i.value==="")'), true)
    await screenshot('1440-signup-empty')
  })
  await check('Owner starts with blank records and no sample identities', async () => {
    await login(owner, password); await text('Welcome to your empty workspace')
    assert.equal((await api('/owner/admissions')).data.length, 0); assert.equal((await api('/owner/rooms')).data.length, 0)
    assert.equal(await evaluate('/Andrea|Joy D\\.|3,500/.test(document.body.innerText)'), false)
    await screenshot('1440-owner-empty')
  })
  await check('Owner enters their property and room capacity', async () => {
    await route('/account/property'); await text('Add a property')
    await fill('.onboarding-setup-grid section:first-child input[name=name]', 'Browser House')
    await submit('.onboarding-setup-grid section:first-child form')
    await until('Boolean(document.querySelector("select[name=propertyId]"))', 'property created')
    propertyId = (await api('/owner/properties')).data[0].id
    await fill('input[name=label]', 'Shared room'); await fill('input[name=capacity]', '2'); await submit('.onboarding-setup-grid section:last-child form')
    await text('Shared room'); roomId = (await api('/owner/rooms')).data[0].id
    await api('/owner/rooms/'+roomId+'/details',{version:1,label:'Shared room',capacity:2,roomType:'SHARED',description:'Browser test room',published:true,acceptingApplications:true,pricingBasis:'PER_PERSON',monthlyRent:2500,applicantMonthlyQuote:null,securityDeposit:2500,advanceMonths:1,inclusions:'Wi-Fi and desk',houseRules:'No smoking',charges:[]})
    await screenshot('1440-property-setup')
  })
  await check('Signup creates the account without reserving a room', async () => {
    await logout(); await signup(email); await contains('no email was sent'); await login(email, residentPassword)
    applicantId = (await api('/account')).data.id; const app = (await api('/account/admissions')).data[0]; appId = app.id
    assert.equal(app.status, 'AWAITING_EMAIL'); assert.equal(app.reservation_status, null); assert.equal(app.room_label, null)
    assert.equal((await api('/resident/tenancies')).status, 403); assert.equal((await api('/owner/admissions')).status, 403)
  })
  await check('Pending applicants see only application status and cannot open resident services', async () => {
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".resident-nav a")].map(a=>a.getAttribute("href"))'), ['#/account/status'])
    assert.equal(await evaluate('Boolean(document.querySelector(".resident-search,.resident-icon-button"))'), false)
    await b.click('.resident-account')
    assert.equal(await evaluate('[...document.querySelectorAll(".resident-account-menu a")].some(a=>a.hash==="#/resident/profile")'), false)
    await escape()
    for (const route of ['dashboard','payments','profile','maintenance']) { await navigate('/resident/'+route); await text('Your account'); assert.equal(await evaluate('location.hash'),'#/account/status') }
    await viewport(390); await screenshot('390-awaiting-email'); assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false)
    await b.click('button[aria-label="Open resident navigation"]'); await tab(); assert.equal(await evaluate('Boolean(document.activeElement.closest(".resident-sidebar"))'),true); await escape()
    await viewport(1440)
  })
  await check('Email verification advances to owner review and survives refresh', async () => {
    const mail = await readFile(path.join(mailDirectory, applicantId + '.txt'), 'utf8')
    await navigate(mail.match(/#(\/account\/verify\?token=[A-Za-z0-9_-]+)/)[1]); await text('Verify my email'); await button('Verify my email'); await text('Email verified')
    await navigate('/account/status'); await text('Pending owner approval'); await send('Page.reload'); await text('Pending owner approval')
    await screenshot('1440-pending-approval')
  })
  await check('Owner requests corrections; dialogs trap focus and restore it', async () => {
    await logout(); await login(owner, password); await button('Request corrections')
    for (let n = 0; n < 8; n++) { await tab(); assert.equal(await evaluate('Boolean(document.activeElement.closest("dialog"))'), true) }
    await escape(); assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Request corrections')
    await button('Request corrections'); await reviewNotes('Please correct your contact number')
    await text('Corrections requested')
  })
  await check('Applicant corrects their existing application', async () => {
    await logout(); await login(email, residentPassword); await button('Edit and resubmit'); await fill('dialog input[name=contact]', '09991234567'); await submit('dialog form')
    await text('Pending owner approval'); assert.equal((await api('/account/admissions')).data.length, 1)
  })
  await check('Owner approval immediately starts tenancy without a second verification', async () => {
    await logout(); await login(owner, password); await button('Review & approve');
    assert.equal(await evaluate('document.querySelector("dialog input[name=roomId]").value'),roomId); await reviewNotes('Room agreement and identity reviewed');
    await text('Active tenancy');
    const r=(await api('/owner/rooms')).data[0]; assert.equal(r.held,0); assert.equal(r.active,1);
    await logout(); await login(email,residentPassword); await text('Welcome home');
    assert.equal(await evaluate('[...document.querySelectorAll(".resident-nav a")].some(a=>a.hash==="#/account/status")'),false);
    assert.equal(await evaluate('document.querySelectorAll(".resident-nav a").length'),7);
    await navigate('/account/status'); await text('Welcome home');
    assert.equal(await evaluate('location.hash'),'#/resident/dashboard');
    assert.equal((await api('/resident/tenancies')).data.length,1);
    assert.equal(await evaluate('Boolean(document.querySelector("input[name=code]"))'),false);
    const approval=await readFile(path.join(mailDirectory,applicantId+'.approval.txt'),'utf8');
    assert.match(approval,/No additional verification/); assert.doesNotMatch(approval,/single-use activation code/);
    await screenshot('1440-active-stay');
  })
  await check('Narrow account pages contain only real account data and support history', async () => {
    await viewport(390); await screenshot('390-active-stay'); assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false)
    await route('/register'); await text('Create your account'); assert.equal(await evaluate('Boolean(document.querySelector("input[name=password]"))'), false)
    await evaluate('history.back()'); await text('Welcome home'); await evaluate('history.forward()'); await text('Create your account')
    await send('Page.reload'); await text('Create your account')
  })
  await check('Existing accounts are reused and duplicate applications are rejected', async () => {
    const account = (await api('/account')).data
    assert.equal(account.id, applicantId)
    const response = await api('/public/accounts/signup', { email, fullName: 'Browser Resident', contact: '09991234567', propertyId,roomId,roomVersion:2,acceptedTerms:true })
    assert.equal(response.status, 409); assert.equal(response.data.code, 'APPLICATION_EXISTS')
  })
  await check('A second applicant can sign up without inheriting the first account data', async () => {
    await logout(); await signup(rejectedEmail); await verifyAccount(rejectedEmail)
    assert.equal((await api('/account/admissions')).data.length, 1); assert.equal((await api('/resident/tenancies')).status, 403)
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false)
    await screenshot('390-pending-approval')
  })
  await check('Rejection before approval leaves the room unassigned', async () => {
    await logout(); await login(owner,password); await button('Reject'); await reviewNotes('No room agreement'); await text('Rejected');
    const r=(await api('/owner/rooms')).data[0]; assert.equal(r.held,0); assert.equal(r.active,1);
    await b.click('button[aria-label="Open admin navigation"]'); await tab();
    assert.equal(await evaluate('Boolean(document.activeElement.closest(".admin-sidebar"))'),true); await escape();
  })
  await check('Sample previews remain isolated behind an explicit entry', async () => {
    await navigate('/preview/login'); await text('Welcome back'); await b.click('.admin-preview'); await text('A healthier home, at a glance')
    await navigate('/account/status'); await text('Resident applications'); assert.equal(await evaluate('/Andrea|Joy D\\./.test(document.body.innerText)'), false)
  })
  for (const width of [1440, 390]) await check(width + 'px canonical auth: local assets and no overflow', async () => {
    await logout(); await viewport(width); await navigate('/login'); await text('Welcome back'); await screenshot(width + '-login-final')
    await navigate('/register'); await text('Create your account'); await screenshot(width + '-signup-final')
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false)
    assert.equal(await evaluate('[...document.images].every(i=>i.complete&&i.naturalWidth>0)'), true)
    if (width === 390) { await evaluate('document.querySelector("form").scrollIntoView({block:"start"})'); await screenshot('390-signup-fields') }
    if (width === 1440) await login(owner, password)
  })
  await b.finish({ screens: ['login', 'signup', 'email verification', 'owner empty state', 'property setup', 'review', 'corrections', 'pending activation', 'active stay', 'rejected-held', 'explicit release'], widths: [1440, 390], delivery: 'local files, no real emails sent' })
} catch (error) { await screenshot('failure'); throw error } finally { await b.close() }
