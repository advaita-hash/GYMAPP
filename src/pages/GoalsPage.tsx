import { PageHeader } from '../components/Layout'
import { EmptyState } from '../components/ui'

export default function GoalsPage() {
  return (
    <div>
      <PageHeader title="GoalsPage" />
      <EmptyState emoji="🚧" title="Coming right up" hint="This page is being built." />
    </div>
  )
}
