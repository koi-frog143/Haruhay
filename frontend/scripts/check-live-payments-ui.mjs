// Run against the disposable owner and resident created by check-onboarding-ui.
import assert from 'node:assert/strict'
import { browserChecks } from './browser-check-client.mjs'

const b = await browserChecks('live-payments')
const owner = process.env.UI_OWNER_EMAIL || 'owner@onboarding.test'
const password = process.env.DEV_OWNER_PASSWORD
assert.ok(password, 'Set the disposable owner test password.')
const stamp = Date.now()
const period = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit' }).format()
const firstRef = 'Proof-' + stamp, declinedRef = 'Check-' + stamp, correctedRef = 'Corrected-' + stamp
let resident, bill, initial, second, corrected, receiptNumber

async function wait(expression) {
  for (let attempt = 0; attempt < 140; attempt++) {
    if (await b.evaluate(expression)) return
    await b.pause(100)
  }
  throw new Error('Timed out waiting for ' + expression + '\n' + (await b.evaluate('document.body.innerText')).slice(-1400))
}
const text = value => wait('document.body.innerText.includes(' + JSON.stringify(value) + ')')
async function api(path, body) {
  return b.evaluate('(async()=>{const data='+JSON.stringify(body)+';const headers={};if(data!==undefined){const c=await(await fetch("/api/auth/csrf")).json();headers[c.headerName]=c.token;headers["Content-Type"]="application/json"}const response=await fetch("/api"+'+JSON.stringify(path)+',{method:data===undefined?"GET":"POST",headers,body:data===undefined?undefined:JSON.stringify(data)});return {status:response.status,data:response.headers.get("content-type")?.includes("application/json")?await response.json():null}})()')
}
async function button(label, scope = '') {
  const selector = JSON.stringify(scope ? scope + ' button' : 'button')
  const condition = '[...document.querySelectorAll('+selector+')].find(e=>e.textContent.trim()==='+JSON.stringify(label)+'&&!e.disabled)'
  await wait('Boolean('+condition+')')
  await b.evaluate('(()=>{const e='+condition+';e.focus();e.click()})()')
  await b.pause()
}
async function login(email, secret) {
  await b.navigate('/login')
  await api('/auth/logout', {})
  await b.navigate('/login')
  await b.send('Page.reload')
  await b.pause(350)
  await wait('Boolean(document.querySelector("input[name=email]")) && Boolean(document.querySelector("input[name=password]"))')
  await b.fill('input[name=email]',email)
  await b.fill('input[name=password]',secret)
  await b.submit('form[aria-label="Sign in to your account"]')
  await wait('!location.hash.endsWith("/login") && Boolean(document.querySelector(".admin-heading,.resident-page-heading"))')
}
const signInResident = () => login(resident.email,'Browser-resident-password42')
async function geometry() {
  await wait('[...document.images].every(image=>image.complete&&image.naturalWidth>0)')
  assert.equal(await b.evaluate('document.documentElement.scrollWidth>innerWidth+1'),false)
  assert.equal(await b.evaluate('!document.querySelector("dialog") || document.querySelector("dialog").scrollWidth<=document.querySelector("dialog").clientWidth+2'),true)
}
async function chooseProof() {
  await b.evaluate('(async()=>{const canvas=document.createElement("canvas");canvas.width=40;canvas.height=40;const ctx=canvas.getContext("2d");ctx.fillStyle="#28678a";ctx.fillRect(0,0,40,40);const file=new File([await new Promise(resolve=>canvas.toBlob(resolve,"image/png"))],"payment-proof.png",{type:"image/png"});const transfer=new DataTransfer();transfer.items.add(file);const input=document.querySelector("dialog input[type=file]");input.files=transfer.files;input.dispatchEvent(new Event("change",{bubbles:true}))})()')
}
async function residentBill() {
  return (await api('/resident/bills')).data.find(record=>record.id===bill.id)
}
async function residentPayment(reference) {
  return (await api('/resident/payments')).data.find(record=>record.reference===reference)
}
async function enterReport(amount, reference) {
  await b.fill('dialog input[name=amount]',String(amount))
  await b.fill('dialog select[name=method]','GCASH')
  await b.fill('dialog input[name=reference]',reference)
}
async function showReview(reference, filter) {
  await b.navigate('/admin/payments/approvals')
  await text('Payment approvals')
  if (filter) await button(filter)
  await b.fill('.payment-queue-toolbar input',reference)
  await button(filter ? 'View details' : 'Review payment')
  await text(reference)
}

