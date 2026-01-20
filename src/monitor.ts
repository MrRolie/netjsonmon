/**
 * Monitor orchestrator - captures network JSON during a deterministic window
 */

import { chromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright';
import { randomBytes } from 'crypto';
import { resolve } from 'path';
import type { MonitorOptions, CaptureRecord } from './types.js';
import { CaptureStore } from './store.js';
import { runFlow } from './flowRunner.js';
import { redactHeaders, redactUrl, redactError } from './redact.js';
import { handleInterstitial } from './interstitial.js';
import { normalizeUrl, endpointKey } from './normalize.js';
import { extractFeatures } from './features.js';

const XHR_FETCH_TYPES = new Set(['xhr', 'fetch']);
const JSON_CONTENT_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/hal+json',
  'application/vnd.api+json',
]);

/**
 * Check if content-type indicates JSON
 */
function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return Array.from(JSON_CONTENT_TYPES).some(type => lower.includes(type));
}

/**
 * Main monitor function
 */
export async function monitor(options: MonitorOptions): Promise<void> {
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(4).toString('hex');
  const store = new CaptureStore(options.outDir, runId, options.inlineBodyBytes);
  
  await store.init();
  await store.saveRunMetadata({
    runId,
    startedAt: new Date().toISOString(),
    url: options.url,
    options,
  });

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let captureCount = 0;
  let duplicateCount = 0;
  const includePattern = options.includeRegex ? new RegExp(options.includeRegex) : null;
  const excludePattern = options.excludeRegex ? new RegExp(options.excludeRegex) : null;
  
  // Deduplication set: tracks (endpointKey|status|bodyHash) tuples
  const seenCaptures = new Set<string>();

  try {
    // Launch browser
    browser = await chromium.launch({ headless: options.headless });
    
    // Create context with optional HAR recording and storage state
    const contextOptions: any = {
      userAgent: options.userAgent,
    };
    
    if (options.storageState) {
      contextOptions.storageState = options.storageState;
    }
    
    if (options.saveHar) {
      contextOptions.recordHar = {
        path: resolve(options.outDir, runId, 'session.har'),
        mode: 'minimal',
      };
    }

    context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    // Set up response handler
    page.on('response', async (response: Response) => {
      try {
        const result = await handleResponse(response, options, store, includePattern, excludePattern, captureCount, seenCaptures);
        if (result === 'captured') {
          captureCount++;
        } else if (result === 'duplicate') {
          duplicateCount++;
        }
      } catch (error) {
        console.error('Error handling response:', error);
      }
    });

    // Navigate with timeout
    const navigationPromise = page.goto(options.url, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs,
    });

    await Promise.race([
      navigationPromise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Navigation timeout')), options.timeoutMs)
      ),
    ]);

    // Handle interstitial pages (consent, privacy, etc.)
    if (options.autoConsent !== false) {
      const handled = await handleInterstitial(page, options.autoConsent, options.timeoutMs);
      if (handled) {
        // Wait for navigation to complete after dismissing interstitial
        await page.waitForLoadState('domcontentloaded', { timeout: options.timeoutMs });
      }
    }

    // Wait until we're on the target host before starting capture window
    const targetHost = new URL(options.url).hostname;
    try {
      await page.waitForURL(
        (url) => new URL(url).hostname === targetHost,
        { timeout: options.timeoutMs }
      );
      console.log(`✓ On target host: ${targetHost}`);
    } catch {
      console.warn(`⚠ Did not reach target host ${targetHost}, continuing anyway`);
    }

    // Wait for network idle (bounded)
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch {
      // Continue even if networkidle times out
    }

    // Run optional flow
    if (options.flow) {
      const flowPath = resolve(options.flow);
      await runFlow(page, flowPath, options.timeoutMs);
    }

    // Save storage state if requested
    if (options.saveStorageState && context) {
      const storageStatePath = resolve(options.outDir, runId, 'storageState.json');
      await context.storageState({ path: storageStatePath });
      console.log(`✓ Saved storage state to ${storageStatePath}`);
    }

    // Capture window
    console.log(`Monitoring for ${options.monitorMs}ms...`);
    await new Promise(resolve => setTimeout(resolve, options.monitorMs));

    console.log(`Captured ${captureCount} responses (${duplicateCount} duplicates skipped)`);
  } finally {
    await context?.close();
    await browser?.close();
  }
}

/**
 * Handle individual response
 * @returns 'captured', 'duplicate', or 'skipped'
 */
