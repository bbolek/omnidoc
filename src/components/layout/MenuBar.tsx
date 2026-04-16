import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useSyncExternalStore,
  useCallback,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight } from "lucide-react";
import { commandRegistry } from "../../plugins/pluginManager";
import { APP_MENU, type MenuNode, type MenuTree } from "../../commands/menuDefinition";
import { formatForDisplay } from "../../commands/shortcut";
import { useFileStore } from "../../store/fileStore";
import { getFileName } from "../../utils/fileUtils";
import type { CommandRegistration } from "../../plugins/api";
import type { FileInfo } from "../../types";

const isMac = navigator.platform.toUpperCase().includes("MAC");

/** Visible menu item after dynamic-source expansion + when-gate evaluation. */
type ResolvedItem =
  | { kind: "command"; id: string; label: string; shortcut?: string; enabled: boolean; onClick: () => void }
  | { kind: "submenu"; label: string; items: ResolvedItem[] }
  | { kind: "separator" };

function useCommands() {
  return useSyncExternalStore(
    (cb) => commandRegistry.subscribe(cb),
    () => commandRegistry.getAllCommands(),
    () => commandRegistry.getAllCommands(),
  );
}

/**
 * Expand a `MenuNode[]` from the static definition into resolved items
 * suitable for rendering. Looks up command labels/shortcuts in the registry,
 * evaluates `when` gates, and expands `dynamic` sources.
 */
function resolveItems(
  nodes: MenuNode[],
  commands: (CommandRegistration & { pluginId: string })[],
): ResolvedItem[] {
  const byId = new Map(commands.map((c) => [c.id, c]));
  const out: ResolvedItem[] = [];

  for (const node of nodes) {
    if (node.kind === "separator") {
      out.push({ kind: "separator" });
    } else if (node.kind === "command") {
      const cmd = byId.get(node.id);
      if (!cmd) continue;
      const enabled = !cmd.when || cmd.when();
      out.push({
        kind: "command",
        id: cmd.id,
        label: cmd.label,
        shortcut: cmd.shortcut,
        enabled,
        onClick: () => commandRegistry.executeCommand(cmd.id),
      });
    } else if (node.kind === "submenu") {
      out.push({
        kind: "submenu",
        label: node.label,
        items: resolveItems(node.items, commands),
      });
    } else if (node.kind === "dynamic" && node.source === "recentFiles") {
      const recents = useFileStore.getState().recentFiles.slice(0, 10);
      if (recents.length === 0) {
        out.push({
          kind: "command",
          id: "__noRecents",
          label: "No recent files",
          enabled: false,
          onClick: () => {},
        });
      } else {
        for (const f of recents) {
          out.push({
            kind: "command",
            id: `recent:${f.path}`,
            label: f.name,
            enabled: true,
            onClick: async () => {
              try {
                const [content, info] = await Promise.all([
                  invoke<string>("read_file", { path: f.path }),
                  invoke<FileInfo>("get_file_info", { path: f.path }),
                ]);
                useFileStore
                  .getState()
                  .openFile(f.path, getFileName(f.path), content, info);
              } catch (err) {
                console.error("MenuBar: failed to open recent", err);
              }
            },
          });
        }
      }
    } else if (node.kind === "dynamic" && node.source === "plugins") {
      const plugin = commands.filter((c) => c.pluginId !== "core");
      if (plugin.length === 0) {
        out.push({
          kind: "command",
          id: "__noPlugins",
          label: "No plugin commands",
          enabled: false,
          onClick: () => {},
        });
      } else {
        // Group by `menu.path[1]` if set (path is e.g. ["Plugins", "Foo Plugin"]).
        const grouped = new Map<string | null, typeof plugin>();
        for (const c of plugin) {
          const key = c.menu?.path?.[1] ?? null;
          const bucket = grouped.get(key) ?? [];
          bucket.push(c);
          grouped.set(key, bucket);
        }
        // Ungrouped first, then named submenus alphabetically.
        const ungrouped = grouped.get(null) ?? [];
        for (const c of ungrouped) {
          const enabled = !c.when || c.when();
          out.push({
            kind: "command",
            id: c.id,
            label: c.label,
            shortcut: c.shortcut,
            enabled,
            onClick: () => commandRegistry.executeCommand(c.id),
          });
        }
        const groupNames = [...grouped.keys()]
          .filter((k): k is string => !!k)
          .sort();
        for (const name of groupNames) {
          const items = grouped.get(name)!;
          out.push({
            kind: "submenu",
            label: name,
            items: items.map((c) => ({
              kind: "command",
              id: c.id,
              label: c.label,
              shortcut: c.shortcut,
              enabled: !c.when || c.when(),
              onClick: () => commandRegistry.executeCommand(c.id),
            })),
          });
        }
      }
    }
  }
  return out;
}

