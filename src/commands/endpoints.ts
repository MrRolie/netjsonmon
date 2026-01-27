/**
 * Endpoints command - filter, sort, and export endpoints
 */

import { readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import chalk from 'chalk';
import { renderEndpointList, outputJSON } from '../ui/render.js';
import { formatBytes, formatScore } from '../ui/format.js';

export interface EndpointsCommandOptions {
  minScore?: string;
  maxScore?: string;
  host?: string;
  method?: string;
  pathContains?: string;
  sort?: 'score' | 'count' | 'avgSize';
  export?: 'csv' | 'jsonl' | 'md';
  out?: string;
  json?: boolean;
  limit?: string;
}

interface Endpoint {
  endpointKey: string;
  method: string;
  normalizedPath: string;
  count: number;
  score: number;
  avgSize: number;
  maxSize: number;
  schemaHashes?: string[];
  hosts: string[];
  statusDistribution: Record<number, number>;
  reasons: string[];
  sampleKeyPaths?: string[];
  firstSeen: string;
  lastSeen: string;
  bodyAvailableCount?: number;
  jsonParseSuccessCount?: number;
  noBodyCount?: number;
  bodyAvailableRate?: number;
  bodyRate?: number;
  bodyEvidenceFactor?: number;
}

export async function endpointsCommand(captureDir: string, options: EndpointsCommandOptions): Promise<void> {
  const resolvedDir = resolve(captureDir);
  const summaryPath = join(resolvedDir, 'summary.json');
  
  try {
    const summaryContent = await readFile(summaryPath, 'utf-8');
    const summary = JSON.parse(summaryContent);
    let endpoints: Endpoint[] = summary.endpoints || [];
    
    // Apply filters
    if (options.minScore) {
      const minScore = parseFloat(options.minScore);
      endpoints = endpoints.filter(ep => ep.score >= minScore);
    }
    
    if (options.maxScore) {
      const maxScore = parseFloat(options.maxScore);
      endpoints = endpoints.filter(ep => ep.score <= maxScore);
    }
    
    if (options.host) {
      endpoints = endpoints.filter(ep => 
        ep.hosts.some(h => h.includes(options.host!))
      );
    }
    
    if (options.method) {
      const method = options.method.toUpperCase();
      endpoints = endpoints.filter(ep => ep.method === method);
    }
    
    if (options.pathContains) {
      endpoints = endpoints.filter(ep => 
        ep.normalizedPath.includes(options.pathContains!)
      );
    }
    
    // Apply sorting
    if (options.sort) {
      switch (options.sort) {
        case 'score':
          endpoints.sort((a, b) => b.score - a.score);
          break;
        case 'count':
          endpoints.sort((a, b) => b.count - a.count);
          break;
        case 'avgSize':
          endpoints.sort((a, b) => b.avgSize - a.avgSize);
          break;
      }
    }
    
    // Apply limit
    if (options.limit) {
      const limit = parseInt(options.limit, 10);
      endpoints = endpoints.slice(0, limit);
    }
    
    // Export if requested
    if (options.export) {
      const outFile = options.out || `endpoints.${options.export}`;
      await exportEndpoints(endpoints, options.export, outFile);
      console.log(chalk.green('✓') + ` Exported ${endpoints.length} endpoints to ${chalk.cyan(outFile)}`);
      return;
    }
    
    // JSON output mode
    if (options.json) {
      outputJSON(endpoints);
      return;
    }
    
    // Terminal output
    if (endpoints.length === 0) {
      console.log(chalk.yellow('No endpoints match the filters'));
      return;
    }
    
    console.log(chalk.bold(`\nFound ${endpoints.length} endpoint(s)\n`));
    
    const displayList = endpoints.map(ep => ({
      method: ep.method,
      path: ep.normalizedPath,
      score: ep.score,
      count: ep.count,
    }));
    
    console.log(renderEndpointList(displayList));
    
    // Show export hint
    if (endpoints.length > 0) {
      console.log(chalk.gray('\n💡 Tip: Export with ') + chalk.cyan('--export csv --out results.csv'));
    }
    
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.error(chalk.red(`Error: summary.json not found in ${resolvedDir}`));
      process.exit(1);
    }
    throw error;
  }
}

async function exportEndpoints(endpoints: Endpoint[], format: 'csv' | 'jsonl' | 'md', outFile: string): Promise<void> {
  let content: string;
  
  switch (format) {
    case 'csv':
      content = 'Method,Path,Score,Count,AvgSize,MaxSize,BodyRate,JsonBodies,BodyAvailable,NoBody,Hosts,Statuses,Reasons\n';
      for (const ep of endpoints) {
        const hosts = ep.hosts.join(';');
        const statuses = Object.entries(ep.statusDistribution).map(([s, c]) => `${s}:${c}`).join(';');
        const reasons = ep.reasons.join('; ');
        const bodyRate = ep.bodyRate ?? '';
        const jsonBodies = ep.jsonParseSuccessCount ?? '';
        const bodyAvailable = ep.bodyAvailableCount ?? '';
        const noBody = ep.noBodyCount ?? '';
        content += `${ep.method},"${ep.normalizedPath}",${ep.score},${ep.count},${ep.avgSize},${ep.maxSize},${bodyRate},${jsonBodies},${bodyAvailable},${noBody},"${hosts}","${statuses}","${reasons}"\n`;
      }
      break;
      
    case 'jsonl':
      content = endpoints.map(ep => JSON.stringify(ep)).join('\n') + '\n';
      break;
      
    case 'md':
      content = '# Endpoints\n\n';
      content += '| Rank | Score | Method | Path | Count | Avg Size | Body Rate | Reasons |\n';
      content += '|------|-------|--------|------|-------|----------|-----------|----------|\n';
      endpoints.forEach((ep, idx) => {
        const reasons = ep.reasons.slice(0, 2).join(', ');
        const bodyRate = ep.bodyRate !== undefined ? formatScore(ep.bodyRate) : '';
        content += `| ${idx + 1} | ${formatScore(ep.score)} | ${ep.method} | ${ep.normalizedPath} | ${ep.count} | ${formatBytes(ep.avgSize)} | ${bodyRate} | ${reasons} |\n`;
      });
      break;
  }
  
  await writeFile(outFile, content, 'utf-8');
}
