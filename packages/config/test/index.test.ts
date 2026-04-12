import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadWebConfig } from '../src/browser.js';
import {
  loadApiConfig,
  loadHandsConfig,
  loadSandboxConfig,
} from '../src/index.js';
import { defaultRepositoryConfigPath, loadRepositoryConfig } from '../src/repository.js';

describe('config loaders', () => {
  it('applies API defaults', () => {
    expect(loadApiConfig({})).toMatchObject({
      serviceName: 'api',
      host: '127.0.0.1',
      port: 3001,
      nodeEnv: 'development',
      logLevel: 'info',
    });
  });

  it('rejects invalid sandbox ports', () => {
    expect(() =>
      loadSandboxConfig({
        ECHIDNA_SANDBOX_PORT: '70000',
      }),
    ).toThrow();
  });

  it('parses the hands heartbeat interval', () => {
    expect(
      loadHandsConfig({
        ECHIDNA_HANDS_HEARTBEAT_INTERVAL_MS: '45000',
      }).heartbeatIntervalMs,
    ).toBe(45000);
  });

  it('loads browser-safe web defaults', () => {
    expect(
      loadWebConfig({
        VITE_API_BASE_URL: 'http://127.0.0.1:3001',
        VITE_APP_TITLE: 'Control Plane',
      }),
    ).toEqual({
      apiBaseUrl: 'http://127.0.0.1:3001',
      appTitle: 'Control Plane',
    });
  });

  it('loads the checked-in repository config', () => {
    expect(loadRepositoryConfig(defaultRepositoryConfigPath)).toMatchObject({
      version: '1',
      models: {
        defaultModel: 'gpt-5.4-mini',
      },
      sandbox: {
        defaultPolicy: 'standard',
      },
    });
  });

  it('rejects invalid repository config files', () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'echidna-claw-config-'));
    const tempPath = join(tempDirectory, 'repository.v1.json');

    writeFileSync(
      tempPath,
      JSON.stringify({
        version: '1',
        models: {
          defaultModel: 'gpt-5.4-mini',
          pricing: [
            {
              model: 'gpt-5.4-mini',
              provider: 'azure-foundry',
              effectiveAt: '2026-04-12T00:00:00.000Z',
              unit: '1m_tokens',
              inputUsd: 0.2,
              outputUsd: 0.8,
            },
          ],
        },
        sandbox: {
          defaultPolicy: 'missing',
          policies: [
            {
              name: 'standard',
              description: 'Default policy',
              allowFilesystemWriteUnder: ['/workspace'],
              allowOutboundHosts: ['api.telegram.org'],
              allowCommands: ['pnpm'],
            },
          ],
          packageAllowlists: [
            {
              name: 'default-runtime',
              packages: ['zod'],
            },
          ],
        },
        capabilities: {
          registry: [
            {
              id: 'sandbox.shell',
              name: 'Sandbox shell execution',
              description: 'Runs commands',
              category: 'tool',
            },
          ],
        },
      }),
      'utf8',
    );

    expect(() => loadRepositoryConfig(tempPath)).toThrow();

    rmSync(tempDirectory, { force: true, recursive: true });
  });
});
