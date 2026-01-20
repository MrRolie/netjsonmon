#!/usr/bin/env node

/**
 * netjsonmon CLI entry point
 */

import { Command } from 'commander';
import { loadConfig, mergeConfig } from './config.js';
import { renderWelcomeBanner } from './ui/render.js';
import { runCommand } from './commands/run.js';
import { initCommand } from './commands/init.js';
import { inspectCommand } from './commands/inspect.js';
import { endpointsCommand } from './commands/endpoints.js';

const program = new Command();

program
  .name('netjsonmon')
  .description('Monitor and capture JSON network responses')
  .version('2.0.0')
  .option('--config <path>', 'Path to config file');

// Run command (capture JSON responses)
program
  .command('run <url>')
  .description('Capture JSON network responses from a URL')
  .option('--headless', 'Run browser in headless mode', true)
  .option('--monitorMs <ms>', 'Capture window duration in milliseconds', '10000')
  .option('--timeoutMs <ms>', 'Overall timeout in milliseconds', '30000')
  .option('--outDir <dir>', 'Output directory', './captures')
  .option('--includeRegex <pattern>', 'Only capture URLs matching this regex')
  .option('--excludeRegex <pattern>', 'Exclude URLs matching this regex')
  .option('--maxBodyBytes <bytes>', 'Maximum body size to capture', '1048576')
  .option('--inlineBodyBytes <bytes>', 'Inline bodies smaller than this', '16384')
  .option('--maxCaptures <count>', 'Maximum number of captures (0 = unlimited)', '0')
  .option('--maxConcurrentCaptures <count>', 'Maximum concurrent capture operations', '6')
  .option('--captureAllJson', 'Capture JSON from all resource types', false)
  .option('--flow <path>', 'Path to custom flow module')
  .option('--saveHar', 'Save HAR file for debugging', false)
  .option('--trace', 'Save Playwright trace for debugging', false)
  .option('--userAgent <string>', 'Custom user agent')
  .option('--consentMode <mode>', 'Consent handling: auto, off, yahoo, generic', 'off')
  .option('--consentAction <action>', 'Consent action preference: reject or accept', 'reject')
  .option('--consentHandlers <list>', 'Comma-separated handlers to enable (default: all)', undefined)
  .option('--storageState <path>', 'Load browser storage state from file')
  .option('--saveStorageState', 'Save browser storage state after flow', false)
  .option('--disableSummary', 'Disable automatic summary generation', false)
  .option('--quiet', 'Suppress non-essential output', false)
  .option('--verbose', 'Show verbose progress information', false)
  .option('--debug', 'Show debug information (timing, queue stats)', false)
  .option('--json', 'Output results as JSON (disables colors/spinners)', false)
  .option('--open', 'Open capture directory after completion', false)
  .action(async (url: string, options: any, command: Command) => {
    try {
      // Load config file if specified or search for one
      const configPath = command.parent?.opts().config;
      const config = await loadConfig(configPath);
      const merged = mergeConfig(config, options);
      
      await runCommand(url, merged as any);
      
      // Force exit to prevent hanging on Playwright cleanup
      process.exit(0);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Init command (create config + example flow)
program
  .command('init')
  .description('Create configuration file and example flow')
  .option('--outDir <dir>', 'Output directory for captures')
  .option('--format <format>', 'Config file format: json or yaml', 'yaml')
  .option('--force', 'Overwrite existing files', false)
  .action(async (options: any) => {
    try {
      await initCommand(options);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Inspect command (view capture summary)
program
  .command('inspect <captureDir>')
  .description('View capture summary and endpoint details')
  .option('--show <endpointKey>', 'Show detailed information for specific endpoint')
  .option('--json', 'Output as JSON', false)
  .option('--quiet', 'Suppress hints and tips', false)
  .action(async (captureDir: string, options: any) => {
    try {
      await inspectCommand(captureDir, options);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Endpoints command (filter/sort/export endpoints)
program
  .command('endpoints <captureDir>')
  .description('Filter, sort, and export endpoints from a capture')
  .option('--minScore <score>', 'Minimum score threshold (0-1)')
  .option('--maxScore <score>', 'Maximum score threshold (0-1)')
  .option('--host <hostname>', 'Filter by hostname')
  .option('--method <method>', 'Filter by HTTP method (GET, POST, etc.)')
  .option('--pathContains <substring>', 'Filter paths containing substring')
  .option('--sort <field>', 'Sort by: score, count, or avgSize', 'score')
  .option('--limit <count>', 'Limit number of results')
  .option('--export <format>', 'Export format: csv, jsonl, or md')
  .option('--out <filename>', 'Output filename for export')
  .option('--json', 'Output as JSON', false)
  .action(async (captureDir: string, options: any) => {
    try {
      await endpointsCommand(captureDir, options);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Show welcome banner if no command provided
if (process.argv.length === 2) {
  console.log(renderWelcomeBanner());
  process.exit(0);
}

program.parse();
