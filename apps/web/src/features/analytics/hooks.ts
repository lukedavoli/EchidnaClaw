import type { AnalyticsWindow } from '@echidna-claw/contracts';
import { useQuery } from '@tanstack/react-query';

import { analyticsApi } from './api.js';

export const analyticsOverviewQueryKey = (window?: AnalyticsWindow) => [
  'analytics',
  'overview',
  window ?? 'default',
];

export function useAnalyticsOverviewQuery(window?: AnalyticsWindow) {
  return useQuery({
    queryFn: () => analyticsApi.getAnalyticsOverview(window),
    queryKey: analyticsOverviewQueryKey(window),
  });
}
