# Agent Chrome MCP extension

WXT + Vue 3 extension that exposes browser control to the native MCP host.

## Development

```sh
pnpm --filter @ethanwilkins/chrome-mcp-server-2026 dev
pnpm --filter @ethanwilkins/chrome-mcp-server-2026 build
pnpm --filter @ethanwilkins/chrome-mcp-server-2026 test
pnpm --filter @ethanwilkins/chrome-mcp-server-2026 typecheck
```

The extension connects to the native host from `app/native-server`. The popup
shows connection state, the MCP client config, and basic settings; proxy and
userscript settings live on the options page.
