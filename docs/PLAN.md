Below is a **clean, single-pass, non-duplicated spec**.
Prompts are numbered once, responsibilities are clear, and phases build without overlap.

This is the version you should actually execute against an agent.

---

# netjsonmon — Unified Build Spec

## Target outcome

Build a CLI tool that:

1. accepts a URL
2. launches Playwright (Chromium)
3. captures network responses during a deterministic window
4. keeps only responses whose bodies are valid JSON (by header and/or parse success)
5. safely persists JSON payloads + metadata to disk (and optionally a DB)
6. aggregates responses into endpoint-level intelligence and surfaces likely “data endpoints”

---

## Hard constraints

* **JSON detection:** do not rely on resource type alone; use `content-type` + parse success
* **Safety:** redact credentials, secrets, and common PII before writing
* **Determinism:** define a strict monitor window (network idle + fixed tail, or post-flow)
* **Performance:** gate expensive body reads; cap sizes; limit concurrency
* **Explainability:** all scoring must be reproducible and auditable

---

## Capture strategy

**Hybrid approach**

* Primary capture: `page.on("response")` → explicit JSON extraction
* Optional artifacts:

  * HAR (`recordHar`) for replay/debug
  * Playwright trace for navigation context

HAR is **not** the source of truth for bodies.

---

# PROMPTED BUILD PLAN

## Prompt 1 — Scaffold the project

**Goal:** initialize a production-grade CLI repo.

**Deliverables**

* `package.json` (`dev`, `build`, `start`)
* `src/index.ts` (CLI entry)
* `src/monitor.ts` (orchestrator)
* `captures/<timestamp>/` output structure
* minimal README with usage

**Tech**

* Node 20+, TypeScript, Playwright
* `yargs` or `commander`
* optional: `pino`, `zod`

**CLI**

```bash
netjsonmon <url>
  [--headless]
  [--monitorMs]
  [--outDir]
  [--includeRegex]
  [--excludeRegex]
  [--maxBodyBytes]
  [--maxCaptures]
  [--captureAllJson]
  [--flow ./flows/example.ts]
  [--saveHar]
```

---

## Prompt 2 — Deterministic navigation + monitor window

**Goal:** avoid missing calls or waiting forever.

**Behavior**

1. `page.goto(url, { waitUntil: "domcontentloaded" })`
2. wait for `networkidle` (bounded)
3. begin capture window
4. optionally run a user-provided flow
5. continue capturing for `monitorMs`
6. stop intake, flush queues, persist output

**Deliverables**

* `src/flowRunner.ts`
* `monitorMs` + `flow` support in CLI

---

## Prompt 3 — Network JSON capture

**Goal:** capture only meaningful JSON responses safely.

**Response handling rules**

* Gate early by:

  * include/exclude URL regex
  * status code
  * content-type header
  * content-length (if present)
* Default: consider `xhr` + `fetch`
* If `--captureAllJson`: consider all resource types
* Attempt JSON parse with:

  * size limit
  * timeout
* If body unavailable (opaque/CORS): store metadata only

**Per-capture record**

* timestamp
* url
* status
* method
* request headers (redacted)
* response headers (redacted)
* content-type
* payload byte size
* JSON body (inline or externalized)
* `bodyHash`
* `etag` (if present)

**Deliverables**

* core capture loop in `monitor.ts`

---

## Prompt 4 — Normalization, signatures, and feature extraction

**Goal:** make responses groupable and analyzable.

**Compute per capture**

* `normalizedUrl`

  * strip fragments
  * sort query params
  * replace obvious IDs with `:id`
* `endpointKey`

  * `METHOD + normalizedPath`
* lightweight feature skeleton (shallow, bounded):

  * `isArray`
  * `topLevelKeys` (first N)
  * `numKeys`
  * `arrayLength` (if array)
  * `depthEstimate`
  * flags: `hasId`, `hasItems`, `hasResults`, `hasData`
  * `payloadSize`

**Deduplication**

* primary: `(endpointKey, status, bodyHash)`
* fallback: `(endpointKey, status, etag)`

**Deliverables**

* `src/normalize.ts`
* feature extraction utilities

---

## Prompt 5 — Redaction & safety layer

**Goal:** ensure nothing sensitive hits disk.

**Redact**

* headers: `authorization`, `cookie`, `set-cookie`, `x-api-key`
* URL params: `token`, `key`, `auth`, `session`, `sig`
* JSON body keys (configurable): `password`, `token`, `secret`, `email`

**Deliverables**

* `src/redact.ts`

  * `redactHeaders`
  * `redactUrl`
  * `redactJson`
* unit tests

---

## Prompt 6 — Storage format

**Goal:** streamable, debuggable, ML-ready output.

**Files**

* `index.jsonl`

  * one object per capture (metadata + features + body path)
* `bodies/<hash>.json`

  * full bodies when externalized
* `summary.json`

  * populated incrementally (see next prompt)

**Deliverables**

* `src/store.ts`

---

## Prompt 7 — Endpoint aggregation & heuristic scoring

**Goal:** surface likely “data endpoints” immediately.

**Aggregate by `endpointKey`**

* count
* status distribution
* hosts seen
* avg / max payload size
* distinct schema hashes
* sampled key paths
* firstSeen / lastSeen

**Heuristic score**

* deterministic 0..1
* based on:

  * frequency
  * payload size
  * array/object structure
  * data-likeness flags
  * schema stability
* store `reasons[]` explaining score

**Outputs**

* `summary.json`
* `endpoints.jsonl`
* optional `endpoints.csv`
* terminal summary (top 10 endpoints + reasons)

**Deliverables**

* `src/summary.ts`
* `src/score.ts`

---

## Prompt 8 — Performance controls

**Goal:** prevent memory or CPU blowups.

**Controls**

* `--maxBodyBytes`
* `--maxCaptures`
* concurrency limiter for body reads
* truncate + mark oversized payloads

**Deliverables**

* `src/queue.ts`

---

## Prompt 9 — Optional artifacts (HAR + trace)

**Goal:** debugging and replay.

**Options**

* Playwright trace (`trace.zip`)
* HAR (`session.har`) if `--saveHar`

**Deliverables**

* artifact wiring in `monitor.ts`

---

## Prompt 10 — Validation & examples

**Goal:** confirm correctness and edge cases.

**Test scenarios**

* JSON with correct content-type
* JSON with `text/plain`
* non-JSON XHR
* large payload truncation
* redirects / 204
* opaque responses

**Deliverables**

* `examples/`
* documented limitations

---

# EXTENSION PHASES

## Phase 1 — Labeling workflow

**Prompt 11**

* `labels/labels.jsonl`
* manual labeling via CLI
* export `training.jsonl` (features + label)

---

## Phase 2 — ML classifier (offline)

**Prompt 12**

* train on engineered features
* simple models (logistic / GBT)
* save model + feature schema

---

## Phase 3 — Online prediction

**Prompt 13**

* load model at runtime
* score endpoints
* rank by predicted `data` probability
* explain with top features + heuristic reasons

---

## End state

The tool:

* captures JSON safely and deterministically
* groups responses into stable endpoint identities
* surfaces endpoints that actually return data
* produces a clean dataset for ML when you’re ready

This spec is internally consistent and execution-ready.
