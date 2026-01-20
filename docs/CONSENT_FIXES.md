# Consent & Interstitial Handling Implementation

## Summary

Implemented comprehensive fixes to handle consent/privacy pages and empty-body responses, addressing the issue where monitoring Yahoo Finance captured only consent telemetry instead of actual API responses.

## Problem Statement

When monitoring `https://ca.finance.yahoo.com/quote/AAPL`, the tool:
1. Landed on `consent.yahoo.com` interstitial
2. Captured only consent telemetry (204 POST to `udc.yahoo.com`)
3. Never reached the target host (finance.yahoo.com)
4. Generated parse errors for 204 responses: `"parseError":"Unexpected end of JSON input"`

## Implemented Fixes

### Fix 0: Empty Body Handling (204/304)

**Problem:** Tool attempted to parse empty-body responses (204, 304) as JSON, resulting in parse errors.

**Solution:**
- Added `'emptyBody'` to `OmittedReason` enum
- Early return in `handleResponse` for status 204/304
- Store metadata-only with `omittedReason='emptyBody'`

**Files changed:**
- [src/types.ts](src/types.ts) - Added `'emptyBody'` to enum
- [src/monitor.ts](src/monitor.ts) - Added early return before body read

**Tests:** [tests/emptyBody.test.ts](tests/emptyBody.test.ts) (5 tests)

---

### Fix 1: Interstitial-Aware Orchestration

**Problem:** Tool started monitoring immediately after navigation, before dismissing consent pages or reaching target host.

**Solution:**
- Created [src/interstitial.ts](src/interstitial.ts) with handlers for Yahoo and generic consent pages
- Added `--autoConsent <mode>` CLI flag (values: `yahoo`, `generic`, `false`)
- **Default action: Reject** (clicks "Reject all" / "Decline" buttons first)
- Updated orchestration flow:
  1. Navigate to URL
  2. If `--autoConsent` enabled, detect and handle interstitial
  3. Wait for target host before starting monitor window
  4. Then run bounded networkidle + monitorMs tail

**Files changed:**
- [src/interstitial.ts](src/interstitial.ts) - New module with handlers
- [src/types.ts](src/types.ts) - Added `autoConsent` field
- [src/monitor.ts](src/monitor.ts) - Updated orchestration flow
- [src/index.ts](src/index.ts) - Added CLI flag

**Handlers:**
- `yahooConsentHandler` - Detects `consent.yahoo.com`, clicks "Reject all" (fallback: "Accept all")
- `genericConsentHandler` - Detects URLs with `consent`/`privacy`/`cookie`, tries common reject selectors

**Tests:** [tests/interstitial.test.ts](tests/interstitial.test.ts) (13 tests)

---

### Fix 2: Example Flow for Yahoo Consent

**Problem:** Users need a reference implementation for handling site-specific consent.

**Solution:**
- Created [examples/flows/yahooConsent.ts](examples/flows/yahooConsent.ts)
- Demonstrates Playwright page interaction for consent dismissal
- Documented usage in README

**Usage:**
```bash
npm run dev -- https://ca.finance.yahoo.com/quote/AAPL --flow ./examples/flows/yahooConsent.ts
```

---

### Fix 3: Storage State Support

**Problem:** Repeated runs require dismissing consent each time; no way to persist logged-in sessions.

**Solution:**
- Added `--storageState <path>` to load saved browser state (cookies, localStorage)
- Added `--saveStorageState` to save state after flow execution
- State file saved to `<runDir>/storageState.json`

**Files changed:**
- [src/types.ts](src/types.ts) - Added `storageState`, `saveStorageState` fields
- [src/monitor.ts](src/monitor.ts) - Load state on context creation, save after flow
- [src/index.ts](src/index.ts) - Added CLI flags

**Usage:**
```bash
# First run: dismiss consent and save state
npm run dev -- https://example.com --autoConsent yahoo --saveStorageState

# Subsequent runs: load saved state
npm run dev -- https://example.com --storageState ./captures/<runId>/storageState.json
```

