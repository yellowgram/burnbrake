# BurnBrake — Polar deliverables

**Status:** license fence packed for CoS. This pull request does not publish Polar and does not push a tag.  
**Founder GO:** price lock received earlier. BurnBrake does not publish Polar itself and does not operate the Polar UI.  
**Copyright:** source-available commercial. `LICENSE` is the PolyForm Noncommercial License 1.0.0 (`PolyForm-Noncommercial-1.0.0`). OSI open source: false. Commercial production use of the self-host kit requires the Suthirth Commercial Grant (`docs/COMMERCIAL_GRANT.md`).  
**Listing ($199 kit):** **not live.** CoS is unlisting the prior MIT-era Polar product `b5649684-58ff-498c-a135-0b4b44623c3b`. Do not claim that product, or any $199 kit listing, is live. Re-list under this fence only after the `v0.1.1` tree is on `main` and the GitHub Release asset exists. License Gate and LaunchGate say when to tag.  
**Hosted listing:** **LIVE** (CoS published 2026-09-27). Product `70b1a029-944f-4999-ae39-d39c041ae3e9`. **$59/mo** recurring. No zip, no GitHub benefit, and no self-host production rights on this SKU. Soft-WTP off. Checkout (this file only; do not copy into README or any zip-shipped doc): https://buy.polar.sh/polar_cl_A2dCr3WcvuTv5lLvNlp8AaC9kziCr8apYfunr0f60ci  
**Hosted admin (CoS):** https://polar.sh/dashboard/suthirth-solutions/products/70b1a029-944f-4999-ae39-d39c041ae3e9  
**Tag for this fence:** `v0.1.1` — **not pushed** until License Gate and LaunchGate say go.  
**Zip:** `burnbrake-0.1.1.zip`  
**Archive root:** `burnbrake-0.1.1/`  
**SHA-256:** `25b42eedfdcced6ac9c6e1a3ef4c70e7d46cc707af7798dcfcb53565f81302e2`  
**Checksum file:** `checksums/burnbrake-0.1.1.sha256` (in git; **not** inside the zip — the archive cannot contain its own digest)  
**Manifest:** `checksums/burnbrake-0.1.1.manifest.txt`  
**Historical kit (do not reseal):** tag `v0.1.0` and `checksums/burnbrake-0.1.0.*` stay. SHA-256 of that older zip remains `585347975892f29d2e0056fd062eee8520c41d15a152c37e2ce31477ba915cf8`. That digest is not the 0.1.1 zip.  
**Seller:** Suthirth solutions  
**Contact:** hello@yellowgram.dev  
**Primary SKU:** self-host one-org **$199 once** = Commercial Grant + kit zip + 60-day Issues  
**Hosted optional:** **$59/mo** recurring, **LIVE** (founder GO 2026-09-27 ET via Chief of Staff; CoS published product `70b1a029-944f-4999-ae39-d39c041ae3e9`; not this zip; no GitHub benefit; does not grant self-host production rights; not Soft-WTP)  
**Refund:** **14 days** on the $199 kit only (not a budget release, not a debt clear, and not a hosted refund term)  
**Support:** **60-day Issues**, no SLA  
**Soft-WTP / coupons / cold invoices:** **none**  
**Exhaust:** HTTP **402** / `BUDGET_EXHAUSTED` / halt / **not retryable** (unchanged; never 429)  
**Autumn:** not smuggled. Cap + kill only.

Rebuild from the release commit. Do not invent a digest. `scripts/pack-release.sh` exits non-zero if the rebuilt zip does not match the checksum file. The script packs 0.1.1 and does not write `checksums/burnbrake-0.1.0.*`.

---

## Paste-ready Polar listing

### Title

BurnBrake — self-host spend gate (one organization)

### One-liner

Pre-call spend gate for agent loops: the sidecar rejects the next completion when a conservative reserve (including debt) cannot be covered. Not a promise that a call already in flight spent zero.

### Description

