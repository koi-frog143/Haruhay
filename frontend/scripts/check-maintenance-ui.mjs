// Uses the disposable owner, property and approved resident created by check-onboarding-ui.
import assert from 'node:assert/strict'
import { browserChecks } from './browser-check-client.mjs'

const b = await browserChecks('maintenance-live')
const owner = process.env.UI_OWNER_EMAIL || 'owner@onboarding.test'
const ownerPassword = process.env.DEV_OWNER_PASSWORD
assert.ok(ownerPassword, 'Configure the disposable owner test password')
const residentPassword = 'Browser-resident-password42'
const staffPassword = 'Maintenance-browser-password42'
const timestamp = Date.now()
const emails = ['repair-first-' + timestamp + '@example.test', 'repair-second-' + timestamp + '@example.test']
let resident, property, ticket, photoId, assigned

async function wait(expression) {
  for (let count = 0; count < 140; count++) {
    if (await b.evaluate(expression)) return
    await b.pause(100)
  }
  throw new Error('Timed out waiting for ' + expression + '\n' + (await b.evaluate('document.body.innerText')).slice(-1300))
}
const text = value => wait('document.body.innerText.includes(' + JSON.stringify(value) + ')')
async function api(path, body) {
  return b.evaluate('(async()=>{const headers={};const body='+JSON.stringify(body)+';if(body!==undefined){const c=await(await fetch("/api/auth/csrf")).json();headers[c.headerName]=c.token;headers["Content-Type"]="application/json"}const response=await fetch("/api"+'+JSON.stringify(path)+',{method:body===undefined?"GET":"POST",headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:response.headers.get("content-type")?.includes("application/json")?await response.json():null}})()')
}
async function button(label, scope = '') {
  const selector = JSON.stringify(scope ? scope + ' button' : 'button')
  const condition = '[...document.querySelectorAll('+selector+')].find(e=>e.textContent.trim()==='+JSON.stringify(label)+'&&!e.disabled)'
  await wait('Boolean('+condition+')')
  await b.evaluate('(()=>{const e='+condition+';e.focus();e.click()})()')
  await b.pause()
}
async function login(email, password) {
  await b.navigate('/login')
  await api('/auth/logout', {})
  await b.navigate('/login')
  await b.send('Page.reload')
  await b.pause(350)
  await wait('Boolean(document.querySelector("input[name=email]")) && Boolean(document.querySelector("input[name=password]"))')
  await b.fill('input[name=email]', email)
  await b.fill('input[name=password]', password)
  await b.submit('form[aria-label="Sign in to your account"]')
  await wait('!location.hash.endsWith("/login") && Boolean(document.querySelector(".admin-heading,.resident-page-heading"))')
}
async function geometry() {
  await wait('[...document.images].every(i=>i.complete&&i.naturalWidth>0)')
  assert.equal(await b.evaluate('document.documentElement.scrollWidth > innerWidth+1'), false)
}
async function choosePhoto(valid) {
  await b.evaluate('(async()=>{const input=document.querySelector("input[type=file]");const d=new DataTransfer();const canvas=document.createElement("canvas");canvas.width=40;canvas.height=40;const ctx=canvas.getContext("2d");ctx.fillStyle="#28678a";ctx.fillRect(0,0,40,40);const bytes='+valid+'?await new Promise(resolve=>canvas.toBlob(resolve,"image/png")):"not an image";d.items.add(new File([bytes],"maintenance-photo.png",{type:"image/png"}));input.files=d.files;input.dispatchEvent(new Event("change",{bubbles:true}));})()')
}
const path = role => '/' + (role === 'owner' ? 'admin/maintenance' : role === 'technician' ? 'technician/jobs' : 'resident/maintenance') + '/' + ticket.id
async function open(role) {
  await b.navigate(path(role))
  await text(ticket.ticket_number)
  await text('Activity timeline')
}
async function confirmAction(openLabel, submitLabel, note) {
  await button(openLabel)
  if (note) await b.fill('dialog textarea[name=note]', note)
  await button(submitLabel, 'dialog')
  await wait('!document.querySelector("dialog[open]")')
}
const issue = 'Faucet keeps dripping near the kitchen ' + timestamp
try {
  await b.viewport(1440)
  await login(owner, ownerPassword)
  const admissions = (await api('/owner/admissions')).data
  resident = admissions.find(record => record.status === 'APPROVED' && record.email.startsWith('resident-'))
  assert.ok(resident)
  property = (await api('/owner/properties')).data.find(record => record.id === resident.property_id)
  assert.ok(property)
  await b.check('Owner creates two property-scoped technician accounts', async () => {
    await b.navigate('/admin/maintenance'); await text('Maintenance queue')
    await button('Manage technicians')
    for (const [index, name] of ['Repair First', 'Repair Second'].entries()) {
      await b.fill('dialog input[name=name]', name)
      await b.fill('dialog input[name=email]', emails[index])
      await b.fill('dialog input[name=password]', staffPassword)
      await b.submit('dialog form')
      await text(emails[index])
    }
    await b.escape()
    assigned = (await api('/maintenance/properties/' + property.id + '/technicians')).data.filter(row => emails.includes(row.email))
    assert.equal(assigned.length, 2)
  })
  await b.check('Resident form keeps input after failure and saves the ticket even if upload fails', async () => {
    await login(resident.email, residentPassword)
    await b.navigate('/resident/maintenance/new')
    await text(property.name)
    await wait('Boolean(document.querySelector("select[name=category]"))')
    await b.fill('select[name=category]', 'PLUMBING')
    await b.fill('textarea[name=description]', issue)
    await choosePhoto(false)
    for (const width of [1440, 390]) {
      await b.viewport(width); await geometry(); await b.screenshot(width + '-resident-report')
    }
    await b.evaluate('window.originalMaintenanceFetch=window.fetch;window.fetch=(url,options)=>String(url)==="/api/maintenance/tickets"&&options?.method==="POST"?Promise.resolve(new Response(JSON.stringify({message:"Temporary save failure"}),{status:503,headers:{"Content-Type":"application/json"}})):window.originalMaintenanceFetch(url,options)')
    await b.submit('.maintenance-live form')
    await text('Temporary save failure')
    assert.equal(await b.evaluate('document.querySelector("textarea[name=description]").value'), issue)
    await b.evaluate('window.fetch=window.originalMaintenanceFetch;delete window.originalMaintenanceFetch')
    await b.submit('.maintenance-live form')
    await text('Request submitted'); await text('The ticket is saved.')
    await button('Retry photo upload')
    await text('valid JPEG or PNG')
    await b.click('.maintenance-live-result a')
    await text('Activity timeline')
    const records = (await api('/maintenance/tickets')).data
    ticket = records.find(row => row.description === issue)
    assert.equal(records.filter(row => row.description === issue).length, 1)
    assert.equal(ticket.status, 'SUBMITTED')
    assert.equal(ticket.room_label, resident.room_label)
    await choosePhoto(true)
    await button('Upload photo')
    await wait('Boolean(document.querySelector(".maintenance-photos img"))')
    photoId = (await api('/maintenance/tickets/' + ticket.id)).data.photos[0].id
    assert.equal((await api('/maintenance/tickets/' + ticket.id + '/photos/' + photoId)).status, 200)
    await geometry()
    await b.screenshot('390-resident-ticket')
  })
  await b.check('Owner can open the new-ticket notification and assign priority in one action', async () => {
    await login(owner, ownerPassword); await b.navigate('/admin/maintenance')
    await text('Needs assignment'); await text(issue)
    await b.viewport(1440); await geometry(); await b.screenshot('1440-owner-queue')
    await b.click('button[aria-label^="Admin notifications"]')
    await text('New maintenance request')
    await b.click('dialog .maintenance-notifications a')
    await text('Assign technician')
    await button('Assign technician')
    await wait('document.querySelector("dialog [name=technicianId]").options.length>2')
    await b.fill('dialog [name=technicianId]', assigned.find(row => row.email === emails[0]).id)
    await b.fill('dialog [name=priority]', 'CRITICAL')
    await b.tab(); assert.ok(await b.evaluate('Boolean(document.activeElement.closest("dialog"))'))
    await button('Save assignment', 'dialog')
    await text('Assigned to Repair First'); await text('Critical')
    await confirmAction('Record escalation', 'Record escalation', 'External plumber called. Repair First will follow up.')
    await text('External escalation recorded')
    await b.screenshot('1440-owner-assignment')
  })
  await b.check('Assigned technician sees My jobs, posts progress, and requests confirmation', async () => {
    await login(emails[0], staffPassword)
    await text('My jobs')
    assert.equal(await b.evaluate('location.hash'), '#/technician/jobs')
    await b.navigate('/admin/maintenance')
    await wait('location.hash==="#/technician/jobs"')
    assert.equal((await api('/owner/bills')).status, 403)
    await open('technician')
    await b.viewport(390); await geometry(); await b.screenshot('390-technician-job')
    await confirmAction('Start work', 'Start work')
    await text('Repair in progress')
    await confirmAction('Post progress update', 'Post progress update', 'Inspected the connection.')
    await text('Inspected the connection.')
    await confirmAction('Ready for confirmation', 'Ready for confirmation', 'Replaced the faucet seal.')
    await text('Replaced the faucet seal.')
  })
  await b.check('Resident follows the confirmation notice and reopens the same ticket', async () => {
    await login(resident.email, residentPassword); await open('resident')
    await b.click('button[aria-label^="Notifications"]')
    await text('Your repair is ready to confirm')
    await b.click('dialog .maintenance-notifications a')
    await text('Still having the issue')
    await b.screenshot('390-resident-confirmation')
    await confirmAction('Still having the issue', 'Still having the issue', 'It still leaks from the handle.')
    await text('It still leaks from the handle.')
    assert.equal((await api('/maintenance/tickets/' + ticket.id)).data.status, 'IN_PROGRESS')
  })
  await b.check('Owner reassigns with a reason and previous technician loses ticket and photo access', async () => {
    await login(owner, ownerPassword); await open('owner')
    await button('Manage assignment')
    await wait('document.querySelector("dialog [name=technicianId]").options.length>2')
    await b.fill('dialog [name=technicianId]', assigned.find(row => row.email === emails[1]).id)
    await b.fill('dialog textarea[name=note]', 'Second technician is available today.')
    await button('Save assignment', 'dialog')
    await text('Second technician is available today.')
    await login(emails[0], staffPassword)
    assert.equal((await api('/maintenance/tickets/' + ticket.id)).status, 404)
    assert.equal((await api('/maintenance/tickets/' + ticket.id + '/photos/' + photoId)).status, 404)
    await b.navigate(path('technician'))
    await text('This ticket is unavailable')
  })
  await b.check('Second technician completes the repair and resident confirms it into history', async () => {
    await login(emails[1], staffPassword); await open('technician')
    await confirmAction('Start work', 'Start work')
    await text('Repair in progress')
    await confirmAction('Ready for confirmation', 'Ready for confirmation', 'Replaced the handle cartridge.')
    await text('Replaced the handle cartridge.')
    await login(resident.email, residentPassword); await open('resident')
    await confirmAction('It’s fixed', 'Close ticket')
    await text('Ticket closed')
    await b.send('Page.reload'); await text('Ticket closed')
    await b.navigate('/resident/maintenance')
    await button('History'); await text(issue)
    await b.evaluate('history.back()')
    await wait('location.hash.endsWith('+JSON.stringify(ticket.id)+')')
    await text('Ticket closed')
    await b.evaluate('history.forward()')
    await wait('location.hash==="#/resident/maintenance"')
    await geometry()
  })
  await b.finish({ widths: [390, 1440], accounts: ['resident', 'owner', 'assigned technician', 'reassigned technician'] })
} catch (error) {
  await b.screenshot('failure').catch(() => {})
  throw error
} finally {
  await b.close()
}
