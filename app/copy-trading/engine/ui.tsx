"use client";
// Small presentational helpers shared by the intelligence-engine tabs.
import type { ReactNode } from "react";
import type { EngineState } from "../../../lib/engine/types.ts";

export type EngineChange = (next: EngineState, audit?: { action: string; detail: string }) => void;

export const usd = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `$${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const pct = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? "—" : `${x.toFixed(d)}%`);
export const num = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "—" : x.toFixed(d));
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "never");

export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad" | "sim"; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "bad" | "info"; children: ReactNode }) {
  return <div className={`engine-notice engine-notice-${tone}`} role={tone === "bad" ? "alert" : undefined}>{children}</div>;
}

export function NumberField({ label, value, onChange, min = 0, max, step = "any", hint }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: string; hint?: string }) {
  return (
    <label>{label}
      <input type="number" inputMode="decimal" min={min} max={max} step={step} value={Number.isFinite(value) ? value : ""}
        onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v) && v >= min && (max === undefined || v <= max)) onChange(v); }} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Minimal inline SVG line chart (no external library). */
export function LineChart({ series, height = 140, label }: { series: { name: string; points: number[]; tone: string }[]; height?: number; label: string }) {
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) return null;
  const min = Math.min(...all), max = Math.max(...all);
  const width = 600;
  const len = Math.max(...series.map((s) => s.points.length));
  const x = (i: number) => (i / Math.max(len - 1, 1)) * width;
  const y = (v: number) => height - 6 - ((v - min) / (max - min || 1)) * (height - 12);
  return (
    <figure className="engine-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="none">
        {series.map((s) => <polyline key={s.name} fill="none" stroke={s.tone} strokeWidth="2" vectorEffect="non-scaling-stroke" points={s.points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} />)}
      </svg>
      <figcaption>{series.map((s) => <span key={s.name}><i style={{ background: s.tone }} />{s.name}</span>)}<span className="muted">range {min.toFixed(2)} – {max.toFixed(2)}</span></figcaption>
    </figure>
  );
}
