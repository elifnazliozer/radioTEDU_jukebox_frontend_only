export type KioskStatus = 'online' | 'offline' | 'checking';

/** Kiosks emit a socket heartbeat every 5s; the backend relays at most ~one per 10s. */
export const KIOSK_HEARTBEAT_TIMEOUT_MS = 30_000;

export function resolveKioskStatus(params: {
  lastHeartbeatAt: number | null;
  watchingSince: number;
  now: number;
}): KioskStatus {
  if (params.lastHeartbeatAt !== null && params.now - params.lastHeartbeatAt <= KIOSK_HEARTBEAT_TIMEOUT_MS) {
    return 'online';
  }
  if (params.lastHeartbeatAt === null && params.now - params.watchingSince < KIOSK_HEARTBEAT_TIMEOUT_MS) {
    return 'checking';
  }
  return 'offline';
}
