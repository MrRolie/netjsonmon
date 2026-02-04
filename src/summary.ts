/**
 * Endpoint aggregation and summary generation
 *
 * Reads index.jsonl, aggregates by endpointKey, scores endpoints,
 * and generates summary.json, endpoints.jsonl, and terminal output.
 */

import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import chalk from 'chalk';
import type { CaptureRecord, RunMetadata } from './types.js';
import type { Features } from './features.js';
import {
  scoreEndpoint,
  sortByScore,
  getScoringWeights,
  getBodyEvidenceConfig,
  type EndpointAggregate,
  type ScoredEndpoint,
} from './score.js';
import { renderEndpointsTable, renderNextActions, outputJSON, divider, type EndpointSummary, type OutputMode } from './ui/render.js';
import { formatNumber } from './ui/format.js';
import { tryLoadMLPredictor } from './ml/predictor.js';

/**
 * Generate summary files from a completed capture run.
 * 
 * @param runDir - Path to the capture directory (e.g., captures/2026-01-20T04-26-47-734Z-fc446894)
 * @param outputMode - Output mode configuration
 */
export async function generateSummary(runDir: string, outputMode?: OutputMode): Promise<void> {
  const mode = outputMode || { json: false, quiet: false, verbose: false, debug: false };
  const indexPath = join(runDir, 'index.jsonl');
  const runPath = join(runDir, 'run.json');
  
  // Load run metadata
  let runMetadata: RunMetadata;
  try {
    runMetadata = JSON.parse(readFileSync(runPath, 'utf-8')) as RunMetadata;
  } catch (err) {
    if (!mode.json) {
      console.error(`Failed to read run metadata from ${runPath}:`, err);
    }
    return;
  }
  
  // Stream read index.jsonl and aggregate
  const aggregates = new Map<string, EndpointAggregate>();
  let totalCaptures = 0;
  let duplicatesSkipped = 0;
  let redactionsApplied = 0;
  let truncatedBodies = 0;
  
  try {
    const stats = await streamAggregateIndex(indexPath, aggregates);
    totalCaptures = Array.from(aggregates.values()).reduce((sum, agg) => sum + agg.count, 0);
    duplicatesSkipped = stats.duplicates;
    redactionsApplied = stats.redactions;
    truncatedBodies = stats.truncated;
  } catch (err) {
    if (!mode.json) {
      console.error(`Failed to aggregate captures from ${indexPath}:`, err);
    }
    return;
  }
  
  if (totalCaptures === 0) {
    if (!mode.json && !mode.quiet) {
      console.warn(chalk.yellow('No captures found in index.jsonl, skipping summary generation.'));
    }
    return;
  }
  
  // Score all endpoints with heuristic
  const scored = Array.from(aggregates.values()).map(agg =>
    scoreEndpoint(agg, totalCaptures)
  );

  // Try to load ML predictor and enhance scores
  let usedML = false;
  const mlModelPath = './models/data-classifier/latest';
  const mlPredictor = await tryLoadMLPredictor(mlModelPath);

  if (mlPredictor && mlPredictor.isLoaded()) {
    if (!mode.json && !mode.quiet) {
      console.log(chalk.cyan('ℹ') + ' Using ML classifier for endpoint scoring');
    }

    try {
      // Predict all endpoints
      const predictions = await mlPredictor.predictBatch(scored);

      // Enhance scored endpoints with ML predictions
      for (let i = 0; i < scored.length; i++) {
        const endpoint = scored[i];
        const prediction = predictions[i];

        // Store heuristic score
        (endpoint as any).heuristicScore = endpoint.score;

        // Replace score with ML probability
        endpoint.score = prediction.probability;

        // Add ML metadata
        (endpoint as any).mlScore = prediction.probability;
        (endpoint as any).mlLabel = prediction.label;
        (endpoint as any).mlConfidence = prediction.confidence;
        (endpoint as any).usedML = true;
      }

      usedML = true;
    } catch (err) {
      console.error(chalk.yellow('Warning: ML prediction failed, falling back to heuristic scoring:'), err);
    }
  }

  // Sort by score descending (now using ML score if available)
  const sortedEndpoints = sortByScore(scored);
  
  // Generate outputs
  writeSummaryJson(runDir, runMetadata, sortedEndpoints, totalCaptures, duplicatesSkipped, redactionsApplied, truncatedBodies, mode);
  writeEndpointsJsonl(runDir, sortedEndpoints, mode);
  printTerminalSummary(sortedEndpoints, totalCaptures, runDir, mode);
}

