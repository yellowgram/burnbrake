# Support

BurnBrake is MIT-licensed open source. There is no paid support, no support window, and no SLA.

- **Channel:** GitHub Issues on `yellowgram/burnbrake`. Best effort only.
- **Useful in a report:** version, sidecar or SDK, OS, listen bind, whether auth is on, `user_id`, `run_id`, and what you expected versus what happened (did upstream get called?). Redacted booleans only.
- **Do not send:** live provider API keys, the BurnBrake shared secret, or payment-provider secrets.
- **Security:** see [../SECURITY.md](../SECURITY.md).

Out of scope: building your agent, debugging live provider keys, making BurnBrake stop a client that never called the sidecar, and any request to forward when the ledger is down or to promise zero spend on a call that was already forwarded.

Stranger path and the halt table: [../README.md](../README.md).
