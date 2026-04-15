import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";

interface Props {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  extraLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onExtra?: () => void;
}

/**
 * Lightweight modal confirmation dialog. Used to warn the user before
 * destructive workspace-level actions (e.g. closing dirty tabs when
 * replacing the workspace with a new folder).
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  extraLabel,
  danger,
  onConfirm,
  onCancel,
  onExtra,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onCancel, onConfirm]);

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12 }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onCancel}
    >
      <motion.div
        ref={ref}
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.12 }}
        style={{
          background: "var(--color-bg)",
          color: "var(--color-text)",
          border: "1px solid var(--color-border-muted)",
          borderRadius: "var(--radius-lg)",
          padding: "18px 20px",
          width: 420,
          maxWidth: "90vw",
          boxShadow: "var(--shadow-lg)",
          fontFamily: "Inter, sans-serif",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 18, lineHeight: 1.5 }}>
          {message}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              background: "var(--color-bg-inset)",
              color: "var(--color-text)",
              border: "1px solid var(--color-border-muted)",
              borderRadius: "var(--radius)",
              padding: "6px 14px",
              cursor: "pointer",
              fontSize: 13,
              fontFamily: "Inter, sans-serif",
            }}
          >
            {cancelLabel}
          </button>
          {extraLabel && onExtra && (
            <button
              onClick={onExtra}
              style={{
                background: "var(--color-bg-inset)",
                color: "var(--color-text)",
                border: "1px solid var(--color-border-muted)",
                borderRadius: "var(--radius)",
                padding: "6px 14px",
                cursor: "pointer",
                fontSize: 13,
                fontFamily: "Inter, sans-serif",
              }}
            >
              {extraLabel}
            </button>
          )}
          <button
            onClick={onConfirm}
            autoFocus
            style={{
              background: danger ? "#cf222e" : "var(--color-accent)",
              color: "#fff",
              border: "none",
              borderRadius: "var(--radius)",
              padding: "6px 14px",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              fontFamily: "Inter, sans-serif",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
