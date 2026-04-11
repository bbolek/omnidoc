import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw, CheckCircle, AlertCircle, X } from "lucide-react";

export interface ToastMessage {
  id: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  duration?: number;
}

// Simple event bus for toasts
type Listener = (toast: ToastMessage) => void;
const listeners: Set<Listener> = new Set();

export function showToast(toast: Omit<ToastMessage, "id">) {
  const message: ToastMessage = { ...toast, id: `toast-${Date.now()}` };
  listeners.forEach((fn) => fn(message));
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const add = (toast: ToastMessage) => {
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, toast.duration ?? 3000);
    };
    listeners.add(add);
    return () => { listeners.delete(add); };
  }, []);

  const dismiss = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const icons = {
    info: <RefreshCw size={14} />,
    success: <CheckCircle size={14} style={{ color: "#2da44e" }} />,
    warning: <AlertCircle size={14} style={{ color: "#d29922" }} />,
    error: <AlertCircle size={14} style={{ color: "#cf222e" }} />,
  };

  return createPortal(
    <div className="toast-container">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            className="toast"
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            <span style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>
              {icons[toast.type]}
            </span>
            <span style={{ flex: 1, color: "var(--color-text)", fontSize: 13 }}>
              {toast.message}
            </span>
            <button
              onClick={() => dismiss(toast.id)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--color-text-muted)",
                padding: 0,
                display: "flex",
                alignItems: "center",
              }}
            >
              <X size={12} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body
  );
}
