"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function InstallApp() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    const checkInstalled = () => setInstalled(media.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
      setMessage("PTG has been installed on this device.");
    };
    checkInstalled();
    media.addEventListener?.("change", checkInstalled);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      media.removeEventListener?.("change", checkInstalled);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") setMessage("Installation started. Follow your browser’s instructions.");
    else setMessage("Installation was cancelled. You can install PTG later from your browser menu.");
    setInstallEvent(null);
  }

  if (installed) return <p className="install-note">PTG is installed on this device.</p>;
  return (
    <div className="install-action">
      {installEvent ? (
        <button className="admin-button" type="button" onClick={() => void install()}>Install PTG on this device</button>
      ) : (
        <p className="install-note">If no install button appears, use your browser’s menu and choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>.</p>
      )}
      {message && <p className="install-note" role="status">{message}</p>}
    </div>
  );
}
