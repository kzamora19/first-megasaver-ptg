# Branchline Unified Sign-In — Phase 2 Release Gate

## Status

**Code staged; SSO NOT enabled.** Existing PTG password logins and accounts remain unchanged.
Live provider configuration is not available through the current Supabase connector.
Do not set any SSO flags to true until the issuer/client and an end-to-end test account are ready.

## Implemented in this branch

- Feature-gated **Sign in with Branchline** action on PTG login.
- Custom OIDC provider ID `custom:branchline` and Supabase PKCE callback at
  `https://kzamora19.github.io/first-megasaver-ptg/sso/callback/`.
- PTG Edge Auth action `sso-session` independently gated by
  `PTG_UNIFIED_SSO_ENABLED`.
- Trusted OIDC identity only: checks Supabase Auth-verified
  `identities[].provider === 'custom:branchline'` and IDP `identity_data.sub`
  against `ptg_unified_sso_grants.sales_user_id`.
- New-employee PTG role and branch are read from a **server-only grant table**,
  not the client's email, user metadata or frontend selection.
- SSO provisioning additionally gated by `PTG_UNIFIED_SSO_PROVISION_ENABLED`.
  Existing PTG user profiles are not auto-linked or migrated.
- PTG session creation still uses existing System Security availability and
  timeouts. Grant disabling deactivates the unified PTG profile and revokes sessions.

## Required Supabase configuration (manual, before enabling)

### Sales Tracker project `psoopubvdpwztzkdyifa`

1. In Authentication > Signing Keys, confirm an **asymmetric** signing key
   (required to issue OIDC ID tokens; do not rotate existing keys casually).
2. In Authentication > URL Configuration, confirm the Site URL resolves to
   `https://kzamora19.github.io/branchline/`.
3. In Authentication > OAuth Server, enable OAuth 2.1 server, then set the
   authorization path to `oauth-consent.html` so the full URL is
   `https://kzamora19.github.io/branchline/oauth-consent.html`.
4. Register a first-party OIDC client for PTG; use the **exact callback URL shown**
   by the PTG custom provider setup. Expected value for this configuration:
   `https://agknxlowackphvwyvxge.supabase.co/auth/v1/callback`.
   Register scopes `openid email profile`. Disable dynamic client registration.
5. Record the client ID and client secret securely in the **PTG Auth provider**
   configuration only. Never store secrets in GitHub, JS bundles or Data Desk drafts.

### PTG project `agknxlowackphvwyvxge`

6. In Authentication > Providers, create a custom OIDC provider:
   identifier `custom:branchline`, issuer from the Sales Tracker project's
   actual OIDC discovery document, client ID/secret from the OAuth client,
   scopes `openid email profile`, PKCE enabled.
7. In Authentication > URL Configuration, allow the PTG callback route above.
8. Confirm the provider's callback URL equals the one allowlisted in
   `branchline/oauth-redirect-policy.mjs`.
9. **Do not enable SSO** until you can test a wholly new user and service-only
   `ptg_unified_sso_grants` entry with a real, approved Sales user ID.
   This grant is currently service-role-only; the issuance bridge has not
   been implemented/deployed. Existing accounts must not be auto-linked.

## Feature switches (all default OFF)

PTG GitHub Pages build environment:
- `NEXT_PUBLIC_PTG_UNIFIED_SSO_ENABLED=true` — shows the new login button
  and enables the PKCE-capable frontend client.

PTG Edge Function environment:
- `PTG_UNIFIED_SSO_ENABLED=true` — enables OIDC assertion exchange,
  **only after** verified provider/approved grants.
- `PTG_UNIFIED_SSO_PROVISION_ENABLED=true` — allows first-time creation of a
  new PTG profile from a trusted, approved grant. Keep OFF for initial testing.

These flags are deliberately different and **must not** be enabled just to
make the login button appear.

## Critical missing work — not complete or deployed

- Trusted cross-project draft approval → canonical Sales invitation acceptance →
  signed, idempotent PTG entitlement provisioning.
- PTG role mapping across branch identifiers from the two databases.
- Sales disable/force logout webhook to mark PTG entitlement inactive and
  revoke app sessions; local sign-out also needs cross-app coordination.
- End-to-end OAuth authorization callback, account activation, role-denial,
  replay, disabling and multi-device testing with dedicated **new** test users.
- Existing account reconciliation and migrations (explicitly deferred).

Do not claim one account logs into both apps until these tests pass.

Docs:
- https://supabase.com/docs/guides/auth/oauth-server/getting-started
- https://supabase.com/docs/guides/auth/custom-oauth-providers
