"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `refresh` every `intervalMs` while `enabled` and the tab is visible,
 * and once more as soon as a hidden tab becomes visible again. Hidden tabs
 * make no requests, so a page left open in the background does not poll.
 */
export function useLiveRefresh(refresh: () => void | Promise<void>, intervalMs: number, enabled = true) {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === "visible") void latest.current();
      }, intervalMs);
    };
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    const onVisibility = () => {
      if (document.visibilityState === "visible") { void latest.current(); start(); }
      else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [intervalMs, enabled]);
}
