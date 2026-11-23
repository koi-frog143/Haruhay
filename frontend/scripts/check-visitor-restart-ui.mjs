// Run after check-visitor-qr-ui AND a real restart of its disposable backend with the same DB.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {browserChecks} from './browser-check-client.mjs'
const previous=JSON.parse(await readFile('.ui-verification/visitor-qr/results.json','utf8'))
const b=await browserChecks('visitor-restart')
async function wait(expression){for(let i=0;i<120;i++){if(await b.evaluate(expression))return;await b.pause(100)}throw Error('Timed out '+expression+' at '+await b.evaluate('location.hash')+' / '+await b.evaluate('document.body.innerText.slice(0,1500)'))}
async function get(path){return b.evaluate(`(async()=>{const r=await fetch('/api'+${JSON.stringify(path)});if(!r.ok)throw Error(r.status);return r.json()})()`)}
try{
  await b.viewport(1440);await b.navigate('/login');await b.evaluate("(async()=>{const c=await(await fetch('/api/auth/csrf')).json();await fetch('/api/auth/logout',{method:'POST',headers:{[c.headerName]:c.token}})})()");await b.send('Page.reload');await b.pause(350);await wait('Boolean(document.querySelector("input[name=password]"))');await b.fill('input[name=email]',process.env.UI_OWNER_EMAIL||'owner@onboarding.test');await b.fill('input[name=password]',process.env.DEV_OWNER_PASSWORD);await b.submit('form');await wait('Boolean(document.querySelector(".admin-heading"))')
  const property=(await get('/logbook/properties'))[0].id
  await b.check('Visit and movement audit survive a backend process restart',async()=>{
    const record=(await get('/logbook/records?property='+property)).find(r=>r.visit_id===previous.visitId);assert.ok(record);assert.equal(record.visit_status,'CHECKED_OUT');assert.ok(record.checked_in);assert.ok(record.checked_out)
    const events=await get('/logbook/properties/'+property+'/visits/'+record.visit_id+'/history');assert.ok(events.some(e=>e.event==='ENTRY_QR'));assert.ok(events.some(e=>e.event==='EXIT_MANUAL'))
    const activity=await get('/logbook/properties/'+property+'/activity');assert.ok(activity.some(e=>e.event==='SCAN_DENIED'))
  })
  await b.check('Direct route, refresh and Back/Forward retain access to saved records',async()=>{
    await b.navigate('/admin/logbook');await wait('document.body.innerText.includes("QR Browser Visitor")');await b.send('Page.reload');await b.pause(350);await wait('document.body.innerText.includes("QR Browser Visitor")');await b.route('/admin/dashboard');await wait('Boolean(document.querySelector(".admin-heading"))');await b.evaluate('history.back()');await wait('location.hash==="#/admin/logbook"&&document.body.innerText.includes("QR Browser Visitor")');await b.evaluate('history.forward()');await wait('location.hash==="#/admin/dashboard"');await b.navigate('/admin/logbook');await wait('document.body.innerText.includes("QR Browser Visitor")');await b.screenshot('1440-after-restart')
  })
  await b.check('Existing resident-specific logbook links filter the correct hosted records',async()=>{
    const records=await get('/logbook/records?property='+property),record=records.find(r=>r.visit_id===previous.visitId);assert.ok(record.host_application_id);await b.navigate('/admin/logbook?resident='+record.host_application_id);await wait('document.body.innerText.includes("Showing this resident")');await wait('document.querySelectorAll(".visitor-table tbody tr").length>0');assert.equal(await b.evaluate('document.querySelectorAll(".visitor-table tbody tr").length'),records.filter(r=>r.host_application_id===record.host_application_id).length)
  })
  await b.check('Late property responses cannot repopulate a different property logbook',async()=>{
    const second=await b.evaluate("(async()=>{const c=await(await fetch('/api/auth/csrf')).json();return (await fetch('/api/owner/properties',{method:'POST',headers:{[c.headerName]:c.token,'Content-Type':'application/json'},body:JSON.stringify({name:'Visitor scope test '+Date.now()})})).json()})()");assert.ok(second.id);await b.navigate('/admin/logbook');await wait('document.body.innerText.includes("QR Browser Visitor")');await b.evaluate("window.originalVisitorFetch=window.fetch;window.fetch=(url,options)=>String(url).includes('/logbook/records?property=')?new Promise(resolve=>{const response=window.originalVisitorFetch(url,options);window.releasePropertyResponse=async()=>resolve(await response)}):window.originalVisitorFetch(url,options)");await b.evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent==='Refresh').click()");await wait('Boolean(window.releasePropertyResponse)');await b.evaluate('window.fetch=window.originalVisitorFetch');await b.fill('select[aria-label="Logbook property"]',second.id);await wait('document.body.innerText.includes("No visitor records yet")');await b.evaluate('window.releasePropertyResponse()');await b.pause(400);assert.equal(await b.evaluate('document.body.innerText.includes("QR Browser Visitor")'),false);assert.equal(await b.evaluate("document.querySelector('select[aria-label]').value"),second.id)
  })
  await b.finish({backendRestart:'Existing file-backed disposable H2 database reopened',visitId:previous.visitId})
}finally{await b.close()}
