/**
 * Feature extraction for JSON payloads
 * 
 * Extracts bounded, shallow features from JSON bodies to enable:
 * - Endpoint intelligence and scoring
 * - Schema stability tracking
 * - ML training data generation
 */

import { createHash } from 'crypto';

export interface Features {
  // Type and structure
  isArray: boolean;
  isObject: boolean;
  isPrimitive: boolean;
  
  // Size metrics
  arrayLength?: number;      // Length if array
  numKeys?: number;          // Number of keys if object
  topLevelKeys?: string[];   // First 20 keys (sorted)
  
  // Depth and complexity
  depthEstimate: number;     // Max nesting depth (capped at maxDepth)
  
  // Data-likeness flags
  hasId: boolean;            // Has 'id', '_id', or 'uuid' key
  hasItems: boolean;         // Has 'items', 'results', 'data', or 'list' key
  hasResults: boolean;       // Has 'results' key specifically
  hasData: boolean;          // Has 'data' key specifically
  
  // Sample paths (for schema analysis)
  samplePaths: string[];     // Example: ['user.name', 'user.email', 'items[0].id']
  
  // Schema stability
  schemaHash: string;        // Hash of top-level keys (sorted) for tracking schema changes
}

/**
 * TF-IDF features for ML training
 * Computed at the aggregate level from all samples
 */
export interface TfIdfFeatures {
  pathTokenTfidf: Record<string, number>;     // Token -> TF-IDF score (e.g., "users" -> 0.75)
  keyPathTfidf: Record<string, number>;       // KeyPath -> TF-IDF score (e.g., "user.email" -> 0.82)
}

const MAX_DEPTH_DEFAULT = 3;
const MAX_KEYS_DEFAULT = 50;
const MAX_SAMPLE_PATHS_DEFAULT = 100;
const MAX_TOP_LEVEL_KEYS = 20;
const COMPUTATION_TIMEOUT_MS = 100;

/**
 * Extract bounded features from a JSON body
 * 
 * @param body - Parsed JSON body (any type)
 * @param maxDepth - Maximum depth to traverse (default: 3)
 * @param maxKeys - Maximum keys to sample per object (default: 50)
 * @returns Features object
 */
export function extractFeatures(
  body: any,
  maxDepth: number = MAX_DEPTH_DEFAULT,
  maxKeys: number = MAX_KEYS_DEFAULT
): Features {
  const startTime = Date.now();
  
  // Initialize features
  const features: Features = {
    isArray: false,
    isObject: false,
    isPrimitive: false,
    depthEstimate: 0,
    hasId: false,
    hasItems: false,
    hasResults: false,
    hasData: false,
    samplePaths: [],
    schemaHash: '',
  };

  // Timeout protection
  const isTimedOut = () => Date.now() - startTime > COMPUTATION_TIMEOUT_MS;

  // Handle null/undefined
  if (body === null || body === undefined) {
    features.isPrimitive = true;
    return features;
  }

  // Detect top-level type
  if (Array.isArray(body)) {
    features.isArray = true;
    features.arrayLength = body.length;
    
    // Sample first item for nested analysis
    if (body.length > 0 && !isTimedOut()) {
      const firstItem = body[0];
      if (typeof firstItem === 'object' && firstItem !== null) {
        features.depthEstimate = 1 + estimateDepth(firstItem, maxDepth - 1, new Set(), isTimedOut);
        features.samplePaths = extractPaths(body, maxDepth, MAX_SAMPLE_PATHS_DEFAULT, isTimedOut);
      }
    }
  } else if (typeof body === 'object') {
    features.isObject = true;
    
    const keys = Object.keys(body);
    features.numKeys = keys.length;
    
    // Top-level keys (sorted, limited)
    const sortedKeys = keys.slice().sort();
    features.topLevelKeys = sortedKeys.slice(0, MAX_TOP_LEVEL_KEYS);
    
    // Schema hash (hash of sorted keys)
    features.schemaHash = createHash('sha256')
      .update(sortedKeys.join('|'))
      .digest('hex');
    
    // Data-likeness flags
    const keySet = new Set(keys.map(k => k.toLowerCase()));
    features.hasId = keySet.has('id') || keySet.has('_id') || keySet.has('uuid');
    features.hasItems = keySet.has('items') || keySet.has('results') || keySet.has('data') || keySet.has('list');
    features.hasResults = keySet.has('results');
    features.hasData = keySet.has('data');
    
    // Depth and paths
    if (!isTimedOut()) {
      features.depthEstimate = estimateDepth(body, maxDepth, new Set(), isTimedOut);
      features.samplePaths = extractPaths(body, maxDepth, MAX_SAMPLE_PATHS_DEFAULT, isTimedOut);
    }
  } else {
    features.isPrimitive = true;
  }

  return features;
}

