/**
 * MCP (Model Context Protocol) server command
 *
 * Exposes netjsonmon capabilities to AI assistants (Claude Desktop, Cursor,
 * Windsurf, etc.) via the standard stdio-based MCP protocol.
 *
 * Start with:  netjsonmon mcp
 * Then add to claude_desktop_config.json / cursor settings:
 *   { "command": "npx", "args": ["netjsonmon", "mcp"] }
 *
 * Inspired by Scrapling's MCP server (scrapling/core/ai.py):
 *   - FastMCP + add_tool() → McpServer + registerTool()
 *   - structured_output=True → Zod-validated input schemas
 *   - server.run('stdio') → StdioServerTransport + server.connect()
 */

import { readFile, access } from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { join, resolve } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { monitor } from '../monitor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read and parse summary.json from a capture directory */
async function readSummary(captureDir: string): Promise<any> {
  const summaryPath = join(resolve(captureDir), 'summary.json');
  try {
    await access(summaryPath);
  } catch {
    throw new Error(
      `No summary.json found in "${captureDir}". ` +
      `Run netjsonmon on a URL first, or pass a valid captureDir.`
    );
  }
  const raw = await readFile(summaryPath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Stream index.jsonl and return the first capture matching `endpointKey`
 * that has an inline body or a body path.
 */
async function findSampleCapture(captureDir: string, endpointKey: string): Promise<any | null> {
  const indexPath = join(resolve(captureDir), 'index.jsonl');
  try {
    await access(indexPath);
  } catch {
    return null;
  }

  return new Promise((resolve, reject) => {
    const fileStream = createReadStream(indexPath, { encoding: 'utf-8' });
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity });
    let found: any | null = null;
    let done = false;

    rl.on('line', (line) => {
      if (done || !line.trim()) return;
      try {
        const record = JSON.parse(line);
        if (record.endpointKey === endpointKey && record.jsonParseSuccess) {
          found = record;
          done = true;
          rl.close();
          fileStream.destroy();
        }
      } catch {
        // ignore malformed lines
      }
    });

    rl.on('close', () => resolve(found));
    rl.on('error', reject);
    fileStream.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Tool handlers
// (The JSON output in each `text` field is what the AI agent receives)
// ---------------------------------------------------------------------------

/**
 * run_monitor — launch netjsonmon on a URL and return the capture directory.
 *
 * AI workflow: call this first, then pass `captureDir` to get_top_endpoints
 * or get_endpoint_schema.
 */
async function toolRunMonitor(args: {
  url: string;
  monitorMs?: number;
  flow?: string;
  stealth?: boolean;
  proxy?: string;
  storageState?: string;
  outDir?: string;
}): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const outDir = resolve(args.outDir ?? './captures');

  const result = await monitor({
    url: args.url,
    headless: true,
    monitorMs: args.monitorMs ?? 10_000,
    timeoutMs: Math.max((args.monitorMs ?? 10_000) + 30_000, 60_000),
    outDir,
    maxBodyBytes: 1_048_576,
    inlineBodyBytes: 16_384,
    maxCaptures: 0,
    maxConcurrentCaptures: 6,
    captureAllJson: false,
    flow: args.flow,
    saveHar: false,
    trace: false,
    stealth: args.stealth ?? false,
    proxy: args.proxy,
    watch: false,
    consentMode: 'auto',
    consentAction: 'reject',
    saveStorageState: false,
    storageState: args.storageState,
    disableSummary: false,
    // Fully suppress all stdout so we don't corrupt the JSON-RPC stream
    outputMode: { json: true, quiet: true, verbose: false, debug: false },
  } as any);

  if (!result?.captureDir) {
    throw new Error('Monitor completed but returned no captureDir');
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        captureDir: result.captureDir,
        message: 'Capture complete. Pass captureDir to get_top_endpoints or get_endpoint_schema.',
      }, null, 2),
    }],
  };
}

/**
 * get_top_endpoints — return the highest-scoring API endpoints from a capture.
 *
 * Returns endpointKey, score, hit count, average response size, sample JSON
 * key paths, and the reasons the endpoint was scored the way it was.
 */
async function toolGetTopEndpoints(args: {
  captureDir: string;
  topN?: number;
}): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const summary = await readSummary(args.captureDir);
  const topN = args.topN ?? 10;
  const endpoints = (summary.endpoints ?? []).slice(0, topN).map((ep: any) => ({
    endpointKey: ep.endpointKey,
    score: ep.score,
    count: ep.count,
    avgSize: ep.avgSize,
    hosts: ep.hosts,
    sampleKeyPaths: (ep.sampleKeyPaths ?? []).slice(0, 20),
    reasons: ep.reasons ?? [],
    firstSeen: ep.firstSeen,
    lastSeen: ep.lastSeen,
    usedML: ep.usedML ?? false,
    mlLabel: ep.mlLabel,
  }));

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        url: summary.url,
        captureDir: args.captureDir,
        totalEndpoints: summary.totalEndpoints ?? endpoints.length,
        jsonCaptures: summary.jsonCaptures,
        endpoints,
      }, null, 2),
    }],
  };
}

/**
 * get_endpoint_schema — return detailed schema information for a specific endpoint.
 *
 * Includes all discovered JSON key paths, schema variant count, status codes,
 * hosts, and a sample inline response body (if available) so an AI can write
 * code against the API immediately.
 */
