import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useFileStore } from "../store/fileStore";
import { showToast } from "../components/ui/Toast";

interface FileChangedPayload {
  path: string;
  kind: string;
}

export function useFileWatcher(path: string | null, onChanged: () => void) {
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useEffect(() => {
    if (!path) return;

    let unlistenFn: (() => void) | null = null;

    invoke("watch_path", { path }).catch(console.error);

    const setup = async () => {
      const unlisten = await listen<FileChangedPayload>("file-changed", (event) => {
        if (event.payload.path === path && event.payload.kind !== "other") {
          onChangedRef.current();
          showToast({ message: "File updated", type: "info" });
        }
      });
      unlistenFn = unlisten;
    };

    setup();

    return () => {
      invoke("unwatch_path", { path }).catch(console.error);
      unlistenFn?.();
    };
  }, [path]);
}

// Watch all open tabs for changes
export function useAllFileWatchers() {
  const { tabs, updateTabContent } = useFileStore();

  useEffect(() => {
    if (tabs.length === 0) return;

    const unlisten = listen<FileChangedPayload>("file-changed", async (event) => {
      const { path, kind } = event.payload;
      if (kind === "modify" || kind === "create") {
        const tab = tabs.find((t) => t.path === path);
        if (tab) {
          try {
            const content = await invoke<string>("read_file", { path });
            updateTabContent(tab.id, content);
            showToast({ message: `${tab.name} updated`, type: "info", duration: 2500 });
          } catch (err) {
            console.error("Failed to reload file:", err);
          }
        }
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [tabs, updateTabContent]);
}
