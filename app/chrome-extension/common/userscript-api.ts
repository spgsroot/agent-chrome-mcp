export const USER_SCRIPT_ACCESS_HELP =
  "JavaScript userscripts are unavailable. Use Chrome 138 or newer and enable Allow User Scripts in this extension's Details at chrome://extensions. On Chrome 135?137, enable Developer mode.";

export async function getUserScriptApi(): Promise<typeof chrome.userScripts | undefined> {
  try {
    const api = chrome.userScripts;
    if (typeof api?.execute !== 'function') return undefined;
    await api.getScripts();
    return api;
  } catch {
    // Chrome can keep the namespace but reject methods after access is revoked.
    return undefined;
  }
}
