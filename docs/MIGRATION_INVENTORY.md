# First Megasaver PTG — Migration Inventory

## Source package reviewed

The migration baseline is the 11 source files supplied for this project:

- `SYSTEMSECURITY(9).GS` — 86 server-side functions; authentication, branch registry, role permissions, sessions, audit records, maintenance/master controls, and deployment configuration.
- `CODE(7).GS` — 60 server-side functions; price memos, product master/SRP, memo parsing/import, logo files, and PTG page routing.
- `UniversalLogin(2).HTML` — universal login interface.
- `BRANCHLOGIN(5).HTML` — branch login interface.
- `SYSTEMSECURITY(3).HTML` — system security and administration interface.
- `PRICETAGGENERATOR(7).HTML` — primary generator interface and print layouts.
- `DeleteOldMemo(2).HTML` — branch-admin memo deletion interface with pagination.
- `IMPORTMEMO(4).HTML` — memo import interface.
- `IMPORTPRODUCTDATABASE(1).HTML` — product database import interface.
- `LOGOMANAGER(4).HTML` — logo upload, display, and removal interface.
- `FirstSystemAdminSetup(1).HTML` — first system administrator setup.

## Observed backend responsibilities

### Security backend

The Apps Script backend stores security state in spreadsheet tabs and uses Apps Script services including SpreadsheetApp, PropertiesService, CacheService, LockService, Session, Utilities, and ScriptApp.

Observed account/session capabilities include:

- Universal account authentication, resolving system accounts first and then unique active branch usernames.
- System Admin and branch-user authentication.
- Failed-login counters and temporary account locks.
- Server-side session records, expiry and idle checks.
- Branch session validation and force logout.
- Branch status and maintenance/master-system controls.
- Role/permission checks and security audit events.

### PTG data backend

The second Apps Script backend uses Google Sheets and Drive for:

- Price memo records and memo product rows.
- Product master and product SRP data.
- Excel import conversion through Drive's spreadsheet conversion.
- Logo storage in Drive, with file IDs held in document properties.
- Branch-aware memo upload and deletion flows.

### Interface integration

The HTML interfaces call Apps Script through `google.script.run`. The new application will replace this bridge with typed server actions/route handlers and Supabase-backed services.

## Migration guardrails

1. The existing Apps Script deployment remains the production reference and is not modified.
2. Existing GitHub repositories and Supabase projects remain untouched.
3. No production user accounts, passwords, sessions, memos, product data, or logos are copied during scaffold work.
4. Authorization must be enforced server-side; hiding UI controls is not security.
5. All existing print formats and their calculations must be regression-tested before release.
6. Preserve leading zeroes in barcodes, memo/SRP precedence, brand ordering, and branch scoping.
7. Build and validate in a separate Git branch before merge or deployment.

## Security design items to resolve before schema implementation

- Reproduce the current account lockout rules and role matrix with explicit tests.
- Replace spreadsheet/cache session state with a database-backed session model and reliable revocation checks.
- Avoid raw session tokens in URL query parameters; use secure, HTTP-only cookies.
- Use a password hashing algorithm designed for passwords (e.g. Argon2id or bcrypt), not a fast general-purpose digest.
- Enforce branch scoping in database policies and server-side authorization.
- Keep privileged Supabase keys server-only; do not expose them in `NEXT_PUBLIC_*` variables.
- Audit every write/import/delete operation before enabling it.

## Authentication migration progress

The development branch now includes:

- A server-only Supabase admin client using a non-public secret environment variable.
- A private username-to-Supabase-Auth identity resolver exposed only through service-role-only database RPCs.
- A username login endpoint supporting optional branch-code disambiguation.
- Atomic five-failure / 15-minute lockout updates, matching the legacy account lockout threshold.
- Secure Supabase Auth cookie sign-in, plus a separate HTTP-only application-session cookie.
- Database-backed application sessions enforcing the 30-minute idle timeout and 8-hour absolute lifetime.
- Session status and logout endpoints, with role/branch context loaded server-side.
- A development login page and protected dashboard placeholder.

The authentication SQL migrations have been applied to the isolated PTG Supabase project. Database checks confirmed the resolver/lockout RPCs are executable by service_role and not by anon or authenticated. private.login_identities remains RLS-enabled with no client policies.

## Remaining authentication work before acceptance

- Run a full Next.js typecheck, lint, and production build in a connected build environment.
- Add account provisioning and password enrollment/reset workflows; no legacy password hashes will be migrated.
- Implement and test force logout, role/permission gates, account disable, branch disable, and session-version invalidation.
- Add a branch-aware authentication test matrix, including duplicate usernames across branches.
- Add CSRF/origin protections and operational rate limiting to auth mutation routes.

No production user accounts, passwords, sessions, memos, product data, or logos have been migrated. The existing Apps Script deployment remains untouched and in production use.
