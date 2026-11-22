// Isolated UI regression: no backend records and no real emails are created.
import assert from 'node:assert/strict'
import { browserChecks } from './browser-check-client.mjs'
const b = await browserChecks('signup-email')
try {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const realFetch=window.fetch.bind(window);
    window.fetch=async(input,init={})=>{
      const url=typeof input==='string'?input:input.url;
      const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
      if(url==='/api/account')return json({id:'test-owner',email:'owner@example.test',full_name:'Test Owner',contact:'',role:'OWNER',email_verified:true});
      if(['/api/owner/bills','/api/resident/bills','/api/owner/admissions','/api/owner/properties','/api/owner/rooms'].includes(url))return json([]);
      if(url==='/api/public/rooms?propertyId=test-property')return json([{id:'test-room',property_id:'test-property',property_name:'Test property',label:'Test room',capacity:1,room_type:'PRIVATE',terms_version:1,description:'',published:true,accepting_applications:true,pricing_basis:'PER_PERSON',monthly_rent:2500,applicant_monthly_quote:null,security_deposit:0,advance_months:1,inclusions:'',house_rules:'',charges:[],available:1}]);
      if(url==='/api/public/properties')return json([{id:'test-property',name:'Test property'}]);
      if(url==='/api/auth/csrf')return json({headerName:'X-CSRF-TOKEN',token:'test-csrf'});
      if(url==='/api/auth/logout'){window.didSignOut=true;return new Response(null,{status:204})}
      if(url==='/api/public/accounts/signup'){window.signupBody=JSON.parse(init.body);return json({delivery:'LOCAL_FILE'})}
      return realFetch(input,init);
    };
  ` })
  await b.navigate('/register'); await b.pause(250)
  await b.check('Signed-in identity stays protected and offers a different-account action', async () => {
    assert.equal(await b.evaluate('document.querySelector("input[name=email]").readOnly'), true)
    await b.contains('owner@example.test')
    await b.contains('Create account with another email')
  })
  await b.click('.form-notice button')
  await b.check('Switching account signs out and clears the old profile from signup', async () => {
    assert.equal(await b.evaluate('window.didSignOut'), true)
    assert.equal(await b.evaluate('document.querySelector("input[name=email]").readOnly'), false)
    assert.equal(await b.evaluate('[...document.querySelectorAll("form input")].every(i=>i.value==="")'), true)
    assert.equal(await b.evaluate('Boolean(document.querySelector("input[name=password]"))'), true)
  })
  await b.fill('input[name=fullName]','New Resident')
  await b.fill('input[name=contact]','09171234567')
  await b.fill('input[name=email]','different-resident@example.test')
  await b.fill('input[name=password]','New-resident-password42')
  await b.fill('select[name=propertyId]','test-property')
  await b.pause(250);await b.click('.room-card .admin-primary');await b.click('input[name=acceptedTerms]');await b.submit('form')
  await b.check('New-account signup submits the new email and password', async () => {
    const body=await b.evaluate('window.signupBody')
    assert.equal(body.email,'different-resident@example.test')
    assert.equal(body.fullName,'New Resident')
    assert.ok(body.password)
    await b.contains('Your application is on its way')
  })
  await b.finish({ delivery:'Mocked API only; no real email or database mutation' })
} finally { await b.close() }
