# ADR-0008: Owner-configured model picker
- Status: accepted · Date: 2026-10-27 · Decided by: owner
## Decision
The Telegram `/model` picker may use an optional root `caretaker.config.json` containing a `models` array of one to five unique-format `provider/id` strings, in display order. A valid non-empty list is a strict allowlist intersected with Pi's `getAvailableOfType("chat")` snapshot; absent, malformed, empty, or oversized configuration falls back to Pi's full available chat-model list. Pi exposes no stable popularity/recommendation API in the installed runtime.
## Consequence
This file is non-secret configuration only. Pi's available-model snapshot is provider-level and cannot detect per-model 403 entitlement; `setModel` success does not guarantee a model can serve a turn. Do not add a post-switch probe/revert. The existing truthful empty-turn notice remains the safety behavior. Callback indices refer to the exact displayed snapshot.
## Pins
- `src/model-picker.ts`
- `src/index.ts`
- `tests/model-picker.test.ts`
- `tests/index-relay.test.ts`
