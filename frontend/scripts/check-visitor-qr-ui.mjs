// Requires the disposable dev backend populated by check-onboarding-ui. Sends no email.
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {BinaryBitmap,HybridBinarizer,RGBLuminanceSource,QRCodeReader,DecodeHintType} from '@zxing/library'
import {browserChecks} from './browser-check-client.mjs'
const b=await browserChecks('visitor-qr')
const owner=process.env.UI_OWNER_EMAIL||'owner@onboarding.test',ownerPassword=process.env.DEV_OWNER_PASSWORD
assert.ok(ownerPassword,'Set disposable DEV_OWNER_PASSWORD')
const guardEmail='guard-'+Date.now()+'@example.test',guardPassword='Browser-guard-password42'
let resident,property,request,visit,token
async function wait(expression){for(let i=0;i<150;i++){if(await b.evaluate(expression))return;await b.pause(100)}throw Error('Timed out '+expression+'\n'+await b.evaluate('document.body.innerText'))}
async function text(value){await wait('document.body.innerText.includes('+JSON.stringify(value)+')')}
async function api(endpoint,body){return b.evaluate(`(async()=>{const headers={};const body=${JSON.stringify(body)};if(body!==undefined){const c=await(await fetch('/api/auth/csrf')).json();headers[c.headerName]=c.token;headers['Content-Type']='application/json'}const r=await fetch('/api'+${JSON.stringify(endpoint)},{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();return {status:r.status,data:text?JSON.parse(text):null}})()`)}
async function button(label){await wait(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled)`);await b.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});e.focus();e.click()})()`);await b.pause()}
async function login(email,password){await b.navigate('/login');await api('/auth/logout',{});await b.send('Page.reload');await wait('Boolean(document.querySelector("input[name=password]"))');await b.fill('input[name=email]',email);await b.fill('input[name=password]',password);await b.submit('form');await wait('Boolean(document.querySelector(".admin-heading,.resident-page-heading,.guard-shell"))')}
async function geometry(){await b.pause(300);assert.equal(await b.evaluate('document.documentElement.scrollWidth>innerWidth+1'),false);assert.equal(await b.evaluate('[...document.images].every(i=>i.complete&&i.naturalWidth>0)'),true)}
const inputDate=d=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d).replace(' ','T')
try{
  await b.viewport(1440)
  await login(owner,ownerPassword)
  resident=(await api('/owner/admissions')).data.find(a=>a.status==='APPROVED'&&a.email.startsWith('resident-'));assert.ok(resident)
  property=(await api('/owner/properties')).data[0].id
  await b.check('Resident request stays pending and creates no visit',async()=>{
    await login(resident.email,'Browser-resident-password42');await b.navigate('/resident/logbook/register');await text('Register a visitor')
    await b.fill('input[name=fullName]','QR Browser Visitor');await b.fill('input[name=contact]','09171234567');await b.fill('input[name=purpose]','Family visit')
    await b.fill('input[name=arrival]',inputDate(new Date(Date.now()-60000)));await b.fill('input[name=departure]',inputDate(new Date(Date.now()+3600000)));await b.submit('dialog form');await text('QR Browser Visitor')
    const r=(await api('/logbook/records')).data.find(r=>r.full_name==='QR Browser Visitor');assert.equal(r.status,'PENDING');assert.equal(r.visit_id,null);request=r.id
    await b.screenshot('1440-resident-pending')
  })
  await b.check('Owner reviews and approves without checking in',async()=>{
    await login(owner,ownerPassword);await b.navigate('/admin/logbook');await text('QR Browser Visitor');await button('Review request');await b.submit('dialog form');await text('Visitor pass')
    const r=(await api('/logbook/records?property='+property)).data.find(r=>r.id===request);visit=r.visit_id;assert.equal(r.visit_status,'EXPECTED');assert.equal(r.checked_in,null)
    await b.screenshot('1440-owner-expected')
  })
  await b.check('Resident generates QR and explicitly replaces it after refresh',async()=>{
    await login(resident.email,'Browser-resident-password42');await b.navigate('/resident/logbook');await text('Visitor pass');await button('Visitor pass');await button('Generate visitor pass');await wait('Boolean(document.querySelector(".visitor-pass img"))');token=await b.evaluate('document.querySelector(".visitor-pass code").textContent');assert.match(token,/^haruhay:visit:/)
    const encoded=await b.evaluate('document.querySelector(".visitor-pass img").src');const png=PNG.sync.read(Buffer.from(encoded.split(',')[1],'base64'));const luminance=new Uint8ClampedArray(png.width*png.height);for(let i=0;i<luminance.length;i++)luminance[i]=png.data[i*4];const decoded=new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance,png.width,png.height))),new Map([[DecodeHintType.PURE_BARCODE,true]])).getText();assert.equal(decoded,token);await b.screenshot('1440-qr-pass');await b.escape();await b.send('Page.reload');await text('Visitor pass');await button('Visitor pass');await button('Generate visitor pass');await text('A pass was already issued');await b.click('dialog input[type=checkbox]');await button('Replace visitor pass');await wait('Boolean(document.querySelector(".visitor-pass code"))');const previous=token;token=await b.evaluate('document.querySelector(".visitor-pass code").textContent');assert.notEqual(token,previous);await b.escape()
    assert.equal(await b.evaluate('Object.values(sessionStorage).some(v=>v.includes("haruhay:visit:"))'),false)
  })
  await b.check('Real guard account has only property logbook access',async()=>{
    await login(owner,ownerPassword);await b.navigate('/admin/logbook');await text('QR Browser Visitor');await button('Manage guards');await b.fill('dialog input[name=fullName]','Browser Guard');await b.fill('dialog input[name=email]',guardEmail);await b.fill('dialog input[name=password]',guardPassword);await b.click('dialog input[name=canReview]');await b.submit('dialog form');await text(guardEmail);await b.escape()
    await login(guardEmail,guardPassword);await text('Haruhay · Front desk');assert.equal(await b.evaluate('location.hash'),'#/guard/logbook');assert.equal((await api('/owner/bills')).status,403);assert.equal((await api('/resident/bills')).status,403)
    await b.navigate('/admin/billing');await text('Haruhay · Front desk');assert.equal(await b.evaluate('location.hash'),'#/guard/logbook')
  })
  await b.check('Camera failure has manual fallback and invalid scan is clear',async()=>{
    await button('Scan QR');await b.send('Browser.setPermission',{permission:{name:'camera'},setting:'denied',origin:b.origin});await button('Start camera');await text('Camera unavailable or permission denied');await b.fill('dialog textarea','school-id-barcode');await b.submit('dialog form');await text('Invalid or non-Haruhay pass');await b.screenshot('1440-camera-fallback');await b.escape()
  })
  await b.check('QR validation shows identity card without automatically recording entry',async()=>{
    await button('Scan QR');await b.fill('dialog textarea',token);await b.submit('dialog form');await text('QR VALIDATED');assert.equal((await api('/logbook/records?property='+property)).data.find(r=>r.visit_id===visit).visit_status,'EXPECTED')
    await b.fill('dialog input[name=idType]','School ID');await b.fill('dialog input[name=idLastFour]','1234');await b.click('dialog input[name=identity]');await b.screenshot('1440-guard-verification');await b.submit('dialog form');await text('Visitor checked in.');assert.equal((await api('/logbook/records?property='+property)).data.find(r=>r.visit_id===visit).visit_status,'CHECKED_IN')
  })
  for(const width of [1440,390])await b.check(width+'px guard logbook geometry, keyboard dialog and manual checkout',async()=>{
    await b.viewport(width);await b.navigate('/guard/logbook');await text('QR Browser Visitor');await geometry();await b.screenshot(width+'-guard-inside');await button('Check out');await b.tab();assert.equal(await b.evaluate('Boolean(document.activeElement.closest("dialog"))'),true);await b.escape();await wait('!document.querySelector("dialog")');assert.equal(await b.evaluate('document.activeElement.textContent.trim()'),'Check out')
  })
  await b.check('Explicit manual checkout, history and no re-entry',async()=>{
    await button('Check out');await b.fill('dialog textarea[name=reason]','Visitor identified in open register and confirmed departure');await b.submit('dialog form');await text('Visitor checked out.');await button('History');await text('ENTRY QR');await text('EXIT MANUAL');await b.screenshot('390-audit-history');await b.escape();await button('Scan QR');await b.fill('dialog textarea',token);await b.submit('dialog form');await text('This pass is replaced, revoked or completed.');await b.escape()
  })
  await b.check('CSV export includes movement times and excludes credentials',async()=>{
    await button('Export CSV');const csv=await b.download('visitor-logbook.csv');assert.match(csv,/QR Browser Visitor/);assert.match(csv,/Checked out/);assert.equal(csv.includes(token),false)
  })
  await b.check('Search, status filters and server failure preserve visit state',async()=>{
    await b.fill('.visitor-toolbar input[type=search]','No such visitor');await text('No matching visits');await b.fill('.visitor-toolbar input[type=search]','');await b.fill('.visitor-toolbar select','CHECKED_OUT');await text('QR Browser Visitor');await b.fill('.visitor-toolbar select','');
    await button('Scan QR');await b.fill('dialog textarea',token);await b.evaluate("window.visitorRealFetch=window.fetch;window.fetch=(url,options)=>String(url).includes('/scan')?Promise.resolve(new Response(JSON.stringify({message:'Temporary test outage. Try again.'}),{status:503,headers:{'Content-Type':'application/json'}})):window.visitorRealFetch(url,options)");await b.submit('dialog form');await text('Temporary test outage');await b.evaluate('window.fetch=window.visitorRealFetch;delete window.visitorRealFetch');await b.escape();assert.equal((await api('/logbook/records?property='+property)).data.find(r=>r.visit_id===visit).visit_status,'CHECKED_OUT')
  })
  await b.check('Walk-in authorization requires a separate identity check and explicit entry',async()=>{
    await button('Register walk-in');await b.fill('dialog input[name=fullName]','Browser Walk-in');await b.fill('dialog input[name=contact]','09171234567');await b.fill('dialog input[name=purpose]','Authorized delivery');await b.fill('dialog input[name=arrival]',inputDate(new Date(Date.now()-60000)));await b.fill('dialog input[name=departure]',inputDate(new Date(Date.now()+3600000)));await b.fill('dialog select[name=tenancyId]',(await api('/logbook/hosts?property='+property)).data[0].id);await b.click('dialog input[name=hostAuthorized]');await b.fill('dialog textarea[name=reason]','Host confirmed delivery by phone');await b.submit('dialog form');await text('Verify visitor arrival');const walkin=(await api('/logbook/records?property='+property)).data.find(r=>r.full_name==='Browser Walk-in');assert.equal(walkin.visit_status,'EXPECTED');await b.fill('dialog input[name=idType]','Company ID');await b.click('dialog input[name=identity]');await b.fill('dialog textarea[name=reason]','Confirmed courier ID with active host');await b.submit('dialog form');await text('Visitor checked in.');await button('Check out');await b.fill('dialog textarea[name=reason]','Courier departure confirmed at desk');await b.submit('dialog form');await text('Visitor checked out.')
  })
  await b.check('Resident history persists on refresh; counts derive from visits',async()=>{
    await login(resident.email,'Browser-resident-password42');await b.viewport(1440);await b.navigate('/resident/logbook');await text('Checked out');await b.send('Page.reload');await text('QR Browser Visitor');await geometry();await b.screenshot('1440-resident-completed');await b.viewport(390);await geometry();await b.screenshot('390-resident-completed');await b.navigate('/resident/dashboard');await text('Explore Haruhay');assert.ok((await api('/logbook/records')).data.some(r=>r.visit_id===visit&&r.visit_status==='CHECKED_OUT'))
  })
  await b.check('Late visitor responses cannot leak across sign-out',async()=>{
    const result=await b.evaluate(`(async()=>{const m=await import('/src/visitorApi.ts'),w=await import('/src/workspaceSession.ts');const original=window.fetch;let release;window.fetch=(...args)=>String(args[0]).includes('/api/logbook/records')?new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify([{id:'stale-user-record'}]),{headers:{'Content-Type':'application/json'}}))}):original(...args);const pending=m.loadVisitorRecords();w.clearWorkspaceSession();release();const result=await pending;window.fetch=original;return {result,records:m.liveVisitorRecords()}})()`);assert.equal(result.result,null);assert.deepEqual(result.records,[])
  })
  await b.finish({widths:[1440,390],delivery:'No emails sent',camera:'Permission denied fallback verified; physical camera not available',visitId:visit})
}catch(e){await b.screenshot('failure').catch(()=>{});throw e}finally{await b.close()}
