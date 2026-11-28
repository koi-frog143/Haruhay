export type NotificationPreferences = { announcements: boolean; maintenance: boolean; payments: boolean }

const options = [
  ['announcements', 'Community announcements'],
  ['maintenance', 'Maintenance updates'],
  ['payments', 'Payment decisions'],
] as const

export default function NotificationPreferencesFields({ preferences }: { preferences: NotificationPreferences }) {
  return <div className="registration-form">
    {options.map(([key, label]) => <label className="settings-check" key={key}>
      <input type="checkbox" name={key} defaultChecked={preferences[key]} />{label}
    </label>)}
  </div>
}
