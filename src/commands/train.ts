/**
 * Train command - train ML classifier on labeled endpoints
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { MLPredictor } from '../ml/predictor.js';

export interface TrainCommandOptions {
  out?: string;
  verbose?: boolean;
}

interface CaptureRun {
  name: string;
  path: string;
  trainingFile: string;
}

/**
 * Discover capture runs with training data
 */
async function discoverCaptureRuns(captureDir: string): Promise<CaptureRun[]> {
  const capturePath = resolve(captureDir);

  if (!existsSync(capturePath)) {
    throw new Error(`Capture directory not found: ${capturePath}`);
  }

  const runs: CaptureRun[] = [];

  // Check if there's a training.jsonl file at the root level
  const rootTrainingFile = join(capturePath, 'training.jsonl');
  if (existsSync(rootTrainingFile)) {
    runs.push({
      name: 'combined',
      path: capturePath,
      trainingFile: rootTrainingFile,
    });
  }

  // Also check subdirectories for individual training files
  const entries = await readdir(capturePath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const runPath = join(capturePath, entry.name);
    const trainingFile = join(runPath, 'labels', 'training.jsonl');

    if (existsSync(trainingFile)) {
      runs.push({
        name: entry.name,
        path: runPath,
        trainingFile,
      });
    }
  }

  return runs;
}

/**
 * Count training examples in training.jsonl file
 */
async function countTrainingExamples(trainingFile: string): Promise<{ total: number; data: number; nonData: number }> {
  const content = await readFile(trainingFile, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  let dataCount = 0;
  let nonDataCount = 0;

  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      if (record.label === 'data') {
        dataCount++;
      } else if (record.label === 'non-data') {
        nonDataCount++;
      }
    } catch {
      // Skip malformed lines
    }
  }

  return {
    total: dataCount + nonDataCount,
    data: dataCount,
    nonData: nonDataCount,
  };
}

/**
 * Check if Python is available
 */
async function checkPython(): Promise<string> {
  return new Promise((resolve, reject) => {
    // On macOS, try arch -arm64 python3 first to ensure native execution
    const isMac = process.platform === 'darwin';
    const pythonCandidates = isMac
      ? [['arch', '-arm64', 'python3'], ['python3'], ['python']]
      : [['python3'], ['python']];

    function tryNext(index: number) {
      if (index >= pythonCandidates.length) {
        reject(new Error('Python not found. Please install Python 3.9+ and try again.'));
        return;
      }

      const candidate = pythonCandidates[index];
      const cmd = candidate[0];
      const args = [...candidate.slice(1), '--version'];

      const proc = spawn(cmd, args);

      proc.on('close', (code) => {
        if (code === 0) {
          // Return the full command as a string or array format
          if (candidate.length > 1) {
            resolve(candidate.join(' '));
          } else {
            resolve(candidate[0]);
          }
        } else {
          tryNext(index + 1);
        }
      });

      proc.on('error', () => {
        tryNext(index + 1);
      });
    }

    tryNext(0);
  });
}

/**
 * Run Python training script
 */
async function runTraining(
  pythonCmd: string,
  scriptPath: string,
  inputFiles: string[],
  outputDir: string,
  verbose: boolean
): Promise<{ success: boolean; exitCode: number }> {
  return new Promise((resolve) => {
    const args = [
      scriptPath,
      '--input',
      ...inputFiles,
      '--output',
      outputDir,
    ];

    if (verbose) {
      args.push('--verbose');
    }

    // Parse pythonCmd - it might be "arch -arm64 python3" or just "python3"
    const cmdParts = pythonCmd.split(' ');
    const cmd = cmdParts[0];
    const cmdArgs = [...cmdParts.slice(1), ...args];

    const python = spawn(cmd, cmdArgs, {
      stdio: verbose ? 'inherit' : 'pipe',
    });

    if (!verbose) {
      python.stdout?.on('data', (data) => {
        process.stdout.write(data);
      });

      python.stderr?.on('data', (data) => {
        process.stderr.write(data);
      });
    }

    python.on('close', (code) => {
      resolve({
        success: code === 0,
        exitCode: code ?? 1,
      });
    });

    python.on('error', (err) => {
      console.error('Failed to spawn Python process:', err);
      resolve({
        success: false,
        exitCode: 1,
      });
    });
  });
}

