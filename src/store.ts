/**
 * Storage module for persisting captures
 */

import { createHash } from 'crypto';
import { mkdir, writeFile, appendFile } from 'fs/promises';
import { join } from 'path';
import type { CaptureRecord, RunMetadata } from './types.js';
import { redactJson } from './redact.js';

export class CaptureStore {
  private runDir: string;
  private bodiesDir: string;
  private indexPath: string;
  private inlineBodyBytes: number;

  constructor(baseDir: string, runId: string, inlineBodyBytes: number) {
    this.runDir = join(baseDir, runId);
    this.bodiesDir = join(this.runDir, 'bodies');
    this.indexPath = join(this.runDir, 'index.jsonl');
    this.inlineBodyBytes = inlineBodyBytes;
  }

  /**
   * Initialize storage directories
   */
  async init(): Promise<void> {
    await mkdir(this.bodiesDir, { recursive: true });
    // Ensure index.jsonl exists so summary generation doesn't fail on empty runs
    await writeFile(this.indexPath, '', { flag: 'a' });
  }

  /**
   * Save run metadata
   */
  async saveRunMetadata(metadata: RunMetadata): Promise<void> {
    const metadataPath = join(this.runDir, 'run.json');
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Compute SHA256 hash of raw bytes
   */
  computeHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Store a capture record
   */
  async storeCapture(
    record: Omit<CaptureRecord, 'bodyHash' | 'bodyPath' | 'inlineBody'>,
    bodyBuffer: Buffer | null
  ): Promise<void> {
    // Compute hash if body is available
    const bodyHash = bodyBuffer ? this.computeHash(bodyBuffer) : '';

    // Determine storage strategy
    let bodyPath: string | undefined;
    let inlineBody: any | undefined;

    if (bodyBuffer && record.jsonParseSuccess) {
      const bodySize = bodyBuffer.length;

      if (bodySize <= this.inlineBodyBytes) {
        // Inline small bodies
        try {
          const parsed = JSON.parse(bodyBuffer.toString('utf-8'));
          inlineBody = redactJson(parsed);
        } catch {
          // If parse fails here, keep it metadata-only
        }
      } else {
        // Externalize larger bodies
        bodyPath = `bodies/${bodyHash}.json`;
        const fullPath = join(this.runDir, bodyPath);
        try {
          const parsed = JSON.parse(bodyBuffer.toString('utf-8'));
          const redacted = redactJson(parsed);
          await writeFile(fullPath, JSON.stringify(redacted, null, 2));
        } catch {
          // If write fails, mark as unavailable
          bodyPath = undefined;
        }
      }
    }

    // Build final record
    const finalRecord: CaptureRecord = {
      ...record,
      bodyHash,
      bodyPath,
      inlineBody,
    };

    // Append to index
    await appendFile(this.indexPath, JSON.stringify(finalRecord) + '\n');
  }
}
