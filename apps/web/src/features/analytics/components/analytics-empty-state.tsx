import { EmptyState } from '../../shell/components/empty-state.js';

export function AnalyticsEmptyState() {
  return (
    <EmptyState
      description="No usage events were recorded for the selected window yet. Historical data appears here once agents start running work."
      title="No analytics events yet"
    />
  );
}
