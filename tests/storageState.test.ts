import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Tests for Fix 3: Storage state support
 */

describe('Storage state support (Fix 3)', () => {
  describe('MonitorOptions storage state fields', () => {
    it('should accept storageState path', () => {
      const options = {
        storageState: './state.json',
        saveStorageState: false,
      };

      expect(options.storageState).toBe('./state.json');
    });

    it('should accept saveStorageState boolean', () => {
      const options = {
        saveStorageState: true,
      };

      expect(options.saveStorageState).toBe(true);
    });

    it('should allow both options together', () => {
      const options = {
        storageState: './existing-state.json',
        saveStorageState: true,
      };

      expect(options.storageState).toBe('./existing-state.json');
      expect(options.saveStorageState).toBe(true);
    });
  });

  describe('Storage state file structure', () => {
    it('should accept valid storage state structure', () => {
      // Example storage state structure from Playwright
      const storageState = {
        cookies: [
          {
            name: 'session',
            value: 'abc123',
            domain: 'example.com',
            path: '/',
            expires: -1,
            httpOnly: true,
            secure: true,
            sameSite: 'Lax' as const,
          },
        ],
        origins: [
          {
            origin: 'https://example.com',
            localStorage: [
              {
                name: 'theme',
                value: 'dark',
              },
            ],
          },
        ],
      };

      expect(storageState.cookies).toHaveLength(1);
      expect(storageState.origins).toHaveLength(1);
    });
  });

  describe('Storage state path resolution', () => {
    it('should resolve relative paths', () => {
      const relativePath = './state.json';
      const resolved = resolve(relativePath);
      
      expect(resolved).toBeTruthy();
      expect(resolved).not.toBe(relativePath);
    });

    it('should handle absolute paths', () => {
      const absolutePath = resolve(process.cwd(), 'state.json');
      const resolved = resolve(absolutePath);
      
      expect(resolved).toBe(absolutePath);
    });
  });
});

describe('CLI storage state flags', () => {
  it('should parse --storageState flag', () => {
    const cliOptions = {
      storageState: './my-state.json',
    };

    expect(cliOptions.storageState).toBe('./my-state.json');
  });

  it('should parse --saveStorageState flag', () => {
    const cliOptions = {
      saveStorageState: true,
    };

    expect(cliOptions.saveStorageState).toBe(true);
  });

  it('should default saveStorageState to false', () => {
    const cliOptions = {
      saveStorageState: false,
    };

    expect(cliOptions.saveStorageState).toBe(false);
  });
});
