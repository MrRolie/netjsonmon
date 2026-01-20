/**
 * Tests for feature extraction
 */

import { describe, it, expect } from 'vitest';
import { extractFeatures } from '../src/features';

describe('extractFeatures', () => {
  describe('type detection', () => {
    it('should detect arrays', () => {
      const features = extractFeatures([1, 2, 3]);
      expect(features.isArray).toBe(true);
      expect(features.isObject).toBe(false);
      expect(features.isPrimitive).toBe(false);
      expect(features.arrayLength).toBe(3);
    });

    it('should detect objects', () => {
      const features = extractFeatures({ name: 'test', age: 25 });
      expect(features.isArray).toBe(false);
      expect(features.isObject).toBe(true);
      expect(features.isPrimitive).toBe(false);
      expect(features.numKeys).toBe(2);
    });

    it('should detect primitives', () => {
      expect(extractFeatures('string').isPrimitive).toBe(true);
      expect(extractFeatures(123).isPrimitive).toBe(true);
      expect(extractFeatures(null).isPrimitive).toBe(true);
      expect(extractFeatures(undefined).isPrimitive).toBe(true);
    });
  });

  describe('object features', () => {
    it('should extract top-level keys (sorted)', () => {
      const features = extractFeatures({ z: 1, a: 2, m: 3 });
      expect(features.topLevelKeys).toEqual(['a', 'm', 'z']);
    });

    it('should limit top-level keys to 20', () => {
      const obj = Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => [`key${i}`, i])
      );
      const features = extractFeatures(obj);
      expect(features.topLevelKeys?.length).toBe(20);
    });

    it('should compute schema hash from sorted keys', () => {
      const features1 = extractFeatures({ z: 1, a: 2, m: 3 });
      const features2 = extractFeatures({ a: 99, m: 88, z: 77 }); // Same keys, different values
      expect(features1.schemaHash).toBe(features2.schemaHash);
      expect(features1.schemaHash).toBeTruthy();
    });

    it('should detect different schemas', () => {
      const features1 = extractFeatures({ a: 1, b: 2 });
      const features2 = extractFeatures({ a: 1, c: 3 });
      expect(features1.schemaHash).not.toBe(features2.schemaHash);
    });
  });

  describe('data-likeness flags', () => {
    it('should detect id fields', () => {
      expect(extractFeatures({ id: 123 }).hasId).toBe(true);
      expect(extractFeatures({ _id: '123' }).hasId).toBe(true);
      expect(extractFeatures({ uuid: 'abc' }).hasId).toBe(true);
      expect(extractFeatures({ name: 'test' }).hasId).toBe(false);
    });

    it('should detect items/results/data fields', () => {
      expect(extractFeatures({ items: [] }).hasItems).toBe(true);
      expect(extractFeatures({ results: [] }).hasItems).toBe(true);
      expect(extractFeatures({ data: {} }).hasItems).toBe(true);
      expect(extractFeatures({ list: [] }).hasItems).toBe(true);
    });

    it('should detect specific results flag', () => {
      expect(extractFeatures({ results: [] }).hasResults).toBe(true);
      expect(extractFeatures({ items: [] }).hasResults).toBe(false);
    });

    it('should detect specific data flag', () => {
      expect(extractFeatures({ data: {} }).hasData).toBe(true);
      expect(extractFeatures({ items: [] }).hasData).toBe(false);
    });
  });

  describe('depth estimation', () => {
    it('should estimate depth for flat objects', () => {
      const features = extractFeatures({ a: 1, b: 2 });
      expect(features.depthEstimate).toBe(1);
    });

    it('should estimate depth for nested objects', () => {
      const features = extractFeatures({
        user: {
          profile: {
            name: 'test'
          }
        }
      });
      expect(features.depthEstimate).toBeGreaterThan(1);
    });

    it('should cap depth at maxDepth', () => {
      const deepObj = { a: { b: { c: { d: { e: { f: 1 } } } } } };
      const features = extractFeatures(deepObj, 3);
      expect(features.depthEstimate).toBeLessThanOrEqual(3);
    });

    it('should handle arrays with nested objects', () => {
      const features = extractFeatures([
        { user: { name: 'test' } }
      ]);
      expect(features.depthEstimate).toBeGreaterThan(1);
    });
  });

  describe('sample paths', () => {
    it('should extract sample paths from nested object', () => {
      const features = extractFeatures({
        user: { name: 'test', email: 'test@example.com' },
        count: 5
      });
      expect(features.samplePaths.length).toBeGreaterThan(0);
      expect(features.samplePaths).toContain('count');
    });

    it('should extract paths from arrays', () => {
      const features = extractFeatures([
        { id: 1, name: 'item1' },
        { id: 2, name: 'item2' }
      ]);
      expect(features.samplePaths.length).toBeGreaterThan(0);
      expect(features.samplePaths.some(p => p.includes('[0]'))).toBe(true);
    });

    it('should handle deeply nested structures', () => {
      const features = extractFeatures({
        data: {
          items: [
            { user: { profile: { name: 'test' } } }
          ]
        }
      });
      expect(features.samplePaths.length).toBeGreaterThan(0);
    });
  });

  describe('bounds and safety', () => {
    it('should handle empty objects', () => {
      const features = extractFeatures({});
      expect(features.isObject).toBe(true);
      expect(features.numKeys).toBe(0);
      expect(features.topLevelKeys).toEqual([]);
    });

    it('should handle empty arrays', () => {
      const features = extractFeatures([]);
      expect(features.isArray).toBe(true);
      expect(features.arrayLength).toBe(0);
    });

    it('should handle circular references without hanging', () => {
      const obj: any = { a: 1 };
      obj.self = obj;
      const features = extractFeatures(obj);
      expect(features.isObject).toBe(true);
      expect(features.numKeys).toBe(2);
    });
  });
});