export function MenuBar() {
  const commands = useCommands();
  // Subscribe so the menu re-resolves when recents change.
  const recentFiles = useFileStore((s) => s.recentFiles);

  /** Index of the open top-level menu, or null if all closed. */
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  /** True while Alt is held — show mnemonic underlines. */
  const [showMnemonics, setShowMnemonics] = useState(false);

  // Snapshot the focused element when the menu opens so we can restore it.
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Resolve every menu's items once per registry/recents change.
  const resolved = useMemo(
    () => APP_MENU.map((m) => resolveItems(m.items, commands)),
    // `resolveItems` reads `useFileStore.getState().recentFiles` directly when
    // expanding the recents dynamic source, so the subscribed value below is
    // intentionally part of the dep list even though it isn't referenced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commands, recentFiles],
  );

  const close = useCallback(() => {
    setOpenIdx(null);
    setShowMnemonics(false);
    if (previouslyFocused.current && document.contains(previouslyFocused.current)) {
      try { previouslyFocused.current.focus(); } catch { /* ignore */ }
    }
    previouslyFocused.current = null;
  }, []);

  const open = useCallback((idx: number) => {
    if (openIdx === null) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
    }
    setOpenIdx(idx);
  }, [openIdx]);

  // Global keyboard listener (capture phase to beat Monaco / textareas).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Toggle mnemonic display while Alt is held.
      if (e.key === "Alt") setShowMnemonics(true);

      // Alt+<letter>: activate top-level menu by mnemonic.
      if (e.altKey && e.key.length === 1) {
        const upper = e.key.toUpperCase();
        const idx = APP_MENU.findIndex((m) => m.mnemonic === upper);
        if (idx >= 0) {
          e.preventDefault();
          open(idx);
        }
      }

      if (openIdx !== null) {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          setOpenIdx((i) => (i === null ? null : (i - 1 + APP_MENU.length) % APP_MENU.length));
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          setOpenIdx((i) => (i === null ? null : (i + 1) % APP_MENU.length));
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") setShowMnemonics(false);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
    };
  }, [openIdx, open, close]);

  // Click-outside to close.
  useEffect(() => {
    if (openIdx === null) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-menubar]") || target?.closest("[data-menu-dropdown]")) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openIdx, close]);

  return (
    <div
      className="menubar titlebar-no-drag"
      data-menubar
      role="menubar"
      style={{ display: "flex", alignItems: "center", height: "100%" }}
    >
      {APP_MENU.map((menu, idx) => (
        <MenuTrigger
          key={menu.label}
          menu={menu}
          isOpen={openIdx === idx}
          showMnemonic={showMnemonics}
          onActivate={() => (openIdx === idx ? close() : open(idx))}
          onHover={() => { if (openIdx !== null) open(idx); }}
          items={resolved[idx]}
          onItemRun={close}
        />
      ))}
    </div>
  );
}