/**
 * Stream read index.jsonl and build aggregates by endpointKey.
 */
async function streamAggregateIndex(
  indexPath: string,
  aggregates: Map<string, EndpointAggregate>
): Promise<{ duplicates: number; redactions: number; truncated: number }> {
  const fileStream = createReadStream(indexPath, { encoding: 'utf-8' });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });
  
  let duplicates = 0;
  let redactions = 0;
  let truncated = 0;
  
  for await (const line of rl) {
    if (!line.trim()) continue;
    
    try {
      const record = JSON.parse(line) as CaptureRecord;
      
      // Track stats
      if (record.truncated) truncated++;
      // Note: We don't have a direct redaction count in the record, this would need to be tracked in monitor
      
      // Use endpointKey, fallback to url if missing
      const key = record.endpointKey || record.url;
      
      if (!aggregates.has(key)) {
        aggregates.set(key, createEmptyAggregate(key));
      }
      
      const agg = aggregates.get(key)!;
      updateAggregate(agg, record);
    } catch (err) {
      console.warn('Failed to parse line in index.jsonl:', err);
      continue;
    }
  }
  
  return { duplicates, redactions, truncated };
}

/**
 * Create an empty aggregate for a new endpoint.
 */
function createEmptyAggregate(endpointKey: string): EndpointAggregate {
  return {
    endpointKey,
    count: 0,
    statusCounts: {},
    hosts: [],
    payloadSizes: [],
    schemaHashes: [],
    samplePaths: [],
    firstSeen: '',
    lastSeen: '',
    bodyAvailableCount: 0,
    jsonParseSuccessCount: 0,
    noBodyCount: 0,
    hasArrayStructure: false,
    hasDataFlags: false,
    avgDepth: 0,
  };
}

/**
 * Update an aggregate with a new capture record.
 */
function updateAggregate(agg: EndpointAggregate, record: CaptureRecord): void {
  agg.count++;

  // Body evidence tracking
  if (record.bodyAvailable) {
    agg.bodyAvailableCount++;
  } else {
    agg.noBodyCount++;
  }
  if (record.jsonParseSuccess) {
    agg.jsonParseSuccessCount++;
  }
  
  // Status distribution
  agg.statusCounts[record.status] = (agg.statusCounts[record.status] || 0) + 1;
  
  // Extract host from URL
  try {
    const url = new URL(record.url);
    if (!agg.hosts.includes(url.hostname)) {
      agg.hosts.push(url.hostname);
    }
  } catch {
    // Invalid URL, skip host tracking
  }
  
  // Payload size
  if (record.payloadSize > 0) {
    agg.payloadSizes.push(record.payloadSize);
  }
  
  // Schema hash
  if (record.features?.schemaHash && !agg.schemaHashes.includes(record.features.schemaHash)) {
    agg.schemaHashes.push(record.features.schemaHash);
  }
  
  // Sample paths
  if (record.features?.samplePaths) {
    for (const path of record.features.samplePaths) {
      if (!agg.samplePaths.includes(path)) {
        agg.samplePaths.push(path);
      }
    }
  }
  
  // First/last seen
  if (!agg.firstSeen || record.timestamp < agg.firstSeen) {
    agg.firstSeen = record.timestamp;
  }
  if (!agg.lastSeen || record.timestamp > agg.lastSeen) {
    agg.lastSeen = record.timestamp;
  }
  
  // Feature aggregation
  if (record.features) {
    const f = record.features;
    
    // Array structure
    if (f.isArray) {
      agg.hasArrayStructure = true;
    }
    
    // Data-likeness flags
    if (f.hasId || f.hasItems || f.hasResults || f.hasData) {
      agg.hasDataFlags = true;
    }
    
    // Average depth (running average)
    if (f.depthEstimate > 0) {
      const totalDepth = agg.avgDepth * (agg.count - 1) + f.depthEstimate;
      agg.avgDepth = totalDepth / agg.count;
    }
  }
}

