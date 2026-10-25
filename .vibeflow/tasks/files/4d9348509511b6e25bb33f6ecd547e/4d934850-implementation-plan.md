# Unblock the release path - implementation plan
Ticket: 4d9348509511b6e25bb33f6ecd547e | Parent: Initial testing (d8f35c7cd6eea8d8dfb9ed5da58759)
## Goal
Make scripts/release.mjs able to cut a release by adding a versioned CHANGELOG section with non-empty notes.
## Non-goals (explicit)
No version bump beyond what changesets produce; no new release features; no CI.
## Current state (what exists today, what throws, with file:line)
CHANGELOG.md is a single "# Changelog" heading, so extractReleaseNotes throws "no CHANGELOG section for version 0.1.0". tests/guards/release.test.ts proves this (exit 1). .changeset/config.json exists; package.json version 0.1.0.
## Steps (ordered and concrete, naming exact files, exports and commands)
1. Run pnpm changeset to create a pending changeset describing current user-visible state, or manually add "## 0.1.0" section to CHANGELOG.md with non-empty notes.
2. Run pnpm changeset version to consume changeset and populate CHANGELOG.md.
3. Verify `node scripts/release.mjs --print-notes --version 0.1.0` prints non-empty notes and exits 0.
4. Update tests/guards/release.test.ts if the expected shape changes; keep red proof that empty/missing section fails.
## Files touched (new / modified)
Modified: CHANGELOG.md. Possibly .changeset/*.md and package.json version. Possibly tests/guards/release.test.ts.
## ADR obligations (pointer + pin, or "none" and why)
None: release script and changelog are not governed by an ADR.
## Test plan (each new test, which existing it.todo or guard it replaces, and the red proof: what fails without this change)
Existing release.test.ts already proves refusal on empty/missing section. Add/keep a positive test: with a populated "## 0.1.0" section, --print-notes exits 0 and output contains the heading. Red proof: revert CHANGELOG to single heading, positive test fails.
## Open decisions for the owner (never guess - list them instead)
Whether to bump version to 0.1.0 or a different initial version; whether to run changeset version or hand-edit CHANGELOG. gh auth status for actual release.
## Out of scope for this ticket
Actual GitHub release creation, tagging, deploy/.