BurnBrake is a self-hosted request-path spend governor for OpenAI-shaped chat and completions. Point `baseURL` at a localhost sidecar. Before each call it estimates a conservative cost, reserves that amount against user, run, and day caps, and rejects the next call when the reserve (including debt) does not fit.

The software is source-available commercial. OSI open source: false. `LICENSE` is the PolyForm Noncommercial License 1.0.0. Noncommercial use of the published source follows that license. Commercial production use of the self-host kit requires the Suthirth Commercial Grant (`docs/COMMERCIAL_GRANT.md`).

The $199 fee is that grant, the packaged self-host kit, and 60 days of GitHub Issues (no SLA), for one organization and the named tag, perpetual for that tag. It includes the v0.1.1 zip (file `burnbrake-0.1.1.zip`), the HTTP 402 / debt / run-id contract, and brake-curve configuration in the tree (default off; the cap is still a halt). The PolyForm Noncommercial License does not include the Issues window or the commercial grant.

Price: $199 once. Refund window: 14 days on this kit only. Seller: Suthirth solutions. Support email in that window: hello@yellowgram.dev.

Hosted operation at $59/mo recurring is a separate Polar product and is not this kit. It does not include the zip or GitHub Issues. It does not grant self-host production rights or rights to operate a competing hosted service. It is not a coupon, a cold invoice, or Soft-WTP.

The $199 kit listing is not live until CoS publishes the re-list under this fence. Do not describe the prior product `b5649684-58ff-498c-a135-0b4b44623c3b` as live.

SHA-256 of `burnbrake-0.1.1.zip`: `25b42eedfdcced6ac9c6e1a3ef4c70e7d46cc707af7798dcfcb53565f81302e2`

Verify:

```bash
sha256sum burnbrake-0.1.1.zip
```

The digest must match the line above and `checksums/burnbrake-0.1.1.sha256`. Tag `v0.1.1` is created only when License Gate and LaunchGate say go. Do not check this digest against `checksums/burnbrake-0.1.0.sha256`.

### What's included

- Suthirth Commercial Grant: one organization, named tag, perpetual for that tag
- `burnbrake-0.1.1.zip` and the SHA-256 above
- `docs/COMMERCIAL_GRANT.md`
- README, START_HERE, 60-second mock-upstream demo, operator docs, support boundary, commercial lock, MVP scope, brake-curve policy
- Dockerfile and compose that publish `127.0.0.1:8787` only
- Versioned price table `prices/openai.yaml`
- `package.json`, `package-lock.json`, TypeScript source, thin SDK export, and built `dist/`
- `LICENSE` (PolyForm Noncommercial 1.0.0, SPDX-style field `PolyForm-Noncommercial-1.0.0`) and `CHANGELOG.md`
- Exhaust contract: HTTP 402, `BUDGET_EXHAUSTED`, halt, not retryable

### Honesty limits

- One already-forwarded call may settle above the reserve, or a crash may debit the estimate. Debt gates the next call. This is not “never overspend.”
- No claim that BurnBrake will outrun OpenAI forever, or replace the provider’s org hard limits.
- A client that never points at the sidecar is not stopped.
- Not Autumn, Stigg, a credit wallet, entitlements, invoice dunning, or tax.
- Not OSI open source.
- Soft-WTP, coupons, and cold invoices are not included.
- No SLA. 60-day Issues only.
- The README and the zip ship no Polar checkout URL.
- Hosted $59/mo is not this grant.

### Price, refund, support, seller

| Field | Value |
| --- | --- |
| Price | **$199 once** (Commercial Grant + kit zip + 60-day Issues, one organization, named tag). |
| Copyright | PolyForm Noncommercial 1.0.0 + Suthirth Commercial Grant. Source-available. OSI open source: false. |
| Refund | **14 days** on that kit only |
| Support | **60-day GitHub Issues**, no SLA |
| Email | hello@yellowgram.dev |
| Seller | **Suthirth solutions** |
| Soft-WTP | **none** |
| Hosted | **$59/mo** recurring. **LIVE.** Product `70b1a029-944f-4999-ae39-d39c041ae3e9`. No zip, no GitHub benefit, no self-host production rights. Not the $199 kit. |
| $199 listing | **Not live.** Prior product `b5649684-58ff-498c-a135-0b4b44623c3b` is being unlisted. |

