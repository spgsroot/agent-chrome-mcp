import { afterEach, describe, expect, jest, test } from '@jest/globals';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type ServerInstance from './index';
import type NativeHostInstance from '../native-messaging-host';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ALLOWED_ORIGIN = 'chrome-extension://mcp-lifecycle-test';

type Server = typeof ServerInstance;

/** Fastify cannot listen again after close(), so every test gets a fresh singleton. */
function loadServer(): { server: Server; nativeHost: typeof NativeHostInstance } {
  let loaded!: { server: Server; nativeHost: typeof NativeHostInstance };
  jest.isolateModules(() => {
    loaded = {
      server: require('./index').default,
      nativeHost: require('../native-messaging-host').default,
    };
  });
  return loaded;
}

async function startServer(): Promise<{ server: Server; port: number }> {
  const { server, nativeHost } = loadServer();
  await server.start(0, nativeHost);
  started.push(server);
  return { server, port: (server.getInstance().server.address() as AddressInfo).port };
}

/** Open the standing GET stream a Streamable HTTP MCP client keeps per session. */
async function openMcpStream(port: number): Promise<http.ClientRequest> {
  const init = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      Origin: ALLOWED_ORIGIN,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'lifecycle-test', version: '0' },
      },
    }),
  });
  await init.text();
  const sessionId = init.headers.get('mcp-session-id');
  if (!sessionId) throw new Error(`initialize returned ${init.status} without a session`);

  const { promise, resolve, reject } = Promise.withResolvers<http.ClientRequest>();
  const request = http.get(
    {
      host: '127.0.0.1',
      port,
      path: '/mcp',
      headers: { Origin: ALLOWED_ORIGIN, Accept: 'text/event-stream', 'Mcp-Session-Id': sessionId },
    },
    (response) => {
      response.on('error', () => undefined);
      if (response.statusCode === 200) resolve(request);
      else reject(new Error(`MCP stream returned ${response.statusCode}`));
    },
  );
  request.on('error', () => undefined);
  return promise;
}

// Real deadline on purpose: the failure being guarded is a close() that never settles.
function within<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  const deadline = Promise.withResolvers<'timeout'>();
  setTimeout(() => deadline.resolve('timeout'), ms).unref();
  return Promise.race([promise, deadline.promise]);
}

function postTakeover(
  port: number,
  origin: string | null = 'chrome-extension://mcp-stdio',
): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const request = http.request(
    {
      host: '127.0.0.1',
      port,
      path: '/__chrome_mcp_bridge/takeover',
      method: 'POST',
      headers: origin ? { Origin: origin } : {},
    },
    (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    },
  );
  request.on('error', reject);
  request.end();
  return promise;
}

const started: Server[] = [];
const previousStandalone = process.env.CHROME_MCP_STANDALONE;
const previousChromePort = process.env.CHROME_MCP_PORT;
const previousHttpPort = process.env.MCP_HTTP_PORT;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function listenOnLoopback(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return (server.address() as AddressInfo).port;
}

