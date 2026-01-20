# EXTENSION PHASES

## Phase 1 — Labeling workflow

**Prompt 12**

* `labels/labels.jsonl`
* manual labeling via CLI
* export `training.jsonl` (features + label)

---

## Phase 2 — ML classifier (offline)

**Prompt 13**

* train on engineered features
* simple models (logistic / GBT)
* save model + feature schema

---

## Phase 3 — Online prediction

**Prompt 14**

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