---

## CoS publish steps

BurnBrake will not do these clicks. Do not run them from the license-fence pull request.

- [ ] Wait until the license-fence tree that matches `checksums/burnbrake-0.1.1.sha256` is on `main`. Do not publish from the PR branch. Do not squash-merge as a packing step in this repository's fence PR. LaunchGate and License Gate decide when it lands.
- [ ] Do not move, rewrite, or reseal git tag `v0.1.0`. Do not replace `checksums/burnbrake-0.1.0.sha256` (`585347975892f29d2e0056fd062eee8520c41d15a152c37e2ce31477ba915cf8`).
- [ ] When License Gate and LaunchGate say go, check out that `main` commit. Tag it `v0.1.1`. Do not point the tag at the v0.1.0 commit.
- [ ] On that commit, run `bash scripts/pack-release.sh`. It must match `checksums/burnbrake-0.1.1.sha256` (`25b42eedfdcced6ac9c6e1a3ef4c70e7d46cc707af7798dcfcb53565f81302e2`). If it does not, stop. Do not upload a different zip.
- [ ] Create the GitHub Release with the command in **Release recipe** below. Asset name: `burnbrake-0.1.1.zip`.
- [ ] Unlist the prior MIT-era $199 product `b5649684-58ff-498c-a135-0b4b44623c3b`. Do not leave it described as the live kit.
- [ ] In Polar, create the replacement $199 product under **Suthirth solutions**. Paste the title, one-liner, and description from this file.
- [ ] Set price **$199 once**. Set the refund window to **14 days** on that kit only. Support text: 60-day Issues, no SLA, hello@yellowgram.dev. The purchase is the Suthirth Commercial Grant plus the kit zip.
- [ ] Attach the deliverable: the GitHub Release asset, plus this SHA-256. Do not attach an unpinned “latest”. Do not attach `burnbrake-0.1.0.zip`.
- [x] Hosted **$59/mo** recurring is **LIVE** (CoS, 2026-09-27). Product `70b1a029-944f-4999-ae39-d39c041ae3e9`. Checkout: https://buy.polar.sh/polar_cl_A2dCr3WcvuTv5lLvNlp8AaC9kziCr8apYfunr0f60ci. Admin: https://polar.sh/dashboard/suthirth-solutions/products/70b1a029-944f-4999-ae39-d39c041ae3e9. No zip and no GitHub benefit. It does not grant self-host production rights. Do not fold it into the $199 SKU. Do not add coupons. Do not send cold invoices. Soft-WTP stays off. The 14-day refund stays on the $199 kit only. Do not copy the checkout URL into `README.md` or any file that ships in the zip.
- [ ] Publish the **$199 kit** Polar product only after the steps above. Until that publish, the listing is not live.
- [ ] Update the yellowgram.dev Current card: BurnBrake, $199 once, 14-day refund, source-available commercial, tag `v0.1.1`, hosted $59/mo called out as optional, live, separate, and not the grant. Do not add a checkout URL to the BurnBrake README.

---

## Zip versus git

In the zip (under `burnbrake-0.1.1/`):

- Product docs a buyer needs: `README.md`, `docs/START_HERE.md`, `docs/DEMO_60S.md`, `docs/OPERATOR.md`, `docs/OPERATOR_NEEDS.md`, `docs/SUPPORT.md`, `docs/MINIMUM_SUPPORT.md`, `docs/COMMERCIAL_LOCK.md`, `docs/COMMERCIAL_GRANT.md`, `docs/MVP_SCOPE.md`, `docs/DESIGN_BRAKE_CURVE.md`
- `LICENSE`, `CHANGELOG.md`, `config.example.env`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `tsconfig.json`
- `package.json`, `package-lock.json`, `prices/*.yaml`, `src/**`, `scripts/demo-60s.ts`, built `dist/**` (JavaScript, declarations, source maps)

