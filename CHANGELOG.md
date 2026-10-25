# Changelog

## 0.1.1

### Patch Changes

- First versioned CHANGELOG entry. Covers the V1 contract scaffold (webhook
  envelope schema with the 64 KiB cap, triage data/instruction boundary, health
  shape with build-injected commit, queue and Telegram adapter interfaces,
  triage guidance draft), the four binding ADRs with guard pins, the vitest
  project setup (unit/guards/build/e2e plus the isolated live config) with
  coverage thresholds, and child-process plus in-process e2e for all three
  guard scripts. No runtime behavior beyond the scaffold: the listener, queue,
  activation and Telegram adapter remain `not implemented` stubs.
