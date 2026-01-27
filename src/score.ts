/**
 * Endpoint scoring algorithm
 * 
 * Deterministic weighted formula that assigns 0-1 scores to endpoints
 * based on frequency, payload size, structure, and schema stability.
 */

import type { Features } from './features.js';

export interface EndpointAggregate {
  endpointKey: string;
  count: number;
  statusCounts: Record<number, number>;
  hosts: string[];
  payloadSizes: number[];
  schemaHashes: string[];
  samplePaths: string[];
  firstSeen: string;
  lastSeen: string;
  bodyAvailableCount: number;
  jsonParseSuccessCount: number;
  noBodyCount: number;
  
  // Aggregated feature data
  hasArrayStructure: boolean;
  hasDataFlags: boolean;
  avgDepth: number;
}

export interface ScoredEndpoint extends EndpointAggregate {
  score: number;
  reasons: string[];
  avgPayloadSize: number;
  maxPayloadSize: number;
  distinctSchemas: number;
  bodyAvailableRate: number;
  bodyRate: number;
  bodyEvidenceFactor: number;
}

interface ScoringWeights {
  frequency: number;      // 0.3
  payloadSize: number;    // 0.3
  structure: number;      // 0.2
  stability: number;      // 0.2
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  frequency: 0.3,
  payloadSize: 0.3,
  structure: 0.2,
  stability: 0.2,
};

export interface BodyEvidenceConfig {
  /**
   * Multiplier applied to bodyRate before clamping.
   * Values > 1.0 make moderate body rates reach full strength sooner.
   */
  scale: number;
  /**
   * Minimum factor applied when no JSON bodies are observed.
   * Keeps endpoints visible but heavily penalized.
   */
  minFactor: number;
}

const BODY_EVIDENCE_CONFIG: BodyEvidenceConfig = {
  scale: 1.5,
  minFactor: 0.05,
};

/**
 * Score an endpoint using a deterministic weighted formula.
 * 
 * @param aggregate - Aggregated endpoint data
 * @param totalCaptures - Total number of captures across all endpoints
 * @param weights - Optional custom weights (defaults to 0.3/0.3/0.2/0.2)
 * @returns Scored endpoint with score (0-1) and human-readable reasons
 */
