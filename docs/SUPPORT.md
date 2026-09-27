# Support boundary

- **Channel:** GitHub Issues for **60 days** (same fence as HookSteel), or hello@yellowgram.dev in that window.
- **Scope:** sidecar and SDK behavior, budget config, the reject path, auth and bind, and the operator CLI shipped in this kit.
- **No SLA.** Best effort only. What the $199 fee includes: [COMMERCIAL_LOCK.md](./COMMERCIAL_LOCK.md).
- **Every ticket needs:** version, sidecar or SDK, OS, listen bind, whether auth is on, `user_id`, `run_id`, and what you expected versus what happened (did upstream get called?). Redacted booleans only.
- **Do not send:** live provider API keys, the BurnBrake shared secret, or payment-provider secrets.

Out of scope: building your agent, debugging live provider keys, billing-platform features, making BurnBrake stop a client that never called the sidecar, and any request to forward when the ledger is down or to promise zero spend on a call that was already forwarded.

Stranger path and the halt table: [../README.md](../README.md) and [MINIMUM_SUPPORT.md](./MINIMUM_SUPPORT.md).
