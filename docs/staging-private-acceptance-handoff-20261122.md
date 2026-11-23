# Branchline isolated hosted staging — private editor upload and synthetic role tests

**Deployment status:** prepared source and guarded Actions workflow only. There has been NO production cutover, and no hosted authorized-user pass yet.

## Isolated resources

- Staging Supabase project: `rlfdvmiqkbitetatxkju` (Singapore).
- Temporary PTG test branch: `STG001`, not a real store.
- Private buckets only: `megaframe-editor-release` and `flyer-editor-release`. No public Storage policies.
- PTG authority: `ptg-studio-access`; delivery: `megaframe-editor-delivery`, `flyer-editor-delivery`.

## Verified immutable private editors

The development sources independently built and SHA-verified (GitHub Actions, no delivery):

| Studio | Bytes | Exact SHA-256 | Private object path |
|---|---:|---|---|
| MegaFrame | 7,955,494 | `d427621376f4db4cd6afaa53226aca7971ff32d1da1daa81d4e3ec6da694f7f6` | `releases/d427621376f4db4c/studio.html` |
| MegaFlyer | 1,608,722 | `1c82384c40685ea2a3a2c0bc3ef7b09c081ae6bc81a6bc30b3fe63a0b69b4068` | `releases/1c82384c40685ea2/studio.html` |

Both match their staged Edge delivery service's pinned defaults. A changed source must be reviewed and repinned; a mismatched bundle will **not** be uploaded or served.

## Protected GitHub environment prerequisites (owner action)

The connected Supabase tool cannot set or read GitHub Actions encrypted secrets or create Supabase Auth users directly. Do **not** share keys or test passwords in ChatGPT.

Create a protected GitHub Actions environment called `studio-integration-staging` in the **PTG GitHub repository**. Require deployment approval. In it, configure only staging resources:

- Environment secret `STUDIO_STAGING_SUPABASE_URL`: `https://rlfdvmiqkbitetatxkju.supabase.co`
- Environment secret `STUDIO_STAGING_PUBLISHABLE_KEY`: staging project's Supabase publishable API key.
- Environment secret `STUDIO_STAGING_ADMIN_SECRET_KEY`: staging project's server-only secret API key (`sb_secret_...`) from **Project Settings > API Keys**; never a live project key.
- Environment variable `STUDIO_STAGING_ISSUER_ORIGIN`: `https://kzamora19.github.io` for scripted HTTP checks only, matching current staged Edge settings.
- Repository variable `STUDIO_HOSTED_ACCEPTANCE_APPROVED`: `true` only after owner approval to run **staging** fixture tests. No production change is authorized.

The generated random `PTG_STUDIO_GATEWAY_SECRET` is a **different kind** of secret and must not be substituted for the staging Supabase server API key.

## Test workflow and limitations

The development workflow `.github/workflows/studio-staging-private-release.yml`:

1. Must be invoked with explicit `staging-only` confirmation inside the protected environment. It must not run automatically on push with elevated secrets.
2. Checks out the **development integration branches**, never the production app branches.
3. Builds both private HTML bundles into the runner's temporary filesystem, compares their exact byte sizes and SHA-256 values, then uploads only to their distinct private staging Storage buckets, with `upsert:false`. It downloads each object and verifies its SHA again.
4. Creates disposable `studio-ci-*@example.invalid` GoTrue identities for System Admin, Branch Admin, Team Leader (`BRANCH_USER` / `legacy_role=TEAM LEADER`), and an ordinary Branch User. No real names, addresses, customer files or passwords are reused. Runs the existing hosted HTTPS two-Studio test (actual Auth sign-in, private bundle delivery and integrity, signed P-256 continuation, replay denial), plus branch/system role, forced-logout and account-disable tests.
5. Deletes only identities created in that specific run, using Auth Admin API in a `finally` block.

**Workflow availability:** GitHub's manual `workflow_dispatch` may require the workflow file to be on the repository default branch. This file currently lives only in integration development; do not bypass the protected environment or merge the production app. A future separately approved CI-only entrypoint on default may be required to actually dispatch it.

**Still unverified:** Authorized browser launcher, independent test-only browser origin, Google OAuth, actual cloud project Save/Retrieve across devices, real printers, Windows/Android installed PWA behavior and unified production deployment. The current GitHub Pages host is also used by live apps, so it is not an isolated staging *origin*, even if a staging path is used. Do not use successful scripted Origin checks as evidence of real browser isolation.

**Release remains HOLD** on all four integration PRs until complete hosted/browser/device acceptance and separate owner-approved cutover.
