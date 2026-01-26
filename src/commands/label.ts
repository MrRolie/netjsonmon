/**
 * Label command - manually label endpoints and export training data
 */

import { readFile, writeFile, appendFile, mkdir, readdir } from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import { basename, join, resolve } from 'path';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { generateSummary } from '../summary.js';
import { formatBytes, formatScore, truncateArray } from '../ui/format.js';
import { divider } from '../ui/render.js';
import type { RunMetadata } from '../types.js';

export interface LabelCommandOptions {
  minScore?: string;
  maxScore?: string;
  limit?: string;
  includeLabeled?: boolean;
  export?: boolean;
  out?: string;
}

interface EndpointRecord {
  endpointKey: string;
  method: string;
  normalizedPath: string;
  score: number;
  count: number;
  avgSize: number;
  maxSize: number;
  distinctSchemas: number;
  statusCounts: Record<number, number>;
  hosts: string[];
  reasons: string[];
  sampleKeyPaths: string[];
  firstSeen: string;
  lastSeen: string;
  hasArrayStructure?: boolean;
  hasDataFlags?: boolean;
  avgDepth?: number;
}

interface LabelRecord {
  endpointKey: string;
  label: 'data' | 'non-data' | 'unsure';
  labeledAt: string;
  source: 'manual';
  notes?: string;
}

interface EndpointSample {
  body: any;
  url?: string;
  status?: number;
  bodyPath?: string;
}

export async function labelCommand(captureDir: string, options: LabelCommandOptions): Promise<void> {
  const resolvedDir = resolve(captureDir);
  const runs = await discoverCaptureRuns(resolvedDir);

  if (runs.length === 0) {
    throw new Error(`No capture runs found in ${resolvedDir}`);
  }

  if (runs.length > 1) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (options.export) {
        const selected = await promptRunSelection(rl, runs, true);
        if (selected.length === 0) {
          console.log(chalk.yellow('No captures selected.'));
          return;
        }
        await exportTrainingFromRuns(selected, options, resolvedDir);
        return;
      }

      const selected = await promptRunSelection(rl, runs, false);
      if (selected.length === 0) {
        console.log(chalk.yellow('No capture selected.'));
        return;
      }
      await labelSingleRun(selected[0], options, captureDir);
      return;
    } finally {
      rl.close();
    }
  }

  const run = runs[0];
  if (options.export) {
    await exportTrainingFromRuns([run], options, run.labelsDir);
    return;
  }
  await labelSingleRun(run, options, captureDir);
}

interface CaptureRunInfo {
  name: string;
  path: string;
  endpointsPath: string;
  labelsDir: string;
  labelsPath: string;
  runMeta?: RunMetadata;
}

async function labelSingleRun(
  run: CaptureRunInfo,
  options: LabelCommandOptions,
  hintCaptureArg: string
): Promise<void> {
  await ensureEndpoints(run.path, run.endpointsPath);

  const endpoints = await loadEndpoints(run.endpointsPath);
  if (endpoints.length === 0) {
    console.log(chalk.yellow('No endpoints found to label.'));
    return;
  }

  const labelsMap = await loadLabels(run.labelsPath);

  let filtered = applyFilters(endpoints, options);
  if (!options.includeLabeled) {
    filtered = filtered.filter(ep => !labelsMap.has(ep.endpointKey));
  }

  if (filtered.length === 0) {
    console.log(chalk.yellow('No endpoints match the filters.'));
    if (!options.includeLabeled && labelsMap.size > 0) {
      console.log(chalk.gray('Use --includeLabeled to review or relabel existing entries.'));
    }
    return;
  }

  await mkdir(run.labelsDir, { recursive: true });

  console.log(chalk.bold.cyan('\nManual labeling\n'));
  console.log(divider());
  console.log(chalk.gray('Keys: ') + chalk.cyan('[d]ata') + ', ' + chalk.cyan('[n]on-data') + ', ' + chalk.cyan('[u]nsure') + ', ' + chalk.cyan('[s]kip') + ', ' + chalk.cyan('[q]uit'));
  console.log(divider());

  const samples = await loadEndpointSamples(run.path, filtered.map(ep => ep.endpointKey));

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  let labeledCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < filtered.length; i++) {
    const endpoint = filtered[i];
    const existing = labelsMap.get(endpoint.endpointKey);
    renderEndpointForLabel(endpoint, i + 1, filtered.length, existing, samples.get(endpoint.endpointKey));

    const answer = (await prompt(rl, 'Label> ')).trim().toLowerCase();
    if (answer === 'q') {
      break;
    }
    if (answer === 's' || answer === '') {
      skippedCount++;
      continue;
    }

    const label = resolveLabel(answer);
    if (!label) {
      console.log(chalk.yellow('Invalid input. Use d/n/u/s/q.'));
      i--;
      continue;
    }

    const record: LabelRecord = {
      endpointKey: endpoint.endpointKey,
      label,
      labeledAt: new Date().toISOString(),
      source: 'manual',
    };

    await appendFile(run.labelsPath, JSON.stringify(record) + '\n', 'utf-8');
    labelsMap.set(endpoint.endpointKey, record);
    labeledCount++;
  }

  rl.close();

  console.log(divider());
  console.log(chalk.green(`Labeled ${labeledCount} endpoint(s).`));
  if (skippedCount > 0) {
    console.log(chalk.gray(`Skipped ${skippedCount} endpoint(s).`));
  }
  console.log(chalk.gray('Export training data with: ') + chalk.cyan(`netjsonmon label ${hintCaptureArg} --export`));
}

