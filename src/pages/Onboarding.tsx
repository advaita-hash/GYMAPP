import { PageHeader } from '../components/Layout'
import { EmptyState } from '../components/ui'

export default function Onboarding() {
  return (
    <div>
      <PageHeader title="Onboarding" />
      <EmptyState emoji="🚧" title="Coming right up" hint="This page is being built." />
    </div>
  )
}
