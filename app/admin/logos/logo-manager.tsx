"use client";

import { useAppConfirm } from "@/components/app-confirm";

import { withBasePath } from "@/lib/base-path";

import { ChangeEvent, useCallback, useEffect, useState } from "react";
import { requestPtgLogos, usesEdgeAssets } from "@/lib/ptg/edge-assets";

type LogoKey = "header" | "promo" | "social" | "appHeader" | `aircon:${string}`;
type LogoAsset = { url: string; originalFileName: string; updatedAt: string };
type LogoMap = Partial<Record<LogoKey, LogoAsset>>;
const slots: { key: LogoKey; name: string; detail: string }[] = [
  { key: "header", name: "1st Megasaver Header Logo", detail: "Used at the top of price tags." },
  { key: "promo", name: "Promo / Anniversary Logo", detail: "Optional campaign artwork on supported tag layouts." },
  { key: "social", name: "Price Tag Footer (Single Image)", detail: "Used as the footer artwork on price tags." },
  { key: "appHeader", name: "Interface Header Logo", detail: "Shown on the Products screen." },
];

function normalizeBrand(value: string) {
  const key = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return ["TMAMA", "TOUGHMAM"].includes(key) ? "TOUGHMAMA" : key;
}

async function saveLogo(key: LogoKey, file: File) {
  const form = new FormData();
  form.set("key", key);
  form.set("file", file);
  const response = usesEdgeAssets
    ? await requestPtgLogos("POST", form)
    : await fetch("/api/logos", { method: "PUT", body: form });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.message || "Logo upload failed.");
  return result;
}

