// Requires the disposable dev backend populated by check-onboarding-ui. Sends no email.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {PNG} from 'pngjs'
import {BinaryBitmap,HybridBinarizer,RGBLuminanceSource,QRCodeReader,DecodeHintType} from '@zxing/library'
import {browserChecks} from './browser-check-client.mjs'
const b=await browserChecks('visitor-qr')
const owner=process.env.UI_OWNER_EMAIL||'owner@onboarding.test',ownerPassword=process.env.DEV_OWNER_PASSWORD
assert.ok(ownerPassword,'Set disposable DEV_OWNER_PASSWORD')
const guardEmail='guard-'+Date.now()+'@example.test',guardPassword='Browser-guard-password42'
let resident,property,request,visit,token,sharedRoute,restartVisitId,restartPassHash,scheduledRequest,manualVisit
async function wait(expression){for(let i=0;i<150;i++){if(await b.evaluate(expression))return;await b.pause(100)}throw Error('Timed out waiting for a browser condition')}
async function text(value){await wait('document.body.innerText.includes('+JSON.stringify(value)+')')}
async function api(endpoint,body){
  return b.evaluate('(async()=>{const headers={};const body='+JSON.stringify(body)+';if(body!==undefined){const c=await(await fetch("/api/auth/csrf")).json();headers[c.headerName]=c.token;headers["Content-Type"]="application/json"}const r=await fetch("/api"+'+JSON.stringify(endpoint)+',{method:body===undefined?"GET":"POST",headers,body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();return {status:r.status,data:text?JSON.parse(text):null}})()')
}
async function button(label,scope=''){
  const selector=JSON.stringify(scope?scope+' button':'button')
  const condition='[...document.querySelectorAll('+selector+')].find(e=>e.textContent.trim()==='+JSON.stringify(label)+'&&!e.disabled)'
  await wait('Boolean('+condition+')')
  await b.evaluate('(()=>{const e='+condition+';e.focus();e.click()})()')
  await b.pause()
}
async function login(email,password){await b.navigate('/login');await api('/auth/logout',{});await b.reload();await wait('Boolean(document.querySelector("input[name=password]"))');await b.fill('input[name=email]',email);await b.fill('input[name=password]',password);await b.submit('form');await wait('Boolean(document.querySelector(".admin-heading,.resident-page-heading,.guard-shell"))')}
async function geometry(){await wait('[...document.images].every(i=>i.complete&&i.naturalWidth>0)');assert.equal(await b.evaluate('document.documentElement.scrollWidth>innerWidth+1'),false)}
async function records(isStaff=false){return (await api('/logbook/records'+(isStaff?'?property='+property:''))).data}
async function readQr(){
  await wait('Boolean(document.querySelector(".visitor-pass img"))')
  const encoded=await b.evaluate('document.querySelector(".visitor-pass img").src')
  const png=PNG.sync.read(Buffer.from(encoded.split(',')[1],'base64'))
  const luminance=new Uint8ClampedArray(png.width*png.height)
  for(let i=0;i<luminance.length;i++)luminance[i]=png.data[i*4]
  return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance,png.width,png.height))),new Map([[DecodeHintType.PURE_BARCODE,true]])).getText()
}
const futureDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now()+2*86400000)
const residentPassword='Browser-resident-password42'
try{
  await b.viewport(1440)
  await login(owner,ownerPassword)
  resident=(await api('/owner/admissions')).data.find(a=>a.tenancy_status==='ACTIVE'&&a.email.startsWith('resident-'));assert.ok(resident)
  property=(await api('/logbook/properties')).data[0].id
  await b.check('Resident can invite from the old direct route with just name and purpose',async()=>{
    await login(resident.email,residentPassword);await b.navigate('/resident/logbook/register');await text('Invite a guest')
    await b.fill('input[name=fullName]','QR Browser Visitor');await b.fill('input[name=purpose]','Family visit')
    assert.equal(await b.evaluate('document.querySelectorAll("dialog input[type=date], dialog input[type=datetime-local]").length'),0)
    await b.screenshot('1440-invite');await b.submit('dialog form');await text('QR Browser Visitor')
    const r=(await records()).find(r=>r.full_name==='QR Browser Visitor')
    assert.equal(r.display_status,'PENDING');assert.equal(r.visit_id,null);assert.equal(r.contact,'');assert.equal(r.arrival,null);request=r.id
  })
  await b.check('The optional date is accepted and an untimed request stays separate',async()=>{
    await b.viewport(390);await button('Invite a guest');await button('Planning for another day?','dialog')
    await b.fill('dialog input[name=fullName]','Planned Browser Guest');await b.fill('dialog input[name=contact]','09171234567');await b.fill('dialog input[name=purpose]','Scheduled visit');await b.fill('dialog input[name=plannedDate]',futureDate)
    await geometry();await b.screenshot('390-optional-date');await b.submit('dialog form');await text('Planned Browser Guest')
    const r=(await records()).find(r=>r.full_name==='Planned Browser Guest');assert.equal(r.planned_date,futureDate);assert.equal(r.departure,null);scheduledRequest=r.id
  })
  await b.check('Owner sees both decisions on the review card and a decline requires a reason',async()=>{
    await login(owner,ownerPassword);await b.navigate('/admin/logbook');await text('QR Browser Visitor')
    for(const width of [390,1440]){
      await b.viewport(width)
      if(width===390)await b.click('.visitor-queue')
      await text('Needs review');await geometry();await b.screenshot(width+'-owner-review')
    }
    await wait('document.querySelectorAll(".visitor-record").length===2')
    await b.click('.visitor-record button.admin-primary')
    await b.escape()
    await b.evaluate('[...document.querySelectorAll(".visitor-record")].find(r=>r.textContent.includes("Planned Browser Guest")).querySelectorAll("button")[1].click()')
    await text('Reason for declining');await b.submit('dialog form')
    assert.equal((await records(true)).find(r=>r.id===scheduledRequest).display_status,'PENDING')
    await b.fill('dialog textarea[name=reason]','Front desk is closed on the planned date.');await b.submit('dialog form');await text('Visit declined.')
    await button('Approve visit','.visitor-record');await button('Approve visit','dialog');await text('Visit approved.')
    const r=(await records(true)).find(r=>r.id===request)
    visit=r.visit_id;assert.equal(r.display_status,'EXPECTED');assert.equal(r.checked_in,null)
    assert.equal(Date.parse(r.departure)-Date.parse(r.arrival),86400000)
  })
  await b.check('Resident reopens the same QR and private link, then explicitly replaces both',async()=>{
    await login(resident.email,residentPassword);await b.navigate('/resident/logbook');await text('Front desk is closed on the planned date.')
    await button('Share pass');const firstQr=await readQr()
    const firstLink=await b.evaluate('document.querySelector("dialog input[readonly]").value')
    await b.screenshot('1440-resident-share');await b.escape();await b.reload();await text('Share pass');await button('Share pass')
    assert.ok(await readQr()===firstQr,'Reopening preserves the QR')
    assert.ok(await b.evaluate('document.querySelector("dialog input[readonly]").value')===firstLink,'Reopening preserves the link')
    await button('Replace pass','dialog');await button('Confirm replacement','dialog')
    await wait('document.querySelector("dialog input[readonly]")?.value!=='+JSON.stringify(firstLink))
    token=await readQr();assert.ok(token!==firstQr,'Replacement updates the QR')
    sharedRoute=new URL(await b.evaluate('document.querySelector("dialog input[readonly]").value')).hash.slice(1)
    await b.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('clipboard unavailable'))}})")
    await button('Copy link','dialog');await text('Link selected.')
    await b.evaluate("delete navigator.clipboard")
    assert.equal(await b.evaluate('document.activeElement.readOnly'),true)
    assert.equal(await b.evaluate('Object.values(sessionStorage).some(v=>v.includes("haruhay:visit:"))'),false)
    await api('/auth/logout',{})
    assert.equal((await api('/public/visitor-pass',{token:new URL(firstLink).hash.split('/').at(-1)})).status,410)
    assert.equal((await api('/logbook/records')).status,401)
  })
  await b.check('Guest pass opens without an account on desktop and phone and survives refresh',async()=>{
    for(const width of [1440,390]){
      await b.viewport(width);await b.navigate(sharedRoute);await text('Show this pass and your ID at the front desk.')
      assert.ok(await readQr()===token,'Guest displays the current QR');await geometry();await b.screenshot(width+'-guest-pass')
    }
    await b.reload();await text('Valid until');assert.ok(await readQr()===token,'Refresh preserves the guest QR')
    assert.equal((await api('/logbook/properties/'+property+'/scan',{token})).status,401)
  })
  await b.check('Real guard account opens the property logbook and cannot access other workspaces',async()=>{
    await login(owner,ownerPassword);await b.navigate('/admin/logbook');await text('QR Browser Visitor')
    await button('Manage guards');await wait('Boolean(document.querySelector("dialog input[name=name]"))');await b.fill('dialog input[name=name]','Browser Guard');await b.fill('dialog input[name=email]',guardEmail);await b.fill('dialog input[name=password]',guardPassword);await b.click('dialog input[name=canReview]');await b.submit('dialog form');await text(guardEmail);await b.escape();await wait('!document.querySelector("dialog[open]")')
    await login(guardEmail,guardPassword);await text('Front desk');assert.equal(await b.evaluate('location.hash'),'#/guard/logbook');assert.equal((await api('/owner/bills')).status,403);assert.equal((await api('/resident/bills')).status,403)
    await b.navigate('/admin/billing');await text('Front desk');assert.equal(await b.evaluate('location.hash'),'#/guard/logbook')
  })
  await b.check('Camera denial leads directly to guest search',async()=>{
    await button('Scan pass');await b.send('Browser.setPermission',{permission:{name:'camera'},setting:'denied',origin:b.origin})
    await button('Start camera','dialog');await text('Camera unavailable or permission denied');await b.screenshot('390-camera-fallback')
    await button('Find guest','dialog');await wait('document.activeElement.type==="search"')
    await b.fill('.visitor-toolbar input[type=search]','Not in the register');await text('No matching visits');await b.fill('.visitor-toolbar input[type=search]','')
  })
  await b.check('Pass lookup does not record movement and check-in requires confirmed ID',async()=>{
    await button('Scan pass');await b.fill('dialog textarea','school-id-barcode');await b.submit('dialog form');await text('Invalid or non-Haruhay pass')
    await b.fill('dialog textarea',token);await b.submit('dialog form');await text('PASS VERIFIED')
    assert.equal((await records(true)).find(r=>r.visit_id===visit).display_status,'EXPECTED')
    await b.fill('dialog input[name=idType]','School ID');await b.fill('dialog input[name=idLastFour]','1234');await b.submit('dialog form')
    assert.equal((await records(true)).find(r=>r.visit_id===visit).checked_in,null)
    await b.click('dialog input[name=identity]');await b.screenshot('390-guard-verification');await b.submit('dialog form');await text('Visitor checked in.')
  })
  for(const width of [1440,390])await b.check(width+'px guard layout, Who’s inside and keyboard dialog',async()=>{
    await b.viewport(width);await b.navigate('/guard/logbook');await text('QR Browser Visitor');await button('Who’s inside?')
    await wait('document.activeElement.id==="visitor-results-heading"');await geometry();await b.screenshot(width+'-guard-inside')
    await button('Verify checkout');await b.tab();assert.equal(await b.evaluate('Boolean(document.activeElement.closest("dialog"))'),true)
    await b.escape();await wait('!document.querySelector("dialog")');assert.equal(await b.evaluate('document.activeElement.textContent.trim()'),'Verify checkout')
  })
  await b.check('Manual checkout, retained audit and CSV without credentials',async()=>{
    await button('Verify checkout');await b.fill('dialog textarea[name=reason]','Visitor identified in open register and confirmed departure');await b.submit('dialog form');await text('Visitor checked out.')
    await b.fill('.visitor-toolbar select','CHECKED_OUT')
    await button('History');await text('ENTRY QR');await text('EXIT MANUAL');await b.screenshot('390-audit-history');await b.escape()
    await button('Export CSV');const csv=await b.download('visitor-logbook.csv');assert.match(csv,/QR Browser Visitor/);assert.match(csv,/Left/);assert.equal(csv.includes(token),false);assert.equal(csv.includes(sharedRoute.split('/').at(-1)),false)
    await button('Scan pass');await b.fill('dialog textarea',token);await b.submit('dialog form');await text('This pass is replaced, revoked or completed.');await b.escape()
  })
  await b.check('Walk-in requires host authorization and separate ID verification',async()=>{
    await button('Register walk-in');await b.fill('dialog input[name=fullName]','Browser Walk-in');await b.fill('dialog input[name=purpose]','Authorized delivery')
    await b.fill('dialog select[name=tenancyId]',(await api('/logbook/hosts?property='+property)).data.find(r=>r.full_name===resident.full_name).id)
    await b.click('dialog input[name=hostAuthorized]');await b.fill('dialog textarea[name=reason]','Host confirmed delivery by phone');await b.submit('dialog form');await text('Verify check-in')
    const walkin=(await records(true)).find(r=>r.full_name==='Browser Walk-in');assert.equal(walkin.display_status,'EXPECTED');assert.equal(walkin.checked_in,null)
    await b.fill('dialog input[name=idType]','Company ID');await b.click('dialog input[name=identity]');await b.fill('dialog textarea[name=reason]','Confirmed courier ID with active host');await b.submit('dialog form');await text('Visitor checked in.')
    await b.fill('.visitor-toolbar select','CHECKED_IN');await text('Browser Walk-in')
    assert.equal(await b.evaluate('[...document.querySelectorAll(".visitor-table tbody tr")].find(r=>r.textContent.includes("Browser Walk-in")).textContent.includes("Share pass")'),false)
  })
  await b.check('Invite again prefills guest details and creates a new request awaiting approval',async()=>{
    await login(resident.email,residentPassword);await b.viewport(1440);await b.navigate('/resident/logbook');await text('QR Browser Visitor')
    await b.evaluate('[...document.querySelectorAll(".visitor-record")].find(r=>r.textContent.includes("Planned Browser Guest")).querySelector("button").click()')
    assert.equal(await b.evaluate('document.querySelector("dialog [name=fullName]").value'),'Planned Browser Guest')
    assert.equal(await b.evaluate('document.querySelector("dialog [name=contact]").value'),'09171234567')
    assert.equal(await b.evaluate('document.querySelector("dialog [name=purpose]").value'),'Scheduled visit')
    assert.equal(await b.evaluate('document.querySelector("dialog [name=plannedDate]")'),null)
    await b.submit('dialog form');await text('Invitation submitted for approval.')
    assert.ok((await records()).some(r=>r.full_name==='Planned Browser Guest'&&r.id!==scheduledRequest&&r.display_status==='PENDING'&&!r.visit_id))
    await geometry();await b.screenshot('1440-resident-history');await b.viewport(390);await geometry();await b.screenshot('390-resident-history')
  })
  await b.check('Guard can approve in Needs review and check out an open visit after expiry without its QR',async()=>{
    const host=(await api('/logbook/hosts')).data.find(r=>r.property_id===property)
    const expires=Date.now()+16000
    const result=await api('/logbook/requests',{tenancyId:host.id,fullName:'Short Window Guest',purpose:'Verify old visit window',arrival:new Date(Date.now()-1000).toISOString(),departure:new Date(expires).toISOString()})
    assert.equal(result.status,200)
    await login(guardEmail,guardPassword);await b.navigate('/guard/logbook');await text('Short Window Guest');await b.click('.visitor-queue')
    await b.evaluate('[...document.querySelectorAll(".visitor-record")].find(r=>r.textContent.includes("Short Window Guest")).querySelector("button").click()')
    await button('Approve visit','dialog');await text('Visit approved.')
    manualVisit=(await records(true)).find(r=>r.id===result.data.id).visit_id
    assert.equal(Date.parse((await records(true)).find(r=>r.id===result.data.id).departure),expires)
    const entry=await api('/logbook/properties/'+property+'/visits/'+manualVisit+'/movement',{action:'ENTRY',method:'MANUAL',identityConfirmed:true,idType:'School ID',reason:'Identity verified at arrival'})
    assert.equal(entry.data.allowed,true)
    await b.pause(Math.max(0,expires-Date.now()+300))
    await b.fill('.visitor-toolbar select','CHECKED_IN')
    await button('Refresh');await text('Short Window Guest')
    await b.evaluate('[...document.querySelectorAll(".visitor-table tbody tr")].find(r=>r.textContent.includes("Short Window Guest")).querySelector(".admin-primary").click()')
    await b.fill('dialog textarea[name=reason]','Identified the guest in the open visit log.');await b.submit('dialog form');await text('Visitor checked out.')
    assert.ok(Date.parse((await records(true)).find(r=>r.visit_id===manualVisit).checked_out)>expires)
  })
  await b.check('A planned pass is ready before its entry window and can be used for restart checks',async()=>{
    await login(resident.email,residentPassword)
    const host=(await api('/logbook/hosts')).data.find(r=>r.property_id===property)
    const created=await api('/logbook/requests',{tenancyId:host.id,fullName:'Restart Guest',purpose:'Verify saved pass',plannedDate:futureDate})
    await login(owner,ownerPassword)
    const approval=await api('/logbook/requests/'+created.data.id+'/review',{action:'APPROVE'})
    const issued=await api('/logbook/visits/'+approval.data.visitId+'/pass',{replace:false})
    assert.equal(issued.status,200);assert.equal(new Date(issued.data.startsAt).toISOString().slice(11,16),'16:00')
    restartVisitId=approval.data.visitId
    restartPassHash=createHash('sha256').update(issued.data.shareToken).digest('hex')
    assert.equal((await api('/logbook/properties/'+property+'/scan',{token:issued.data.token})).data.allowed,false)
  })
  await b.check('Late visitor responses cannot leak across sign-out',async()=>{
    const result=await b.evaluate(`(async()=>{const m=await import('/src/visitorApi.ts'),w=await import('/src/workspaceSession.ts');const original=window.fetch;let release;window.fetch=(...args)=>String(args[0]).includes('/api/logbook/records')?new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify([{id:'stale-user-record'}]),{headers:{'Content-Type':'application/json'}}))}):original(...args);const pending=m.loadVisitorRecords();w.clearWorkspaceSession();release();const result=await pending;window.fetch=original;return {result,records:m.liveVisitorRecords()}})()`);assert.equal(result.result,null);assert.deepEqual(result.records,[])
  })
  await b.finish({widths:[1440,390],delivery:'No emails sent',camera:'Permission denied fallback verified; physical camera not available',visitId:visit,restartVisitId,restartPassHash})
}catch(e){await b.screenshot('failure').catch(()=>{});throw e}finally{await b.close()}
