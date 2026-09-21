import { PageHeader } from '../components/Layout'
import { EmptyState } from '../components/ui'

export default function SchedulePage() {
  return (
    <div>
      <PageHeader title="SchedulePage" />
      <EmptyState emoji="🚧" title="Coming right up" hint="This page is being built." />
    </div>
  )
}
