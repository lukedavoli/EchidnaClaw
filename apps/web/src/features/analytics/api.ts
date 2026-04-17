import type { AnalyticsWindow } from '@echidna-claw/contracts';

import { webApiClient } from '../../lib/api/client.js';

export const analyticsApi = {
  getAnalyticsOverview(window?: AnalyticsWindow) {
    return webApiClient.getAnalyticsOverview(window);
  },
};
