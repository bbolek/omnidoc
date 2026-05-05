import { useEffect, type RefObject } from "react";

// Per-session scroll position memory keyed by `${tabId}::${key}`. Lives at
// module scope (not in zustand) because writing on every scroll frame would
// trigger needless re-renders, and the data is purely transient — IDs come
// from a monotonic counter so entries never collide across reopens.
const scrollMemory = new Map<string, { top: number; left: number }>();

const memKey = (tabId: string, key: string) => `${tabId}::${key}`;

/**
 * Remember and restore the scroll position of `ref` across tab switches.
 *
 * Tabs are unmounted when the user switches away (the viewer tree is keyed
 * by `tab.id`), so without this each remount starts at the top. The hook
 * saves `scrollTop` / `scrollLeft` on every scroll frame and re-applies the
 * saved values when the same tab mounts again.
 *
 * Asynchronous content (Shiki-highlighted code, lazy office viewers, fetched
 * markdown, etc.) means the scrollable area may not be tall enough at mount
 * time to accept the saved offset. A `ResizeObserver` waits for the content
 * to grow and retries until the restore lands or 3s elapses.
 */
export function useTabScrollMemory(
  ref: RefObject<HTMLElement | null>,
  tabId: string | null | undefined,
  key: string = "main",
) {
  useEffect(() => {
    if (!tabId) return;
    const el = ref.current;
    if (!el) return;

    const id = memKey(tabId, key);
    const saved = scrollMemory.get(id);

    let observer: ResizeObserver | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    if (saved && (saved.top > 0 || saved.left > 0)) {
      let restored = false;
      const tryRestore = () => {
        if (restored) return;
        const target = ref.current;
        if (!target) return;
        const maxTop = Math.max(0, target.scrollHeight - target.clientHeight);
        const maxLeft = Math.max(0, target.scrollWidth - target.clientWidth);
        if (maxTop <= 0 && saved.top > 0) return;
        target.scrollTop = Math.min(saved.top, maxTop);
        target.scrollLeft = Math.min(saved.left, maxLeft);
        if (target.scrollTop >= saved.top - 1) restored = true;
      };

      tryRestore();

      if (!restored && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => {
          tryRestore();
          if (restored) {
            observer?.disconnect();
            observer = null;
          }
        });
        observer.observe(el);
        timeout = setTimeout(() => {
          observer?.disconnect();
          observer = null;
        }, 3000);
      }
    }

    let pending = false;
    const onScroll = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        const target = ref.current;
        if (!target) return;
        scrollMemory.set(id, {
          top: target.scrollTop,
          left: target.scrollLeft,
        });
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      el.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      if (timeout) clearTimeout(timeout);
    };
  }, [tabId, key, ref]);
}

/** Drop saved scroll positions for a tab — call this when the tab is closed. */
export function clearTabScrollMemory(tabId: string) {
  const prefix = `${tabId}::`;
  for (const k of Array.from(scrollMemory.keys())) {
    if (k.startsWith(prefix)) scrollMemory.delete(k);
  }
}
