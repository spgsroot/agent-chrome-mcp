<p align="center">
  <img src="app/chrome-extension/public/icon/128.png" alt="Chrome MCP Server" width="96" height="96" />
</p>

<h1 align="center">Agent Chrome MCP</h1>

<p align="center">
  <b>Browser-only control for MCP clients</b><br />
  A local Chrome extension and native bridge that expose your existing browser
  session over the Model Context Protocol.
</p>

---

## What this project is

- **Chrome extension** (`app/chrome-extension/`) — owns Chrome APIs, DOM
  interaction, screenshots, network inspection, cookies, storage, bookmarks,
  history, downloads, and the rest of the browser tool surface.
- **Native bridge** (`app/native-server/`) — Chrome Native Messaging host and
  local MCP server exposing Streamable HTTP, legacy SSE, and STDIO transports.
- **Shared package** (`packages/shared/`) — MCP tool schemas and the native
  protocol used by both sides.

There is no assistant runtime, workflow builder, record/replay engine, desktop
client, or local vector-model package in this distribution. MCP clients bring
their own models and orchestration.

## Requirements

- Chrome or Chromium
- Node.js 24 or newer for the bridge
- pnpm 12 for building from source

## Install

Download both assets from the [latest release](https://github.com/spgsroot/agent-chrome-mcp/releases/latest):

- `agent-chrome-mcp-extension-2.8.5.zip`
- `agent-chrome-mcp-bridge-2.8.5.tar.gz`

The bridge archive includes its production dependencies. Node.js 24 or newer is
required; no npm package installation is needed. This release was tested on macOS
arm64 with Chrome for Testing. Windows and Linux are not release-tested.

### 1. Load the extension

Unzip the extension, open `chrome://extensions/`, enable **Developer mode**, click
**Load unpacked**, and select the unzipped directory. Copy its extension ID.

### 2. Register the native bridge

Extract the bridge to a permanent directory, then run:

```bash
tar -xzf agent-chrome-mcp-bridge-2.8.5.tar.gz
cd agent-chrome-mcp-bridge
node dist/cli.js --version
CHROME_MCP_EXTENSION_ID=YOUR_EXTENSION_ID node dist/cli.js register
```

Replace `YOUR_EXTENSION_ID` with the ID from `chrome://extensions/`. Registration
stores the bridge's absolute path, so do not move the directory afterward. Open
the extension popup and click **Connect**; Chrome starts the native bridge.

The native-host name remains `com.chromemcp.nativehost` for protocol compatibility.
Registration replaces an existing registration under that name. Do not register
this build alongside an older mcp-chrome installation you still use.

### 3. Configure your MCP client

STDIO requires no HTTP API key. Replace the path below with the bridge's absolute path:

```json
{
  "mcpServers": {
    "agent-chrome-mcp": {
      "command": "node",
      "args": ["/absolute/path/agent-chrome-mcp-bridge/dist/cli.js", "--stdio"]
    }
  }
}
```

For HTTP clients, use `http://127.0.0.1:12306/mcp-new` (stateless),
`http://127.0.0.1:12306/mcp` (session-based), or `/sse` (legacy). Configure
`CHROME_MCP_API_KEY` in the bridge process environment and send the same key as
`Authorization: Bearer ...`. A bare HTTP URL is insufficient: requests without a
key or explicitly allowed Origin are rejected. See [Security](#security).

### Build from source

```bash
git clone https://github.com/spgsroot/agent-chrome-mcp.git
cd agent-chrome-mcp
pnpm install --frozen-lockfile
pnpm build
```

Load `app/chrome-extension/.output/chrome-mv3`, then register
`app/native-server/dist/cli.js` with `CHROME_MCP_EXTENSION_ID` as above. Do not
install the upstream npm package: it does not contain this project's changes.

## Security

The service is loopback-only. Every privileged route (`/mcp*`, `/sse`,
`/messages`, `/status`, diagnostics, service control, request cancellation, and
artifacts) uses one authorization boundary:

- a valid `CHROME_MCP_API_KEY` (Bearer token or `x-api-key`), or
- an allowed browser `Origin`:
  - a `chrome-extension://` origin (the extension popup / MCP bridge), or
  - the bundled STDIO origin `chrome-extension://mcp-stdio`, or
  - an origin listed in `CHROME_MCP_ALLOWED_ORIGINS` (comma-separated, exact
    match).

Requests with neither an allowed Origin nor a key are rejected with `403`.
Local web pages (`http://127.0.0.1:*` and `http://localhost:*`) are **not**
trusted implicitly; add one to `CHROME_MCP_ALLOWED_ORIGINS` only when a local
web UI must connect.

Set `CHROME_MCP_EXTENSION_ID` in the bridge process environment to pin the
accepted extension Origin. Without it, any installed Chrome extension origin is
accepted; with it, only that ID and `chrome-extension://mcp-stdio` are accepted.
The popup reads status through native messaging rather than privileged HTTP.

Artifacts are capability URLs: `/artifacts/:id` requires the one-time `token`
returned with the tool result.

Other environment variables:

| Variable | Purpose |
| --- | --- |
| `CHROME_MCP_PORT` / `MCP_HTTP_PORT` | HTTP port (default `12306`) |
| `CHROME_MCP_ALLOWED_ORIGINS` | Exact extra origins allowed on privileged routes |
| `CHROME_MCP_EXTENSION_ID` | Exact Chrome extension ID |
| `CHROME_MCP_MAX_CONCURRENT_TOOLS` | Concurrent tool calls (default `8`) |
| `CHROME_MCP_MAX_QUEUED_TOOLS` | Admission queue length (default `64`) |
| `CHROME_MCP_ALLOWED_TOOLS` / `CHROME_MCP_APPROVED_TOOLS` / `CHROME_MCP_REQUIRE_APPROVAL` | Tool scope and approval policy |
| `CHROME_MCP_MAX_HTTP_BODY_BYTES` | HTTP request body cap (default 8 MiB) |
| `CHROME_MCP_ENABLE_DEBUG_ENDPOINTS` | Enables `/__chrome_mcp_bridge/start` and `/stop` |

## Browser tools

The retained MCP surface covers tabs and navigation, DOM/text/accessibility
extraction, clicking and form input, screenshots and PDF, GIF capture, network
capture and request replay, console and debugger state, cookies, storage,
bookmarks, history, downloads, isolated Chrome profiles, and bounded page
collection. See [docs/TOOLS.md](docs/TOOLS.md) for the full catalog.

## Development

```bash
pnpm typecheck
pnpm lint
pnpm --filter @ethanwilkins/mcp-chrome-bridge-2026 test
pnpm --filter @ethanwilkins/chrome-mcp-server-2026 test
pnpm build
pnpm check:tool-docs
```

To produce a bridge directory with locked production dependencies after building:

```bash
pnpm package:bridge
tar -czf releases/agent-chrome-mcp-bridge-2.8.5.tar.gz -C releases agent-chrome-mcp-bridge
```

The Windows portable bridge executable is built on Windows with
`pnpm package:windows`; it bundles the bridge runtime and the extension build.

Architecture details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Troubleshooting: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) and
[docs/TROUBLESHOOTING_NATIVE_HOST.md](docs/TROUBLESHOOTING_NATIVE_HOST.md).

## License

MIT — see [LICENSE](LICENSE). This project is derived from
[mcp-chrome-2026](https://github.com/spgsroot/mcp-chrome-2026-en); the original
MIT license and attribution are preserved.
