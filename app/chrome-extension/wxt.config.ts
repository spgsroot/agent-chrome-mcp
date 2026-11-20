import { defineConfig } from 'wxt';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local') });

const CHROME_EXTENSION_KEY = process.env.CHROME_EXTENSION_KEY;
// Detect dev mode early for manifest-level switches
const IS_DEV = process.env.NODE_ENV !== 'production' && process.env.MODE !== 'production';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  zip: {
    name: 'chrome-mcp-server',
  },
  webExt: {
    disabled: true,
  },
  manifest: {
    // Use environment variable for the key, fallback to undefined if not set
    key: CHROME_EXTENSION_KEY,
    default_locale: 'en',
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    permissions: [
      'nativeMessaging',
      'tabs',
      'activeTab',
      'scripting',
      'contextMenus',
      'downloads',
      'proxy',
      'webRequest',
      'webRequestAuthProvider',
      'webNavigation',
      'debugger',
      'history',
      'bookmarks',
      'cookies',
      'offscreen',
      'storage',
      'declarativeNetRequest',
      'alarms',
    ],
    host_permissions: ['<all_urls>'],
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
    action: {
      default_popup: 'popup.html',
      default_title: 'Chrome MCP',
    },
    web_accessible_resources: [
      {
        resources: ['/inject-scripts/*'],
        matches: ['<all_urls>'],
      },
    ],
    // Note: the security policy below blocks dev server asset loading in development,
    // so it is only enabled in production; development relies on WXT's default policy.
    ...(IS_DEV
      ? {}
      : {
          content_security_policy: {
            extension_pages:
              "script-src 'self'; object-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;",
          },
        }),
  },
  vite: (env) => ({
    plugins: [
      // Copy helper scripts and locales into the build output before other steps.
      viteStaticCopy({
        targets: [
          {
            src: 'inject-scripts/*.js',
            dest: '.',
          },
          {
            src: '_locales/**/*',
            // The source glob already contains the `_locales/` directory.
            dest: '.',
          },
        ],
        hook: 'writeBundle',
      }),
    ],
    resolve: {
      alias: {
        '@ethanwilkins/chrome-mcp-shared-2026': resolve(__dirname, '../../packages/shared/src'),
      },
    },
    build: {
      // Extension pages run in separate worlds; modulepreload entries cannot be reused across them.
      modulePreload: false,
      // Our build output must stay compatible with es6
      target: 'es2015',
      // Generate sourcemaps outside production
      sourcemap: env.mode !== 'production',
      // Keep development builds fast, but ship minified production bundles.
      reportCompressedSize: env.mode === 'production',
      // Warn when a chunk exceeds 1500kb
      chunkSizeWarningLimit: 1500,
      minify: env.mode === 'production' ? 'esbuild' : false,
    },
  }),
});
