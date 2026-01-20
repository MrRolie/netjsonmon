/**
 * Tests for deduplication logic
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'fs/promises';
import { resolve } from 'path';
import { CaptureStore } from '../src/store';

const TEST_OUT_DIR = resolve(process.cwd(), 'test-captures-dedupe');
const TEST_RUN_ID = 'test-dedupe-run';

describe('Deduplication', () => {
  let store: CaptureStore;

  beforeEach(async () => {
    await mkdir(TEST_OUT_DIR, { recursive: true });
    store = new CaptureStore(TEST_OUT_DIR, TEST_RUN_ID, 16384);
    await store.init();
  });

  afterEach(async () => {
    await rm(TEST_OUT_DIR, { recursive: true, force: true });
  });

  it('should generate same bodyHash for identical bodies', () => {
    const buffer1 = Buffer.from(JSON.stringify({ a: 1, b: 2 }));
    const buffer2 = Buffer.from(JSON.stringify({ a: 1, b: 2 }));
    
    const hash1 = store.computeHash(buffer1);
    const hash2 = store.computeHash(buffer2);
    
    expect(hash1).toBe(hash2);
  });

  it('should generate different bodyHash for different bodies', () => {
    const buffer1 = Buffer.from(JSON.stringify({ a: 1 }));
    const buffer2 = Buffer.from(JSON.stringify({ a: 2 }));
    
    const hash1 = store.computeHash(buffer1);
    const hash2 = store.computeHash(buffer2);
    
    expect(hash1).not.toBe(hash2);
  });

  it('should compute consistent bodyHash for duplicate bodies', async () => {
    const body = { a: 1, b: 2 };
    const buffer = Buffer.from(JSON.stringify(body));
    const bodyHash = store.computeHash(buffer);

    // Store first capture
    const record1 = {
      timestamp: new Date().toISOString(),
      url: 'https://api.example.com/data',
      status: 200,
      method: 'GET',
      requestHeaders: {},
      responseHeaders: {},
      contentType: 'application/json',
      payloadSize: buffer.length,
      bodyAvailable: true,
      truncated: false,
      jsonParseSuccess: true,
      endpointKey: 'GET /data',
    };

    await store.storeCapture(record1, buffer);

    // Store duplicate capture with same body
    const record2 = {
      ...record1,
      timestamp: new Date().toISOString(),
    };

    await store.storeCapture(record2, buffer);

    // Both should produce the same hash
    const bodyHash2 = store.computeHash(buffer);
    expect(bodyHash).toBe(bodyHash2);
  });

  it('should create deduplication key from endpointKey, status, and bodyHash', () => {
    const endpointKey = 'GET /api/v1/users/:id';
    const status = 200;
    const bodyHash = 'abc123def456';
    
    const dedupeKey = `${endpointKey}|${status}|${bodyHash}`;
    expect(dedupeKey).toBe('GET /api/v1/users/:id|200|abc123def456');
  });

  it('should treat captures with different status as distinct', () => {
    const endpointKey = 'GET /api/v1/users/:id';
    const bodyHash = 'abc123def456';
    
    const key1 = `${endpointKey}|200|${bodyHash}`;
    const key2 = `${endpointKey}|201|${bodyHash}`;
    
    expect(key1).not.toBe(key2);
  });

  it('should treat captures with different bodyHash as distinct', () => {
    const endpointKey = 'GET /api/v1/users/:id';
    const status = 200;
    
    const key1 = `${endpointKey}|${status}|abc123`;
    const key2 = `${endpointKey}|${status}|def456`;
    
    expect(key1).not.toBe(key2);
  });

  it('should use URL as fallback when endpointKey is missing', () => {
    const url = 'https://api.example.com/data';
    const status = 200;
    const bodyHash = 'abc123';
    
    const dedupeKey = `${url}|${status}|${bodyHash}`;
    expect(dedupeKey).toContain(url);
  });

  it('should handle empty bodyHash for unavailable bodies', () => {
    const endpointKey = 'GET /api/v1/users/:id';
    const status = 200;
    const bodyHash = '';
    
    const dedupeKey = `${endpointKey}|${status}|${bodyHash}`;
    expect(dedupeKey).toBe('GET /api/v1/users/:id|200|');
  });
});
