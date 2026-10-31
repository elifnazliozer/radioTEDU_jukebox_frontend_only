import { describe, expect, it } from 'vitest';
import { KIOSK_HEARTBEAT_TIMEOUT_MS, resolveKioskStatus } from './kioskStatus';

describe('resolveKioskStatus', () => {
  const watchingSince = 1_000_000;

  it('is checking until the first heartbeat window has passed', () => {
    expect(resolveKioskStatus({ lastHeartbeatAt: null, watchingSince, now: watchingSince + 5_000 })).toBe('checking');
    expect(resolveKioskStatus({ lastHeartbeatAt: null, watchingSince, now: watchingSince + KIOSK_HEARTBEAT_TIMEOUT_MS })).toBe('offline');
  });

  it('is online while heartbeats keep arriving and offline once they stop', () => {
    const lastHeartbeatAt = watchingSince + 10_000;
    expect(resolveKioskStatus({ lastHeartbeatAt, watchingSince, now: lastHeartbeatAt + 12_000 })).toBe('online');
    expect(resolveKioskStatus({ lastHeartbeatAt, watchingSince, now: lastHeartbeatAt + KIOSK_HEARTBEAT_TIMEOUT_MS + 1 })).toBe('offline');
  });
});
