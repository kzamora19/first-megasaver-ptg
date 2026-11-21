# Hosted PTG + MegaFrame + MegaFlyer staging acceptance

**Staged source only. Production unchanged. Do not merge/deploy until separately approved.**

## Why a separate project is mandatory

The connected Supabase projects named **First Megasaver PTG**, **MegaFrame Studio**, and **Flyer Studio** are active applications. There is currently **no existing hosted development branch or project** designated for this integration. Those projects and the other connected primary project must not be used as a scratch database. Both Studio delivery Edge functions now reject staging mode when configured against **any** of the four existing live project refs.

For least cost and simpler setup, a **single additional dedicated Supabase staging project** can host all three Edge Functions: `ptg-studio-access`, `megaframe-editor-delivery`, and `flyer-editor-delivery`. It also hosts two distinct **private** Storage buckets (`megaframe-editor-release` and `flyer-editor-release`) containing the staged, SHA-256-pinned private HTML bundles. PTG integration tables and synthetic staging test accounts are created **only** in this new project.

Creating a project or a Supabase development branch may incur recurring charges. Select a connected organization and approve any quoted nonzero cost **before provisioning**. Never create a staging branch with a copy of production user data.

## Secure configuration (one isolated hosted project)

Use the **new** staging project's URL; never use existing PTG, MegaFrame, MegaFlyer, or Ken's Project URLs for staging.

1. Deploy the staged PTG Studio SQL schema and its permission/RLS checks **to the staging project only**. Create synthetic `auth.users`, `user_profiles`, `app_sessions` and `branches` entries that match the real PTG schema. Configure a valid Team Leader or Branch Admin test account and a denied ordinary Branch User. Do not copy real customers, staff details or credentials.
2. Deploy `ptg-studio-access` with `PTG_STUDIO_ISSUER_ORIGIN`, a unique `PTG_STUDIO_GATEWAY_SECRET` (minimum 32 characters), and `PTG_STUDIO_DRAFT_RECOVERY_SECRET` (minimum 32 characters). Make sure the Edge Auth-only endpoint and one-time ticket migration pass the local checks before deploying to the isolated project.
3. Upload `private/studio.html` from MegaFrame and MegaFlyer development-only bundle generators to their **distinct, private** buckets. Verify direct `anon` and `authenticated` object reads/listings are blocked by Storage RLS. Store immutable `releases/<SHA-prefix>/studio.html` paths with matching SHA-256 env vars.
4. Deploy each `*-editor-delivery` Edge Function to the staging project using unique bundle SHA/path secrets. Set `PTG_STUDIO_DEPLOYMENT_MODE=staging` and `PTG_STUDIO_GATEWAY_URL=https://<new-staging-ref>.supabase.co/functions/v1/ptg-studio-access`. The code will refuse missing configuration or any of the known live production projects.
5. Configure both Studios' exact `*_STUDIO_ALLOWED_ORIGIN` to the same test issuer origin as PTG. Use a genuinely isolated test front end for browser validation; the Node runner can test HTTP policy but cannot prove OAuth or Chrome PWA behavior on its own. The PWA/public-source cutover must not happen in this step.

## Explicitly gated GitHub Actions acceptance

The development PTG repo contains:

- `tests/studio-hosted-staging-policy.mjs` — fail-closed validation of dedicated staging URL, explicit mode, and synthetic account naming.
- `tests/studio-hosted-staging-policy.test.mjs` — unit tests running automatically with the existing **local-only** four-job security CI.
- `tests/studio-hosted-staging-acceptance.mjs` — optional real hosted HTTPS negative-only preflight or full signed ticket/bundle test.
- `.github/workflows/studio-hosted-staging-acceptance.yml` — **manual workflow_dispatch only**. It is available for an approved release branch/default workflow setup; a draft workflow file that is not on default may need an authorized CI configuration before the Action can be manually dispatched.

Configure a protected GitHub environment named `studio-integration-staging`. Set repo variable `STUDIO_HOSTED_ACCEPTANCE_APPROVED=true` only for staging testing. Configure the following in that **protected environment** (not in public GitHub Pages code):

| Setting | Type | Purpose |
|---|---|---|
| `STUDIO_STAGING_SUPABASE_URL` | secret | Exact URL of dedicated Supabase staging project |
| `STUDIO_STAGING_PUBLISHABLE_KEY` | secret | Staging publishable / anon key (never service role) |
| `STUDIO_STAGING_ISSUER_ORIGIN` | variable | Exact HTTPS staging launcher origin |
| `STUDIO_STAGING_ALLOWED_EMAIL` / `PASSWORD` | secrets | Synthetic permitted TL+ account; name must match `studio-ci-*@example.invalid` |
| `STUDIO_STAGING_ALLOWED_APP_SESSION_ID` | secret | Existing synthetic active PTG app session UUID |
| `STUDIO_STAGING_DENIED_EMAIL` / `PASSWORD` | secrets | Synthetic ordinary branch-user account |
| `STUDIO_STAGING_DENIED_APP_SESSION_ID` | secret | Existing synthetic denied PTG app session UUID |

No personal customer passwords or service-role keys are required by the hosted **test runner**.

Run **preflight** first. Expected: STAGING PTG refuses missing bearer (401), wrong Origin (403); each Studio refuses forged ticket (403) and public GET bytes. A 503 fails the test as **not configured**. Then run **full**, which uses only synthetic GoTrue accounts and tests real PTG issue, both SHA-verified private HTML bundles, account draft keys, P-256 signed continuation, ordinary-user denial and replay rejection.

The full runner issues only ephemeral staged tickets; it does not update any hosted account or database record directly, deploy Edge Functions, or delete customer files.

## Tests the runner deliberately cannot substitute for

- Real login in a **browser** using the exact staging origin (not just a scripted Origin header).
- Google provider consent, popup restrictions in opaque-origin iframes and Google Drive backup/restore; the current sandbox denies unrestricted popups.
- Supabase cloud project Save/Retrieve, revisions and cross-device login with actual staging Auth accounts.
- Real printers, print preview and original tag/flyer colors.
- Role revocation/forced logout **after** a signed Studio continuation is already active, using synthetic admin test accounts.
- Legacy public HTML/JS URLs and offline installed-PWA reconnection cutover, manual portable JSON backup migration, and rollback readiness.
- Coordinated, owner-approved deployment of all four applications.

**Release remains HOLD until these checks pass and owner authorizes the cutover.**
