# Hosted runtime versus this repository

This repository ships a **single-tenant self-host process**: one deployment, one SQLite ledger, one process clock. `GET /health` reports `deploy.hosted.multi_tenant_runtime: false`.

A hosted multi-tenant service would be a **separate product**. It is not implemented here, and there is no multi-tenant hosted runtime in this repository.

## What this repository is

- Auth is the deploy's `bb_` spend key (and a distinct operator key). There is no tenant id.
- The ledger file is the system of record. Filesystem access is operator control.
- Caps are user, run, and UTC day on that one file.

## What a hosted runtime would have to design first

Not scheduled as code here. A later hosted service would need, before any shared process:

1. **Tenant auth** distinct from this repository's single spend key. One customer's key must not read or spend another customer's ledger.
2. **Ledger isolation.** Separate database (or equivalent hard partition) per tenant. A shared SQLite file is not isolation.
3. **Threat model for a shared operator.** Support staff, backups, and metrics must not become a cross-tenant spend path.
4. **The same exhaust contract** per tenant: HTTP 402 `BUDGET_EXHAUSTED`, halt true, retryable false. A hosted control plane must not add a warn-only or retryable exhaust.
5. **No second-client proof.** Hosting the sidecar still does not govern a client that calls the provider directly.

Until that design exists as a runtime, docs say separate product, not this repository.
