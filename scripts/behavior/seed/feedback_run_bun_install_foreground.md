---
name: run-bun-install-foreground
description: "Run `bun install` yourself, in the foreground with a timeout, after editing manifests (2026-09-14)"
metadata:
  type: feedback
---

Since 2026-09-14 the agent runs `bun install` itself after changing package.json, rather than asking the user to.

**Why:** the toolchain is bun, installs are fast, and handing them off adds a round trip.

**How to apply:** run it in the foreground with a timeout; never background it and poll.
