import { useQuery } from '@tanstack/react-query';

import { analyticsApi } from './api.js';

export const analyticsOverviewQueryKey = ['analytics', 'overview'];

export function useAnalyticsOverviewQuery() {
  return useQuery({
    queryFn: () => analyticsApi.getAnalyticsOverview(),
    queryKey: analyticsOverviewQueryKey,
  });
}
