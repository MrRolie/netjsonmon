/**
 * Example flow: Simple navigation
 * 
 * This flow demonstrates basic page interaction:
 * - Wait for a specific element
 * - Click links or buttons
 * - Scroll to trigger lazy-loaded content
 */

interface WaitForSelectorOptions {
    timeout?: number;
}

interface Page {
    waitForSelector(selector: string, options?: WaitForSelectorOptions): Promise<void>;
    evaluate<R = unknown>(fn: () => R): Promise<R>;
    waitForTimeout(ms: number): Promise<void>;
}

export default async (page: Page): Promise<void> => {
    // Wait for the page to be fully loaded
    await page.waitForSelector('body', { timeout: 5000 });
    
    // Optional: scroll to bottom to trigger lazy-loaded API calls
    await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
    });
    
    // Wait a bit for any lazy-loaded content
    await page.waitForTimeout(1000);
    
    console.log('Example flow completed');
};
