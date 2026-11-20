/**
 * Safe access to chrome.i18n with an English fallback for non-extension contexts.
 */

const FALLBACK_MESSAGES: Record<string, string> = {
  bookmarksBarLabel: 'Bookmarks Bar',
};

export function getMessage(key: string, substitutions?: string[]): string {
  try {
    const message = chrome.i18n?.getMessage(key, substitutions);
    if (message) return message;
  } catch (error) {
    console.warn(`Failed to get i18n message for key "${key}":`, error);
  }

  let fallback = FALLBACK_MESSAGES[key] ?? key;
  for (const [index, value] of (substitutions ?? []).entries()) {
    fallback = fallback.replace(`{${index}}`, value);
  }
  return fallback;
}
