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

## Source-verified security values

The supplied security backend defines these exact limits:

- System Admin login: 5 failed attempts, then a 15-minute lock.
- Branch user login: 5 failed attempts, then a 15-minute lock.
- System Admin session: 30-minute idle timeout and 8-hour maximum lifetime.
- Branch session: 30-minute idle timeout and 8-hour maximum lifetime.
- Permission matrix: 14 permissions across SYSTEM_ADMIN, SYSTEM_VIEWER, BRANCH_ADMIN, and BRANCH_USER. The matrix retains the source access levels FULL, VIEW, OWN_BRANCH, LIMITED, and NONE.

The memo backend stores PRICE_MEMOS and MEMO_PRODUCTS. Memo product rows include BRAND, CATEGORY, BARCODE, MODEL, SRP, CASH_PAYMENT, TAG_THIS, 6/9/12/18/24-month installment values, REMARKS, ELIGIBLE_FOR_PRICE_TAG, and PRICE_TAG_STATUS. Barcode values are stored as text.

The current branch-admin memo deletion function verifies the branch session and role, validates all selected memo IDs before changing data, then removes the matching memo and product rows. The replacement must preserve that all-or-nothing validation.

The current memo classifier marks FREE FIRST 10FT INSTALLATION as eligible, UNIT ONLY as ineligible, and other/no remarks as ineligible. The replacement must preserve this classification unless a separately approved change is requested.

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

## Initial Supabase schema status

The isolated Supabase project now has 14 public tables with RLS enabled, 25 public policies, 14 seeded permission definitions, and 56 role-permission rows. No branch records, user profiles, passwords, sessions, memo rows, product rows, or logo files have been imported.

A private-schema login mapping table exists to support legacy username-based sign-in. It has no grants to anon, authenticated, or PUBLIC and is not intended to be exposed through the Data API. The Supabase table inventory nevertheless flags its RLS as disabled. Before enabling RLS on that private table, its intended server-only access policy must be designed; enabling RLS with no policy will block all access.

## Initial migration status

This branch contains only a Next.js application scaffold and this inventory. No Supabase schema, auth configuration, production data, or production secrets have been added.
