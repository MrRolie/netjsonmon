# Pretrained ML Models

This directory contains pretrained machine learning models for endpoint classification.

## What's Included

The `data-classifier/latest/` directory contains a **pretrained logistic regression model** that automatically classifies API endpoints as "data-returning" or "non-data" (configuration, tracking, etc.).

### Model Files

```
data-classifier/latest/
├── model.onnx              # Trained logistic regression (ONNX format)
├── scaler.json             # Feature normalization parameters
├── encoder.json            # One-hot encoding for HTTP methods
├── feature_schema.json     # Feature names and types
└── metadata.json           # Training metrics and model info
```

**Total size**: ~3-4 KB (very lightweight!)

## Using the Pretrained Model

The model is **automatically loaded** when you run captures:

```bash
netjsonmon run https://finance.yahoo.com/quote/AAPL
```

You'll see: `ℹ Using ML classifier for endpoint scoring`

Endpoints will be ranked by ML-predicted probability of returning data, rather than just heuristic scoring.

## Model Performance

Trained on **58 manually labeled endpoints** from Yahoo Finance and TrendForce captures:

- **Test F1**: 0.667
- **Test Precision**: 0.500
- **Test Recall**: 1.000 (catches all data endpoints)
- **ROC-AUC**: 0.909

**Training data distribution**:
- 7 data endpoints (12%)
- 51 non-data endpoints (88%)

**Top predictive features**:
1. avgDepth (+1.775) - JSON nesting depth
2. distinctSchemas (+0.701) - Schema stability
3. avgSize (+0.415) - Response size

## Retraining the Model

You can retrain the model with your own labeled data:

```bash
# 1. Label endpoints interactively
netjsonmon label ./training-captures

# 2. Export training data
netjsonmon label ./training-captures --export

# 3. Train new model
netjsonmon train --verbose
```

The model will be updated in `data-classifier/latest/` and automatically used for future captures.

## Why Include Pretrained Models?

**Benefits**:
- ✅ **Instant ML predictions** - No Python or training required
- ✅ **Small file size** - Only ~3-4 KB total
- ✅ **Better than heuristics** - Learned from actual labeled data
- ✅ **Easy to update** - Just retrain and commit

**No Python needed** for inference - the model uses ONNX format which runs natively in Node.js via `onnxruntime-node`.

## Model Versioning

Previous model versions are kept in subdirectories:
- `data-classifier/v1/` - Initial baseline
- `data-classifier/v2/` - After additional labeling
- etc.

The `latest/` directory always points to the current best model.

## Improving the Model

The model performance will improve significantly with more training data:

- **Current**: 58 examples → F1 0.667
- **Target**: 100-200 examples → F1 0.75-0.85

To contribute labeled data:
1. Run captures on diverse websites
2. Label endpoints via `netjsonmon label`
3. Export and commit `training-captures/*/labels/training.jsonl`
4. Retrain and commit the updated model

## Technical Details

**Model architecture**:
- Logistic Regression with L2 regularization (C=1.0)
- Class-balanced weights (handles 88% non-data, 12% data imbalance)
- 15 numerical + boolean features
- One-hot encoded HTTP method (GET, POST, etc.)

**Training process**:
- 80/20 train/test split (stratified)
- 5-fold cross-validation
- Optimized for F1-score (balanced precision/recall)

**Export format**:
- ONNX (Open Neural Network Exchange)
- Compatible with onnxruntime-node (no Python dependency)
- Portable across platforms

For more details, see [ML-TRAINING.md](../ML-TRAINING.md).
