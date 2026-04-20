/**
 * Frontend half of the native macOS menu wiring.
 *
 *   - On macOS: serialize `APP_MENU` (resolving every command id against the
 *     registry, expanding `dynamic` sources, evaluating `when` gates) and ship
 *     the result to Rust via the `set_app_menu` Tauri command. Re-runs whenever
 *     the registry changes (debounced).
 *
 *   - On every platform: install one `menu:invoke` event listener that
 *     dispatches the original command id back through the registry. The Rust
 *     side has no knowledge of what each command does — it just round-trips
 *     the id.
 *
 *   - On Windows / Linux: skip the native install entirely (the in-window
 *     `MenuBar` component handles it).
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { platform } from "@tauri-apps/plugin-os";
import { APP_MENU, type MenuNode } from "./menuDefinition";
import { commandRegistry } from "../plugins/pluginManager";
import { toTauriAccelerator } from "./shortcut";
import { useFileStore } from "../store/fileStore";
import { getFileName } from "../utils/fileUtils";
import type { CommandRegistration } from "../plugins/api";
import type { FileInfo } from "../types";

interface SerializedNode {
  kind: "command" | "submenu" | "separator";
  id?: string;
  label?: string;
  accelerator?: string;
  enabled?: boolean;
  items?: SerializedNode[];
}
interface SerializedSubmenu { label: string; items: SerializedNode[] }
interface SerializedMenu { menus: SerializedSubmenu[] }

/** Recent-file commands are registered ad-hoc with these reserved ids. */
const RECENT_PREFIX = "recent:";

function serializeNodes(
  nodes: MenuNode[],
  commands: (CommandRegistration & { pluginId: string })[],
): SerializedNode[] {
  const byId = new Map(commands.map((c) => [c.id, c]));
  const out: SerializedNode[] = [];

  for (const node of nodes) {
    if (node.kind === "separator") {
      out.push({ kind: "separator" });
    } else if (node.kind === "command") {
      const cmd = byId.get(node.id);
      if (!cmd) continue;
      out.push({
        kind: "command",
        id: cmd.id,
        label: cmd.label,
        accelerator: cmd.shortcut ? toTauriAccelerator(cmd.shortcut) : undefined,
        enabled: !cmd.when || cmd.when(),
      });
    } else if (node.kind === "submenu") {
      out.push({
        kind: "submenu",
        label: node.label,
        items: serializeNodes(node.items, commands),
      });
    } else if (node.kind === "dynamic" && node.source === "recentFiles") {
      const recents = useFileStore.getState().recentFiles.slice(0, 10);
      if (recents.length === 0) {
        out.push({
          kind: "command",
          id: "__noRecents",
          label: "No recent files",
          enabled: false,
        });
      } else {
        for (const f of recents) {
          out.push({
            kind: "command",
            id: `${RECENT_PREFIX}${f.path}`,
            label: f.name,
            enabled: true,
          });
        }
      }
    }
  }
  return out;
}

function serializeMenu(): SerializedMenu {
  const commands = commandRegistry.getAllCommands();
  return {
    menus: APP_MENU.map((m) => ({
      label: m.label,
      items: serializeNodes(m.items, commands),
    })),
  };
}

let installed = false;
let pendingTimer: number | null = null;

function scheduleApply(): void {
  if (pendingTimer !== null) return;
  pendingTimer = window.setTimeout(() => {
    pendingTimer = null;
    void invoke("set_app_menu", { menu: serializeMenu() }).catch((err) => {
      console.error("[menu] set_app_menu failed:", err);
    });
  }, 100);
}

/**
 * Set up the native menu (macOS only) and the `menu:invoke` listener (all
 * platforms — harmless on Win/Linux, since Rust never emits the event there).
 */
export async function applyAppMenu(): Promise<void> {
  if (installed) return;
  installed = true;

  // Listener runs on every platform — handles both real menu events and the
  // ad-hoc recent-file ids that don't exist in the command registry.
  await listen<string>("menu:invoke", async ({ payload }) => {
    if (payload.startsWith(RECENT_PREFIX)) {
      const path = payload.slice(RECENT_PREFIX.length);
      try {
        const [content, info] = await Promise.all([
          invoke<string>("read_file", { path }),
          invoke<FileInfo>("get_file_info", { path }),
        ]);
        useFileStore
          .getState()
          .openFile(path, getFileName(path), content, info);
      } catch (err) {
        console.error("[menu] failed to open recent:", err);
      }
      return;
    }
    void commandRegistry.executeCommand(payload);
  });

  // Native menu install — macOS only.
  let isMac = false;
  try {
    isMac = platform() === "macos";
  } catch {
    isMac = false;
  }
  if (!isMac) return;

  scheduleApply();

  // Re-apply whenever the registry changes.
  commandRegistry.subscribe(() => scheduleApply());

  // Recent files change independently of the registry — re-apply on those too.
  useFileStore.subscribe((state, prev) => {
    if (state.recentFiles !== prev.recentFiles) scheduleApply();
  });
}
