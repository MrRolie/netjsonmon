#!/usr/bin/env node

/**
 * netjsonmon CLI entry point
 */

import { Command } from 'commander';
import { resolve } from 'path';
import { monitor } from './monitor.js';
import type { MonitorOptions } from './types.js';

const program = new Command();

program
  .name('netjsonmon')
  .description('Monitor and capture JSON network responses')
  .version('1.0.0')
  .argument('<url>', 'URL to monitor')
  .option('--headless', 'Run browser in headless mode', true)
  .option('--monitorMs <ms>', 'Capture window duration in milliseconds', '10000')
  .option('--timeoutMs <ms>', 'Overall timeout in milliseconds', '30000')
  .option('--outDir <dir>', 'Output directory', './captures')
  .option('--includeRegex <pattern>', 'Only capture URLs matching this regex')
  .option('--excludeRegex <pattern>', 'Exclude URLs matching this regex')
  .option('--maxBodyBytes <bytes>', 'Maximum body size to capture', '1048576')
  .option('--inlineBodyBytes <bytes>', 'Inline bodies smaller than this', '16384')
  .option('--maxCaptures <count>', 'Maximum number of captures (0 = unlimited)', '0')
  .option('--captureAllJson', 'Capture JSON from all resource types', false)
  .option('--flow <path>', 'Path to custom flow module')
  .option('--saveHar', 'Save HAR file for debugging', false)
  .option('--userAgent <string>', 'Custom user agent')
  .option('--autoConsent <mode>', 'Auto-handle consent pages: yahoo, generic, or false', 'false')
  .option('--storageState <path>', 'Load browser storage state from file')
  .option('--saveStorageState', 'Save browser storage state after flow', false)
  .action(async (url: string, options: any) => {
    try {
      // Parse autoConsent option
      let autoConsent: 'yahoo' | 'generic' | false = false;
      if (options.autoConsent === 'yahoo' || options.autoConsent === 'generic') {
        autoConsent = options.autoConsent;
      }

      const monitorOptions: MonitorOptions = {
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
        captureAllJson: options.captureAllJson,
        flow: options.flow,
        saveHar: options.saveHar,
        userAgent: options.userAgent,
        autoConsent,
        storageState: options.storageState,
        saveStorageState: options.saveStorageState,
      };

      console.log(`Starting monitor for ${url}...`);
      await monitor(monitorOptions);
      console.log('Monitor complete!');
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();
