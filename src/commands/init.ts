/**
 * Init command - create config file and example flow
 */

import { writeFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import chalk from 'chalk';
import type { NetJsonMonConfig } from '../config.js';

export interface InitCommandOptions {
  outDir?: string;
  format?: 'json' | 'yaml';
  force?: boolean;
}

const DEFAULT_CONFIG: NetJsonMonConfig = {
  headless: true,
  monitorMs: 5000,
  timeoutMs: 30000,
  outDir: 'captures',
  maxBodyBytes: 1048576,
  inlineBodyBytes: 16384,
  maxCaptures: 500,
  maxConcurrentCaptures: 6,
  captureAllJson: false,
  saveHar: false,
  trace: false,
  consentMode: 'off',
  consentAction: 'reject',
  saveStorageState: false,
  disableSummary: false,
};

const EXAMPLE_FLOW = `/**
 * Example flow for netjsonmon
 * This flow demonstrates basic page interactions
 */

export default async function exampleFlow(page) {
  // Wait for page to be ready
  await page.waitForLoadState('domcontentloaded');
  
  // Example: Click a button (uncomment and customize)
  // await page.click('button#load-more');
  // await page.waitForTimeout(1000);
  
  // Example: Fill and submit a form
  // await page.fill('input[name="search"]', 'test query');
  // await page.press('input[name="search"]', 'Enter');
  // await page.waitForLoadState('networkidle');
  
  // Example: Scroll to load more content
  // await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  // await page.waitForTimeout(2000);
  
  console.log('Example flow completed');
}
`;

const GITIGNORE_ENTRY = `
# netjsonmon captures
captures/
*.har
trace.zip
`;

export async function initCommand(options: InitCommandOptions): Promise<void> {
  const cwd = process.cwd();
  const format = options.format || 'yaml';
  const configFileName = format === 'yaml' ? '.netjsonmon.yaml' : '.netjsonmon.json';
  const configPath = join(cwd, configFileName);
  const flowsDir = join(cwd, 'flows');
  const flowPath = join(flowsDir, 'example.ts');
  const gitignorePath = join(cwd, '.gitignore');
  
  console.log(chalk.cyan.bold('Initializing netjsonmon project...\n'));
  
  // Create config file
  try {
    let configContent: string;
    if (format === 'yaml') {
      // Generate YAML manually (simple formatting)
      const yaml = (await import('js-yaml')).default;
      configContent = yaml.dump(DEFAULT_CONFIG, { indent: 2 });
    } else {
      configContent = JSON.stringify(DEFAULT_CONFIG, null, 2);
    }
    
    await writeFile(configPath, configContent, { flag: options.force ? 'w' : 'wx' });
    console.log(chalk.green('✓') + ' Created ' + chalk.cyan(configFileName));
  } catch (error: any) {
    if (error.code === 'EEXIST') {
      console.log(chalk.yellow('⚠') + ' ' + configFileName + ' already exists (use --force to overwrite)');
    } else {
      throw error;
    }
  }
  
  // Create flows directory and example flow
  try {
    await mkdir(flowsDir, { recursive: true });
    await writeFile(flowPath, EXAMPLE_FLOW, { flag: options.force ? 'w' : 'wx' });
    console.log(chalk.green('✓') + ' Created ' + chalk.cyan('flows/example.ts'));
  } catch (error: any) {
    if (error.code === 'EEXIST') {
      console.log(chalk.yellow('⚠') + ' flows/example.ts already exists (use --force to overwrite)');
    } else {
      throw error;
    }
  }
  
  // Update .gitignore
  try {
    const { readFile } = await import('fs/promises');
    let gitignoreContent = '';
    try {
      gitignoreContent = await readFile(gitignorePath, 'utf-8');
    } catch {
      // File doesn't exist, that's fine
    }
    
    if (!gitignoreContent.includes('# netjsonmon captures')) {
      await writeFile(gitignorePath, gitignoreContent + GITIGNORE_ENTRY, 'utf-8');
      console.log(chalk.green('✓') + ' Updated ' + chalk.cyan('.gitignore'));
    } else {
      console.log(chalk.gray('  .gitignore already contains netjsonmon entries'));
    }
  } catch (error) {
    console.log(chalk.yellow('⚠') + ' Could not update .gitignore');
  }
  
  // Print next steps
  console.log(chalk.bold('\n📋 Next Steps:\n'));
  console.log('1. Review and customize ' + chalk.cyan(configFileName));
  console.log('2. Edit ' + chalk.cyan('flows/example.ts') + ' to match your target site');
  console.log('3. Run your first capture:');
  console.log('   ' + chalk.cyan('netjsonmon run https://example.com --flow flows/example.ts'));
  console.log('\n💡 Tip: Use ' + chalk.cyan('--config ' + configFileName) + ' to use this config explicitly');
}
