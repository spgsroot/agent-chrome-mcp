/**
 * Keepalive protocol constants shared by the background service worker and
 * the offscreen document that keeps it alive.
 */

export const KEEPALIVE_PORT_NAME = 'mcp_keepalive' as const;

export type KeepaliveMessageType =
  'keepalive.ping' | 'keepalive.pong' | 'keepalive.start' | 'keepalive.stop';

export interface KeepaliveMessage {
  type: KeepaliveMessageType;
  timestamp: number;
}

/** Chrome terminates an idle MV3 service worker after roughly 30 seconds. */
export const DEFAULT_KEEPALIVE_PING_INTERVAL_MS = 20_000;
export const MAX_KEEPALIVE_PING_INTERVAL_MS = 25_000;
