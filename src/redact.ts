/**
 * Redaction utilities for sensitive data
 */

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'api-key',
]);

const SENSITIVE_URL_PARAMS = new Set([
  'token',
  'key',
  'auth',
  'session',
  'sig',
  'signature',
  'apikey',
  'api_key',
]);

const SENSITIVE_JSON_KEYS = new Set([
  'password',
  'token',
  'secret',
  'email',
  'apiKey',
  'api_key',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
]);

const REDACTED = '[REDACTED]';

/**
 * Redact sensitive headers
 */
export function redactHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_HEADERS.has(lowerKey)) {
      redacted[key] = REDACTED;
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

/**
 * Redact sensitive URL parameters
 */
export function redactUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const params = urlObj.searchParams;
    let modified = false;

    for (const key of params.keys()) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_URL_PARAMS.has(lowerKey)) {
        params.set(key, REDACTED);
        modified = true;
      }
    }

    return modified ? urlObj.toString() : url;
  } catch {
    return url;
  }
}

/**
 * Redact sensitive keys in JSON objects (shallow)
 */
export function redactJson(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(redactJson);
  }

  const redacted: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_JSON_KEYS.has(key)) {
      redacted[key] = REDACTED;
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactJson(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

/**
 * Redact or truncate error messages
 */
export function redactError(error: Error | string): string {
  const msg = typeof error === 'string' ? error : error.message;
  // Truncate long error messages and remove potential sensitive paths
  const truncated = msg.substring(0, 200);
  // Remove file paths that might contain user info
  return truncated.replace(/([A-Z]:\\|\/home\/|\/Users\/).+?(?=\s|$)/g, '[PATH]');
}
