# BurnBrake — Polar deliverables

**Status:** pack ready for CoS Polar publish  
**Founder GO:** received 2026-09-27. BurnBrake does not publish Polar itself and does not operate the Polar UI.  
**Listing:** **not live.** Suthirth solutions publishes after this kit is on `main` and the GitHub Release asset exists.  
**Tag:** `v0.1.0`  
**Zip:** `burnbrake-0.1.0.zip`  
**Archive root:** `burnbrake-0.1.0/`  
**SHA-256:** `585347975892f29d2e0056fd062eee8520c41d15a152c37e2ce31477ba915cf8`  
**Checksum file:** `checksums/burnbrake-0.1.0.sha256` (in git; **not** inside the zip — the archive cannot contain its own digest)  
**Manifest:** `checksums/burnbrake-0.1.0.manifest.txt`  
**Seller:** Suthirth solutions  
**Contact:** hello@yellowgram.dev  
**Primary SKU:** self-host one-org **$199 once**  
**Hosted optional:** **$49/mo** (separate product only if Polar needs a second SKU; not in this zip; not Soft-WTP)  
**Refund:** **14 days** on the $199 kit (not a budget release and not a debt clear)  
**Support:** **60-day Issues**, no SLA  
**Soft-WTP / coupons / cold invoices:** **none**  
**Exhaust:** HTTP **402** / `BUDGET_EXHAUSTED` / halt / **not retryable** (unchanged; never 429)  
**Autumn:** not smuggled. Cap + kill only.

Rebuild from the release commit. Do not invent a digest. `scripts/pack-release.sh` exits non-zero if the rebuilt zip does not match the checksum file.

---

## Paste-ready Polar listing

### Title

BurnBrake — self-host spend gate (one organization)

### One-liner

Pre-call spend gate for agent loops: the sidecar rejects the next completion when a conservative reserve (including debt) cannot be covered. Not a promise that a call already in flight spent zero.

### Description

BurnBrake is a self-hosted request-path spend governor for OpenAI-shaped chat and completions. Point `baseURL` at a localhost sidecar. Before each call it estimates a conservative cost, reserves that amount against user, run, and day caps, and rejects the next call when the reserve (including debt) does not fit.

The $199 fee buys the packaged self-host kit and 60 days of GitHub Issues, scoped to one organization. It includes the v0.1.0 zip (tag `v0.1.0`, file `burnbrake-0.1.0.zip`), the HTTP 402 / debt / run-id contract, and brake-curve configuration in the tree (default off; the cap is still a halt).

Copyright in `LICENSE` is MIT. Payment does not revoke that grant and does not add a copyright limit MIT does not contain. MIT does not include the Issues window.

Price: $199 once. Refund window: 14 days. Seller: Suthirth solutions. Support email in that window: hello@yellowgram.dev.

Hosted operation at $49/mo is optional and is not this product. Create it as a separate Polar product only if Polar requires one. It is not a coupon, a cold invoice, or Soft-WTP.

SHA-256 of `burnbrake-0.1.0.zip`: `585347975892f29d2e0056fd062eee8520c41d15a152c37e2ce31477ba915cf8`

Verify:

```bash
sha256sum burnbrake-0.1.0.zip
```

The digest must match the line above and `checksums/burnbrake-0.1.0.sha256` on tag `v0.1.0`.

### What's included

- Perpetual self-host for one organization
- `burnbrake-0.1.0.zip` (tag `v0.1.0`) and the SHA-256 above
- README, START_HERE, 60-second mock-upstream demo, operator docs, support boundary, commercial lock, MVP scope, brake-curve policy
- Dockerfile and compose that publish `127.0.0.1:8787` only
- Versioned price table `prices/openai.yaml`
- `package.json`, `package-lock.json`, TypeScript source, thin SDK export, and built `dist/`
- MIT `LICENSE` and `CHANGELOG.md`
- Exhaust contract: HTTP 402, `BUDGET_EXHAUSTED`, halt, not retryable

### Honesty limits

