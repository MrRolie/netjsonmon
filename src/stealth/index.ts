/**
 * Stealth mode scripts and configuration for netjsonmon
 *
 * Inspired by Scrapling's engines/toolbelt/bypasses/ and engines/constants.py.
 * Each script is injected at the BrowserContext level (applies to all pages
 * and frames) via context.addInitScript(), matching Scrapling's approach.
 */

// ---------------------------------------------------------------------------
// Chrome launch flags for stealth
// Mirrors Scrapling's STEALTH_ARGS + HARMFUL_ARGS pattern
// ---------------------------------------------------------------------------

export const STEALTH_ARGS: string[] = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--no-first-run',
  '--no-default-browser-check',
  '--no-service-autorun',
  '--password-store=basic',
  '--use-mock-keychain',
  '--lang=en-US,en',
  '--disable-component-extensions-with-background-pages',
  '--disable-background-networking',
  '--disable-sync',
  '--metrics-recording-only',
  '--disable-default-apps',
  '--mute-audio',
  '--no-pings',
  '--disable-hang-monitor',
  '--disable-prompt-on-repost',
  '--disable-client-side-phishing-detection',
  '--disable-oopr-debug-crash-dump',
  '--no-crash-upload',
  '--disable-low-res-tiling',
  '--log-level=3',
  '--disable-notifications',
  '--allow-running-insecure-content',
  '--ignore-certificate-errors',
  '--start-maximized',
  '--disable-infobars',
  '--disable-session-crashed-bubble',
  '--hide-crash-restore-bubble',
  '--suppress-message-center-popups',
];

// ---------------------------------------------------------------------------
// Playwright context options for stealth
// Mirrors Scrapling's StealthySessionMixin.__validate__ context hardening
// ---------------------------------------------------------------------------

export const STEALTH_CONTEXT_OPTIONS = {
  colorScheme: 'dark' as const,
  deviceScaleFactor: 2,
  permissions: ['geolocation', 'notifications'] as string[],
  isMobile: false,
  hasTouch: false,
  serviceWorkers: 'allow' as const,
  ignoreHTTPSErrors: true,
  screen: { width: 1920, height: 1080 },
  viewport: { width: 1920, height: 1080 },
};

// ---------------------------------------------------------------------------
// Script 1 — Remove navigator.webdriver
// Mirrors: bypasses/webdriver_fully.js
// ---------------------------------------------------------------------------
export const webdriverScript = `
(function () {
  try {
    // Delete the property entirely so it returns undefined on read
    const newProto = Object.create(navigator.__proto__);
    Object.defineProperty(newProto, 'webdriver', {
      get: () => undefined,
      configurable: true,
      enumerable: false,
    });
    navigator.__proto__ = newProto;
  } catch (_) {
    // Fallback: plain defineProperty
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });
  }
})();
`;

// ---------------------------------------------------------------------------
// Script 2 — Inject realistic window.chrome object
// Mirrors: bypasses/window_chrome.js
// ---------------------------------------------------------------------------
export const windowChromeScript = `
(function () {
  if (window.chrome) return;
  const chrome = {
    app: {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    },
    csi: function () {},
    loadTimes: function () {
      return {
        requestTime: Date.now() / 1000,
        startLoadTime: Date.now() / 1000,
        commitLoadTime: Date.now() / 1000,
        finishDocumentLoadTime: Date.now() / 1000,
        finishLoadTime: Date.now() / 1000,
        firstPaintTime: Date.now() / 1000,
        firstPaintAfterLoadTime: 0,
        navigationType: 'Other',
        wasFetchedViaSpdy: false,
        wasNpnNegotiated: false,
        npnNegotiatedProtocol: 'unknown',
        wasAlternateProtocolAvailable: false,
        connectionInfo: 'http/1.1',
      };
    },
    runtime: {
      PlatformOs: {
        MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd',
      },
      PlatformArch: { ARM: 'arm', ARM64: 'arm64', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
      RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
      OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
    },
  };
  Object.defineProperty(window, 'chrome', {
    value: chrome,
    writable: true,
    enumerable: true,
    configurable: false,
  });
})();
`;

