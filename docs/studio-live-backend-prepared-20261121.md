# Branchline unified Studios — live backend preparation status
Date: 2026-11-21 (Asia/Manila)

## Changes actually installed, verified
In the **existing PTG Supabase project** `agknxlowackphvwyvxge`:
- Additive migration applied as `20261121152744_ptg_studio_access_tickets_and_proof_sessions`. Created RLS-only, service-role protected tables: `ptg_studio_access_tickets`, `ptg_studio_proof_sessions`, `ptg_studio_issue_limits` and a service-only quota RPC.
- Additive migration applied as `20261121152749_ptg_studio_cloud_backups_encrypted`. Created service-only, AES-GCM-ciphertext `ptg_studio_cloud_backups` and compare-and-swap RPC.
- Verified all four new tables have RLS enabled and no `anon` or `authenticated` grants.
- Deployed **new** Supabase Edge Function `ptg-studio-access`, version 1, `verify_jwt=false` (the function performs PTG bearer/session verification and signed challenge checks itself). Existing PTG auth/pricing functions were not replaced.

In **MegaFrame** `vmyoxoiygfcecgkbavgg`:
- Deployed **new** `megaframe-editor-delivery` Edge Function, version 1.
- Created empty, private Storage bucket `megaframe-editor-release`, limited to HTML and 16 MB.

In **MegaFlyer** `tzklsscoiwnmeantcefw`:
- Deployed **new** `flyer-editor-delivery` Edge Function, version 1.
- Created empty, private Storage bucket `flyer-editor-release`, limited to HTML and 6 MB.

Neither Studio's existing public editor or storage was modified. The four GitHub PRs are still draft. The functions being ACTIVE in the deployment API **does not** prove that Studio sign-in works or owner Drive OAuth can refresh.

## Owner-confirmed setup
User confirmed saving these three Edge Secrets in the existing **PTG** Supabase project:
- `BRANCHLINE_DRIVE_OAUTH_CLIENT_ID`
- `BRANCHLINE_DRIVE_OAUTH_CLIENT_SECRET`
- `BRANCHLINE_DRIVE_OAUTH_REFRESH_TOKEN`

The connector does **not** expose secret values or allow secret writes: no secret contents were examined, and actual owner Google authorization has NOT been live-tested.

## Remaining configuration — do not disclose secrets in chat
### PTG secret settings
Use https://supabase.com/dashboard/project/agknxlowackphvwyvxge/functions/secrets

- `PTG_STUDIO_ISSUER_ORIGIN = https://kzamora19.github.io`
- `PTG_STUDIO_GATEWAY_SECRET = <a new cryptographically random string, at least 32 characters>`
- `PTG_STUDIO_DRAFT_RECOVERY_SECRET = <a different cryptographically random string, at least 32 characters>`

The recovery secret must be backed up securely and remain stable or previously encrypted drafts/backups may become unreadable.

### MegaFrame secret settings
Use https://supabase.com/dashboard/project/vmyoxoiygfcecgkbavgg/functions/secrets

- `PTG_STUDIO_DEPLOYMENT_MODE = production`
- `PTG_STUDIO_GATEWAY_URL = https://agknxlowackphvwyvxge.supabase.co/functions/v1/ptg-studio-access`
- `MEGAFRAME_STUDIO_ALLOWED_ORIGIN = https://kzamora19.github.io`
- `MEGAFRAME_PTG_STUDIO_GATEWAY_SECRET` must be **exactly equal** to the PTG `PTG_STUDIO_GATEWAY_SECRET`.
- `MEGAFRAME_PRIVATE_BUNDLE_PATH = releases/<sha-prefix>/studio.html` (not ready; bundle must first be built, privately uploaded and inspected).
- `MEGAFRAME_PRIVATE_BUNDLE_SHA256 = <exact 64-character SHA-256 of the uploaded private HTML>` (not ready yet).

### MegaFlyer secret settings
Use https://supabase.com/dashboard/project/tzklsscoiwnmeantcefw/functions/secrets

- `PTG_STUDIO_DEPLOYMENT_MODE = production`
- `PTG_STUDIO_GATEWAY_URL = https://agknxlowackphvwyvxge.supabase.co/functions/v1/ptg-studio-access`
- `FLYER_STUDIO_ALLOWED_ORIGIN = https://kzamora19.github.io`
- `FLYER_PTG_STUDIO_GATEWAY_SECRET` must be **exactly equal** to the PTG `PTG_STUDIO_GATEWAY_SECRET`.
- `FLYER_PRIVATE_BUNDLE_PATH = releases/<sha-prefix>/studio.html` (not ready).
- `FLYER_PRIVATE_BUNDLE_SHA256 = <exact 64-character SHA-256 of the privately uploaded HTML>` (not ready).

## Remaining real release requirements
1. Verify that the actual saved Google refresh token belongs to the approved owner account; confirm `drive.file` scope and avoid Testing mode 7-day refresh expiry for production.
2. Build both Studio private HTML bundles and upload to their NEW private release buckets. Hash-match each to release configuration; verify no anonymous file listing/download.
3. Test actual allowed and denied PTG account roles, denial without ticket, one-use replay, forced logout/revocation, private editor printing PNG/PDF and restoration across two devices.
4. Check current PWA cached data, local/cloud project migration and rollback. Do not delete local storage or customer projects.
5. Only after acceptance, coordinate four PR merges and public GitHub Pages cutover. CURRENT public apps stay unchanged.

