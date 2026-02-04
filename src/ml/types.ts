/**
 * TypeScript interfaces for ML classifier
 */

/**
 * ML prediction result
 */
export interface MLPrediction {
  /** Probability of endpoint being "data" class (0 to 1) */
  probability: number;

  /** Predicted label */
  label: 'data' | 'non-data';

  /** Confidence (highest class probability) */
  confidence: number;
}

/**
 * Feature importance for explainability
 */
export interface FeatureImportance {
  /** Feature name */
  name: string;

  /** Feature value */
  value: number;

  /** Model weight/coefficient for this feature */
  weight: number;

  /** Contribution to prediction (value * weight) */
  contribution: number;
}

/**
 * Feature schema loaded from feature_schema.json
 */
export interface FeatureSchema {
  /** List of numerical feature names */
  numerical_features: string[];

  /** List of categorical feature names */
  categorical_features: string[];

  /** All feature names in order */
  all_features: string[];

  /** Total number of features */
  n_features: number;
}

/**
 * StandardScaler parameters for feature normalization
 */
export interface ScalerParams {
  /** Mean for each numerical feature */
  mean: number[];

  /** Scale (std dev) for each numerical feature */
  scale: number[];

  /** Variance for each numerical feature */
  var: number[];
}

/**
 * Model metadata from metadata.json
 */
export interface ModelMetadata {
  /** Model version */
  version: string;

  /** Training timestamp (ISO 8601) */
  trainedAt: string;

  /** Model type (e.g., "logistic_regression") */
  modelType: string;

  /** Model hyperparameters */
  hyperparameters: Record<string, any>;

  /** Training data statistics */
  trainingData: {
    sources: string[];
    totalExamples: number;
    dataCount: number;
    nonDataCount: number;
  };

  /** Performance metrics */
  performance: {
    cvF1Mean: number;
    cvF1Std: number;
    testF1: number;
    testPrecision: number;
    testRecall: number;
    testROCAUC: number;
  };

  /** Feature configuration */
  features: FeatureSchema;
}

/**
 * Endpoint features for ML prediction
 * Maps to the features extracted during training
 */
export interface EndpointFeatures {
  // HTTP method
  method: string;

  // Numerical features
  score: number;
  count: number;
  avgSize: number;
  maxSize: number;
  distinctSchemas: number;
  bodyAvailableCount: number;
  jsonParseSuccessCount: number;
  noBodyCount: number;
  bodyAvailableRate: number;
  bodyRate: number;
  bodyEvidenceFactor: number;
  avgDepth: number;
  hostCount: number;

  // Boolean features (will be converted to 0/1)
  hasArrayStructure: boolean;
  hasDataFlags: boolean;
}
