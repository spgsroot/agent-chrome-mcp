<template>
  <div class="popup">
    <header class="header">
      <h1>Chrome MCP</h1>
      <span class="status-badge" :class="`status-${statusTone}`" role="status">{{
        statusText
      }}</span>
    </header>

    <section class="card" aria-labelledby="connection-heading">
      <h2 id="connection-heading">Native connection</h2>
      <p class="meta">{{ statusDetail }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="permissionWarning" class="error" role="alert">{{ permissionWarning }}</p>

      <div class="field-row">
        <label for="port">Port</label>
        <input
          id="port"
          v-model.number="port"
          type="number"
          min="1"
          max="65535"
          inputmode="numeric"
          :disabled="busy"
          @change="savePort"
        />
      </div>

      <div class="actions">
        <button class="primary" type="button" :disabled="busy" @click="toggleConnection">
          {{ connected ? 'Disconnect' : 'Connect' }}
        </button>
        <button type="button" :disabled="busy" @click="refreshStatus">Refresh</button>
        <button
          v-if="connected && !serverStatus.isRunning"
          type="button"
          :disabled="busy"
          @click="startServer"
        >
          Start server
        </button>
      </div>

      <p class="hint">
        <template v-if="!connected">Start the native host before connecting. </template>
        <a :href="troubleshootingUrl" target="_blank" rel="noreferrer">Troubleshooting</a>
      </p>
    </section>

    <section class="card" aria-labelledby="client-heading">
      <div class="heading-row">
        <h2 id="client-heading">MCP client</h2>
        <button type="button" @click="copyConfig">{{ copied ? 'Copied' : 'Copy config' }}</button>
      </div>
      <label for="transport">Transport</label>
      <select id="transport" v-model="transport">
        <option v-for="option in transportOptions" :key="option.id" :value="option.id">
          {{ option.label }}
        </option>
      </select>
      <pre>{{ configJson }}</pre>
      <p class="meta">{{ endpoint }}</p>
    </section>

    <section class="card" aria-labelledby="settings-heading">
      <h2 id="settings-heading">Settings</h2>
      <label class="check">
        <input
          v-model="backgroundOperations"
          type="checkbox"
          :disabled="busy"
          @change="saveBackgroundOperations"
        />
        <span>Background operations<small>Do not focus tabs while tools run</small></span>
      </label>
      <div class="field-row">
        <label for="timeout">Page message timeout</label>
        <input
          id="timeout"
          v-model.number="contentTimeoutSeconds"
          type="number"
          min="5"
          max="300"
          inputmode="numeric"
          @change="saveTimeout"
        />
        <span class="meta">seconds</span>
      </div>
    </section>

    <section class="card" aria-labelledby="utilities-heading">
      <h2 id="utilities-heading">Utilities</h2>
      <div class="actions">
        <button type="button" @click="startElementMarker">Mark page elements</button>
        <button type="button" @click="openOptions">Proxy &amp; userscripts</button>
        <button ref="errorLogsButton" type="button" @click="openErrorLogs">Error logs</button>
      </div>
      <p v-if="actionMessage" class="meta" role="status">{{ actionMessage }}</p>
    </section>

    <footer class="footer">
      <span>Extension ID: {{ extensionId }}</span>
    </footer>

    <section
      v-if="showLogs"
      class="logs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="logs-heading"
      @keydown.esc="closeLogs"
    >
      <div class="heading-row">
        <h2 id="logs-heading">Error logs</h2>
        <button ref="logsCloseButton" type="button" @click="closeLogs">Close</button>
      </div>
      <textarea readonly :value="logText" aria-label="Error logs"></textarea>
      <div class="actions">
        <button type="button" @click="copyLogs">Copy</button>
        <button type="button" @click="clearLogs">Clear</button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { NativeMessageType } from '@ethanwilkins/chrome-mcp-shared-2026';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';
import { LINKS, STORAGE_KEYS, TIMEOUTS } from '@/common/constants';

type ServerStatus = {
  isRunning: boolean;
  port?: number;
  error?: string;
  lastUpdated: number;
};

type TransportId = 'streamable-http-new' | 'streamable-http' | 'sse' | 'stdio';

type ErrorLog = {
  timestamp: string;
  type: string;
  message: string;
  stack?: string;
};

const extensionId = chrome.runtime.id;
const troubleshootingUrl = LINKS.TROUBLESHOOTING;

const port = ref(12306);
const connected = ref(false);
const connectionState = ref('unknown');
const serverStatus = ref<ServerStatus>({ isRunning: false, lastUpdated: 0 });
const busy = ref(false);
const error = ref('');
const permissionWarning = ref('');
const actionMessage = ref('');

const backgroundOperations = ref(true);
const contentTimeoutSeconds = ref(30);

const transport = ref<TransportId>('streamable-http-new');
const copied = ref(false);

const showLogs = ref(false);
const logs = ref<ErrorLog[]>([]);
const errorLogsButton = ref<HTMLButtonElement | null>(null);
const logsCloseButton = ref<HTMLButtonElement | null>(null);

const statusTone = computed(() => {
  if (!connected.value) return connectionState.value === 'degraded' ? 'warn' : 'off';
  return serverStatus.value.isRunning ? 'ok' : 'warn';
});

const statusText = computed(() => {
  if (!connected.value) return connectionState.value === 'degraded' ? 'Degraded' : 'Not connected';
  return serverStatus.value.isRunning ? 'Server running' : 'Server stopped';
});

const statusDetail = computed(() => {
  if (!connected.value) {
    if (connectionState.value === 'degraded')
      return 'The native host connection dropped. Check the native host process, then reconnect.';
    return 'Not connected to the native host.';
  }
  if (serverStatus.value.isRunning) {
    const updated = serverStatus.value.lastUpdated
      ? ` Last update: ${new Date(serverStatus.value.lastUpdated).toLocaleTimeString()}.`
      : '';
    return `Connected; MCP server listening on 127.0.0.1:${serverStatus.value.port ?? port.value}.${updated}`;
  }
  return (
    serverStatus.value.error ??
    'Native host connected, but its MCP server is not running. Start it below.'
  );
});

const endpointPort = computed(() =>
  serverStatus.value.isRunning ? (serverStatus.value.port ?? port.value) : port.value,
);
const transportPaths: Record<TransportId, string> = {
  'streamable-http-new': '/mcp-new',
  'streamable-http': '/mcp',
  sse: '/sse',
  stdio: '/mcp-new',
};
const endpoint = computed(
  () => `http://127.0.0.1:${endpointPort.value}${transportPaths[transport.value]}`,
);

const transportOptions: Array<{ id: TransportId; label: string }> = [
  { id: 'streamable-http-new', label: 'Streamable HTTP (MCP 2026-07-28)' },
  { id: 'streamable-http', label: 'Streamable HTTP (compatible)' },
  { id: 'sse', label: 'SSE (legacy MCP)' },
  { id: 'stdio', label: 'STDIO bridge' },
];

const configJson = computed(() => {
  const url = endpoint.value;
  const configs: Record<TransportId, unknown> = {
    'streamable-http-new': {
      mcpServers: {
        'streamable-mcp-server-new': { type: 'streamable-http', url },
      },
    },
    'streamable-http': {
      mcpServers: { 'streamable-mcp-server': { type: 'streamable-http', url } },
    },
    sse: { mcpServers: { 'sse-mcp-server': { url } } },
    stdio: {
      mcpServers: {
        'chrome-mcp-stdio': {
          command: 'mcp-chrome-stdio',
          env: { MCP_SERVER_URL: url },
        },
      },
    },
  };
  return JSON.stringify(configs[transport.value], null, 2);
});

const logText = computed(() =>
  logs.value
    .map(
      (entry) =>
        `${entry.timestamp} ${entry.type}: ${entry.message}${entry.stack ? `\n${entry.stack}` : ''}`,
    )
    .join('\n\n'),
);

function applyStatus(response: any) {
  if (response?.serverStatus) serverStatus.value = response.serverStatus;
  if (typeof response?.connected === 'boolean') connected.value = response.connected;
  if (typeof response?.state === 'string') connectionState.value = response.state;
}

async function refreshStatus() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.GET_SERVER_STATUS,
    });
    applyStatus(response);
    if (response?.success) {
      error.value = '';
    } else {
      error.value = response?.error || 'Could not read the native server status.';
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}

