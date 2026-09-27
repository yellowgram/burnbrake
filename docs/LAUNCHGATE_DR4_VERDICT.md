# LaunchGate 4th DR Verdict (binding)

**VERDICT:** APPROVE_WITH_CHANGES  
**Date:** 2026-09-26 ET  
**Implement:** UNBLOCKED against freezes below.

| ID | Freeze |
| --- | --- |
| LG-1 | `402` + `BUDGET_EXHAUSTED` (halt non-retryable; never treat as 429) |
| LG-2 | Static versioned YAML price table (unpriced=deny; not live feed) |
| LG-3 | Self-host kit first SKU; hosted ledger tenancy Later (price stays founder) |
| LG-4 | OpenAI-shaped HTTP only day-1 |
| LG-5 | Reservation TTL = **15 minutes** |
| LG-6 | Default injected `max_tokens` = **4096** (inject only when omitted; never silent down-clamp) |
| LG-7 | UTC day boundary (ledger store clock) |
| LG-8 | Idempotency key **required** on SDK happy path; optional on raw HTTP with loud START_HERE (retries after forward must carry key) |
| LG-9 | Warn at **30 days** stale; still not fail-open (unpriced still deny) |
| LG-10 | `X-BurnBrake-Key` (Bearer `bb_…` allowed alt) |

**BLOCKERS:** none  
**NOTES:** Promise honesty held (one in-flight overshoot OK). Cap+kill only. Soft-WTP off. Polar dark until zip/SHA + founder go-live. Never free-release after FORWARDED. Fail-closed ledger. No Autumn/credits lexicon on spend path.  
**FOUNDER_ESCALATIONS:** none (price / refunds / Polar light / Soft-WTP stay founder)
