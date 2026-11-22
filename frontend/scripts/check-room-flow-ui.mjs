// Run after check-onboarding-ui against the same disposable local-file-mail backend.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { browserChecks } from './browser-check-client.mjs'
const b = await browserChecks('room-flow')
const email = `status-${Date.now()}@example.test`
const password = 'Browser-status-password42'
const cookies = new Map()
async function ownerFetch(endpoint, init = {}) {
  const response = await fetch(b.origin + '/api' + endpoint, { ...init, headers: { Cookie: [...cookies].map(([k,v])=>k+'='+v).join('; '), ...init.headers } })
  for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(';')[0]; const at = pair.indexOf('='); cookies.set(pair.slice(0,at),pair.slice(at+1)) }
  assert.ok(response.ok, endpoint + ': ' + response.status)
  return response.status === 204 ? null : response.json()
}
async function ownerPost(endpoint, body, form = false) {
  const csrf = await ownerFetch('/auth/csrf')
  return ownerFetch(endpoint, { method:'POST', headers:{ [csrf.headerName]:csrf.token, 'Content-Type':form?'application/x-www-form-urlencoded':'application/json' }, body:form?new URLSearchParams(body):JSON.stringify(body) })
}
async function browserPost(endpoint, body) { return b.evaluate(`(async()=>{const c=await(await fetch('/api/auth/csrf')).json();const r=await fetch('/api'+${JSON.stringify(endpoint)},{method:'POST',headers:{[c.headerName]:c.token,'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})});if(!r.ok)throw Error('HTTP '+r.status);return r.status===204?null:r.json()})()`) }
async function wait(expression) { for(let n=0;n<250;n++){if(await b.evaluate(expression))return;await b.pause(100)}throw Error('Timed out: '+expression) }
async function text(value) { await wait('document.body.innerText.includes('+JSON.stringify(value)+')') }
async function geometry() { assert.equal(await b.evaluate('document.documentElement.scrollWidth>innerWidth+1'),false); assert.equal(await b.evaluate('[...document.images].every(i=>i.complete&&i.naturalWidth>0)'),true) }
try {
  await ownerPost('/auth/login',{username:process.env.UI_OWNER_EMAIL||'owner@onboarding.test',password:process.env.DEV_OWNER_PASSWORD},true)
  const properties=await ownerFetch('/owner/properties')
  const roomLabel='Room browser flow '+Date.now()
  const newRoom=await ownerPost('/owner/rooms',{propertyId:properties[0].id,label:roomLabel,capacity:1})
  const listing={version:1,label:roomLabel,capacity:1,roomType:'PRIVATE',description:'A quiet private room.',published:true,acceptingApplications:true,pricingBasis:'PER_PERSON',monthlyRent:2500,applicantMonthlyQuote:null,securityDeposit:2500,advanceMonths:1,inclusions:'Desk and Wi-Fi',houseRules:'No smoking',charges:[{name:'Electricity',basis:'USAGE_BASED',amount:null,notes:'Metered usage billed monthly.'}]}
  await ownerPost('/owner/rooms/'+newRoom.id+'/details',listing)
  await b.navigate('/login');await browserPost('/auth/logout',{});await b.send('Page.reload');await b.pause(400);await wait('Boolean(document.querySelector("input[name=password]"))');await b.fill('input[name=email]',process.env.UI_OWNER_EMAIL||'owner@onboarding.test');await b.fill('input[name=password]',process.env.DEV_OWNER_PASSWORD);await b.submit('form');await wait('Boolean(document.querySelector(".admin-heading"))');await b.navigate('/admin/property');await text('Room listings & pricing');
  await b.check('Owner listing editor supports desktop, narrow layouts and keyboard dismissal',async()=>{await b.evaluate('[...document.querySelectorAll(".room-card button")].at(-1).click()');await wait('Boolean(document.querySelector("dialog[open]"))');for(const width of [1440,390]){await b.viewport(width);await geometry();await b.screenshot(width+'-owner-editor')}await b.tab();assert.equal(await b.evaluate('Boolean(document.activeElement.closest("dialog"))'),true);await b.escape();await b.evaluate('[...document.querySelectorAll(".room-card button")].at(-1).click()');await wait('Boolean(document.querySelector("dialog[open]"))');await b.fill('dialog textarea[name=description]','Edited through the owner form.');await b.submit('dialog form');await wait('!document.querySelector("dialog[open]")');assert.ok((await ownerFetch('/owner/rooms')).some(r=>r.description==='Edited through the owner form.'))})
  await browserPost('/auth/logout',{});
  await b.navigate('/register');await wait('Boolean(document.querySelector("select[name=propertyId]"))');await b.fill('select[name=propertyId]',properties[0].id);await wait('Boolean(document.querySelector(".room-card"))');
  await b.check('Published room catalogue and details are responsive with honest pricing',async()=>{for(const width of [1440,390]){await b.viewport(width);await geometry();await b.screenshot(width+'-catalogue')}await b.click('.room-card .admin-secondary');await wait('Boolean(document.querySelector("dialog[open]"))');await geometry();await b.screenshot('390-room-details');await b.escape()})
  await b.navigate('/login');await browserPost('/auth/logout',{});await b.send('Page.reload');await b.pause(400);await wait('Boolean(document.querySelector("input[name=password]"))')
  await browserPost('/public/accounts/signup',{email,password,fullName:'Status Applicant',contact:'09171234567',propertyId:properties[0].id,roomId:newRoom.id,roomVersion:2,acceptedTerms:true})
  await b.fill('input[name=email]',email);await b.fill('input[name=password]',password);await b.submit('form');await text('Application status')
  const account=await b.evaluate('(async()=>await(await fetch("/api/account")).json())()')
  const app=(await b.evaluate('(async()=>await(await fetch("/api/account/admissions")).json())()'))[0]
  await b.check('Unverified applicant has one navigation destination and honest progress',async()=>{
    assert.deepEqual(await b.evaluate('[...document.querySelectorAll(".resident-nav a")].map(a=>a.hash)'),['#/account/status'])
    assert.equal(await b.evaluate('document.querySelectorAll(".application-steps .is-complete").length'),1)
    await text('Check your inbox');await text('Verification needed')
    for(const width of [1440,390]){await b.viewport(width);await geometry();await b.screenshot(width+'-verify-email')}
  })
  const mail=await readFile(path.resolve(process.env.UI_MAIL_DIR||'../haruhay-backend/haruhay-backend/target/onboarding-mail',account.id+'.txt'),'utf8')
  await browserPost('/public/email/verify',{token:mail.match(/token=([A-Za-z0-9_-]+)/)[1]})
  await b.navigate('/account/status');await text('Pending owner approval')
  await b.check('Verified pending status matches the brand at desktop and narrow widths',async()=>{
    assert.equal(await b.evaluate('document.querySelectorAll(".application-steps .is-complete").length'),2)
    for(const width of [1440,390]){await b.viewport(width);await geometry();await b.screenshot(width+'-pending')}
    await b.click('.resident-account');assert.equal(await b.evaluate('document.querySelectorAll(".resident-account-menu a").length'),1);await b.escape()
  })
  await ownerPost('/owner/admissions/'+app.id+'/corrections',{reason:'Please confirm your contact number.'})
  await b.evaluate('window.dispatchEvent(new Event("focus"))');await text('Corrections requested')
  await b.check('Owner feedback and correction form remain accessible',async()=>{
    await text('Please confirm your contact number.')
    for(const width of [1440,390]){await b.viewport(width);await geometry();await b.screenshot(width+'-corrections')}
    await b.evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="Edit and resubmit").click()')
    await wait('Boolean(document.querySelector("dialog[open]"))');await b.tab(true);assert.equal(await b.evaluate('Boolean(document.activeElement.closest("dialog"))'),true)
    await b.fill('dialog input[name=contact]','09991234567');await b.submit('dialog form');await text('Pending owner approval')
  })
  await ownerPost('/owner/rooms/'+newRoom.id+'/details',{...listing,version:2,monthlyRent:2800})
  await ownerPost('/owner/admissions/'+app.id+'/offer',{roomId:newRoom.id,roomVersion:3,quote:null,reason:'Updated monthly rent: 2800 PHP.'})
  await b.evaluate('window.dispatchEvent(new Event("focus"))');await text('Revised room offer: please review')
  await b.check('Revised offer exposes saved costs and needs explicit acceptance',async()=>{await b.click('.room-agreement > details > summary');await b.screenshot('390-revised-offer');await b.click('.room-offer-actions input');await b.submit('.room-offer-actions');await wait('!document.querySelector(".room-offer-actions")');assert.equal(await b.evaluate('(async()=>(await fetch("/api/resident/tenancies")).status)()'),403)})
  const room={id:newRoom.id}
  await ownerPost('/owner/admissions/'+app.id+'/approve',{roomId:room.id,reason:'Status transition browser check.'})
  await b.check('Open pending page detects approval automatically and removes application navigation',async()=>{
    await wait('location.hash==="#/resident/dashboard"');await text('Welcome home, Status!')
    assert.equal(await b.evaluate('document.querySelectorAll(".resident-nav a").length'),7)
    assert.equal(await b.evaluate('[...document.querySelectorAll(".resident-nav a")].some(a=>a.hash==="#/account/status")'),false)
    assert.equal(await b.evaluate('(async()=>(await fetch("/api/resident/tenancies")).status)()'),200)
    await b.screenshot('390-approved-dashboard')
  })
  await b.check('Approved status URLs, refresh and Back never reopen application navigation',async()=>{
    await b.navigate('/account/status');await wait('location.hash==="#/resident/dashboard"')
    await b.send('Page.reload');await text('Welcome home, Status!')
    await b.route('/resident/payments');await b.evaluate('history.back()');await text('Welcome home, Status!')
    assert.equal(await b.evaluate('Boolean(document.querySelector(".application-page"))'),false)
  })
  await b.finish({database:'Disposable; local file email only',widths:[1440,390],approval:'Detected by periodic status refresh'})
}catch(error){await b.screenshot('failure');throw error}finally{await b.close()}
