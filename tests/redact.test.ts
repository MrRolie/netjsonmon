import { describe, it, expect } from 'vitest';
import { redactHeaders, redactUrl, redactJson, redactError } from '../src/redact.js';

describe('redact', () => {
  describe('redactHeaders', () => {
    it('should redact sensitive headers', () => {
      const headers = {
        'authorization': 'Bearer token123',
        'cookie': 'session=abc',
        'content-type': 'application/json',
        'x-api-key': 'secret',
      };

      const result = redactHeaders(headers);

      expect(result['authorization']).toBe('[REDACTED]');
      expect(result['cookie']).toBe('[REDACTED]');
      expect(result['x-api-key']).toBe('[REDACTED]');
      expect(result['content-type']).toBe('application/json');
    });

    it('should handle case-insensitive header names', () => {
      const headers = {
        'Authorization': 'Bearer token123',
        'Cookie': 'session=abc',
      };

      const result = redactHeaders(headers);

      expect(result['Authorization']).toBe('[REDACTED]');
      expect(result['Cookie']).toBe('[REDACTED]');
    });
  });

  describe('redactUrl', () => {
    it('should redact sensitive URL parameters', () => {
      const url = 'https://api.example.com/data?id=123&token=secret&key=abc';
      const result = redactUrl(url);

      expect(result).toContain('id=123');
      expect(result).toContain('token=%5BREDACTED%5D'); // URL encoded [REDACTED]
      expect(result).toContain('key=%5BREDACTED%5D'); // URL encoded [REDACTED]
      expect(result).not.toContain('secret');
    });

    it('should handle URLs without query params', () => {
      const url = 'https://api.example.com/data';
      const result = redactUrl(url);

      expect(result).toBe(url);
    });

    it('should handle invalid URLs gracefully', () => {
      const url = 'not-a-url';
      const result = redactUrl(url);

      expect(result).toBe(url);
    });
  });

  describe('redactJson', () => {
    it('should redact sensitive JSON keys', () => {
      const obj = {
        id: 123,
        password: 'secret',
        token: 'abc123',
        email: 'user@example.com',
        data: {
          value: 'public',
        },
      };

      const result = redactJson(obj);

      expect(result.id).toBe(123);
      expect(result.password).toBe('[REDACTED]');
      expect(result.token).toBe('[REDACTED]');
      expect(result.email).toBe('[REDACTED]');
      expect(result.data.value).toBe('public');
    });

    it('should handle arrays', () => {
      const arr = [
        { id: 1, password: 'secret' },
        { id: 2, token: 'abc' },
      ];

      const result = redactJson(arr);

      expect(result[0].id).toBe(1);
      expect(result[0].password).toBe('[REDACTED]');
      expect(result[1].token).toBe('[REDACTED]');
    });

    it('should handle nested objects', () => {
      const obj = {
        user: {
          name: 'John',
          secret: 'hidden',
        },
      };

      const result = redactJson(obj);

      expect(result.user.name).toBe('John');
      expect(result.user.secret).toBe('[REDACTED]');
    });
  });

  describe('redactError', () => {
    it('should truncate long error messages', () => {
      const longError = new Error('a'.repeat(300));
      const result = redactError(longError);

      expect(result.length).toBeLessThanOrEqual(200);
    });

    it('should redact file paths', () => {
      const error = new Error('Error at C:\\Users\\test\\file.js');
      const result = redactError(error);

      expect(result).toContain('[PATH]');
      expect(result).not.toContain('C:\\Users');
    });

    it('should handle string errors', () => {
      const result = redactError('Simple error message');

      expect(result).toBe('Simple error message');
    });
  });
});
