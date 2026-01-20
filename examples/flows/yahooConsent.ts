/**
 * Example flow: Yahoo consent page handler
 * 
 * This flow demonstrates how to handle Yahoo's consent/privacy interstitial.
 * It attempts to click "Reject all" (recommended for repeatability),
 * with a fallback to "Accept all" if reject is not found.
 * 
 * Usage:
 *   npm run dev -- https://ca.finance.yahoo.com/quote/AAPL --flow ./examples/flows/yahooConsent.ts
 */

import type { Page } from 'playwright';

export default async function yahooConsentFlow(page: Page) {
  const currentUrl = page.url();
  
  // Check if we're on a Yahoo consent page
  if (!currentUrl.includes('consent.yahoo.com')) {
    console.log('Not on Yahoo consent page, skipping...');
    return;
  }

  console.log('Handling Yahoo consent page...');

  // Try to find and click "Reject all" button (recommended)
  try {
    const rejectButton = page.getByRole('button', { name: /reject all/i });
    const isVisible = await rejectButton.isVisible({ timeout: 10000 });
    
    if (isVisible) {
      await rejectButton.click();
      console.log('✓ Clicked "Reject all" on Yahoo consent page');
      
      // Wait for navigation after clicking
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
      return;
    }
  } catch (error) {
    console.log('Reject button not found, trying accept...');
  }

  // Fallback: try to find and click "Accept all" button
  try {
    const acceptButton = page.getByRole('button', { name: /accept all/i });
    const isVisible = await acceptButton.isVisible({ timeout: 5000 });
    
    if (isVisible) {
      await acceptButton.click();
      console.log('⚠ Clicked "Accept all" on Yahoo consent page');
      
      // Wait for navigation after clicking
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
      return;
    }
  } catch (error) {
    console.error('Could not find any consent buttons');
  }

  console.warn('⚠ Could not handle Yahoo consent page automatically');
}