async function discoverCaptureRuns(rootDir: string): Promise<CaptureRunInfo[]> {
  const endpointsPath = join(rootDir, 'endpoints.jsonl');
  const labelsDir = join(rootDir, 'labels');
  const labelsPath = join(labelsDir, 'labels.jsonl');
  if (existsSync(endpointsPath)) {
    return [{
      name: basename(rootDir),
      path: rootDir,
      endpointsPath,
      labelsDir,
      labelsPath,
      runMeta: await loadRunMetadata(join(rootDir, 'run.json')),
    }];
  }

  let entries: { name: string; isDirectory: boolean }[] = [];
  try {
    entries = (await readdir(rootDir, { withFileTypes: true }))
      .map(entry => ({ name: entry.name, isDirectory: entry.isDirectory() }));
  } catch {
    return [];
  }

  const runs: CaptureRunInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const runPath = join(rootDir, entry.name);
    const runEndpointsPath = join(runPath, 'endpoints.jsonl');
    const runIndexPath = join(runPath, 'index.jsonl');
    const runJsonPath = join(runPath, 'run.json');

    if (!existsSync(runEndpointsPath) && !existsSync(runIndexPath) && !existsSync(runJsonPath)) {
      continue;
    }

    runs.push({
      name: entry.name,
      path: runPath,
      endpointsPath: runEndpointsPath,
      labelsDir: join(runPath, 'labels'),
      labelsPath: join(runPath, 'labels', 'labels.jsonl'),
      runMeta: await loadRunMetadata(runJsonPath),
    });
  }

  runs.sort((a, b) => {
    const aTime = a.runMeta?.startedAt ?? '';
    const bTime = b.runMeta?.startedAt ?? '';
    return bTime.localeCompare(aTime);
  });

  return runs;
}

async function loadRunMetadata(runPath: string): Promise<RunMetadata | undefined> {
  if (!existsSync(runPath)) return undefined;
  try {
    const raw = await readFile(runPath, 'utf-8');
    return JSON.parse(raw) as RunMetadata;
  } catch {
    return undefined;
  }
}

async function promptRunSelection(
  rl: ReturnType<typeof createInterface>,
  runs: CaptureRunInfo[],
  allowMultiple: boolean
): Promise<CaptureRunInfo[]> {
  console.log(chalk.bold.cyan('\nAvailable captures\n'));
  runs.forEach((run, idx) => {
    console.log(formatRunLine(run, idx + 1));
  });
  console.log(divider());

  while (true) {
    const promptText = allowMultiple
      ? 'Select captures (e.g., 1,3 or all, q to quit): '
      : 'Select capture (e.g., 1, q to quit): ';
    const answer = (await prompt(rl, promptText)).trim().toLowerCase();
    if (answer === 'q') {
      return [];
    }

    if (allowMultiple && answer === 'all') {
      return runs;
    }

    const selected = parseSelection(answer, runs.length, allowMultiple);
    if (selected.length === 0) {
      console.log(chalk.yellow('Invalid selection. Try again.'));
      continue;
    }
    return selected.map(idx => runs[idx]);
  }
}

