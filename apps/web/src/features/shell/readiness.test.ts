import { describe, expect, it } from 'vitest';

import { webApiClient } from '../../lib/api/client.js';

describe('readiness integration', () => {
  it('reads the mocked readiness endpoint as ready by default', async () => {
    await expect(webApiClient.getReadiness()).resolves.toMatchObject({
      status: 'ready',
    });
  });
});
