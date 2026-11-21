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
