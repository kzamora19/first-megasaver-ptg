# GitHub Pages and Supabase migration plan

## Starting point

- Migration branch: `migration/github-pages`, created from `migration/scaffold` at commit `90f5d6aa0b2123d93ec2e15cdfe43627897d528d`.
- PTG remains private. The repository currently has GitHub Pages disabled.
- The current app is Next.js 16 and relies on Node.js route handlers, server components, HTTP-only cookies, and a Supabase service-role client.
- GitHub Pages serves static files. It cannot run the current `app/api/**/route.ts` handlers or Next.js server session checks.
- Supabase project data and the production Apps Script remain outside this migration until explicitly moved or cut over.

## Target shape

1. Build the user interface as a static client app and publish only its compiled assets to GitHub Pages.
2. Keep Supabase Auth as the identity provider. Browser calls use the publishable key and the signed-in user's access token.
3. Put privileged workflows in Supabase Edge Functions. Never put a Supabase secret/service-role key in the static bundle.
4. Apply RLS to every browser-accessible table and Storage bucket. Edge Functions that need elevated access must authenticate the caller, verify PTG role/branch permissions, validate input, and write audit records.
5. Keep the four branches and shared price memo/product behavior intact.

## Route migration map

| Current Next.js route | Migration direction |
| --- | --- |
| `/api/auth/login`, `session`, `logout`, `change-password` | Supabase Auth browser flow plus an Edge Function for username-to-account resolution and PTG session policy. Preserve branch status checks, failed-login controls, idle timeout, absolute lifetime, and revocation. |
| `/api/products/search`, `products/master` | Authenticated browser queries under RLS where possible; use an Edge Function only for joins/search behavior that cannot be expressed safely with the current policies. |
| `/api/price-memos/import` | Authenticated Edge Function calling the existing atomic import RPC, validating role, payload and shared (all-branch) scope, and recording audit data. |
| `/api/admin/accounts/**`, `/api/invitations/**`, `/api/setup/**` | Authenticated Edge Functions for privileged Auth Admin operations, invitation tokens, email delivery and first-admin setup. Keep secret keys server-side. |
| `/api/logos` | Public read through safe logo metadata/public Storage URLs; authenticated System Admin Edge Functions for upload, replacement, removal and audit. |
| Next.js protected server pages | Static routes with a client-side auth gate. RLS and Edge Function authorization remain the actual security boundary; hiding a page is not authorization. |

## Current code progress

The first code slice on `migration/github-pages` moves protected page rendering and role-based navigation into a shared client session gate. The dashboard, product search, memo import, product master, account administration, Logo Manager, and invitation token page no longer need server-side page rendering. The session response now includes the branch and password-change fields those screens require.

This is an intermediate step: the gate still calls the existing Next.js `/api/auth/session` route, and the `app/api/**` handlers plus `proxy.ts` still require a server. GitHub Pages export is not enabled yet. The initial `ptg-auth` Edge Function source is now in `supabase/functions/ptg-auth/index.ts`; it covers username login, session validation, logout, and password change. It preserves the existing 30-minute idle timeout, 8-hour maximum lifetime, active-branch checks, account status, failed-login lockout, and audit record for initial password changes. Its deployment to the First Megasaver PTG Supabase project was blocked by the approval review because it is a live service-role-backed authentication endpoint with platform JWT verification disabled. No function was deployed. The next implementation stage is moving the remaining API operations to Edge Functions, then replacing the remaining server-only calls before enabling static export.

## Work sequence

1. **Foundation:** establish a static build/deploy workflow on this branch and identify every runtime-only Next.js dependency.
2. **Auth and authorization:** define the browser session design, preserve username login and PTG timeout/revocation semantics, and review all RLS policies before moving privileged work.
3. **Read-only product flow:** migrate product master and memo search, then validate branch filtering and universal memo visibility.
4. **Import and price tags:** move memo import to an authenticated Edge Function and retain the current atomic database RPC; verify duplicate replace/skip and print preview behavior.
5. **Admin and branding:** migrate invitation/account management and Logo Manager into secured Edge Functions, including Storage policies and email delivery.
6. **Acceptance and cutover:** compare against the supplied PTG screens and operating scripts, test all four branches, and keep Apps Script as production until the replacement is accepted.

## Guardrails and open platform constraint

- Do not change or deploy the production Apps Script.
- Do not make the GitHub repository public.
- GitHub documents Pages for private repositories on GitHub Pro, Team, or Enterprise; GitHub Free requires a public repository for Pages. Confirm the account plan before enabling Pages.
- GitHub Pages sites are public on the internet by default, even when the source repository is private. GitHub Enterprise Cloud can support private publication restricted to organization members; confirm the account and site visibility requirements before publishing the PTG login surface.
- No user accounts, passwords, production data, sessions, or logos are copied by this planning step.
