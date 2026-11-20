import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { STORAGE_KEYS } from '@/common/constants';
import { getUserScriptApi, USER_SCRIPT_ACCESS_HELP } from '@/common/userscript-api';

type UserscriptAction =
  | 'create'
  | 'list'
  | 'get'
  | 'enable'
  | 'disable'
  | 'update'
  | 'remove'
  | 'send_command'
  | 'export';

interface UserscriptArgsBase {
  action: UserscriptAction;
  args?: any;
}

interface CreateArgs {
  script: string;
  name?: string;
  description?: string;
  matches?: string[];
  excludes?: string[];
  persist?: boolean; // default true
  runAt?: 'document_start' | 'document_end' | 'document_idle' | 'auto'; // default auto(document_idle)
  world?: 'auto' | 'ISOLATED' | 'MAIN'; // default auto(ISOLATED)
  allFrames?: boolean; // default true
  mode?: 'auto' | 'css' | 'persistent' | 'once'; // default auto
  dnrFallback?: boolean; // default true
  tags?: string[];
}

type UpdateArgs = Partial<Omit<CreateArgs, 'script'>> & { id: string; script?: string };

interface UserscriptRecord {
  id: string;
  name?: string;
  description?: string;
  script: string;
  sourceType: 'JS' | 'CSS' | 'TM';
  matches: string[];
  excludes: string[];
  runAt: 'document_start' | 'document_end' | 'document_idle';
  world: 'ISOLATED' | 'MAIN';
  allFrames: boolean;
  persist: boolean;
  dnrFallback: boolean;
  tags?: string[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  installedBy?: string;
  lastError?: string;
  applyCount?: number;
  lastAppliedAt?: number;
  sha256?: string;
  cspBlocked?: boolean;
}

async function loadAllRecords(): Promise<Record<string, UserscriptRecord>> {
  const res = await chrome.storage.local.get([STORAGE_KEYS.USERSCRIPTS]);
  return (res[STORAGE_KEYS.USERSCRIPTS] as Record<string, UserscriptRecord>) || {};
}

async function saveAllRecords(records: Record<string, UserscriptRecord>): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.USERSCRIPTS]: records });
}

// Simple FNV-1a hash for deterministic IDs
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  // Force to unsigned and hex
  return (h >>> 0).toString(16);
}

function now(): number {
  return Date.now();
}

