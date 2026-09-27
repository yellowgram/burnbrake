# BurnBrake — Polar Deliverables (design checklist; listing DARK)

**Status:** design draft only — **no zip/SHA artifacts exist yet**  
**Polar listing:** **DARK — not Polar-ready**  
**Pricing (USD, founder lock):** **$199 once** self-host one-org license (primary) · **$49/mo** hosted optional · see [`COMMERCIAL_LOCK.md`](./COMMERCIAL_LOCK.md)  
**First cash SKU:** **$199 once** self-host one-org. Hosted **$49/mo** is optional later / not day-1 primary, and is not in the day-1 zip.  
**Date:** 2026-09-27 ET — founder commercial lock; Design Pass 3 still absorbed  
**Contact:** hello@yellowgram.dev  

This file is the ready-gate checklist for what a future Polar kit **must** contain. Completing the checklist does **not** light the listing — **founder** owns Polar go-live. LaunchGate may APPROVE ready-gate docs only. Polar stays **dark**. Soft-WTP stays off. Exhaust (402 / not retryable) is unchanged.

## What the $199 fee includes

The primary fee is a perpetual self-host license for **one organization**. It must include:

- Perpetual self-host for **one organization**
- Tag + SHA + the **402 / debt / run-id** contract
- **60-day Issues**, no SLA (same fence as HookSteel)
- **Brake-curve** config in the tree ([`DESIGN_BRAKE_CURVE.md`](./DESIGN_BRAKE_CURVE.md))
- **No claim** that BurnBrake will outrun OpenAI forever

Hosted **$49/mo** is optional and is not the day-1 primary plan. Month-2 platform caps are expected. The buyer keeps the zip. Do not market $149 or $79/mo as the plan. Authority: [`COMMERCIAL_LOCK.md`](./COMMERCIAL_LOCK.md).

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
- Honesty: one in-flight call may overshoot → debt; dual-client bypass possible if buyer skips sidecar. **No claim** that BurnBrake will outrun OpenAI forever.  
- Price USD at the founder lock (**$199 once** primary · **$49/mo** hosted optional); refund window for the **$199** self-host one-org kit is **14 days** (founder lock) — do not conflate with reservation release/debt.  
- Support: **60-day Issues**, no SLA (same fence as HookSteel); `hello@yellowgram.dev` in that window.  
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
- [x] Refund window for the $199 self-host one-org kit: **14 days** (founder lock)  
- [ ] Listing remains dark until **founder** Polar go-live  

---

*Design only. Not Polar-ready. Polar dark. Last updated: 2026-09-27 ET — founder refund lock **14 days** on the $199 one-org kit ([`COMMERCIAL_LOCK.md`](./COMMERCIAL_LOCK.md)); Soft-WTP off; exhaust unchanged.*