function parseSelection(input: string, max: number, allowMultiple: boolean): number[] {
  if (!input) return [];
  const parts = input.split(',').map(value => value.trim()).filter(Boolean);
  const indices: number[] = [];

  for (const part of parts) {
    const num = parseInt(part, 10);
    if (Number.isNaN(num)) {
      return [];
    }
    const index = num - 1;
    if (index < 0 || index >= max) {
      return [];
    }
    indices.push(index);
    if (!allowMultiple) break;
  }

  return Array.from(new Set(indices));
}

function formatRunLine(run: CaptureRunInfo, index: number): string {
  const url = run.runMeta?.url ? chalk.cyan(run.runMeta.url) : chalk.gray('unknown url');
  const started = run.runMeta?.startedAt ? new Date(run.runMeta.startedAt).toLocaleString() : 'unknown time';
  return `  [${index}] ${chalk.bold(run.name)}  ${url}  ${chalk.gray(started)}`;
}

async function ensureEndpoints(runDir: string, endpointsPath: string): Promise<void> {
  if (existsSync(endpointsPath)) {
    return;
  }
  await generateSummary(runDir, { json: false, quiet: true, verbose: false, debug: false });
  if (!existsSync(endpointsPath)) {
    throw new Error(`endpoints.jsonl not found in ${runDir}. Run a capture first.`);
  }
}

async function loadEndpoints(endpointsPath: string): Promise<EndpointRecord[]> {
  const content = await readFile(endpointsPath, 'utf-8');
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line) as EndpointRecord);
}

async function loadLabels(labelsPath: string): Promise<Map<string, LabelRecord>> {
  const labels = new Map<string, LabelRecord>();
  if (!existsSync(labelsPath)) {
    return labels;
  }
  const content = await readFile(labelsPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed) as LabelRecord;
      labels.set(record.endpointKey, record);
    } catch {
      continue;
    }
  }
  return labels;
}

function applyFilters(endpoints: EndpointRecord[], options: LabelCommandOptions): EndpointRecord[] {
  let filtered = endpoints.slice();

  if (options.minScore) {
    const minScore = parseFloat(options.minScore);
    filtered = filtered.filter(ep => ep.score >= minScore);
  }

  if (options.maxScore) {
    const maxScore = parseFloat(options.maxScore);
    filtered = filtered.filter(ep => ep.score <= maxScore);
  }

  if (options.limit) {
    const limit = parseInt(options.limit, 10);
    filtered = filtered.slice(0, limit);
  }

  return filtered;
}

function renderEndpointForLabel(
  endpoint: EndpointRecord,
  index: number,
  total: number,
  existing?: LabelRecord,
  sample?: EndpointSample
): void {
  console.log();
  console.log(chalk.bold(`${index}/${total} ${endpoint.method} ${endpoint.normalizedPath}`));
  console.log(`Score: ${chalk.green(formatScore(endpoint.score))}  Count: ${endpoint.count}  Avg Size: ${formatBytes(endpoint.avgSize)}  Max: ${formatBytes(endpoint.maxSize)}`);
  if (endpoint.reasons?.length) {
    console.log('Reasons: ' + chalk.gray(truncateArray(endpoint.reasons, 3, 60)));
  }
  if (endpoint.sampleKeyPaths?.length) {
    console.log('Sample keys: ' + chalk.gray(truncateArray(endpoint.sampleKeyPaths, 4, 50)));
  }
  console.log(chalk.bold('Body file'));
  if (sample?.bodyPath) {
    console.log(chalk.gray(sample.bodyPath));
  } else if (sample?.body !== undefined) {
    console.log(chalk.gray('(inline only)'));
  } else {
    console.log(chalk.gray('(none)'));
  }
  if (sample?.url) {
    console.log('URL: ' + chalk.gray(sample.url));
  } else {
    console.log('URL: ' + chalk.gray('(unknown)'));
  }
  if (existing) {
    console.log(chalk.yellow(`Existing label: ${existing.label}`));
  }
}

function resolveLabel(input: string): LabelRecord['label'] | null {
  if (input === 'd' || input === 'data') return 'data';
  if (input === 'n' || input === 'non' || input === 'non-data' || input === 'nodata') return 'non-data';
  if (input === 'u' || input === 'unsure' || input === 'unknown') return 'unsure';
  return null;
}

