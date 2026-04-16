import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { commandRegistry } from "../plugins/pluginManager";
import { useUiStore } from "../store/uiStore";
import { parseShortcut, matches, type ParsedShortcut } from "../commands/shortcut";

interface CompiledBinding {
  parsed: ParsedShortcut;
  commandId: string;
}

const isMac = navigator.platform.toUpperCase().includes("MAC");

/**
 * Compile every registered command's `shortcut` (and `additionalShortcuts`)
 * into one flat array of `(parsed, commandId)` pairs the keydown listener
 * can scan.
 */
function compileBindings(): CompiledBinding[] {
  const out: CompiledBinding[] = [];
  for (const cmd of commandRegistry.getAllCommands()) {
    if (cmd.shortcut) out.push({ parsed: parseShortcut(cmd.shortcut), commandId: cmd.id });
    for (const alt of cmd.additionalShortcuts ?? []) {
      out.push({ parsed: parseShortcut(alt), commandId: cmd.id });
    }
  }
  return out;
}

/**
 * Global keyboard handler. Walks the command registry to dispatch shortcuts.
 *
 * Two things stay inline here because they don't fit the
 * "fire a command on keydown" model:
 *   - Escape closes overlays / exits zen mode (depends on multiple UI states)
 *   - Ctrl+wheel zoom (wheel event, not keydown)
 *
 * Presentation mode owns the keyboard while active; only the palette and
 * presentation-toggle shortcuts pass through.
 */
export function useGlobalKeyboard() {
  const setShortcutsVisible = useUiStore((s) => s.setShortcutsVisible);
  const setSearchVisible = useUiStore((s) => s.setSearchVisible);
  const setZenMode = useUiStore((s) => s.setZenMode);
  const zenMode = useUiStore((s) => s.zenMode);
  const presentationVisible = useUiStore((s) => s.presentationVisible);
  const increaseZoom = useUiStore((s) => s.increaseZoom);
  const decreaseZoom = useUiStore((s) => s.decreaseZoom);

  // Re-compile bindings whenever the registry changes (plugins load/unload,
  // built-ins finish registering on first mount).
  const version = useRegistryVersion();
  const bindingsRef = useRef<CompiledBinding[]>([]);
  useMemo(() => { bindingsRef.current = compileBindings(); }, [version]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape: close overlays / exit zen. Always handled, even during presentation.
      if (e.key === "Escape") {
        setShortcutsVisible(false);
        setSearchVisible(false);
        if (zenMode) setZenMode(false);
        return;
      }

      // Walk bindings. While presenting, only allow the presentation toggle
      // through (presentation mode owns the keyboard).
      for (const b of bindingsRef.current) {
        if (!matches(b.parsed, e, isMac)) continue;
        if (presentationVisible && b.commandId !== "view.presentation") return;
        // Modifier-less single-char shortcuts (like `?`) shouldn't steal
        // keystrokes while the user is typing in an input.
        const noMods =
          !b.parsed.mod && !b.parsed.ctrl && !b.parsed.meta && !b.parsed.alt;
        if (noMods && b.parsed.key.length === 1) {
          const target = e.target as HTMLElement | null;
          const tag = target?.tagName;
          if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
        }
        e.preventDefault();
        void commandRegistry.executeCommand(b.commandId);
        return;
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (e.deltaY < 0) increaseZoom();
      else decreaseZoom();
    };

    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("wheel", onWheel);
    };
  }, [
    setShortcutsVisible, setSearchVisible, setZenMode, zenMode,
    presentationVisible, increaseZoom, decreaseZoom,
  ]);
}

/**
 * Subscribes to command-registry changes and returns a monotonically
 * increasing version number, suitable for keying memos.
 */
let registryVersion = 0;
function useRegistryVersion(): number {
  return useSyncExternalStore(
    (cb) => commandRegistry.subscribe(() => { registryVersion++; cb(); }),
    () => registryVersion,
  );
}
