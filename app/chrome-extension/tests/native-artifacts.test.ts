import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { nativeArtifactSchema, type NativeRequest } from '@ethanwilkins/chrome-mcp-shared-2026';
import { connectNativeHost } from '@/entrypoints/background/native-host';
import * as tools from '@/entrypoints/background/tools';

let disconnect: (() => void) | undefined;

afterEach(() => {
  disconnect?.();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('sends large tool images as binary artifacts and keeps non-image results labelled as JSON', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('crypto', webcrypto);
  let receive: ((message: NativeRequest) => Promise<void>) | undefined;
  const postMessage = vi.fn();
  vi.stubGlobal('chrome', {
    ...chrome,
    runtime: {
      ...chrome.runtime,
      connectNative: vi.fn(() => ({
        postMessage,
        onMessage: {
          addListener: (callback: (message: NativeRequest) => Promise<void>) => {
            receive = callback;
          },
        },
        onDisconnect: {
          addListener: (callback: () => void) => {
            disconnect = callback;
          },
        },
      })),
    },
  });
  const image = Buffer.alloc(400_000, 0x33);
  image.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const execute = vi.spyOn(tools, 'handleCallTool').mockResolvedValue({
    isError: false,
    content: [
      {
        type: 'text',
        text: JSON.stringify({ base64Data: image.toString('base64'), mimeType: 'image/png' }),
      },
    ],
  });
  connectNativeHost();
  if (!receive) throw new Error('Native request listener was not registered');
  const request: NativeRequest = {
    version: 2,
    type: 'request',
    requestId: 'image-artifact',
    traceId: 'artifact-regression',
    method: 'browser.callTool',
    deadlineAt: Date.now() + 30_000,
    params: { name: 'chrome_screenshot', args: {} },
  };
  postMessage.mockClear();
  await receive(request);
  const chunks = postMessage.mock.calls
    .map(([message]) => nativeArtifactSchema.safeParse(message))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  expect(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data ?? '', 'base64')))).toEqual(
    image,
  );
  expect(chunks.every((chunk) => chunk.contentType === 'image/png')).toBe(true);

  const text = 'Screenshot failed: '.padEnd(300_000, 'x');
  execute.mockResolvedValue({ isError: true, content: [{ type: 'text', text }] });
  postMessage.mockClear();
  await receive({ ...request, requestId: 'json-artifact' });
  const jsonChunks = postMessage.mock.calls
    .map(([message]) => nativeArtifactSchema.safeParse(message))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  const result = JSON.parse(
    Buffer.concat(jsonChunks.map((chunk) => Buffer.from(chunk.data ?? '', 'base64'))).toString(),
  );
  expect(result.data.isError).toBe(true);
  expect(result.data.content[0].text).toBe(text);
  expect(jsonChunks.every((chunk) => chunk.contentType === 'application/json')).toBe(true);
});
