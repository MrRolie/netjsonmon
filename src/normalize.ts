/**
 * URL normalization and endpoint key generation
 * 
 * Normalizes URLs to create stable endpoint identities:
 * - Strips fragments (#section)
 * - Sorts query parameters alphabetically
 * - Replaces path segments matching ID patterns with :id placeholder
 * - Generates deterministic endpoint keys for grouping
 */

/**
 * Patterns that look like IDs in URL paths
 */
const ID_PATTERNS = [
  /^\d+$/,                                           // Pure numeric: 12345
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // UUID
  /^[0-9a-f]{32,}$/i,                               // Long hex (32+ chars, likely hash)
  /^[A-Za-z0-9_-]{20,}$/,                           // Long alphanumeric (likely encoded ID)
];

/**
 * Path segments that should NOT be replaced with :id
 */
const PRESERVE_SEGMENTS = new Set([
  'api', 'v1', 'v2', 'v3', 'v4',
  'search', 'query', 'list', 'create', 'update', 'delete',
  'users', 'posts', 'items', 'products', 'orders', 'comments',
  'auth', 'login', 'logout', 'register',
  'admin', 'public', 'private',
]);

/**
 * Check if a path segment looks like an ID
 */
function isIdSegment(segment: string): boolean {
  // Don't replace empty or preserved segments
  if (!segment || PRESERVE_SEGMENTS.has(segment.toLowerCase())) {
    return false;
  }

  // Check against ID patterns
  return ID_PATTERNS.some(pattern => pattern.test(segment));
}

/**
 * Normalize a URL path by replacing ID-like segments with :id
 */
function normalizePathSegments(path: string): string {
  const segments = path.split('/');
  const normalized = segments.map(segment => {
    if (isIdSegment(segment)) {
      return ':id';
    }
    return segment;
  });
  return normalized.join('/');
}

/**
 * Normalize a URL for stable endpoint identification
 * 
 * @param urlString - Full URL string (should be redacted first if needed)
 * @returns Object with normalizedUrl and normalizedPath
 */
export function normalizeUrl(urlString: string): { normalizedUrl: string; normalizedPath: string } {
  try {
    const url = new URL(urlString);
    
    // Strip fragment
    url.hash = '';
    
    // Sort query parameters alphabetically
    const params = Array.from(url.searchParams.entries())
      .sort(([a], [b]) => a.localeCompare(b));
    
    url.search = '';
    params.forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
    
    // Normalize path segments (replace IDs with :id)
    const normalizedPath = normalizePathSegments(url.pathname);
    
    // Build normalized URL
    const normalizedUrl = `${url.origin}${normalizedPath}${url.search}`;
    
    return {
      normalizedUrl,
      normalizedPath,
    };
  } catch (error) {
    // Invalid URL, return original
    return {
      normalizedUrl: urlString,
      normalizedPath: urlString,
    };
  }
}

/**
 * Generate a stable endpoint key from method and normalized path
 * 
 * @param method - HTTP method (GET, POST, etc.)
 * @param normalizedPath - Normalized path from normalizeUrl()
 * @returns Endpoint key in format "GET /api/v1/users/:id"
 */
export function endpointKey(method: string, normalizedPath: string): string {
  return `${method.toUpperCase()} ${normalizedPath}`;
}