async function toggleConnection() {
  if (busy.value) return;
  const connecting = !connected.value;
  busy.value = true;
  error.value = '';
  try {
    if (connecting) {
      const response = await chrome.runtime.sendMessage({
        type: NativeMessageType.CONNECT_NATIVE,
        port: port.value,
      });
      if (!response?.success) throw new Error(response?.error || 'Connection failed');
    } else {
      const response = await chrome.runtime.sendMessage({
        type: NativeMessageType.DISCONNECT_NATIVE,
      });
      if (!response?.success) throw new Error(response?.error || 'Disconnection failed');
    }
    await refreshStatus();
    if (connecting && !connected.value && !error.value) {
      error.value = 'Native host did not connect. Check that it is installed and running.';
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busy.value = false;
  }
}

async function startServer() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const response = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.START_NATIVE_SERVER,
      port: port.value,
    });
    if (!response?.success) throw new Error(response?.error || 'Could not start the MCP server');
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 1500);
    await promise;
    await refreshStatus();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busy.value = false;
  }
}

async function copyConfig() {
  try {
    await navigator.clipboard.writeText(configJson.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch (caught) {
    error.value = `Could not copy config: ${caught instanceof Error ? caught.message : String(caught)}`;
  }
}

async function startElementMarker() {
  actionMessage.value = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id !== 'number') throw new Error('No active tab.');
    const response = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.ELEMENT_MARKER_START,
      tabId: tab.id,
    });
    if (!response?.success) throw new Error(response?.error || 'The active tab did not respond.');
    actionMessage.value = 'Element marker started on this page.';
  } catch (caught) {
    actionMessage.value = `Could not start the element marker: ${
      caught instanceof Error ? caught.message : String(caught)
    }`;
  }
}

