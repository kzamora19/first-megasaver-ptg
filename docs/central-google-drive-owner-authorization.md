# Branchline — central owner Google Drive release configuration

**Development integration prepared November 21, 2026. Not installed or authorized in production.**
**Designated storage account:** `kennethalvinzamora19@gmail.com`

## Exact storage and authorization model

- **GitHub Pages** hosts static application launchers.
- **Existing four Supabase projects** keep current users, sales, product data, photos, templates, Supabase Auth and existing cloud projects. No new Supabase project is required by the target architecture.
- **PTG** issues short-lived signed launch tickets and rechecks roles, branch status, disabled/revoked sessions, and each one-use P-256 Studio proof.
- **Google Drive** is an *additional central backup and recovery destination*, not a database, website host or staff sign-in service.
- The chosen Google account owns the folder `Branchline Central Studio Backups`. Only AES-GCM ciphertext envelopes are stored; the private project recovery key stays in the PTG authorization system.
- Each staff member operates under their own authorized PTG ID. Google Drive files use a one-way account/studio scope tag. Staff never see the owner's Google credentials and need no Google account.
- No backup is automatic. Backups require an explicit click and may include customer photos. Creating a new backup creates a new file; old versions are not deleted or overwritten.
- Existing old personal Google Drive copies are left alone. Old formats are not silently imported.

## One-time owner action: authorize the Google account

This cannot be completed by source-code changes or by naming the Gmail address.

1. In the owner's Google Cloud project, enable **Google Drive API** and configure the OAuth consent screen. Approve or publish the app for the owner's account, with only `https://www.googleapis.com/auth/drive.file` access.
2. Configure a **Google OAuth Web application** client for the server-side authorization-code flow with an exact HTTPS callback URL owned by the application. Use Google's documented `access_type=offline` + explicit consent to obtain the **refresh token** from that account.
3. Store the Google client ID, client secret and offline refresh token securely in the **existing PTG Supabase Edge Function secrets**, with these exact names:
   - `BRANCHLINE_DRIVE_OAUTH_CLIENT_ID`
   - `BRANCHLINE_DRIVE_OAUTH_CLIENT_SECRET`
   - `BRANCHLINE_DRIVE_OAUTH_REFRESH_TOKEN`
4. **Never** send these credentials to a chat, a GitHub repository, client-side JavaScript, or a staff login page. Do not use an ordinary browser-only Google OAuth access token as the server's refresh credential.
5. Confirm that the Google account identity returned by Drive `about.get` is exactly `kennethalvinzamora19@gmail.com`. The staged server function rejects any other account.
6. Test saving and recovering a small encrypted MegaFrame project and a MegaFlyer project on two separate devices with the same PTG account. Then verify wrong PTG actor and revoked actor cannot access the backup.
7. If the Google Cloud OAuth consent app remains in **Testing** mode, review Google's published refresh-token expiration behavior before relying on it for ongoing central storage.

Google OAuth documentation:
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get

## Current staged implementation and limits

- New PTG source:
  `supabase/functions/_shared/studio-central-drive.mjs` and PTG authority `drive` action in `ptg-studio-access`.
- Both Studio private-delivery backend functions forward signed `drive` operations to PTG. Owner OAuth credentials remain on the PTG server.
- Both staged launchers use `staging/studio-access/central-drive.js`, which exposes company Drive Backup/Retrieve without Google sign-in buttons for staff.
- **Current central backend limit:** the preexisting AES-GCM cloud envelope limit is about **1.2 million ciphertext characters** (~1.5 MB JSON). This is suitable for small projects; it is *not yet a tested large customer-photo archive*. Photo-heavy projects must use the existing local/offline export or existing Studio backup until a server-side chunked central Drive bridge passes real tests. Upgrading the owner's Google Drive quota does not remove this application payload limit.
- A separate, older personal-Drive prototype with large resumable uploads is still in the development source but is **not shipped** by the central cutover launcher.
- No credentials are configured by this document. Without them, the UI clearly reports owner authorization is required; it does not fake a completed backup.

## Release gate — still required

Before publishing four apps together:
1. Configure server-only PTG gateway secrets and stable draft-recovery secret. Ensure safe backup and rotation before production.
2. Install secure PTG Studio schema/tickets, private Studio bundles and both delivery Edge functions with correct origin/policy and immutable hashes. Use a safe acceptance environment without altering current staff accounts or projects. Do not point staging mode at a live backend.
3. Validate real PTG roles (System Admin, Branch Admin, Team Leader allowed, ordinary Branch User and revoked/disabled denied).
4. Accept Google owner OAuth, real two-device recovery, cloud save/retrieve and photo library permission, mobile view, PNG/PDF/printing and PWA migration and rollback.
5. Make one coordinated GitHub Pages source retirement/launch switch. Preserve existing app users, historic projects and cached offline drafts.

**Production remains HOLD** until owner OAuth approval and end-to-end testing pass. No current user, project or Supabase schema has been migrated by this staged work.
