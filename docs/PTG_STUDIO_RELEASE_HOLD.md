# PTG Team Leader+ Studio access — release hold

**Status: DEVELOPMENT ONLY. DO NOT DEPLOY, MERGE OR APPLY PRODUCTION SQL WITHOUT EXPLICIT OWNER APPROVAL.**

## Source of truth
PTG's server-owned `user_profiles.role_key` and `legacy_role` are the only eligibility authority. Allow `SYSTEM_ADMIN`, `BRANCH_ADMIN`, and `BRANCH_USER` with `legacy_role='TEAM LEADER'`, provided the account, branch, and source app session are active. Deny generic Branch Users and any Sales Tracker-only role. Password-change-required users are denied.

## Staged components
- PTG `/studios` launcher and `ptg-studio-access` Supabase Edge Function.
- Service-only table storing **SHA-256 hashes** of scoped 10-minute bearer tickets. No ticket is stored as plaintext in PostgreSQL.
- Server-to-server verification using `PTG_STUDIO_GATEWAY_SECRET` (minimum 32 characters, server-only) on every protected studio request; source PTG session and role are rechecked.
- MegaFrame and Flyer Vercel routing proxies protecting **all** paths, not just the home page. Short-lived tickets become `Secure; HttpOnly; SameSite=Lax` cookies; the browser removes the fragment before exchanging.
- Branchline links are redirected to PTG's own launch portal.
- Public GitHub Pages build workflows are prepared to publish **redirect-only** pages rather than the old unsecured editors.

## Explicit release prerequisites (NOT completed)
1. Review and test all code and database SQL on isolated development resources; existing production Supabase projects and Vercel environments must stay untouched.
2. Apply the scoped ticket migration to the PTG project **only after approval**. Ensure no client RLS policies or anonymous privileges are added.
3. Deploy `ptg-studio-access` with JWT gateway verification off **for that function only**: it implements PTG bearer verification for issue requests and a server-only gateway secret for verify requests.
4. Supply the same high-entropy `PTG_STUDIO_GATEWAY_SECRET` to PTG Edge Function and the **two Vercel Studio deployments**, in server-only runtime variables (never `NEXT_PUBLIC_` or client JS). Configure/confirm the protected Flyer Studio Vercel domain, static `site` output, and exact login URLs.
5. Run real-browser tests on a NON-PRODUCTION staging environment for Team Leader, Branch Admin, System Admin, ordinary Branch User, inactive account, forced logout, password-change-required account, unavailable branch, and expired login.
6. Verify that opening the protected domains **directly** and fetching `index.html`, source JS, images, and API paths without a valid PTG ticket fails. Verify authentication and printing/cloud saving with granted sessions.
7. **Retire the public GitHub Pages editors at the same time as release.** Both repositories currently publish public copies. Pages redirects and old MegaFrame PWA caches are bypasses until that cutover. An installed historical offline copy cannot be remotely erased; the new MegaFrame service worker deletes only old static caches and requires network authorization.
8. Audit existing MegaFrame and Flyer Supabase sign-in/RLS for cloud assets. The PTG gate controls *entry*, but legacy cloud library permissions are separate. Do not claim full cloud single sign-on until implemented.
9. Review ten-minute ticket expiry UX for long editing sessions (likely a sliding extension or grace period). Preserve draft work on expiry; never silently discard it.
10. Finish server-side rate limits, ticket replay limits and abuse monitoring before exposure. Recheck deployment-time Vercel and Supabase settings and run the latest security advisors.
11. Run browser end-to-end regression on both release candidates; deploy only **after an explicit approval request is answered yes**.

No Supabase project, live Vercel site, or GitHub Pages site has been modified by the staged branches.

## Rollback
Keep current production artifacts intact until the new protected sites pass end-to-end tests. If release fails, restore the prior production deployment and rerun the old Pages publishing workflow only with explicit owner approval. Never export PTG refresh tokens to a Studio origin.

## November 20, 2026 — Hosting compatibility hold

The owner now uses **GitHub Pages + Supabase** for PTG and MegaFlyer Studio and does not intend to return to Vercel for this workflow. The hard-coded Vercel PTG portal and Studio proxy URLs in this draft are therefore **unapproved, staging-only placeholders**, not correct live destinations.

The protected editor requires a server-capable hosting solution that can authenticate **every HTML, JavaScript, and image request** before release; a JavaScript-only login screen hosted on public GitHub Pages is not sufficient. Do not replace the Vercel URLs with guessed GitHub Pages URLs as a shortcut, because this would create a direct-link bypass. Verify and approve the actual secure hosting approach, callback domains, and token/session revocation behavior before enabling redirects. GitHub Pages may remain a redirect-only entry page once a protected editor exists.

The portal's user-visible flyer name has been corrected to **MegaFlyer Studio**. No hosting, DNS, deployment, Auth or Supabase credentials were changed by this branding correction.

