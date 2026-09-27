# BurnBrake — Code Review ×3 (CR3) Attack Log — Polar pack v0.1.0

**Superseded by the PolyForm fence.** This attack log is historical audit evidence for the v0.1.0 MIT-era pack. It is not live buyer guidance. Current copyright is source-available commercial: PolyForm Noncommercial 1.0.0 plus the Suthirth Commercial Grant (`docs/COMMERCIAL_GRANT.md`). OSI open source: false. Sentences below that say `LICENSE` stays MIT, that payment does not revoke MIT, that this pass did not replace MIT, or that the $199 listing was unpublished, describe that 2026-09-27 pass only. Tag `v0.1.0` stays MIT historically (grandfathered). It was not rewritten into 0.1.1. The MIT-era $199 Polar SKU is archived. Re-list is on hold.

**Pass:** third hostile review. CR1 and CR2 are not the evidence.
**PR:** https://github.com/yellowgram/burnbrake/pull/7 (`cursor/polar-ready-v010-3c0d`)
**Head reviewed:** `4a7820969232b3922fb70971e38d382ffb14f86a`
**Date:** 2026-09-27
**Scope:** START_HERE versus a production install, MIT versus the $199 fee, pack-script path safety, Actions on that head, CoS “dark forever” leftovers, `sha256sum -c`.
**Stance:** a buyer who follows the written install cannot tell demo from serve; the fee reads as a copyright the MIT file gives away; the zip can escape its directory; CI is red; a CoS who reads the repo is told never to publish; the checksum file is not a real `sha256sum -c` line.
**Outcome:** One P1, fixed in this pass. No P0. Four P2 limits left open. **Verdict: APPROVE** after the fix. The zip was resealed. New SHA-256: `585347975892f29d2e0056fd062eee8520c41d15a152c37e2ce31477ba915cf8`. Previous digest `3326cdb555a76e2437ff1c31ca0957ffc4bf4908837370bcb36f57266d36104c` is superseded.

This file is not a zip member. After it was on disk, `bash scripts/pack-release.sh` still matched the new digest.

Polar stays unpublished. No GitHub Release was created. Soft-WTP stays off. Exhaust bytes were not edited.

---

## Severity legend

| Sev | Meaning |
| --- | --- |
| **P0** | The zip path is absolute or contains `..`, or CI on the reviewed head is red for a product failure. |
| **P1** | A stranger who follows START_HERE cannot tell that demo needs `tsx` while serve uses `dist/`, or the $199 copy and `LICENSE` disagree in a way that invites a chargeback. A CoS checklist that says “dark forever” blocks publish. |
| **P2** | Real limit. Documented. Not changed in this pass except where a P1 edit touched the same paragraph. |

## Tally

| Sev | Found | Fixed this pass | Left open |
| --- | --- | --- | --- |
| P0 | 0 | 0 | 0 |
| P1 | 1 | 1 | 0 |
| P2 | 4 | 0 | 4 |

---

## Attack catalog

### C1 — START_HERE and a production-only install

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | `docs/START_HERE.md` tells the buyer to `npm ci`, says `dist/` is already in the zip, and says `npm run demo` needs devDependencies and not to pass `--omit=dev`. README says `npm ci` is required because `yaml` is not in the archive, and that demo needs the TypeScript runner, so do not pass `--omit=dev`. Serve is `node dist/cli.js serve`. On this pass, after the reseal, a clean unzip plus plain `npm ci` (7 packages) ran `npm run demo`: HTTP 200 then HTTP 402 `BUDGET_EXHAUSTED`, `mock_forward_count` stayed 1, `upstream_forwarded=0`. |
| **Failure mode checked** | The written steps send a buyer into `npm run demo` with no `tsx` and no sentence that `dist/` can serve without it. |
| **Why it is not a founder gate** | The written command is `npm ci`, which installs devDependencies when `NODE_ENV` is unset. The same paragraph names devDependencies as a demo requirement. `--omit=dev` and `NODE_ENV=production` are still outside that sentence. See P2-1. Not edited. |

### C2 — MIT versus the one-org fee

| | |
| --- | --- |
| **Result** | **P1, fixed** |
| **Evidence** | `LICENSE` is the MIT grant: free of charge, including use, copy, and sale. Before this pass, README called the SKU a “one-org license $199 once”, and the Polar paste said “The $199 fee is a perpetual self-host license for one organization.” A buyer can put those sentences next to MIT and dispute the charge as a copyright they were told was free. `git diff origin/main...4a78209 -- LICENSE` is empty. The contradiction is the fee wording, not a new license file. |
| **Failure mode checked** | Polar’s goods description and the file in the zip disagree about what was sold. |
| **Fix** | `LICENSE` stays MIT. README, `docs/COMMERCIAL_LOCK.md`, `docs/MINIMUM_SUPPORT.md`, `docs/MVP_SCOPE.md`, and the Polar paste now say the copyright is MIT, payment does not revoke it, and the $199 buys the packaged kit plus 60-day Issues scoped to one organization. Price, refund, seller, and exhaust were not changed. That edit is inside the zip, so the digest moved. `scripts/pack-release.sh --write` recorded `585347975892f29d2e0056fd062eee8520c41d15a152c37e2ce31477ba915cf8`. A second run matched. `sha256sum -c` on a directory that contains both `burnbrake-0.1.0.zip` and the checksum file printed `OK`. |

### C3 — Zip path traversal, absolute paths, symlinks