/**
 * Estimate maximum depth of nested structure
 */
function estimateDepth(
  obj: any,
  maxDepth: number,
  visited: Set<any>,
  isTimedOut: () => boolean
): number {
  if (maxDepth <= 0 || isTimedOut()) {
    return 0;
  }

  if (obj === null || typeof obj !== 'object') {
    return 0;
  }

  // Circular reference protection
  if (visited.has(obj)) {
    return 0;
  }
  visited.add(obj);

  let maxChildDepth = 0;

  if (Array.isArray(obj)) {
    // Sample first few items
    const sampleSize = Math.min(obj.length, 5);
    for (let i = 0; i < sampleSize && !isTimedOut(); i++) {
      const childDepth = estimateDepth(obj[i], maxDepth - 1, visited, isTimedOut);
      maxChildDepth = Math.max(maxChildDepth, childDepth);
    }
  } else {
    // Sample first few keys
    const keys = Object.keys(obj);
    const sampleSize = Math.min(keys.length, 10);
    for (let i = 0; i < sampleSize && !isTimedOut(); i++) {
      const childDepth = estimateDepth(obj[keys[i]], maxDepth - 1, visited, isTimedOut);
      maxChildDepth = Math.max(maxChildDepth, childDepth);
    }
  }

  visited.delete(obj);
  return 1 + maxChildDepth;
}

/**
 * Extract sample paths from nested structure
 */
function extractPaths(
  obj: any,
  maxDepth: number,
  maxPaths: number,
  isTimedOut: () => boolean,
  currentPath: string = '',
  visited: Set<any> = new Set()
): string[] {
  const paths: string[] = [];

  if (maxDepth <= 0 || paths.length >= maxPaths || isTimedOut()) {
    return paths;
  }

  if (obj === null || typeof obj !== 'object') {
    return paths;
  }

  // Circular reference protection
  if (visited.has(obj)) {
    return paths;
  }
  visited.add(obj);

  if (Array.isArray(obj)) {
    // Sample first item in array
    if (obj.length > 0) {
      const arrayPath = currentPath ? `${currentPath}[0]` : '[0]';
      const childPaths = extractPaths(obj[0], maxDepth - 1, maxPaths - paths.length, isTimedOut, arrayPath, visited);
      paths.push(...childPaths);
    }
  } else {
    const keys = Object.keys(obj);
    const sampleSize = Math.min(keys.length, 10);
    
    for (let i = 0; i < sampleSize && paths.length < maxPaths && !isTimedOut(); i++) {
      const key = keys[i];
      const newPath = currentPath ? `${currentPath}.${key}` : key;
      
      // Add leaf paths
      const value = obj[key];
      if (value === null || typeof value !== 'object') {
        paths.push(newPath);
      } else {
        // Recurse into objects/arrays
        const childPaths = extractPaths(value, maxDepth - 1, maxPaths - paths.length, isTimedOut, newPath, visited);
        if (childPaths.length === 0) {
          // No children found, add this as leaf
          paths.push(newPath);
        } else {
          paths.push(...childPaths);
        }
      }
    }
  }

  visited.delete(obj);
  return paths;
}
/**
 * Compute TF-IDF features for a collection of endpoints
 * Used during aggregate feature computation for ML training
 * 
 * @param endpoints - Array of endpoint aggregates with sampleKeyPaths and pathTokens
 * @returns TF-IDF feature vectors
 */