Not in the zip (kept in git, or never shipped):

- This file, `checksums/`, `scripts/pack-release.sh`, `scripts/reserve-race-child.ts`, `test/`
- CR*, DR*, and LaunchGate attack logs and briefs (`docs/CR*`, `docs/DR*`, `docs/LAUNCHGATE*`, `docs/DESIGN_PASS_1.md`)
- `.git`, `node_modules`, `data/`, `*.sqlite`, `.env`, real provider keys
- Checkout URLs

Exact member list (`checksums/burnbrake-0.1.1.manifest.txt`):

```text
burnbrake-0.1.1/.dockerignore
burnbrake-0.1.1/CHANGELOG.md
burnbrake-0.1.1/Dockerfile
burnbrake-0.1.1/LICENSE
burnbrake-0.1.1/README.md
burnbrake-0.1.1/config.example.env
burnbrake-0.1.1/dist/auth.d.ts
burnbrake-0.1.1/dist/auth.js
burnbrake-0.1.1/dist/auth.js.map
burnbrake-0.1.1/dist/brake.d.ts
burnbrake-0.1.1/dist/brake.js
burnbrake-0.1.1/dist/brake.js.map
burnbrake-0.1.1/dist/cli.d.ts
burnbrake-0.1.1/dist/cli.js
burnbrake-0.1.1/dist/cli.js.map
burnbrake-0.1.1/dist/config.d.ts
burnbrake-0.1.1/dist/config.js
burnbrake-0.1.1/dist/config.js.map
burnbrake-0.1.1/dist/constants.d.ts
burnbrake-0.1.1/dist/constants.js
burnbrake-0.1.1/dist/constants.js.map
burnbrake-0.1.1/dist/errors.d.ts
burnbrake-0.1.1/dist/errors.js
burnbrake-0.1.1/dist/errors.js.map
burnbrake-0.1.1/dist/estimate.d.ts
burnbrake-0.1.1/dist/estimate.js
burnbrake-0.1.1/dist/estimate.js.map
burnbrake-0.1.1/dist/ledger.d.ts
burnbrake-0.1.1/dist/ledger.js
burnbrake-0.1.1/dist/ledger.js.map
burnbrake-0.1.1/dist/money.d.ts
burnbrake-0.1.1/dist/money.js
burnbrake-0.1.1/dist/money.js.map
burnbrake-0.1.1/dist/prices.d.ts
burnbrake-0.1.1/dist/prices.js
burnbrake-0.1.1/dist/prices.js.map
burnbrake-0.1.1/dist/sdk/index.d.ts
burnbrake-0.1.1/dist/sdk/index.js
burnbrake-0.1.1/dist/sdk/index.js.map
burnbrake-0.1.1/dist/server.d.ts
burnbrake-0.1.1/dist/server.js
burnbrake-0.1.1/dist/server.js.map
burnbrake-0.1.1/dist/upstream.d.ts
burnbrake-0.1.1/dist/upstream.js
burnbrake-0.1.1/dist/upstream.js.map
burnbrake-0.1.1/docker-compose.yml
burnbrake-0.1.1/docs/COMMERCIAL_GRANT.md
burnbrake-0.1.1/docs/COMMERCIAL_LOCK.md
burnbrake-0.1.1/docs/DEMO_60S.md
burnbrake-0.1.1/docs/DESIGN_BRAKE_CURVE.md
burnbrake-0.1.1/docs/MINIMUM_SUPPORT.md
burnbrake-0.1.1/docs/MVP_SCOPE.md
burnbrake-0.1.1/docs/OPERATOR.md
burnbrake-0.1.1/docs/OPERATOR_NEEDS.md
burnbrake-0.1.1/docs/START_HERE.md
burnbrake-0.1.1/docs/SUPPORT.md
burnbrake-0.1.1/package-lock.json
burnbrake-0.1.1/package.json
burnbrake-0.1.1/prices/openai.yaml
burnbrake-0.1.1/scripts/demo-60s.ts
burnbrake-0.1.1/src/auth.ts
burnbrake-0.1.1/src/brake.ts
burnbrake-0.1.1/src/cli.ts
burnbrake-0.1.1/src/config.ts
burnbrake-0.1.1/src/constants.ts
burnbrake-0.1.1/src/errors.ts
burnbrake-0.1.1/src/estimate.ts
burnbrake-0.1.1/src/ledger.ts
burnbrake-0.1.1/src/money.ts
burnbrake-0.1.1/src/prices.ts
burnbrake-0.1.1/src/sdk/index.ts
burnbrake-0.1.1/src/server.ts
burnbrake-0.1.1/src/upstream.ts
burnbrake-0.1.1/tsconfig.json
```

