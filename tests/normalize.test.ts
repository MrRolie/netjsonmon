/**
 * Tests for URL normalization and endpoint key generation
 */

import { describe, it, expect } from 'vitest';
import { normalizeUrl, endpointKey } from '../src/normalize';

describe('normalizeUrl', () => {
  it('should remove URL fragment', () => {
    const result = normalizeUrl('https://api.example.com/users#section');
    expect(result.normalizedUrl).toBe('https://api.example.com/users');
    expect(result.normalizedPath).toBe('/users');
  });

  it('should sort query parameters alphabetically', () => {
    const result = normalizeUrl('https://api.example.com/search?z=1&a=2&m=3');
    expect(result.normalizedUrl).toBe('https://api.example.com/search?a=2&m=3&z=1');
  });

  it('should replace numeric path segments with :id', () => {
    const result = normalizeUrl('https://api.example.com/v1/users/12345/profile');
    expect(result.normalizedPath).toBe('/v1/users/:id/profile');
  });

  it('should replace UUID path segments with :id', () => {
    const result = normalizeUrl('https://api.example.com/posts/550e8400-e29b-41d4-a716-446655440000');
    expect(result.normalizedPath).toBe('/posts/:id');
  });

  it('should replace long hex path segments with :id', () => {
    const result = normalizeUrl('https://api.example.com/files/3f0bdcee80abed4452f95daf4043a09e761cc44aca092bdf73a20ef6042a83d4');
    expect(result.normalizedPath).toBe('/files/:id');
  });

  it('should preserve common path segments', () => {
    const result = normalizeUrl('https://api.example.com/v2/search/users');
    expect(result.normalizedPath).toBe('/v2/search/users');
  });

  it('should handle combined normalization (fragment + query + IDs)', () => {
    const result = normalizeUrl('https://api.example.com/v1/users/123/posts/456?sort=desc&page=1#comments');
    expect(result.normalizedUrl).toBe('https://api.example.com/v1/users/:id/posts/:id?page=1&sort=desc');
    expect(result.normalizedPath).toBe('/v1/users/:id/posts/:id');
  });

  it('should handle invalid URLs gracefully', () => {
    const result = normalizeUrl('not a url');
    expect(result.normalizedUrl).toBe('not a url');
    expect(result.normalizedPath).toBe('not a url');
  });
});

describe('endpointKey', () => {
  it('should format endpoint key correctly', () => {
    const key = endpointKey('GET', '/api/v1/users/:id');
    expect(key).toBe('GET /api/v1/users/:id');
  });

  it('should uppercase HTTP method', () => {
    const key = endpointKey('post', '/api/v1/users');
    expect(key).toBe('POST /api/v1/users');
  });

  it('should handle mixed case method', () => {
    const key = endpointKey('DeLeTe', '/api/v1/users/:id');
    expect(key).toBe('DELETE /api/v1/users/:id');
  });
});
