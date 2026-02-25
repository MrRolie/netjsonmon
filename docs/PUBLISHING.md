# Publishing and Release Guide

This is the standard workflow for publishing `netjsonmon` updates to GitHub and npm.

## Change Type to Version Bump

| Change type | Typical examples | SemVer bump |
| --- | --- | --- |
| Patch | bug fix, docs fix, internal fix, safe refactor with no breaking behavior | `patch` |
| Minor | new backward-compatible flags/features | `minor` |
| Major | breaking CLI behavior/flags/output contract | `major` |
| Refactor only (no user impact) | code cleanup only | no publish required (or `patch` if you want a release record) |

## Prerequisites

```bash
npm whoami
npm run build
npm test
npm pack --dry-run
```

If `npm whoami` fails, run `npm login` first.

## Standard Release Flow

1. Commit your code changes.
```bash
git add .
git commit -m "your change summary"
```

2. Update local `main`.
```bash
git checkout main
git pull --rebase origin main
```

3. Apply the version bump and create git tag.
```bash
npm version patch
# or: npm version minor
# or: npm version major
```

4. Push commit + tags to GitHub.
```bash
git push origin main --follow-tags
```

5. Publish to npm.
```bash
npm publish
```

If 2FA is enabled:
```bash
npm publish --otp <code>
```

6. Verify published version.
```bash
npm view netjsonmon version
```

## If Main Is PR-Only

Use this sequence:

1. Open/merge PR with code changes (no version bump yet).
2. Pull latest `main`.
3. Run `npm version patch|minor|major`.
4. Push the version/tag using your protected-branch process.
5. Run `npm publish`.

## Suggested Commit Prefixes

- `fix:` for patch
- `feat:` for minor
- `refactor:` for internal-only changes
- `docs:` for docs-only changes

## Safety Notes

- `prepublishOnly` already runs build + tests.
- Keep `npm pack --dry-run` clean before publishing.
- Do not publish from a dirty working tree.
