/**
 * Configuration file support for netjsonmon
 * Loads config from .netjsonmon.json, .netjsonmon.yaml, or package.json
 * CLI flags override config file values
 */

import { cosmiconfig } from 'cosmiconfig';
import path from 'path';

export interface NetJsonMonConfig {
  // Core options
  headless?: boolean;
  monitorMs?: number;
  timeoutMs?: number;
  outDir?: string;
  
  // Filtering
  includeRegex?: string;
  excludeRegex?: string;
  
  // Limits
  maxBodyBytes?: number;
  inlineBodyBytes?: number;
  maxCaptures?: number;
  maxConcurrentCaptures?: number;
  
  // Capture behavior
  captureAllJson?: boolean;
  flow?: string;
  
  // Artifacts
  saveHar?: boolean;
  trace?: boolean;
  
  // Browser
  userAgent?: string;
  consentMode?: 'auto' | 'off' | 'yahoo' | 'generic';
  consentAction?: 'reject' | 'accept';
  consentHandlers?: string[];
  storageState?: string;
  saveStorageState?: boolean;
  
  // Output
  disableSummary?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  debug?: boolean;
  json?: boolean;
}

const explorer = cosmiconfig('netjsonmon', {
  searchPlaces: [
    'package.json',
    '.netjsonmon.json',
    '.netjsonmon.yaml',
    '.netjsonmon.yml',
    'netjsonmon.config.json',
    'netjsonmon.config.yaml',
    'netjsonmon.config.yml',
  ],
});

/**
 * Load configuration from file system
 * Returns null if no config file found
 */
export async function loadConfig(searchFrom?: string): Promise<NetJsonMonConfig | null> {
  try {
    const result = await explorer.search(searchFrom);
    if (!result || result.isEmpty) {
      return null;
    }
    return result.config as NetJsonMonConfig;
  } catch (error) {
    // Config file exists but is malformed
    if (error instanceof Error) {
      throw new Error(`Failed to load config: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Merge config file with CLI options
 * CLI options take precedence over config file
 */
export function mergeConfig<T extends Record<string, any>>(
  configFile: NetJsonMonConfig | null,
  cliOptions: T
): T {
  if (!configFile) {
    return cliOptions;
  }
  
  // Start with config file values
  const merged = { ...configFile } as any;
  
  // Override with CLI options (only if explicitly provided)
  for (const [key, value] of Object.entries(cliOptions)) {
    // Only override if the CLI value is not undefined
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  
  return merged as T;
}

/**
 * Resolve file paths in config relative to config file location
 */
export function resolveConfigPaths(
  config: NetJsonMonConfig,
  configDir: string
): NetJsonMonConfig {
  const resolved = { ...config };
  
  // Resolve relative paths
  if (resolved.outDir && !path.isAbsolute(resolved.outDir)) {
    resolved.outDir = path.resolve(configDir, resolved.outDir);
  }
  
  if (resolved.flow && !path.isAbsolute(resolved.flow)) {
    resolved.flow = path.resolve(configDir, resolved.flow);
  }
  
  if (resolved.storageState && !path.isAbsolute(resolved.storageState)) {
    resolved.storageState = path.resolve(configDir, resolved.storageState);
  }
  
  return resolved;
}
