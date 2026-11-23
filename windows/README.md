# Branchline Workspace for Windows — reproducible preview

**NONPRODUCTION / unsigned preview only.** This implementation is intentionally separate from the existing November 10 Windows installer. Do not silently replace old installed programs or promise an automatic upgrade.

## Purpose

This source-buildable .NET 8 Windows Forms shell loads the official Branchline four-app launcher in a WebView2 browser:

- Sales Tracker: `https://kzamora19.github.io/branchline/`
- PTG: `https://kzamora19.github.io/first-megasaver-ptg/`
- MegaFrame/MegaFlyer: links are resolved by Branchline's approved launcher to PTG protected `/studios/` routes. The shell does not bypass permissions, inject tokens, or keep a copy of any credentials.

The browser context remains in the user's own Windows profile in `%LOCALAPPDATA%\Branchline\WorkspacePreview\WebView2`. No credential sharing with the previous app or user's normal browser is assumed. External OAuth/Drive consent popups must still pass a real Windows acceptance test; the shell never pretends to solve those automatically. Unrelated URLs and the old public direct editors are deliberately not captured as native app destinations.

## Build and CI

The development-only GitHub Actions workflow `.github/workflows/branchline-windows-preview.yml` performs:

1. .NET 8 URL navigation policy tests.
2. Pinned WebView2 NuGet restore (version 1.0.4370.26), Windows x64 self-contained publish.
3. Preview-only Inno Setup installer compilation, separate AppId and install directory, SHA-256 checksums.
4. Upload of a **workflow artifact only**, never to `public/`, GitHub Pages, or a release.

Local prerequisites: .NET 8 SDK, Inno Setup 6, and Windows 10/11. Run:

```powershell
dotnet run --project windows/Branchline.Workspace.PolicyTests/Branchline.Workspace.PolicyTests.csproj
dotnet publish windows/Branchline.Workspace/Branchline.Workspace.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o out/branchline-workspace
```

An **unsigned** installer will likely show an operating-system reputation warning. Do not tell users to ignore these warnings; production needs trusted signing, upgrade compatibility, rollback evidence and Windows 10/11/Edge WebView2 test results.

## Release blockers

- Release web/app integration first, including PTG protected Studio routes and actual role/session revocation.
- Replace placeholder/legacy icon graphics with approved source artwork before production.
- Verify real OAuth/Drive and normal external links, physical printing, recovery, and old installed user data/upgrade.
- Check against the November 10 installer to choose an upgrade AppId/data migration safely. Preview AppId and WebView2 profile are intentionally different.
- Produce a versioned signed production binary, hash/verify it, then change the user-facing installer link in a **separate reviewed release**, not from this preview CI.
