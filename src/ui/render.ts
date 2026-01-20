/**
 * Rendering utilities for terminal output
 * Handles tables, summaries, welcome banners
 */

import Table from 'cli-table3';
import chalk from 'chalk';
import boxen from 'boxen';
import { formatBytes, formatNumber, formatScore, truncate, truncateArray } from './format.js';

export interface OutputMode {
  json: boolean;
  quiet: boolean;
  verbose: boolean;
  debug: boolean;
}

/**
 * Render welcome banner when no args provided
 */
export function renderWelcomeBanner(): string {
  const banner = chalk.cyan.bold(`
 ███╗   ██╗███████╗████████╗    ██╗███████╗ ██████╗ ███╗   ██╗███╗   ███╗ ██████╗ ███╗   ██╗
 ████╗  ██║██╔════╝╚══██╔══╝    ██║██╔════╝██╔═══██╗████╗  ██║████╗ ████║██╔═══██╗████╗  ██║
 ██╔██╗ ██║█████╗     ██║       ██║███████╗██║   ██║██╔██╗ ██║██╔████╔██║██║   ██║██╔██╗ ██║
 ██║╚██╗██║██╔══╝     ██║  ██   ██║╚════██║██║   ██║██║╚██╗██║██║╚██╔╝██║██║   ██║██║╚██╗██║
 ██║ ╚████║███████╗   ██║  ╚█████╔╝███████║╚██████╔╝██║ ╚████║██║ ╚═╝ ██║╚██████╔╝██║ ╚████║
 ╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
`);
  const tagline = chalk.gray('Network JSON monitor — capture & analyze API endpoints');
  
  const examples = [
    chalk.white('Examples:'),
    '  ' + chalk.cyan('netjsonmon run') + ' https://example.com',
    '  ' + chalk.cyan('netjsonmon run') + ' https://app.com --monitorMs 5000 --flow ./flows/login.ts',
    '  ' + chalk.cyan('netjsonmon init') + '              ' + chalk.gray('# Create config + example flow'),
    '  ' + chalk.cyan('netjsonmon inspect') + ' ./captures/2026-01-20T12-00-00-000Z-abc123',
    '  ' + chalk.cyan('netjsonmon endpoints') + ' ./captures/latest --minScore 0.7 --export csv',
  ];
  
  const help = chalk.gray('\nRun') + ' ' + chalk.cyan('netjsonmon --help') + ' ' + chalk.gray('for all options');
  
  return boxen(
    `${banner}\n${tagline}\n\n${examples.join('\n')}${help}`,
    {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'cyan',
    }
  );
}

/**
 * Render run summary header
 */
export function renderRunHeader(url: string, startedAt: string, captureDir: string): string {
  const lines = [
    chalk.bold('Run Started'),
    '  URL: ' + chalk.cyan(url),
    '  Time: ' + chalk.gray(new Date(startedAt).toLocaleString()),
    '  Output: ' + chalk.gray(captureDir),
  ];
  return lines.join('\n');
}

/**
 * Render capture statistics
 */
export function renderCaptureStats(stats: {
  totalResponses: number;
  jsonCaptures: number;
  duplicates: number;
  redactions: number;
  truncated: number;
}): string {
  const table = new Table({
    head: [chalk.bold('Metric'), chalk.bold('Count')],
    style: { head: [], border: ['gray'] },
  });
  
  table.push(
    ['Total Responses', formatNumber(stats.totalResponses)],
    [chalk.green('JSON Captures'), chalk.green(formatNumber(stats.jsonCaptures))],
    [chalk.yellow('Duplicates Skipped'), formatNumber(stats.duplicates)],
    [chalk.blue('Redactions Applied'), formatNumber(stats.redactions)],
    [chalk.yellow('Truncated Bodies'), formatNumber(stats.truncated)]
  );
  
  return table.toString();
}

export interface EndpointSummary {
  rank: number;
  score: number;
  method: string;
  normalizedPath: string;
  count: number;
  avgSize: number;
  schemaVariants: number;
  reasons: string[];
}

/**
 * Render top endpoints table
 */
