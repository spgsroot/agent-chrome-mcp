/**
 * Global reference-counted service-worker keepalive.
 * The underlying offscreen heartbeat runs while at least one tag is held.
 */

import { createKeepaliveController, type KeepaliveController } from './keepalive-controller';

let controller: KeepaliveController | null = null;

function getController(): KeepaliveController {
  controller ??= createKeepaliveController();
  return controller;
}

export function acquireKeepalive(tag: string): () => void {
  try {
    return getController().acquire(tag);
  } catch (error) {
    console.warn(`[KeepaliveManager] Failed to acquire keepalive for ${tag}:`, error);
    return () => {};
  }
}

export function isKeepaliveActive(): boolean {
  return controller?.isActive() ?? false;
}

export function getKeepaliveRefCount(): number {
  return controller?.getRefCount() ?? 0;
}
