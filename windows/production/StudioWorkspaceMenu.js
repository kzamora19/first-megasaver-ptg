/* Installed Branchline launcher only. This script changes presentation and workspace-menu
   visibility inside ALREADY AUTHORIZED protected Studio editor frames.
   No tokens, editor content, or storage values are read or exported. */
(() => {
  if (window === window.top) return;
  function initialize() {
  const root = document.documentElement;
  if (!root || root.dataset.blNativeStudioMenuInstalled === 'true') return;
  root.dataset.blNativeStudioMenuInstalled = 'true';
  const css = document.createElement('style');
  css.id = 'branchline-native-studio-menu';
  css.textContent = `
    /* The universal nav rail is opaque navy with cyan selected states. */
    body.frameChatLayout #pinNav,
    body.flyerChatLayout #sidebarFixed {
      background:#102b4d!important;background-image:none!important;
      border-color:#315675!important;color:#eff7ff!important;
      box-shadow:none!important;filter:none!important;
      backdrop-filter:none!important;-webkit-backdrop-filter:none!important;
    }
    body.frameChatLayout #pinNav .pinNavTitle,
    body.flyerChatLayout #sidebarFixed .editorMenuHeading,
    body.flyerChatLayout #sidebarFixed .editorMenuHeading h1 {
      color:#e9f4ff!important;background:transparent!important;
    }
    body.frameChatLayout #pinNav button[data-panel],
    body.flyerChatLayout #studioNav>[data-nav],
    body.flyerChatLayout #studioNav #sidebarActions button,
    body.frameChatLayout #mfRailToggle,
    body.flyerChatLayout #editorMenuToggle {
      color:#edf6ff!important;background:transparent!important;
      box-shadow:none!important;border-color:transparent!important;
      filter:none!important;
    }
    body.frameChatLayout #pinNav button[data-panel]:hover,
    body.flyerChatLayout #studioNav>[data-nav]:hover,
    body.flyerChatLayout #studioNav #sidebarActions button:hover {
      background:#184d83!important;
    }
    body.frameChatLayout #pinNav button[data-panel].active,
    body.flyerChatLayout #studioNav>[data-nav].active {
      background:#1557a0!important;color:#fff!important;
      box-shadow:inset 3px 0 #12d3e4!important;
    }
    body.flyerChatLayout #studioNav #sidebarActions {
      border-color:#315675!important;
    }
    /* The controls/editor canvas remain app-owned. Only nav rail is recolored. */
    html[data-bl-native-menu="closed"] body.flyerChatLayout main {
      grid-template-columns:minmax(0,1fr)!important;
    }
    html[data-bl-native-menu="closed"] body.flyerChatLayout main>aside {
      display:none!important;
    }
    html[data-bl-native-menu="closed"] body.frameChatLayout .appbody {
      grid-template-columns:minmax(0,1fr) clamp(210px,22vw,305px)!important;
    }
    html[data-bl-native-menu="closed"] body.frameChatLayout .appbody>.sidebar {
      display:none!important;
    }
    html[data-bl-native-menu="closed"] body.frameChatLayout .appbody>.workspace {
      grid-column:1!important;
    }
    html[data-bl-native-menu="closed"] body.frameChatLayout .appbody>.photoQueueSidebar {
      grid-column:2!important;
    }
    @media (max-width:720px) {
      html[data-bl-native-menu="closed"] body.frameChatLayout .appbody>.sidebar,
      html[data-bl-native-menu="closed"] body.flyerChatLayout main>aside {
        display:none!important;
      }
    }
    @media print {
      html[data-bl-native-menu="closed"] body.frameChatLayout .appbody>.sidebar,
      html[data-bl-native-menu="closed"] body.flyerChatLayout main>aside {
        display:initial!important;
      }
    }
  `;
  function inject() {
    const flyer = !!document.querySelector('#sidebarFixed #studioNav');
    const frame = !!document.querySelector('#pinNav');
    if (!flyer && !frame) return false;
    if (!document.getElementById(css.id)) (document.head || root).appendChild(css);
    // The native header remains the only global application switcher. Do not
    // modify app data or simulate any editor controls.
    return true;
  }
  if (!inject()) {
    const observer = new MutationObserver(() => {if (inject()) observer.disconnect();});
    observer.observe(root,{childList:true,subtree:true});
    setTimeout(() => observer.disconnect(),30000);
  }
  }
  if (document.documentElement) initialize();
  else document.addEventListener('DOMContentLoaded', initialize, {once:true});
})();
