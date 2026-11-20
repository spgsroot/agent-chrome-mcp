import { initNativeHostListener } from './native-host';
import { initElementMarkerListeners } from './element-marker';
import { initErrorLog } from './error-log';
import { initProxyManager } from './proxy';
import { initContextActionListeners } from './context-actions';

/**
 * Background entry point: native MCP bridge plus browser-side helpers
 * (element markers, context actions, proxy, error log).
 */
export default defineBackground(() => {
  initErrorLog();
  initProxyManager();
  initNativeHostListener();
  initElementMarkerListeners();
  initContextActionListeners();
});
