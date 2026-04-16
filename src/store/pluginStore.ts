import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { pluginManager } from "../plugins/pluginManager";
import { showToast } from "../components/ui/Toast";
import { log } from "../utils/logger";

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
        log.info("pluginStore.discoverAndLoad", "invoking list_plugins");
        try {
          const manifests = await invoke<PluginManifest[]>("list_plugins");
          log.info(
            "pluginStore.discoverAndLoad",
            `discovered ${manifests.length} plugins: ${manifests.map((m) => m.id).join(", ") || "(none)"}`,
          );
          set({ manifests });

          // Load all plugins that aren't explicitly disabled
          for (const m of manifests) {
            const isEnabled = get().enabled[m.id] !== false; // default = enabled
            if (isEnabled) {
              await loadOne(m.id, set, get);
            } else {
              log.debug("pluginStore.discoverAndLoad", `skipping disabled plugin ${m.id}`);
            }
          }
        } catch (err) {
          log.error("pluginStore.discoverAndLoad", "failed to discover plugins", err);
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
      name: "omnidoc-plugins",
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
  log.debug("pluginStore.loadOne", `loading plugin id=${id}`);
  try {
    const code = await invoke<string>("read_plugin_file", { pluginId: id });
    log.debug("pluginStore.loadOne", `fetched ${code.length} bytes of code for ${id}`);
    pluginManager.loadPlugin(id, code);
    set((s) => ({
      loaded: { ...s.loaded, [id]: true },
      errors: { ...s.errors, [id]: "" },
    }));
    log.info("pluginStore.loadOne", `plugin ${id} loaded`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    set((s) => ({
      loaded: { ...s.loaded, [id]: false },
      errors: { ...s.errors, [id]: msg },
    }));
    log.error("pluginStore.loadOne", `plugin ${id} failed to load`, err);
  }
}