try {
  await b.viewport(1440)
  await login(owner,password)
  resident=(await api('/owner/admissions')).data.find(row=>row.status==='APPROVED'&&row.email.startsWith('resident-'))
  assert.ok(resident)
  await b.check('Owner posts an agreement-based bill',async()=>{
    await b.navigate('/admin/billing');await button('Post monthly bill')
    await b.fill('dialog select',resident.id)
    await b.fill('dialog input[name=period]',period)
    await b.fill('dialog input[name=dueDate]',period+'-15')
    await button('Post bill','dialog')
    await text('Monthly bill is posted')
    bill=(await api('/owner/bills')).data.find(record=>record.application_id===resident.id&&record.period===period)
    assert.ok(bill.total>1000);assert.equal(bill.total,bill.balance)
  })
  await b.check('Resident report survives a failed request and supports private proof',async()=>{
    await signInResident()
    await b.navigate('/resident/payments')
    await text('Posted bills')
    for (const width of [1440,390]) {
      await b.viewport(width);await geometry();await b.screenshot(width+'-posted-bills')
    }
    await button('Report a payment')
    assert.equal(Number(await b.evaluate('document.querySelector("dialog input[name=amount]").value')),bill.balance)
    await enterReport(1000,firstRef);await chooseProof()
    await geometry();await b.screenshot('390-report-payment')
    await b.evaluate('window.paymentRealFetch=window.fetch;window.fetch=(url,options)=>String(url)==="/api/resident/payments"&&options?.method==="POST"?Promise.resolve(new Response(JSON.stringify({message:"Temporary save failure"}),{status:503,headers:{"Content-Type":"application/json"}})):window.paymentRealFetch(url,options)')
    await button('Submit payment report','dialog')
    await text('Temporary save failure')
    assert.equal(await b.evaluate('document.querySelector("dialog input[name=reference]").value'),firstRef)
    await b.evaluate('window.fetch=window.paymentRealFetch;delete window.paymentRealFetch')
    await button('Submit payment report','dialog')
    await text('Waiting for verification')
    await wait('Boolean(document.querySelector(\'dialog button[aria-label="Close dialog"]:not([disabled])\'))')
    initial=await residentPayment(firstRef)
    assert.equal(initial.status,'PENDING');assert.equal(initial.has_proof,true)
    assert.equal((await residentBill()).balance,bill.total)
    assert.equal((await api('/resident/payments/'+initial.id+'/proof')).status,200)
  })
  await b.check('Owner reviews with the keyboard, confirms verification, and credits a partial payment',async()=>{
    await login(owner,password)
    await showReview(firstRef)
    await text('Open private proof')
    await button('Approve payment','dialog')
    await text('Confirm you checked')
    await b.click('dialog input[type=checkbox]')
    await b.tab()
    assert.ok(await b.evaluate('Boolean(document.activeElement.closest("dialog"))'))
    for (const width of [390,1440]) {
      await b.viewport(width);await geometry();await b.screenshot(width+'-owner-review')
    }
    await button('Approve payment','dialog')
    await text('Payment verified')
    const approval=(await api('/owner/payments/'+initial.id)).data
    assert.equal(approval.status,'APPROVED');assert.equal(approval.balance,bill.total-1000)
    receiptNumber=approval.receipt_number
    assert.ok(receiptNumber)
  })
  await b.check('Resident opens a direct receipt, refreshes it and renders a printable acknowledgment',async()=>{
    await signInResident()
    await b.navigate('/resident/payments')
    await text('Partially paid')
    assert.equal((await residentBill()).balance,bill.total-1000)
    await b.navigate('/resident/payments/history')
    await b.click('a[href^="#/resident/payments/receipt/"]')
    await text('Payment acknowledgment')
    await b.send('Page.reload');await b.pause(350);await text('Verified at')
    for (const width of [1440,390]) {
      await b.viewport(width);await geometry();await b.screenshot(width+'-payment-receipt')
    }
    await b.evaluate('window.print=()=>{window.receiptPrintRequested=true}')
    await button('Print receipt')
    assert.equal(await b.evaluate('window.receiptPrintRequested'),true)
    const pdf=await b.send('Page.printToPDF',{printBackground:true})
    assert.equal(Buffer.from(pdf.data,'base64').subarray(0,4).toString(),'%PDF')
    await b.evaluate('history.back()')
    await wait('location.hash==="#/resident/payments/history"')
    await text('Approved')
    await b.evaluate('history.forward()')
    await text('Payment acknowledgment')
  })
  await b.check('Owner declines with a reason and the resident submits a linked correction',async()=>{
    await b.navigate('/resident/payments')
    await button('Report a payment')
    await enterReport(bill.total-1000,declinedRef)
    await button('Submit payment report','dialog');await text('Waiting for verification')
    second=await residentPayment(declinedRef)
    await login(owner,password)
    await showReview(declinedRef)
    await button('Decline payment','dialog');await text('Enter a reason')
    await b.fill('dialog textarea','Please correct the reference.')
    await button('Decline payment','dialog');await text('Payment declined')
    await signInResident();await b.navigate('/resident/payments/history')
    await text('Please correct the reference.')
    await button('Submit corrected details')
    await b.fill('dialog input[name=reference]',correctedRef)
    await button('Submit payment report','dialog');await text('Waiting for verification')
    corrected=await residentPayment(correctedRef)
    assert.equal(corrected.corrects_id,second.id)
    assert.equal((await residentBill()).balance,bill.total-1000)
  })
  await b.check('Corrected payment closes the balance and CSV remains separate from receipts',async()=>{
    await login(owner,password);await showReview(correctedRef)
    await b.click('dialog input[type=checkbox]')
    await button('Approve payment','dialog');await text('Payment verified')
    await signInResident();await b.navigate('/resident/payments');await text('ALL POSTED BILLS PAID')
    assert.equal((await residentBill()).bill_status,'PAID')
    await b.navigate('/resident/payments/history');await button('Export CSV')
    await button('Download selected CSV','dialog')
    const csv=await b.download('haruhay-payment-history.csv')
    assert.ok(csv.includes(firstRef)&&csv.includes(declinedRef)&&csv.includes(correctedRef))
  })
  await b.check('Audited reversal restores the balance and preserves the numbered receipt',async()=>{
    await login(owner,password);await showReview(firstRef,'Approved')
    await b.fill('dialog textarea','The payment was applied to the wrong bill.')
    await button('Reverse approval','dialog');await text('Payment reversed')
    await signInResident();await b.navigate('/resident/payments');await text('Partially paid')
    assert.equal((await residentBill()).balance,1000)
    await b.navigate('/resident/payments/receipt/'+initial.id)
    await text('Reversed')
    await text('The payment was applied to the wrong bill.')
    assert.equal((await api('/resident/payments/'+initial.id+'/receipt')).data.number,receiptNumber)
    await geometry()
  })
  await b.finish({ widths:[390,1440], roles:['resident','owner'], billId:bill.id })
} catch (error) {
  await b.screenshot('failure').catch(()=>{})
  throw error
} finally { await b.close() }
