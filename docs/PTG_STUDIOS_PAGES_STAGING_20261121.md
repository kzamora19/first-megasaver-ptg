# PTG Creative Studios — GitHub Pages refresh (staging only)

**NOT DEPLOYED. DO NOT MERGE UNTIL COORDINATED RELEASE.**

This development branch starts from the current migration/github-pages production branch, not the stale feature/ptg-studio-access-gateway-20261119 draft. Live PTG pricing, all seven print formats, memo imports, session controls and GitHub Pages publishing stay unchanged.

## Staged implementation
- /studios Next.js portal uses PTG Auth session and requests server-issued short-lived tickets before redirecting to protected Studio launch pages. Build-time secure destinations are mandatory and fail closed if unset.
- ptg-studio-access Edge Function verifies signed-in immutable PTG user, active app session, profile role, branch ON, revocation, password-change and 10-minute ticket lifetime.
- Ticket hashes and continuation-proof metadata are service-only. No direct client table access or public service-role credentials.
- Source origin is explicitly configured, not guessed from Vercel. Staged Edge config verify_jwt=false applies only to ptg-studio-access because the gateway separately verifies signed PTG auth and server-only Studio secret.
- Shared PTG role policy allows System Admin, Branch Admin, or Branch User with exact legacy Team Leader role. Ordinary Branch Users and Sales Tracker-only users denied.
- The old unconditional Creative Studios navigation link has NOT been included until the actual Team Leader client-role mapping is reviewed. A visible link alone is not authorization.

## Cross-repo release gate
1. MegaFlyer protected editor remains in flyer-studio draft #10, unpublished. Complete actual Cloud Save/Retrieve, image/PDF/PNG export, Google Drive, sandbox origin isolation and revoked session tests.
2. MegaFrame protected bundle and Supabase gateway are staged in megaframe-studio draft #18, unpublished. Complete real photo export, template/backup and browser proof, and test 8MB bundle/performance.
3. Branchline studio navigation is staged in draft #45, unpublished; do not route users to /studios until PTG has working secure destinations.
4. Confirm direct public Pages URLs and historic cached editor code are no longer usable as an authorization bypass after atomic cutover; GitHub Pages cannot enforce private static resource access.
5. Run real PTG TL/Admin/ordinary/inactive/revoked/expired/branch-OFF/forced-logout/browser restore checks using isolated accounts. No production account data is modified for unit tests.
6. Configure secure isolated Studio origins, nonce/replay controls, session renewal and safe unfinished-project recovery.
7. Test build, Edge function, RLS and browser workflows together. Obtain final production-release approval only when all gates pass.

**No Vercel deployments. No Supabase migration, Edge function, branch deployment or user changes in this draft.**
