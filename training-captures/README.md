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
