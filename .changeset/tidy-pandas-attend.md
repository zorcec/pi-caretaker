---
"pi-caretaker": patch
---

POST /events now requires `application/json` content (415 otherwise, with
charset suffixes accepted), and the packaged entry reports the built
package's version instead of a hardcoded string: the build injects the
package.json version into the bundle next to the commit SHA, with a `dev`
fallback outside a bundle.
