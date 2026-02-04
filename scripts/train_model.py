#!/usr/bin/env python3
"""
Train ML classifier for netjsonmon endpoint classification.

This script trains a logistic regression model to classify endpoints as
"data" or "non-data" based on extracted features.
"""

import argparse
import json
import sys
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Tuple

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split, cross_val_score, StratifiedKFold
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType, StringTensorType


def load_training_data(input_paths: List[str]) -> pd.DataFrame:
    """Load training data from multiple training.jsonl files."""
    records = []

    for input_path in input_paths:
        path = Path(input_path)
        if not path.exists():
            print(f"Warning: {input_path} does not exist, skipping", file=sys.stderr)
            continue

        with open(path, 'r') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                    records.append(record)
                except json.JSONDecodeError as e:
                    print(f"Warning: Failed to parse line in {input_path}: {e}", file=sys.stderr)
                    continue

    if not records:
        raise ValueError("No training data loaded. Check input paths.")

    print(f"Loaded {len(records)} training examples from {len(input_paths)} file(s)")
    return pd.DataFrame(records)


def extract_features(df: pd.DataFrame) -> Tuple[pd.DataFrame, List[str]]:
    """
    Extract features from training data.

    Returns:
        (features_df, feature_names): DataFrame with feature columns and list of feature names
    """
    # Extract nested features dict into columns
    features_df = pd.json_normalize(df['features'])

    # Define numerical features (already numeric)
    numerical_features = [
        'score',
        'count',
        'avgSize',
        'maxSize',
        'distinctSchemas',
        'bodyAvailableCount',
        'jsonParseSuccessCount',
        'noBodyCount',
        'bodyAvailableRate',
        'bodyRate',
        'bodyEvidenceFactor',
        'avgDepth',
        'hostCount',
    ]

    # Define boolean features (convert to int)
    boolean_features = [
        'hasArrayStructure',
        'hasDataFlags',
    ]

    # Convert booleans to int
    for feat in boolean_features:
        if feat in features_df.columns:
            features_df[feat] = features_df[feat].astype(int)

    # Fill missing values with 0
    for feat in numerical_features + boolean_features:
        if feat not in features_df.columns:
            features_df[feat] = 0
        else:
            features_df[feat] = features_df[feat].fillna(0)

    # Extract method (categorical)
    if 'method' in features_df.columns:
        features_df['method'] = features_df['method'].fillna('GET')
    else:
        features_df['method'] = 'GET'

    # Select only the features we want
    selected_features = numerical_features + boolean_features + ['method']
    features_df = features_df[selected_features]

    return features_df, selected_features


def prepare_labels(df: pd.DataFrame) -> Tuple[np.ndarray, List[str]]:
    """
    Prepare labels for training.

    Filters out 'unsure' labels and converts to binary (0=non-data, 1=data).

    Returns:
        (labels, filtered_indices): Binary labels array and list of kept indices
    """
    # Filter out 'unsure' labels
    valid_mask = df['label'].isin(['data', 'non-data'])
    filtered_df = df[valid_mask].copy()

    if len(filtered_df) == 0:
        raise ValueError("No valid labels found (need 'data' or 'non-data')")

    # Convert to binary: 1 for 'data', 0 for 'non-data'
    labels = (filtered_df['label'] == 'data').astype(int).values

    print(f"Label distribution after filtering 'unsure':")
    print(f"  data: {labels.sum()} ({100 * labels.mean():.1f}%)")
    print(f"  non-data: {(1 - labels).sum()} ({100 * (1 - labels.mean()):.1f}%)")

    return labels, filtered_df.index.tolist()


