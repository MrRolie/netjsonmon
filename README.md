# netjsonmon

A CLI tool to monitor and capture JSON network responses during browser sessions using Playwright.

## Features

- **Deterministic capture window**: Navigate to a URL, wait for network idle, optionally run a custom flow, and capture responses for a fixed duration
- **Smart JSON detection**: Captures XHR/fetch by default, with overrides for JSON content-type headers
- **Safe storage**: Hybrid body storage (inline ≤16KB, externalized ≤1MB), with redaction of sensitive headers, URLs, and JSON keys
- **Configurable limits**: Control body sizes, capture counts, timeouts, and filtering
- **Debug artifacts**: Optional HAR recording and Playwright traces

## Installation

```bash
npm install
npm run build
```

## Usage

Basic usage:

```bash
npm run dev -- https://api.example.com
```

With options:

```bash
npm run dev -- https://example.com \
  --monitorMs 15000 \
  --timeoutMs 60000 \
  --outDir ./my-captures \
  --includeRegex "api\.example\.com" \
  --maxBodyBytes 2097152 \
  --captureAllJson \
  --autoConsent yahoo \
  --saveHar
```

### Options

- `<url>` - URL to monitor (required)
- `--headless` - Run browser in headless mode (default: true)
- `--monitorMs <ms>` - Capture window duration (default: 10000)
- `--timeoutMs <ms>` - Overall timeout (default: 30000)
- `--outDir <dir>` - Output directory (default: ./captures)
- `--includeRegex <pattern>` - Only capture URLs matching this regex
- `--excludeRegex <pattern>` - Exclude URLs matching this regex
- `--maxBodyBytes <bytes>` - Maximum body size to capture (default: 1048576 = 1MB)
- `--inlineBodyBytes <bytes>` - Inline bodies smaller than this (default: 16384 = 16KB)
- `--maxCaptures <count>` - Maximum captures (default: 0 = unlimited)
- `--captureAllJson` - Capture JSON from all resource types (default: false)
- `--flow <path>` - Path to custom flow module
- `--saveHar` - Save HAR file for debugging (default: false)
- `--userAgent <string>` - Custom user agent
- `--autoConsent <mode>` - Auto-handle consent pages: `yahoo`, `generic`, or `false` (default: false)
- `--storageState <path>` - Load browser storage state (cookies, localStorage) from file
- `--saveStorageState` - Save browser storage state after flow (default: false)

## Handling Consent Pages

Many sites show privacy/consent interstitials before the main content. netjsonmon provides several ways to handle these:

### Option 1: Auto-consent (Recommended for Yahoo sites)

Use `--autoConsent` to automatically dismiss consent pages:

```bash
# Auto-handle Yahoo consent (clicks "Reject all")
npm run dev -- https://ca.finance.yahoo.com/quote/AAPL --autoConsent yahoo

# Use generic consent handler for other sites
npm run dev -- https://example.com --autoConsent generic
```

**Default action:** Rejects consent (clicks "Reject all" / "Decline") for better repeatability. Falls back to accepting if reject button not found.

### Option 2: Custom Flow

Create a flow specifically for your site's consent UI:

```bash
npm run dev -- https://ca.finance.yahoo.com/quote/AAPL --flow ./examples/flows/yahooConsent.ts
```

### Option 3: Storage State (For Persistent Sessions)

Save your consent choice once and reuse it:

```bash
# First run: handle consent and save state
npm run dev -- https://example.com --autoConsent yahoo --saveStorageState

# Subsequent runs: load saved state (skips consent)
npm run dev -- https://example.com --storageState ./captures/<runId>/storageState.json
```

**Security note:** Storage state files contain cookies and may include session tokens. Keep them secure and don't commit to version control.

## Custom Flows

Create a custom flow to interact with the page:

```typescript
// flows/login.ts
export default async (page) => {
  await page.click('#login-button');
  await page.fill('#username', 'test@example.com');
  await page.fill('#password', 'password');
  await page.click('#submit');
  await page.waitForSelector('#dashboard');
};
```

Run with:

```bash
npm run dev -- https://example.com --flow ./flows/login.ts
```

## Output Structure

```
captures/
  <timestamp>-<runId>/
    run.json           # Run metadata
    index.jsonl        # One JSON record per capture
    bodies/
      <hash>.json      # Externalized response bodies
    session.har        # Optional HAR file
```

### Capture Record Schema

Each line in `index.jsonl` contains:

```json
{
  "timestamp": "2026-01-19T23:00:00.000Z",
  "url": "https://api.example.com/data",
  "status": 200,
  "method": "GET",
  "requestHeaders": { "accept": "application/json" },
  "responseHeaders": { "content-type": "application/json" },
  "contentType": "application/json",
  "payloadSize": 1024,
  "bodyAvailable": true,
  "truncated": false,
  "bodyHash": "abc123...",
  "jsonParseSuccess": true,
  "inlineBody": { "id": 123 }
}
```

## Development

```bash
# Run in dev mode
npm run dev -- <url>

# Build
npm run build

# Run tests
npm test

# Run built version
npm start -- <url>
```

## Testing

```bash
npm test
```

Tests cover:
- Redaction of sensitive headers, URLs, and JSON keys
- Hybrid storage (inline vs externalized bodies)
- Hash computation for deduplication
- Error handling for unavailable bodies

## License

ISC
