/**
 * Proxy utilities for netjsonmon
 *
 * Inspired by Scrapling's `engines/toolbelt/proxy_rotation.py` and
 * `engines/toolbelt/navigation.py` → `construct_proxy_dict()`.
 *
 * Supports:
 *   - Single proxy string parsed to Playwright `{server, username, password}`
 *   - Proxy list file (one proxy per line) with round-robin selection
 *   - Optional --proxyAuth override for username:password
 */

import { readFileSync } from 'fs';

/** Playwright proxy configuration object */
export interface PlaywrightProxy {
  server: string;
  username?: string;
  password?: string;
}

/**
 * Parse a raw proxy string into a Playwright proxy config dict.
 *
 * Accepted formats (mirrors Scrapling's `construct_proxy_dict`):
 *   http://host:port
 *   http://user:pass@host:port
 *   socks5://host:port
 *   socks5://user:pass@host:port
 *
 * @param raw       A proxy URL string.
 * @param authOverride  Optional "username:password" override from --proxyAuth.
 */
export function parseProxy(raw: string, authOverride?: string): PlaywrightProxy {
  // Normalise: add a scheme if missing so URL() can parse it
  const withScheme = /^https?:\/\/|^socks[45]:\/\//i.test(raw) ? raw : `http://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error(`Invalid proxy URL: "${raw}"`);
  }

  const allowedSchemes = ['http:', 'https:', 'socks4:', 'socks5:'];
  if (!allowedSchemes.includes(parsed.protocol)) {
    throw new Error(`Unsupported proxy scheme "${parsed.protocol}" in "${raw}". Use http, https, socks4, or socks5.`);
  }

  // Build server without credentials (Playwright expects them separately)
  const server = parsed.port
    ? `${parsed.protocol}//${parsed.hostname}:${parsed.port}`
    : `${parsed.protocol}//${parsed.hostname}`;

  // Resolve credentials: --proxyAuth override > inline URL credentials
  let username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
  let password = parsed.password ? decodeURIComponent(parsed.password) : undefined;

  if (authOverride) {
    const colonIdx = authOverride.indexOf(':');
    if (colonIdx < 0) {
      throw new Error(`--proxyAuth must be in "username:password" format, got: "${authOverride}"`);
    }
    username = authOverride.slice(0, colonIdx);
    password = authOverride.slice(colonIdx + 1);
  }

  const result: PlaywrightProxy = { server };
  if (username) result.username = username;
  if (password) result.password = password;
  return result;
}

/**
 * Read a proxy list file.
 * Lines starting with `#` and blank lines are ignored.
 *
 * @param filePath  Path to a plain-text file with one proxy per line.
 */
export function loadProxyList(filePath: string): string[] {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Cannot read proxy list "${filePath}": ${(err as Error).message}`);
  }

  const proxies = content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));

  if (proxies.length === 0) {
    throw new Error(`Proxy list "${filePath}" is empty or contains only comments.`);
  }

  return proxies;
}

/**
 * Pick the next proxy from a list using round-robin (mirrors Scrapling's
 * `cyclic_rotation`).
 *
 * @param proxies     Array of raw proxy strings.
 * @param currentIdx  Current rotation index (0-based). Pass 0 for first call.
 * @param authOverride  Optional --proxyAuth override applied to the picked proxy.
 * @returns           `{ proxy, nextIndex }` — caller must persist `nextIndex`
 *                    for the next pick.
 */
export function pickProxy(
  proxies: string[],
  currentIdx: number,
  authOverride?: string,
): { proxy: PlaywrightProxy; nextIndex: number } {
  const idx = currentIdx % proxies.length;
  const proxy = parseProxy(proxies[idx], authOverride);
  return { proxy, nextIndex: (idx + 1) % proxies.length };
}

/**
 * Resolve the active proxy config from CLI options.
 * Priority: `proxyList` (round-robin) > single `proxy` string.
 *
 * @param options  Subset of MonitorOptions.
 * @param rotationIdx  Current round-robin index for list mode.
 * @returns  `{ proxy, nextIndex }` — `proxy` is undefined when no proxy is configured.
 */
export function resolveProxy(
  options: { proxy?: string; proxyList?: string[]; proxyAuth?: string },
  rotationIdx: number = 0,
): { proxy: PlaywrightProxy | undefined; nextIndex: number } {
  if (options.proxyList && options.proxyList.length > 0) {
    return pickProxy(options.proxyList, rotationIdx, options.proxyAuth);
  }
  if (options.proxy) {
    return { proxy: parseProxy(options.proxy, options.proxyAuth), nextIndex: 0 };
  }
  return { proxy: undefined, nextIndex: 0 };
}