/**
 * Write summary.json with run metadata and top endpoints.
 */
function writeSummaryJson(
  runDir: string,
  runMetadata: RunMetadata,
  endpoints: ScoredEndpoint[],
  totalCaptures: number,
  duplicatesSkipped: number,
  redactionsApplied: number,
  truncatedBodies: number,
  mode: OutputMode
): void {
  const summaryPath = join(runDir, 'summary.json');
  
  // Parse method and path from endpointKey
  const enrichedEndpoints = endpoints.slice(0, 20).map(ep => {
    const parts = ep.endpointKey.split(' ');
    const method = parts.length > 1 ? parts[0] : 'GET';
    const normalizedPath = parts.length > 1 ? parts.slice(1).join(' ') : ep.endpointKey;

    const base = {
      endpointKey: ep.endpointKey,
      method,
      normalizedPath,
      score: parseFloat(ep.score.toFixed(3)),
      count: ep.count,
      avgSize: Math.round(ep.avgPayloadSize),
      maxSize: ep.maxPayloadSize,
      schemaHashes: ep.schemaHashes || [],
      statusCounts: ep.statusCounts,
      statusDistribution: ep.statusCounts,
      distinctSchemas: ep.distinctSchemas,
      hosts: ep.hosts,
      bodyAvailableCount: ep.bodyAvailableCount,
      jsonParseSuccessCount: ep.jsonParseSuccessCount,
      noBodyCount: ep.noBodyCount,
      bodyAvailableRate: parseFloat(ep.bodyAvailableRate.toFixed(3)),
      bodyRate: parseFloat(ep.bodyRate.toFixed(3)),
      bodyEvidenceFactor: parseFloat(ep.bodyEvidenceFactor.toFixed(3)),
      reasons: ep.reasons,
      sampleKeyPaths: ep.samplePaths,
      firstSeen: ep.firstSeen,
      lastSeen: ep.lastSeen,
    };

    // Add ML fields if present
    const epAny = ep as any;
    if (epAny.usedML) {
      return {
        ...base,
        heuristicScore: parseFloat(epAny.heuristicScore.toFixed(3)),
        mlScore: parseFloat(epAny.mlScore.toFixed(3)),
        mlLabel: epAny.mlLabel,
        mlConfidence: parseFloat(epAny.mlConfidence.toFixed(3)),
        usedML: true,
      };
    }

    return base;
  });
  
  const summary = {
    runId: runMetadata.runId,
    url: runMetadata.url,
    startedAt: runMetadata.startedAt,
    completedAt: new Date().toISOString(),
    captureDir: runDir,
    totalResponses: totalCaptures + duplicatesSkipped,
    jsonCaptures: totalCaptures,
    duplicatesSkipped,
    redactionsApplied,
    truncatedBodies,
    totalEndpoints: endpoints.length,
    scoringWeights: getScoringWeights(),
    bodyEvidence: getBodyEvidenceConfig(),
    endpoints: enrichedEndpoints,
  };
  
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  if (!mode.json && !mode.quiet) {
    console.log(chalk.green('✓') + ' Wrote summary to summary.json');
  }
}

/**
 * Write endpoints.jsonl with one line per endpoint.
 */
