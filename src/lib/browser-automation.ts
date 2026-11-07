import { isMonitorDue, runMonitoring } from "../../lib/engine/monitoring.ts";
import { compactToBudget, parseEngineState } from "../../lib/engine/state.ts";
import type { EngineState } from "../../lib/engine/types.ts";
import { STORAGE_KEYS } from "../../lib/workspace.ts";

export const AUTOMATION_EVENT = "gem-copy-center-automation-update";
const LOCK = "gem-copy-center-monitor-lock-v1";
const LOCK_WINDOW_MS = 15_000;
const ENGINE_BUDGET = 550_000;

export type ReviewResult =
  | { status: "completed"; ranAt: string; alertCount: number; summary: string }
  | { status: "not_due" | "empty" | "locked" | "unavailable" | "invalid" | "too_large"; message: string };

export function inspectLocalAutomation(): {
  available: boolean; configured: boolean; strategyCount: number; trackedProviders: number;
  openAlerts: number; intervalHours: number; lastRunAt: string | null; summary: string | null; error: string | null;
} {
  const fallback = { available: false, configured: false, strategyCount: 0, trackedProviders: 0, openAlerts: 0, intervalHours: 24, lastRunAt: null, summary: null, error: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.engine);
    if (!raw) return { ...fallback, available: true };
    const parsed = parseEngineState(JSON.parse(raw));
    if (!parsed.ok) return { ...fallback, error: "Stored engine information needs recovery." };
    const s = parsed.value;
    return { available: true, configured: true, strategyCount: s.strategies.length,
      trackedProviders: s.providers.length, openAlerts: s.alerts.filter(a => !a.resolvedAt).length,
      intervalHours: s.monitor.intervalHours, lastRunAt: s.monitor.lastRunAt,
      summary: s.monitor.lastRunSummary, error: null };
  } catch { return { ...fallback, error: "Browser storage is unavailable or unreadable." }; }
}

/** Browser-local scheduled risk evaluation: never creates exchange orders or API writes. */
export function runLocalRiskReview(force: boolean, now = new Date()): ReviewResult {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.engine);
    if (!raw) return { status: "empty", message: "No saved trader strategies or provider records yet." };
    const parsed = parseEngineState(JSON.parse(raw));
    if (!parsed.ok) return { status: "invalid", message: "Engine data failed validation. Nothing was changed." };
    const state: EngineState = parsed.value;
    if (!state.strategies.length && !state.providers.length) return { status: "empty", message: "No strategy or provider observations to review." };
    if (!force && !isMonitorDue(state, now)) return { status: "not_due", message: "Next scheduled review is not due." };

    const lockRaw = localStorage.getItem(LOCK);
    if (lockRaw) {
      const lock = Number(lockRaw);
      if (Number.isFinite(lock) && now.getTime() - lock < LOCK_WINDOW_MS && now.getTime() >= lock) {
        return { status: "locked", message: "Another dashboard tab is reviewing these records." };
      }
    }
    localStorage.setItem(LOCK, String(now.getTime()));
    try {
      // Re-read after lock to prevent stale writes when another tab updated the engine.
      const current = localStorage.getItem(STORAGE_KEYS.engine);
      if (current !== raw) return { status: "locked", message: "Engine records changed during review; try again." };
      const validated = parseEngineState(JSON.parse(current));
      if (!validated.ok) return { status: "invalid", message: "Stored engine data changed or is unreadable." };
      if (!force && !isMonitorDue(validated.value, now)) return { status: "not_due", message: "Review already completed." };
      const result = runMonitoring(validated.value, now, force ? "manual" : "scheduled");
      const packed = compactToBudget(result.state, ENGINE_BUDGET);
      if (!packed.ok) return { status: "too_large", message: "Saved data exceeds safe size; export a backup before changing it." };
      localStorage.setItem(STORAGE_KEYS.engine, JSON.stringify(packed.state));
      window.dispatchEvent(new CustomEvent(AUTOMATION_EVENT));
      return { status: "completed", ranAt: now.toISOString(), alertCount: result.state.alerts.filter(a => !a.resolvedAt).length, summary: result.summary };
    } finally { localStorage.removeItem(LOCK); }
  } catch { return { status: "unavailable", message: "Unable to persist a browser review; no records were changed." }; }
}
