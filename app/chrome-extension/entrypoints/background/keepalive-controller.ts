/**
 * Keeps the MV3 service worker alive through an offscreen document heartbeat.
 * The native host connection relies on this while auto-connect is enabled.
 */

import { offscreenManager } from '@/utils/offscreen-manager';
import { KEEPALIVE_PORT_NAME, type KeepaliveMessage } from '@/common/keepalive-protocol';

const KEEPALIVE_CONTROL_MESSAGE_TYPE = 'mcp_keepalive.control' as const;

type KeepaliveControlCommand = 'start' | 'stop';

interface KeepaliveControlMessage {
  type: typeof KEEPALIVE_CONTROL_MESSAGE_TYPE;
  command: KeepaliveControlCommand;
}

export interface KeepaliveController {
  acquire(tag: string): () => void;
  isActive(): boolean;
  getRefCount(): number;
  releaseAll(): void;
}

export function createKeepaliveController(
  logger: Pick<Console, 'debug' | 'warn'> = console,
): KeepaliveController {
  const refs = new Map<string, number>();
  let totalRefs = 0;
  let offscreenPort: chrome.runtime.Port | null = null;
  let syncPromise: Promise<void> = Promise.resolve();

  const sendPortMessage = (type: KeepaliveMessage['type']) => {
    if (!offscreenPort) return;
    try {
      offscreenPort.postMessage({ type, timestamp: Date.now() } satisfies KeepaliveMessage);
    } catch (error) {
      logger.warn('[Keepalive] Failed to send port message:', error);
    }
  };

  const sendRuntimeControl = async (command: KeepaliveControlCommand) => {
    const message: KeepaliveControlMessage = { type: KEEPALIVE_CONTROL_MESSAGE_TYPE, command };
    // The offscreen document may still be starting; retry start briefly.
    const delaysMs = command === 'start' ? [0, 50, 200] : [0];
    for (const delayMs of delaysMs) {
      if (delayMs > 0) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, delayMs);
        await promise;
      }
      try {
        await chrome.runtime.sendMessage(message);
        return;
      } catch {
        // Offscreen document not ready yet.
      }
    }
    logger.warn(`[Keepalive] Failed to send runtime ${command} command`);
  };

  const teardown = () => {
    if (!offscreenPort) return;
    const port = offscreenPort;
    offscreenPort = null;
    try {
      port.disconnect();
    } catch {
      // Port may already be disconnected.
    }
  };

  const syncOnce = async () => {
    if (totalRefs > 0) {
      await offscreenManager.ensureOffscreenDocument();
      if (totalRefs === 0) {
        await sendRuntimeControl('stop');
        teardown();
        return;
      }
      await sendRuntimeControl('start');
      sendPortMessage('keepalive.start');
      return;
    }
    sendPortMessage('keepalive.stop');
    await sendRuntimeControl('stop');
    teardown();
  };

  const scheduleSync = () => {
    syncPromise = syncPromise
      .catch(() => undefined)
      .then(syncOnce)
      .catch((error) => logger.warn('[Keepalive] Sync failed:', error));
  };

  chrome.runtime?.onConnect?.addListener((port) => {
    if (port.name !== KEEPALIVE_PORT_NAME) return;
    offscreenPort = port;
    port.onMessage.addListener((message: unknown) => {
      if ((message as KeepaliveMessage | null)?.type !== 'keepalive.ping') return;
      sendPortMessage('keepalive.pong');
    });
    port.onDisconnect.addListener(() => {
      if (offscreenPort === port) offscreenPort = null;
    });
    if (totalRefs > 0) sendPortMessage('keepalive.start');
  });

  return {
    acquire(tag) {
      totalRefs += 1;
      refs.set(tag, (refs.get(tag) ?? 0) + 1);
      if (totalRefs === 1) scheduleSync();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        totalRefs = Math.max(0, totalRefs - 1);
        const count = refs.get(tag) ?? 0;
        if (count <= 1) refs.delete(tag);
        else refs.set(tag, count - 1);
        if (totalRefs === 0) scheduleSync();
      };
    },
    isActive: () => totalRefs > 0,
    getRefCount: () => totalRefs,
    releaseAll() {
      refs.clear();
      totalRefs = 0;
      scheduleSync();
    },
  };
}
