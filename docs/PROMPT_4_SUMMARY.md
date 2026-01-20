# Implementation Summary: Prompt 4 (Normalization & Features)

## Completed ✅

### Core Modules
- ✅ Created [src/normalize.ts](../src/normalize.ts) - URL normalization and endpoint key generation
  - `normalizeUrl()` - Strips fragments, sorts query params, replaces ID segments with `:id`
  - `endpointKey()` - Generates stable keys like `"GET /api/v1/users/:id"`
  - ID pattern detection: numeric, UUID, hex32+, long alphanumeric
  - Preserves common segments: api, v1, search, users, etc.

- ✅ Created [src/features.ts](../src/features.ts) - Bounded, shallow JSON feature extraction
  - Type detection: `isArray`, `isObject`, `isPrimitive`
  - Size metrics: `arrayLength`, `numKeys`, `topLevelKeys` (first 20, sorted)
  - Depth estimation: capped at `maxDepth=3` with circular reference protection
  - Data-likeness flags: `hasId`, `hasItems`, `hasResults`, `hasData`
  - Sample paths: extracted with depth/count limits
  - Schema hash: SHA256 of sorted top-level keys for stability tracking
  - Timeout protection: returns partial features after 100ms

- ✅ Extended [src/types.ts](../src/types.ts) - Added normalized fields to `CaptureRecord`
  - `normalizedUrl?: string` - Normalized URL
  - `normalizedPath?: string` - Path with IDs replaced
  - `endpointKey?: string` - Stable endpoint identifier
  - `features?: Features` - Shallow JSON structure features

### Integration
- ✅ Updated [src/monitor.ts](../src/monitor.ts) - Integrated normalization and features
  - Calls normalization after successful JSON parse
  - Extracts features from parsed body (single parse, reused)
  - Attaches normalized fields to capture records
  - Gracefully handles extraction failures
  - **Deduplication**: Tracks `(endpointKey|status|bodyHash)` tuples
  - Skips duplicate saves and logs stats: `"Captured X responses (Y duplicates skipped)"`

### Testing
- ✅ Created [tests/normalize.test.ts](../tests/normalize.test.ts) - URL normalization tests (11 tests)
  - Fragment removal
  - Query parameter sorting
  - ID replacement (numeric, UUID, hex, long alphanumeric)
  - Common segment preservation
  - Combined normalization
  - Invalid URL handling
  - Endpoint key formatting

- ✅ Created [tests/features.test.ts](../tests/features.test.ts) - Feature extraction tests (21 tests)
  - Type detection (arrays, objects, primitives)
  - Object features (keys, schema hash)
  - Data-likeness flags (id, items, results, data)
  - Depth estimation (flat, nested, capped)
  - Sample path extraction
  - Bounds and safety (empty, circular references)

- ✅ Created [tests/dedupe.test.ts](../tests/dedupe.test.ts) - Deduplication tests (8 tests)
  - Body hash consistency
  - Deduplication key format
  - Distinct status/hash handling
  - URL fallback for missing endpoint keys
  - Empty body hash handling

## Implementation Details

### URL Normalization Strategy

**Applied transformations:**
1. Strip URL fragments (`#section`)
2. Sort query parameters alphabetically (deterministic)
3. Replace path segments matching ID patterns:
   - Pure numeric: `/users/12345/profile` → `/users/:id/profile`
   - UUID format: `/posts/550e8400-...` → `/posts/:id`
   - Long hex (32+ chars): `/files/3f0bdcee...` → `/files/:id`
   - Long alphanumeric (20+ chars): likely encoded IDs → `:id`

**Preserved segments:**
- Common API terms: `api`, `v1`-`v4`, `search`, `query`, `list`, etc.
- Resource plurals: `users`, `posts`, `items`, `products`, `orders`
- Auth endpoints: `auth`, `login`, `logout`, `register`

**Redact-then-normalize workflow:**
- `redactUrl()` removes sensitive params first (token, key, auth, session)
- Then normalization sorts remaining params and replaces IDs
- Ensures normalized URLs don't leak redacted values

### Feature Extraction Strategy

**Bounded computation:**
- Max depth: 3 levels (configurable)
- Max keys sampled: 50 per object (configurable)
- Max sample paths: 100 (configurable)
- Top-level keys: first 20 (sorted alphabetically)
- Timeout: 100ms (returns partial features)

**Circular reference handling:**
- Tracks visited objects via `Set`
- Prevents infinite loops
- Gracefully handles self-referential structures

**Schema stability tracking:**
- Computes SHA256 hash of sorted top-level keys
- Identical key sets → same hash (regardless of values)
- Enables "distinct schema count" metric in future aggregation

### Deduplication Logic

**Deduplication key format:**
```
{endpointKey}|{status}|{bodyHash}
```

**Example:**
```
GET /api/v1/users/:id|200|3f0bdcee80abed4452f95daf4043a09e
```