- One already-forwarded call may settle above the reserve, or a crash may debit the estimate. Debt gates the next call. This is not “never overspend.”
- No claim that BurnBrake will outrun OpenAI forever, or replace the provider’s org hard limits.
- A client that never points at the sidecar is not stopped.
- Not Autumn, Stigg, a credit wallet, entitlements, invoice dunning, or tax.
- Soft-WTP, coupons, and cold invoices are not included.
- No SLA. 60-day Issues only.
- The README ships no Polar checkout URL.

### Price, refund, support, seller

| Field | Value |
| --- | --- |
| Price | **$199 once** (packaged kit + 60-day Issues, one organization). Copyright is MIT. |
| Refund | **14 days** on that kit |
| Support | **60-day GitHub Issues**, no SLA |
| Email | hello@yellowgram.dev |
| Seller | **Suthirth solutions** |
| Soft-WTP | **none** |
| Hosted | **$49/mo** optional, separate product only if Polar needs it |

---

## CoS publish steps

BurnBrake will not do these clicks.

- [ ] Wait until the pack pull request is squash-merged to `main`. Do not publish from the PR branch.
- [ ] Check out that merge commit. Tag it `v0.1.0`. Do not point the tag at an older commit.
- [ ] On that commit, run `bash scripts/pack-release.sh`. It must match `checksums/burnbrake-0.1.0.sha256` (`585347975892f29d2e0056fd062eee8520c41d15a152c37e2ce31477ba915cf8`). If it does not, stop. Do not upload a different zip.
- [ ] Create the GitHub Release with the command in **Release recipe** below. Asset name: `burnbrake-0.1.0.zip`.
- [ ] In Polar, create the product under **Suthirth solutions**. Paste the title, one-liner, and description from this file.
- [ ] Set price **$199 once**. Set the refund window to **14 days**. Support text: 60-day Issues, no SLA, hello@yellowgram.dev.
- [ ] Attach the deliverable: the GitHub Release asset, plus this SHA-256. Do not attach an unpinned “latest”.
- [ ] Hosted **$49/mo**: add a second product only if Polar requires it. Do not fold it into the $199 SKU. Do not add coupons. Do not send cold invoices. Soft-WTP stays off.
- [ ] Publish the Polar product.
- [ ] Update the yellowgram.dev Current card: BurnBrake, $199 once, 14-day refund, tag `v0.1.0`, hosted $49/mo called out as optional and not day-1. Do not add a checkout URL to the BurnBrake README.

---

## Zip versus git

In the zip (under `burnbrake-0.1.0/`):

- Product docs a buyer needs: `README.md`, `docs/START_HERE.md`, `docs/DEMO_60S.md`, `docs/OPERATOR.md`, `docs/OPERATOR_NEEDS.md`, `docs/SUPPORT.md`, `docs/MINIMUM_SUPPORT.md`, `docs/COMMERCIAL_LOCK.md`, `docs/MVP_SCOPE.md`, `docs/DESIGN_BRAKE_CURVE.md`
- `LICENSE`, `CHANGELOG.md`, `config.example.env`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `tsconfig.json`
- `package.json`, `package-lock.json`, `prices/*.yaml`, `src/**`, `scripts/demo-60s.ts`, built `dist/**` (JavaScript, declarations, source maps)

Not in the zip (kept in git, or never shipped):

- This file, `checksums/`, `scripts/pack-release.sh`, `scripts/reserve-race-child.ts`, `test/`
- CR*, DR*, and LaunchGate attack logs and briefs (`docs/CR*`, `docs/DR*`, `docs/LAUNCHGATE*`, `docs/DESIGN_PASS_1.md`)
- `.git`, `node_modules`, `data/`, `*.sqlite`, `.env`, real provider keys

Exact member list (`checksums/burnbrake-0.1.0.manifest.txt`):

