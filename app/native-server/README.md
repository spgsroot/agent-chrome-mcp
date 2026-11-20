# Agent Chrome MCP native bridge

Chrome Native Messaging host and local MCP server. Requires Node.js 24 or newer.
The [release archive](https://github.com/spgsroot/agent-chrome-mcp/releases/latest)
contains the compiled bridge and its production dependencies; no npm installation
is needed. Follow the [installation guide](https://github.com/spgsroot/agent-chrome-mcp#install)
to load the matching extension and register this bridge.

From the extracted bridge directory:

```bash
node dist/cli.js --version
CHROME_MCP_EXTENSION_ID=YOUR_EXTENSION_ID node dist/cli.js register
```

Replace `YOUR_EXTENSION_ID` with the extension ID from `chrome://extensions/`.
Keep this directory in its permanent location. Registration replaces any existing
`com.chromemcp.nativehost` registration; it is not a side-by-side installation.
The extension starts the host when connected.

For development, run these commands from the repository root:

```bash
pnpm build:native
pnpm --filter @ethanwilkins/mcp-chrome-bridge-2026 test
```

MIT. Original attribution is preserved in the repository LICENSE.
