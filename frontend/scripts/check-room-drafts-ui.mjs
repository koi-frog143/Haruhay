// Isolated browser checks: mocked API, no real account mutations or email delivery.
import assert from 'node:assert/strict'
import { browserChecks } from './browser-check-client.mjs'
const b=await browserChecks('room-drafts')
async function wait(expression){for(let n=0;n<100;n++){if(await b.evaluate(expression))return;await b.pause(100)}throw Error('Timed out: '+expression)}
async function open(index=0){await wait('Boolean(document.querySelector(".room-card button"))');await b.click(`.room-card:nth-child(${index+1}) button`);await wait('Boolean(document.querySelector("dialog[open]"))');await b.pause(250)}
async function reload(){await b.send('Page.reload');await b.pause(350);await wait('Boolean(document.querySelector(".room-card button"))')}
const value=selector=>b.evaluate(`document.querySelector(${JSON.stringify('dialog '+selector)}).value`)
try{
  await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`
    const realFetch=window.fetch.bind(window);
    const room=id=>({id,property_id:'draft-property',property_name:'Draft property',label:id,capacity:1,room_type:'PRIVATE',terms_version:Number(sessionStorage.getItem('test-listing-version')||1),description:'Saved description',published:false,accepting_applications:false,pricing_basis:'PER_PERSON',monthly_rent:2500,applicant_monthly_quote:null,security_deposit:0,advance_months:1,inclusions:'Desk',house_rules:'Quiet hours',charges:[],available:1});
    window.fetch=async(url,init={})=>{const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
      if(url==='/api/account')return json({id:sessionStorage.getItem('test-owner')||'draft-owner',email:'draft@example.test',full_name:'Draft Owner',contact:'',role:'OWNER',email_verified:true});
      if(url==='/api/owner/bills'||url==='/api/resident/bills')return json([]);if(url==='/api/owner/admissions')return json([]);
      if(url==='/api/owner/properties')return json([{id:'draft-property',name:'Draft property'}]);
      if(url==='/api/owner/rooms')return json([room('room-one'),room('room-two')]);
      if(url==='/api/auth/csrf')return json({headerName:'X-CSRF-TOKEN',token:'draft-test'});
      if(url.startsWith('/api/owner/rooms/')&&url.endsWith('/details')){window.savedListing=JSON.parse(init.body);if(window.failSave)return json({message:'Test save failed'},409);return json(room('room-one'))}
      return realFetch(url,init);
    };`})
  await b.viewport(1440);await b.navigate('/admin/property');await open()
  await b.check('Outside click preserves editor and does not publish edits',async()=>{
    await b.fill('dialog input[name=label]','Unfinished room name');await b.fill('dialog textarea[name=description]','My unfinished details')
    await b.send('Input.dispatchMouseEvent',{type:'mousePressed',x:5,y:5,button:'left',clickCount:1});await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:5,y:5,button:'left',clickCount:1})
    assert.equal(await b.evaluate('Boolean(document.querySelector("dialog[open]"))'),true)
    assert.equal(await b.evaluate('Boolean(window.savedListing)'),false)
  })
  await b.check('Close and reopen restores text, numeric blanks, charges and checkboxes',async()=>{
    await b.fill('dialog input[name=monthlyRent]','');await b.click('input[name=published]')
    await b.evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="Add charge").click()');await b.pause()
    await b.fill('.room-charge-editor label:nth-of-type(1) input','Electricity')
    await b.fill('.room-charge-editor select','FIXED_MONTHLY');await b.fill('.room-charge-editor input[type=number]','275.50')
    await b.fill('.room-charge-editor label:last-of-type input','A fixed monthly fee')
    await b.click('button[aria-label="Close dialog"]');await open()
    assert.equal(await value('input[name=label]'),'Unfinished room name');assert.equal(await value('input[name=monthlyRent]'),'')
    assert.equal(await value('.room-charge-editor select'),'FIXED_MONTHLY');assert.equal(await value('.room-charge-editor input[type=number]'),'275.5')
    assert.equal(await b.evaluate('document.querySelector("input[name=published]").checked'),true)
    await b.contains('Restored your unfinished draft.')
  })
  await b.check('Draft survives Escape, navigation and refresh without leaking to another room',async()=>{
    await b.escape();await open(1);assert.equal(await value('input[name=label]'),'room-two');assert.equal(await b.evaluate('document.querySelectorAll(".room-charge-editor").length'),0);await b.escape()
    await b.navigate('/admin/dashboard');await b.navigate('/admin/property');await reload();await open()
    assert.equal(await value('textarea[name=description]'),'My unfinished details');assert.equal(await value('.room-charge-editor input[type=number]'),'275.5')
  })
  await b.check('A different signed-in account does not inherit the draft',async()=>{
    await b.escape();await b.evaluate('sessionStorage.setItem("test-owner","another-owner")');await reload();await open();assert.equal(await value('input[name=label]'),'room-one');await b.escape()
    await b.evaluate('sessionStorage.removeItem("test-owner")');await reload();await open();assert.equal(await value('input[name=label]'),'Unfinished room name')
  })
  await b.check('Storage failure keeps editor open instead of losing edits',async()=>{
    await b.evaluate('window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error("Storage unavailable")}')
    await b.click('button[aria-label="Close dialog"]');await b.contains('Could not keep your draft.')
    assert.equal(await b.evaluate('Boolean(document.querySelector("dialog[open]"))'),true)
    await b.evaluate('Storage.prototype.setItem=window.originalSetItem')
  })
  await b.check('Stale drafts cannot overwrite a newer saved listing',async()=>{
    await b.escape();await b.evaluate('sessionStorage.setItem("test-listing-version","2")');await reload();await open()
    await b.contains('This listing changed after your draft began.')
    assert.equal(await b.evaluate('document.querySelector("dialog .dialog-primary").disabled'),true)
    await b.evaluate('[...document.querySelectorAll("dialog button")].find(b=>b.textContent.startsWith("Discard draft")).click()');await b.pause()
    assert.equal(await value('input[name=label]'),'room-one');assert.equal(await b.evaluate('document.querySelectorAll(".room-charge-editor").length'),0)
  })
  await b.check('Failed publication retains the draft; successful save clears it',async()=>{
    await b.fill('dialog input[name=label]','Ready to publish');await b.evaluate('window.failSave=true');await b.submit('dialog form');await b.contains('Test save failed');await b.escape();await open();assert.equal(await value('input[name=label]'),'Ready to publish')
    await b.evaluate('window.failSave=false');await b.submit('dialog form');await wait('!document.querySelector("dialog[open]")')
    assert.equal(await b.evaluate('sessionStorage.getItem("haruhay-live-ui-v1:draft-owner:room-listing-draft:room-one")'),null)
    assert.equal(await b.evaluate('window.savedListing.label'),'Ready to publish')
  })
  await b.check('Narrow editor restores a draft with usable controls',async()=>{
    await b.viewport(390);await open();await b.fill('dialog textarea[name=houseRules]','Draft house rules');await b.escape();await open();assert.equal(await value('textarea[name=houseRules]'),'Draft house rules')
    assert.equal(await b.evaluate('document.querySelector("dialog").scrollWidth<=document.querySelector("dialog").clientWidth+1'),true)
    await b.screenshot('390-restored-draft');await b.evaluate('document.querySelector(".room-editor-actions").scrollIntoView({block:"end"})');await b.screenshot('390-editor-actions');await b.viewport(1440);await b.evaluate('document.querySelector(".room-editor-actions").scrollIntoView({block:"end"})');await b.screenshot('1440-editor-actions');await b.escape()
  })
  await b.finish({persistence:'Account and room scoped session drafts',api:'Mocked; no backend or email mutations'})
}catch(error){await b.screenshot('failure');throw error}finally{await b.close()}
