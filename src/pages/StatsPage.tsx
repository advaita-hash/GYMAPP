import { PageHeader } from '../components/Layout'
import { EmptyState } from '../components/ui'

export default function StatsPage() {
  return (
    <div>
      <PageHeader title="StatsPage" />
      <EmptyState emoji="🚧" title="Coming right up" hint="This page is being built." />
    </div>
  )
}