def create_pipeline(feature_names: List[str]) -> Pipeline:
    """Create sklearn pipeline with preprocessing and model."""
    # Separate numerical and categorical features
    numerical_features = [f for f in feature_names if f != 'method']
    categorical_features = ['method']

    # Get indices for features (needed for ONNX conversion)
    numerical_indices = [i for i, f in enumerate(feature_names) if f != 'method']
    categorical_indices = [i for i, f in enumerate(feature_names) if f == 'method']

    # Create column transformer for preprocessing using indices instead of names
    preprocessor = ColumnTransformer(
        transformers=[
            ('num', StandardScaler(), numerical_indices),
            ('cat', OneHotEncoder(handle_unknown='ignore', sparse_output=False), categorical_indices),
        ]
    )

    # Create pipeline with preprocessing and model
    pipeline = Pipeline([
        ('preprocessor', preprocessor),
        ('classifier', LogisticRegression(
            class_weight='balanced',  # Handle class imbalance
            C=1.0,
            penalty='l2',
            solver='lbfgs',
            max_iter=1000,
            random_state=42
        ))
    ])

    return pipeline


def train_model(X: pd.DataFrame, y: np.ndarray, feature_names: List[str], verbose: bool = False) -> Tuple[Pipeline, Dict[str, Any], StandardScaler, OneHotEncoder]:
    """
    Train the model with cross-validation.

    Returns:
        (trained_pipeline, metrics, scaler, encoder): Trained pipeline, evaluation metrics, and preprocessing objects
    """
    # Split data: 80% train, 20% test (stratified to preserve class distribution)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )

    print(f"\nTrain/test split:")
    print(f"  Train: {len(X_train)} examples")
    print(f"  Test: {len(X_test)} examples")

    # Manually preprocess for better ONNX compatibility
    # Separate numerical and categorical features
    numerical_features = [f for f in feature_names if f != 'method']
    categorical_features = ['method']

    # Fit preprocessing on training data
    scaler = StandardScaler()
    encoder = OneHotEncoder(handle_unknown='ignore', sparse_output=False)

    X_train_num = X_train[numerical_features]
    X_train_cat = X_train[categorical_features]
    X_test_num = X_test[numerical_features]
    X_test_cat = X_test[categorical_features]

    # Fit and transform
    X_train_num_scaled = scaler.fit_transform(X_train_num)
    X_train_cat_encoded = encoder.fit_transform(X_train_cat)
    X_train_preprocessed = np.hstack([X_train_num_scaled, X_train_cat_encoded])

    X_test_num_scaled = scaler.transform(X_test_num)
    X_test_cat_encoded = encoder.transform(X_test_cat)
    X_test_preprocessed = np.hstack([X_test_num_scaled, X_test_cat_encoded])

    # Create simple model (no pipeline for ONNX)
    model = LogisticRegression(
        class_weight='balanced',
        C=1.0,
        solver='lbfgs',
        max_iter=1000,
        random_state=42
    )

    # Create pipeline just for cross-validation
    pipeline = create_pipeline(feature_names)

    # Cross-validation on training set using pipeline
    print(f"\nPerforming 5-fold cross-validation...")
    cv_scores = cross_val_score(
        pipeline, X_train, y_train,
        cv=StratifiedKFold(n_splits=5, shuffle=True, random_state=42),
        scoring='f1'
    )

    print(f"Cross-validation F1 scores: {cv_scores}")
    print(f"Mean CV F1: {cv_scores.mean():.3f} ± {cv_scores.std():.3f}")

    # Train final model on preprocessed training set
    print(f"\nTraining final model on full training set...")
    model.fit(X_train_preprocessed, y_train)

    # Evaluate on preprocessed test set
    y_pred = model.predict(X_test_preprocessed)
    y_proba = model.predict_proba(X_test_preprocessed)[:, 1]

    test_f1 = f1_score(y_test, y_pred)
    test_precision = precision_score(y_test, y_pred)
    test_recall = recall_score(y_test, y_pred)
    test_auc = roc_auc_score(y_test, y_proba) if len(np.unique(y_test)) > 1 else 0.0

    print(f"\nTest set performance:")
    print(f"  F1: {test_f1:.3f}")
    print(f"  Precision: {test_precision:.3f}")
    print(f"  Recall: {test_recall:.3f}")
    print(f"  ROC-AUC: {test_auc:.3f}")

    if verbose:
        print(f"\nConfusion Matrix:")
        cm = confusion_matrix(y_test, y_pred)
        print(f"                Predicted")
        print(f"                data  non-data")
        print(f"Actual data     {cm[1,1]:4d}  {cm[1,0]:8d}")
        print(f"       non-data {cm[0,1]:4d}  {cm[0,0]:8d}")

        print(f"\nClassification Report:")
        print(classification_report(y_test, y_pred, target_names=['non-data', 'data']))

        # Feature importance (logistic regression coefficients)
        # Get feature names after preprocessing
        num_feature_names = numerical_features
        cat_feature_names = encoder.get_feature_names_out(['method']).tolist()
        all_feature_names = num_feature_names + cat_feature_names

        # Get coefficients
        coef = model.coef_[0]

        # Sort by absolute coefficient
        feature_importance = sorted(
            zip(all_feature_names, coef),
            key=lambda x: abs(x[1]),
            reverse=True
        )

        print(f"\nTop 10 Feature Importances (Logistic Regression Coefficients):")
        for i, (feat, coef_val) in enumerate(feature_importance[:10], 1):
            sign = '+' if coef_val > 0 else ''
            print(f"  {i:2d}. {feat:30s} {sign}{coef_val:7.3f}")

    # Collect metrics
    metrics = {
        'cv_f1_mean': float(cv_scores.mean()),
        'cv_f1_std': float(cv_scores.std()),
        'cv_f1_scores': [float(s) for s in cv_scores],
        'test_f1': float(test_f1),
        'test_precision': float(test_precision),
        'test_recall': float(test_recall),
        'test_roc_auc': float(test_auc),
        'confusion_matrix': confusion_matrix(y_test, y_pred).tolist(),
        'n_train': int(len(X_train)),
        'n_test': int(len(X_test)),
    }

    return model, metrics, scaler, encoder


