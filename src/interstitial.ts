/**
 * Interstitial and consent page handlers
 */

import type { Page } from 'playwright';

export interface InterstitialHandler {
  detect: (page: Page) => boolean | Promise<boolean>;
  handle: (page: Page, timeoutMs: number) => Promise<boolean>;
}

/**
 * Yahoo consent page handler (default action: Reject)
 */
export const yahooConsentHandler: InterstitialHandler = {
  detect: (page: Page) => {
    const host = new URL(page.url()).hostname;
    return host.includes('consent.yahoo.com');
  },

  handle: async (page: Page, timeoutMs = 15000) => {
    // Try to find and click "Reject all" button first (default/recommended)
    const rejectButton = page.getByRole('button', { name: /reject all/i });
    const rejectVisible = await rejectButton
      .isVisible({ timeout: timeoutMs })
      .catch(() => false);

    if (rejectVisible) {
      await rejectButton.click();
      console.log('✓ Clicked "Reject all" on Yahoo consent page');
      return true;
    }

    // Fallback: try "Accept all" if reject not found
    const acceptButton = page.getByRole('button', { name: /accept all/i });
    const acceptVisible = await acceptButton
      .isVisible({ timeout: timeoutMs })
      .catch(() => false);

    if (acceptVisible) {
      await acceptButton.click();
      console.log('⚠ Clicked "Accept all" on Yahoo consent page (reject not found)');
      return true;
    }

    // No buttons found
    return false;
  },
};

/**
 * Generic consent handler for common patterns
 */
export const genericConsentHandler: InterstitialHandler = {
  detect: (page: Page) => {
    const url = page.url().toLowerCase();
    return (
      url.includes('consent') ||
      url.includes('privacy') ||
      url.includes('cookie')
    );
  },

  handle: async (page: Page, timeoutMs = 15000) => {
    // Try common rejection patterns
    const rejectSelectors = [
      'button:has-text("Reject")',
      'button:has-text("Decline")',
      'button:has-text("No")',
      '[data-consent="reject"]',
      '.reject-all',
      '#reject-all',
    ];

    for (const selector of rejectSelectors) {
      try {
        const button = page.locator(selector).first();
        if (await button.isVisible({ timeout: 1000 })) {
          await button.click();
          console.log(`✓ Clicked consent rejection button: ${selector}`);
          return true;
        }
      } catch {
        // Continue to next selector
      }
    }

    // Fallback to accept if reject not found
    const acceptSelectors = [
      'button:has-text("Accept")',
      'button:has-text("Agree")',
      'button:has-text("Yes")',
      '[data-consent="accept"]',
      '.accept-all',
      '#accept-all',
    ];

    for (const selector of acceptSelectors) {
      try {
        const button = page.locator(selector).first();
        if (await button.isVisible({ timeout: 1000 })) {
          await button.click();
          console.log(`⚠ Clicked consent acceptance button: ${selector}`);
          return true;
        }
      } catch {
        // Continue to next selector
      }
    }

    return false;
  },
};

/**
 * Handle interstitial pages (consent, privacy, etc.)
 */
export async function handleInterstitial(
  page: Page,
  mode: 'yahoo' | 'generic' | false,
  timeoutMs = 15000
): Promise<boolean> {
  if (mode === false) {
    return false;
  }

  const handler = mode === 'yahoo' ? yahooConsentHandler : genericConsentHandler;

  // Check if we're on an interstitial
  const isInterstitial = await Promise.resolve(handler.detect(page));
  if (!isInterstitial) {
    return false;
  }

  console.log(`Detected ${mode} interstitial at ${page.url()}`);

  // Try to handle it
  const handled = await handler.handle(page, timeoutMs);
  if (!handled) {
    console.warn(`⚠ Could not handle ${mode} interstitial automatically`);
  }

  return handled;
}
