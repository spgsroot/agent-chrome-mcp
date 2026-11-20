/**
 * Message type constants for extension-internal communication.
 */

export enum MessageTarget {
  Offscreen = 'offscreen',
  ContentScript = 'content_script',
  Background = 'background',
}

export const BACKGROUND_MESSAGE_TYPES = {
  GET_ERROR_LOGS: 'get_error_logs',
  CLEAR_ERROR_LOGS: 'clear_error_logs',
  GET_SERVER_STATUS: 'get_server_status',
  REFRESH_SERVER_STATUS: 'refresh_server_status',
  START_NATIVE_SERVER: 'start_native_server',
  SERVER_STATUS_CHANGED: 'server_status_changed',
  // Element marker management
  ELEMENT_MARKER_LIST_ALL: 'element_marker_list_all',
  ELEMENT_MARKER_LIST_FOR_URL: 'element_marker_list_for_url',
  ELEMENT_MARKER_GET: 'element_marker_get',
  ELEMENT_MARKER_SAVE: 'element_marker_save',
  ELEMENT_MARKER_UPDATE: 'element_marker_update',
  ELEMENT_MARKER_UPDATE_MEMBER: 'element_marker_update_member',
  ELEMENT_MARKER_UPDATE_GROUP: 'element_marker_update_group',
  ELEMENT_MARKER_DELETE: 'element_marker_delete',
  ELEMENT_MARKER_VALIDATE: 'element_marker_validate',
  ELEMENT_MARKER_CHECK: 'element_marker_check',
  ELEMENT_MARKER_CHANGED: 'element_marker_changed',
  ELEMENT_MARKER_START: 'element_marker_start_from_popup',
  // Element picker (human-in-the-loop element selection)
  ELEMENT_PICKER_UI_EVENT: 'element_picker_ui_event',
  ELEMENT_PICKER_FRAME_EVENT: 'element_picker_frame_event',
} as const;

export const OFFSCREEN_MESSAGE_TYPES = {
  GIF_ADD_FRAME: 'gifAddFrame',
  GIF_FINISH: 'gifFinish',
  GIF_RESET: 'gifReset',
} as const;

export const TOOL_MESSAGE_TYPES = {
  SCREENSHOT_PREPARE_PAGE_FOR_CAPTURE: 'preparePageForCapture',
  SCREENSHOT_GET_PAGE_DETAILS: 'getPageDetails',
  SCREENSHOT_GET_ELEMENT_DETAILS: 'getElementDetails',
  SCREENSHOT_SCROLL_PAGE: 'scrollPage',
  SCREENSHOT_RESET_PAGE_AFTER_CAPTURE: 'resetPageAfterCapture',
  WEB_FETCHER_GET_HTML_CONTENT: 'getHtmlContent',
  WEB_FETCHER_GET_TEXT_CONTENT: 'getTextContent',
  CLICK_ELEMENT: 'clickElement',
  FILL_ELEMENT: 'fillElement',
  SIMULATE_KEYBOARD: 'simulateKeyboard',
  GET_INTERACTIVE_ELEMENTS: 'getInteractiveElements',
  GENERATE_ACCESSIBILITY_TREE: 'generateAccessibilityTree',
  GENERATE_ACTION_SNAPSHOT: 'generateActionSnapshot',
  RESOLVE_REF: 'resolveRef',
  ENSURE_REF_FOR_SELECTOR: 'ensureRefForSelector',
  VERIFY_FINGERPRINT: 'verifyFingerprint',
  DISPATCH_HOVER_FOR_REF: 'dispatchHoverForRef',
  NETWORK_SEND_REQUEST: 'sendPureNetworkRequest',
  WAIT_FOR_TEXT: 'waitForText',
  // Element marker overlay control (content-side)
  ELEMENT_MARKER_START: 'element_marker_start',
  // Element picker (tool-driven, background <-> content scripts)
  ELEMENT_PICKER_START: 'elementPickerStart',
  ELEMENT_PICKER_STOP: 'elementPickerStop',
  ELEMENT_PICKER_SET_ACTIVE_REQUEST: 'elementPickerSetActiveRequest',
  ELEMENT_PICKER_UI_PING: 'elementPickerUiPing',
  ELEMENT_PICKER_UI_SHOW: 'elementPickerUiShow',
  ELEMENT_PICKER_UI_UPDATE: 'elementPickerUiUpdate',
  ELEMENT_PICKER_UI_HIDE: 'elementPickerUiHide',
} as const;

/** Messages used by the extension's right-click convenience actions. */
export const CONTEXT_ACTION_MESSAGE_TYPES = {
  COPY_TEXT_TO_CLIPBOARD: 'contextActionCopyTextToClipboard',
  SMART_CLOSE_POPUPS: 'contextActionSmartClosePopups',
  RESTORE_PAGE_SCROLL: 'contextActionRestorePageScroll',
  TOGGLE_PAGE_ANIMATIONS: 'contextActionTogglePageAnimations',
  EXPAND_COLLAPSED_CONTENT: 'contextActionExpandCollapsedContent',
  FOCUS_FIRST_INPUT: 'contextActionFocusFirstInput',
  FILL_EMPTY_TEST_DATA: 'contextActionFillEmptyTestData',
  TOGGLE_ELEMENT_BORDERS: 'contextActionToggleElementBorders',
  START_COLOR_PICKER: 'contextActionStartColorPicker',
  TOGGLE_PAGE_IMAGES: 'contextActionTogglePageImages',
  CAPTURE_FULL_PAGE: 'contextActionCaptureFullPage',
  SHOW_TOAST: 'contextActionShowToast',
} as const;

export type BackgroundMessageType =
  (typeof BACKGROUND_MESSAGE_TYPES)[keyof typeof BACKGROUND_MESSAGE_TYPES];
export type OffscreenMessageType =
  (typeof OFFSCREEN_MESSAGE_TYPES)[keyof typeof OFFSCREEN_MESSAGE_TYPES];
export type ToolMessageType = (typeof TOOL_MESSAGE_TYPES)[keyof typeof TOOL_MESSAGE_TYPES];
