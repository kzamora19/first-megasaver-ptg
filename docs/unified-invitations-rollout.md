# Unified Invitations — development and release gate

**Status: feature branches only. NOT activated in production.** Existing
Sales Tracker and PTG users and passwords must not be migrated or linked here.

## Canonical identity
- Sales Tracker Supabase Auth is the primary identity for **new employees**.
- PTG has a separate, service-only linked shadow identity. The immutable
  Sales `auth.users.id` (not name/email) links the two records.
- Roles remain separately authorized. This pilot supports:
  - Sales `manager` -> optional PTG Branch Manager
  - Sales `ps` -> no PTG by default; optional Team Leader
- Branch mapping requires a unique, active matching branch CODE in both apps,
  not equal branch UUIDs. Sales managers use `manager_branches`.
- District managers, inventory staff, and system administrators are excluded
  from the first automatic linking pilot; existing accounts stay unchanged.

## Proposed one-invitation workflow (feature flag OFF)
1. PTG System Admin + Sales Admin both verify their independent sessions
   in Data Desk -> Unified Invitations.
2. Validate new login, email, role and matching branch.
3. `admin-create-user` (Sales) stages a banned, unaccepted Sales Auth
   account and app grants with status PREPARED; **sends no email**.
4. `ptg-unified-provision` validates the PTG admin session and obtains
   a server-verified Sales admin attestation. Creates a new PTG shadow
   account without emailing its random private password.
5. Sales `unified_link` records the PTG user ID, then `unified_finalize`
   sends the **single Sales invitation**. Partial failures are surfaced;
   the same Sales user ID is retried rather than creating a second user.
6. The employee accepts Sales invitation and logs into Sales Tracker.
7. On opening PTG, `ptg-unified-sso` checks the signed Sales Auth JWT,
   Sales profile/branch/role, and the PTG identity link, then exchanges a
   server-created one-time PTG Auth token for a native PTG application session.
   No plaintext Sales password is ever passed to PTG.
8. Existing PTG username/password login remains available for legacy users.

## Current security release blockers
- Prove first-invite acceptance, PTG account activation and automatic SSO
  end-to-end using a **new test identity** (never an existing employee).
- Prove real cross-app revocation and disablement. A Sales Tracker sign-out
  or disabled account does not currently invalidate every already-issued
  PTG application session instantly. The SSO prototype caps its PTG session
  at 30 minutes, but this is NOT a complete revocation guarantee.
- Add a durable admin recovery/list endpoint for prepared but unfinished
  invitations; the UI currently preserves a partial Sales ID only during
  the open browser session.
- Review invitation email security. Existing Sales Tracker mail flow sends
  a temporary password; a user-chosen password on invitation acceptance
  would avoid emailing passwords.
- Verify an authorized manager/Team Leader can use only their intended
  PTG features and cannot bypass server-side branch or campaign controls.
- Verify device persistence, app restarts, manager branch updates,
  token expiry, admin force-logout, and cross-project rate limits.
- Review CORS/edge-function authorization, RLS and service-role grants
  before deploying migrations or Edge Functions.
- Run acceptance tests on both Windows and Ubuntu Branchline Workspace.

## Safe release order (after security approval)
1. Apply Sales `unified_app_grants` migration and PTG
   `unified_identity_links` migration.
2. Deploy Sales `admin-create-user` unified actions.
3. Deploy PTG `ptg-unified-provision` and `ptg-unified-sso`.
4. Deploy client code with `NEXT_PUBLIC_UNIFIED_INVITATIONS_ENABLED=false`.
5. Run a supervised new-user pilot and verify cross-app revocation.
6. Only then enable new invitation sending and invite regular employees.

**No database migrations, live user-account changes, email invitations,
or new Edge Function deployments were made by this feature branch.**
