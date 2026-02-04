# ML Classifier Training Guide

## Quick Start

### 1. Train the Model (Auto-detects ./training-captures)

```bash
# Using built command (recommended)
netjsonmon train

# Or with npm during development
npm run dev train

# With verbose output
netjsonmon train --verbose

# Specify custom directory
netjsonmon train ./my-training-data
```

### 2. Use ML Predictions

```bash
# ML predictions are automatic when model exists
netjsonmon run https://finance.yahoo.com/quote/AAPL

# Or during development
npm run dev run https://finance.yahoo.com/quote/AAPL
```

## Setup Instructions

### One-Time Setup

1. **Install Python dependencies** (for training only):
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r scripts/requirements.txt
   ```

2. **Link netjsonmon command** (optional, for convenience):
   ```bash
   npm link
   # Now you can use 'netjsonmon' instead of 'npm run dev'
   ```

### Label Training Data

```bash
# Interactive labeling
netjsonmon label ./training-captures

# Auto-label endpoints without bodies
netjsonmon label ./training-captures --autoNonDataNoBody

# Export training data
netjsonmon label ./training-captures --export
```

## Training Options

```bash
netjsonmon train [captureDir] [options]
```

**Options**:
- `captureDir` - Training data directory (default: `./training-captures`)
- `--out <dir>` - Model output directory (default: `./models/data-classifier/latest`)
- `--verbose` - Show detailed training progress

**Examples**:
```bash
# Train with defaults (auto-detects ./training-captures)
netjsonmon train

# Train with verbose output
netjsonmon train --verbose

# Train from custom directory
netjsonmon train ./my-captures

# Train and save to custom location
netjsonmon train --out ./models/my-model
```

## Training Data Structure

The train command automatically finds training data in these formats:

1. **Root-level training.jsonl** (combined):
   ```
   training-captures/
   └── training.jsonl  ← Automatically detected
   ```

2. **Individual capture training files**:
   ```
   training-captures/
   ├── 2026-01-21_yahoo-aapl/
   │   └── labels/
   │       └── training.jsonl  ← Automatically detected
   └── 2026-01-28_trendforce/
       └── labels/
           └── training.jsonl  ← Automatically detected
   ```

The command finds and uses **all** available training data automatically.

## Feature Set

### Base Features
- **Frequency**: Endpoint call count and rates
- **Payload Size**: Average and max payload sizes
- **Structure**: Array structures, data flags, schema stability
- **Depth**: JSON nesting depth analysis

### Enhanced Features (Phase 2)
- **TF-IDF on Path Tokens**: Extracts tokens from URL paths (e.g., "users", "api", "data") and computes TF-IDF scores. Identifies data-related patterns in endpoint paths.
- **TF-IDF on Sample Key Paths**: Analyzes JSON response keys (e.g., "user.email", "items[0].id") and computes TF-IDF scores. Captures data schema patterns.

These TF-IDF features are automatically extracted during training from:
- **pathTokens**: Path segments from normalized endpoint URLs
- **sampleKeyPaths**: JSON object paths from response bodies

Top 20 features from each TF-IDF category are selected and included in the trained model.

## Model Files

After training, the model is saved to:
```
models/data-classifier/latest/
├── model.onnx              # Trained logistic regression
├── scaler.json             # Feature scaling parameters
├── encoder.json            # One-hot encoding categories
├── feature_schema.json     # Feature names and types
└── metadata.json           # Training metrics and TF-IDF info
```

These files are automatically loaded during captures when ML predictions are used.

## Checking Model Performance

After training, you'll see:

```
Training Summary:
────────────────────────────────────────────────────────────
Model: logistic_regression
Version: v1
Trained: [timestamp]

Training Data:
  Total examples: 58
  Data endpoints: 7
  Non-data endpoints: 51

Performance:
  Test F1: 0.667
  Test Precision: 0.500
  Test Recall: 1.000
  CV F1: 0.533 ± 0.323

Model saved to: ./models/data-classifier/latest
────────────────────────────────────────────────────────────
```

**Performance Guidelines**:
- F1 ≥ 0.60: Acceptable baseline
- F1 ≥ 0.70: Good performance
- F1 ≥ 0.80: Excellent (requires 100+ examples)

## Improving Model Performance

1. **Label more endpoints**:
   ```bash
   netjsonmon label ./training-captures
   netjsonmon label ./training-captures --export
   ```

2. **Retrain with more data**:
   ```bash
   netjsonmon train --verbose
   ```

3. **Aim for 100-200 labeled examples** for best results

## Troubleshooting

### Python not found
```bash
# Install Python 3.9+
# Then install dependencies:
pip install -r scripts/requirements.txt
```

### Architecture mismatch (macOS)
The tool automatically uses `arch -arm64 python3` on Apple Silicon Macs. If you see errors:
```bash
# Recreate venv with correct architecture
rm -rf venv
arch -arm64 python3 -m venv venv
source venv/bin/activate
pip install -r scripts/requirements.txt
```

### No training data found
Make sure you've exported training data:
```bash
netjsonmon label ./training-captures --export
```

This creates `training.jsonl` files that the train command needs.

## Development vs Production

**Development** (using TypeScript directly):
```bash
npm run dev train
npm run dev run https://example.com
```

**Production** (using built binary):
```bash
npm run build      # Build once
netjsonmon train   # Use built command
netjsonmon run https://example.com
```

**Global installation** (convenience):
```bash
npm link           # Link once
netjsonmon train   # Use anywhere
```

## Command Comparison

| Task | Development | Production | Global |
|------|-------------|------------|--------|
| Train model | `npm run dev train` | `node dist/index.js train` | `netjsonmon train` |
| Run capture | `npm run dev run <url>` | `node dist/index.js run <url>` | `netjsonmon run <url>` |
| Label data | `npm run dev label` | `node dist/index.js label` | `netjsonmon label` |

All three methods support the same arguments and options.