function MenuTrigger({
  menu, isOpen, showMnemonic, onActivate, onHover, items, onItemRun,
}: {
  menu: MenuTree;
  isOpen: boolean;
  showMnemonic: boolean;
  onActivate: () => void;
  onHover: () => void;
  items: ResolvedItem[];
  onItemRun: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div style={{ position: "relative", height: "100%" }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={onActivate}
        onMouseEnter={onHover}
        className={`menubar__trigger${isOpen ? " menubar__trigger--active" : ""}`}
        style={{
          height: "100%",
          padding: "0 10px",
          background: isOpen ? "var(--color-sidebar-hover)" : "none",
          border: "none",
          color: "var(--color-titlebar-text)",
          fontSize: 12,
          fontFamily: "Inter, sans-serif",
          cursor: "pointer",
          opacity: isOpen ? 1 : 0.85,
          display: "flex",
          alignItems: "center",
        }}
      >
        {renderLabelWithMnemonic(menu.label, menu.mnemonic, showMnemonic)}
      </button>
      {isOpen && (
        <Dropdown items={items} anchorEl={triggerRef.current} onItemRun={onItemRun} />
      )}
    </div>
  );
}

function renderLabelWithMnemonic(
  label: string,
  mnemonic: string | undefined,
  show: boolean,
): ReactNode {
  if (!mnemonic || !show) return label;
  const lower = label.toLowerCase();
  const idx = lower.indexOf(mnemonic.toLowerCase());
  if (idx < 0) return label;
  return (
    <>
      {label.slice(0, idx)}
      <span style={{ textDecoration: "underline" }}>{label[idx]}</span>
      {label.slice(idx + 1)}
    </>
  );
}

function Dropdown({
  items, anchorEl, onItemRun,
}: {
  items: ResolvedItem[];
  anchorEl: HTMLElement | null;
  onItemRun: () => void;
}) {
  // Position under the trigger.
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  useEffect(() => {
    if (!anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    setPos({ top: r.bottom, left: r.left });
  }, [anchorEl]);

  const [submenuIdx, setSubmenuIdx] = useState<number | null>(null);

  return (
    <div
      data-menu-dropdown
      role="menu"
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        minWidth: 240,
        maxWidth: 360,
        background: "var(--color-bg-overlay)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        boxShadow: "var(--shadow-md)",
        padding: "4px 0",
        zIndex: 1000,
      }}
    >
      {items.map((item, i) => {
        if (item.kind === "separator") {
          return (
            <div
              key={`sep-${i}`}
              role="separator"
              style={{
                height: 1,
                margin: "4px 6px",
                background: "var(--color-border-muted)",
              }}
            />
          );
        }
        if (item.kind === "submenu") {
          const open = submenuIdx === i;
          return (
            <div
              key={`sub-${i}-${item.label}`}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open}
              onMouseEnter={() => setSubmenuIdx(i)}
              onMouseLeave={() => setSubmenuIdx((cur) => (cur === i ? null : cur))}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "5px 12px",
                fontSize: 13,
                color: "var(--color-text)",
                background: open ? "var(--color-accent-subtle)" : "none",
                cursor: "pointer",
              }}
            >
              <span>{item.label}</span>
              <ChevronRight size={12} style={{ opacity: 0.5 }} />
              {open && (
                <NestedDropdown items={item.items} onItemRun={onItemRun} />
              )}
            </div>
          );
        }
        return (
          <MenuItem key={item.id} item={item} onItemRun={onItemRun} />
        );
      })}
    </div>
  );
}

function NestedDropdown({
  items, onItemRun,
}: {
  items: ResolvedItem[];
  onItemRun: () => void;
}) {
  return (
    <div
      role="menu"
      style={{
        position: "absolute",
        top: -4,
        left: "100%",
        minWidth: 240,
        maxWidth: 360,
        background: "var(--color-bg-overlay)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        boxShadow: "var(--shadow-md)",
        padding: "4px 0",
        zIndex: 1001,
      }}
    >
      {items.map((item, i) => {
        if (item.kind === "separator") {
          return (
            <div
              key={`sep-${i}`}
              style={{
                height: 1,
                margin: "4px 6px",
                background: "var(--color-border-muted)",
              }}
            />
          );
        }
        if (item.kind === "submenu") {
          // Two levels of nesting only — render as plain (non-expanding) for now.
          return (
            <MenuItem
              key={`flat-${i}`}
              item={{
                kind: "command",
                id: `flat-${i}`,
                label: item.label,
                enabled: false,
                onClick: () => {},
              }}
              onItemRun={onItemRun}
            />
          );
        }
        return <MenuItem key={item.id} item={item} onItemRun={onItemRun} />;
      })}
    </div>
  );
}

function MenuItem({
  item, onItemRun,
}: {
  item: Extract<ResolvedItem, { kind: "command" }>;
  onItemRun: () => void;
}) {
  return (
    <div
      role="menuitem"
      aria-disabled={!item.enabled}
      onClick={() => {
        if (!item.enabled) return;
        item.onClick();
        onItemRun();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "5px 12px",
        fontSize: 13,
        color: item.enabled ? "var(--color-text)" : "var(--color-text-muted)",
        opacity: item.enabled ? 1 : 0.5,
        cursor: item.enabled ? "pointer" : "default",
      }}
      onMouseEnter={(e) => {
        if (item.enabled) {
          (e.currentTarget as HTMLElement).style.background = "var(--color-accent-subtle)";
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "none";
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.label}
      </span>
      {item.shortcut && (
        <span
          style={{
            fontSize: 11,
            color: "var(--color-text-muted)",
            fontFamily: "Inter, sans-serif",
            flexShrink: 0,
          }}
        >
          {formatForDisplay(item.shortcut, isMac)}
        </span>
      )}
    </div>
  );
}
