export const USER_SCRIPT_ACCESS_HELP =
  "JavaScript userscripts are unavailable. Use Chrome 138 or newer and enable Allow User Scripts in this extension's Details at chrome://extensions. On Chrome 135?137, enable Developer mode.";

export function getUserScriptApi(): typeof chrome.userScripts | undefined {
  try {
    const api = chrome.userScripts;
    return typeof api?.execute === 'function' ? api : undefined;
  } catch {
    // Older Chrome versions may throw when accessing the disabled API.
    return undefined;
  }
}
