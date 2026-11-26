// Isolated API fixtures: regression coverage for account-bound cache and live release form.
import assert from 'node:assert/strict'
import { browserChecks } from './browser-check-client.mjs'
const b=await browserChecks('holding-fixes')
async function evaluate(source){return b.evaluate(source)}
async function wait(source){for(let n=0;n<100;n++){if(await evaluate(source))return;await b.pause(100)}throw Error('Timed out: '+source)}
async function identity(id){await evaluate(`window.testIdentity=${JSON.stringify(id)};window.testRevision='new';`);await evaluate('(async()=>{const m=await import("/src/workspaceSession.ts");await m.loadWorkspaceSession()})()')}
const getState=()=>evaluate('(async()=> (await import("/src/holdingData.ts")).getHoldingState())()')
const fetchState=()=>evaluate('(async()=> (await import("/src/holdingData.ts")).fetchHoldingState())()')
try{
  await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.testIdentity='a';window.testRevision='new';window.delayHolding=false;window.itemClaimed=false;
    const realFetch=window.fetch.bind(window),json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
    window.fetch=async(url,init={})=>{
      const id=window.testIdentity,owner=id==='owner';
      const account={id,email:id+'@example.test',full_name:owner?'Test Owner':'Resident '+id,contact:'09171234567',role:owner?'OWNER':'APPLICANT',email_verified:true};
      const app={id:'app-a',email:account.email,full_name:account.full_name,contact:account.contact,status:'APPROVED',tenancy_id:'stay-a',tenancy_status:'ACTIVE',property_id:'property',property_name:'Test property',room_label:'Test room',email_verified:true};
      const row={id:1,code:'HS-0001',residentId:owner?'app-a':'resident-'+id,propertyId:'property',residentName:'Resident '+id,room:'Test room',category:'Parcel',description:'Private parcel '+id+' '+window.testRevision,sender:'Courier',depositor:'Courier / sender',tracking:'TRACK',slot:'A-1',received:'Nov 23, 2026',pin:owner||window.itemClaimed?null:id==='a'?'123456':'987654',status:window.itemClaimed?'Claimed':'Ready',history:[]};
      if(url==='/api/account')return id?json(account):json({message:'Sign in'},401);
      if(url==='/api/auth/logout'){window.testIdentity=null;return new Response(null,{status:204})}
      if(url==='/api/auth/csrf')return json({headerName:'X-CSRF-TOKEN',token:'test'});
      if(['/api/account/admissions','/api/owner/admissions'].includes(url))return json([app]);
      if(url==='/api/owner/properties')return json([{id:'property',name:'Test property'}]);
      if(url==='/api/public/properties'||url==='/api/owner/rooms'||url==='/api/owner/bills'||url==='/api/resident/bills'||url==='/api/owner/holding-inquiries')return json([]);
      if(url==='/api/resident/holding-items'||url==='/api/owner/holding-items'){
        if(window.delayHolding)return new Promise((resolve,reject)=>{window.finishHolding=()=>resolve(json([row]));window.failHolding=()=>reject(Error('Old request failed'))});
        return json([row]);
      }
      if(url==='/api/owner/holding-items/1/release'){
        window.releaseBody=JSON.parse(init.body);
        if(!window.releaseBody.idType||!window.releaseBody.verifiedId||!window.releaseBody.signed)return json({message:'Release validation failed'},400);
        window.itemClaimed=true;return json({...row,status:'Claimed'});
      }
      return realFetch(url,init);
    };`})
  await b.navigate('/preview/login')
  await b.check('Account change immediately clears cached records and pickup codes',async()=>{
    await identity('a');await fetchState();assert.equal((await getState()).items[0].pin,'123456')
    await identity('b');assert.deepEqual((await getState()).items,[])
    await fetchState();assert.equal((await getState()).items[0].description,'Private parcel b new')
  })
  await b.check('Late response from the previous resident cannot replace the current cache',async()=>{
    await identity('a');await evaluate('window.testRevision="old";window.delayHolding=true;window.pendingHolding=import("/src/holdingData.ts").then(m=>m.fetchHoldingState());true');await wait('Boolean(window.finishHolding)')
    await identity('b');await evaluate('window.delayHolding=false');await fetchState();await evaluate('window.finishHolding();window.pendingHolding')
    assert.equal((await getState()).items[0].description,'Private parcel b new');assert.equal((await getState()).items[0].pin,'987654')
  })
  await b.check('Logout and login to the same account invalidate earlier requests',async()=>{
    await identity('a');await evaluate('window.finishHolding=null;window.testRevision="old";window.delayHolding=true;window.pendingHolding=import("/src/holdingData.ts").then(m=>m.fetchHoldingState());true');await wait('Boolean(window.finishHolding)')
    await evaluate('(async()=>{const m=await import("/src/workspaceSession.ts");m.clearWorkspaceSession()})()');assert.deepEqual((await getState()).items,[])
    await identity('a');await evaluate('window.delayHolding=false');await fetchState();await evaluate('window.finishHolding();window.pendingHolding');assert.equal((await getState()).items[0].description,'Private parcel a new')
  })
  await b.check('Errors from an old account do not surface as the current account failure',async()=>{
    await evaluate('window.failHolding=null;window.delayHolding=true;window.pendingHolding=import("/src/holdingData.ts").then(m=>m.fetchHoldingState());true');await wait('Boolean(window.failHolding)')
    await identity('b');await evaluate('window.delayHolding=false');await fetchState();await evaluate('window.failHolding();window.pendingHolding');assert.equal((await getState()).items[0].description,'Private parcel b new')
  })
  await b.check('Different-account signup action clears session and parcel cache without reloading',async()=>{
    await identity('a');await fetchState();await b.navigate('/register');await wait('Boolean(document.querySelector(".form-notice button"))');await b.click('.form-notice button')
    assert.equal(await evaluate('(async()=>(await import("/src/workspaceSession.ts")).getWorkspaceSession())()'),null)
    assert.deepEqual((await getState()).items,[])
  })
  await identity('owner');await b.navigate('/admin/holding-station');await wait('document.body.innerText.includes("Private parcel owner new")')
  await b.check('Release form captures ID type at desktop and narrow widths',async()=>{
    await b.evaluate('[...document.querySelectorAll(".hs-actions button")].find(b=>b.textContent==="Release").click()');await wait('Boolean(document.querySelector("dialog[open] select[name=idType]"))')
    assert.equal(await evaluate('document.querySelector("dialog[open] select[name=idType]").required'),true)
    for(const width of [1440,390]){await b.viewport(width);assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+1'),false);await b.screenshot(width+'-release-id-type')}
  })
  await b.check('Completed release submits the selected ID type and updates the record',async()=>{
    await b.fill('dialog[open] select[name=idType]','National ID');await b.fill('dialog[open] input[name=idLastFour]','AB12');await b.click('dialog[open] input[name=verifiedId]');await b.click('dialog[open] input[name=signed]');await b.submit('dialog[open] form');await wait('!document.querySelector("dialog[open]")')
    assert.equal(await evaluate('window.releaseBody.idType'),'National ID');assert.equal(await evaluate('window.releaseBody.idLastFour'),'AB12');await b.contains('Item released and transaction recorded.')
  })
  await b.finish({api:'Mocked only; no real email or record changes'})
}catch(error){await b.screenshot('failure');throw error}finally{await b.close()}
