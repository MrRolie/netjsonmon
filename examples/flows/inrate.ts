/**
 * Flow for inrate.com - handles Cloudflare challenge and navigates to data
 */
import type { Page } from 'playwright';

export default async function (page: Page) {
  console.log('Starting inrate.com flow...');
  
  // Wait for Cloudflare challenge to complete (if present)
  // The challenge handler in interstitial.ts will handle this automatically
  // Just wait a bit for the page to stabilize
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
    console.log('Network idle timeout (continuing)');
  });
  
  // Wait for the page to be ready
  await page.waitForTimeout(2000);
  
  console.log('✓ Inrate flow completed, ready to capture API calls');
}
