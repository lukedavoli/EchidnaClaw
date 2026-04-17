import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';

import { mockWebApiState, resolveMockApiRequest } from './msw/handlers.js';
import { server } from './msw/server.js';

const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
  addEventListener: vi.fn(),
  addListener: vi.fn(),
  dispatchEvent: vi.fn(),
  matches: false,
  media: query,
  onchange: null,
  removeEventListener: vi.fn(),
  removeListener: vi.fn(),
}));

class ResizeObserverMock {
  disconnect() {}
  observe() {}
  unobserve() {}
}

const boundingBox = {
  bottom: 640,
  height: 640,
  left: 0,
  right: 1024,
  toJSON() {
    return this;
  },
  top: 0,
  width: 1024,
  x: 0,
  y: 0,
} satisfies DOMRect;

const originalFetch = globalThis.fetch;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  const response = await resolveMockApiRequest(request);

  if (!response) {
    throw new Error(`Unhandled mock fetch: ${request.method} ${request.url}`);
  }

  return response;
});

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: matchMediaMock,
});

Object.defineProperty(window, 'ResizeObserver', {
  configurable: true,
  value: ResizeObserverMock,
});

Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get() {
    return 640;
  },
});

Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get() {
    return 1024;
  },
});

Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
  configurable: true,
  value() {
    return boundingBox;
  },
});

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn(),
});

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(window, 'fetch', {
    configurable: true,
    value: fetchMock,
  });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  mockWebApiState.reset();
  fetchMock.mockClear();
  window.history.replaceState({}, '', '/');
});

afterAll(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'fetch', {
    configurable: true,
    value: originalFetch,
  });
  server.close();
});
