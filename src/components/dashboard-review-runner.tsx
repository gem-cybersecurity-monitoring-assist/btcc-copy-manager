"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { runLocalRiskReview } from "@/lib/browser-automation";

/**
 * Runs deterministic, read-only-to-exchanges monitoring whenever the open
 * dashboard is active. Not an always-on service or a financial order executor.
 * The research page runs its own in-memory monitor to avoid concurrent edits.
 */
export function DashboardReviewRunner() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname || ["/copy-trading", "/account", "/sign-in", "/forgot-password", "/reset-password", "/"].includes(pathname)) return;
    const run = () => { if (document.visibilityState === "visible") runLocalRiskReview(false); };
    run();
    const id = window.setInterval(run, 60_000);
    document.addEventListener("visibilitychange", run);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", run); };
  }, [pathname]);
  return null;
}
