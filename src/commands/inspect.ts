/**
 * Inspect command - view capture summary and details
 */

import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import chalk from 'chalk';
import { renderEndpointDetail, renderCaptureStats, renderEndpointsTable, outputJSON, divider, type EndpointSummary } from '../ui/render.js';
import { formatBytes, formatNumber, formatDuration } from '../ui/format.js';

export interface InspectCommandOptions {
  show?: string;  // Specific endpoint to show detail for
  json?: boolean;
  quiet?: boolean;
}

interface Summary {
  runId: string;
  startedAt: string;
  completedAt?: string;
  url: string;
  captureDir: string;
  totalResponses: number;
  jsonCaptures: number;
  duplicatesSkipped: number;
  redactionsApplied: number;
  truncatedBodies: number;
  endpoints: any[];
}

export async function inspectCommand(captureDir: string, options: InspectCommandOptions): Promise<void> {
  const resolvedDir = resolve(captureDir);
  const summaryPath = join(resolvedDir, 'summary.json');
  
  try {
    const summaryContent = await readFile(summaryPath, 'utf-8');
    const summary: Summary = JSON.parse(summaryContent);
    
    // JSON output mode
    if (options.json) {
      if (options.show) {
        const endpoint = summary.endpoints.find(ep => ep.endpointKey === options.show);
        if (!endpoint) {
          throw new Error(`Endpoint not found: ${options.show}`);
        }
        outputJSON(endpoint);
      } else {
        outputJSON(summary);
      }
      return;
    }
    
    // Show specific endpoint detail
    if (options.show) {
      const endpoint = summary.endpoints.find(ep => ep.endpointKey === options.show);
      if (!endpoint) {
        console.error(chalk.red(`Error: Endpoint not found: ${options.show}`));
        console.log(chalk.gray('\nAvailable endpoints:'));
        summary.endpoints.forEach(ep => {
          console.log('  ' + chalk.cyan(ep.endpointKey));
        });
        process.exit(1);
      }
      
      const detail = {
        ...endpoint,
        schemaVariants: endpoint.distinctSchemas ?? endpoint.schemaHashes?.length ?? 1,
        statusDistribution: endpoint.statusCounts ?? endpoint.statusDistribution ?? {},
      };
      console.log(renderEndpointDetail(detail));
      return;
    }
    
    // Show full summary
    console.log(chalk.bold.cyan('\n📊 Capture Summary\n'));
    console.log(divider());
    
    // Run info
    console.log(chalk.bold('Run Information'));
    console.log(`  Run ID: ${chalk.gray(summary.runId)}`);
    console.log(`  URL: ${chalk.cyan(summary.url)}`);
    console.log(`  Started: ${chalk.gray(new Date(summary.startedAt).toLocaleString())}`);
    if (summary.completedAt) {
      const duration = new Date(summary.completedAt).getTime() - new Date(summary.startedAt).getTime();
      console.log(`  Duration: ${chalk.gray(formatDuration(duration))}`);
    }
    console.log(`  Output: ${chalk.gray(summary.captureDir)}`);
    console.log();
    
    // Capture stats
    console.log(chalk.bold('Capture Statistics\n'));
    console.log(renderCaptureStats({
      totalResponses: summary.totalResponses,
      jsonCaptures: summary.jsonCaptures,
      duplicates: summary.duplicatesSkipped,
      redactions: summary.redactionsApplied,
      truncated: summary.truncatedBodies,
    }));
    console.log();
    
    // Top endpoints
    console.log(chalk.bold(`Top Endpoints (showing ${Math.min(10, summary.endpoints.length)} of ${summary.endpoints.length})\n`));
    
    const endpointSummaries: EndpointSummary[] = summary.endpoints.map((ep, idx) => ({
      rank: idx + 1,
      score: ep.score,
      method: ep.method,
      normalizedPath: ep.normalizedPath,
      count: ep.count,
      avgSize: ep.avgSize,
      schemaVariants: ep.distinctSchemas ?? ep.schemaHashes?.length ?? 1,
      reasons: ep.reasons || [],
    }));
    
    console.log(renderEndpointsTable(endpointSummaries, 10));
    
    // Hints
    if (!options.quiet) {
      console.log();
      console.log(divider());
      console.log(chalk.gray('💡 Tips:'));
      console.log(chalk.gray('  • View endpoint detail: ') + chalk.cyan(`netjsonmon inspect ${captureDir} --show "GET /api/endpoint"`));
      console.log(chalk.gray('  • Filter endpoints: ') + chalk.cyan(`netjsonmon endpoints ${captureDir} --minScore 0.6`));
      console.log(chalk.gray('  • Export to CSV: ') + chalk.cyan(`netjsonmon endpoints ${captureDir} --export csv`));
    }
    
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.error(chalk.red(`Error: summary.json not found in ${resolvedDir}`));
      console.log(chalk.gray('\nMake sure you specified a valid capture directory.'));
      console.log(chalk.gray('Capture directories are named like: 2026-01-20T12-00-00-000Z-abc123'));
    } else {
      throw error;
    }
    process.exit(1);
  }
}
