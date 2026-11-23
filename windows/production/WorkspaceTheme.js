(() => {
  if (location.origin !== "https://kzamora19.github.io") return;
  const sales = location.pathname.startsWith("/branchline/");
  const ptg = location.pathname.startsWith("/first-megasaver-ptg/");
  const studio = /^\/(megaframe-studio|flyer-studio)\/studio\/(?:index\.html)?$/.test(location.pathname);
  if (!sales && !ptg && !studio) return;
  function hideDuplicateAppNavigation() {
    const style = document.createElement("style");
    style.textContent = `
      :root { --bl-rail-width:0px!important }
      .ptg-unified-host { --ptg-outer-rail:0px!important }
      body.bl-protected-shell { --bl-outer-rail:0px!important }
      .bl-app-rail,.bl-app-overlay,.bl-mobile-brand,.bl-app-switcher,
      .ptg-universal-app-rail,.ptg-universal-drawer-backdrop,.ptg-official-mobile-logo,
      .bl-protected-app-rail,.bl-protected-app-overlay,.bl-protected-mobile-brand {
        display:none!important
      }
    `;
    document.head.append(style);
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", hideDuplicateAppNavigation, { once:true });
  else hideDuplicateAppNavigation();
  if (studio) {
    // The Studio editor is protected and deliberately kept opaque to the parent
    // launcher. Give the outer Studio wrapper the same crisp opaque shell and
    // suppress only its redundant application rail and white shell header.
    function themeStudioShell() {
      if (document.getElementById('branchline-native-studio-shell')) return;
      const style = document.createElement('style');
      style.id = 'branchline-native-studio-shell';
      style.textContent = `
        body.bl-protected-shell > header {
          background:#102b4d!important;color:#f5faff!important;
          background-image:none!important;backdrop-filter:none!important;
          filter:none!important;box-shadow:none!important;
          border-bottom:1px solid #315777!important
        }
        .bl-protected-app-drawer,.bl-protected-app-overlay,
        .bl-protected-app-rail {backdrop-filter:none!important;filter:none!important}
      `;
      document.head.append(style);
    }
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', themeStudioShell, { once:true });
    else themeStudioShell();
    return;
  }
  function apply() {
    const root = document.documentElement;
    if (!root.dataset.branchlineMenu) {
      let inherited;
      try { inherited = window.parent !== window ? window.parent.document.documentElement.dataset.branchlineMenu : null; } catch {}
      root.dataset.branchlineMenu = inherited || (innerWidth <= 760 ? "closed" : "wide");
    }
    if (document.getElementById("branchline-native-theme")) return;
    const style = document.createElement("style");
    style.id = "branchline-native-theme";
    style.textContent = sales ? `
      .connected-sidebar { background:#102b4d!important; color:#f3f7ff; border-color:#284563!important }
      .connected-sidebar > .brand { display:none!important }
      .connected-sidebar > .branchline-module-label {
        margin:0 0 12px!important; padding:0 10px; color:#fff!important;
        font:700 16px/1.3 "Segoe UI",sans-serif; letter-spacing:0; text-transform:none
      }
      .connected-sidebar .connected-nav { min-height:0; overflow-y:auto; padding-right:3px }
      .connected-sidebar .connected-account { flex:none }
      .connected-sidebar .connected-nav-link {
        min-height:35px; font-size:12px; letter-spacing:0; text-transform:none
      }
      .connected-sidebar .connected-nav-link[data-live-page="apps"] { display:none!important }
      .connected-sidebar .connected-account strong { color:#f3f7ff!important }
      .connected-sidebar .workspace-label,.connected-sidebar .connected-account small { color:#afc4df!important }
      .connected-sidebar .connected-nav-link { color:#dce7f2!important }
      .connected-sidebar .connected-nav-link:hover,.connected-sidebar .connected-nav-link.active {
        background:#145bb0!important; color:white!important
      }
      .connected-sidebar .connected-nav-link.active { box-shadow:inset 3px 0 #0dd9eb }
      .connected-sidebar .connected-account { border-color:#345371!important }
      .connected-sidebar .connected-account .button { color:#e8f1ff!important; background:transparent!important; border:1px solid #45617e!important }
    ` : `
      .ptg-sidebar .ptg-sidebar-header,.ptg-sidebar .ptg-desktop-collapse { display:none!important }
      .ptg-sidebar .ptg-nav-label { padding:6px 9px 8px; color:#a9bfda; font-size:10px }
      .ptg-sidebar .ptg-nav-item {
        min-height:38px; padding:8px 10px; gap:9px; font-size:13px; line-height:1.25
      }
      .ptg-sidebar .ptg-nav-item .ptg-nav-icon { flex:0 0 16px; width:16px }
      .ptg-sidebar .ptg-nav-item .ptg-nav-text {
        flex:1; min-width:0; width:auto!important; text-align:left; font-size:inherit
      }
      .ptg-sidebar .ptg-nav-item.active { background:#145bb0; box-shadow:inset 3px 0 #0dd9eb }
      .ptg-sidebar .ptg-nav-item:is([href$="/studios/"],[href$="/studios"]) { display:none!important }
    `;
    style.textContent += `
      /* The native Branchline logo is the only current-workspace toggle. */
      .ptg-menu-toggle,#connected-menu,.app-shell .mobile-menu { display:none!important }
      .legacy-products-banner-pin { display:none!important }
      /* Never let the navigation shell inherit white or blurred surfaces. */
      .connected-sidebar,.ptg-sidebar,.app-shell .sidebar,
      .connected-sidebar .connected-nav,.ptg-sidebar .ptg-sidebar-content,
      .ptg-sidebar .ptg-sidebar-menu,.ptg-sidebar .ptg-sidebar-bottom {
        background:#102b4d!important;background-image:none!important;
        color:#f3f7ff!important;opacity:1!important;
        -webkit-backdrop-filter:none!important;backdrop-filter:none!important;
        filter:none!important;box-shadow:none!important;
        border-color:#2e5279!important;
      }
      .connected-sidebar,.ptg-sidebar,.app-shell .sidebar {
        scrollbar-color:#456d9c #102b4d;
        color-scheme:dark;
      }
      .ptg-sidebar .ptg-nav-item,.connected-sidebar .connected-nav-link,
      .app-shell .sidebar .nav-link {
        background:transparent!important;color:#ecf6ff!important;
        filter:none!important;backdrop-filter:none!important;
        border-color:transparent!important;
      }
      .ptg-sidebar .ptg-nav-item.active,.connected-sidebar .connected-nav-link.active,
      .app-shell .sidebar .nav-link.active {
        background:#145bb0!important;color:#fff!important;
        box-shadow:inset 3px 0 #0dd9eb!important;
      }
      .ptg-sidebar .ptg-nav-item:hover,.connected-sidebar .connected-nav-link:hover,
      .app-shell .sidebar .nav-link:hover { background:#194c81!important }
      .ptg-sidebar .ptg-user-chip,.ptg-sidebar .ptg-user-chip span,
      .ptg-sidebar .ptg-sidebar-bottom,.connected-sidebar .connected-account {
        background:transparent!important;color:#f3f7ff!important
      }
      .ptg-sidebar .ptg-user-chip strong,.ptg-sidebar .ptg-user-chip small,
      .ptg-sidebar .ptg-nav-label,.connected-sidebar .workspace-label {
        color:#dbedff!important;
      }
      html:not([data-branchline-show-desk]) #branchline-native-data-desk {
        opacity:0!important; pointer-events:none!important
      }
      html[data-branchline-show-desk],html[data-branchline-show-desk] body { overflow:hidden!important }
      html[data-branchline-menu="closed"] .ptg-app,
      html[data-branchline-menu="open"] .ptg-app { display:block!important }
      html[data-branchline-menu="closed"] :is(.connected-main,.app-shell .main-area),
      html[data-branchline-menu="open"] :is(.connected-main,.app-shell .main-area) { margin-left:0!important }
      html[data-branchline-menu="closed"] :is(.connected-sidebar,.app-shell .sidebar,.ptg-sidebar),
      html[data-branchline-menu="open"] :is(.connected-sidebar,.app-shell .sidebar,.ptg-sidebar) {
        position:fixed!important; inset:0 auto 0 0!important; width:min(270px, 100%)!important;
        max-height:100%!important; height:100%!important; z-index:61!important;
        overflow:auto; box-shadow:0 8px 28px #03132545; transition:transform .2s ease,visibility .2s;
      }
      html[data-branchline-menu="closed"] :is(.connected-sidebar,.app-shell .sidebar,.ptg-sidebar) {
        transform:translateX(-105%)!important; visibility:hidden
      }
      html[data-branchline-menu="open"] :is(.connected-sidebar,.app-shell .sidebar,.ptg-sidebar) {
        transform:translateX(0)!important; visibility:visible
      }
      html[data-branchline-menu="open"] .ptg-sidebar-content { display:flex!important }
      html[data-branchline-menu="open"] .ptg-sidebar :is(.ptg-nav-label,.ptg-sidebar-bottom) { display:block!important }
      html[data-branchline-menu="open"] .ptg-sidebar .ptg-nav-item { display:flex!important }
      #branchline-native-menu-backdrop { display:none; position:fixed; inset:0; z-index:60; border:0; background:#05162c70 }
      html[data-branchline-menu="open"]:has(.connected-shell:not([hidden]),.app-shell:not([hidden]),.ptg-sidebar) #branchline-native-menu-backdrop { display:block }
      @media(prefers-reduced-motion:reduce) {
        :is(.connected-sidebar,.app-shell .sidebar,.ptg-sidebar) { transition:none!important }
      }
      @media print { #branchline-native-menu-backdrop { display:none!important } }
    `;
    document.head.append(style);

    const backdrop = document.createElement("button");
    backdrop.id = "branchline-native-menu-backdrop";
    backdrop.type = "button";
    backdrop.tabIndex = -1;
    backdrop.setAttribute("aria-label", "Close workspace menu");
    document.body.append(backdrop);
    function close() {
      if (root.dataset.branchlineMenu === "open") window.chrome?.webview?.postMessage("branchline:close-menu");
    }
    backdrop.addEventListener("click", close);
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") close();
      if (event.altKey || event.metaKey || !(event.key === "F5" || (event.ctrlKey && event.key.toLowerCase() === "r"))) return;
      event.preventDefault();
      if (!event.repeat) window.chrome?.webview?.postMessage(event.shiftKey || (event.ctrlKey && event.key === "F5")
        ? "branchline:hard-refresh" : "branchline:refresh");
    }, true);
    document.addEventListener("click", event => {
      if (event.target.closest?.(".connected-nav-link,.ptg-nav-item,.app-shell .nav-link,#sign-out,.ptg-sidebar .secondary-button")) close();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply, { once:true });
  else apply();
})();


