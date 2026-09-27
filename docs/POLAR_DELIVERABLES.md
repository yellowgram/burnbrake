# BurnBrake — Polar Deliverables (design checklist; listing DARK)

**Status:** design draft only — **no zip/SHA artifacts exist yet**  
**Polar listing:** **DARK — not Polar-ready**  
**First cash SKU (DR3 lock):** self-host kit only (~$149 USD draft — **founder** owns price)  
**Hosted sidecar / ledger tenancy (~$29/mo draft):** **Later** — not in day-1 zip  
**Date:** 2026-09-26 ET — Design Pass 3 absorbed  
**Contact:** hello@yellowgram.dev  

This file is the ready-gate checklist for what a future Polar kit **must** contain. Completing the checklist does **not** light the listing — **founder** owns Polar go-live. LaunchGate may APPROVE ready-gate docs only.

---

## Hard fences

- Soft-WTP / cold invoices **FORBIDDEN**  
- Cap + kill only — stay dumber than Autumn (no credits/entitlements/invoice-overage on spend path)  
- Kit commerce ≠ in-path OpenAI metering  
- Do not claim Polar-ready, “listed,” or ship empty SHA theater  

---

## Zip must contain (when artifacts exist)

| Path / item | Purpose |
| --- | --- |
| `README.md` / `START_HERE.md` | Localhost bind + `X-BurnBrake-Key` + baseURL → first allow → first reject ≤15 min |
| `DEMO_60S.md` (or START_HERE section) | Timed 60s demo with **mock upstream**; prove `BUDGET_EXHAUSTED` + `upstream_forwarded=false` |
| Sidecar binary **or** Docker image pin + compose | One default install path (implement picks; document one) |
| Thin TypeScript SDK (if shipped in same kit) | Same reserve/settle protocol; or document “sidecar-only kit” clearly |
| `config.example.env` / example budgets | run + **user or day**; warn if only per-run |
| Versioned **price table** YAML (`version`, `priced_at`) | Unpriced model → deny; freshness visible |
| `OPERATOR.md` (or link) | Balances (incl. debt), decision log, kill run, caps, health fields, auth rotation |
| `SUPPORT.md` boundary | Channel, ticket requirements, no live keys, out-of-scope auto-replies |
| `LICENSE` | As chosen pre-list (founder/LaunchGate) |
| `CHANGELOG` / version tag | Pin what buyer paid for |
| `checksums` note | Points to published SHA256 of this zip |

### Explicitly **not** in day-1 zip

- Hosted multi-tenant control plane  
- Polar/Stripe customer portal for OpenAI spend  
- Credit wallet / entitlement EMS / invoice dunning  
- Live provider API keys or sample secrets that look real  
- Claims that BurnBrake stops ungated second clients or replaces org hard limits  

---

## SHA / release hygiene

- [ ] Published **SHA256** of the exact zip buyers download  
- [ ] Tag / version on GitHub (or release host) matches zip contents  
- [ ] No “latest floating” without pin in Polar description  
- [ ] Re-issue SHA on every kit rebuild; old SHA documented as superseded  

*Do not fill SHA values in this design pack until the zip exists.*

---

## Polar listing copy constraints (when founder lights)

- One-liner: **pre-call spend gate** — reject next completion when reserve cannot cover conservative estimate; **not** “never overspend.”  
- Mention: self-host sidecar; localhost default; auth required; OpenAI-shaped routes.  
- Honesty: one in-flight call may overshoot → debt; dual-client bypass possible if buyer skips sidecar.  
- Price USD; refund policy for **kit SKU** linked (founder-owned text) — do not conflate with reservation release/debt.  
- Support: `hello@yellowgram.dev`; best-effort; no SLA invented at launch.  
- Listing stays **dark** until this checklist green **and** founder go-live.

---

## Ready-gate sign-off (before asking founder to light)

- [ ] DR×3 complete ([`DR3_ATTACKS.md`](./DR3_ATTACKS.md))  
- [ ] LaunchGate 4th DR **APPROVE**  
- [ ] Implement + CR×3 + LaunchGate 4th CR **APPROVE**  
- [ ] Stranger happy path green ([`MINIMUM_SUPPORT.md`](./MINIMUM_SUPPORT.md))  
- [ ] 60s demo script green (mock upstream)  
- [ ] Operator surfaces shipped ([`OPERATOR_NEEDS.md`](./OPERATOR_NEEDS.md))  
- [ ] Zip + SHA256 published  
- [ ] This POLAR_DELIVERABLES checklist complete  
- [ ] Refund/cancel policy for kit SKU written (**founder**)  
- [ ] Listing remains dark until **founder** Polar go-live  

---

*Design only. Not Polar-ready. Last updated: 2026-09-26 ET — Design Pass 3 absorbed.*