/**
 * Validate exported model
 */
async function validateModel(modelDir: string): Promise<boolean> {
  const requiredFiles = ['model.onnx', 'feature_schema.json', 'metadata.json', 'scaler.json'];

  for (const file of requiredFiles) {
    const filePath = join(modelDir, file);
    if (!existsSync(filePath)) {
      console.error(chalk.red(`Missing required file: ${file}`));
      return false;
    }
  }

  // Try to load model
  try {
    const predictor = await MLPredictor.load(modelDir);
    const metadata = predictor.getMetadata();

    if (!metadata) {
      console.error(chalk.red('Failed to load model metadata'));
      return false;
    }

    return true;
  } catch (err) {
    console.error(chalk.red('Failed to load model:'), err);
    return false;
  }
}

/**
 * Display training summary
 */
function displaySummary(modelDir: string, metadata: any) {
  console.log('\n' + chalk.bold('Training Summary:'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.cyan('Model:'), metadata.modelType);
  console.log(chalk.cyan('Version:'), metadata.version);
  console.log(chalk.cyan('Trained:'), new Date(metadata.trainedAt).toLocaleString());
  console.log('');
  console.log(chalk.cyan('Training Data:'));
  console.log('  Total examples:', metadata.trainingData.totalExamples);
  console.log('  Data endpoints:', metadata.trainingData.dataCount);
  console.log('  Non-data endpoints:', metadata.trainingData.nonDataCount);
  console.log('');
  console.log(chalk.cyan('Performance:'));
  console.log('  Test F1:', chalk.bold(metadata.performance.testF1.toFixed(3)));
  console.log('  Test Precision:', metadata.performance.testPrecision.toFixed(3));
  console.log('  Test Recall:', metadata.performance.testRecall.toFixed(3));
  console.log('  CV F1:', `${metadata.performance.cvF1Mean.toFixed(3)} ± ${metadata.performance.cvF1Std.toFixed(3)}`);
  console.log('');
  console.log(chalk.cyan('Model saved to:'), chalk.green(modelDir));
  console.log(chalk.gray('─'.repeat(60)));

  // Performance assessment
  const f1 = metadata.performance.testF1;
  if (f1 < 0.5) {
    console.log('');
    console.log(chalk.yellow('⚠ Warning: F1-score is below 0.5'));
    console.log(chalk.yellow('Consider collecting more labeled training data or using heuristic-only scoring.'));
  } else if (f1 < 0.6) {
    console.log('');
    console.log(chalk.yellow('⚠ Note: F1-score is acceptable but could be improved with more training data.'));
  } else {
    console.log('');
    console.log(chalk.green('✓ Model performance looks good!'));
  }
}

/**
 * Train ML classifier command handler
 */
export async function trainCommand(captureDir: string = './training-captures', options: TrainCommandOptions = {}) {
  const outputDir = resolve(options.out || './models/data-classifier/latest');
  const verbose = options.verbose || false;

  console.log(chalk.bold('netjsonmon ML Classifier Training'));
  console.log(chalk.gray('='.repeat(60)));
  console.log('');
  console.log(chalk.cyan('Training data directory:'), captureDir);
  console.log(chalk.cyan('Model output directory:'), outputDir);
  console.log('');

  // Step 1: Discover training data
  const spinner = ora('Discovering training data...').start();
  let runs: CaptureRun[];

  try {
    runs = await discoverCaptureRuns(captureDir);

    if (runs.length === 0) {
      spinner.fail('No training data found');
      console.log('');
      console.log(chalk.yellow('Please label some endpoints first:'));
      console.log(chalk.cyan('  netjsonmon label ./training-captures'));
      console.log(chalk.cyan('  netjsonmon label ./training-captures --export'));
      return;
    }

    spinner.succeed(`Found ${runs.length} capture run(s) with training data`);
  } catch (err) {
    spinner.fail('Failed to discover training data');
    console.error(err);
    return;
  }

  // Step 2: Count training examples
  spinner.start('Counting training examples...');
  let totalExamples = 0;
  let totalData = 0;
  let totalNonData = 0;

  for (const run of runs) {
    try {
      const counts = await countTrainingExamples(run.trainingFile);
      totalExamples += counts.total;
      totalData += counts.data;
      totalNonData += counts.nonData;
    } catch (err) {
      console.error(chalk.red(`Failed to read ${run.name}:`), err);
    }
  }

  if (totalExamples === 0) {
    spinner.fail('No training examples found');
    console.log('');
    console.log(chalk.yellow('Please export training data first:'));
    console.log(chalk.cyan('  netjsonmon label ./training-captures --export'));
    return;
  }

  spinner.succeed(`Loaded ${totalExamples} labeled examples (${totalData} data, ${totalNonData} non-data)`);

  // Check for class imbalance warning
  if (totalData < 3 || totalNonData < 3) {
    console.log(chalk.yellow('⚠ Warning: Very few examples in one class. Model may not train well.'));
    console.log(chalk.yellow('  Consider labeling more endpoints to improve model performance.'));
  }

  // Step 3: Check Python availability
  spinner.start('Checking Python availability...');
  let pythonCmd: string;

  try {
    pythonCmd = await checkPython();
    spinner.succeed(`Found Python: ${pythonCmd}`);
  } catch (err) {
    spinner.fail('Python not found');
    console.error(err);
    console.log('');
    console.log(chalk.yellow('Please install Python 3.9+ to train the model:'));
    console.log(chalk.cyan('  https://www.python.org/downloads/'));
    console.log('');
    console.log(chalk.yellow('Then install Python dependencies:'));
    console.log(chalk.cyan('  pip install -r scripts/requirements.txt'));
    return;
  }

  // Step 4: Check training script exists
  const scriptPath = resolve('./scripts/train_model.py');
  if (!existsSync(scriptPath)) {
    console.error(chalk.red('Training script not found:'), scriptPath);
    return;
  }

  // Step 5: Run training
  console.log('');
  console.log(chalk.bold('Training model...'));
  console.log(chalk.gray('─'.repeat(60)));

  const inputFiles = runs.map(r => r.trainingFile);
  const result = await runTraining(pythonCmd, scriptPath, inputFiles, outputDir, verbose);

  if (!result.success) {
    console.log('');
    console.error(chalk.red('Training failed with exit code:'), result.exitCode);
    console.log('');
    console.log(chalk.yellow('Make sure Python dependencies are installed:'));
    console.log(chalk.cyan('  pip install -r scripts/requirements.txt'));
    return;
  }

  // Step 6: Validate model
  console.log('');
  spinner.start('Validating exported model...');

  const isValid = await validateModel(outputDir);

  if (!isValid) {
    spinner.fail('Model validation failed');
    return;
  }

  spinner.succeed('Model validated successfully');

  // Step 7: Load and display metadata
  try {
    const metadataPath = join(outputDir, 'metadata.json');
    const metadataContent = await readFile(metadataPath, 'utf-8');
    const metadata = JSON.parse(metadataContent);

    displaySummary(outputDir, metadata);
  } catch (err) {
    console.error(chalk.red('Failed to load metadata:'), err);
  }

  console.log('');
  console.log(chalk.green('✓ Training complete!'));
  console.log('');
  console.log(chalk.cyan('Next steps:'));
  console.log('  1. Test the model: ' + chalk.bold('netjsonmon run <url>'));
  console.log('  2. Endpoints will automatically use ML scoring if model exists');
  console.log('');
}
