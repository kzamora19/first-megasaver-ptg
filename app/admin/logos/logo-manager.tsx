"use client";

import { ChangeEvent, useCallback, useEffect, useState } from "react";

type LogoKey = "header" | "promo" | "social" | "appHeader";
type LogoAsset = { url: string; originalFileName: string; updatedAt: string };
type LogoMap = Partial<Record<LogoKey, LogoAsset>>;
const slots: { key: LogoKey; name: string; detail: string; fallback?: string }[] = [
  { key: "header", name: "1st Megasaver Header Logo", detail: "Used at the top of price tags.", fallback: "/legacy-ptg/price-tag-header.png" },
  { key: "promo", name: "Promo / Anniversary Logo", detail: "Optional campaign artwork on supported tag layouts." },
  { key: "social", name: "Price Tag Footer (Single Image)", detail: "Used as the footer artwork on price tags.", fallback: "/legacy-ptg/price-tag-footer.png" },
  { key: "appHeader", name: "Interface Header Logo", detail: "Shown on the login and product screens.", fallback: "/legacy-ptg/app-header.png" },
];

export default function LogoManager() {
  const [logos, setLogos] = useState<LogoMap>({});
  const [files, setFiles] = useState<Partial<Record<LogoKey, File>>>({});
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<LogoKey | null>(null);
  const [message, setMessage] = useState("");

  const loadLogos = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/logos", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || "Could not load saved logos.");
      setLogos(result.logos || {});
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load saved logos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadLogos(); }, [loadLogos]);

  function chooseFile(key: LogoKey, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setFiles(current => ({ ...current, [key]: file }));
  }

  async function upload(key: LogoKey) {
    const file = files[key];
    if (!file) {
      setMessage("Choose an image first.");
      return;
    }
    setBusyKey(key);
    setMessage("");
    const form = new FormData();
    form.set("key", key);
    form.set("file", file);
    try {
      const response = await fetch("/api/logos", { method: "PUT", body: form });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || "Logo upload failed.");
      setFiles(current => { const next = { ...current }; delete next[key]; return next; });
      setMessage(result.message || "Logo uploaded successfully.");
      await loadLogos();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Logo upload failed.");
    } finally {
      setBusyKey(null);
    }
  }

  async function remove(key: LogoKey) {
    if (!logos[key]) return;
    if (!window.confirm("Remove the uploaded replacement for this logo? The generator will return to its built-in default asset.")) return;
    setBusyKey(key);
    setMessage("");
    try {
      const response = await fetch("/api/logos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || "Logo removal failed.");
      setMessage(result.message || "Logo replacement removed.");
      await loadLogos();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Logo removal failed.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <main className="logo-manager">
      <header className="manager-top">
        <a href="/dashboard">← Dashboard</a>
        <span>ASSETS / BRANDING</span>
      </header>
      <section className="manager-intro">
        <p className="eyebrow">FIRST MEGASAVER LOGO MANAGER</p>
        <h1>Branding assets</h1>
        <p>Replace a logo without changing price memo or product data. When a replacement is removed, the PTG uses its built-in artwork.</p>
      </section>

      {message && <p className="manager-message" role="status">{message}</p>}
      <section className="slot-grid" aria-label="Logo slots">
        {slots.map(slot => {
          const saved = logos[slot.key];
          const preview = saved?.url || slot.fallback;
          return (
            <article className="slot-card" key={slot.key}>
              <div className="slot-heading"><div><span>LOGO SLOT</span><h2>{slot.name}</h2></div><span className={saved ? "slot-status active" : "slot-status"}>{saved ? "REPLACEMENT SAVED" : "BUILT-IN DEFAULT"}</span></div>
              <p className="slot-detail">{slot.detail}</p>
              <div className={"slot-preview " + (slot.key === "appHeader" ? "wide-preview" : "")}>
                {preview ? <img src={preview} alt={slot.name + (saved ? " replacement" : " default")} /> : <span>No replacement uploaded</span>}
              </div>
              {saved && <p className="saved-name">{saved.originalFileName}{saved.updatedAt ? " · Updated " + new Date(saved.updatedAt).toLocaleDateString() : ""}</p>}
              <div className="slot-actions">
                <label className="file-picker">Choose image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => chooseFile(slot.key, event)} /></label>
                <span className="selected-file">{files[slot.key]?.name || "PNG, JPG, or WEBP · Up to 5 MB"}</span>
                <button className="upload-button" type="button" disabled={!files[slot.key] || busyKey === slot.key} onClick={() => void upload(slot.key)}>{busyKey === slot.key ? "SAVING…" : "UPLOAD"}</button>
                <button className="remove-button" type="button" disabled={!saved || busyKey === slot.key} onClick={() => void remove(slot.key)}>REMOVE</button>
              </div>
            </article>
          );
        })}
      </section>
      {loading && <p className="loading-status">Loading saved logo settings…</p>}
    </main>
  );
}
