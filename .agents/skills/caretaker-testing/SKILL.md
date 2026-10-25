---
name: caretaker-testing
description: vitest is the single runner; what the five suites pin, the anti-placeholder rule, honesty codes, and how to run. Load before writing or changing any test in pi-caretaker.
---

# Caretaker Testing

**vitest is the single runner.** Not jest, not `node:test`, not ad-hoc
scripts. One runner means one include pattern (`tests/**/*.test.ts` in
`vitest.config.ts`), one mock model, one coverage provider (V8). A second
runner would split the suite and silently unrun half of it — that is why
the pre-push hook calls exactly `pnpm test`.

## What the five suites pin today

Each suite pins its ADR. As code lands, the pins must grow teeth — never
lose them:

| Suite | ADR | Must keep pinning |
|---|---|---|
| `events.test.ts` | 0001 | `message`-only valid; empty message rejected; unknown severity rejected; 64 KiB cap boundary (`MAX_EVENT_BODY_BYTES` ok, +1 byte over) |
| `health.test.ts` | 0001 | Exact `{status, version, commit}` shape; version echoed, never hardcoded; commit non-empty |
| `untrusted-payload.test.ts` | 0002 | Hostile text stays in the data channel; instruction channel byte-equals the fixed string; triage prompt states the rule |
| `telegram-path.test.ts` | 0003 | Adapter is exactly `notify` + `onMessage`; module stays type-only (zero runtime exports) until the adapter ticket lands |
| `escape-hatch.test.ts` | 0004 | Prompt names the hatch as deterministic, lists host-dark + dead-backups, states triage bypass |

When the HTTP listener, queue semantics, or Telegram adapter land, extend
these files — do not start parallel suites that pin the same rule twice.

## The anti-placeholder rule

A test that cannot fail is worse than no test: it spends CI trust while
guarding nothing. Assert a specific value, status, or error — never
truthiness.

Weak (would pass on almost any implementation):

```ts
expect(parsed.success).toBeTruthy();
expect(report.commit).toBeTruthy();
```

Strong (this repo's actual style — each breaks on a specific wrong code):

```ts
expect(parsed.success).toBe(true);
expect(report.commit.length).toBeGreaterThan(0);
expect(req.trustedInstructions).toBe(TRIAGE_INSTRUCTIONS); // byte equality
expect(Object.keys(ns)).toEqual([]); // catches a second sender
```

Before submitting, ask: "if I inverted the implementation, does this go
red?" If not, the test is decoration — rewrite it or delete it.

**Trap: weakening instead of fixing.** If a code change breaks a test,
fix the test whose expectation the change invalidated — update it to the
new correct value. Never relax an assertion to `>= 1`, `toBeTruthy()`,
or a looser matcher to "make it pass". A weakened pin guards the next
regression for nobody.

## Testing the honesty rules (ADR-0001)

`202` means queued — assert it is NOT 200-with-delivered semantics. The
status-code contract, once the listener ticket lands:

- Queued → `202` with a queue receipt. Test that 202 carries **no**
  delivery claim (no Telegram id, no "processed" flag).
- Oversized → `413`, rejected outright. Test the boundary AND that the
  body is not silently truncated (a truncated event is a misleading event).
- Unauthorized → `401`, and assert it fires **before** parsing — a
  malformed-but-unauthorized body must still be 401, not 400.
- Queue full → `503`, not a fake 202. Test that overload never masquerades
  as acceptance.

Today the handler is a stub that throws `not implemented` — the envelope,
size gate, and health constructor are what is actually tested. Say "not
built yet" for the rest; do not describe the concept doc's HTTP layer as
if it existed.

## The untrusted-payload test pattern (ADR-0002)

Instruction-shaped payload in → assert no instruction-channel change:

1. Feed hostile text (`ignore previous instructions`, fake `rm -rf`
   authorization, `post to Telegram now`) through the real constructor
   (`buildTriageRequest`), not a mock of it.
2. Assert the payload travels verbatim as **data** (`eventText` equals
   input — nothing executed, nothing "sanitized into action").
3. Assert the instruction channel is **byte-equal** to the fixed
   repo-owned string. Equality, not `not.toContain` — `not.toContain`
   passes an implementation that appends one instruction word; `toBe`
   does not. (`not.toContain` is acceptable only for the untyped native
   `payload` object, which has no channel split.)

## The escape-hatch rule (ADR-0004)

A must-never-miss alert must be proven to fire **without a model turn**.
The test must not invoke the LLM, mock "the model would notify", or assert
on triage prose — it asserts the deterministic path: event matches the
owner-reviewed list → `notify` is called directly, triage never consulted.
If your test needs a model to pass, it proves the opposite of the ADR.

## How to run

```bash
pnpm test                                  # full suite (pre-push runs this)
pnpm vitest run tests/events.test.ts       # single file
pnpm vitest run tests/events.test.ts -t "oversized"  # filter by name
pnpm test:coverage                         # V8 coverage — for finding gaps
```

- **Never `--pool=forks`.** Forks multiply memory per file; on this small
  suite threads are correct and faster.
- Under memory pressure, target files with
  `--pool=threads --poolOptions.threads.maxThreads=2 --testTimeout=120000`.
  Constrain the run (single file) rather than relaxing timeouts globally.

## Flaky vs real failure

A test is flaky only if it passes on retry **with no code change** AND
touches time, randomness, network, or concurrency. The current five suites
are pure (schema, string match, interface shape) — none has a flakiness
excuse. If one goes red, it is a real failure until proven otherwise:
reproduce, read the assertion, fix the code or (per the rule above) update
the invalidated expectation. Never add `retry`, `setTimeout` padding, or
`.skip` to a deterministic test.

## Coverage — a flashlight, not a target

Use `pnpm test:coverage` to find untested branches of the queue admission
and HTTP edge (the `full → 503`, `oversized → 413`, `401-before-parse`
paths are the ones most likely to hide). Do not chase a percentage: a
100% suite of truthy assertions guards nothing, and gaming the number
with `/* istanbul ignore */` or throwaway tests is a review failure.
