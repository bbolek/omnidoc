import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useTerminalStore } from "../../store/terminalStore";
import { folderColor } from "../../utils/folderColors";
import { useFileStore } from "../../store/fileStore";
import { log } from "../../utils/logger";

/**
 * One live xterm.js instance bound 1:1 to a backend PTY by `terminalId`.
 *
 * The component is deliberately uncontrolled — it spawns the PTY on mount,
 * wires up data / resize / exit listeners, and tears everything down on
 * unmount. The panel above it keeps all instances mounted (display: none for
 * inactive ones) so terminal output is preserved when the user switches
 * between terminals or folders.
 */
export function TerminalView({
  terminalId,
  active,
}: {
  terminalId: string;
  active: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const startedRef = useRef(false);

  const terminal = useTerminalStore((s) =>
    s.terminals.find((t) => t.id === terminalId)
  );
  const markStarted = useTerminalStore((s) => s.markStarted);
  const removeTerminal = useTerminalStore((s) => s.removeTerminal);

  // Pick folder color for theming the cursor/selection accents. Background
  // stays transparent so the active app theme shows through.
  const folders = useFileStore((s) => s.folders);
  const folder = terminal?.folderPath
    ? folders.find((f) => f.path === terminal.folderPath)
    : undefined;
  const accent = folder ? folderColor(folder.colorIndex).accent : "#388bfd";

  // ── Create & spawn ───────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !terminal || startedRef.current) return;
    startedRef.current = true;

    const term = new Terminal({
      fontFamily: '"Fira Code", "Cascadia Code", Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      theme: buildTheme(accent),
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);

    // Xterm needs to be in the DOM *and* have a measurable size before fit()
    // can compute columns. On first mount the flex layout sometimes reports
    // 0×0 for one frame — the rAF + try/catch keeps that quiet.
    requestAnimationFrame(() => {
      try { fit.fit(); } catch { /* ignore */ }
    });

    termRef.current = term;
    fitRef.current = fit;

    // Unlisten handles collected so we can clean up on unmount.
    const unlisteners: Array<() => void> = [];

    (async () => {
      const unlistenData = await listen<{ id: string; data: string }>(
        `terminal:data:${terminalId}`,
        (e) => term.write(e.payload.data)
      );
      unlisteners.push(unlistenData);

      const unlistenExit = await listen<{ id: string; code: number | null }>(
        `terminal:exit:${terminalId}`,
        (e) => {
          term.writeln(`\r\n\x1b[90m[process exited with code ${e.payload.code ?? "?"}]\x1b[0m`);
          removeTerminal(terminalId);
        }
      );
      unlisteners.push(unlistenExit);

      const cols = term.cols || 80;
      const rows = term.rows || 24;
      try {
        await invoke<string>("terminal_spawn", {
          id: terminalId,
          cwd: terminal.folderPath,
          shell: terminal.shell,
          cols,
          rows,
        });
        markStarted(terminalId);
      } catch (err) {
        term.writeln(`\r\n\x1b[31mFailed to start shell: ${String(err)}\x1b[0m`);
        log.error("terminal", `spawn failed id=${terminalId} err=${String(err)}`);
        return;
      }

      // stdin → PTY
      term.onData((data) => {
        invoke("terminal_write", { id: terminalId, data }).catch(() => {});
      });

      // Resize on xterm size changes (triggered by fit()).
      term.onResize(({ cols, rows }) => {
        invoke("terminal_resize", { id: terminalId, cols, rows }).catch(() => {});
      });
    })();

    return () => {
      unlisteners.forEach((u) => u());
      invoke("terminal_kill", { id: terminalId }).catch(() => {});
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      startedRef.current = false;
    };
    // Spawn exactly once per id; ignore incidental prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId]);

  // ── Re-theme when folder color changes ───────────────────────────────
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme = buildTheme(accent);
  }, [accent]);

  // ── Refit whenever visibility / size changes ─────────────────────────
  useEffect(() => {
    if (!active || !fitRef.current || !containerRef.current) return;
    const fit = fitRef.current;
    const el = containerRef.current;

    const doFit = () => {
      try { fit.fit(); } catch { /* ignore */ }
    };
    // Immediately on activation, then continuously via ResizeObserver.
    doFit();
    const ro = new ResizeObserver(() => doFit());
    ro.observe(el);
    // Also refit on window resize (belt-and-suspenders for allotment splits).
    window.addEventListener("resize", doFit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", doFit);
    };
  }, [active]);

  // Focus when activated so the user can type immediately.
  useEffect(() => {
    if (active) termRef.current?.focus();
  }, [active]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        display: active ? "block" : "none",
        // Folder-accent left rail echoes the sidebar/tab treatment.
        borderLeft: `3px solid ${accent}`,
        boxSizing: "border-box",
        padding: "4px 0 0 6px",
      }}
    />
  );
}

/**
 * Build an xterm theme that inherits foreground/background from the host
 * app theme via CSS variables and uses the folder-accent color for cursor
 * and selection highlights.
 */
function buildTheme(accent: string) {
  const get = (name: string, fallback: string) => {
    if (typeof document === "undefined") return fallback;
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  };
  const fg = get("--text-primary", "#e6edf3");
  const bg = get("--bg-primary", "#0d1117");
  return {
    foreground: fg,
    background: bg,
    cursor: accent,
    cursorAccent: bg,
    selectionBackground: `${accent}55`,
  };
}
