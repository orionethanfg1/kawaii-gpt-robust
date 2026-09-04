import { ErrorBoundary } from './ErrorBoundary'
import { AppShell } from './AppShell'

/** Root: thin wrapper. Features live under AppShell with boundaries. */
export default function App() {
  return (
    <ErrorBoundary name="App">
      <AppShell />
    </ErrorBoundary>
  )
}