// ---------------------------------------------------------------------------
// Script 3 — Spoof navigator.plugins with realistic entries
// Mirrors: bypasses/navigator_plugins.js
// ---------------------------------------------------------------------------
export const navigatorPluginsScript = `
(function () {
  function makePlugin(name, filename, description, mimeTypes) {
    const plugin = { name, filename, description, length: mimeTypes.length };
    mimeTypes.forEach(function (mt, i) {
      plugin[i] = mt;
      mt.enabledPlugin = plugin;
    });
    plugin[Symbol.iterator] = function* () { for (let i = 0; i < this.length; i++) yield this[i]; };
    return plugin;
  }
  const pdf1 = { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: null };
  const pdf2 = { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: null };
  const nacl = { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable', enabledPlugin: null };
  const pnacl = { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable', enabledPlugin: null };
  const fakePlugins = [
    makePlugin('PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', [pdf1, pdf2]),
    makePlugin('Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', [pdf1, pdf2]),
    makePlugin('Chromium PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', [pdf1, pdf2]),
    makePlugin('Microsoft Edge PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', [pdf1, pdf2]),
    makePlugin('WebKit built-in PDF', 'internal-pdf-viewer', 'Portable Document Format', [pdf1, pdf2]),
  ];
  try {
    Object.defineProperty(navigator, 'plugins', {
      get: function () { return Object.assign(fakePlugins, { item: (i) => fakePlugins[i], namedItem: (n) => fakePlugins.find(p => p.name === n), refresh: function () {}, [Symbol.iterator]: Array.prototype[Symbol.iterator] }); },
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(navigator, 'mimeTypes', {
      get: function () { const all = [pdf1, pdf2, nacl, pnacl]; return Object.assign(all, { item: (i) => all[i], namedItem: (n) => all.find(m => m.type === n), [Symbol.iterator]: Array.prototype[Symbol.iterator] }); },
      configurable: true,
      enumerable: true,
    });
  } catch (_) {}
})();
`;

// ---------------------------------------------------------------------------
// Script 4 — Override Notification.permission / permissions.query
// Mirrors: bypasses/notification_permission.js
// ---------------------------------------------------------------------------
export const notificationPermissionScript = `
(function () {
  try {
    // Stub Notification to report 'default' permission
    const OrigNotification = window.Notification;
    if (OrigNotification) {
      Object.defineProperty(window, 'Notification', {
        value: Object.assign(
          function Notification(title, options) { return new OrigNotification(title, options); },
          OrigNotification,
          { permission: 'default' }
        ),
        writable: true, configurable: true,
      });
    }
    // Patch permissions.query so 'notifications' never reports 'denied'
    const origQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function (parameters) {
      if (parameters && parameters.name === 'notifications') {
        return Promise.resolve({ state: 'default', onchange: null });
      }
      return origQuery(parameters);
    };
  } catch (_) {}
})();
`;

// ---------------------------------------------------------------------------
// Script 5 — Normalize screen properties
// Mirrors: bypasses/screen_props.js
// ---------------------------------------------------------------------------
export const screenPropsScript = `
(function () {
  try {
    const W = 1920, H = 1080;
    const overrides = {
      width: W, height: H,
      availWidth: W, availHeight: H - 40,
      colorDepth: 24, pixelDepth: 24,
    };
    for (const [key, value] of Object.entries(overrides)) {
      Object.defineProperty(screen, key, { get: () => value, configurable: true });
    }
    // Also ensure window.outerWidth/outerHeight match
    Object.defineProperty(window, 'outerWidth', { get: () => W, configurable: true });
    Object.defineProperty(window, 'outerHeight', { get: () => H, configurable: true });
    Object.defineProperty(window, 'innerWidth', { get: () => W, configurable: true });
    Object.defineProperty(window, 'innerHeight', { get: () => H - 88, configurable: true });
  } catch (_) {}
})();
`;

// ---------------------------------------------------------------------------
// Script 6 — Remove Playwright / CDP fingerprints
// Mirrors: bypasses/playwright_fingerprint.js
// ---------------------------------------------------------------------------
export const playwrightFingerprintScript = `
(function () {
  try {
    // Remove __playwright*, __pw_*, __pwInitScripts internals
    const playwrightKeys = Object.getOwnPropertyNames(window).filter(k =>
      k.startsWith('__playwright') || k.startsWith('__pw_') || k === '_playwrightPendingInterception'
    );
    playwrightKeys.forEach(k => { try { delete (window as any)[k]; } catch (_) {} });

    // Patch toString of native functions to look real
    const nativeToString = Function.prototype.toString;
    const patchedFns = new WeakSet();
    Function.prototype.toString = function () {
      if (patchedFns.has(this)) {
        return 'function () { [native code] }';
      }
      return nativeToString.call(this);
    };
  } catch (_) {}
})();
`;

// ---------------------------------------------------------------------------
// All stealth scripts in injection order (mirrors Scrapling's _compiled_stealth_scripts order)
// ---------------------------------------------------------------------------
export const STEALTH_SCRIPTS: string[] = [
  webdriverScript,
  windowChromeScript,
  navigatorPluginsScript,
  notificationPermissionScript,
  screenPropsScript,
  playwrightFingerprintScript,
];
