/**
 * Run command - capture network JSON responses
 */

import { resolve } from 'path';
import { monitor } from '../monitor.js';
import type { MonitorOptions } from '../types.js';
import type { OutputMode } from '../ui/render.js';

export interface RunCommandOptions {
  // Core options
  headless: boolean;
  monitorMs: string;
  timeoutMs: string;
  outDir: string;
  
  // Filtering
  includeRegex?: string;
  excludeRegex?: string;
  
  // Limits
  maxBodyBytes: string;
  inlineBodyBytes: string;
  maxCaptures: string;
  maxConcurrentCaptures: string;
  
  // Capture behavior
  captureAllJson: boolean;
  flow?: string;
  
  // Artifacts
  saveHar: boolean;
  trace: boolean;
  
  // Browser
  userAgent?: string;
  consentMode?: string;
  consentAction?: string;
  consentHandlers?: string;
  storageState?: string;
  saveStorageState: boolean;
  
  // Output
  disableSummary: boolean;
  quiet: boolean;
  verbose: boolean;
  debug: boolean;
  json: boolean;
  open: boolean;
}

export async function runCommand(url: string, options: RunCommandOptions): Promise<void> {
  // Parse consent options
  const rawMode = options.consentMode ?? 'off';
  const normalizedMode = String(rawMode).toLowerCase();
  const consentMode: 'auto' | 'off' | 'yahoo' | 'generic' =
    normalizedMode === 'auto' ? 'auto'
    : normalizedMode === 'yahoo' ? 'yahoo'
    : normalizedMode === 'generic' ? 'generic'
    : normalizedMode === 'false' || normalizedMode === '0' || normalizedMode === 'off'
      ? 'off'
      : 'off';

  const normalizedAction = (options.consentAction ?? 'reject').toLowerCase();
  const consentAction: 'reject' | 'accept' = normalizedAction === 'accept' ? 'accept' : 'reject';

  const consentHandlers = Array.isArray(options.consentHandlers)
    ? options.consentHandlers
    : typeof options.consentHandlers === 'string'
      ? options.consentHandlers.split(',').map(h => h.trim()).filter(Boolean)
      : undefined;

  const monitorOptions: MonitorOptions & { outputMode: OutputMode } = {
    url,
    headless: options.headless,
    monitorMs: parseInt(options.monitorMs, 10),
    timeoutMs: parseInt(options.timeoutMs, 10),
    outDir: resolve(options.outDir),
    includeRegex: options.includeRegex,
    excludeRegex: options.excludeRegex,
    maxBodyBytes: parseInt(options.maxBodyBytes, 10),
    inlineBodyBytes: parseInt(options.inlineBodyBytes, 10),
    maxCaptures: parseInt(options.maxCaptures, 10),
    maxConcurrentCaptures: parseInt(options.maxConcurrentCaptures, 10),
    captureAllJson: options.captureAllJson,
    flow: options.flow,
    saveHar: options.saveHar,
    trace: options.trace,
    userAgent: options.userAgent,
    consentMode,
    consentAction,
    consentHandlers,
    storageState: options.storageState,
    saveStorageState: options.saveStorageState,
    disableSummary: options.disableSummary,
    outputMode: {
      json: options.json,
      quiet: options.quiet,
      verbose: options.verbose,
      debug: options.debug,
    },
  };

  // Validate options
  if (monitorOptions.monitorMs >= monitorOptions.timeoutMs) {
    throw new Error('monitorMs must be less than timeoutMs');
  }
  if (monitorOptions.inlineBodyBytes > monitorOptions.maxBodyBytes) {
    throw new Error('inlineBodyBytes must not exceed maxBodyBytes');
  }
  if (monitorOptions.maxConcurrentCaptures < 1) {
    throw new Error('maxConcurrentCaptures must be at least 1');
  }

  const result = await monitor(monitorOptions as any);

  // Open capture directory if requested
  if (options.open && result?.captureDir) {
    const open = (await import('open')).default;
    await open(result.captureDir);
  }
}
