# PTG account invitation email setup

The account invitation and generated password-reset flows use Resend's transactional email API.

## Required Vercel environment variables

Add these variables to the Vercel project `first-megasaver-ptg`:

- `RESEND_API_KEY` — server-side Resend API key (keep it encrypted; never prefix with `NEXT_PUBLIC_`).
- `RESEND_FROM_EMAIL` — sender identity on a domain verified in Resend, e.g. `First Megasaver PTG <ptg-notifications@your-verified-domain.example>`.

Set them for Preview on branch `migration/scaffold` first. Add Production only after the email flow is tested and the production domain is verified. Do not commit actual values.

## Resend setup

1. Create or sign in to the Resend account used by First Megasaver.
2. Add and verify a company-controlled sending domain.
3. Publish the DNS records Resend provides (SPF/DKIM and any recommended DMARC policy).
4. Create a restricted API key for transactional sending.
5. Add both values to Vercel Project Settings → Environment Variables. Never paste the API key into chat, source code, or GitHub.
6. Redeploy the Preview branch so the new server-side variables are loaded.

## Account lifecycle

- Account creation generates a cryptographically random temporary password and a single-use 48-hour invitation token.
- The employee email receives the username, temporary password, and invitation-acceptance link.
- The profile remains inactive until the employee explicitly accepts the invitation.
- After acceptance, login is allowed only to complete the mandatory password change. The dashboard and account administration redirect to the password-change page.
- After the new password is saved, the account status becomes ACTIVATED.
- Password resets generate a new random temporary password, revoke sessions, and email the temporary password to the account's registered address.
- Admin screens and API responses never return temporary passwords.

The current code does not send mail until both Vercel variables are configured. Use a verified sender address; Resend may reject unverified sender identities.