Placeholder keys in `config.example.env` (`bb_replace_me`, `bb_operator_replace_me`) are public localhost samples. They are not live secrets.

---

## Rebuild

From a clean checkout of the commit you are about to tag, and only after License Gate and LaunchGate say go:

```bash
bash scripts/pack-release.sh
```

That runs `npm ci`, `npm run build`, and writes `dist/release/burnbrake-0.1.1.zip`. The default mode checks the digest. It does not rewrite `checksums/` unless you pass `--write` after an intentional kit change. `--write` for 0.1.1 must not touch `checksums/burnbrake-0.1.0.*`. After `--write`, update the SHA-256 lines in this file to the new digest before tagging.

Sealed with Node v22.14.0 and the TypeScript version pinned in `package-lock.json`. Re-seal on Node 22. Timestamps inside the zip are fixed at 1980-01-01 so the bytes do not depend on the clock.

---

## Release recipe

Do not run this from the license-fence pull request. Tag `v0.1.1` stays unpushed until License Gate and LaunchGate say go. Do not move tag `v0.1.0`.

Run this only after the fence commit is on `main`. The zip SHA below is a file digest, not a git commit SHA. Rebuild on that commit and require a match before `gh release create`.

```bash
git fetch origin main
git checkout main
git pull origin main
# HEAD must be the license-fence tree. Do not retag v0.1.0.
bash scripts/pack-release.sh
git tag -a v0.1.1 -m "BurnBrake v0.1.1 license fence"
git push origin v0.1.1

gh release create v0.1.1 dist/release/burnbrake-0.1.1.zip \
  --repo yellowgram/burnbrake \
  --title "BurnBrake v0.1.1" \
  --notes "$(cat <<'EOF'
# BurnBrake v0.1.1

License fence. Self-host one-org kit. Seller: Suthirth solutions.
Source-available commercial. OSI open source: false.

## Asset

- File: `burnbrake-0.1.1.zip`
- SHA-256: `25b42eedfdcced6ac9c6e1a3ef4c70e7d46cc707af7798dcfcb53565f81302e2`

Verify:

    sha256sum burnbrake-0.1.1.zip

The digest must match `checksums/burnbrake-0.1.1.sha256` on tag `v0.1.1`.
The historical v0.1.0 zip is a different file and is not this asset.

## What you get

Suthirth Commercial Grant, the packaged self-host kit, and 60-day Issues for one organization and this named tag, perpetual for that tag. Published source is PolyForm Noncommercial 1.0.0. Commercial production use of the kit requires the grant. Sidecar rejects the next completion when the reserve (including debt) cannot cover a conservative estimate. Unzip, `cd burnbrake-0.1.1`, `npm ci` (Node 22.13+), then `npm run demo` or `node dist/cli.js serve`.

## Commercial

- Price: **$199 once**
- Refund: **14 days** on this kit only
- Support: **60-day GitHub Issues**, no SLA. hello@yellowgram.dev
- Hosted **$59/mo** is optional, separate, and is not this asset
- Soft-WTP, coupons, and cold invoices: none

## Exhaust

HTTP **402** / `BUDGET_EXHAUSTED` / halt / **not retryable**. Not 429.

One already-forwarded call may still overshoot. There is no claim that BurnBrake will outrun OpenAI forever.

This release is the kit. It is not a Polar checkout. The $199 kit listing is not live until CoS publishes the re-list.
EOF
)"
```

