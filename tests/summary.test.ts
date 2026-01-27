/**
 * Tests for endpoint aggregation and summary generation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateSummary } from '../src/summary.js';
import type { CaptureRecord, RunMetadata } from '../src/types.js';
import { randomBytes } from 'node:crypto';

let TEST_RUN_DIR: string;

describe('generateSummary', () => {
  beforeEach(() => {
    // Create unique test directory per test
    TEST_RUN_DIR = join(process.cwd(), 'test-captures', `summary-test-${randomBytes(4).toString('hex')}`);
    mkdirSync(TEST_RUN_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    if (existsSync(TEST_RUN_DIR)) {
      rmSync(TEST_RUN_DIR, { recursive: true, force: true });
    }
  });

  it('should generate summary.json with correct structure', async () => {
    // Setup test data
    const runMetadata: RunMetadata = {
      runId: 'test-run-123',
      startedAt: '2026-01-20T00:00:00Z',
      url: 'https://example.com',
      options: {} as any,
    };

    const captures: CaptureRecord[] = [
      createTestCapture('GET /api/users/:id', 200, 1000, true, true),
      createTestCapture('GET /api/users/:id', 200, 1200, true, true),
      createTestCapture('GET /api/posts', 200, 5000, true, false),
    ];

    writeFileSync(join(TEST_RUN_DIR, 'run.json'), JSON.stringify(runMetadata));
    writeFileSync(
      join(TEST_RUN_DIR, 'index.jsonl'),
      captures.map(c => JSON.stringify(c)).join('\n')
    );

    // Generate summary
    await generateSummary(TEST_RUN_DIR);

    // Verify summary.json exists and has correct structure
    const summaryPath = join(TEST_RUN_DIR, 'summary.json');
    expect(existsSync(summaryPath)).toBe(true);

    const summary = JSON.parse(readFileSync(summaryPath, 'utf-8'));
    expect(summary.runId).toBe('test-run-123');
    expect(summary.jsonCaptures).toBe(3);
    expect(summary.totalEndpoints).toBe(2);
    expect(summary.endpoints).toBeDefined();
    expect(summary.endpoints.length).toBeGreaterThan(0);
    expect(summary.scoringWeights).toBeDefined();
  });

  it('should generate endpoints.jsonl with one line per endpoint', async () => {
    const runMetadata: RunMetadata = {
      runId: 'test-run-456',
      startedAt: '2026-01-20T00:00:00Z',
      url: 'https://example.com',
      options: {} as any,
    };

    const captures: CaptureRecord[] = [
      createTestCapture('GET /api/users/:id', 200, 1000, true, true),
      createTestCapture('POST /api/users', 201, 500, false, false),
    ];

    writeFileSync(join(TEST_RUN_DIR, 'run.json'), JSON.stringify(runMetadata));
    writeFileSync(
      join(TEST_RUN_DIR, 'index.jsonl'),
      captures.map(c => JSON.stringify(c)).join('\n')
    );

    await generateSummary(TEST_RUN_DIR);

    const endpointsPath = join(TEST_RUN_DIR, 'endpoints.jsonl');
    expect(existsSync(endpointsPath)).toBe(true);

    const lines = readFileSync(endpointsPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);

    // Verify each line is valid JSON
    lines.forEach(line => {
      const endpoint = JSON.parse(line);
      expect(endpoint.endpointKey).toBeDefined();
      expect(endpoint.score).toBeDefined();
      expect(endpoint.count).toBeDefined();
      expect(endpoint.reasons).toBeDefined();
    });
  });

  it('should aggregate captures by endpointKey', async () => {
    const runMetadata: RunMetadata = {
      runId: 'test-run-789',
      startedAt: '2026-01-20T00:00:00Z',
      url: 'https://example.com',
      options: {} as any,
    };

    const captures: CaptureRecord[] = [
      createTestCapture('GET /api/users/:id', 200, 1000, true, true, 'hash1'),
      createTestCapture('GET /api/users/:id', 200, 1200, true, true, 'hash2'),
      createTestCapture('GET /api/users/:id', 404, 100, false, false, 'hash3'),
    ];

    writeFileSync(join(TEST_RUN_DIR, 'run.json'), JSON.stringify(runMetadata));
    writeFileSync(
      join(TEST_RUN_DIR, 'index.jsonl'),
      captures.map(c => JSON.stringify(c)).join('\n')
    );

    await generateSummary(TEST_RUN_DIR);

    const summary = JSON.parse(readFileSync(join(TEST_RUN_DIR, 'summary.json'), 'utf-8'));
    const endpoint = summary.endpoints.find((e: any) => e.endpointKey === 'GET /api/users/:id');

    expect(endpoint).toBeDefined();
    expect(endpoint.count).toBe(3);
    expect(endpoint.statusCounts).toEqual({ 200: 2, 404: 1 });
  });

  it('should handle empty index.jsonl gracefully', async () => {
    const runMetadata: RunMetadata = {
      runId: 'test-run-empty',
      startedAt: '2026-01-20T00:00:00Z',
      url: 'https://example.com',
      options: {} as any,
    };

    writeFileSync(join(TEST_RUN_DIR, 'run.json'), JSON.stringify(runMetadata));
    writeFileSync(join(TEST_RUN_DIR, 'index.jsonl'), '');

    // Should not throw
    await generateSummary(TEST_RUN_DIR);

    // Summary files should not be created for empty captures
    expect(existsSync(join(TEST_RUN_DIR, 'summary.json'))).toBe(false);
    expect(existsSync(join(TEST_RUN_DIR, 'endpoints.jsonl'))).toBe(false);
  });

  it('should track distinct schema hashes', async () => {
    const runMetadata: RunMetadata = {
      runId: 'test-schemas',
      startedAt: '2026-01-20T00:00:00Z',
      url: 'https://example.com',
      options: {} as any,
    };

    const captures: CaptureRecord[] = [
      createTestCapture('GET /api/data', 200, 1000, true, true, 'schemaA'),
      createTestCapture('GET /api/data', 200, 1000, true, true, 'schemaA'),
      createTestCapture('GET /api/data', 200, 1000, true, true, 'schemaB'),
    ];

    writeFileSync(join(TEST_RUN_DIR, 'run.json'), JSON.stringify(runMetadata));
    writeFileSync(
      join(TEST_RUN_DIR, 'index.jsonl'),
      captures.map(c => JSON.stringify(c)).join('\n')
    );

    await generateSummary(TEST_RUN_DIR);

    const summary = JSON.parse(readFileSync(join(TEST_RUN_DIR, 'summary.json'), 'utf-8'));
    const endpoint = summary.endpoints[0];

    expect(endpoint.distinctSchemas).toBe(2);
  });

  it('should include body evidence metrics in outputs', async () => {
    const runMetadata: RunMetadata = {
      runId: 'test-body-evidence',
      startedAt: '2026-01-20T00:00:00Z',
      url: 'https://example.com',
      options: {} as any,
    };

    const captures: CaptureRecord[] = [
      createTestCapture('GET /api/data', 200, 1000, false, true, 'schemaA', true, true),
      createTestCapture('GET /api/data', 200, 1000, false, true, 'schemaA', true, true),
      // Body available but not valid JSON (no feature extraction)
      createTestCapture('GET /api/data', 200, 1000, false, true, 'schemaA', true, false),
    ];

    writeFileSync(join(TEST_RUN_DIR, 'run.json'), JSON.stringify(runMetadata));
    writeFileSync(
      join(TEST_RUN_DIR, 'index.jsonl'),
      captures.map(c => JSON.stringify(c)).join('\n')
    );

    await generateSummary(TEST_RUN_DIR);

    const summary = JSON.parse(readFileSync(join(TEST_RUN_DIR, 'summary.json'), 'utf-8'));
    expect(summary.bodyEvidence).toBeDefined();

    const endpoint = summary.endpoints.find((e: any) => e.endpointKey === 'GET /api/data');
    expect(endpoint).toBeDefined();
    expect(endpoint.jsonParseSuccessCount).toBe(2);
    expect(endpoint.bodyAvailableCount).toBe(3);
    expect(endpoint.bodyRate).toBeCloseTo(2 / 3, 3);
    expect(endpoint.bodyEvidenceFactor).toBeGreaterThan(0);
  });

  it('should sort endpoints by score descending', async () => {
    const runMetadata: RunMetadata = {
      runId: 'test-sorting',
      startedAt: '2026-01-20T00:00:00Z',
      url: 'https://example.com',
      options: {} as any,
    };

    const captures: CaptureRecord[] = [
      // Low-value endpoint: small, infrequent
      createTestCapture('GET /api/ping', 200, 50, false, false),
      
      // High-value endpoint: large, frequent, array structure
      ...Array(20).fill(null).map(() => 
        createTestCapture('GET /api/products', 200, 10000, true, true)
      ),
      
      // Medium-value endpoint: moderate size, moderate frequency
      ...Array(5).fill(null).map(() =>
        createTestCapture('GET /api/user/profile', 200, 2000, false, true)
      ),
    ];

    writeFileSync(join(TEST_RUN_DIR, 'run.json'), JSON.stringify(runMetadata));
    writeFileSync(
      join(TEST_RUN_DIR, 'index.jsonl'),
      captures.map(c => JSON.stringify(c)).join('\n')
    );

    await generateSummary(TEST_RUN_DIR);

    const summary = JSON.parse(readFileSync(join(TEST_RUN_DIR, 'summary.json'), 'utf-8'));
    
    // GET /api/products should be ranked highest
    expect(summary.endpoints[0].endpointKey).toBe('GET /api/products');
    expect(summary.endpoints[0].score).toBeGreaterThan(summary.endpoints[1].score);
  });

  it('should handle missing run.json gracefully', async () => {
    // Don't create run.json
    writeFileSync(join(TEST_RUN_DIR, 'index.jsonl'), '');

    // Should not throw, but should log error
    await generateSummary(TEST_RUN_DIR);
    
    // No output files should be created
    expect(existsSync(join(TEST_RUN_DIR, 'summary.json'))).toBe(false);
  });

  it('should handle malformed JSONL lines gracefully', async () => {
    const runMetadata: RunMetadata = {
      runId: 'test-malformed',
      startedAt: '2026-01-20T00:00:00Z',
      url: 'https://example.com',
      options: {} as any,
    };

    const validCapture = createTestCapture('GET /api/valid', 200, 1000, true, true);

    writeFileSync(join(TEST_RUN_DIR, 'run.json'), JSON.stringify(runMetadata));
    writeFileSync(
      join(TEST_RUN_DIR, 'index.jsonl'),
      [
        JSON.stringify(validCapture),
        'invalid json line',
        JSON.stringify(validCapture),
      ].join('\n')
    );

    // Should not throw, should process valid lines
    await generateSummary(TEST_RUN_DIR);

    const summary = JSON.parse(readFileSync(join(TEST_RUN_DIR, 'summary.json'), 'utf-8'));
    expect(summary.jsonCaptures).toBe(2); // Only valid lines counted
  });
});

// Helper function to create test captures
function createTestCapture(
  endpointKey: string,
  status: number,
  payloadSize: number,
  hasArrayStructure: boolean,
  hasDataFlags: boolean,
  schemaHash?: string,
  bodyAvailable: boolean = true,
  jsonParseSuccess: boolean = true
): CaptureRecord {
  const parseSuccess = bodyAvailable ? jsonParseSuccess : false;
  const effectivePayloadSize = parseSuccess ? payloadSize : 0;
  const effectiveSchemaHash = schemaHash || 'default-schema';

  return {
    timestamp: new Date().toISOString(),
    url: `https://example.com${endpointKey.replace('GET ', '').replace('POST ', '')}`,
    status,
    method: endpointKey.split(' ')[0],
    requestHeaders: {},
    responseHeaders: {},
    contentType: 'application/json',
    payloadSize: effectivePayloadSize,
    bodyAvailable,
    truncated: false,
    bodyHash: parseSuccess ? (schemaHash || 'default-hash') : '',
    jsonParseSuccess: parseSuccess,
    endpointKey,
    features: parseSuccess
      ? {
          isArray: hasArrayStructure,
          isObject: !hasArrayStructure,
          isPrimitive: false,
          numKeys: 5,
          topLevelKeys: ['id', 'name', 'email'],
          depthEstimate: 2,
          hasId: hasDataFlags,
          hasItems: hasDataFlags,
          hasResults: hasDataFlags,
          hasData: hasDataFlags,
          samplePaths: ['id', 'name'],
          schemaHash: effectiveSchemaHash,
        }
      : undefined,
  } as CaptureRecord;
}