def export_to_onnx(model: LogisticRegression, encoder: OneHotEncoder, output_dir: Path, verbose: bool = False):
    """Export trained model to ONNX format."""
    # Get the number of features after preprocessing
    n_features = model.coef_.shape[1]

    if verbose:
        print(f"\nExporting to ONNX format...")
        print(f"  Number of features after preprocessing: {n_features}")

    # Define input type for ONNX - preprocessed feature array
    initial_type = [('float_input', FloatTensorType([None, n_features]))]

    # Convert to ONNX (simple model without preprocessing)
    try:
        onx = convert_sklearn(
            model,
            initial_types=initial_type,
            target_opset=12,
            options={id(model): {'zipmap': False}}  # Don't use ZipMap for cleaner output
        )
    except Exception as e:
        print(f"Error converting to ONNX: {e}", file=sys.stderr)
        raise

    # Save ONNX model
    onnx_path = output_dir / 'model.onnx'
    with open(onnx_path, 'wb') as f:
        f.write(onx.SerializeToString())

    print(f"  Saved ONNX model to {onnx_path}")


def save_metadata(
    feature_names: List[str],
    metrics: Dict[str, Any],
    output_dir: Path,
    input_paths: List[str],
    class_distribution: Dict[str, int]
):
    """Save model metadata including feature schema and training metrics."""
    # Get preprocessor details
    # Note: We need the actual categories used in training

    # Feature schema
    feature_schema = {
        'numerical_features': [f for f in feature_names if f != 'method'],
        'categorical_features': ['method'],
        'all_features': feature_names,
        'n_features': len(feature_names),
    }

    schema_path = output_dir / 'feature_schema.json'
    with open(schema_path, 'w') as f:
        json.dump(feature_schema, f, indent=2)

    print(f"  Saved feature schema to {schema_path}")

    # Metadata
    metadata = {
        'version': 'v1',
        'trainedAt': datetime.utcnow().isoformat() + 'Z',
        'modelType': 'logistic_regression',
        'hyperparameters': {
            'class_weight': 'balanced',
            'C': 1.0,
            'penalty': 'l2',
            'solver': 'lbfgs',
            'max_iter': 1000,
        },
        'trainingData': {
            'sources': input_paths,
            'totalExamples': class_distribution['data'] + class_distribution['non-data'],
            'dataCount': class_distribution['data'],
            'nonDataCount': class_distribution['non-data'],
        },
        'performance': {
            'cvF1Mean': metrics['cv_f1_mean'],
            'cvF1Std': metrics['cv_f1_std'],
            'testF1': metrics['test_f1'],
            'testPrecision': metrics['test_precision'],
            'testRecall': metrics['test_recall'],
            'testROCAUC': metrics['test_roc_auc'],
        },
        'features': feature_schema,
    }

    metadata_path = output_dir / 'metadata.json'
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)

    print(f"  Saved metadata to {metadata_path}")


