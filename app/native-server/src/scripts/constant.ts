import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

export const COMMAND_NAME = 'mcp-chrome-bridge';
const DEFAULT_EXTENSION_ID = 'djclnaepokchbblcnepfempfdhejjdml';
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

function configuredExtensionId(): string | null {
  const value = process.env.CHROME_MCP_EXTENSION_ID?.trim();
  return value && EXTENSION_ID_PATTERN.test(value) ? value : null;
}

function getExtensionIdFromBuild(): string {
  try {
    const manifestPath = path.resolve(
      __dirname,
      '../../../chrome-extension/.output/chrome-mv3/manifest.json',
    );
    const { key } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    if (typeof key !== 'string') return DEFAULT_EXTENSION_ID;

    return createHash('sha256')
      .update(Buffer.from(key, 'base64'))
      .digest('hex')
      .slice(0, 32)
      .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
  } catch {
    return DEFAULT_EXTENSION_ID;
  }
}

// Native Messaging must use the extension ID generated from its manifest key.
// An unpacked source build has no key, so CHROME_MCP_EXTENSION_ID must name the
// ID Chrome assigned to it. The fallback keeps published installs compatible.
export const EXTENSION_ID = configuredExtensionId() ?? getExtensionIdFromBuild();
export const HOST_NAME = 'com.chromemcp.nativehost';
export const DESCRIPTION = 'Node.js Host for Browser Bridge Extension';
