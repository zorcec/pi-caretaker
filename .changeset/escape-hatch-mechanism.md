---
"pi-caretaker": patch
---

Deterministic escape-hatch mechanism (`matchEscapeHatch`,
`routeEscapeHatch`): a configured must-notify rule notifies exactly once
through the owned Telegram path and never reaches triage; anything else
flows through untouched, and a notify failure propagates without
fallthrough. The owner rule list ships empty pending the wire-vocabulary
decision, so nothing bypasses until the owner configures it — the safe
default is normal triage.