export function renderEndpointsTable(endpoints: EndpointSummary[], topN: number = 10): string {
  if (endpoints.length === 0) {
    return chalk.yellow('No endpoints captured');
  }
  
  const table = new Table({
    head: [
      chalk.bold('#'),
      chalk.bold('Score'),
      chalk.bold('Method'),
      chalk.bold('Path'),
      chalk.bold('Count'),
      chalk.bold('Avg Size'),
      chalk.bold('Schemas'),
      chalk.bold('Reasons'),
    ],
    style: { head: [], border: ['gray'] },
    colWidths: [4, 8, 8, 35, 8, 12, 9, 50],
    wordWrap: true,
  });
  
  const displayed = endpoints.slice(0, topN);
  
  for (const endpoint of displayed) {
    const scoreColor = endpoint.score >= 0.7 ? chalk.green : endpoint.score >= 0.4 ? chalk.yellow : chalk.white;
    const reasons = truncateArray(endpoint.reasons, 2, 40);
    
    table.push([
      chalk.gray(endpoint.rank.toString()),
      scoreColor(formatScore(endpoint.score)),
      chalk.cyan(endpoint.method),
      truncate(endpoint.normalizedPath, 33),
      formatNumber(endpoint.count),
      formatBytes(endpoint.avgSize),
      endpoint.schemaVariants.toString(),
      chalk.gray(reasons),
    ]);
  }
  
  return table.toString();
}

/**
 * Render next actions/hints
 */
export function renderNextActions(captureDir: string): string {
  const lines = [
    chalk.bold('\nNext Actions:'),
    '  • View detailed summary: ' + chalk.cyan(`netjsonmon inspect ${captureDir}`),
    '  • Filter endpoints: ' + chalk.cyan(`netjsonmon endpoints ${captureDir} --minScore 0.6`),
    '  • Export to CSV: ' + chalk.cyan(`netjsonmon endpoints ${captureDir} --export csv`),
    '  • Open folder: ' + chalk.gray(captureDir),
  ];
  return lines.join('\n');
}

/**
 * Render endpoint detail view
 */
export function renderEndpointDetail(endpoint: {
  endpointKey: string;
  method: string;
  normalizedPath: string;
  count: number;
  score: number;
  avgSize: number;
  maxSize: number;
  schemaVariants: number;
  hosts: string[];
  statusDistribution: Record<number, number>;
  reasons: string[];
  sampleKeyPaths: string[];
  firstSeen: string;
  lastSeen: string;
}): string {
  const lines = [
    chalk.bold.cyan(`${endpoint.method} ${endpoint.normalizedPath}`),
    '',
    chalk.bold('Overview'),
    `  Score: ${chalk.green(formatScore(endpoint.score))}`,
    `  Count: ${formatNumber(endpoint.count)}`,
    `  Avg Size: ${formatBytes(endpoint.avgSize)}`,
    `  Max Size: ${formatBytes(endpoint.maxSize)}`,
    `  Schema Variants: ${endpoint.schemaVariants}`,
    '',
    chalk.bold('Scoring Reasons'),
    ...endpoint.reasons.map(r => `  • ${r}`),
    '',
    chalk.bold('Hosts'),
    ...endpoint.hosts.map(h => `  • ${h}`),
    '',
    chalk.bold('Status Distribution'),
    ...Object.entries(endpoint.statusDistribution).map(
      ([status, count]) => `  ${status}: ${formatNumber(count)}`
    ),
  ];
  
  if (endpoint.sampleKeyPaths.length > 0) {
    lines.push('', chalk.bold('Sample Key Paths'), ...endpoint.sampleKeyPaths.map(k => `  • ${k}`));
  }
  
  lines.push(
    '',
    chalk.gray(`First seen: ${new Date(endpoint.firstSeen).toLocaleString()}`),
    chalk.gray(`Last seen: ${new Date(endpoint.lastSeen).toLocaleString()}`)
  );
  
  return lines.join('\n');
}

/**
 * Render a simple list of endpoints (for filtering/export preview)
 */
export function renderEndpointList(endpoints: Array<{ method: string; path: string; score: number; count: number }>): string {
  const lines = endpoints.map(ep => 
    `${chalk.cyan(ep.method.padEnd(6))} ${truncate(ep.path, 60).padEnd(60)} ${chalk.gray(`score: ${formatScore(ep.score)}, count: ${ep.count}`)}`
  );
  return lines.join('\n');
}

/**
 * Output as JSON (for --json mode)
 */
export function outputJSON(data: any): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Create a divider line
 */
export function divider(char: string = '─', length: number = 80): string {
  return chalk.gray(char.repeat(length));
}