```text
burnbrake-0.1.0/.dockerignore
burnbrake-0.1.0/CHANGELOG.md
burnbrake-0.1.0/Dockerfile
burnbrake-0.1.0/LICENSE
burnbrake-0.1.0/README.md
burnbrake-0.1.0/config.example.env
burnbrake-0.1.0/dist/auth.d.ts
burnbrake-0.1.0/dist/auth.js
burnbrake-0.1.0/dist/auth.js.map
burnbrake-0.1.0/dist/brake.d.ts
burnbrake-0.1.0/dist/brake.js
burnbrake-0.1.0/dist/brake.js.map
burnbrake-0.1.0/dist/cli.d.ts
burnbrake-0.1.0/dist/cli.js
burnbrake-0.1.0/dist/cli.js.map
burnbrake-0.1.0/dist/config.d.ts
burnbrake-0.1.0/dist/config.js
burnbrake-0.1.0/dist/config.js.map
burnbrake-0.1.0/dist/constants.d.ts
burnbrake-0.1.0/dist/constants.js
burnbrake-0.1.0/dist/constants.js.map
burnbrake-0.1.0/dist/errors.d.ts
burnbrake-0.1.0/dist/errors.js
burnbrake-0.1.0/dist/errors.js.map
burnbrake-0.1.0/dist/estimate.d.ts
burnbrake-0.1.0/dist/estimate.js
burnbrake-0.1.0/dist/estimate.js.map
burnbrake-0.1.0/dist/ledger.d.ts
burnbrake-0.1.0/dist/ledger.js
burnbrake-0.1.0/dist/ledger.js.map
burnbrake-0.1.0/dist/money.d.ts
burnbrake-0.1.0/dist/money.js
burnbrake-0.1.0/dist/money.js.map
burnbrake-0.1.0/dist/prices.d.ts
burnbrake-0.1.0/dist/prices.js
burnbrake-0.1.0/dist/prices.js.map
burnbrake-0.1.0/dist/sdk/index.d.ts
burnbrake-0.1.0/dist/sdk/index.js
burnbrake-0.1.0/dist/sdk/index.js.map
burnbrake-0.1.0/dist/server.d.ts
burnbrake-0.1.0/dist/server.js
burnbrake-0.1.0/dist/server.js.map
burnbrake-0.1.0/dist/upstream.d.ts
burnbrake-0.1.0/dist/upstream.js
burnbrake-0.1.0/dist/upstream.js.map
burnbrake-0.1.0/docker-compose.yml
burnbrake-0.1.0/docs/COMMERCIAL_LOCK.md
burnbrake-0.1.0/docs/DEMO_60S.md
burnbrake-0.1.0/docs/DESIGN_BRAKE_CURVE.md
burnbrake-0.1.0/docs/MINIMUM_SUPPORT.md
burnbrake-0.1.0/docs/MVP_SCOPE.md
burnbrake-0.1.0/docs/OPERATOR.md
burnbrake-0.1.0/docs/OPERATOR_NEEDS.md
burnbrake-0.1.0/docs/START_HERE.md
burnbrake-0.1.0/docs/SUPPORT.md
burnbrake-0.1.0/package-lock.json
burnbrake-0.1.0/package.json
burnbrake-0.1.0/prices/openai.yaml
burnbrake-0.1.0/scripts/demo-60s.ts
burnbrake-0.1.0/src/auth.ts
burnbrake-0.1.0/src/brake.ts
burnbrake-0.1.0/src/cli.ts
burnbrake-0.1.0/src/config.ts
burnbrake-0.1.0/src/constants.ts
burnbrake-0.1.0/src/errors.ts
burnbrake-0.1.0/src/estimate.ts
burnbrake-0.1.0/src/ledger.ts
burnbrake-0.1.0/src/money.ts
burnbrake-0.1.0/src/prices.ts
burnbrake-0.1.0/src/sdk/index.ts
burnbrake-0.1.0/src/server.ts
burnbrake-0.1.0/src/upstream.ts
burnbrake-0.1.0/tsconfig.json
```

Placeholder keys in `config.example.env` (`bb_replace_me`, `bb_operator_replace_me`) are public localhost samples. They are not live secrets.

---

## Rebuild

From a clean checkout of the commit you are about to tag:

```bash
bash scripts/pack-release.sh
```

That runs `npm ci`, `npm run build`, and writes `dist/release/burnbrake-0.1.0.zip`. The default mode checks the digest. It does not rewrite `checksums/` unless you pass `--write` after an intentional kit change. After `--write`, update the SHA-256 lines in this file to the new digest before tagging.

