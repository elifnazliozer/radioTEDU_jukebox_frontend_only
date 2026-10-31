import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './mswServer';

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
// Vitest runs without globals, so Testing Library cannot register its own unmount hook.
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
