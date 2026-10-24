// Browser-local persistence for the Copy Center. Every read is validated so corrupt
// or hand-edited storage cannot crash the dashboard.
import { STORAGE_KEYS, createBackup, loadStoredList, normalizeBookmark, normalizeSnapshot, normalizeTrader, type Workspace } from "../../lib/workspace.ts";

export function readLocalWorkspace(): { workspace: Workspace; dropped: number; error?: string } {
  try {
    const traders = loadStoredList(localStorage.getItem(STORAGE_KEYS.traders), normalizeTrader);
    const saved = loadStoredList(localStorage.getItem(STORAGE_KEYS.saved), normalizeBookmark);
    const snapshots = loadStoredList(localStorage.getItem(STORAGE_KEYS.snapshots), normalizeSnapshot);
    return {
      workspace: { traders: traders.items, savedReviews: saved.items, portfolioSnapshots: snapshots.items },
      dropped: traders.dropped + saved.dropped + snapshots.dropped,
    };
  } catch {
    return { workspace: { traders: [], savedReviews: [], portfolioSnapshots: [] }, dropped: 0, error: "Browser storage is unavailable (private mode or disabled storage). Records will not persist after a reload." };
  }
}

/** Writes all three lists. Returns an error message when storage fails (quota, disabled storage). */
export function writeLocalWorkspace(workspace: Workspace): string | null {
  try {
    localStorage.setItem(STORAGE_KEYS.traders, JSON.stringify(workspace.traders));
    localStorage.setItem(STORAGE_KEYS.saved, JSON.stringify(workspace.savedReviews));
    localStorage.setItem(STORAGE_KEYS.snapshots, JSON.stringify(workspace.portfolioSnapshots));
    return null;
  } catch {
    return "Could not save to browser storage (storage may be full or disabled). Export a backup to keep these records.";
  }
}

export function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadBackup(workspace: Workspace, suffix = "") {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  downloadFile(`gem-copy-center-backup${suffix}-${stamp}.json`, JSON.stringify(createBackup(workspace), null, 2), "application/json");
}
