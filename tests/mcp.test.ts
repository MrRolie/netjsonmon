import { describe, expect, it } from 'vitest';
import { join, resolve } from 'path';
import { homedir, tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'fs';
import {
  buildRunMonitorError,
  defaultMcpOutDir,
  ensureWritableOutDir,
  resolveMcpOutDir,
} from '../src/commands/mcp';

describe('MCP run_monitor helpers', () => {
  it('uses a user-home default outDir', () => {
    expect(defaultMcpOutDir()).toBe(resolve(homedir(), 'captures'));
  });

  it('resolves custom outDir values', () => {
    expect(resolveMcpOutDir('./captures')).toBe(resolve('./captures'));
  });

  it('creates writable output directory when missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'netjsonmon-mcp-'));
    const target = join(root, 'captures');
    try {
      await expect(ensureWritableOutDir(target)).resolves.toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns clear guidance for missing Playwright browsers', () => {
    const msg = buildRunMonitorError(
      new Error("Executable doesn't exist at C:\\pw\\chrome.exe"),
      'C:/Users/test/captures',
    );
    expect(msg).toContain('npx playwright install chromium');
  });

  it('returns clear guidance for unwritable directories', () => {
    const msg = buildRunMonitorError(
      new Error('EACCES: permission denied'),
      'C:/Windows/System32/captures',
    );
    expect(msg).toContain('Cannot write capture artifacts');
    expect(msg).toContain('outDir');
  });
});
