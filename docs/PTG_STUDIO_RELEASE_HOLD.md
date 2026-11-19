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