export function scoreEndpoint(
  aggregate: EndpointAggregate,
  totalCaptures: number,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): ScoredEndpoint {
  const reasons: string[] = [];
  let score = 0;
  
  // Calculate derived metrics
  const avgPayloadSize = aggregate.payloadSizes.length > 0
    ? aggregate.payloadSizes.reduce((a, b) => a + b, 0) / aggregate.payloadSizes.length
    : 0;
  
  const maxPayloadSize = aggregate.payloadSizes.length > 0
    ? Math.max(...aggregate.payloadSizes)
    : 0;
  
  const distinctSchemas = new Set(aggregate.schemaHashes).size;
  const bodyAvailableRate = aggregate.count > 0
    ? aggregate.bodyAvailableCount / aggregate.count
    : 0;
  const bodyRate = aggregate.count > 0
    ? aggregate.jsonParseSuccessCount / aggregate.count
    : 0;
  
  // 1. Frequency score (0-0.3): normalized by total captures
  // Higher frequency = more likely to be an important endpoint
  const frequencyRatio = aggregate.count / totalCaptures;
  const frequencyScore = Math.min(frequencyRatio * 3, 1.0) * weights.frequency;
  score += frequencyScore;
  
  if (frequencyScore > 0.1) {
    const percentage = (frequencyRatio * 100).toFixed(1);
    reasons.push(`high frequency (${aggregate.count}/${totalCaptures} captures, ${percentage}%)`);
  } else if (aggregate.count > 1) {
    reasons.push(`low frequency (${aggregate.count} captures)`);
  }
  
  // 2. Payload size score (0-0.3): larger payloads suggest data endpoints
  // Scale: 1KB = 0.1, 10KB = 1.0 (maxed out)
  const sizeScore = Math.min(avgPayloadSize / 10000, 1.0) * weights.payloadSize;
  score += sizeScore;
  
  if (avgPayloadSize > 1000) {
    const sizeKB = (avgPayloadSize / 1024).toFixed(1);
    reasons.push(`large average payload (${sizeKB}KB)`);
  } else if (avgPayloadSize > 0) {
    const sizeBytes = Math.round(avgPayloadSize);
    reasons.push(`small average payload (${sizeBytes} bytes)`);
  }
  
  // 3. Structure score (0-0.2): arrays and data-likeness flags
  let structureScore = 0;
  
  if (aggregate.hasArrayStructure) {
    structureScore += 0.5; // Arrays are strong indicators of list/data endpoints
    reasons.push('has array structure');
  }
  
  if (aggregate.hasDataFlags) {
    structureScore += 0.5; // hasId, hasItems, hasResults, hasData flags
    reasons.push('has data-likeness flags (id/items/results/data)');
  }
  
  structureScore = Math.min(structureScore, 1.0) * weights.structure;
  score += structureScore;
  
  // 4. Schema stability score (0-0.2): fewer schemas = more consistent
  // 1 schema = 1.0, 2 schemas = 0.8, 3 schemas = 0.6, 4+ schemas = 0.4 or less
  const stabilityRatio = distinctSchemas === 0 
    ? 0 
    : Math.max(1.0 - (distinctSchemas - 1) * 0.2, 0.2);
  const stabilityScore = stabilityRatio * weights.stability;
  score += stabilityScore;
  
  if (distinctSchemas === 1) {
    reasons.push('stable schema (1 variant)');
  } else if (distinctSchemas > 1 && distinctSchemas <= 3) {
    reasons.push(`mostly stable schema (${distinctSchemas} variants)`);
  } else if (distinctSchemas > 3) {
    reasons.push(`unstable schema (${distinctSchemas} variants)`);
  }
  
  // Depth heuristic (not scored, but informative)
  if (aggregate.avgDepth > 2) {
    reasons.push(`deeply nested structure (avg depth: ${aggregate.avgDepth.toFixed(1)})`);
  }

  // 5. Body evidence gating (factor applied to total score)
  // Strong JSON body evidence is a prerequisite for data endpoints.
  const bodyEvidenceFactor = computeBodyEvidenceFactor(bodyRate);
  score *= bodyEvidenceFactor;

  const bodyPct = (bodyRate * 100).toFixed(0);
  if (bodyRate >= 0.75) {
    reasons.push(`strong JSON body evidence (${aggregate.jsonParseSuccessCount}/${aggregate.count}, ${bodyPct}%)`);
  } else if (bodyRate > 0) {
    reasons.push(`partial JSON body evidence (${aggregate.jsonParseSuccessCount}/${aggregate.count}, ${bodyPct}%)`);
  } else {
    reasons.push(`no JSON bodies observed (${aggregate.jsonParseSuccessCount}/${aggregate.count}); score down-weighted`);
  }
  
  // Ensure score is clamped to [0, 1]
  score = Math.max(0, Math.min(1, score));
  
  return {
    ...aggregate,
    score,
    reasons,
    avgPayloadSize,
    maxPayloadSize,
    distinctSchemas,
    bodyAvailableRate,
    bodyRate,
    bodyEvidenceFactor,
  };
}

/**
 * Sort scored endpoints by score (descending), then by count (descending).
 */
export function sortByScore(endpoints: ScoredEndpoint[]): ScoredEndpoint[] {
  return endpoints.sort((a, b) => {
    if (Math.abs(a.score - b.score) < 0.001) {
      return b.count - a.count; // Tie-breaker: higher count wins
    }
    return b.score - a.score; // Higher score first
  });
}

/**
 * Get scoring weights for reproducibility logging.
 */
export function getScoringWeights(): ScoringWeights {
  return { ...DEFAULT_WEIGHTS };
}

/**
 * Get body evidence configuration for reproducibility logging.
 */
export function getBodyEvidenceConfig(): BodyEvidenceConfig {
  return { ...BODY_EVIDENCE_CONFIG };
}

function computeBodyEvidenceFactor(bodyRate: number): number {
  const scaled = bodyRate * BODY_EVIDENCE_CONFIG.scale;
  const clamped = Math.min(1, Math.max(0, scaled));
  return Math.max(BODY_EVIDENCE_CONFIG.minFactor, clamped);
}
