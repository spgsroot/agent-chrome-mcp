/**
 * Offscreen half of the service-worker keepalive: reconnect while desired and
 * ping the background so an idle MV3 worker is not suspended.
 */

import {
  KEEPALIVE_PORT_NAME,
  DEFAULT_KEEPALIVE_PING_INTERVAL_MS,
  type KeepaliveMessage,
} from '@/common/keepalive-protocol';

const KEEPALIVE_CONTROL_MESSAGE_TYPE = 'mcp_keepalive.control' as const;

interface KeepaliveControlMessage {
  type: typeof KEEPALIVE_CONTROL_MESSAGE_TYPE;
  command: 'start' | 'stop';
}

let initialized = false;
let port: chrome.runtime.Port | null = null;
let pingTimer: ReturnType<typeof setInterval> | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let desired = false;

function connectToBackground(): chrome.runtime.Port | null {
  try {
    const next = chrome.runtime.connect({ name: KEEPALIVE_PORT_NAME });
    next.onMessage.addListener((message: unknown) => {
      const type = (message as KeepaliveMessage | null)?.type;
      if (type === 'keepalive.start') startPingLoop();
      else if (type === 'keepalive.stop') stopPingLoop();
    });
    next.onDisconnect.addListener(() => {
      port = null;
      if (desired) scheduleReconnect();
    });
    return next;
  } catch (error) {
    console.warn('[Keepalive] Failed to connect:', error);
    return null;
  }
}

function scheduleReconnect(): void {
  if (!desired || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    if (desired && !port) port = connectToBackground();
  }, 1000);
}

function sendPing(): void {
  port ??= connectToBackground();
  if (!port) return;
  try {
    port.postMessage({ type: 'keepalive.ping', timestamp: Date.now() } satisfies KeepaliveMessage);
  } catch {
    port = null;
    scheduleReconnect();
  }
}

function startPingLoop(): void {
  if (pingTimer) return;
  desired = true;
  port ??= connectToBackground();
  sendPing();
  pingTimer = setInterval(sendPing, DEFAULT_KEEPALIVE_PING_INTERVAL_MS);
}

function stopPingLoop(): void {
  desired = false;
  clearInterval(pingTimer);
  pingTimer = undefined;
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  if (port) {
    try {
      port.disconnect();
    } catch {
      // Already disconnected.
    }
    port = null;
  }
}

export function initKeepalive(): void {
  if (initialized || typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
  initialized = true;
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const control = message as KeepaliveControlMessage | null;
    if (control?.type !== KEEPALIVE_CONTROL_MESSAGE_TYPE) return;
    if (control.command === 'start') startPingLoop();
    else stopPingLoop();
    sendResponse({ ok: true });
  });
  port = connectToBackground();
}