async function loadEndpointSamples(runDir: string, endpointKeys: string[]): Promise<Map<string, EndpointSample>> {
  const samples = new Map<string, EndpointSample>();
  if (endpointKeys.length === 0) return samples;

  const needed = new Set(endpointKeys);
  const indexPath = join(runDir, 'index.jsonl');

  if (!existsSync(indexPath)) {
    return samples;
  }

  const stream = createReadStream(indexPath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (needed.size === 0) break;
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const record = JSON.parse(trimmed) as {
        endpointKey?: string;
        inlineBody?: any;
        bodyPath?: string;
        url?: string;
        status?: number;
      };

      if (!record.endpointKey || !needed.has(record.endpointKey)) continue;

      const body = await loadSampleBody(runDir, record.inlineBody, record.bodyPath);
      if (body === undefined) continue;

      samples.set(record.endpointKey, {
        body,
        url: record.url,
        status: record.status,
        bodyPath: record.bodyPath ? join(runDir, record.bodyPath) : undefined,
      });
      needed.delete(record.endpointKey);
    } catch {
      continue;
    }
  }

  rl.close();
  return samples;
}

async function loadSampleBody(runDir: string, inlineBody?: any, bodyPath?: string): Promise<any | undefined> {
  if (inlineBody !== undefined) {
    return inlineBody;
  }
  if (!bodyPath) return undefined;

  const fullPath = join(runDir, bodyPath);
  if (!existsSync(fullPath)) return undefined;

  try {
    const content = await readFile(fullPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}


async function exportTrainingFromRuns(
  runs: CaptureRunInfo[],
  options: LabelCommandOptions,
  outputDir: string
): Promise<void> {
  const records: Array<ReturnType<typeof buildTrainingRecord>> = [];

  for (const run of runs) {
    await ensureEndpoints(run.path, run.endpointsPath);
    const endpoints = await loadEndpoints(run.endpointsPath);
    const labelsMap = await loadLabels(run.labelsPath);

    if (labelsMap.size === 0) {
      continue;
    }

    const filtered = applyFilters(endpoints, options);
    for (const endpoint of filtered) {
      const label = labelsMap.get(endpoint.endpointKey);
      if (!label) continue;
      records.push(buildTrainingRecord(endpoint, label, run));
    }
  }

  if (records.length === 0) {
    console.log(chalk.yellow('No labeled endpoints matched the current filters.'));
    return;
  }

  await mkdir(outputDir, { recursive: true });
  const targetPath = options.out ?? join(outputDir, 'training.jsonl');
  const content = records.map(record => JSON.stringify(record)).join('\n') + '\n';
  await writeFile(targetPath, content, 'utf-8');

  console.log(chalk.green('✓') + ` Wrote ${records.length} records to ${chalk.cyan(targetPath)}`);
}

function buildTrainingRecord(endpoint: EndpointRecord, label: LabelRecord, run?: CaptureRunInfo) {
  const meta: { source: string; captureDir?: string; runId?: string; url?: string; startedAt?: string } = {
    source: label.source,
  };
  if (run) {
    meta.captureDir = run.name;
    meta.runId = run.runMeta?.runId;
    meta.url = run.runMeta?.url;
    meta.startedAt = run.runMeta?.startedAt;
  }

  return {
    endpointKey: endpoint.endpointKey,
    label: label.label,
    labeledAt: label.labeledAt,
    features: {
      method: endpoint.method,
      normalizedPath: endpoint.normalizedPath,
      pathTokens: tokenizePath(endpoint.normalizedPath),
      score: endpoint.score,
      count: endpoint.count,
      avgSize: endpoint.avgSize,
      maxSize: endpoint.maxSize,
      distinctSchemas: endpoint.distinctSchemas,
      statusCounts: endpoint.statusCounts,
      hasArrayStructure: Boolean(endpoint.hasArrayStructure),
      hasDataFlags: Boolean(endpoint.hasDataFlags),
      avgDepth: endpoint.avgDepth ?? 0,
      hostCount: endpoint.hosts?.length ?? 0,
      sampleKeyPaths: endpoint.sampleKeyPaths?.slice(0, 50) ?? [],
      reasons: endpoint.reasons ?? [],
    },
    meta,
  };
}

function tokenizePath(pathname: string): string[] {
  return pathname
    .split('/')
    .map(part => part.trim())
    .filter(Boolean);
}

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(question, answer => resolve(answer));
  });
}
