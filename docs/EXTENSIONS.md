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

---

## Extension ideas — modeling + keyword guidance

### Model options (low → higher complexity)

1) **TF-IDF + logistic regression**
   * Strong baseline for text classification; fast to train and explain.
   * Features: response body, headers, status code, endpoint path tokens.
2) **fastText / linear n-grams**
   * Great for short text and small data; cheap to retrain.
3) **Embedding + linear head**
   * Use sentence embeddings (e.g. MiniLM) and train a small linear classifier.
   * Better at capturing semantic similarity for sparse labels.

### Optional CLI keywords as model features

Let users pass `--keywords finance,invoice,banking` and add two feature sets:

1) **Exact/near match features**
   * Count keyword hits in response text, headers, and path tokens.
   * Add normalized hit rates (hits / length).
2) **Semantic proximity features**
   * Expand each keyword to a related-word list (see below), then count hits.
   * Or compute cosine similarity between response embedding and keyword embeddings.

### Keyword expansion (related words)

Pick one of:

1) **Static domain lexicons**
   * Curate small lists per domain (finance, health, auth) in a JSON file.
   * Pros: deterministic, no dependency; cons: needs maintenance.
2) **Word vector expansion**
   * Pretrain word vectors and fetch top-N neighbors for each keyword.
   * Cache expansions so runtime stays fast.
3) **Embedding similarity**
   * Encode response text and keyword phrases; use similarity thresholds.
   * Most flexible, but needs a sentence-embedding model available.

### Suggested default path

* Start with TF-IDF + logistic regression + exact keyword match features.
* Add static lexicon expansion first (simple JSON).
* Upgrade to embeddings later if accuracy is insufficient.