async function handleResponse(
  response: Response,
  options: MonitorOptions,
  store: CaptureStore,
  includePattern: RegExp | null,
  excludePattern: RegExp | null,
  captureCount: number,
  seenCaptures: Set<string>
): Promise<'captured' | 'duplicate' | 'skipped'> {
  // Check capture limit
  if (options.maxCaptures > 0 && captureCount >= options.maxCaptures) {
    return 'skipped';
  }

  const url = response.url();
  const status = response.status();
  const request = response.request();
  const resourceType = request.resourceType();

  // Apply URL filters
  if (includePattern && !includePattern.test(url)) {
    return 'skipped';
  }
  if (excludePattern && excludePattern.test(url)) {
    return 'skipped';
  }

  // Get headers
  const responseHeaders = await response.allHeaders();
  const contentType = responseHeaders['content-type'] || '';
  const contentLength = responseHeaders['content-length'];

  // Determine if we should attempt capture
  let shouldCapture = false;

  if (options.captureAllJson) {
    // Capture all resource types when flag is set
    shouldCapture = true;
  } else {
    // Default: only XHR/fetch
    shouldCapture = XHR_FETCH_TYPES.has(resourceType);
    
    // Override: allow if content-type looks like JSON
    if (!shouldCapture && isJsonContentType(contentType)) {
      shouldCapture = true;
    }
  }

  if (!shouldCapture) {
    return 'skipped';
  }

  // Filter by status (only success responses)
  if (status < 200 || status >= 400) {
    return 'skipped';
  }

  // Skip parsing for empty-body status codes
  if (status === 204 || status === 304) {
    await storeMetadataOnly(response, store, 'emptyBody');
    return 'captured';
  }

  // Early gate by content-length hint (if present)
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!isNaN(size) && size > options.maxBodyBytes) {
      await storeMetadataOnly(response, store, 'maxBodyBytes');
      return 'captured';
    }
  }

  // Attempt body read
  let bodyBuffer: Buffer | null = null;
  let jsonParseSuccess = false;
  let parseError: string | undefined;
  let omittedReason: CaptureRecord['omittedReason'] | undefined;
  let bodyAvailable = false;
  let truncated = false;
  let parsedBody: any = undefined;

  try {
    bodyBuffer = await response.body();
    bodyAvailable = true;

    // Check actual size
    if (bodyBuffer.length > options.maxBodyBytes) {
      omittedReason = 'maxBodyBytes';
      truncated = true;
      bodyBuffer = null;
    } else {
      // Attempt JSON parse
      try {
        const text = bodyBuffer.toString('utf-8');
        parsedBody = JSON.parse(text);
        jsonParseSuccess = true;
      } catch (error) {
        parseError = redactError(error as Error);
        
        // If not captureAllJson mode and parse fails, skip non-JSON responses
        if (!options.captureAllJson && !isJsonContentType(contentType)) {
          omittedReason = 'nonJson';
          bodyBuffer = null;
        } else {
          omittedReason = 'parseError';
          bodyBuffer = null;
        }
      }
    }
  } catch (error) {
    omittedReason = 'unavailable';
    parseError = redactError(error as Error);
  }

  // Compute normalization and features (only for successful JSON parse)
  let normalizedUrl_: string | undefined;
  let normalizedPath: string | undefined;
  let endpointKey_: string | undefined;
  let features: CaptureRecord['features'] | undefined;

  if (jsonParseSuccess && parsedBody !== undefined) {
    try {
      // Normalize URL (apply to redacted URL)
      const redactedUrl = redactUrl(url);
      const normalized = normalizeUrl(redactedUrl);
      normalizedUrl_ = normalized.normalizedUrl;
      normalizedPath = normalized.normalizedPath;
      endpointKey_ = endpointKey(request.method(), normalizedPath);

      // Extract features
      features = extractFeatures(parsedBody);
    } catch (error) {
      // If normalization/feature extraction fails, proceed without them
      console.warn(`Feature extraction failed for ${url}:`, error);
    }
  }

  // Check for duplicates using (endpointKey|status|bodyHash)
  // We need to compute bodyHash first
  const bodyHashPreview = bodyBuffer ? store.computeHash(bodyBuffer) : '';
  const dedupeKey = `${endpointKey_ || url}|${status}|${bodyHashPreview}`;
  
  if (seenCaptures.has(dedupeKey)) {
    // Duplicate detected, skip saving
    return 'duplicate';
  }
  
  // Mark as seen
  seenCaptures.add(dedupeKey);

  // Build capture record
  const record: Omit<CaptureRecord, 'bodyHash' | 'bodyPath' | 'inlineBody'> = {
    timestamp: new Date().toISOString(),
    url: redactUrl(url),
    status,
    method: request.method(),
    requestHeaders: redactHeaders(await request.allHeaders()),
    responseHeaders: redactHeaders(responseHeaders),
    contentType,
    payloadSize: bodyBuffer?.length || 0,
    bodyAvailable,
    truncated,
    omittedReason,
    jsonParseSuccess,
    parseError,
    normalizedUrl: normalizedUrl_,
    normalizedPath,
    endpointKey: endpointKey_,
    features,
  };

  await store.storeCapture(record, bodyBuffer);
  return 'captured';
}

/**
 * Store metadata-only record (when body is too large or unavailable)
 */
async function storeMetadataOnly(
  response: Response,
  store: CaptureStore,
  reason: CaptureRecord['omittedReason']
): Promise<void> {
  const request = response.request();
  const record: Omit<CaptureRecord, 'bodyHash' | 'bodyPath' | 'inlineBody'> = {
    timestamp: new Date().toISOString(),
    url: redactUrl(response.url()),
    status: response.status(),
    method: request.method(),
    requestHeaders: redactHeaders(await request.allHeaders()),
    responseHeaders: redactHeaders(await response.allHeaders()),
    contentType: (await response.allHeaders())['content-type'] || '',
    payloadSize: 0,
    bodyAvailable: false,
    truncated: true,
    omittedReason: reason,
    jsonParseSuccess: false,
  };

  await store.storeCapture(record, null);
}
