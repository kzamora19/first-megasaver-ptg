"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export default function AppDialog({ title, busy, onClose, children }: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return <dialog ref={dialog} className="app-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header>
      <h3 id={titleId}>{title}</h3>
      <button type="button" className="admin-button small secondary" disabled={busy} onClick={onClose}>Cancel</button>
    </header>
    {children}
  </dialog>;
}
