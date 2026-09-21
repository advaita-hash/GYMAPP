import { PageHeader } from '../components/Layout'
import { EmptyState } from '../components/ui'

export default function HabitsPage() {
  return (
    <div>
      <PageHeader title="HabitsPage" />
      <EmptyState emoji="🚧" title="Coming right up" hint="This page is being built." />
    </div>
  )
}
