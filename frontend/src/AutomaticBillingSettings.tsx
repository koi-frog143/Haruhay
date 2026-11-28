import { useState } from 'react'
import { periodLabel } from './billingData'
import { paymentDateLabel } from './paymentApi'
import { philippineTime } from './visitorApi'

type RunIssue = { applicationId: string; residentName: string; roomLabel: string; reason: string; billPosted: boolean }
type BillingRun = { id: string; period: string; scheduledFor: string; completedAt: string; postedCount: number; existingCount: number; issues: RunIssue[] }
export type BillingScheduleStatus = { nextPostingDate: string | null; catchUp: boolean; runs: BillingRun[] }

export default function AutomaticBillingSettings({ enabled, postingDay, schedule, busy }: {
  enabled: boolean; postingDay: number; schedule: BillingScheduleStatus; busy: boolean
}) {
  const [automatic, setAutomatic] = useState(enabled)
  const [latest, ...older] = schedule.runs
  return <section className="registration-form" aria-label="Automatic bill posting">
    <h3>Automatic bill posting</h3>
    <label className="settings-check">
      <input type="checkbox" name="automaticEnabled" checked={automatic} disabled={busy}
        onChange={event => setAutomatic(event.target.checked)} />
      Post monthly bills automatically
    </label>
    <label>Posting day<input type="number" name="postingDay" min={1} max={28} required disabled={!automatic || busy} defaultValue={postingDay} />
      <small>Haruhay creates bills on this day each month. The due day is the resident’s payment deadline.</small>
    </label>
    {automatic && <p>Stays active at the start of the posting day are eligible. Post bills for later starts manually. Catch-up uses the saved due day and covers the current month.</p>}
    <div className="room-review-summary">
      <p><strong>Saved schedule</strong></p>
      <p>{schedule.nextPostingDate
        ? `${schedule.catchUp ? 'Catch-up due' : 'Next posting'} ${paymentDateLabel(schedule.nextPostingDate)} (PHT)`
        : 'Automatic posting is off.'}</p>
    </div>
    <h3>Last run</h3>
    {latest ? <RunDetails run={latest} /> : <p>No automatic billing runs yet.</p>}
    {older.length > 0 && <details>
      <summary>Earlier runs</summary>
      <ul className="dialog-list">{older.map(run => <li key={run.id}><RunDetails run={run} /></li>)}</ul>
    </details>}
  </section>
}

function RunDetails({ run }: { run: BillingRun }) {
  const pending = run.issues.filter(issue => !issue.billPosted).length
  return <div className="registration-form">
    <p><strong>{periodLabel(run.period)}</strong><br /><small>Completed {philippineTime(run.completedAt)} PHT</small>
      <br /><small>Scheduled for {paymentDateLabel(run.scheduledFor)}</small></p>
    <p>{run.postedCount} posted · {run.existingCount} already posted · {pending} need review</p>
    {run.issues.length > 0 && <ul className="dialog-list">
      {run.issues.map(issue => <li key={issue.applicationId}>
        <a href={`#/admin/residents/${issue.applicationId}`}>{issue.residentName} · {issue.roomLabel}</a>
        <small>{issue.reason}</small>
        {issue.billPosted && <small>Bill now posted</small>}
      </li>)}
    </ul>}
  </div>
}
