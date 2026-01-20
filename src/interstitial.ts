/**
 * Interstitial and consent page handlers (CMP-agnostic)
 */

import type { Frame, Page } from 'playwright';
import type { ConsentAction, ConsentMode } from './types.js';

export interface ConsentHandler {
  name: string;
  match: (frame: Frame) => boolean | Promise<boolean>;
  handle: (frame: Frame, action: ConsentAction, timeoutMs: number) => Promise<boolean>;
}

const DEFAULT_TIMEOUT = 15000;

const REJECT_TEXT = [/reject all/i, /reject/i, /decline/i, /do not accept/i];
const ACCEPT_TEXT = [/accept all/i, /accept/i, /agree/i, /allow all/i, /ok/i];

function framesWithMain(page: Page): Frame[] {
  // Ensure main frame is first for predictable handling
  const frames = page.frames();
  const main = page.mainFrame();
  const others = frames.filter(f => f !== main);
  return [main, ...others];
}

async function clickByRoleText(frame: Frame, patterns: RegExp[], timeoutMs: number): Promise<boolean> {
  for (const pattern of patterns) {
    try {
      const button = frame.getByRole('button', { name: pattern });
      if (await button.isVisible({ timeout: timeoutMs }).catch(() => false)) {
        await button.click();
        return true;
      }
    } catch {
      // Try next pattern
    }
  }
  return false;
}

async function clickBySelectors(frame: Frame, selectors: string[], timeoutMs: number): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const button = frame.locator(selector).first();
      if (await button.isVisible({ timeout: timeoutMs }).catch(() => false)) {
        await button.click();
        return true;
      }
    } catch {
      // Try next selector
    }
  }
  return false;
}

function urlIncludes(frame: Frame, ...needles: string[]): boolean {
  const lower = frame.url().toLowerCase();
  return needles.some(n => lower.includes(n));
}

/**
 * Yahoo consent page handler (Reject preferred)
 */
export const yahooConsentHandler: ConsentHandler = {
  name: 'yahoo',
  match: (frame: Frame) => urlIncludes(frame, 'consent.yahoo.com'),
  handle: async (frame, action, timeoutMs) => {
    const preferReject = action === 'reject';
    if (preferReject && (await clickByRoleText(frame, REJECT_TEXT, timeoutMs))) {
      console.log('✓ Clicked "Reject" on Yahoo consent');
      return true;
    }
    if (await clickByRoleText(frame, ACCEPT_TEXT, timeoutMs)) {
      console.log('⚠ Clicked "Accept" on Yahoo consent');
      return true;
    }
    return false;
  },
};

/**
 * OneTrust-style banners
 */
export const oneTrustHandler: ConsentHandler = {
  name: 'onetrust',
  match: async (frame: Frame) => {
    if (urlIncludes(frame, 'onetrust')) return true;
    const banner = frame.locator('#onetrust-banner-sdk, #onetrust-consent-sdk');
    return (await banner.count()) > 0;
  },
  handle: async (frame, action, timeoutMs) => {
    const rejectSelectors = [
      'button#onetrust-reject-all-handler',
      'button:has-text("Reject All")',
      'button:has-text("Decline All")',
    ];
    const acceptSelectors = [
      'button#onetrust-accept-btn-handler',
      'button:has-text("Accept All")',
      'button:has-text("Allow All")',
    ];
    if (action === 'reject' && (await clickBySelectors(frame, rejectSelectors, timeoutMs))) {
      console.log('✓ Clicked OneTrust reject');
      return true;
    }
    if (await clickBySelectors(frame, acceptSelectors, timeoutMs)) {
      console.log('⚠ Clicked OneTrust accept');
      return true;
    }
    return false;
  },
};

/**
 * SourcePoint / TCF iframes (common CMP)
 */
export const sourcePointHandler: ConsentHandler = {
  name: 'sourcepoint',
  match: (frame: Frame) => {
    const name = frame.name().toLowerCase();
    return name.includes('sp_message_iframe') || urlIncludes(frame, 'sp-prod.net', 'sp-prod.net');
  },
  handle: async (frame, action, timeoutMs) => {
    const rejectSelectors = ['button:has-text("Reject All")', 'button:has-text("Reject")'];
    const acceptSelectors = ['button:has-text("Accept All")', 'button:has-text("Accept")'];
    if (action === 'reject' && (await clickBySelectors(frame, rejectSelectors, timeoutMs))) {
      console.log('✓ Clicked SourcePoint reject');
      return true;
    }
    if (await clickBySelectors(frame, acceptSelectors, timeoutMs)) {
      console.log('⚠ Clicked SourcePoint accept');
      return true;
    }
    return false;
  },
};

/**
 * Generic fallback handler
 */
export const genericConsentHandler: ConsentHandler = {
  name: 'generic',
  match: (frame: Frame) =>
    urlIncludes(frame, 'consent', 'privacy', 'cookie', 'gdpr', 'cmp'),
  handle: async (frame, action, timeoutMs) => {
    const rejectSelectors = [
      'button:has-text("Reject")',
      'button:has-text("Reject all")',
      'button:has-text("Decline")',
      'button:has-text("Do not accept")',
      '[data-consent="reject"]',
      '.reject-all',
      '#reject-all',
    ];
    const acceptSelectors = [
      'button:has-text("Accept")',
      'button:has-text("Accept all")',
      'button:has-text("Agree")',
      'button:has-text("Allow all")',
      '[data-consent="accept"]',
      '.accept-all',
      '#accept-all',
    ];
    if (action === 'reject' && (await clickBySelectors(frame, rejectSelectors, timeoutMs))) {
      console.log('✓ Clicked generic reject');
      return true;
    }
    if (await clickBySelectors(frame, acceptSelectors, timeoutMs)) {
      console.log('⚠ Clicked generic accept');
      return true;
    }
    return false;
  },
};

const HANDLER_REGISTRY: ConsentHandler[] = [
  yahooConsentHandler,
  oneTrustHandler,
  sourcePointHandler,
  genericConsentHandler,
];

function selectHandlers(mode: ConsentMode, allowList?: string[]): ConsentHandler[] {
  if (mode === 'off') return [];
  if (mode === 'yahoo') return [yahooConsentHandler];
  if (mode === 'generic') return [genericConsentHandler];
  let handlers = HANDLER_REGISTRY;
  if (allowList && allowList.length > 0) {
    const set = new Set(allowList.map(h => h.toLowerCase()));
    handlers = HANDLER_REGISTRY.filter(h => set.has(h.name));
  }
  return handlers;
}

/**
 * Handle interstitial pages (consent, privacy, etc.)
 */
export async function handleConsent(
  page: Page,
  mode: ConsentMode,
  action: ConsentAction,
  timeoutMs = DEFAULT_TIMEOUT,
  allowList?: string[]
): Promise<boolean> {
  const handlers = selectHandlers(mode, allowList);
  if (!handlers.length) return false;

  for (const frame of framesWithMain(page)) {
    for (const handler of handlers) {
      let detected = false;
      try {
        detected = await Promise.resolve(handler.match(frame));
      } catch {
        detected = false;
      }
      if (!detected) continue;

      console.log(`Detected ${handler.name} interstitial at ${frame.url()}`);
      const handled = await handler.handle(frame, action, timeoutMs);
      if (handled) {
        return true;
      }
    }
  }

  return false;
}
