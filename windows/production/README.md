# Branchline Workspace — Round 2 Windows navigation correction

**Status:** Corrected Windows x64 candidate compiled; static checks passed. NOT yet device-verified or released to the original public installer.

**Target:** Existing installed WinForms/WebView2 `Branchline Workspace.exe` (original uploaded 2026-11-23, or the first navigation candidate). Keep the user's existing installer identity, WinForms/WebView2 runtime, browser profile and shortcuts.

## Corrections implemented

- Replaced white RGB icon matte with true-alpha approved 360px source tiles; removed the native icon's rounded crop and inset image trimming.
- Enlarged the clickable Branchline icon; brand wordart uses the official full text with the blue dot and cyan-blue inverted curve beneath it.
- Converted the 1st Megasaver logo to white transparent header artwork, drawn directly onto opaque navy; it stays visible in PTG, Sales Tracker, MegaFrame and MegaFlyer, rather than appearing as a blue rectangular patch.
- Retained exactly four horizontal application tiles, in this order: PTG, Sales Tracker, MegaFrame, MegaFlyer. Branchline is the brand, not an app; Data Desk is only a PTG System Admin tool.
- Universal native logo toggles workspace menu state in PTG and Sales Tracker plus **authorized** private Studio editor frames via the `StudioWorkspaceMenu.js` document script; only presentation selectors and visibility change, no tokens or user editing data are transmitted or fetched.
- Protected editor nav rails `#pinNav` and `#sidebarFixed` use solid navy and cyan active emphasis. Canvas/work areas retain app-managed colors.
- Prior underlying session, navigation, protected Studio delivery, price lookup, photo saving, imports, WebView2 storage and refresh logic remain in place.

## Source

- `BranchlineWorkspace.cs` — exact uploaded launcher recovery with native header and menu changes.
- `StudioWorkspaceMenu.js` — presentation-only protected frame bridge with dark app menu rails.
- `WorkspaceTheme.js` — existing injected PTG/Sales/protected Studio wrapper theme.
- `BranchlineWorkspaceUpdater.cs` — hash-locked backup/rollback updater (recognizes original OR first candidate and refuses unrelated files).
- The original approved 360px icons, Wordart image and original first Megasaver logo were supplied in the user's uploaded executable and source archive. Transparent replacements and the full source ZIP were generated locally and are linked in the ChatGPT delivery; **not every image resource is currently stored in GitHub**, so this PR is **not** yet a standalone reproducible production release.

## SHA-256

| Item | SHA-256 |
|---|---|
| Original uploaded Windows EXE | `DF991BBEDFFB31D59220CDD859772C09EE4C2ADF6A366597EE8E2786F6AA6E3F` |
| First corrected candidate EXE | `5F4F99CA151CB89FBA490AC252D9F85E02899481545E3766E600EA6C4DEFDD76` |
| Round 2 corrected candidate EXE | `8CE164CAE547F8BDA5C536C9E16766A95542D3C5D7F135FB6E2D13DFEDCB84E6` |
| Round 2 updater EXE | `1019155EEB1D6900D708784014289DCB91A24853C3F189F2F639D58FA7EA14E5` |

## Validation and release gates

- [x] Recovered user-provided production EXE source and protected Studio routes.
- [x] Compiled x64 WinForms launcher and hash-locked updater; ZIP CRC and static scope/role checks passed.
- [x] Verified cleaned icon alpha corners, full image drawing path, updated Megasaver and Branchline assets, menu bridge script syntax.
- [ ] **Run on the user's Windows device** at 100%, 125%, 150% scaling and resized windows; inspect actual app header, nav, and nested protected editor states.
- [ ] Confirm working studio authorization, clicking logo open/close across all four apps, saved work reopen, product print/PDF, account sign-in/out, Data Desk role checks, update rollback.
- [ ] Ensure all reproducible original/derived graphic assets are tracked and signed installer released through a reviewed production process.

No production Supabase database, secrets, roles, projects, or hosted app was modified by preparing this candidate. Keep this PR **draft** and the previous user-installed executable backed up until those gates are complete.
