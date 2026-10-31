import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './mswServer.js';
// Loads window.KioskI18n the way index.html does; it stays on Turkish unless a test switches it.
import '../i18n.js';

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
