"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import AppDialog from "./app-dialog";

type Confirmation = { title: string; message?: string; label: string; danger?: boolean };
const ConfirmContext = createContext<((options: Confirmation) => Promise<boolean>) | null>(null);

export function useAppConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("Confirmation provider is missing.");
  return confirm;
}

export default function AppConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<Confirmation | null>(null);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);

  const confirm = useCallback((next: Confirmation) => {
    if (pending.current) return Promise.resolve(false);
    return new Promise<boolean>(resolve => {
      pending.current = resolve;
      setOptions(next);
    });
  }, []);

  function close(confirmed: boolean) {
    const resolve = pending.current;
    pending.current = null;
    setOptions(null);
    resolve?.(confirmed);
  }

  return <ConfirmContext.Provider value={confirm}>
    {children}
    {options && <AppDialog title={options.title} busy={false} onClose={() => close(false)}>
      {options.message && <p>{options.message}</p>}
      <div className="app-confirm-actions">
        <button type="button" className={"admin-button" + (options.danger ? " danger" : "")} onClick={() => close(true)}>{options.label}</button>
      </div>
    </AppDialog>}
  </ConfirmContext.Provider>;
}
