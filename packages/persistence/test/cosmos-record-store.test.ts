import { auditEventSchema } from '@echidna-claw/contracts';
import { describe, expect, it, vi } from 'vitest';

import { toPersistedRecordDocument } from '../src/documents/mappers.js';
import { CosmosRecordStore } from '../src/repositories/cosmos-record-store.js';
import { createAuditEvent } from '../src/testing/fixtures.js';

describe('CosmosRecordStore.get', () => {
  it('continues scanning containers when a container read returns no resource', async () => {
    const auditEvent = createAuditEvent();
    const persistedAuditEvent = toPersistedRecordDocument(auditEvent);
    const missingRead = vi.fn(async () => ({ resource: undefined }));
    const foundRead = vi.fn(async () => ({
      etag: 'etag_audit',
      resource: persistedAuditEvent,
    }));
    const containers = new Map<string, { item: (id: string, partitionKey: string) => { read: () => Promise<unknown> } }>([
      ['agent-state', { item: () => ({ read: missingRead }) }],
      ['audit-history', { item: () => ({ read: foundRead }) }],
      ['usage-events', { item: () => ({ read: vi.fn(async () => ({ resource: undefined })) }) }],
    ]);
    const client = {
      database() {
        return {
          container(name: string) {
            const container = containers.get(name);
            if (!container) {
              throw new Error(`Unexpected container: ${name}`);
            }

            return container;
          },
        };
      },
    };
    const store = new CosmosRecordStore({
      client: client as never,
      databaseName: 'test-db',
    });

    const stored = await store.get(auditEvent.id, auditEvent.agentId, auditEventSchema);

    expect(stored).not.toBeNull();
    expect(stored?.value).toEqual(auditEvent);
    expect(stored?.etag).toBe('etag_audit');
    expect(missingRead).toHaveBeenCalledOnce();
    expect(foundRead).toHaveBeenCalledOnce();
  });
});
