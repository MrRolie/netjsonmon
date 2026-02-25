# MCP Integration

`netjsonmon` exposes an MCP server over stdio so AI assistants can run capture jobs and inspect discovered APIs.

## Start the server

```bash
netjsonmon mcp
```

The command keeps running and communicates over stdin/stdout using JSON-RPC (MCP).

## Tools exposed

1. `run_monitor`
- Inputs: `url`, optional `monitorMs`, `flow`, `stealth`, `proxy`, `storageState`, `outDir`
- Output: JSON containing `captureDir`

2. `get_top_endpoints`
- Inputs: `captureDir`, optional `topN`
- Output: top scored endpoints with counts, sizes, key paths, and scoring reasons

3. `get_endpoint_schema`
- Inputs: `captureDir`, `endpointKey`
- Output: schema details, status distribution, and inline sample body when available

## Runtime requirements

`run_monitor` launches a real Playwright browser to observe SPA/API traffic. The host machine must have:

1. Playwright Chromium installed:
```bash
npx playwright install chromium
```
2. A writable capture directory.
  - If `outDir` is not passed, MCP defaults to `<user-home>/captures`.
3. JavaScript-enabled browser execution (required for modern SPAs).

For paywalled/authenticated sites, pass a flow script via `flow` to automate login/navigation before capture.

## Claude Desktop configuration

Add an entry to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "netjsonmon": {
      "command": "npx",
      "args": ["netjsonmon", "mcp"]
    }
  }
}
```

If `netjsonmon` is not globally available, use the repo path:

```json
{
  "mcpServers": {
    "netjsonmon": {
      "command": "node",
      "args": ["dist/index.js", "mcp"],
      "cwd": "C:/path/to/netjsonmon"
    }
  }
}
```

## Cursor configuration

In Cursor MCP settings, add:

```json
{
  "mcpServers": {
    "netjsonmon": {
      "command": "npx",
      "args": ["netjsonmon", "mcp"]
    }
  }
}
```

## Typical workflow for an agent

1. Call `run_monitor` on a target URL.
2. Pass returned `captureDir` into `get_top_endpoints`.
3. Pick an `endpointKey`, then call `get_endpoint_schema`.

Example call pattern:

```json
{
  "url": "https://www.msci.com/data-and-analytics/sustainability-solutions/esg-ratings-climate-search-tool",
  "monitorMs": 20000,
  "stealth": true,
  "outDir": "C:/Users/<you>/captures"
}
```
