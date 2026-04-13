import { EmptyState } from '../../shell/components/empty-state.js';

export function AnalyticsEmptyState() {
  return (
    <EmptyState
      description="Analytics routes are wired, but there are no usage events yet. Once Step 18 lands, this view can expand without changing the shell architecture."
      title="No analytics events yet"
    />
  );
}
