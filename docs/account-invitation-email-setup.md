# Branchline PTG account invitation email setup

PTG now uses the same email-provider pattern as the existing Branchline Sales Tracker.

## Preferred: Gmail SMTP (no custom domain required)

Add these server-only variables to the Vercel project `first-megasaver-ptg`:

- `GMAIL_USER` — the Gmail address that will send Branchline messages.
- `GMAIL_APP_PASSWORD` — a Google App Password generated for that Gmail account. This is not the normal Gmail sign-in password.

The sender displays as `Branchline <your-gmail-address>`. PTG connects to `smtp.gmail.com` on port 465 using implicit TLS. Sending is awaited before the API responds.

To create an App Password, the Google account must have 2-Step Verification enabled. Open Google Account → Security → 2-Step Verification → App passwords, create one named `Branchline PTG`, and copy it into Vercel. If App passwords is unavailable, the account's Google Workspace/security policy may prohibit it.

Set both variables for Preview on branch `migration/scaffold`. Never put them in `NEXT_PUBLIC_*`, source code, GitHub, or chat. Do not use your normal Gmail password.

## Optional fallback: Resend

If Gmail SMTP variables are not both configured, PTG can use:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` — a sender identity authorized by a verified Resend domain.

Gmail SMTP takes priority when both provider configurations are present.

## After configuring

1. Save the environment variables in Vercel Preview.
2. Redeploy the latest Preview deployment so the server loads the new variables.
3. Test with an invitation to an email address you control.
4. Confirm receipt and the 48-hour invitation acceptance flow before inviting branch users.

## Account lifecycle

- Account creation generates a cryptographically random temporary password and a single-use 48-hour invitation token.
- The invitation email contains the username, temporary password, and acceptance link.
- The profile remains inactive until the employee accepts the invitation.
- The employee must change the temporary password before accessing PTG.
- Password resets generate a new random temporary password, revoke sessions, and email the password to the registered address.
- Admin screens and API responses do not reveal temporary passwords.
