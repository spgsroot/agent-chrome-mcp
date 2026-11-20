export const NATIVE_SERVER_PORT = 12306;

/** Synthetic origin used by the bundled STDIO proxy's local HTTP hop. */
export const STDIO_MCP_ORIGIN = 'chrome-extension://mcp-stdio';

// Timeout constants (in milliseconds)
export const TIMEOUTS = {
  DEFAULT_REQUEST_TIMEOUT: 30000,
} as const;

// Server configuration
export const SERVER_CONFIG = {
  HOST: '127.0.0.1',
  LOGGER_ENABLED: false,
} as const;

/**
 * Validate browser Origin values without prefix matching.
 * Prefix matching would allow origins such as http://127.0.0.1.evil.example.
 * Loopback web origins are intentionally not trusted implicitly; configure
 * CHROME_MCP_ALLOWED_ORIGINS when a local web UI needs access.
 */
export function isAllowedCorsOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const configuredOrigins = process.env[MCP_ALLOWED_ORIGINS_ENV]?.split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (configuredOrigins?.includes(origin)) return true;
    if (origin === STDIO_MCP_ORIGIN) return true;
    if (url.protocol !== 'chrome-extension:') return false;
    const expectedExtensionId = process.env[MCP_EXTENSION_ID_ENV]?.trim();
    return expectedExtensionId ? url.hostname === expectedExtensionId : Boolean(url.hostname);
  } catch {
    return false;
  }
}

// HTTP Status codes
export const HTTP_STATUS = {
  OK: 200,
  ACCEPTED: 202,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  CONFLICT: 409,
  FORBIDDEN: 403,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_SERVER_ERROR: 500,
} as const;

// Error messages
export const ERROR_MESSAGES = {
  INVALID_MCP_REQUEST: 'Invalid MCP request or session.',
  UNAUTHORIZED: 'Missing or invalid MCP API key.',
  ORIGIN_NOT_ALLOWED: 'MCP requests must include an allowed Origin or a valid API key.',
  INVALID_SESSION_ID: 'Invalid or missing MCP session ID.',
  INTERNAL_SERVER_ERROR: 'Internal Server Error',
  MCP_SESSION_DELETION_ERROR: 'Internal server error during MCP session deletion.',
  MCP_REQUEST_PROCESSING_ERROR: 'Internal server error during MCP request processing.',
  INVALID_SSE_SESSION: 'Invalid or missing MCP session ID for SSE.',
} as const;

// ============================================================
// Chrome MCP Server Configuration
// ============================================================

/**
 * Environment variables for dynamically resolving the local MCP HTTP endpoint.
 * CHROME_MCP_PORT is the preferred source; MCP_HTTP_PORT is kept for backward compatibility.
 */
export const CHROME_MCP_PORT_ENV = 'CHROME_MCP_PORT';
export const MCP_HTTP_PORT_ENV = 'MCP_HTTP_PORT';
export const MCP_API_KEY_ENV = 'CHROME_MCP_API_KEY';
export const MCP_ALLOWED_ORIGINS_ENV = 'CHROME_MCP_ALLOWED_ORIGINS';
export const MCP_EXTENSION_ID_ENV = 'CHROME_MCP_EXTENSION_ID';
export const MCP_ENABLE_DEBUG_ENDPOINTS_ENV = 'CHROME_MCP_ENABLE_DEBUG_ENDPOINTS';
export const MCP_MAX_HTTP_BODY_BYTES_ENV = 'CHROME_MCP_MAX_HTTP_BODY_BYTES';
export const MCP_ALLOWED_TOOLS_ENV = 'CHROME_MCP_ALLOWED_TOOLS';
export const MCP_APPROVED_TOOLS_ENV = 'CHROME_MCP_APPROVED_TOOLS';
export const MCP_REQUIRE_APPROVAL_ENV = 'CHROME_MCP_REQUIRE_APPROVAL';

/**
 * Get the actual port the Chrome MCP server is listening on.
 * Priority: CHROME_MCP_PORT env > MCP_HTTP_PORT env > NATIVE_SERVER_PORT default
 */
export function getChromeMcpPort(): number {
  const raw = process.env[CHROME_MCP_PORT_ENV] || process.env[MCP_HTTP_PORT_ENV];
  const port = raw ? Number.parseInt(String(raw), 10) : NaN;
  return Number.isFinite(port) && port > 0 && port <= 65535 ? port : NATIVE_SERVER_PORT;
}

/**
 * Get the full URL to the local Chrome MCP HTTP endpoint.
 * This URL is used by MCP clients to connect to the MCP server.
 */
export function getChromeMcpUrl(): string {
  return `http://${SERVER_CONFIG.HOST}:${getChromeMcpPort()}/mcp`;
}
