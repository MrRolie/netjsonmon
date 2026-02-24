/**
 * Monitor orchestrator - captures network JSON during a deterministic window
 */

import { chromium as playwrightChromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright';
import { randomBytes } from 'crypto';
import { resolve } from 'path';
import { STEALTH_ARGS, STEALTH_CONTEXT_OPTIONS, STEALTH_SCRIPTS } from './stealth/index.js';
import { resolveProxy } from './proxy.js';
import ora, { type Ora } from 'ora';
import chalk from 'chalk';
import type { MonitorOptions, CaptureRecord } from './types.js';
import type { OutputMode, LiveEndpointEntry } from './ui/render.js';
import { CaptureStore } from './store.js';
import { runFlow } from './flowRunner.js';
import { redactHeaders, redactUrl, redactError } from './redact.js';
import { handleConsent } from './interstitial.js';
import { normalizeUrl, endpointKey } from './normalize.js';
import { extractFeatures } from './features.js';
import { generateSummary } from './summary.js';
import { ConcurrencyLimiter } from './queue.js';
import { renderRunHeader, renderLiveDashboard } from './ui/render.js';

const XHR_FETCH_TYPES = new Set(['xhr', 'fetch']);
const JSON_CONTENT_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/hal+json',
  'application/vnd.api+json',
]);

type ChromiumLike = {
  launch: typeof playwrightChromium.launch;
  launchPersistentContext: typeof playwrightChromium.launchPersistentContext;
};

let stealthPluginInitialized = false;
let proxyRotationIndex = 0;

/**
 * Check if content-type indicates JSON
 */
