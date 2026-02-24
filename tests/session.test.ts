import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { resolveConfigPaths } from '../src/config';
import { resolveStorageStateInput } from '../src/commands/run';

describe('session management (Phase 1)', () => {
  it('maps --useSession to storageState when --storageState is not set', () => {
    const resolved = resolveStorageStateInput({
      useSession: './auth/session.json',
    });

    expect(resolved).toBe('./auth/session.json');
  });

  it('prefers --storageState when both storageState and useSession are provided', () => {
    const resolved = resolveStorageStateInput({
      storageState: './explicit-state.json',
      useSession: './alias-state.json',
    });

    expect(resolved).toBe('./explicit-state.json');
  });

  it('resolves useSession and saveSession paths relative to config directory', () => {
    const configDir = resolve('config-root');
    const resolvedConfig = resolveConfigPaths(
      {
        useSession: './sessions/input.json',
        saveSession: './sessions/output.json',
      },
      configDir,
    );

    expect(resolvedConfig.useSession).toBe(resolve(configDir, './sessions/input.json'));
    expect(resolvedConfig.saveSession).toBe(resolve(configDir, './sessions/output.json'));
  });

  it('persists a valid storage state JSON document round-trip', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'netjsonmon-session-'));
    const statePath = join(tempDir, 'state.json');
    const state = {
      cookies: [
        {
          name: 'session',
          value: 'abc123',
          domain: '.example.com',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ],
      origins: [
        {
          origin: 'https://example.com',
          localStorage: [
            { name: 'auth_token', value: 'token-1' },
          ],
        },
      ],
    };

    try {
      writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
      const loaded = JSON.parse(readFileSync(statePath, 'utf-8'));

      expect(loaded.cookies[0].name).toBe('session');
      expect(loaded.cookies[0].httpOnly).toBe(true);
      expect(loaded.origins[0].localStorage[0].name).toBe('auth_token');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
