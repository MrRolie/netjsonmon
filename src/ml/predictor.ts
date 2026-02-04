/**
 * ML Predictor for endpoint classification using ONNX Runtime
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import type {
  MLPrediction,
  FeatureImportance,
  FeatureSchema,
  ScalerParams,
  ModelMetadata,
  EndpointFeatures,
} from './types.js';
import type { EndpointAggregate, ScoredEndpoint } from '../score.js';

/**
 * ML Predictor class for loading and running ONNX models
 */
interface EncoderParams {
  categories: string[][];
  feature_names: string[];
}

export class MLPredictor {
  private session: ort.InferenceSession | null = null;
  private featureSchema: FeatureSchema | null = null;
  private scalerParams: ScalerParams | null = null;
  private encoderParams: EncoderParams | null = null;
  private metadata: ModelMetadata | null = null;
  private modelDir: string | null = null;

  /**
   * Load ML model from directory
   *
   * @param modelDir - Path to model directory (e.g., './models/data-classifier/latest')
   * @returns MLPredictor instance
   */
  static async load(modelDir: string): Promise<MLPredictor> {
    const predictor = new MLPredictor();
    predictor.modelDir = modelDir;

    // Check if model directory exists
    if (!existsSync(modelDir)) {
      throw new Error(`Model directory not found: ${modelDir}`);
    }

    // Load metadata
    const metadataPath = join(modelDir, 'metadata.json');
    if (!existsSync(metadataPath)) {
      throw new Error(`Metadata file not found: ${metadataPath}`);
    }
    predictor.metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));

    // Load feature schema
    const schemaPath = join(modelDir, 'feature_schema.json');
    if (!existsSync(schemaPath)) {
      throw new Error(`Feature schema not found: ${schemaPath}`);
    }
    predictor.featureSchema = JSON.parse(readFileSync(schemaPath, 'utf-8'));

    // Load scaler parameters
    const scalerPath = join(modelDir, 'scaler.json');
    if (!existsSync(scalerPath)) {
      throw new Error(`Scaler parameters not found: ${scalerPath}`);
    }
    predictor.scalerParams = JSON.parse(readFileSync(scalerPath, 'utf-8'));

    // Load encoder parameters
    const encoderPath = join(modelDir, 'encoder.json');
    if (!existsSync(encoderPath)) {
      throw new Error(`Encoder parameters not found: ${encoderPath}`);
    }
    predictor.encoderParams = JSON.parse(readFileSync(encoderPath, 'utf-8'));

    // Load ONNX model
    const modelPath = join(modelDir, 'model.onnx');
    if (!existsSync(modelPath)) {
      throw new Error(`ONNX model not found: ${modelPath}`);
    }
    predictor.session = await ort.InferenceSession.create(modelPath);

    return predictor;
  }

  /**
   * Check if model is loaded
   */
  isLoaded(): boolean {
    return this.session !== null;
  }

  /**
   * Get model metadata
   */
  getMetadata(): ModelMetadata | null {
    return this.metadata;
  }

  /**
   * Extract features from an endpoint aggregate
   *
   * @param endpoint - Endpoint aggregate or scored endpoint
   * @returns Feature object
   */
  private extractFeatures(endpoint: EndpointAggregate | ScoredEndpoint): EndpointFeatures {
    // Extract method from endpointKey (format: "METHOD /path")
    const method = endpoint.endpointKey.split(' ')[0] || 'GET';

    // Calculate derived metrics
    const avgSize = endpoint.payloadSizes.length > 0
      ? endpoint.payloadSizes.reduce((a, b) => a + b, 0) / endpoint.payloadSizes.length
      : 0;

    const maxSize = endpoint.payloadSizes.length > 0
      ? Math.max(...endpoint.payloadSizes)
      : 0;

    const distinctSchemas = new Set(endpoint.schemaHashes).size;

    const bodyAvailableRate = endpoint.count > 0
      ? endpoint.bodyAvailableCount / endpoint.count
      : 0;

    const bodyRate = endpoint.count > 0
      ? endpoint.jsonParseSuccessCount / endpoint.count
      : 0;

    // Body evidence factor (same as scoring algorithm)
    const BODY_EVIDENCE_SCALE = 1.5;
    const BODY_EVIDENCE_MIN = 0.05;
    const bodyEvidenceFactor = Math.max(
      BODY_EVIDENCE_MIN,
      Math.min(1.0, bodyRate * BODY_EVIDENCE_SCALE)
    );

    const hostCount = endpoint.hosts?.length ?? 0;

    // Get score if it's a ScoredEndpoint, otherwise use 0
    const score = 'score' in endpoint ? endpoint.score : 0;

    return {
      method,
      score,
      count: endpoint.count,
      avgSize,
      maxSize,
      distinctSchemas,
      bodyAvailableCount: endpoint.bodyAvailableCount,
      jsonParseSuccessCount: endpoint.jsonParseSuccessCount,
      noBodyCount: endpoint.noBodyCount,
      bodyAvailableRate,
      bodyRate,
      bodyEvidenceFactor,
      avgDepth: endpoint.avgDepth,
      hostCount,
      hasArrayStructure: endpoint.hasArrayStructure,
      hasDataFlags: endpoint.hasDataFlags,
    };
  }

  /**
   * Transform features into model input format
   *
   * Applies:
   * - StandardScaler normalization for numerical features
   * - One-hot encoding for categorical features (method)
   *
   * @param features - Endpoint features
   * @returns Float array ready for model input
   */
  private transformFeatures(features: EndpointFeatures): Float32Array {
    if (!this.featureSchema || !this.scalerParams || !this.encoderParams) {
      throw new Error('Model not loaded');
    }

    const { numerical_features } = this.featureSchema;
    const { mean, scale } = this.scalerParams;
    const { categories } = this.encoderParams;

    // Build feature array in the same order as training
    const featureArray: number[] = [];

    // Add numerical features (scaled)
    for (let i = 0; i < numerical_features.length; i++) {
      const featName = numerical_features[i];
      const rawValue = (features as any)[featName] ?? 0;

      // Apply StandardScaler: (x - mean) / scale
      const scaledValue = (rawValue - mean[i]) / scale[i];
      featureArray.push(scaledValue);
    }

    // Add categorical features (one-hot encoded)
    // Use the encoder categories from training
    const methodCategories = categories[0]; // First (and only) categorical feature
    const method = features.method.toUpperCase();

    for (const category of methodCategories) {
      featureArray.push(method === category ? 1 : 0);
    }

    return new Float32Array(featureArray);
  }

  /**
   * Predict single endpoint
   *
   * @param endpoint - Endpoint aggregate or features
   * @returns ML prediction
   */
  predict(endpoint: EndpointAggregate | ScoredEndpoint | EndpointFeatures): MLPrediction {
    if (!this.session) {
      throw new Error('Model not loaded');
    }

    // Extract features if needed
    let features: EndpointFeatures;
    if ('endpointKey' in endpoint) {
      features = this.extractFeatures(endpoint);
    } else {
      features = endpoint;
    }

    // Transform features
    const featureArray = this.transformFeatures(features);

    // Create input tensor [1, n_features]
    const inputTensor = new ort.Tensor('float32', featureArray, [1, featureArray.length]);

    // Run inference (synchronous for simplicity)
    // Note: We can't use async/await here easily, but ort.InferenceSession.run() returns a Promise
    // We'll keep the method signature synchronous for now
    throw new Error('Synchronous predict not supported. Use predictAsync instead.');
  }

  /**
   * Predict single endpoint (async version)
   *
   * @param endpoint - Endpoint aggregate or features
   * @returns Promise of ML prediction
   */
  async predictAsync(endpoint: EndpointAggregate | ScoredEndpoint | EndpointFeatures): Promise<MLPrediction> {
    if (!this.session) {
      throw new Error('Model not loaded');
    }

    // Extract features if needed
    let features: EndpointFeatures;
    if ('endpointKey' in endpoint) {
      features = this.extractFeatures(endpoint);
    } else {
      features = endpoint;
    }

    // Transform features
    const featureArray = this.transformFeatures(features);

    // Create input tensor [1, n_features]
    const inputTensor = new ort.Tensor('float32', featureArray, [1, featureArray.length]);

    // Run inference
    const feeds: Record<string, ort.Tensor> = { float_input: inputTensor };
    const results = await this.session.run(feeds);

    // Extract probabilities
    // Output format from sklearn LogisticRegression:
    // - 'label': predicted class (0 or 1)
    // - 'probabilities': [P(non-data), P(data)]
    const probabilities = results.probabilities.data as Float32Array;
    const probability = probabilities[1]; // P(data)

    return {
      probability,
      label: probability >= 0.5 ? 'data' : 'non-data',
      confidence: Math.max(probabilities[0], probabilities[1]),
    };
  }

  /**
   * Predict batch of endpoints (async)
   *
   * @param endpoints - Array of endpoint aggregates
   * @returns Array of ML predictions
   */
  async predictBatch(endpoints: (EndpointAggregate | ScoredEndpoint | EndpointFeatures)[]): Promise<MLPrediction[]> {
    // For now, predict one at a time (can optimize later with batch inference)
    const predictions: MLPrediction[] = [];
    for (const endpoint of endpoints) {
      predictions.push(await this.predictAsync(endpoint));
    }
    return predictions;
  }

  /**
   * Explain prediction by showing top contributing features
   *
   * Note: This works well for logistic regression where we have direct coefficients.
   * For other models, this would require SHAP or similar methods.
   *
   * @param endpoint - Endpoint aggregate or features
   * @param topN - Number of top features to return (default: 5)
   * @returns Array of feature importances
   */
  async explain(
    endpoint: EndpointAggregate | ScoredEndpoint | EndpointFeatures,
    topN: number = 5
  ): Promise<FeatureImportance[]> {
    if (!this.metadata || this.metadata.modelType !== 'logistic_regression') {
      throw new Error('Explainability only supported for logistic regression models');
    }

    // Extract features
    let features: EndpointFeatures;
    if ('endpointKey' in endpoint) {
      features = this.extractFeatures(endpoint);
    } else {
      features = endpoint;
    }

    // For logistic regression, we can extract coefficients from the ONNX model
    // However, this requires parsing the ONNX graph which is complex
    // For now, we'll return a placeholder
    // TODO: Extract coefficients from ONNX model or save them during training

    console.warn('Feature importance extraction not yet implemented');
    return [];
  }
}

// Singleton instance (lazy loaded)
let globalPredictor: MLPredictor | null = null;
let globalModelDir: string | null = null;

/**
 * Try to load ML predictor from default location
 *
 * Returns null if model doesn't exist (graceful fallback)
 *
 * @param modelDir - Path to model directory
 * @returns MLPredictor instance or null
 */
export async function tryLoadMLPredictor(modelDir: string): Promise<MLPredictor | null> {
  // Return cached instance if same model dir
  if (globalPredictor && globalModelDir === modelDir) {
    return globalPredictor;
  }

  // Check if model exists
  const modelPath = join(modelDir, 'model.onnx');
  if (!existsSync(modelPath)) {
    return null;
  }

  try {
    globalPredictor = await MLPredictor.load(modelDir);
    globalModelDir = modelDir;
    return globalPredictor;
  } catch (err) {
    console.error('Failed to load ML model:', err);
    return null;
  }
}
