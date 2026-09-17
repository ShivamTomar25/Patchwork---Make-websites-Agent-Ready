import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCircle, XCircle } from "lucide-react";

type Toast = { id: number; title: string; tone: "success" | "error" };
const ToastContext = createContext<{ show: (title: string, tone?: Toast["tone"]) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const value = useMemo(
    () => ({
      show: (title: string, tone: Toast["tone"] = "success") => {
        const id = Date.now();
        setToasts((items) => [...items, { id, title, tone }]);
        setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 3200);
      }
    }),
    []
  );
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <div key={toast.id} className="surface-float flex min-w-72 items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
            {toast.tone === "success" ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
            {toast.title}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("ToastProvider missing");
  return value;
}