function writeEndpointsJsonl(runDir: string, endpoints: ScoredEndpoint[], mode: OutputMode): void {
  const endpointsPath = join(runDir, 'endpoints.jsonl');
  
  const lines = endpoints.map(ep => {
    const parts = ep.endpointKey.split(' ');
    const method = parts.length > 1 ? parts[0] : 'GET';
    const normalizedPath = parts.length > 1 ? parts.slice(1).join(' ') : ep.endpointKey;

    const base = {
      endpointKey: ep.endpointKey,
      method,
      normalizedPath,
      score: parseFloat(ep.score.toFixed(3)),
      count: ep.count,
      avgSize: Math.round(ep.avgPayloadSize),
      maxSize: ep.maxPayloadSize,
      distinctSchemas: ep.distinctSchemas,
      statusCounts: ep.statusCounts,
      statusDistribution: ep.statusCounts,
      hosts: ep.hosts,
      bodyAvailableCount: ep.bodyAvailableCount,
      jsonParseSuccessCount: ep.jsonParseSuccessCount,
      noBodyCount: ep.noBodyCount,
      bodyAvailableRate: parseFloat(ep.bodyAvailableRate.toFixed(3)),
      bodyRate: parseFloat(ep.bodyRate.toFixed(3)),
      bodyEvidenceFactor: parseFloat(ep.bodyEvidenceFactor.toFixed(3)),
      sampleKeyPaths: ep.samplePaths.slice(0, 50), // Limit sample paths
      reasons: ep.reasons,
      firstSeen: ep.firstSeen,
      lastSeen: ep.lastSeen,
      hasArrayStructure: ep.hasArrayStructure,
      hasDataFlags: ep.hasDataFlags,
      avgDepth: parseFloat(ep.avgDepth.toFixed(2)),
    };

    // Add ML fields if present
    const epAny = ep as any;
    if (epAny.usedML) {
      return JSON.stringify({
        ...base,
        heuristicScore: parseFloat(epAny.heuristicScore.toFixed(3)),
        mlScore: parseFloat(epAny.mlScore.toFixed(3)),
        mlLabel: epAny.mlLabel,
        mlConfidence: parseFloat(epAny.mlConfidence.toFixed(3)),
        usedML: true,
      });
    }

    return JSON.stringify(base);
  });
  
  writeFileSync(endpointsPath, lines.join('\n') + '\n', 'utf-8');
  if (!mode.json && !mode.quiet) {
    console.log(chalk.green('✓') + ` Wrote ${endpoints.length} endpoints to endpoints.jsonl`);
  }
}

/**
 * Print terminal summary with top 10 endpoints.
 */
function printTerminalSummary(
  endpoints: ScoredEndpoint[], 
  totalCaptures: number, 
  runDir: string,
  mode: OutputMode
): void {
  // Skip terminal output in json/quiet mode
  if (mode.json || mode.quiet) {
    return;
  }
  
  console.log('\n' + divider('=', 80));
  console.log(chalk.bold.cyan('ENDPOINT SUMMARY'));
  console.log(divider('=', 80));
  console.log(`Total captures: ${chalk.green(formatNumber(totalCaptures))}`);
  console.log(`Total endpoints: ${chalk.cyan(formatNumber(endpoints.length))}`);
  console.log();
  
  if (endpoints.length === 0) {
    console.log(chalk.yellow('No endpoints found'));
    console.log(divider('=', 80) + '\n');
    return;
  }
  
  console.log(chalk.bold(`Top ${Math.min(10, endpoints.length)} endpoints by score:\n`));
  
  const top10: EndpointSummary[] = endpoints.slice(0, 10).map((ep, idx) => {
    const parts = ep.endpointKey.split(' ');
    const method = parts.length > 1 ? parts[0] : 'GET';
    const normalizedPath = parts.length > 1 ? parts.slice(1).join(' ') : ep.endpointKey;
    
    return {
      rank: idx + 1,
      score: ep.score,
      method,
      normalizedPath,
      count: ep.count,
      avgSize: ep.avgPayloadSize,
      schemaVariants: ep.distinctSchemas,
      reasons: ep.reasons,
    };
  });
  
  console.log(renderEndpointsTable(top10, 10));
  console.log();
  
  // Show next actions
  console.log(renderNextActions(runDir));
  console.log(divider('=', 80) + '\n');
}
