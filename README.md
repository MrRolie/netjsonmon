# netjsonmon

[![ci](https://github.com/MrRolie/netjsonmon/actions/workflows/ci.yml/badge.svg)](https://github.com/MrRolie/netjsonmon/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/MrRolie/netjsonmon)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

`netjsonmon` is a CLI for discovering and ranking JSON API endpoints from real browser traffic.

It is built for developers and data engineers who need to inspect network APIs, persist captures, and quickly find useful data endpoints.

![netjsonmon welcome banner](docs/assets/welcome-banner.png)

## Install

Global install (recommended):

```bash
npm i -g netjsonmon
```

Local development install:

```bash
npm install
npm run build
npm link
```

## Quick Start

```bash
# 1) Capture JSON traffic
netjsonmon run https://example.com --outDir ./captures

# 2) Inspect a capture
netjsonmon inspect ./captures/<timestamp>-<runId>

# 3) List top endpoints
netjsonmon endpoints ./captures/<timestamp>-<runId> --limit 20
```

## Core Commands

| Command | Purpose |
| --- | --- |
| `netjsonmon run <url>` | Capture JSON responses from a browser session |
| `netjsonmon inspect <captureDir>` | Inspect summary and endpoint details for one capture |
| `netjsonmon endpoints <captureDir>` | Filter/sort/export discovered endpoints |
| `netjsonmon label [captureDir]` | Label endpoints and export training data |
| `netjsonmon train [captureDir]` | Train the endpoint classifier model |
| `netjsonmon mcp` | Start stdio MCP server for AI assistants |
| `netjsonmon init` | Generate starter config and flow example |

## Most Used Run Flags

- `--useSession <path>`: Load an existing authenticated session file.
- `--saveSession <path>`: Save session state after capture for reuse.
- `--storageState <path>`: Load Playwright storage state directly.
- `--watch`: Interactive live dashboard mode until browser close/Ctrl+C.
- `--stealth`: Enable anti-bot hardening using stealth tooling.
- `--proxy <url>`: Route traffic through one proxy.
- `--proxyList <file>`: Use a file of proxies (one per line).
- `--proxyAuth <user:pass>`: Override proxy credentials.
- `--flow <path>`: Run a custom flow script during capture.

## Documentation

- [Setup Guide](SETUP.md)
- [MCP Integration](docs/MCP_INTEGRATION.md)
- [ML Training Guide](docs/ML-TRAINING.md)
- [Publishing and Releases](docs/PUBLISHING.md)

## Development

```bash
npm run build
npm test
```

## License

MIT