async function openOptions() {
  await chrome.runtime.openOptionsPage();
}

async function openErrorLogs() {
  showLogs.value = true;
  await nextTick();
  logsCloseButton.value?.focus();
  try {
    const response = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.GET_ERROR_LOGS,
    });
    logs.value = Array.isArray(response?.logs) ? response.logs : [];
  } catch (caught) {
    actionMessage.value = `Could not read logs: ${
      caught instanceof Error ? caught.message : String(caught)
    }`;
  }
}

function closeLogs() {
  showLogs.value = false;
  void nextTick(() => errorLogsButton.value?.focus());
}

async function copyLogs() {
  try {
    await navigator.clipboard.writeText(logText.value);
    actionMessage.value = 'Logs copied.';
  } catch {
    actionMessage.value = 'Could not copy logs.';
  }
}

async function clearLogs() {
  await chrome.runtime.sendMessage({ type: BACKGROUND_MESSAGE_TYPES.CLEAR_ERROR_LOGS });
  logs.value = [];
}

async function savePort() {
  port.value = Math.min(65535, Math.max(1, Math.round(port.value || 12306)));
  await chrome.storage.local.set({ [STORAGE_KEYS.NATIVE_SERVER_PORT]: port.value });
}

async function loadPort() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.NATIVE_SERVER_PORT);
  const value = Number(stored[STORAGE_KEYS.NATIVE_SERVER_PORT]);
  if (Number.isFinite(value) && value >= 1 && value <= 65535) port.value = value;
}

async function saveBackgroundOperations() {
  await chrome.storage.local.set({ backgroundOperations: backgroundOperations.value });
}

async function loadBackgroundOperations() {
  const stored = await chrome.storage.local.get('backgroundOperations');
  backgroundOperations.value = stored.backgroundOperations !== false;
}

async function saveTimeout() {
  contentTimeoutSeconds.value = Math.min(
    300,
    Math.max(5, Math.round(contentTimeoutSeconds.value || 30)),
  );
  await chrome.storage.local.set({
    [STORAGE_KEYS.CONTENT_MESSAGE_TIMEOUT]: contentTimeoutSeconds.value * 1000,
  });
}