**Behavior:**
- In-memory `Set<string>` tracks seen captures per run
- Before saving, checks if key exists in set
- If duplicate: skip save, increment `duplicateCount`, return `'duplicate'`
- If unique: add to set, save record, return `'captured'`
- Logs final stats: `"Captured X responses (Y duplicates skipped)"`

**Edge cases:**
- No endpoint key: falls back to full URL
- No body: uses empty string for hash portion
- Different status or hash → treated as distinct

## Test Results

```
✓ tests/normalize.test.ts (11 tests)
✓ tests/features.test.ts (21 tests)
✓ tests/dedupe.test.ts (8 tests)
✓ tests/redact.test.ts (11 tests)
✓ tests/store.test.ts (5 tests)
✓ tests/emptyBody.test.ts (5 tests)
✓ tests/interstitial.test.ts (13 tests)
✓ tests/storageState.test.ts (9 tests)

Total: 83 tests passing
```

## Build & Execution

```bash
npm run build  # ✅ TypeScript compilation successful
npm test       # ✅ All 83 tests passing
```

## Output Format Changes

**Updated `index.jsonl` records now include:**
```jsonlines
{
  "timestamp": "2026-01-19T23:45:00.000Z",
  "url": "https://api.example.com/v1/users/12345",
  "status": 200,
  "method": "GET",
  "normalizedUrl": "https://api.example.com/v1/users/:id",
  "normalizedPath": "/v1/users/:id",
  "endpointKey": "GET /v1/users/:id",
  "features": {
    "isArray": false,
    "isObject": true,
    "isPrimitive": false,
    "numKeys": 5,
    "topLevelKeys": ["email", "id", "name", "profile", "role"],
    "depthEstimate": 2,
    "hasId": true,
    "hasItems": false,
    "hasResults": false,
    "hasData": false,
    "samplePaths": ["id", "name", "email", "profile.bio", "profile.avatar"],
    "schemaHash": "a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2"
  },
  "bodyHash": "3f0bdcee80abed4452f95daf4043a09e761cc44aca092bdf73a20ef6042a83d4",
  ...
}
```

## Files Added/Modified

### Added (6 files)
- `src/normalize.ts` - URL normalization and endpoint key generation
- `src/features.ts` - Feature extraction utilities
- `tests/normalize.test.ts` - Normalization tests
- `tests/features.test.ts` - Feature extraction tests
- `tests/dedupe.test.ts` - Deduplication tests
- `docs/PROMPT_4_SUMMARY.md` - This file

### Modified (2 files)
- `src/types.ts` - Extended `CaptureRecord` with normalized fields and `Features` type
- `src/monitor.ts` - Integrated normalization, features, and deduplication

## Architecture Decisions

1. **Conservative ID detection:** Only replaces segments matching clear ID patterns (numeric, UUID, long hex/alphanumeric) to avoid false positives
2. **Redact-then-normalize:** Apply redaction first to prevent leaking sensitive params in normalized URLs
3. **Schema hashing:** Hash of sorted keys enables efficient schema change detection for future analysis
4. **Timeout protection:** 100ms timeout prevents feature extraction from blocking on complex/circular structures
5. **Per-run deduplication:** Simpler than cross-run deduplication, sufficient for 95% of use cases
6. **Endpoint key as primary:** Uses normalized endpoint key instead of raw URL for stable grouping

## Known Limitations

1. **ID detection heuristics:** May miss uncommon ID formats (e.g., short base64 tokens); can be extended via config
2. **Per-run deduplication only:** Duplicates across runs are not detected (future: load previous `index.jsonl`)
3. **Feature timeout:** Complex nested structures may return partial features after 100ms (acceptable tradeoff)
4. **No cross-field feature correlation:** Features are computed independently (future: detect relationships)

## Next Steps (Not in Prompt 4 Scope)

### Prompt 7: Endpoint Aggregation & Scoring
- Aggregate captures by `endpointKey`
- Compute frequency, status distribution, avg/max payload size
- Track distinct schema hashes per endpoint
- Heuristic scoring (0..1) based on:
  - Frequency (more captures = higher score)
  - Payload size (larger = more likely data endpoint)
  - Array/object structure (arrays of objects = high score)
  - Data-likeness flags (hasItems, hasResults = higher score)
  - Schema stability (fewer distinct hashes = higher score)
- Generate `summary.json`, `endpoints.jsonl`, `endpoints.csv`
- Terminal output: top 10 endpoints with reasons

### Prompt 8: Performance Controls
- Concurrency limiter for body reads (configurable max parallel)
- Memory monitoring and adaptive throttling
- Progress indicators for long captures

### Prompt 10: Validation & Examples
- Comprehensive edge case tests
- Example flows for common sites
- Integration tests with real browsers

---

**Status:** Prompt 4 fully implemented, tested (83 tests passing), and built successfully. Ready for Prompt 7 (aggregation & scoring).