def save_scaler_params(scaler: StandardScaler, encoder: OneHotEncoder, output_dir: Path):
    """Save StandardScaler and OneHotEncoder parameters for inference."""
    scaler_params = {
        'mean': scaler.mean_.tolist(),
        'scale': scaler.scale_.tolist(),
        'var': scaler.var_.tolist(),
    }

    scaler_path = output_dir / 'scaler.json'
    with open(scaler_path, 'w') as f:
        json.dump(scaler_params, f, indent=2)

    print(f"  Saved scaler parameters to {scaler_path}")

    # Save encoder categories
    encoder_params = {
        'categories': [cat.tolist() for cat in encoder.categories_],
        'feature_names': encoder.get_feature_names_out(['method']).tolist(),
    }

    encoder_path = output_dir / 'encoder.json'
    with open(encoder_path, 'w') as f:
        json.dump(encoder_params, f, indent=2)

    print(f"  Saved encoder parameters to {encoder_path}")


def main():
    parser = argparse.ArgumentParser(
        description='Train ML classifier for netjsonmon endpoint classification'
    )
    parser.add_argument(
        '--input',
        nargs='+',
        required=True,
        help='Path(s) to training.jsonl file(s)'
    )
    parser.add_argument(
        '--output',
        default='./models/data-classifier/latest',
        help='Output directory for trained model (default: ./models/data-classifier/latest)'
    )
    parser.add_argument(
        '--verbose',
        action='store_true',
        help='Show detailed training progress and metrics'
    )

    args = parser.parse_args()

    # Create output directory
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"netjsonmon ML Classifier Training")
    print(f"=" * 60)

    # Load training data
    df = load_training_data(args.input)

    # Prepare labels (filter out 'unsure')
    labels, valid_indices = prepare_labels(df)

    # Extract features
    features_df, feature_names = extract_features(df.iloc[valid_indices])

    # Class distribution for metadata
    class_distribution = {
        'data': int(labels.sum()),
        'non-data': int((1 - labels).sum()),
    }

    # Train model
    model, metrics, scaler, encoder = train_model(features_df, labels, feature_names, verbose=args.verbose)

    # Export to ONNX
    export_to_onnx(model, encoder, output_dir, verbose=args.verbose)

    # Save scaler and encoder parameters
    save_scaler_params(scaler, encoder, output_dir)

    # Save metadata
    save_metadata(feature_names, metrics, output_dir, args.input, class_distribution)

    print(f"\n{'=' * 60}")
    print(f"Training complete!")
    print(f"Model saved to: {output_dir}")
    print(f"Test F1: {metrics['test_f1']:.3f}, Precision: {metrics['test_precision']:.3f}, Recall: {metrics['test_recall']:.3f}")

    # Check if performance is acceptable
    if metrics['test_f1'] < 0.5:
        print(f"\nWarning: F1-score is below 0.5. Consider:")
        print(f"  - Collecting more labeled training data")
        print(f"  - Using heuristic-only scoring until model improves")
        return 1
    elif metrics['test_f1'] < 0.6:
        print(f"\nNote: F1-score is acceptable but could be improved with more training data.")
    else:
        print(f"\nModel performance looks good!")

    return 0


if __name__ == '__main__':
    sys.exit(main())
