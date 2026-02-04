# Training Captures

Place capture run folders here to share labeled data with collaborators.

Expected structure (same as a normal capture):

training-captures/
  <timestamp>-<runId>/
    run.json
    index.jsonl
    endpoints.jsonl
    labels/
      labels.jsonl
      training.jsonl (optional)

Use the CLI to label and export:

  netjsonmon label ./training-captures
  netjsonmon label ./training-captures --export

Auto-label endpoints without bodies (marks them as non-data):

  # For a specific run
  netjsonmon label ./training-captures/2026-02-04_macrotrends-oats --autoNonDataNoBody --autoOnly

  # Or select runs interactively
  netjsonmon label ./training-captures --autoNonDataNoBody --autoOnly
