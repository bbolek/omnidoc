import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useFileStore } from "../store/fileStore";
import type { WorkspaceFile } from "../types";

const WORKSPACE_EXT = "omnidoc-workspace.json";
const DIALOG_FILTERS = [
  { name: "Omnidoc Workspace", extensions: ["json"] },
];

/**
 * Prompt the user for a location and write a `.omnidoc-workspace.json` file
 * capturing the currently open folders and their tabs.
 */
export async function saveWorkspace(): Promise<void> {
  const state = useFileStore.getState();
  if (state.folders.length === 0) {
    console.warn("saveWorkspace: no folders open");
    return;
  }

  const defaultName =
    (state.folders[0]?.name ?? "workspace").replace(/[^\w.-]/g, "_") +
    "." +
    WORKSPACE_EXT;

  const target = await save({
    filters: DIALOG_FILTERS,
    defaultPath: defaultName,
  });
  if (!target) return;

  const payload: WorkspaceFile = {
    version: 1,
    folders: state.folders.map((f) => ({
      path: f.path,
      colorIndex: f.colorIndex,
      collapsed: f.collapsed,
      disabled: f.disabled ?? false,
    })),
    tabs: state.tabs.map((t) => ({ path: t.path, folderPath: t.folderPath })),
    activePath: state.tabs.find((t) => t.id === state.activeTabId)?.path ?? null,
  };

  try {
    await invoke("write_file", {
      path: target,
      content: JSON.stringify(payload, null, 2),
    });
  } catch (err) {
    console.error("Failed to save workspace:", err);
    window.alert(
      `Failed to save workspace: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Prompt the user for a workspace file and load it, replacing the current
 * open folders and tabs.
 */
export async function openWorkspace(): Promise<void> {
  const selected = await open({
    filters: DIALOG_FILTERS,
    multiple: false,
  });
  if (typeof selected !== "string") return;

  try {
    const raw = await invoke<string>("read_file", { path: selected });
    const parsed = JSON.parse(raw) as WorkspaceFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.folders)) {
      throw new Error("Not a valid workspace file");
    }
    await useFileStore.getState().loadWorkspaceState(parsed);
  } catch (err) {
    console.error("Failed to open workspace:", err);
    window.alert(
      `Failed to open workspace: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
