import { PageHeader } from '../components/Layout'
import { EmptyState } from '../components/ui'

export default function Feed() {
  return (
    <div>
      <PageHeader title="Feed" />
      <EmptyState emoji="🚧" title="Coming right up" hint="This page is being built." />
    </div>
  )
}
