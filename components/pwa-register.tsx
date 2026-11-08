"use client";

import { useEffect } from "react";

export default function PwaRegister() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      void navigator.serviceWorker.register(`${basePath}/sw.js`, { scope: `${basePath}/` }).catch(() => {
        // Installation remains available through the browser even if SW
        // registration is blocked by a managed-device policy.
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
