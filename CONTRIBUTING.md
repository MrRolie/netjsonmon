# Contributing to netjsonmon

Thanks for contributing.

## Prerequisites

- Node.js 20+
- npm

## Local Setup

```bash
npm install
npm run build
npm test
```

Optional global link for local CLI testing:

```bash
npm link
```

## Development Workflow

1. Create a feature branch from `main`.
2. Make focused changes.
3. Run checks locally:
   - `npm run build`
   - `npm test`
   - `npm pack --dry-run`
4. Open a pull request to `main`.

## Commit Guidance

- Use clear, imperative commit messages.
- Keep commits small and reviewable.
- Include docs updates when behavior changes.

## Pull Request Expectations

- Explain what changed and why.
- Link related issues when relevant.
- Add or update tests for behavior changes.
- Keep CI green.

## Branching and Releases

- `main` is the release branch.
- Releases follow SemVer and are published manually:
  - `npm version patch|minor|major`
  - push tags
  - publish to npm
