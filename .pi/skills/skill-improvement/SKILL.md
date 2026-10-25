---
name: skill-improvement
description: Fix factual errors in .pi skills immediately, add repeated gaps, never restyle. Load when a skill misleads you during real work.
---

# Skill Improvement

Fix skills when real work exposes a problem. Keep it minimal.

```
Skill misleads you
  ├─ FACTUAL ERROR (wrong path, command, default)? → FIX NOW. Edit → verify → commit.
  ├─ GAP (same friction 2+ times)? → ADD it briefly. Edit → verify → commit.
  └─ Otherwise (style, taste)? → DO NOT TOUCH. Keep working.
```

## Rules

- Only touch skills relevant to the current task — no audits on your own
  initiative (an explicit owner request overrides this).
- When adding, prefer brevity; delete what the addition replaces.
- Every skill keeps portable frontmatter (`name`, `description`) — without
  it Pi silently will not route to the skill. Verify after editing.

## Commit

```bash
git add .pi/skills/<name>/ && git commit -m "improve(skill): <name> — <what>" -- .pi/skills/<name>/
```
