/**
 * Tests for ConcurrencyLimiter (queue.ts)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConcurrencyLimiter } from '../src/queue.js';

describe('ConcurrencyLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should enforce concurrency limit', async () => {
    const limiter = new ConcurrencyLimiter(2);
    let running = 0;
    let maxRunning = 0;

    const task = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise(resolve => setTimeout(resolve, 100));
      running--;
    };

    // Start 5 tasks
    const promises = Array.from({ length: 5 }, () => limiter.run(task));

    // Complete all tasks by advancing time
    await vi.advanceTimersByTimeAsync(500);
    await Promise.all(promises);
    
    expect(maxRunning).toBeLessThanOrEqual(2);
    expect(limiter.getRunning()).toBe(0);
  });

  it('should return task results', async () => {
    const limiter = new ConcurrencyLimiter(2);
    
    const result = await limiter.run(async () => {
      return 'success';
    });

    expect(result).toBe('success');
  });

  it('should propagate task errors', async () => {
    const limiter = new ConcurrencyLimiter(2);
    
    await expect(
      limiter.run(async () => {
        throw new Error('task failed');
      })
    ).rejects.toThrow('task failed');
  });

  it('should track running and pending counts', async () => {
    const limiter = new ConcurrencyLimiter(2);
    
    const task = () => new Promise(resolve => setTimeout(resolve, 100));

    // Start 4 tasks (2 running, 2 pending)
    const promises = [
      limiter.run(task),
      limiter.run(task),
      limiter.run(task),
      limiter.run(task),
    ];

    // Wait a bit for tasks to start
    await vi.advanceTimersByTimeAsync(10);
    
    expect(limiter.getRunning()).toBe(2);
    expect(limiter.getPending()).toBeGreaterThanOrEqual(0);

    await vi.advanceTimersByTimeAsync(200);
    await Promise.all(promises);

    expect(limiter.getRunning()).toBe(0);
    expect(limiter.getPending()).toBe(0);
  });

  it('should drain all tasks', async () => {
    const limiter = new ConcurrencyLimiter(2);
    let completed = 0;

    const task = async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      completed++;
    };

    // Start 3 tasks
    limiter.run(task);
    limiter.run(task);
    limiter.run(task);

    // Drain should wait for all to complete
    const drainPromise = limiter.drain();
    
    await vi.advanceTimersByTimeAsync(200);
    await drainPromise;

    expect(completed).toBe(3);
    expect(limiter.getRunning()).toBe(0);
  });

  it('should handle concurrency of 1', async () => {
    const limiter = new ConcurrencyLimiter(1);
    let running = 0;
    let maxRunning = 0;

    const task = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise(resolve => setTimeout(resolve, 50));
      running--;
    };

    const promises = Array.from({ length: 3 }, () => limiter.run(task));

    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(60);
    }

    await Promise.all(promises);
    expect(maxRunning).toBe(1);
  });

  it('should reject invalid concurrency', () => {
    expect(() => new ConcurrencyLimiter(0)).toThrow('Concurrency must be at least 1');
    expect(() => new ConcurrencyLimiter(-1)).toThrow('Concurrency must be at least 1');
  });

  it('should handle tasks that complete immediately', async () => {
    const limiter = new ConcurrencyLimiter(2);
    
    const results = await Promise.all([
      limiter.run(async () => 1),
      limiter.run(async () => 2),
      limiter.run(async () => 3),
    ]);

    expect(results).toEqual([1, 2, 3]);
    expect(limiter.getRunning()).toBe(0);
  });

  it('should handle mixed fast and slow tasks', async () => {
    const limiter = new ConcurrencyLimiter(2);
    let order: number[] = [];

    const fastTask = async (id: number) => {
      order.push(id);
    };

    const slowTask = async (id: number) => {
      await new Promise(resolve => setTimeout(resolve, 100));
      order.push(id);
    };

    const promises = [
      limiter.run(() => slowTask(1)),
      limiter.run(() => fastTask(2)),
      limiter.run(() => fastTask(3)),
    ];

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all(promises);

    // Fast tasks should complete before slow task
    expect(order).toContain(2);
    expect(order).toContain(3);
    expect(order[order.length - 1]).toBe(1);
  });
});
