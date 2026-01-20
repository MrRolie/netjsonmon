/**
 * Tests for endpoint scoring algorithm
 */

import { describe, it, expect } from 'vitest';
import { scoreEndpoint, sortByScore, getScoringWeights, type EndpointAggregate } from '../src/score.js';

describe('scoreEndpoint', () => {
  const createAggregate = (overrides: Partial<EndpointAggregate> = {}): EndpointAggregate => ({
    endpointKey: 'GET /api/test',
    count: 10,
    statusCounts: { 200: 10 },
    hosts: ['api.example.com'],
    payloadSizes: [1000, 2000, 3000],
    schemaHashes: ['abc123'],
    samplePaths: ['id', 'name'],
    firstSeen: '2026-01-20T00:00:00Z',
    lastSeen: '2026-01-20T00:10:00Z',
    hasArrayStructure: false,
    hasDataFlags: false,
    avgDepth: 1.5,
    ...overrides,
  });

  it('should assign higher score to high-frequency endpoints', () => {
    const lowFreq = scoreEndpoint(createAggregate({ count: 5 }), 100);
    const highFreq = scoreEndpoint(createAggregate({ count: 50 }), 100);
    
    expect(highFreq.score).toBeGreaterThan(lowFreq.score);
    // High frequency needs frequencyScore > 0.1, which is (count/total * 3 * 0.3) > 0.1
    // For 50/100: (0.5 * 3 * 0.3) = 0.45 > 0.1 ✓
    expect(highFreq.reasons.some(r => r.includes('high frequency'))).toBe(true);
  });

  it('should assign higher score to large payload endpoints', () => {
    const smallPayload = scoreEndpoint(createAggregate({ payloadSizes: [100, 200] }), 100);
    const largePayload = scoreEndpoint(createAggregate({ payloadSizes: [50000, 60000] }), 100);
    
    expect(largePayload.score).toBeGreaterThan(smallPayload.score);
    // Large payload needs avgSize > 1000 (1KB)
    expect(largePayload.reasons.some(r => r.includes('large average payload'))).toBe(true);
  });

  it('should boost score for array structures', () => {
    const noArray = scoreEndpoint(createAggregate({ hasArrayStructure: false }), 100);
    const withArray = scoreEndpoint(createAggregate({ hasArrayStructure: true }), 100);
    
    expect(withArray.score).toBeGreaterThan(noArray.score);
    expect(withArray.reasons).toContain('has array structure');
  });

  it('should boost score for data-likeness flags', () => {
    const noFlags = scoreEndpoint(createAggregate({ hasDataFlags: false }), 100);
    const withFlags = scoreEndpoint(createAggregate({ hasDataFlags: true }), 100);
    
    expect(withFlags.score).toBeGreaterThan(noFlags.score);
    expect(withFlags.reasons.some(r => r.includes('data-likeness flags'))).toBe(true);
  });

  it('should boost score for stable schemas', () => {
    const unstable = scoreEndpoint(createAggregate({ schemaHashes: ['a', 'b', 'c', 'd'] }), 100);
    const stable = scoreEndpoint(createAggregate({ schemaHashes: ['a'] }), 100);
    
    expect(stable.score).toBeGreaterThan(unstable.score);
    expect(stable.reasons).toContain('stable schema (1 variant)');
    expect(unstable.reasons.some(r => r.includes('unstable schema'))).toBe(true);
  });

  it('should compute avgPayloadSize correctly', () => {
    const scored = scoreEndpoint(createAggregate({ payloadSizes: [1000, 2000, 3000] }), 100);
    expect(scored.avgPayloadSize).toBe(2000);
  });

  it('should compute maxPayloadSize correctly', () => {
    const scored = scoreEndpoint(createAggregate({ payloadSizes: [1000, 5000, 3000] }), 100);
    expect(scored.maxPayloadSize).toBe(5000);
  });

  it('should compute distinctSchemas correctly', () => {
    const scored = scoreEndpoint(createAggregate({ schemaHashes: ['a', 'b', 'a', 'c', 'b'] }), 100);
    expect(scored.distinctSchemas).toBe(3);
  });

  it('should clamp score to [0, 1]', () => {
    // Test with extreme values
    const extreme = scoreEndpoint(
      createAggregate({
        count: 1000,
        payloadSizes: [1000000, 2000000],
        hasArrayStructure: true,
        hasDataFlags: true,
        schemaHashes: ['a'],
      }),
      100
    );
    
    expect(extreme.score).toBeGreaterThanOrEqual(0);
    expect(extreme.score).toBeLessThanOrEqual(1);
  });

  it('should return deterministic scores', () => {
    const agg = createAggregate();
    const score1 = scoreEndpoint(agg, 100);
    const score2 = scoreEndpoint(agg, 100);
    
    expect(score1.score).toBe(score2.score);
    expect(score1.reasons).toEqual(score2.reasons);
  });

  it('should handle empty payload sizes', () => {
    const scored = scoreEndpoint(createAggregate({ payloadSizes: [] }), 100);
    expect(scored.avgPayloadSize).toBe(0);
    expect(scored.maxPayloadSize).toBe(0);
  });

  it('should handle zero distinct schemas', () => {
    const scored = scoreEndpoint(createAggregate({ schemaHashes: [] }), 100);
    expect(scored.distinctSchemas).toBe(0);
  });

  it('should include depth heuristic in reasons when deep', () => {
    const deep = scoreEndpoint(createAggregate({ avgDepth: 3.5 }), 100);
    expect(deep.reasons.some(r => r.includes('deeply nested'))).toBe(true);
  });
});

describe('sortByScore', () => {
  it('should sort endpoints by score descending', () => {
    const endpoints = [
      { score: 0.5, count: 10 } as any,
      { score: 0.9, count: 10 } as any,
      { score: 0.3, count: 10 } as any,
    ];
    
    const sorted = sortByScore(endpoints);
    expect(sorted[0].score).toBe(0.9);
    expect(sorted[1].score).toBe(0.5);
    expect(sorted[2].score).toBe(0.3);
  });

  it('should use count as tie-breaker for equal scores', () => {
    const endpoints = [
      { score: 0.5, count: 5 } as any,
      { score: 0.5, count: 20 } as any,
      { score: 0.5, count: 10 } as any,
    ];
    
    const sorted = sortByScore(endpoints);
    expect(sorted[0].count).toBe(20);
    expect(sorted[1].count).toBe(10);
    expect(sorted[2].count).toBe(5);
  });
});

describe('getScoringWeights', () => {
  it('should return default weights', () => {
    const weights = getScoringWeights();
    expect(weights.frequency).toBe(0.3);
    expect(weights.payloadSize).toBe(0.3);
    expect(weights.structure).toBe(0.2);
    expect(weights.stability).toBe(0.2);
  });

  it('should sum to 1.0', () => {
    const weights = getScoringWeights();
    const sum = weights.frequency + weights.payloadSize + weights.structure + weights.stability;
    expect(sum).toBe(1.0);
  });
});