export default function LogoManager() {
  const confirm = useAppConfirm();
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkInputKey, setBulkInputKey] = useState(0);
  const [brand, setBrand] = useState("");
  const [draftBrands, setDraftBrands] = useState<string[]>([]);
  const [logos, setLogos] = useState<LogoMap>({});
  const [files, setFiles] = useState<Partial<Record<LogoKey, File>>>({});
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<LogoKey | null>(null);
  const [message, setMessage] = useState("");

  const loadLogos = useCallback(async () => {
    setLoading(true);
    try {
      const response = usesEdgeAssets
        ? await requestPtgLogos("GET")
        : await fetch("/api/logos", { cache: "no-store" });
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
    try {
      const result = await saveLogo(key, file);
      setFiles(current => { const next = { ...current }; delete next[key]; return next; });
      setMessage(result.message || "Logo uploaded successfully.");
      await loadLogos();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Logo upload failed.");
    } finally {
      setBusyKey(null);
    }
  }

  async function uploadBrands() {
    if (bulkBusy || busyKey || !bulkFiles.length) return;
    const targets = bulkFiles.map(file => ({
      file,
      brand: normalizeBrand(file.name.replace(/\.[^.]+$/, "")),
    }));
    const invalid = targets.find(({ file, brand }) =>
      !brand || brand.length > 40 || !/\.(png|jpe?g|webp)$/i.test(file.name) ||
      !file.size || file.size > 5 * 1024 * 1024,
    );
    if (invalid) {
      setMessage(invalid.file.name + " is invalid. Use a brand filename and a PNG, JPG, or WEBP image up to 5 MB.");
      return;
    }
    if (new Set(targets.map(target => target.brand)).size !== targets.length) {
      setMessage("Two selected files match the same brand. Choose one image per brand.");
      return;
    }

    setBulkBusy(true);
    const failures: string[] = [];
    try {
      for (const [index, { file, brand }] of targets.entries()) {
        setMessage("Uploading brand logo " + (index + 1) + " of " + targets.length + "…");
        try {
          await saveLogo(`aircon:${brand}`, file);
        } catch (error) {
          failures.push(file.name + ": " + (error instanceof Error ? error.message : "Upload failed."));
        }
      }
      await loadLogos();
      setBulkFiles([]);
      setBulkInputKey(value => value + 1);
      setMessage("Uploaded " + (targets.length - failures.length) + " of " + targets.length +
        " brand logos." + (failures.length ? " Failed: " + failures.join(" • ") : ""));
    } finally {
      setBulkBusy(false);
    }
  }

  async function remove(key: LogoKey) {
    if (!logos[key]) return;
    if (!await confirm({ title: "Remove uploaded logo?", message: "Its slot will be left empty.", label: "Remove logo", danger: true })) return;
    setBusyKey(key);
    setMessage("");
    try {
      const response = usesEdgeAssets
        ? await requestPtgLogos("DELETE", { key })
        : await fetch("/api/logos", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key }),
          });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || "Logo removal failed.");
      setMessage("Logo removed. Its slot is now empty.");
      await loadLogos();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Logo removal failed.");
    } finally {
      setBusyKey(null);
    }
  }

  const brandKeys = [...new Set([...Object.keys(logos).filter(key => key.startsWith("aircon:")).map(key => key.slice(7)), ...draftBrands])].sort();
  const brandSlots = brandKeys.map((key): (typeof slots)[number] => ({
    key: `aircon:${key}`, name: key + " Aircon Brand Logo", detail: "Shown in the top-right corner of that brand’s Aircon sheet.",
  }));

  return (
    <main className="logo-manager">
      <header className="manager-top">
        <a href={withBasePath("/dashboard")}>← Dashboard</a>
        <span>ASSETS / BRANDING</span>
      </header>
      <section className="manager-intro">
        <p className="eyebrow">FIRST MEGASAVER LOGO MANAGER</p>
        <h1>Branding assets</h1>
        <p>Upload the artwork you want PTG to use. Empty slots display no artwork.</p>
      </section>

      {message && <p className="manager-message" role="status">{message}</p>}
      <form className="manager-intro" onSubmit={event => {
        event.preventDefault();
        const key = normalizeBrand(brand);
        if (!key || key.length > 40) {
          setMessage("Enter an Aircon brand name with 1–40 letters or digits.");
          return;
        }
        setDraftBrands(current => current.includes(key) ? current : [...current, key]);
        setBrand("");
      }}>
        <label>Aircon brand <input value={brand} onChange={event => setBrand(event.target.value)} placeholder="e.g. LG or TCL" required /></label>
        <button type="submit" className="admin-button small">Add brand logo slot</button>
      </form>
      <section className="manager-intro" aria-label="Bulk Aircon brand logo upload">
        <h2>Upload multiple Aircon brand logos</h2>
        <p>Name each image after its brand, such as LG.png or TCL.jpg. Existing logos for those brands will be replaced.</p>
        <label className="file-picker">Choose brand images
          <input key={bulkInputKey} type="file" multiple accept="image/png,image/jpeg,image/webp"
            disabled={bulkBusy || !!busyKey} onChange={event => setBulkFiles(Array.from(event.target.files ?? []))} />
        </label>
        <span className="selected-file"> {bulkFiles.length} selected</span>
        <button type="button" className="admin-button small" disabled={!bulkFiles.length || bulkBusy || !!busyKey}
          onClick={() => void uploadBrands()}>{bulkBusy ? "UPLOADING…" : "UPLOAD BRAND LOGOS"}</button>
      </section>
      <section className="slot-grid" aria-label="Logo slots">
        {[...slots, ...brandSlots].map(slot => {
          const saved = logos[slot.key];
          const preview = saved?.url;
          return (
            <article className="slot-card" key={slot.key}>
              <div className="slot-heading"><div><span>LOGO SLOT</span><h2>{slot.name}</h2></div><span className={saved ? "slot-status active" : "slot-status"}>{saved ? "ARTWORK SAVED" : "EMPTY"}</span></div>
              <p className="slot-detail">{slot.detail}</p>
              <div className={"slot-preview " + (slot.key === "appHeader" ? "wide-preview" : "")}>
                {preview ? <img src={preview} alt={slot.name} /> : <span>No artwork uploaded</span>}
              </div>
              {saved && <p className="saved-name">{saved.originalFileName}{saved.updatedAt ? " · Updated " + new Date(saved.updatedAt).toLocaleDateString() : ""}</p>}
              <div className="slot-actions">
                <label className="file-picker">Choose image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => chooseFile(slot.key, event)} /></label>
                <span className="selected-file">{files[slot.key]?.name || "PNG, JPG, or WEBP · Up to 5 MB"}</span>
                <button className="upload-button" type="button" disabled={!files[slot.key] || bulkBusy || !!busyKey} onClick={() => void upload(slot.key)}>{busyKey === slot.key ? "SAVING…" : "UPLOAD"}</button>
                <button className="remove-button" type="button" disabled={!saved || bulkBusy || !!busyKey} onClick={() => void remove(slot.key)}>REMOVE</button>
              </div>
            </article>
          );
        })}
      </section>
      {loading && <p className="loading-status">Loading saved logo settings…</p>}
    </main>
  );
}
