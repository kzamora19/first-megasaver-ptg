# First System Admin Initialization

This replaces the Apps Script L1 one-time bootstrap.

## Server configuration

Set `FIRST_ADMIN_SETUP_SECRET` in the deployment environment. Generate a high-entropy value (at least 32 characters) and store it in the deployment provider's encrypted environment-variable settings. Never commit it, place it in a `NEXT_PUBLIC_*` variable, or send it through chat. The setup endpoint is disabled if this server-only variable is absent or shorter than 32 characters.

## Initialize

1. Open `/setup/first-admin` on the intended deployment.
2. Enter the server setup authorization secret. This is the equivalent of the original spreadsheet-owner/editor context.
3. The server generates a random one-time bootstrap code and stores only its SHA-256 digest in a private, RLS-protected table.
4. Complete the username, display name, and initial password fields.
5. The code expires after 15 minutes. Opening a new setup window replaces the prior code.
6. On success, the database atomically verifies and consumes the code, creates the first SYSTEM_ADMIN profile and private username mapping, and writes an audit event. The code is then permanently invalidated.

The endpoint refuses initialization if any SYSTEM_ADMIN profile already exists. A database advisory lock serializes concurrent initialization attempts. The Supabase Auth user is created server-side first; if the database transaction fails, the newly created Auth user is deleted as rollback.

The initial password must be at least 12 characters and is stored/verified by Supabase Auth, not by the legacy salted SHA-256 mechanism. The account is marked to require a password change at first sign-in.

## Security notes

- The setup authorization secret and Supabase secret/service-role key are server-only.
- The bootstrap code is returned only to the browser that successfully presents the setup authorization secret; it is not stored in plaintext in the database.
- The private bootstrap table has RLS enabled and no client policies or grants.
- Both bootstrap RPCs are executable only by `service_role`.
- The first-admin setup route does not create branches or migrate production data.
