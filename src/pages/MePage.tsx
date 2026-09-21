import { PageHeader } from '../components/Layout'
import { EmptyState } from '../components/ui'

export default function MePage() {
  return (
    <div>
      <PageHeader title="MePage" />
      <EmptyState emoji="🚧" title="Coming right up" hint="This page is being built." />
    </div>
  )
}
