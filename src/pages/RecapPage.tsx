import { PageHeader } from '../components/Layout'
import { EmptyState } from '../components/ui'

export default function RecapPage() {
  return (
    <div>
      <PageHeader title="RecapPage" />
      <EmptyState emoji="🚧" title="Coming right up" hint="This page is being built." />
    </div>
  )
}
