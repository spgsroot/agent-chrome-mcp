import { handleGifMessage } from './gif-encoder';
import { initKeepalive } from './keepalive';

initKeepalive();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Only GIF encoding and keepalive control are handled offscreen.
  if (handleGifMessage(message, sendResponse)) return true;
  return undefined;
});