async function loadTimeout() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.CONTENT_MESSAGE_TIMEOUT);
  const timeoutMs = Number(stored[STORAGE_KEYS.CONTENT_MESSAGE_TIMEOUT]);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    contentTimeoutSeconds.value = Math.min(300, Math.max(5, Math.round(timeoutMs / 1000)));
  } else {
    contentTimeoutSeconds.value = TIMEOUTS.CONTENT_MESSAGE_DEFAULT / 1000;
  }
}

async function checkPermissions() {
  try {
    const manifest = chrome.runtime.getManifest();
    const granted = await chrome.permissions.contains({
      // Manifest permission strings are wider than the permissions API union.
      permissions: manifest.permissions as chrome.permissions.Permissions['permissions'],
      origins: manifest.host_permissions ?? [],
    });
    permissionWarning.value = granted
      ? ''
      : 'Required browser permissions are missing. Reload the extension from chrome://extensions.';
  } catch {
    permissionWarning.value = '';
  }
}

function onRuntimeMessage(message: { type?: string; payload?: unknown }) {
  if (message?.type === BACKGROUND_MESSAGE_TYPES.SERVER_STATUS_CHANGED && message.payload) {
    serverStatus.value = message.payload as ServerStatus;
  }
}

onMounted(async () => {
  await Promise.all([loadPort(), loadBackgroundOperations(), loadTimeout(), checkPermissions()]);
  await refreshStatus();
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
});

onUnmounted(() => {
  chrome.runtime.onMessage.removeListener(onRuntimeMessage);
});
</script>

<style scoped>
.popup {
  display: flex;
  flex-direction: column;
  max-height: 640px;
  overflow-y: auto;
  background: #fff;
  color: #111827;
}

.header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid #e5e7eb;
  background: #fff;
}

h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

h2 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #374151;
}

.status-badge {
  padding: 3px 9px;
  border: 1px solid;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.status-ok {
  color: #065f46;
  border-color: #6ee7b7;
  background: #ecfdf5;
}

.status-warn {
  color: #92400e;
  border-color: #fcd34d;
  background: #fffbeb;
}

.status-off {
  color: #374151;
  border-color: #d1d5db;
  background: #f3f4f6;
}

.card {
  padding: 14px 16px;
  border-bottom: 1px solid #e5e7eb;
}

.heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.heading-row h2 {
  margin-bottom: 0;
}

.meta,
.hint {
  margin: 6px 0 0;
  color: #4b5563;
  font-size: 12px;
  line-height: 1.5;
}

.error {
  margin: 8px 0 0;
  padding: 8px 10px;
  border: 1px solid #fecaca;
  border-radius: 6px;
  background: #fef2f2;
  color: #991b1b;
  font-size: 12px;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.field-row label {
  font-size: 13px;
  color: #374151;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

button {
  padding: 7px 11px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  color: #111827;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

button:hover:not(:disabled) {
  background: #f3f4f6;
}

button.primary {
  border-color: #1d4ed8;
  background: #1d4ed8;
  color: #fff;
}

button.primary:hover:not(:disabled) {
  background: #1e40af;
}

button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

button:focus-visible,
input:focus-visible,
select:focus-visible,
a:focus-visible {
  outline: 2px solid #1d4ed8;
  outline-offset: 2px;
}

input,
select {
  min-width: 0;
  padding: 7px 8px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  color: #111827;
  font: inherit;
  font-size: 13px;
}

#port,
#timeout {
  width: 92px;
}

select {
  width: 100%;
  margin-bottom: 8px;
}

.check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 10px;
  font-size: 13px;
  color: #111827;
}

.check input {
  margin-top: 2px;
}

.check small {
  display: block;
  color: #4b5563;
  font-size: 12px;
}

pre {
  max-height: 180px;
  margin: 8px 0;
  padding: 10px;
  overflow: auto;
  border-radius: 6px;
  background: #f3f4f6;
  color: #111827;
  font:
    12px/1.45 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
}

a {
  color: #1d4ed8;
}

.footer {
  padding: 10px 16px;
  color: #4b5563;
  font-size: 11px;
}

.logs {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: #fff;
}

.logs textarea {
  flex: 1;
  min-height: 280px;
  width: 100%;
  padding: 8px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  color: #111827;
  font:
    12px/1.45 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  resize: vertical;
}
</style>
