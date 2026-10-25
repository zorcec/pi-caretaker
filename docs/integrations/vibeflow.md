# vibeflow → pi-caretaker

vibeflow is the first real event source. This page documents the link at the
level of "a consumer POSTs events" — nothing here depends on private
deployment.

## What vibeflow is

vibeflow is task tracking with a local CLI board and a hosted board:
public repo https://github.com/zorcec/vibeflow. The local build is what we
integrate with first: the CLI repo checked out locally
(`../vibeflow-workspace/vibeflow`) is the development target, and the
published package is `@vibeflow-tools/cli` on npm — so a reader can
reproduce this without our machine.

## The integration

One-directional and dumb on vibeflow's side. When something worth the
owner's attention happens, vibeflow POSTs to `POST /events` with the bearer
token, matching the ADR-0001 envelope exactly:

```json
{
  "source": "vibeflow",
  "event": "task_moved_to_done",
  "message": "Release checklist finished on the website board",
  "metadata": { "board": "website", "task": "release-checklist" }
}
```

Only `message` is required; `source`, `event`, and `metadata` are context
for triage. Severity stays unset unless vibeflow genuinely knows it.

## The boundary

The caretaker does not read vibeflow's database, board, or credentials — it
only receives what is posted. That one-way POST is what keeps the two
projects decoupled: either side can change internals freely as long as the
envelope still validates.
