import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { CaptureStore } from '../src/store.js';
import type { CaptureRecord } from '../src/types.js';

describe('CaptureStore', () => {
  const testDir = join(process.cwd(), 'test-captures');
  const runId = 'test-run-123';
  let store: CaptureStore;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    store = new CaptureStore(testDir, runId, 16384);
    await store.init();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('computeHash', () => {
    it('should compute consistent SHA256 hash', () => {
      const buffer = Buffer.from('test data');
      const hash1 = store.computeHash(buffer);
      const hash2 = store.computeHash(buffer);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA256 hex length
    });

    it('should produce different hashes for different data', () => {
      const buffer1 = Buffer.from('test data 1');
      const buffer2 = Buffer.from('test data 2');

      const hash1 = store.computeHash(buffer1);
      const hash2 = store.computeHash(buffer2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('storeCapture', () => {
    it('should inline small JSON bodies', async () => {
      const smallBody = Buffer.from(JSON.stringify({ id: 123, name: 'test' }));
      const record: Omit<CaptureRecord, 'bodyHash' | 'bodyPath' | 'inlineBody'> = {
        timestamp: new Date().toISOString(),
        url: 'https://api.example.com/data',
        status: 200,
        method: 'GET',
        requestHeaders: {},
        responseHeaders: { 'content-type': 'application/json' },
        contentType: 'application/json',
        payloadSize: smallBody.length,
        bodyAvailable: true,
        truncated: false,
        jsonParseSuccess: true,
      };

      await store.storeCapture(record, smallBody);

      // Read index.jsonl
      const indexPath = join(testDir, runId, 'index.jsonl');
      const indexContent = await readFile(indexPath, 'utf-8');
      const storedRecord = JSON.parse(indexContent.trim());

      expect(storedRecord.inlineBody).toBeDefined();
      expect(storedRecord.inlineBody.id).toBe(123);
      expect(storedRecord.bodyPath).toBeUndefined();
    });

    it('should externalize large JSON bodies', async () => {
      const largeData = { items: new Array(1000).fill({ id: 1, value: 'test' }) };
      const largeBody = Buffer.from(JSON.stringify(largeData));
      const record: Omit<CaptureRecord, 'bodyHash' | 'bodyPath' | 'inlineBody'> = {
        timestamp: new Date().toISOString(),
        url: 'https://api.example.com/data',
        status: 200,
        method: 'GET',
        requestHeaders: {},
        responseHeaders: { 'content-type': 'application/json' },
        contentType: 'application/json',
        payloadSize: largeBody.length,
        bodyAvailable: true,
        truncated: false,
        jsonParseSuccess: true,
      };

      await store.storeCapture(record, largeBody);

      // Read index.jsonl
      const indexPath = join(testDir, runId, 'index.jsonl');
      const indexContent = await readFile(indexPath, 'utf-8');
      const storedRecord = JSON.parse(indexContent.trim());

      expect(storedRecord.bodyPath).toBeDefined();
      expect(storedRecord.bodyPath).toMatch(/^bodies\/[a-f0-9]{64}\.json$/);
      expect(storedRecord.inlineBody).toBeUndefined();

      // Verify external file exists
      const bodyPath = join(testDir, runId, storedRecord.bodyPath);
      const bodyContent = await readFile(bodyPath, 'utf-8');
      const bodyData = JSON.parse(bodyContent);
      expect(bodyData.items).toHaveLength(1000);
    });

    it('should handle null body buffer', async () => {
      const record: Omit<CaptureRecord, 'bodyHash' | 'bodyPath' | 'inlineBody'> = {
        timestamp: new Date().toISOString(),
        url: 'https://api.example.com/data',
        status: 204,
        method: 'GET',
        requestHeaders: {},
        responseHeaders: {},
        contentType: '',
        payloadSize: 0,
        bodyAvailable: false,
        truncated: true,
        omittedReason: 'unavailable',
        jsonParseSuccess: false,
      };

      await store.storeCapture(record, null);

      // Read index.jsonl
      const indexPath = join(testDir, runId, 'index.jsonl');
      const indexContent = await readFile(indexPath, 'utf-8');
      const storedRecord = JSON.parse(indexContent.trim());

      expect(storedRecord.bodyHash).toBe('');
      expect(storedRecord.bodyPath).toBeUndefined();
      expect(storedRecord.inlineBody).toBeUndefined();
    });
  });
});
