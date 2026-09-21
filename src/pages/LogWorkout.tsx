import { PageHeader } from '../components/Layout'
import { EmptyState } from '../components/ui'

export default function LogWorkout() {
  return (
    <div>
      <PageHeader title="LogWorkout" />
      <EmptyState emoji="🚧" title="Coming right up" hint="This page is being built." />
    </div>
  )
}