The release is not created from this pull request. Do not upload a zip built from the PR branch if the merge changes file bytes. The script is the check.

---

## Ready-gate

- [x] MVP sidecar merged to `main`
- [x] Brake curve **BB_BRAKE_CURVE_1** merged. `brake.enabled` defaults to false. Exhaust is still HTTP 402, halt, not retryable, never 429
- [x] CI smoke merged (typecheck, unit tests, and build on Node 22)
- [x] LaunchGate 4th DR verdict on file: **APPROVE_WITH_CHANGES** (`docs/LAUNCHGATE_DR4_VERDICT.md`). This checklist does not invent a 4th CR verdict file. The implementation is already on `main`.
- [x] Stranger path (README, `docs/START_HERE.md`, `docs/MINIMUM_SUPPORT.md`, `docs/DEMO_60S.md`) describes HTTP **402**, not a draft status
- [x] 60s demo script ships in the kit (`npm run demo`, mock upstream)
- [x] Operator CLI and operator HTTP shipped
- [x] Historical zip `burnbrake-0.1.0.zip` left sealed. SHA-256 `585347975892f29d2e0056fd062eee8520c41d15a152c37e2ce31477ba915cf8` remains `checksums/burnbrake-0.1.0.sha256`. Tag `v0.1.0` is not rewritten.
- [x] Zip `burnbrake-0.1.1.zip` built. SHA-256 `25b42eedfdcced6ac9c6e1a3ef4c70e7d46cc707af7798dcfcb53565f81302e2` recorded in `checksums/burnbrake-0.1.1.sha256`
- [x] Refund **14 days** on the $199 kit only
- [x] Soft-WTP off. No Autumn smuggle. No checkout URL in the README or the zip
- [x] Copyright is PolyForm Noncommercial 1.0.0 plus the Suthirth Commercial Grant. Source-available: true. OSI open source: false.
- [x] Hosted Polar product **LIVE** — **$59/mo** recurring, product `70b1a029-944f-4999-ae39-d39c041ae3e9`. No zip benefit. Soft-WTP off. Checkout URL stays in this file only.
- [ ] Tag `v0.1.1` pushed — only after License Gate and LaunchGate say go
- [ ] $199 kit Polar listing published under this fence — CoS only, after the Release asset exists. Prior product `b5649684-58ff-498c-a135-0b4b44623c3b` unlisted. Not claimed live here.
- [ ] yellowgram.dev Current card updated — CoS only, after the kit publish

---

## Hard fences

- Soft-WTP / coupons / cold invoices **forbidden**
- Cap + kill only. No credits, entitlements, or invoice-overage on the spend path
- Kit commerce is not in-path OpenAI metering
- Do not claim the **$199 kit** Polar listing is already live. The hosted **$59/mo** product is live. Its checkout URL stays in this file only.
- Do not call this OSI open source
- Do not change the exhaust contract to seal this kit
- Do not reseal `v0.1.0` or rewrite `checksums/burnbrake-0.1.0.*`
- Do not push tag `v0.1.1` until License Gate and LaunchGate say go

*License fence packed for CoS. $199 kit listing not live. Hosted $59/mo listing LIVE (product `70b1a029-944f-4999-ae39-d39c041ae3e9`). v0.1.0 checksums untouched. Tag v0.1.1 not pushed. Last updated: 2026-09-27. Soft-WTP off. Exhaust unchanged.*