export function computeTfIdfFeatures(
  endpoints: Array<{
    sampleKeyPaths?: string[];
    pathTokens?: string[];
  }>
): TfIdfFeatures {
  const pathTokenTfidf: Record<string, number> = {};
  const keyPathTfidf: Record<string, number> = {};

  if (endpoints.length === 0) {
    return { pathTokenTfidf, keyPathTfidf };
  }

  // ============ Path Tokens TF-IDF ============
  // Collect all path tokens (split by '/')
  const allTokens: string[] = [];
  const docFreqTokens = new Map<string, number>();

  for (const endpoint of endpoints) {
    const tokens = endpoint.pathTokens ?? [];
    const uniqueTokens = new Set(tokens);
    
    for (const token of tokens) {
      allTokens.push(token.toLowerCase());
    }
    
    uniqueTokens.forEach((token) => {
      const lowerToken = token.toLowerCase();
      docFreqTokens.set(lowerToken, (docFreqTokens.get(lowerToken) ?? 0) + 1);
    });
  }

  // Compute TF-IDF for tokens
  const tokenTf = new Map<string, number>();
  for (const token of allTokens) {
    tokenTf.set(token, (tokenTf.get(token) ?? 0) + 1);
  }

  const totalTokens = allTokens.length;
  const docsWithTokens = endpoints.length;

  tokenTf.forEach((tf, token) => {
    const termFreq = tf / (totalTokens || 1);
    const docFreq = docFreqTokens.get(token) ?? 1;
    const inverseDocFreq = Math.log(docsWithTokens / (docFreq || 1));
    pathTokenTfidf[token] = Number((termFreq * inverseDocFreq).toFixed(4));
  });

  // ============ Key Path TF-IDF ============
  // Collect all key paths (e.g., "user.email")
  const allKeyPaths: string[] = [];
  const docFreqKeyPaths = new Map<string, number>();

  for (const endpoint of endpoints) {
    const paths = endpoint.sampleKeyPaths ?? [];
    const uniquePaths = new Set(paths);
    
    for (const path of paths) {
      allKeyPaths.push(path);
    }
    
    uniquePaths.forEach((path) => {
      docFreqKeyPaths.set(path, (docFreqKeyPaths.get(path) ?? 0) + 1);
    });
  }

  // Compute TF-IDF for key paths
  const keyPathTf = new Map<string, number>();
  for (const path of allKeyPaths) {
    keyPathTf.set(path, (keyPathTf.get(path) ?? 0) + 1);
  }

  const totalKeyPaths = allKeyPaths.length;

  keyPathTf.forEach((tf, path) => {
    const termFreq = tf / (totalKeyPaths || 1);
    const docFreq = docFreqKeyPaths.get(path) ?? 1;
    const inverseDocFreq = Math.log(docsWithTokens / (docFreq || 1));
    keyPathTfidf[path] = Number((termFreq * inverseDocFreq).toFixed(4));
  });

  return { pathTokenTfidf, keyPathTfidf };
}

/**
 * Flatten TF-IDF feature vectors into a vector of values
 * for use in machine learning pipelines
 * 
 * @param tfidf - TF-IDF features
 * @param topN - Number of top features to keep per type (default: 50)
 * @returns { tokens: number[], paths: number[], tokenNames: string[], pathNames: string[] }
 */
export function flattenTfIdfFeatures(
  tfidf: TfIdfFeatures,
  topN: number = 50
): {
  tokenVector: number[];
  pathVector: number[];
  tokenNames: string[];
  pathNames: string[];
} {
  // Sort and take top N tokens by TF-IDF score
  const topTokens = Object.entries(tfidf.pathTokenTfidf)
    .sort(([, a], [, b]) => b - a)
    .slice(0, topN);

  const topPaths = Object.entries(tfidf.keyPathTfidf)
    .sort(([, a], [, b]) => b - a)
    .slice(0, topN);

  const tokenNames = topTokens.map(([name]) => name);
  const pathNames = topPaths.map(([name]) => name);

  const tokenVector = topTokens.map(([, value]) => value);
  const pathVector = topPaths.map(([, value]) => value);

  return {
    tokenVector,
    pathVector,
    tokenNames,
    pathNames,
  };
}