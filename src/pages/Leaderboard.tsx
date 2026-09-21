import { PageHeader } from '../components/Layout'
import { EmptyState } from '../components/ui'

export default function Leaderboard() {
  return (
    <div>
      <PageHeader title="Leaderboard" />
      <EmptyState emoji="🚧" title="Coming right up" hint="This page is being built." />
    </div>
  )
}