function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return Array.from(JSON_CONTENT_TYPES).some(type => lower.includes(type));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${label} timeout (${timeoutMs}ms)`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  });
}

async function getChromiumEngine(stealth: boolean): Promise<ChromiumLike> {
  if (!stealth) {
    return playwrightChromium;
  }

  const playwrightExtra = await import('playwright-extra');
  const chromium = (playwrightExtra as any).chromium as (ChromiumLike & { use?: (plugin: any) => void }) | undefined;
  if (!chromium) {
    throw new Error('Stealth mode failed: playwright-extra did not expose chromium.');
  }

  if (!stealthPluginInitialized) {
    const stealthModule = await import('puppeteer-extra-plugin-stealth');
    const createStealthPlugin = (stealthModule as any).default ?? stealthModule;
    const plugin = typeof createStealthPlugin === 'function'
      ? createStealthPlugin()
      : createStealthPlugin;

    if (!chromium.use || !plugin) {
      throw new Error('Stealth mode failed: unable to initialize puppeteer-extra-plugin-stealth.');
    }

    chromium.use(plugin);
    stealthPluginInitialized = true;
  }

  return chromium;
}

/**
 * Main monitor function
 */
export async function monitor(options: MonitorOptions & { outputMode?: OutputMode }): Promise<{ captureDir: string } | void> {
  const outputMode = options.outputMode || { json: false, quiet: false, verbose: false, debug: false };
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(4).toString('hex');
  const captureDir = resolve(options.outDir, runId);
  const store = new CaptureStore(options.outDir, runId, options.inlineBodyBytes);
  
  await store.init();
  const startedAt = new Date().toISOString();
  await store.saveRunMetadata({
    runId,
    startedAt,
    url: options.url,
    options,
  });

  // Show run header if not quiet/json mode
  if (!outputMode.quiet && !outputMode.json) {
    console.log(renderRunHeader(options.url, startedAt, captureDir));
    console.log();
  }

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let captureCount = 0;
  let duplicateCount = 0;
  let isClosing = false; // Track if we're shutting down
  const includePattern = options.includeRegex ? new RegExp(options.includeRegex) : null;
  const excludePattern = options.excludeRegex ? new RegExp(options.excludeRegex) : null;
  
  // Deduplication set: tracks (endpointKey|status|bodyHash) tuples
  const seenCaptures = new Set<string>();
  
  // Concurrency limiter for capture operations
  const limiter = new ConcurrencyLimiter(options.maxConcurrentCaptures);
  
  const stageLogEnabled = !outputMode.json && !outputMode.quiet && (outputMode.verbose || outputMode.debug || !process.stdout.isTTY);
  const spinnerEnabled = !outputMode.json && !outputMode.quiet && !stageLogEnabled;
  const logStage = (message: string): void => {
    if (stageLogEnabled) {
      console.log(message);
    }
  };
  const startStage = (message: string): Ora | null => {
    if (spinnerEnabled) {
      return ora(message).start();
    }
    logStage(message);
    return null;
  };
  const succeedStage = (spinner: Ora | null, message: string): void => {
    if (spinner) {
      spinner.succeed(message);
    } else {
      logStage(message);
    }
  };
  const infoStage = (spinner: Ora | null, message: string): void => {
    if (spinner) {
      spinner.info(message);
    } else {
      logStage(message);
    }
  };

  // Spinner for progress (disabled in json/quiet mode)
  let spinner: Ora | null = null;
  spinner = startStage('Launching browser...');
  
  // Progress tracking
  let lastProgressLog = Date.now();
  const progressIntervalMs = 2000; // Update spinner every 2 seconds if active
  const operationStartTime = Date.now(); // Track overall operation time
  
  // Create an AbortController for enforcing hard timeout in non-watch runs.
  const abortController = new AbortController();
  let timeoutHandle: NodeJS.Timeout | undefined;
  if (!options.watch) {
    timeoutHandle = setTimeout(() => {
      abortController.abort(new Error(`Hard timeout exceeded (${options.timeoutMs}ms)`));
    }, options.timeoutMs);
  }

  // Phase 3 — resolve proxy (single string or round-robin from list)
  const { proxy: resolvedProxy, nextIndex } = resolveProxy(options, proxyRotationIndex);
  if (options.proxyList && options.proxyList.length > 0) {
    proxyRotationIndex = nextIndex;
  }

  // Phase 4 — watch mode: force visible browser + live endpoint tracking
  if (options.watch) {
    (options as any).headless = false;
  }
  const liveEndpoints = new Map<string, LiveEndpointEntry>();
  const watchStartTime = Date.now();

  try {
    const chromium = await getChromiumEngine(options.stealth);
    // Build Chrome launch args — stealth mode expands to ~30 hardening flags
    const launchArgs = options.stealth
      ? STEALTH_ARGS
      : [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
        ];

    // Build context options — stealth mode adds fingerprint-hardening overrides
    const contextOptions: any = {
      userAgent: options.userAgent,
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      permissions: [],
    };

    if (options.stealth) {
      // Mirrors Scrapling's StealthySessionMixin context hardening:
      // dark color scheme, 2x DPI, geolocation/notifications, HTTPS error tolerance
      Object.assign(contextOptions, STEALTH_CONTEXT_OPTIONS);
    }

    if (options.storageState) {
      contextOptions.storageState = options.storageState;
    }

    if (options.saveHar) {
      contextOptions.recordHar = {
        path: resolve(options.outDir, runId, 'session.har'),
        mode: 'minimal',
      };
    }

    // Phase 3 — inject proxy into context options (mirrors Scrapling's context proxy injection)
    if (resolvedProxy) {
      contextOptions.proxy = resolvedProxy;
    }

    // Launch: persistent profile (--userDataDir) or standard ephemeral context
    if (options.userDataDir) {
      // Mirrors Scrapling's launch_persistent_context approach:
      // the entire Chrome profile (cookies, localStorage, IndexedDB) survives across runs.
      // launchPersistentContext returns a BrowserContext directly — no separate Browser object.
      context = await withTimeout(
        chromium.launchPersistentContext(options.userDataDir, {
          headless: options.headless,
          args: launchArgs,
          ...contextOptions,
        }),
        options.timeoutMs,
        'Persistent browser context launch'
      );
      // browser stays undefined; context.close() also closes the underlying browser
    } else {
      browser = await withTimeout(
        chromium.launch({ headless: options.headless, args: launchArgs }),
        options.timeoutMs,
        'Browser launch'
      );
      context = await withTimeout(
        browser.newContext(contextOptions),
        options.timeoutMs,
        'Browser context creation'
      );
    }
    succeedStage(spinner, options.userDataDir ? 'Browser launched (persistent profile)' : 'Browser launched');

    const page = await withTimeout(context.newPage(), options.timeoutMs, 'Page creation');

    // Inject fingerprint-hardening scripts at CONTEXT level (applies to all pages and frames).
    // Stealth mode: all 6 comprehensive STEALTH_SCRIPTS (matches Scrapling's add_init_script approach).
    // Baseline: minimal 2-script shim (webdriver + chrome) always safe to apply.
    const scriptsToInject = options.stealth
      ? STEALTH_SCRIPTS
      : [
          // Minimal baseline — webdriver removal
          `Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });`,
          // Minimal baseline — chrome object
          `if (!window.chrome) { try { Object.defineProperty(window, 'chrome', { value: { runtime: {} }, writable: true, configurable: false }); } catch (_) {} }`,
        ];
    for (const script of scriptsToInject) {
      await context.addInitScript(script);
    }

    // Start trace if requested
    if (options.trace) {
      spinner = startStage('Starting trace...');
      await context.tracing.start({
        screenshots: true,
        snapshots: true,
      });
      succeedStage(spinner, 'Trace started');
    }

    // Set up response handler with concurrency control
    page.on('response', (response: Response) => {
      // Skip processing if we're closing
      if (isClosing) {
        return;
      }
      
      // Enqueue response handling through limiter
      limiter.run(async () => {
        // Skip if context closed or we're shutting down
        if (isClosing || !context) {
          return 'skipped';
        }
        
        try {
          const result = await handleResponse(
            response, options, store, includePattern, excludePattern, captureCount, seenCaptures,
            // onCapture callback: feed live endpoint stats for --watch dashboard
            (key, method, normalizedPath, payloadSize) => {
              const existing = liveEndpoints.get(key) ?? { method, normalizedPath, count: 0, totalSize: 0 };
              existing.count++;
              existing.totalSize += payloadSize;
              liveEndpoints.set(key, existing);
            },
          );
          if (result === 'captured') {
            captureCount++;
          } else if (result === 'duplicate') {
            duplicateCount++;
          }
          
          // Progress updates (throttled)
          const now = Date.now();
          if (now - lastProgressLog > progressIntervalMs) {
            if (spinner && (limiter.getRunning() > 0 || limiter.getPending() > 0 || captureCount > 0)) {
              spinner.text = `Capturing: ${chalk.green(captureCount.toString())} captured, ${chalk.yellow(duplicateCount.toString())} duplicates, ${limiter.getRunning()} processing, ${limiter.getPending()} queued`;
            } else if (outputMode.verbose && !outputMode.json) {
              console.log(`Progress: ${captureCount} captured, ${duplicateCount} duplicates, ${limiter.getRunning()} processing, ${limiter.getPending()} queued`);
            }
            lastProgressLog = now;
          }
        } catch (error) {
          // Silently ignore errors from closed context
          if (isClosing) {
            return 'skipped';
          }
          if (!outputMode.json) {
            console.error('Error handling response:', error);
          }
        }
      }).catch(error => {
        // Silently ignore errors during shutdown
        if (!isClosing && !outputMode.json) {
          console.error('Limiter error:', error);
        }
      });
    });

    // Navigate with timeout
    spinner = startStage('Navigating to URL...');
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
    succeedStage(spinner, 'Navigation complete');

    // Wait a moment for any Cloudflare challenges or interstitials to appear
    await page.waitForTimeout(1500);

    // Handle interstitial pages (consent, privacy, etc.)
    // Always check for Cloudflare challenges regardless of consentMode
    if (options.consentMode !== 'off') {
      spinner = startStage('Checking for interstitials and challenges...');
      const handled = await handleConsent(
        page,
        options.consentMode,
        options.consentAction,
        options.timeoutMs,
        options.consentHandlers
      );
      if (handled) {
        if (spinner) spinner.text = 'Handled interstitial/challenge, waiting for page...';
        // Wait for navigation to complete after dismissing interstitial
        await page.waitForLoadState('domcontentloaded', { timeout: options.timeoutMs });
        succeedStage(spinner, 'Interstitial/challenge handled');
      } else {
        infoStage(spinner, 'No interstitials or challenges detected');
      }
    } else {
      // Even with consent mode off, check for Cloudflare challenges
      spinner = startStage('Checking for Cloudflare challenges...');
      const handled = await handleConsent(
        page,
        'auto', // Use auto mode just for Cloudflare
        options.consentAction,
        options.timeoutMs,
        ['cloudflare'] // Only check Cloudflare handler
      );
      if (handled) {
        succeedStage(spinner, 'Cloudflare challenge handled');
      } else {
        infoStage(spinner, 'No Cloudflare challenge detected');
      }
    }

    // Wait until we're on the target host before starting capture window
    const targetHost = new URL(options.url).hostname;
    try {
      await page.waitForURL(
        (url) => new URL(url).hostname === targetHost,
        { timeout: options.timeoutMs }
      );
      if (!outputMode.json && !outputMode.quiet) {
        console.log(chalk.green('✓') + ` On target host: ${chalk.cyan(targetHost)}`);
      }
    } catch {
      if (!outputMode.json && !outputMode.quiet) {
        console.log(chalk.yellow('⚠') + ` Did not reach target host ${targetHost}, continuing anyway`);
      }
    }

    // Wait for network idle (bounded)
    spinner = startStage('Waiting for network idle...');
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
      succeedStage(spinner, 'Network idle');
    } catch {
      infoStage(spinner, 'Network idle timeout (continuing)');
    }

    // Run optional flow
    if (options.flow) {
      spinner = startStage('Running custom flow...');
      const flowPath = resolve(options.flow);
      await runFlow(page, flowPath, options.timeoutMs);
      succeedStage(spinner, 'Flow completed');
    }

    // Save storage state if requested (to run capture dir)
    if (options.saveStorageState && context) {
      const storageStatePath = resolve(options.outDir, runId, 'storageState.json');
      await context.storageState({ path: storageStatePath });
      if (!outputMode.json && !outputMode.quiet) {
        console.log(chalk.green('✓') + ` Saved storage state to ${chalk.cyan(storageStatePath)}`);
      }
    }

    // Capture window — watch mode runs until browser closes; normal mode times out after monitorMs
    if (options.watch) {
      // Clear spinners and print an initial empty dashboard
      spinner?.stop();
      spinner = null;
      process.stdout.write('\x1b[2J\x1b[H');

      // Refresh dashboard every 1.5 seconds
      let dashInterval: NodeJS.Timeout | undefined = setInterval(() => {
        const dashboard = renderLiveDashboard(
          options.url, captureDir,
          Date.now() - watchStartTime,
          captureCount, duplicateCount, liveEndpoints,
        );
        process.stdout.write('\x1b[2J\x1b[H' + dashboard + '\n');
      }, 1500);

      // Resolve when the browser window is closed or Ctrl+C is pressed
      await new Promise<void>(res => {
        const done = () => { clearInterval(dashInterval); dashInterval = undefined; res(); };
        if (browser) browser.once('disconnected', done);
        else context?.once('close', done);  // persistent context case
        process.once('SIGINT', done);
        abortController.signal.addEventListener('abort', done);
      });

      // Final render then clear
      const finalDash = renderLiveDashboard(
        options.url, captureDir,
        Date.now() - watchStartTime,
        captureCount, duplicateCount, liveEndpoints,
      );
      process.stdout.write('\x1b[2J\x1b[H' + finalDash + '\n');
      if (!outputMode.json && !outputMode.quiet) {
        console.log('\n' + chalk.green('✓') + ' Watch session ended — finalizing captures...');
      }
    } else {
      // Normal timed capture window
      spinner = startStage(`Monitoring network (${options.monitorMs}ms)...`);
      if (abortController.signal.aborted) {
        throw abortController.signal.reason;
      }
      const monitorPromise = new Promise<void>(resolve => setTimeout(resolve, options.monitorMs));
      await Promise.race([
        monitorPromise,
        new Promise<void>((_, reject) => {
          abortController.signal.addEventListener('abort', () => {
            reject(abortController.signal.reason);
          });
        })
      ]);
      succeedStage(spinner, 'Monitoring complete');
    }

    // Wait for all in-flight captures to complete (with generous timeout)
    spinner = startStage('Finalizing captures...');
    
    // Wait for limiter to drain with generous timeout for remaining captures
    try {
      const drainTimeoutMs = Math.max(10000, options.timeoutMs - (Date.now() - operationStartTime)); // At least 10 seconds
      await Promise.race([
        limiter.drain(),
        new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error('Drain timeout')), drainTimeoutMs);
        })
      ]);
    } catch (error) {
      // Log but don't fail - we still have the captures we got
      if (!outputMode.json && outputMode.debug) {
        console.log(`⚠ Drain operation: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    succeedStage(spinner, `Captured ${chalk.green(captureCount)} responses (${chalk.yellow(duplicateCount)} duplicates skipped)`);
    
    // Stop trace if enabled
    if (options.trace && context) {
      spinner = startStage('Stopping trace...');
      try {
        const tracePath = resolve(options.outDir, runId, 'trace.zip');
        await context.tracing.stop({ path: tracePath });
        if (!outputMode.json && !outputMode.quiet) {
          const fs = await import('fs');
          const stats = fs.statSync(tracePath);
          const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
          console.log(chalk.green('✓') + ` Saved trace (${sizeMB} MB)`);
        }
      } catch (error) {
        if (!outputMode.json && outputMode.debug) {
          console.log(`⚠ Trace stop error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // Save session to custom path (--saveSession) after capture/watch, before browser close.
    if (options.saveSession && context) {
      await context.storageState({ path: options.saveSession });
      if (!outputMode.json && !outputMode.quiet) {
        console.log(chalk.green('✓') + ` Saved session to ${chalk.cyan(options.saveSession)}`);
      }
    }
    
    // Mark as closing and close browser before summary generation (cleanup can take 1-2 seconds)
    isClosing = true;
    spinner = startStage('Closing browser...');
    try {
      if (context) {
        await context.close().catch(() => {});
        context = undefined;
      }
      if (browser) {
        await browser.close().catch(() => {});
        browser = undefined;
      }
      succeedStage(spinner, 'Browser closed');
    } catch (error) {
      if (!outputMode.json && outputMode.debug) {
        console.log(`⚠ Browser close error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Generate summary (unless disabled) - this always succeeds even if capture had issues
    if (!options.disableSummary) {
      spinner = startStage('Generating endpoint summary...');
      try {
        const runDir = resolve(options.outDir, runId);
        await generateSummary(runDir, outputMode);
        succeedStage(spinner, 'Summary generated');
      } catch (error) {
        if (!outputMode.json) {
          console.log(`⚠ Summary generation error: ${error instanceof Error ? error.message : String(error)}`);
        }
        spinner?.stop();
      }
    }
    
    return { captureDir };
  } finally {
    // Clear the hard timeout
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    
    // Cleanup in case of early exit/error (should be no-op now)
    spinner?.stop();
    if (context) {
      await context.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
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
  seenCaptures: Set<string>,
  // Optional callback for Phase 4 watch-mode live stats
  onCapture?: (endpointKey: string, method: string, normalizedPath: string, payloadSize: number) => void,
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

  // Get headers - handle closed context gracefully
  let responseHeaders: Record<string, string>;
  try {
    responseHeaders = await response.allHeaders();
  } catch (error) {
    // Context was closed, skip this response
    if ((error as any)?.message?.includes('closed')) {
      return 'skipped';
    }
    throw error;
  }
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
  // Notify live dashboard (watch mode) with endpoint identity and payload size
  if (onCapture && endpointKey_) {
    onCapture(endpointKey_, record.method, normalizedPath ?? endpointKey_, bodyBuffer?.length ?? record.payloadSize);
  }
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