Sealed with Node v22.14.0 and the TypeScript version pinned in `package-lock.json`. Re-seal on Node 22. Timestamps inside the zip are fixed at 1980-01-01 so the bytes do not depend on the clock.

---

## Release recipe

Run this only after the pack commit is on `main`. The zip SHA below is a file digest, not a git commit SHA. Rebuild on the merge commit and require a match before `gh release create`.

```bash
git fetch origin main
git checkout main
git pull origin main
# HEAD must be the squash-merge of the pack pull request.
bash scripts/pack-release.sh
git tag -a v0.1.0 -m "BurnBrake v0.1.0 self-host kit"
git push origin v0.1.0

gh release create v0.1.0 dist/release/burnbrake-0.1.0.zip \
  --repo yellowgram/burnbrake \
  --title "BurnBrake v0.1.0" \
  --notes "$(cat <<'EOF'
# BurnBrake v0.1.0

Self-host one-org kit. Seller: Suthirth solutions.

## Asset

- File: `burnbrake-0.1.0.zip`
- SHA-256: `585347975892f29d2e0056fd062eee8520c41d15a152c37e2ce31477ba915cf8`

Verify:

    sha256sum burnbrake-0.1.0.zip

The digest must match `checksums/burnbrake-0.1.0.sha256` on tag `v0.1.0`.

## What you get

Packaged self-host kit and 60-day Issues for one organization. Copyright in `LICENSE` is MIT. The fee does not revoke that grant. Sidecar rejects the next completion when the reserve (including debt) cannot cover a conservative estimate. Unzip, `cd burnbrake-0.1.0`, `npm ci` (Node 22.13+), then `npm run demo` or `node dist/cli.js serve`.

## Commercial

- Price: **$199 once**
- Refund: **14 days**
- Support: **60-day GitHub Issues**, no SLA. hello@yellowgram.dev
- Hosted **$49/mo** is optional and is not this asset
- Soft-WTP, coupons, and cold invoices: none

## Exhaust

HTTP **402** / `BUDGET_EXHAUSTED` / halt / **not retryable**. Not 429.

One already-forwarded call may still overshoot. There is no claim that BurnBrake will outrun OpenAI forever.

This release is the kit. It is not a Polar checkout.
EOF
)"
```

The release was not created from the pack pull request. The pack commit was not on `main` yet. Do not upload a zip built from the PR branch if squash-merge changes file bytes. The script is the check.

---

## Ready-gate

- [x] MVP sidecar merged to `main`
- [x] Brake curve **BB_BRAKE_CURVE_1** merged. `brake.enabled` defaults to false. Exhaust is still HTTP 402, halt, not retryable, never 429
- [x] CI smoke merged (typecheck, unit tests, and build on Node 22)
- [x] LaunchGate 4th DR verdict on file: **APPROVE_WITH_CHANGES** (`docs/LAUNCHGATE_DR4_VERDICT.md`). This checklist does not invent a 4th CR verdict file. The implementation is already on `main`.
- [x] Stranger path (README, `docs/START_HERE.md`, `docs/MINIMUM_SUPPORT.md`, `docs/DEMO_60S.md`) describes HTTP **402**, not a draft status
- [x] 60s demo script ships in the kit (`npm run demo`, mock upstream)
- [x] Operator CLI and operator HTTP shipped
- [x] Zip `burnbrake-0.1.0.zip` built. SHA-256 `585347975892f29d2e0056fd062eee8520c41d15a152c37e2ce31477ba915cf8` recorded in `checksums/burnbrake-0.1.0.sha256`
- [x] Refund **14 days** on the $199 kit
- [x] Soft-WTP off. No Autumn smuggle. No checkout URL in the README
- [ ] Polar listing published — CoS only, after the Release asset exists
- [ ] yellowgram.dev Current card updated — CoS only, after publish

---

## Hard fences

- Soft-WTP / coupons / cold invoices **forbidden**
- Cap + kill only. No credits, entitlements, or invoice-overage on the spend path
- Kit commerce is not in-path OpenAI metering
- Do not claim the Polar listing is already live
- Do not change the exhaust contract to seal this kit

*Pack ready for CoS. Listing not live. Last updated: 2026-09-27. Soft-WTP off. Exhaust unchanged.*
