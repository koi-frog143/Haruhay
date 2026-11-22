// Run after check-onboarding-ui against its disposable database.
import assert from 'node:assert/strict'
import { browserChecks } from './browser-check-client.mjs'
const b=await browserChecks('live-workspaces')
const {navigate,evaluate,fill,submit,pause,check,viewport,screenshot}=b
async function wait(expression) { for(let i=0;i<100;i++){if(await evaluate(expression))return;await pause(100)}throw new Error('Timed out: '+expression+'\n'+await evaluate('document.body.innerText')) }
async function post(url,body) { return evaluate(`(async()=>{const c=await(await fetch('/api/auth/csrf')).json();const r=await fetch(${JSON.stringify(url)},{method:'POST',headers:{[c.headerName]:c.token,'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})});return r.status===204?null:await r.json()})()`) }
async function login(email,password) {
  await navigate('/login');await post('/api/auth/logout',{});await b.send('Page.reload');await pause(250)
  await wait('Boolean(document.querySelector("input[name=password]"))');await fill('input[name=email]',email);await fill('input[name=password]',password);await submit('form')
  await wait('Boolean(document.querySelector(".admin-heading,.resident-page-heading"))')
}
try {
  await check('Owner login opens the original dashboard with every admin tab',async()=>{
    await login(process.env.UI_OWNER_EMAIL||'owner@onboarding.test',process.env.DEV_OWNER_PASSWORD)
    assert.equal(await evaluate('location.hash'),'#/admin/dashboard')
    for(const href of ['dashboard','residents','logbook','maintenance','holding-station','billing','announcements','settings','applications','property'])
      assert.equal(await evaluate(`Boolean(document.querySelector('.admin-sidebar a[href="#/admin/${href}"]'))`),true)
  })
  const apps=await evaluate('(async()=>await(await fetch("/api/owner/admissions")).json())()')
  const resident=apps.find(a=>a.status==='APPROVED' && a.email.startsWith('resident-'));assert.ok(resident)
  for(const width of [1440,390]) {
    await viewport(width)
    for(const page of ['dashboard','residents','logbook','maintenance','holding-station','billing','payments/approvals','announcements','settings','applications','property'])await check(width+'px full admin/'+page,async()=>{
      await navigate('/admin/'+page);await wait('Boolean(document.querySelector(".admin-content h1"))')
      assert.equal(await evaluate('/Andrea Santos|Joy D\\.|Luis Villanueva|Marco Reyes|SAMPLE-GC/.test(document.body.innerText)'),false)
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+1'),false)
      await screenshot(width+'-admin-'+page.replaceAll('/','-'))
    })
  }
  await check('Approved resident login opens the original dashboard using their actual identity',async()=>{
    await login(resident.email,'Browser-resident-password42')
    assert.equal(await evaluate('location.hash'),'#/resident/dashboard')
    await b.contains('Browser');await b.contains('Shared room')
  })
  for(const width of [1440,390]) {
    await viewport(width)
    for(const page of ['dashboard','logbook','logbook/register','logbook/access-history','maintenance','maintenance/new','holding-station','payments','payments/history','community','profile'])await check(width+'px full resident/'+page,async()=>{
      await navigate('/resident/'+page);await wait('Boolean(document.querySelector(".resident-content h1,.resident-page-heading h1,.hs-content h1"))')
      assert.equal(await evaluate('/Andrea Santos|Room 204|Joy D\\.|Shopee parcel|Leaking bathroom faucet|SAMPLE-GC/.test(document.body.innerText)'),false)
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+1'),false)
      await screenshot(width+'-resident-'+page.replaceAll('/','-'))
    })
  }
  await check('Sample records and account-local UI state remain separate',async()=>{
    await navigate('/resident/dashboard')
    const data=await evaluate('(async()=>{const m=await import("/src/residentData.ts");const t=await import("/src/maintenanceData.ts");const h=await import("/src/holdingData.ts");return {payments:m.getResidentPayments(),visitors:m.getVisitorEntries(),access:m.accessRecords,tickets:t.getMaintenanceTickets(),packages:h.getHoldingState().items,balance:m.getBillingSummary().balance}})()')
    assert.equal(data.balance,0)
    for(const key of ['payments','visitors','access','tickets','packages'])assert.equal(data[key].length,0)
  })
  await check('Resident account-menu sign out ends the backend session',async()=>{
    await viewport(1440)
    await b.click('.resident-account')
    await b.click('.resident-account-menu a[href="#/login"]')
    await wait('Boolean(document.querySelector("input[name=password]"))')
    assert.equal(await evaluate('(async()=> (await fetch("/api/account")).status)()'),401)
    await navigate('/resident/payments')
    await wait('location.hash === "#/login"')
    assert.equal(await evaluate('Boolean(document.querySelector(".resident-workspace"))'),false)
  })
  await b.finish({widths:[1440,390],database:'Disposable; no real email delivery'})
}catch(error){await screenshot('failure');throw error}finally{await b.close()}
