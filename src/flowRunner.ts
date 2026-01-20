/**
 * Flow runner for executing user-provided navigation flows
 */

import { pathToFileURL } from 'url';
import type { Page } from 'playwright';
import type { FlowFunction } from './types.js';

/**
 * Load and execute a user-provided flow module
 */
export async function runFlow(
  page: Page,
  flowPath: string,
  timeoutMs: number = 30000
): Promise<void> {
  try {
    // Convert to file URL for ESM import
    const flowUrl = pathToFileURL(flowPath).href;
    
    // Dynamic import the flow module
    const flowModule = await import(flowUrl);
    const flowFn: FlowFunction = flowModule.default || flowModule.flow;

    if (typeof flowFn !== 'function') {
      throw new Error(
        'Flow module must export a default function or named "flow" function'
      );
    }

    // Execute flow with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Flow execution timeout')), timeoutMs);
    });

    await Promise.race([flowFn(page), timeoutPromise]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Flow execution failed: ${message}`);
  }
}
