import '@core/activities/register'
import { AppShell } from './AppShell'
import { ActivityRoot, readActivityKindFromHash } from '@features/activities/ActivityRoot'

/** Root: activity windows use hash route; main chat uses AppShell. */
export default function App() {
  const kind = readActivityKindFromHash()
  if (kind) {
    return <ActivityRoot kind={kind} />
  }
  return (
    <div className="h-full">
      <AppShell />
    </div>
  )
}