| | |
| --- | --- |
| **Result** | **Pass** for the sealed archive. |
| **Evidence** | All 73 `ZipInfo` names are relative, under `burnbrake-0.1.0/`. None start with `/` or contain a `..` part. `external_attr` is a regular file `0644` (no symlink mode). The working tree has no symlink outside `.git` and `node_modules`. The script builds arc names as `burnbrake-0.1.0/` plus a path from `Path.relative_to`, and it refuses a member whose bytes contain the absolute build root. |
| **Failure mode checked** | Unzip writes outside the destination, or a symlink in `src/` is stored as a link that points at the packer’s disk. |
| **Why extract stays inside the tree** | Names are relative. The mode bit is a regular file, so a followed symlink is stored as bytes, not as a link. The script does not refuse a symlink before reading it. See P2-2. Not edited. |

### C4 — CI on the reviewed head

| | |
| --- | --- |
| **Result** | **Pass** on `4a7820969232b3922fb70971e38d382ffb14f86a` |
| **Evidence** | Actions run [36292379265](https://github.com/yellowgram/burnbrake/actions/runs/36292379265) (`pull_request`, branch `cursor/polar-ready-v010-3c0d`) completed **success**. Job “typecheck and test” passed. `headSha` is that commit. Local `npm test` after the P1 edit: 74 pass, 0 fail. The reseal commit is a later head. Its Actions run is not this row. |
| **Failure mode checked** | The head under review is red, or the check is for an older SHA. |
| **Why this row counts** | The run URL’s head SHA matches the commit this pass started from. |

### C5 — “Polar dark forever” versus CoS publish

| | |
| --- | --- |
| **Result** | **Pass** for the checklist a CoS is told to follow. |
| **Evidence** | `docs/POLAR_DELIVERABLES.md` status is “pack ready for CoS Polar publish”, founder GO received, listing **not live**, and the checklist includes “Publish the Polar product” under “BurnBrake will not do these clicks.” A scan of all 73 zip members for `dark forever`, `stays dark`, `not Polar-ready`, `listing DARK`, and `Do not light` found none. Zip docs say the listing is not live and that Suthirth solutions publishes after founder GO. |
| **Failure mode checked** | The publish checklist, or the buyer kit, says the listing stays dark with no GO path. |
| **Why CoS is not blocked** | “Not live” is the current fact. The same files name who publishes. Older git-only briefs still say “stays dark”. See P2-3. |

### C6 — Checksum file versus `sha256sum -c`

| | |
| --- | --- |
| **Result** | **Pass** for the file format. |
| **Evidence** | `checksums/burnbrake-0.1.0.sha256` is one line: 64 hex digits, two spaces, `burnbrake-0.1.0.zip`, newline. That is the text-mode line `sha256sum -c` reads. Copied the resealed zip to `/tmp/bb-c3b/burnbrake-0.1.0.zip` next to that file. `sha256sum -c burnbrake-0.1.0.sha256` printed `burnbrake-0.1.0.zip: OK`. From the repo root, the same file fails open because it looks for `./burnbrake-0.1.0.zip` while the script writes `dist/release/burnbrake-0.1.0.zip`. That is a path, not a bad digest line. See P2-4. |
| **Failure mode checked** | The committed line uses one space, a backslash escape, or a path `sha256sum -c` will not accept when the zip has the published name. |
| **Why the format holds** | Two spaces and the asset basename. The successful `-c` run used the resealed bytes. |

---

## P2 limits (not changed)

### P2-1 — `NODE_ENV=production` still omits `tsx`

START_HERE forbids `--omit=dev` for the demo and does not mention `NODE_ENV`. `npm ci` under `NODE_ENV=production` omits devDependencies the same way. Demo then cannot find `tsx`. `node dist/cli.js serve` does not need `tsx`. Not edited in this pass.

### P2-2 — The pack script follows symlinks

`Path.read_bytes` reads the target. Nothing in this tree is a symlink, and the zip mode is a regular file, so this archive does not extract a link. A later symlink under `src/` would be copied in as file bytes under a repo-relative name. The script does not call `is_symlink()`. Not edited.

### P2-3 — Older git docs still say the listing stays dark

`docs/CR1_CI_SMOKE_ATTACKS.md`, `docs/CR2_CI_SMOKE_ATTACKS.md`, `docs/CR3_CI_SMOKE_ATTACKS.md`, `docs/DESIGN_PASS_1.md`, and `docs/LAUNCHGATE_CR4_BRIEF.md` still describe an earlier “Polar stays dark / do not light” state. They are not in the buyer zip. `docs/POLAR_DELIVERABLES.md` is the CoS checklist and it says publish. Not edited.

### P2-4 — `sha256sum -c` from the repo root looks in the wrong place

The checksum names `burnbrake-0.1.0.zip`. The script’s output path is `dist/release/burnbrake-0.1.0.zip`. `-c` from the repo root reports “No such file”, not a digest mismatch. `-c` beside a zip of that name succeeds. Not edited.

CR1 P2-1 through P2-8 and CR2 P2-1 through P2-5 stay open except where this P1 replaced the fee wording those logs quoted. This pass did not treat those logs as a new test.

---

## What this pass did not do

- Did not change `src/`, exhaust, or brake defaults
- Did not replace MIT with a proprietary license
- Did not merge PR #7
- Did not create the GitHub Release
- Did not publish Polar

**APPROVE.** No P0. The one P1 is fixed. P2-1 through P2-4 stay open. Publish only if `scripts/pack-release.sh` on the squash commit prints `585347975892f29d2e0056fd062eee8520c41d15a152c37e2ce31477ba915cf8`.