**Tests:** [tests/storageState.test.ts](tests/storageState.test.ts) (9 tests)

---

## New CLI Options

```
--autoConsent <mode>     Auto-handle consent pages: yahoo, generic, or false (default: false)
--storageState <path>    Load browser storage state from file
--saveStorageState       Save browser storage state after flow (default: false)
```

## Updated Orchestration Flow

**Before (broken for interstitials):**
```
goto → networkidle → monitorMs → close
```

**After (interstitial-aware):**
```
goto → [handle interstitial if autoConsent] → wait for target host → networkidle → monitorMs → close
```

## Test Results

```
✓ tests/emptyBody.test.ts (5 tests)
✓ tests/interstitial.test.ts (13 tests) 
✓ tests/storageState.test.ts (9 tests)
✓ tests/redact.test.ts (11 tests)
✓ tests/store.test.ts (5 tests)

Total: 43 tests passing
```

## Usage Examples

### Basic Yahoo monitoring with auto-consent:
```bash
npm run dev -- https://ca.finance.yahoo.com/quote/AAPL --autoConsent yahoo
```

### With custom flow:
```bash
npm run dev -- https://ca.finance.yahoo.com/quote/AAPL --flow ./examples/flows/yahooConsent.ts
```

### Persistent session (save and reuse):
```bash
# Save state after first run
npm run dev -- https://example.com --autoConsent yahoo --saveStorageState

# Reuse saved state
npm run dev -- https://example.com --storageState ./captures/<runId>/storageState.json
```

### Generic consent for other sites:
```bash
npm run dev -- https://example.com --autoConsent generic
```

## Expected Behavior Changes

### Before (Yahoo Finance example):
- Lands on `consent.yahoo.com`
- Captures only consent telemetry (204 responses with parse errors)
- Never reaches `finance.yahoo.com`
- Result: `index.jsonl` contains only consent traffic

### After (with `--autoConsent yahoo`):
- Lands on `consent.yahoo.com`
- Detects interstitial, clicks "Reject all"
- Waits for navigation to `finance.yahoo.com`
- Starts monitoring window only after reaching target host
- Result: `index.jsonl` contains actual API responses from finance.yahoo.com

## Security & Privacy Considerations

1. **Default action is Reject:** Safer for repeatability and privacy compliance
2. **Storage state contains sensitive data:** Files may include session tokens/cookies
   - Added warning in README
   - Recommend adding `storageState.json` to `.gitignore`
3. **Consent automation legal implications:** Users opt-in via `--autoConsent` flag

## Files Added (5)
- `src/interstitial.ts` - Interstitial detection and handling
- `examples/flows/yahooConsent.ts` - Yahoo consent flow example
- `tests/emptyBody.test.ts` - Tests for Fix 0
- `tests/interstitial.test.ts` - Tests for Fix 1
- `tests/storageState.test.ts` - Tests for Fix 3

## Files Modified (5)
- `src/types.ts` - Added `emptyBody`, `autoConsent`, storage state fields
- `src/monitor.ts` - Updated orchestration, added interstitial handling
- `src/index.ts` - Added CLI flags
- `README.md` - Documented new features
- `docs/CONSENT_FIXES.md` - This file

## Known Limitations & Future Work

1. **Site-specific selectors may break:** Consent UI changes frequently; example flows provided for reference
2. **Generic handler is best-effort:** May not work on all sites; recommend custom flows for critical workflows
3. **No CI E2E tests yet:** Integration tests planned for future (requires browser in CI)
4. **No rate limiting or retry logic:** If consent handler fails, monitor continues anyway

## Recommended Workflow

For production monitoring:
1. Test once with `--autoConsent yahoo` or custom flow
2. Save storage state with `--saveStorageState`
3. Reuse storage state for subsequent runs (faster, more reliable)
4. Periodically refresh storage state when sessions expire

---

**Status:** All fixes implemented, tested, and documented. Ready for production use.
