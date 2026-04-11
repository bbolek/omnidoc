import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { pluginManager } from "../plugins/pluginManager";
import { showToast } from "../components/ui/Toast";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  minAppVersion?: string;
}

interface PluginState {
  /** All plugins discovered on disk. */
  manifests: PluginManifest[];
  /** Persisted enable/disable choices. Defaults to enabled. */
  enabled: Record<string, boolean>;
  /** Which plugins are currently loaded in the manager (runtime only). */
  loaded: Record<string, boolean>;
  /** Per-plugin error messages. */
  errors: Record<string, string>;

  /** Scan disk and (re-)load all enabled plugins. */
  discoverAndLoad: () => Promise<void>;
  /** Enable a plugin and load it. */
  enablePlugin: (id: string) => Promise<void>;
  /** Disable a plugin and unregister its contributions. */
  disablePlugin: (id: string) => void;
  /** Reload a single plugin from disk. */
  reloadPlugin: (id: string) => Promise<void>;
  /** Open the plugins directory in the OS file manager. */
  openPluginsFolder: () => Promise<void>;
}

export const usePluginStore = create<PluginState>()(
  persist(
    (set, get) => ({
      manifests: [],
      enabled: {},
      loaded: {},
      errors: {},

      discoverAndLoad: async () => {
        try {
          const manifests = await invoke<PluginManifest[]>("list_plugins");
          set({ manifests });

          // Load all plugins that aren't explicitly disabled
          for (const m of manifests) {
            const isEnabled = get().enabled[m.id] !== false; // default = enabled
            if (isEnabled) {
              await loadOne(m.id, set, get);
            }
          }
        } catch (err) {
          console.error("Failed to discover plugins:", err);
        }
      },

      enablePlugin: async (id) => {
        set((s) => ({ enabled: { ...s.enabled, [id]: true } }));
        await loadOne(id, set, get);
      },

      disablePlugin: (id) => {
        pluginManager.unregisterPlugin(id);
        set((s) => ({
          enabled: { ...s.enabled, [id]: false },
          loaded: { ...s.loaded, [id]: false },
        }));
      },

      reloadPlugin: async (id) => {
        await loadOne(id, set, get);
      },

      openPluginsFolder: async () => {
        try {
          const dir = await invoke<string>("get_plugins_dir");
          const { open } = await import("@tauri-apps/plugin-shell");
          await open(dir);
        } catch (err) {
          showToast({ message: "Could not open plugins folder", type: "error" });
        }
      },
    }),
    {
      name: "md-viewer-plugins",
      // Only persist the user's enable/disable choices
      partialize: (state) => ({ enabled: state.enabled }),
    }
  )
);

// ── Helper ────────────────────────────────────────────────────────────────────

async function loadOne(
  id: string,
  set: (partial: Partial<PluginState> | ((s: PluginState) => Partial<PluginState>)) => void,
  get: () => PluginState
): Promise<void> {
  try {
    const code = await invoke<string>("read_plugin_file", { pluginId: id });
    pluginManager.loadPlugin(id, code);
    set((s) => ({
      loaded: { ...s.loaded, [id]: true },
      errors: { ...s.errors, [id]: "" },
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    set((s) => ({
      loaded: { ...s.loaded, [id]: false },
      errors: { ...s.errors, [id]: msg },
    }));
    console.error(`[Plugin ${id}] failed to load:`, err);
  }
}
