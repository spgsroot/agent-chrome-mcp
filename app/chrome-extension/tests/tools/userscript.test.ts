import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { STORAGE_KEYS } from '@/common/constants';
import { userscriptTool } from '@/entrypoints/background/tools/browser/userscript';

const url = 'http://127.0.0.1:8765/demo';
const optionsUrl = 'chrome-extension://test-extension-id/options.html';
const insertCSS = vi.fn();
const script = 'h1 { color: red; }';

beforeEach(() => {
  insertCSS.mockReset();
  vi.stubGlobal('chrome', {
    ...chrome,
    runtime: { ...chrome.runtime, getURL: () => optionsUrl },
    scripting: { insertCSS },
  });
  vi.mocked(chrome.tabs.query).mockReset();
  vi.spyOn(chrome.storage.local, 'get').mockImplementation(() => Promise.resolve({}));
});
afterEach(() => vi.unstubAllGlobals());

describe('userscript page scope', () => {
  test.each([
    ['explicit HTTP matches HTTP', url, 'http://127.0.0.1/*', '', true],
    ['explicit HTTPS matches HTTPS', 'https://127.0.0.1/demo', 'https://127.0.0.1/*', '', true],
    ['explicit HTTPS does not match HTTP', url, 'https://127.0.0.1/*', '', false],
    ['HTTP Excludes takes priority', url, 'http://127.0.0.1/*', 'http://127.0.0.1/demo*', false],
    ['HTTPS Excludes does not block HTTP', url, 'http://127.0.0.1/*', 'https://127.0.0.1/*', true],
  ])('%s', async (_name, pageUrl, match, exclude, applies) => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([{ id: 17, url: pageUrl } as chrome.tabs.Tab]);
    const result = await userscriptTool.execute({
      action: 'create',
      args: { script, matches: [match], excludes: exclude ? [exclude] : [], mode: 'css' },
    });
    expect(result.isError).toBe(false);
    expect(insertCSS).toHaveBeenCalledTimes(applies ? 1 : 0);
  });

  test.each([{ matches: undefined }, { matches: ['http://127.0.0.1/*'] }])(
    'targets the last web tab from Options with Matches $matches',
    async ({ matches }) => {
      vi.mocked(chrome.tabs.query)
        .mockResolvedValueOnce([{ id: 2, url: optionsUrl, windowId: 1 } as chrome.tabs.Tab])
        .mockResolvedValueOnce([
          { id: 3, url: 'https://example.com/', lastAccessed: 1 } as chrome.tabs.Tab,
          { id: 17, url, lastAccessed: 2 } as chrome.tabs.Tab,
        ]);
      const result = await userscriptTool.execute({
        action: 'create',
        args: { script, mode: 'css', matches },
      });
      expect(result.isError).toBe(false);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [STORAGE_KEYS.USERSCRIPTS]: expect.objectContaining({
          [JSON.parse((result.content[0] as { text: string }).text).id]: expect.objectContaining({
            matches: matches ?? ['http://*.127.0.0.1/*', 'http://127.0.0.1/*'],
          }),
        }),
      });
      expect(insertCSS).toHaveBeenCalledWith({
        target: { tabId: 17, allFrames: true },
        css: script,
      });
    },
  );
  test('requires browser opt-in for JavaScript and targets only documents in scope', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([{ id: 17, url } as chrome.tabs.Tab]);
    const request = {
      action: 'create' as const,
      args: {
        script: 'document.title = "Local demo";',
        matches: ['http://127.0.0.1/*'],
        excludes: ['http://127.0.0.1/private*'],
      },
    };
    const unavailable = await userscriptTool.execute(request);
    expect(unavailable.isError).toBe(true);
    expect(unavailable.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining('Allow User Scripts') }),
    ]);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    const execute = vi.fn().mockResolvedValue([{ frameId: 0 }]);
    const getScripts = vi.fn().mockResolvedValue([]);
    const getAllFrames = vi.fn().mockResolvedValue([
      { frameId: 0, documentId: 'top', url },
      { frameId: 1, documentId: 'included', url: 'http://127.0.0.1/demo/child' },
      { frameId: 2, documentId: 'excluded', url: 'http://127.0.0.1/private' },
      { frameId: 3, documentId: 'wrong-scheme', url: 'https://127.0.0.1/demo' },
    ]);
    vi.stubGlobal('chrome', {
      ...chrome,
      userScripts: { execute, getScripts },
      webNavigation: { ...chrome.webNavigation, getAllFrames },
    });
    const result = await userscriptTool.execute(request);
    expect(result.isError).toBe(false);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 17, documentIds: ['top', 'included'] },
        world: 'USER_SCRIPT',
      }),
    );
    getScripts.mockRejectedValue(new Error('Allow User Scripts was turned off'));
    await expect(userscriptTool.execute(request)).resolves.toMatchObject({ isError: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test('keeps a later script and a removal when an earlier execution fails', async () => {
    const execution = Promise.withResolvers<chrome.userScripts.InjectionResult[]>();
    const entered = Promise.withResolvers<void>();
    const stored: Record<string, unknown> = {};
    const execute = vi.fn(() => {
      entered.resolve();
      return execution.promise;
    });
    vi.mocked(chrome.tabs.query).mockResolvedValue([{ id: 17, url } as chrome.tabs.Tab]);
    vi.stubGlobal('chrome', {
      ...chrome,
      storage: {
        local: {
          get: async () => structuredClone(stored),
          set: async (values: Record<string, unknown>) =>
            Object.assign(stored, structuredClone(values)),
        },
      },
      userScripts: { execute, getScripts: vi.fn().mockResolvedValue([]) },
      webNavigation: {
        ...chrome.webNavigation,
        getAllFrames: vi.fn().mockResolvedValue([{ frameId: 0, url, documentId: 'top' }]),
      },
    });
    const slow = userscriptTool.execute({
      action: 'create',
      args: { script: 'document.title = "First";', matches: ['http://127.0.0.1/*'] },
    });
    await entered.promise;
    const list = await userscriptTool.execute({ action: 'list', args: {} });
    const [{ id }] = JSON.parse((list.content[0] as { text: string }).text).items;
    await userscriptTool.execute({ action: 'create', args: { script, mode: 'css' } });
    await userscriptTool.execute({ action: 'remove', args: { id } });
    execution.reject(new Error('Delayed script failure'));
    await slow;
    const records = stored[STORAGE_KEYS.USERSCRIPTS] as Record<string, { script: string }>;
    expect(Object.values(records)).toMatchObject([{ script }]);
    expect(records[id]).toBeUndefined();
  });
});
