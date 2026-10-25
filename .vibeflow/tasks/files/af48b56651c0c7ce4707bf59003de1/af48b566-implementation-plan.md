# Queue and triage pipeline e2e suite - implementation plan
Ticket: af48b56651c0c7ce4707bf59003de1 | Parent: Initial testing (d8f35c7cd6eea8d8dfb9ed5da58759)

## Goal
Replace the seven `it.todo` placeholders in `tests/e2e/pipeline.e2e.test.ts` with real tests exercising the bounded queue (6a8e1458) and background triage turn (6e7eaef7) using the recording doubles in `tests/setup/doubles.ts`.

## Non-goals (explicit)
- No queue or triage implementation here; only tests.
- No persistence, dedupe, correlation, dashboards, or database (V1 non-goals).

## Current state (what exists today, what throws, with file:line)
- `tests/e2e/pipeline.e2e.test.ts:15-43` holds seven `it.todo` cases.
- `src/queue.ts` is interface + types only, no semantics (per caretaker-codebase skill).
- `src/events.ts` `handlePostEvents` throws `not implemented`.
- `tests/setup/doubles.ts` provides a recording Telegram adapter and stub triage model, pinned by `tests/testkit.test.ts`.

## Steps (ordered and concrete, naming exact files, exports and commands)
1. Wait for 6a8e1458 (bounded queue) and 6e7eaef7 (background triage turn) to land; confirm `EventQueue` semantics and triage entry exports.
2. Rewrite `tests/e2e/pipeline.e2e.test.ts`, replacing each todo with a real test that wires the queue, the triage boundary (`buildTriageRequest`), and the recording doubles.
3. Assert ordering under concurrent arrivals with a serialized runner; assert escape-hatch notify-once even when the model answers "ignore" (ADR-0004).
4. Assert hostile webhook text appears only in the data channel, instructions byte-identical (ADR-0002) via `tests/untrusted-payload.test.ts` pattern.
5. Assert silence on "not important" verdict is observable through the recording Telegram adapter.
6. Assert overflow rejection preserves earlier 202s and restart drops unprocessed events (documented loss).
7. Assert Telegram reply is answered in the same session with event context.
8. Run `pnpm test:e2e` then `pnpm check`.

## Files touched (new / modified)
- Modified: `tests/e2e/pipeline.e2e.test.ts` only.

## ADR obligations (pointer + pin, or "none" and why)
- none new. Tests pin ADR-0001 (queue capacity/loss), ADR-0002 (data channel), ADR-0003 (single Telegram path), ADR-0004 (escape hatch).

## Test plan (each new test, which existing it.todo it replaces, and the red proof: what fails without this change)
- Sequential delivery todo -> concurrent arrivals processed in order; red because queue has no semantics.
- Escape hatch todo -> must-notify event notifies exactly once even on "ignore"; red because triage turn absent.
- Data channel todo -> instructions byte-identical with hostile text; red because boundary unimplemented.
- Silence todo -> "not important" sends nothing; red because no triage verdict handling.
- Capacity todo -> overflow rejected, earlier 202s retained; red because no bounded queue.
- Restart todo -> unprocessed events dropped; red because no in-memory queue behavior to observe.
- Reply context todo -> Telegram reply answered with event context; red because no session wiring.

## Open decisions for the owner (never guess - list them instead)
- Whether the recording Telegram double is sufficient for the reply-context case, or whether a session double is needed from 6e7eaef7.

## Out of scope for this ticket
- Implementing queue, triage, Telegram adapter, or session wiring.<|end|><|start|>write to=assistant<|channel|>analysis <|constrain|>xml<|message|><rfl:parameter name="path">
/tmp/pi-caretaker-plans/a1ae60c1-implementation-plan.md