async function toolGetEndpointSchema(args: {
  captureDir: string;
  endpointKey: string;
}): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const summary = await readSummary(args.captureDir);
  const endpoint = (summary.endpoints ?? []).find(
    (ep: any) => ep.endpointKey === args.endpointKey,
  );

  if (!endpoint) {
    const available = (summary.endpoints ?? []).map((ep: any) => ep.endpointKey);
    throw new Error(
      `Endpoint "${args.endpointKey}" not found in captureDir.\n` +
      `Available endpoints:\n${available.map((k: string) => `  • ${k}`).join('\n')}`,
    );
  }

  // Find a sample capture with a body for this endpoint
  const sample = await findSampleCapture(args.captureDir, args.endpointKey);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        endpointKey: endpoint.endpointKey,
        method: endpoint.method,
        normalizedPath: endpoint.normalizedPath,
        hosts: endpoint.hosts,
        score: endpoint.score,
        count: endpoint.count,
        avgSize: endpoint.avgSize,
        maxSize: endpoint.maxSize,
        schemaVariants: endpoint.distinctSchemas,
        statusDistribution: endpoint.statusDistribution,
        bodyRate: endpoint.bodyRate,
        sampleKeyPaths: endpoint.sampleKeyPaths ?? [],
        reasons: endpoint.reasons ?? [],
        firstSeen: endpoint.firstSeen,
        lastSeen: endpoint.lastSeen,
        // Sample response body — the most valuable thing for an AI writing client code
        sampleBody: sample?.inlineBody ?? null,
        sampleBodyNote: sample?.inlineBody
          ? 'Full inline response body from a real capture'
          : (sample ? 'Body was stored externally (too large for inline); only key paths available' : 'No sample body available'),
      }, null, 2),
    }],
  };
}

// ---------------------------------------------------------------------------
// Server assembly — mirrors Scrapling's serve() method pattern:
//   server = FastMCP(name='Scrapling')
//   server.add_tool(fn, title=..., description=..., structured_output=True)
//   server.run(transport='stdio')
// ---------------------------------------------------------------------------

export async function mcpCommand(): Promise<void> {
  const server = new McpServer({
    name: 'netjsonmon',
    version: '2.0.0',
  });

  // Tool 1 — run_monitor
  server.registerTool(
    'run_monitor',
    {
      title: 'Run Monitor',
      description: [
        'Launch a headless browser, navigate to a URL, and capture all JSON API',
        'responses fired during the page load and optional flow script.',
        'Returns a captureDir path to pass to get_top_endpoints or get_endpoint_schema.',
      ].join(' '),
      inputSchema: {
        url: z.string().url().describe('The URL to monitor for JSON API traffic'),
        monitorMs: z.number().int().min(1000).max(120_000).optional()
          .describe('Capture window duration in milliseconds (default: 10000)'),
        flow: z.string().optional()
          .describe('Absolute path to a custom flow module (.ts/.js) for login/navigation'),
        stealth: z.boolean().optional()
          .describe('Enable stealth mode (enhanced anti-bot fingerprint hardening)'),
        proxy: z.string().optional()
          .describe('Proxy URL e.g. http://user:pass@host:port or socks5://host:port'),
        storageState: z.string().optional()
          .describe('Path to a saved session file (from a previous --saveSession run)'),
        outDir: z.string().optional()
          .describe('Directory to store captures (default: ./captures)'),
      },
    },
    async (args) => toolRunMonitor(args),
  );

  // Tool 2 — get_top_endpoints
  server.registerTool(
    'get_top_endpoints',
    {
      title: 'Get Top Endpoints',
      description: [
        'Read the summary from a finished capture and return the highest-scoring',
        'API endpoints ranked by relevance score.',
        'Each endpoint includes its key paths (field names), hit count, average',
        'payload size, and the scoring reasons.',
      ].join(' '),
      inputSchema: {
        captureDir: z.string().describe('Path returned by run_monitor'),
        topN: z.number().int().min(1).max(50).optional()
          .describe('Number of top endpoints to return (default: 10)'),
      },
    },
    async (args) => toolGetTopEndpoints(args),
  );

  // Tool 3 — get_endpoint_schema
  server.registerTool(
    'get_endpoint_schema',
    {
      title: 'Get Endpoint Schema',
      description: [
        'Return detailed schema information for a specific API endpoint from a capture.',
        'Includes all discovered JSON key paths, schema variant count, status code',
        'distribution, and a sample response body (if available inline) so you can',
        'immediately write client code against the API.',
        'Use get_top_endpoints first to find valid endpointKey values.',
      ].join(' '),
      inputSchema: {
        captureDir: z.string().describe('Path returned by run_monitor'),
        endpointKey: z.string()
          .describe('Endpoint identifier in "METHOD /path" format e.g. "GET /api/v1/users/:id"'),
      },
    },
    async (args) => toolGetEndpointSchema(args),
  );

  // Connect transport — stdio is the universal default (works with Claude Desktop,
  // Cursor, Windsurf, and the MCP inspector without any network config).
  // Mirrors Scrapling's: server.run(transport='stdio')
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep the process alive until the transport closes
  await new Promise<void>((resolve) => {
    server.server.onclose = resolve;
  });
}
