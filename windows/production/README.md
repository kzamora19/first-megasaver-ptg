# Branchline Workspace — original Windows installation (navigation correction)

**Status: release candidate; NOT verified on a user's Windows device, NOT released.**  
**Source:** uploaded `Branchline Workspace.zip`, containing the original installed Windows PE executable, not the older November 10 installer or the separate staging preview.

The production launcher recovered from the uploaded executable retains its existing:
- .NET Framework 4.8 + Microsoft Edge WebView2 WinForms architecture, navigation policies, WebView2 profile, and original installation directory;
- Sales Tracker and PTG sessions, authenticated PTG-only Data Desk iframe, refresh/import actions, and four-application protected Studio integration;
- original approved Branchline 360 px icon assets.

The interface correction places **four** real app icons horizontally in the native header (PTG, Sales Tracker, MegaFrame, MegaFlyer), uses an appropriately sized Branchline **brand control** for toggling the active workspace navigation, and removes Data Desk from the global app switcher. It applies a solid navy navigation shell without blur and displays the actual 1st Megasaver header for PTG. Product grids and editor canvases retain their app-managed colors.

## Security and data boundaries

No production Supabase project, keys, user accounts, roles, table data, or editor project stores were changed. Navigation to protected Studios still goes through existing PTG authorization; no iframe login tokens are injected. Do not bypass role checks to force sidebar menus.

**Known unfinished requirement:** MegaFrame/MegaFlyer's private editor menus live in isolated protected frames; the Branchline brand button does not yet toggle their **internal** editor menus. They continue to function with their own built-in controls. Complete that integration through the Studio's authorized event/message interface with origin checks. No complete four-app menu unification claim should be made until fixed.

## Exact source, assets, and build

- `BranchlineWorkspace.cs` — current uploaded executable's reconstructed source with navigation changes.
- `WorkspaceTheme.js` — updates to the existing WebView2-injected presentation styling.
- `BranchlineWorkspaceUpdater.cs` — exact-source integrity-locked in-place updater with backup and automatic rollback on replace errors.
- Original companion assets **not committed in this feature branch** are in the user's provided production executable and source archive: `DataDeskFrame.js`, `OpenSalesImport.js`, `BranchlineWordmark.png`, the six `Approved.*.png` icons and the original Windows icon. PTG header `FirstMegasaverHeader.png` derives from the existing `public/legacy-ptg/login-logo.png`.
- Use .NET Framework 4.8 reference assemblies and Microsoft.Web.WebView2 1.x core+WinForms. This feature branch's tooling workflows cover standalone decompilation and Roslyn compilation using those references; they are inspection tooling, not a production deployment.
- Current compiled original-implementation candidate checksum (SHA-256): `5F4F99CA151CB89FBA490AC252D9F85E02899481545E3766E600EA6C4DEFDD76`.
- Exact user uploaded EXE SHA-256: `DF991BBEDFFB31D59220CDD859772C09EE4C2ADF6A366597EE8E2786F6AA6E3F`.
- Generated in-place updater checksum (SHA-256): `5FEDCB73EC8F2461C8DCCBBABA4CA0305F5108E70A899BDE2C3B33F18AAE14D0`.

## Release acceptance / remaining checks

- [x] Recover and inspect the specific user-provided installed executable instead of using the old published one.
- [x] Compile modified .NET WinForms launcher and updater with no C# compilation errors.
- [x] Check embedded 360 px images, PTG header, approved app order, preserved origin rules, profile, and updater hash/backup logic via static checks.
- [ ] Integrate universal menu toggle with private MegaFrame and MegaFlyer editor menus, preserving auth isolation.
- [ ] Verify actual 100%, 125%, 150% Windows UI scaling and sidebar/toolbar rendering on the user's Windows device.
- [ ] Test original-install upgrade/restore and keyboard navigation.
- [ ] Test app authorization/session continuity, printing/export and editor reopening after upgrade.
- [ ] Publish a production installer only after the above tests and signing/release review.

**Do not merge without resolving the unfinished criteria.** No independent preview install, new AppId or WebView2 data folder should be introduced.
