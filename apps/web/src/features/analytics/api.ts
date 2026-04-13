import { webApiClient } from '../../lib/api/client.js';

export const analyticsApi = {
  getAnalyticsOverview() {
    return webApiClient.getAnalyticsOverview();
  },
};