async function computeSHA256(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function parseUserscriptMeta(source: string): {
  meta: Record<string, string[]>;
  isTM: boolean;
} {
  const meta: Record<string, string[]> = {};
  const start = source.indexOf('==UserScript==');
  const end = source.indexOf('==/UserScript==');
  if (start !== -1 && end !== -1 && end > start) {
    const block = source.slice(start, end).split(/\r?\n/);
    for (const line of block) {
      const m = line.match(/@([\w-]+)\s+(.+)/);
      if (m) {
        const k = m[1].trim();
        const v = m[2].trim();
        if (!meta[k]) meta[k] = [];
        meta[k].push(v);
      }
    }
    return { meta, isTM: true };
  }
  return { meta: {}, isTM: false };
}

function pick<T>(arr: T[] | undefined): T | undefined {
  return arr && arr.length > 0 ? arr[0] : undefined;
}

function deriveName(meta: Record<string, string[]>, fallback?: string): string | undefined {
  return pick(meta['name']) || fallback;
}

function toBoolean(val: any, d: boolean): boolean {
  return typeof val === 'boolean' ? val : d;
}

// Very light CSS heuristic
function isLikelyCSS(source: string): boolean {
  const trimmed = source.trim();
  if (trimmed.startsWith('/*') && trimmed.includes('==UserStyle')) return true;
  if (/^[.#\w\-\s*,:>+~\n\r{}();'"%!@/]+$/.test(trimmed)) {
    // no obvious JS keywords
    if (
      !/(function|=>|var\s|let\s|const\s|document\.|window\.|\beval\b|new\s+Function)/.test(trimmed)
    ) {
      // has CSS braces and colons
      const colon = (trimmed.match(/:/g) || []).length;
      const brace = (trimmed.match(/[{}]/g) || []).length;
      return colon > 0 && brace >= 2;
    }
  }
  return false;
}

function normalizeMatches(matches?: string[], currentUrl?: string): string[] {
  if (matches && matches.length > 0) return matches;
  if (!currentUrl) return ['<all_urls>'];
  try {
    const u = new URL(currentUrl);
    const host = u.hostname;
    const base = host.startsWith('www.') ? host.slice(4) : host;
    return [`${u.protocol}//*.${base}/*`, `${u.protocol}//${host}/*`];
  } catch {
    return ['<all_urls>'];
  }
}

// Simple URL match using chrome match patterns subset
function matchUrl(patterns: string[], url?: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    for (const p of patterns) {
      if (p === '<all_urls>') return true;
      const m = p.match(/^(\*|https?:)\/\/([^/]+)\/(.*)$/);
      if (!m) continue;
      const proto = m[1];
      const host = m[2];
      const path = m[3];
      if (proto !== '*' && proto !== u.protocol) continue;
      // host wildcard
      const hostRegex = new RegExp(
        '^' +
          host
            .split('.')
            .map((h) => (h === '*' ? '[^.]+' : h.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')))
            .join('\\.') +
          '$',
      );
      if (!hostRegex.test(u.hostname)) continue;
      // path wildcard
      const pathRegex = new RegExp(
        '^' + path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
      );
      const testPath = (u.pathname + (u.search || '') + (u.hash || '')).replace(/^\//, '');
      if (pathRegex.test(testPath)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function shouldApply(record: UserscriptRecord, url?: string): boolean {
  return matchUrl(record.matches, url) && !matchUrl(record.excludes, url);
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function insertCssToTab(tabId: number, css: string, allFrames: boolean) {
  await chrome.scripting.insertCSS({ target: { tabId, allFrames }, css });
}

async function removeCssFromTab(tabId: number, css: string, allFrames: boolean) {
  try {
    await chrome.scripting.removeCSS({ target: { tabId, allFrames }, css });
  } catch (e) {
    // ignore if not present
  }
}

async function executeUserScript(
  tabId: number,
  record: UserscriptRecord,
  code: string,
  allFrames = record.allFrames,
): Promise<chrome.userScripts.InjectionResult[]> {
  const api = getUserScriptApi();
  if (!api) throw new Error(USER_SCRIPT_ACCESS_HELP);

  // Use document IDs so navigation between the scope check and execution cannot
  // run a script in a different document. Each selected frame must also match.
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  const top = frames?.find((frame) => frame.frameId === 0);
  if (!top || !shouldApply(record, top.url)) return [];
  const documentIds = allFrames
    ? (frames ?? [])
        .filter((frame) => shouldApply(record, frame.url))
        .map((frame) => frame.documentId)
    : [top.documentId];
  const world = record.world === 'MAIN' ? 'MAIN' : 'USER_SCRIPT';
  const results = await api.execute({
    target: { tabId, documentIds },
    js: [{ code }],
    world,
    ...(world === 'USER_SCRIPT' ? { worldId: record.id } : {}),
    injectImmediately: true,
  });
  const error = results.find((result) => result.error)?.error;
  if (error) throw new Error(error);
  return results;
}

async function applyRecord(tabId: number, record: UserscriptRecord): Promise<boolean> {
  if (record.sourceType === 'CSS') {
    await insertCssToTab(tabId, record.script, record.allFrames);
    return true;
  }
  const results = await executeUserScript(
    tabId,
    record,
    `(async () => {
${record.script}
})()`,
  );
  return results.length > 0;
}

async function reinjectForTab(tabId: number, url?: string) {
  // Emergency global switch
  const flag = (await chrome.storage.local.get([STORAGE_KEYS.USERSCRIPTS_DISABLED]))[
    STORAGE_KEYS.USERSCRIPTS_DISABLED
  ];
  if (flag) return;
  const all = await loadAllRecords();
  for (const rec of Object.values(all)) {
    if (!rec.enabled || !rec.persist || rec.runAt !== 'document_idle') continue;
    if (!shouldApply(rec, url)) continue;
    try {
      if (rec.sourceType === 'CSS' || getUserScriptApi()) await applyRecord(tabId, rec);
    } catch (e) {
      console.warn('Reinject failed for tab', tabId, rec.id, e);
    }
  }
}

// Tab update listener: re-apply enabled persistent scripts
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    reinjectForTab(tabId, tab.url).catch(() => {});
  }
});

// webNavigation based runAt mapping
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const tab = await chrome.tabs.get(details.tabId).catch(() => null);
  if (!tab) return;
  const disabled = (await chrome.storage.local.get([STORAGE_KEYS.USERSCRIPTS_DISABLED]))[
    STORAGE_KEYS.USERSCRIPTS_DISABLED
  ];
  if (disabled) return;
  const all = await loadAllRecords();
  for (const rec of Object.values(all)) {
    if (!rec.enabled || !rec.persist || rec.runAt !== 'document_start') continue;
    if (!shouldApply(rec, tab.url)) continue;
    try {
      if (rec.sourceType === 'CSS' || getUserScriptApi()) await applyRecord(details.tabId, rec);
    } catch {
      // noop
    }
  }
});

chrome.webNavigation.onDOMContentLoaded.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const tab = await chrome.tabs.get(details.tabId).catch(() => null);
  if (!tab) return;
  const disabled = (await chrome.storage.local.get([STORAGE_KEYS.USERSCRIPTS_DISABLED]))[
    STORAGE_KEYS.USERSCRIPTS_DISABLED
  ];
  if (disabled) return;
  const all = await loadAllRecords();
  for (const rec of Object.values(all)) {
    if (!rec.enabled || !rec.persist || rec.runAt !== 'document_end') continue;
    if (!shouldApply(rec, tab.url)) continue;
    try {
      if (rec.sourceType === 'CSS' || getUserScriptApi()) await applyRecord(details.tabId, rec);
    } catch {
      // noop
    }
  }
});

class UserscriptTool extends BaseBrowserToolExecutor {
  name = 'chrome_userscript';

  async execute(params: UserscriptArgsBase): Promise<ToolResult> {
    try {
      const { action } = params;
      const args = params.args || {};

      switch (action) {
        case 'create':
          return await this.create(args as CreateArgs);
        case 'list':
          return await this.list(args);
        case 'get':
          return await this.get(args);
        case 'enable':
          return await this.enable(args, true);
        case 'disable':
          return await this.enable(args, false);
        case 'update':
          return await this.update(args as UpdateArgs);
        case 'remove':
          return await this.remove(args);
        case 'send_command':
          return await this.sendCommand(args);
        case 'export':
          return await this.exportAll();
        default:
          return createErrorResponse(`Unknown action: ${String(action)}`);
      }
    } catch (error) {
      console.error('Userscript tool error:', error);
      return createErrorResponse(
        `Userscript error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async create(args: CreateArgs): Promise<ToolResult> {
    if (typeof args.script !== 'string' || !args.script.trim()) {
      return createErrorResponse('script is required and cannot be empty');
    }
    let active = await getActiveTab();
    if (!active || !active.id) return createErrorResponse('No active tab found');

    const emergency = (await chrome.storage.local.get([STORAGE_KEYS.USERSCRIPTS_DISABLED]))[
      STORAGE_KEYS.USERSCRIPTS_DISABLED
    ];

    const { meta, isTM } = parseUserscriptMeta(args.script);
    const name = args.name || deriveName(meta, undefined);
    const description = args.description || pick(meta['description']);
    const requestedMatches = args.matches || meta['match'] || meta['include'];
    if (!requestedMatches?.length && active.url === chrome.runtime.getURL('options.html')) {
      const tabs = await chrome.tabs.query({ windowId: active.windowId });
      active = tabs
        .filter((tab) => tab.id && /^https?:\/\//.test(tab.url ?? ''))
        .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
      if (!active) return createErrorResponse('Open a web page or enter a Matches pattern.');
    }
    const currentUrl = active.url;
    const matches = normalizeMatches(requestedMatches, currentUrl);
    const excludes = args.excludes || meta['exclude'] || [];

    const runAt: UserscriptRecord['runAt'] =
      (args.runAt && args.runAt !== 'auto' ? args.runAt : (pick(meta['run-at']) as any)) ||
      'document_idle';
    const requestedWorld =
      (args.world && args.world !== 'auto' ? args.world : (pick(meta['inject-into']) as any)) ||
      'ISOLATED';
    const allFrames = toBoolean(args.allFrames, true);
    const persist = args.mode !== 'once' && toBoolean(args.persist, true);
    const dnrFallback = toBoolean(args.dnrFallback, true);
    const mode = args.mode || 'auto';

    const sourceType: UserscriptRecord['sourceType'] = isTM
      ? 'TM'
      : mode === 'css' || isLikelyCSS(args.script)
        ? 'CSS'
        : 'JS';

    if (sourceType !== 'CSS' && !getUserScriptApi()) {
      return createErrorResponse(USER_SCRIPT_ACCESS_HELP);
    }

    const sha256 = await computeSHA256(args.script).catch(() => undefined);
    const id = `us_${fnv1a((name || '') + '|' + args.script)}`;

    const record: UserscriptRecord = {
      id,
      name,
      description,
      script: args.script,
      sourceType,
      matches,
      excludes,
      runAt,
      world: requestedWorld === 'MAIN' ? 'MAIN' : 'ISOLATED',
      allFrames,
      persist,
      dnrFallback,
      tags: args.tags,
      enabled: true,
      createdAt: now(),
      updatedAt: now(),
      applyCount: 0,
      sha256,
    };

    const all = await loadAllRecords();
    if (record.persist) {
      all[id] = record;
      await saveAllRecords(all);
    }

    if (emergency) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              id,
              status: 'queued',
              warnings: ['USERSCRIPTS_DISABLED is ON, injection skipped'],
            }),
          },
        ],
        isError: false,
      };
    }

    const startedAt = performance.now();
    let applied = false;
    let warning: string | undefined;
    try {
      if (shouldApply(record, currentUrl)) applied = await applyRecord(active.id!, record);
    } catch (error) {
      warning = error instanceof Error ? error.message : String(error);
      if (record.persist) {
        record.lastError = warning;
        await saveAllRecords(all);
      }
    }

    const result = {
      id,
      status: applied ? 'applied' : 'queued',
      strategy: {
        kind:
          sourceType === 'CSS'
            ? 'insertCSS'
            : mode === 'once'
              ? 'once_user_script'
              : `persistent_${record.world.toLowerCase()}`,
        runAt: record.runAt,
        world: record.world,
        allFrames: record.allFrames,
        fallbacksTried: [],
        cspBlocked: false,
      },
      warnings: warning ? [warning] : [],
      metrics: { injectMs: Math.round(performance.now() - startedAt) },
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      isError: false,
    };
  }

  private async list(args: any): Promise<ToolResult> {
    const all = await loadAllRecords();
    const q = (args && args.query ? String(args.query).toLowerCase() : '').trim();
    const status = args && args.status ? String(args.status) : '';
    const domain = args && args.domain ? String(args.domain) : '';
    const items = Object.values(all)
      .filter((r) => (status ? (status === 'enabled' ? r.enabled : !r.enabled) : true))
      .filter(
        (r) =>
          !domain ||
          matchUrl(r.matches, `https://${domain}/`) ||
          matchUrl(r.matches, `http://${domain}/`),
      )
      .filter((r) =>
        q
          ? (r.name || '').toLowerCase().includes(q) ||
            (r.description || '').toLowerCase().includes(q)
          : true,
      )
      .map((r) => ({
        id: r.id,
        name: r.name,
        status: r.enabled ? 'enabled' : 'disabled',
        sourceType: r.sourceType,
        matches: r.matches,
        world: r.world,
        runAt: r.runAt,
        tags: r.tags || [],
        lastError: r.lastError,
        updatedAt: r.updatedAt,
        applyCount: r.applyCount || 0,
        lastAppliedAt: r.lastAppliedAt || null,
      }));
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true, items }) }],
      isError: false,
    };
  }

  private async get(args: any): Promise<ToolResult> {
    const { id } = args || {};
    if (!id) return createErrorResponse('id is required');
    const all = await loadAllRecords();
    const rec = all[id];
    if (!rec) return createErrorResponse('userscript not found');
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true, record: rec }) }],
      isError: false,
    };
  }

  private async enable(args: any, enabled: boolean): Promise<ToolResult> {
    const { id } = args || {};
    if (!id) return createErrorResponse('id is required');
    const all = await loadAllRecords();
    const rec = all[id];
    if (!rec) return createErrorResponse('userscript not found');
    rec.enabled = enabled;
    rec.updatedAt = now();
    await saveAllRecords(all);
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }], isError: false };
  }

  private async update(args: UpdateArgs): Promise<ToolResult> {
    const { id, ...rest } = args;
    if (!id) return createErrorResponse('id is required');
    const all = await loadAllRecords();
    const rec = all[id];
    if (!rec) return createErrorResponse('userscript not found');

    if (rest.name !== undefined) rec.name = rest.name;
    if (rest.description !== undefined) rec.description = rest.description;
    if (rest.matches) rec.matches = rest.matches;
    if (rest.excludes) rec.excludes = rest.excludes;
    if (rest.runAt && rest.runAt !== 'auto') rec.runAt = rest.runAt;
    if (rest.world && rest.world !== 'auto') rec.world = rest.world as any;
    if (typeof rest.allFrames === 'boolean') rec.allFrames = rest.allFrames;
    if (typeof rest.persist === 'boolean') rec.persist = rest.persist;
    if (typeof rest.dnrFallback === 'boolean') rec.dnrFallback = rest.dnrFallback;
    if (rest.tags) rec.tags = rest.tags;
    if (typeof rest.script === 'string') rec.script = rest.script;
    rec.updatedAt = now();
    await saveAllRecords(all);
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }], isError: false };
  }

  private async remove(args: any): Promise<ToolResult> {
    const { id } = args || {};
    if (!id) return createErrorResponse('id is required');
    const all = await loadAllRecords();
    const rec = all[id];
    if (!rec) return createErrorResponse('userscript not found');
    delete all[id];
    await saveAllRecords(all);

    if (rec.sourceType === 'CSS') {
      const active = await getActiveTab();
      if (active?.id) await removeCssFromTab(active.id, rec.script, rec.allFrames);
    }

    return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }], isError: false };
  }

  private async sendCommand(args: any): Promise<ToolResult> {
    const { id, payload, tabId } = args || {};
    if (!id) return createErrorResponse('id is required');
    const tab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : await getActiveTab();
    if (!tab || !tab.id) return createErrorResponse('No active tab found');

    const all = await loadAllRecords();
    const rec = all[id];
    if (!rec) return createErrorResponse('userscript not found');

    const storage = await chrome.storage.local.get([STORAGE_KEYS.USERSCRIPTS_DISABLED]);
    if (storage[STORAGE_KEYS.USERSCRIPTS_DISABLED] || !rec.enabled || !shouldApply(rec, tab.url)) {
      return createErrorResponse('The userscript is disabled or does not match the target tab.');
    }

    try {
      const [execution] = await executeUserScript(
        tab.id,
        rec,
        `(async () => {
        const handler = globalThis[
          ${JSON.stringify(rec.world === 'MAIN' ? '__userscript_onCommand' : '__userscript_onCommand__')}
        ];
        if (typeof handler !== 'function') return {};
        const data = await handler('userscript:command', ${JSON.stringify(payload)}, ${JSON.stringify(id)});
        return { data };
      })()`,
        false,
      );
      if (!execution)
        return createErrorResponse('The userscript does not match the target document.');
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, result: execution.result }) }],
        isError: false,
      };
    } catch (e) {
      return createErrorResponse(
        `send_command failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async exportAll(): Promise<ToolResult> {
    const all = await loadAllRecords();
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true, data: all }) }],
      isError: false,
    };
  }
}

export const userscriptTool = new UserscriptTool();