async function closeHttpServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('Server lifecycle', () => {
  afterEach(async () => {
    restoreEnv('CHROME_MCP_STANDALONE', previousStandalone);
    restoreEnv('CHROME_MCP_PORT', previousChromePort);
    restoreEnv('MCP_HTTP_PORT', previousHttpPort);
    for (const server of started.splice(0)) await within(server.stop(), 2_000);
    jest.restoreAllMocks();
  });

  test('the Chrome-launched host waits for native.start and binds the requested loopback port', async () => {
    delete process.env.CHROME_MCP_STANDALONE;
    delete process.env.CHROME_MCP_PORT;
    delete process.env.MCP_HTTP_PORT;
    const { server, nativeHost } = loadServer();
    started.push(server);
    nativeHost.setServer(server);
    const input = nativeHost as unknown as {
      setupMessageHandling(): void;
      handleMessage(message: unknown): Promise<void>;
    };
    jest.spyOn(input, 'setupMessageHandling').mockImplementation(() => undefined);
    const send = jest.spyOn(nativeHost, 'sendMessage').mockImplementation(() => undefined);
    const start = jest.spyOn(server, 'start');
    const occupied = http.createServer((_request, response) => {
      response.statusCode = 404;
      response.end();
    });
    const port = await listenOnLoopback(occupied);
    const requestStart = (requestId: string) =>
      input.handleMessage({
        version: 2,
        type: 'request',
        requestId,
        traceId: requestId,
        method: 'native.start',
        deadlineAt: Date.now() + 5_000,
        params: { port },
      });

    try {
      nativeHost.start();
      expect(start).not.toHaveBeenCalled();
      expect(server.getInstance().server.address()).toBeNull();

      await requestStart('occupied');
      expect(server.getInstance().server.address()).toBeNull();
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'native.serverStartFailed',
          data: { message: expect.stringContaining(String(port)) },
        }),
      );
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'occupied', ok: false }),
      );
      expect(send).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: 'native.serverStarted' }),
      );
    } finally {
      await closeHttpServer(occupied);
    }

    await requestStart('available');
    expect(server.getInstance().server.address()).toMatchObject({ address: '127.0.0.1', port });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'native.serverStarted', data: { port } }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'available', ok: true }),
    );
    const response = await fetch(`http://127.0.0.1:${port}/ping`);
    await expect(response.json()).resolves.toEqual({ status: 'ok', message: 'pong' });
  });

  test('stop() releases the port while an MCP client holds a stream open', async () => {
    const { server, port } = await startServer();
    const stream = await openMcpStream(port);

    // A hung close() leaves a host that holds the extension but no listener.
    const outcome = await within(server.stop(), 3_000);
    stream.destroy();

    expect(outcome).not.toBe('timeout');
    expect(server.isRunning).toBe(false);
  }, 10_000);

  test.each([false, true])(
    'legacy SSE completes the MCP exchange (after /mcp: %s)',
    async (useHttpFirst) => {
      const { server, nativeHost } = loadServer();
      await server.start(0, nativeHost);
      started.push(server);
      const base = `http://127.0.0.1:${server.listeningPort}`;
      const previousKey = process.env.CHROME_MCP_API_KEY;
      process.env.CHROME_MCP_API_KEY = 'sse-regression-test';
      const headers = { Authorization: 'Bearer sse-regression-test' };
      const authenticatedFetch: typeof fetch = (input, init) => {
        const requestHeaders = new Headers(init?.headers);
        requestHeaders.set('Authorization', headers.Authorization);
        return fetch(input, {
          ...init,
          headers: requestHeaders,
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(2_000)])
            : AbortSignal.timeout(2_000),
        });
      };
      const legacy = new Client({ name: 'legacy-test', version: '1' });
      const httpClient = new Client({ name: 'http-test', version: '1' });
      jest.spyOn(nativeHost, 'isExtensionConnected').mockReturnValue(true);
      jest.spyOn(nativeHost, 'sendRequestToExtensionAndWait').mockResolvedValue({
        status: 'success',
        data: { content: [{ type: 'text', text: 'local demo' }], isError: false },
      });
      try {
        if (useHttpFirst) {
          await expect(
            within(
              httpClient.connect(
                new StreamableHTTPClientTransport(new URL('/mcp', base), {
                  requestInit: { headers },
                }),
              ),
              2_000,
            ),
          ).resolves.toBeUndefined();
          const tools = await httpClient.listTools({}, { timeout: 2_000 });
          expect(tools.tools.some((tool) => tool.name === 'chrome_get_tab_url')).toBe(true);
        }
        const rejected = await fetch(new URL('/sse', base), { signal: AbortSignal.timeout(2_000) });
        expect(rejected.status).toBe(401);
        await rejected.text();
        await expect(
          within(
            legacy.connect(
              new SSEClientTransport(new URL('/sse', base), {
                eventSourceInit: { fetch: authenticatedFetch },
                requestInit: { headers },
              }),
            ),
            2_000,
          ),
        ).resolves.toBeUndefined();
        const tools = await legacy.listTools({}, { timeout: 2_000 });
        expect(tools.tools.some((tool) => tool.name === 'chrome_get_tab_url')).toBe(true);
        await expect(
          legacy.callTool({ name: 'chrome_get_tab_url', arguments: { tabId: 17 } }, undefined, {
            timeout: 2_000,
          }),
        ).resolves.toMatchObject({
          content: [{ type: 'text', text: 'local demo' }],
          isError: false,
        });
      } finally {
        await legacy.close();
        await httpClient.close();
        restoreEnv('CHROME_MCP_API_KEY', previousKey);
      }
    },
    10_000,
  );

  test('a Chrome-launched native host refuses to hand over its port', async () => {
    delete process.env.CHROME_MCP_STANDALONE;
    // Guards the test runner if the refusal regresses into a scheduled exit.
    jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { server, port } = await startServer();

    expect(await postTakeover(port)).toBe(404);
    expect(server.isRunning).toBe(true);
  });

  test('takeover rejects a browser origin and accepts the native control origin', async () => {
    process.env.CHROME_MCP_STANDALONE = '1';
    const exited = Promise.withResolvers<unknown>();
    jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exited.resolve(code);
    }) as never);
    const { server, port } = await startServer();

    expect(await postTakeover(port, 'http://localhost:5173')).toBe(403);
    expect(await postTakeover(port, null)).toBe(403);
    expect(await postTakeover(port)).toBe(200);
    expect(await within(exited.promise, 3_000)).toBe(0);
    expect(server.isRunning).toBe(false);
  });

  test('a standalone service yields its port to the native host', async () => {
    process.env.CHROME_MCP_STANDALONE = '1';
    const exited = Promise.withResolvers<unknown>();
    jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exited.resolve(code);
    }) as never);
    const { server, port } = await startServer();

    expect(await postTakeover(port)).toBe(200);
    expect(await within(exited.promise, 3_000)).toBe(0);
    expect(server.isRunning).toBe(false);
  });
});
