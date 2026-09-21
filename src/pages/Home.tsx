import { PageHeader } from '../components/Layout'
import { EmptyState } from '../components/ui'

export default function Home() {
  return (
    <div>
      <PageHeader title="Home" />
      <EmptyState emoji="🚧" title="Coming right up" hint="This page is being built." />
    </div>
  )
}