## November 21, 2026 — Deployment-independent PTG issuer and launcher

- **Staged in this draft:** `PTG_STUDIO_ISSUER_ORIGIN` is now a mandatory exact HTTPS **origin** for PTG Studio issuance. Missing/malformed values fail closed, rather than silently using the old Vercel host.
- Studio destinations are build-time `NEXT_PUBLIC_STUDIO_MEGAFRAME_LAUNCH_URL` and `NEXT_PUBLIC_STUDIO_FLYER_LAUNCH_URL`, and are disabled if absent/invalid. Do not set them to the current public editor URLs; that would defeat app-wide authorization.
- The PTG GitHub Pages migration branch uses `/first-megasaver-ptg` as its base path, but the actual Studio release URLs must still be confirmed and deployed coherently. Both apps need secure code delivery beyond static GitHub Pages.
- GitHub Pages projects under the **same** `kzamora19.github.io` host share a browser origin, even when their paths differ. Do not treat path separation as a secret/token security boundary; review PTG token handling and move protected applications to suitably isolated origins or a hardened server-side delivery model.
- Supabase's default Edge Functions domain does not directly serve GET HTML as `text/html` without a custom domain. A protected-bundle JSON response is technically possible but does not, by itself, solve full revocation, offline copies or all private asset requests. Do not ship this incomplete approach as a finished TL-only application gate.
- **No releases, Edge Function deployments, secrets or production SQL changes** were performed in this staging update.


## November 21 — one-time launch exchange + signed continuation (development only)

- The *draft* PTG authorization service can exchange a valid, unredeemed ten-minute Studio ticket **once** for a short-lived, Studio-scoped proof session. Each PTG ticket is marked `redeemed_at` through a conditional update; repeated exchanges cannot create another proof session.
- The browser creates a **non-extractable ECDSA P-256 private key in memory**. Only its public JWK is sent during exchange. Later Studio checks sign the server's single-use challenge; they do **not** send the original PTG ticket, Supabase refresh token, or PTG application session ID.
- PTG checks the registered public key, challenge hash and atomic challenge rotation on every proof, then rechecks the original PTG source session, account role, branch status, forced logout, and session version. One continuation is capped at **two hours** and may end earlier according to the source PTG session's expiry and inactivity rules. A browser reload requires relaunch from PTG.
- The proof challenge is valid for **120 seconds**: a backgrounded, suspended or offline tab that misses its window must re-enter from PTG. **No silent extension of PTG's 30-minute normal idle rule** has been implemented; active Studio editing can still require reauthorization. This is intentional until real-account UX acceptance.
- The staged SQL adds service-only `ptg_studio_proof_sessions`, and the un-applied staging migration adds `redeemed_at` to Studio tickets. No production SQL, secrets or Edge deployment occurred.
- CI covers role-policy tests, signature tampering, and Deno/Next typechecks; MegaFlyer Chromium tests cryptographically verify the browser signature with a mock gateway. These are **not** proof of transaction isolation, Postgres replay behavior, live Revocation latency or real account authorization.
- Outstanding: validate atomic one-use redemption and challenge rotation against a disposable PTG database; test two concurrent checks, multiple tabs/devices, account revocation, expiry, rate limits and the cross-origin hosting boundary. Add monitoring and a safe public-editor cutover before release. Do not merge PR #38 independently.


## November 21 — isolated PostgreSQL 16 security acceptance

The development-only CI job `ephemeral-postgres` runs the actual staged Studio migration against a **temporary PostgreSQL 16 service** with synthetic PTG roles, sessions, and branches.

Verified in isolated CI:
- `anon` and `authenticated` have no Studio grant/proof table access; RLS is enabled, and service_role permissions are restricted to server use.
- Synthetic System Admin, Branch Admin and Team Leader accounts pass source-session eligibility checks; ordinary, disabled, revoked, expired, password-change-required, stale-session-version, closed-branch and idle accounts fail.
- Multiple concurrent PostgreSQL sessions attempting to redeem one ticket yield exactly **one** successful redemption. Wrong-Studio redemption, expiry, revocation and repeat redemption all fail.
- Multiple concurrent challenge-rotation attempts yield exactly **one** successful update. Replayed challenges, revoked proofs and expired proofs fail.
- SQL enforces the ten-minute launch-ticket TTL and two-hour proof-session maximum.

Tests: `tests/studio-db-bootstrap.sql`, `tests/studio-database-acceptance.test.mjs`, and the `ephemeral-postgres` Actions job. The fixture checks the database name `ptg_studio_test` and the Node test also refuses a non-loopback host.

**Not yet proven:** complete PTG HTTP Edge Function ↔ real PostgREST/Auth behavior; concurrent account revocation *during* exchange, rate-limiting, forced logout propagation timing across real devices, issuer origin/cookie isolation and OAuth handling. No production database was accessed or changed. Maintain draft/HOLD and do not deploy until real-account acceptance and the coordinated cutover.
