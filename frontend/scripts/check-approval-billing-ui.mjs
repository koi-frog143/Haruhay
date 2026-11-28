// Requires the disposable database created by check-onboarding-ui; local-file email only.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {browserChecks} from './browser-check-client.mjs'
const b=await browserChecks('approval-billing')
const stamp=Date.now(), email='polish-'+stamp+'@example.test',password='Browser-polish-password42',name='Polished Applicant '+stamp, roomLabel='Selected private room '+stamp
async function wait(expression){for(let n=0;n<120;n++){if(await b.evaluate(expression))return;await b.pause(100)}throw Error('Timed out '+expression+'\n'+await b.evaluate('document.body.innerText'))}
async function text(value){await wait('document.body.innerText.includes('+JSON.stringify(value)+')')}
async function post(endpoint,body){return b.evaluate(`(async()=>{const csrf=await(await fetch('/api/auth/csrf')).json();const r=await fetch('/api'+${JSON.stringify(endpoint)},{method:'POST',headers:{[csrf.headerName]:csrf.token,'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})});const data=r.status===204?null:await r.json();if(!r.ok)throw Error(JSON.stringify(data));return data})()`)}
async function get(endpoint){return b.evaluate(`(async()=>await(await fetch('/api'+${JSON.stringify(endpoint)})).json())()`)}
async function login(address,secret){await b.navigate('/login');await post('/auth/logout',{});await b.send('Page.reload');await b.pause(350);await wait('Boolean(document.querySelector("input[name=password]"))');await b.fill('input[name=email]',address);await b.fill('input[name=password]',secret);await b.submit('form');await wait('Boolean(document.querySelector(".admin-heading,.resident-page-heading"))')}
async function geometry(){assert.equal(await b.evaluate('document.documentElement.scrollWidth>innerWidth+1'),false);assert.equal(await b.evaluate('[...document.images].every(i=>i.complete&&i.naturalWidth>0)'),true)}
let roomId,appId
try{
  await login(process.env.UI_OWNER_EMAIL||'owner@onboarding.test',process.env.DEV_OWNER_PASSWORD)
  const property=(await get('/owner/properties'))[0]
  roomId=(await post('/owner/rooms',{propertyId:property.id,label:'Polished room '+Date.now(),capacity:1})).id
  const listing={version:1,label:roomLabel,capacity:1,roomType:'PRIVATE',description:'A quiet room for your stay.',published:true,acceptingApplications:true,pricingBasis:'PER_ROOM',monthlyRent:2750,applicantMonthlyQuote:null,securityDeposit:2750,advanceMonths:1,inclusions:'Private bathroom, desk and bed',houseRules:'Quiet hours after 10 pm',charges:[{name:'Internet',basis:'FIXED_MONTHLY',amount:150,notes:'Monthly internet access'},{name:'Electricity',basis:'USAGE_BASED',amount:null,notes:'Metered usage billed separately'}]}
  await post('/owner/rooms/'+roomId+'/details',listing);await post('/auth/logout',{});await b.navigate('/register');await wait('Boolean(document.querySelector("select[name=propertyId]"))')
  await b.fill('input[name=fullName]',name);await b.fill('input[name=contact]','09171234567');await b.fill('input[name=email]',email);await b.fill('input[name=password]',password);await b.fill('select[name=propertyId]',property.id)
  await wait('[...document.querySelectorAll(".room-card")].some(c=>c.textContent.includes('+JSON.stringify(roomLabel)+'))')
  await b.evaluate('[...document.querySelectorAll(".room-card")].find(c=>c.textContent.includes('+JSON.stringify(roomLabel)+')).querySelector(".admin-primary").click()');await b.pause()
  await b.check('Room selection and consent summary are readable at desktop and narrow sizes',async()=>{
    for(const width of [1440,390]){await b.viewport(width);await b.evaluate('document.querySelector(".room-review-summary").scrollIntoView({block:"center"})');await geometry();await b.screenshot(width+'-signup-summary')}
    await b.click('input[name=acceptedTerms]');await b.submit('form[aria-label="Create your account"]');await text('Your application is on its way')
  })
  await login(email,password);const account=await get('/account');appId=(await get('/account/admissions'))[0].id
  await b.check('Verification explains the signup email and offers a resend fallback',async()=>{
    await text('We sent a verification link when you created your account.');await text('Resend verification email')
    for(const width of [1440,390]){await b.viewport(width);await b.evaluate('document.querySelector(".application-account").scrollIntoView({block:"center"})');await geometry();await b.screenshot(width+'-verification-wording')}
  })
  const mail=await readFile(path.resolve(process.env.UI_MAIL_DIR||'../haruhay-backend/haruhay-backend/target/approval-polish-mail',account.id+'.txt'),'utf8')
  await post('/public/email/verify',{token:mail.match(/token=([A-Za-z0-9_-]+)/)[1]})
  await login(process.env.UI_OWNER_EMAIL||'owner@onboarding.test',process.env.DEV_OWNER_PASSWORD);await b.navigate('/admin/applications');await text(name)
  await b.check('Owner sees the selected room and approval cannot choose an unrelated room',async()=>{
    await b.evaluate(`[...document.querySelectorAll('tr')].find(r=>r.textContent.includes(${JSON.stringify(name)})).querySelector('.admin-primary').click()`);await wait('Boolean(document.querySelector("dialog[open]"))')
    assert.equal(await b.evaluate('Boolean(document.querySelector("dialog select[name=roomId]"))'),false)
    assert.equal(await b.evaluate('document.querySelector("dialog input[name=roomId]").value'),roomId)
    assert.equal(await b.evaluate('Boolean(document.querySelector("dialog .room-placeholder"))'),false)
    for(const width of [1440,390]){await b.viewport(width);await geometry();await b.screenshot(width+'-approval-review')}
    await b.fill('dialog textarea[name=reason]','Confirmed the selected room and accepted pricing.');await b.submit('dialog form');await wait('!document.querySelector("dialog[open]")')
  })
  await b.check('Successful approval appears as a floating owner notification',async()=>{
    await text(name+' approved.');assert.equal(await b.evaluate('Boolean(document.querySelector(".admin-toast[role=status]"))'),true)
    assert.equal(await b.evaluate('Boolean(document.querySelector(".onboarding-content > .form-notice"))'),false)
    await b.screenshot('390-approval-toast')
  })
  await b.navigate('/admin/billing');await text('Post monthly bill')
  await b.check('Posting a bill uses the accepted amount and shows the owner balance',async()=>{
    await b.evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="Post monthly bill").click()');await wait('Boolean(document.querySelector("dialog[open]"))')
    await b.fill('dialog select',appId);await b.fill('dialog input[name=period]','2026-11');await b.fill('dialog input[name=dueDate]','2026-11-25')
    await b.contains('2,900.00');await b.screenshot('390-post-monthly-bill');await b.submit('dialog form');await wait('!document.querySelector("dialog[open]")')
    const bills=await get('/owner/bills');assert.equal(bills.filter(row=>row.application_id===appId).length,1)
    await post('/owner/bills',{applicationId:appId,period:'2026-11',dueDate:'2026-11-25'});assert.equal((await get('/owner/bills')).filter(row=>row.application_id===appId).length,1)
    const summary=await b.evaluate('(async()=>{const m=await import("/src/billingData.ts");return m.getPropertyBilling()})()');assert.equal(summary.balances.find(row=>row.resident.id===appId).balance,2900);assert.equal(summary.balances.find(row=>row.resident.id===appId).paid,0)
  })
  await login(email,password);await b.navigate('/resident/payments')
  await b.check('Resident billing matches the posted accepted rent without fabricating payments',async()=>{
    const summary=await b.evaluate('(async()=>{const m=await import("/src/billingData.ts");return m.getBillingSummary()})()')
    assert.equal(summary.rent,2750);assert.equal(summary.utilities,150);assert.equal(summary.balance,2900);assert.equal(summary.paid,0);assert.equal(summary.posted,true)
    assert.equal((await get('/resident/bills')).length,1)
    for(const width of [1440,390]){await b.viewport(width);await geometry();await b.screenshot(width+'-resident-posted-bill')}
  })
  await b.finish({delivery:'Local development files; no real emails',bill:'2750 rent + 150 fixed charge; usage-based electricity excluded'})
}catch(error){await b.screenshot('failure');throw error}finally{await b.close()}
