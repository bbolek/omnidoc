import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";

interface Props {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}

export function ContextMenu({ x, y, onClose, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose]);

  // Adjust position so menu doesn't overflow viewport
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - 200);

  return createPortal(
    <motion.div
      ref={ref}
      className="context-menu"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.1 }}
      style={{
        position: "fixed",
        top: adjustedY,
        left: adjustedX,
        zIndex: 1000,
      }}
    >
      {children}
    </motion.div>,
    document.body
  );
}

interface ItemProps {
  label: string;
  onClick: () => void;
  danger?: boolean;
  icon?: React.ReactNode;
}

export function ContextMenuItem({ label, onClick, danger, icon }: ItemProps) {
  return (
    <button
      className={`context-menu-item ${danger ? "danger" : ""}`}
      onClick={onClick}
    >
      {icon && <span style={{ opacity: 0.7, flexShrink: 0 }}>{icon}</span>}
      {label}
    </button>
  );
}

export function ContextMenuSeparator() {
  return <div className="context-menu-separator" />;
}
