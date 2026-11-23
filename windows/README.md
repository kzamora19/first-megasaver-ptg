# Branchline Unified STAGING Windows Preview — v0.2.0-preview.2

**Pilot only, unsigned, staging-exclusive.** This is a newer build of the existing separate Windows Preview AppId, not an automatic production upgrade.

## Verified configuration

- Home / unified staging sign-in: https://branchline-staging.github.io/
- Sales Tracker: https://branchline-staging.github.io/sales-tracker/
- PTG (including System Admin-only Data Desk): https://branchline-staging.github.io/first-megasaver-ptg/login/
- Protected Studios: https://branchline-staging.github.io/megaframe-studio/studio/ and https://branchline-staging.github.io/flyer-studio/studio/

The preview **rejects production GitHub Pages URLs from the embedded WebView2 window** and treats unrelated destinations as external. It does not grant app/Studio permissions.

## Installer compatibility

The Inno Setup `AppId` stays `DD67574D-6DB8-4F31-AD3F-F519C17A2215` so this new pilot can upgrade the **previous PREVIEW installation only**. It preserves the original preview data directory at `%LOCALAPPDATA%\Branchline\WorkspacePreview\WebView2`. Neither the preview AppId nor profile is the identity of the production Windows app.

The installer and portable ZIP are unsigned 64-bit test artifacts. Windows protection prompts must not be bypassed; a production rollout requires trusted signing and real-device upgrade/rollback tests.

## Build and test

The workflow `.github/workflows/branchline-windows-preview.yml` builds the Windows preview using .NET 8, tests the stage-only destination allowlist, compiles a user-level Inno Setup installer, calculates SHA256, and uploads artifacts for 14 days. It never publishes an installer to Pages, GitHub Releases, or the production app's download link.

Existing MegaFrame local save/reopen, MegaFlyer editing, and PTG browser PDF tests are not re-run as installation blockers. The pilot still requires on-device WebView2 print and Google consent testing.

**Status:** Preview build only, not production deployment.

## Release blockers

- Release web/app integration first, including PTG protected Studio routes and actual role/session revocation.
- Replace placeholder/legacy icon graphics with approved source artwork before production.
- Verify real OAuth/Drive and normal external links, physical printing, recovery, and old installed user data/upgrade.
- Check against the November 10 installer to choose an upgrade AppId/data migration safely. Preview AppId and WebView2 profile are intentionally different.
- Produce a versioned signed production binary, hash/verify it, then change the user-facing installer link in a **separate reviewed release**, not from this preview CI.