> Critical distinction: All three protected Edge Functions are installed but not known to be configured. The private bundle buckets are EMPTY. Installation is NOT activation and NOT production release.
> The historical GitHub migration filenames differ from the version IDs produced by the Supabase migration connector; reconcile migration history before running automated `db push` against PTG.

Security reference: https://supabase.com/docs/guides/functions/secrets


## Live Google OAuth verification — 22 November 2026

- The user confirmed completing Google Drive API activation in the correct Google Cloud project and saving matching OAuth client credentials and refresh token in PTG Edge Secrets.
- A signed, read-only Google Drive verification on the deployed PTG backend returned **HTTP 200**, status `google_owner_authorized_and_drive_api_ready`.
- The diagnostic checked that Google's refresh-token endpoint issued an access token, that Drive `about.get` returned the **approved owner address**, and that the Drive `files.list` endpoint was callable. It did not download, modify, create or upload any Drive file.
- The one-time diagnostic Edge endpoint was subsequently **disabled (HTTP 410, JWT required)** and its GitHub Action workflow and runner script removed from the development PR.
- **Important:** This confirms OAuth and API connectivity, not successful encrypted `centralDriveOperation` writes, restores, cross-device decryption, or long-term token persistence. Google External Testing mode can cause refresh-token expiry; verify OAuth publishing status before relying on permanent backups.
- The production user-facing Branchline/PTG/Studio release remains on HOLD until real PTG-role sign-in, permission revocation, project migration/restore, photo privacy, PNG/PDF export and printing tests pass. Four development PRs remain unmerged.


## Real synthetic Google Drive save/retrieve verification — 22 November 2026

After OAuth/client and Google Drive API activation, a single-use GitHub-OIDC-attested Supabase canary exercised **the same `studio-central-drive.mjs` backend used by PTG** against the real owner's Google Drive:

- MegaFrame: **PASS** `megaframe:ok`.
- MegaFlyer: **PASS** `flyer:ok`.
- Both were confirmed by [GitHub Actions run 44978909438](https://github.com/kzamora19/first-megasaver-ptg/actions/runs/44978909438) at HTTP 200.
- For each Studio, the canary created a random synthetic PTG actor UUID and a random AES-256-GCM encryption key, wrote a small ciphertext backup, listed it by account/studio scope, retrieved and decrypted it, and asserted that another random PTG actor could not read it. No actual PTG account, staff project or customer image was used.
- The test attempted to delete only each freshly written synthetic file; no cleanup failure was reported. It never deleted any older owner file. The designated central folder may remain in Google Drive for normal future backups.
- The one-time test Edge function is now **disabled (410, verify_jwt=true)** and the temporary GitHub Action and runner files were removed after passing.
- Existing Studio encrypted project UI and decryption across **actual staff devices**, real PTG role authorization, inactive/revoked users, older client drafts, photo operations, and physical printing are **still outstanding**. The canary confirms Google Drive API and server-side ciphertext transport, not a full end-to-end authenticated editor workflow.


## Additive live Pages test launchers — 22 November 2026 (NO FULL CUTOVER)

A controlled, non-destructive Pages deployment has completed successfully:
- MegaFrame `main` commit `4c4c4ebcde2ef6921d14db23af933de3b1fecbdf` added only `studio/{index.html,launch.js,draft-vault.js,central-drive.js}` and a copy step in `scripts/build_pages_site.py`. Root editor/PWA remains public and byte-for-byte unchanged. [Deploy run 44980279851](https://github.com/kzamora19/megaframe-studio/actions/runs/44980279851) succeeded.
- MegaFlyer `main` commit `61463a196176ca5d8214da9f553b4e36bf819cb3` added only four files under `site/studio/`; original editor files were untouched. [Deploy run 44980327956](https://github.com/kzamora19/flyer-studio/actions/runs/44980327956) succeeded.
- PTG production GitHub Pages branch `migration/github-pages` commit `5518c0f87ae8825fb69fdd43735555a7a2e18a3d` added only the `app/studios/page.tsx` portal and protected endpoint URLs in the existing Pages build environment. It did not publish unified Branchline navigation or retire old editor routes. [Deploy run 44980413172](https://github.com/kzamora19/first-megasaver-ptg/actions/runs/44980413172) succeeded.
- [Live HTTP smoke run 44980539481](https://github.com/kzamora19/first-megasaver-ptg/actions/runs/44980539481) confirmed HTTP 200 for PTG portal, both secured launcher URLs and their JS, and both original editor URLs. It verified that original editors were not replaced. Additional unsigned Chromium gate is in progress separately.
- The live **test** URL is `https://kzamora19.github.io/first-megasaver-ptg/studios/`. PTG Team Leader or higher must authenticate using their **existing** account; public/direct users cannot redeem a private ticket.

**Important:** This is a limited LIVE TEST ROUTE, not the synchronized Branchline four-app public release. Old direct public editor URLs remain available as before; do not represent them as gated until atomic source-retirement cutover is approved. Real PTG user flows, saved project restoration on devices, force logout, printers and legacy browser storage migration remain release blockers. No production account, customer file, PWA draft or Supabase user table was modified by the additive Pages commits.
