"use client";

import { useEffect, useState } from "react";
import "../copy-center.css";

type Position = {
  id: string;
  venue: string;
  trader: string;
  symbol: string;
  side: "long" | "short";
  notional: number;
  entry: number;
  mark: number;
  status: "paper-open" | "paper-closed";
  at: string;
};
type Request = {
  id: string;
  positionId: string;
  title: string;
  status: "pending" | "approved" | "rejected";
  at: string;
};
type Data = {
  positions: Position[];
  requests: Request[];
  maxNotional: number;
  maxLossPct: number;
};
const KEY = "gem-copy-center-paper-positions-v1";
const initial: Data = {
  positions: [],
  requests: [],
  maxNotional: 10,
  maxLossPct: 2,
};
const s: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 860,
    margin: "0 auto",
    padding: "20px 16px 70px",
    fontFamily: "system-ui, sans-serif",
    color: "#172e35",
  },
  card: {
    background: "#fff",
    border: "1px solid #dce5ed",
    borderRadius: 16,
    padding: 18,
    marginTop: 16,
  },
  input: {
    width: "100%",
    padding: 12,
    borderRadius: 9,
    border: "1px solid #bbcbd8",
    fontSize: 16,
    boxSizing: "border-box",
  },
  button: {
    padding: "12px 16px",
    background: "#136c55",
    color: "white",
    border: 0,
    borderRadius: 9,
    fontWeight: 700,
    cursor: "pointer",
  },
  ghost: {
    padding: "10px 12px",
    background: "#edf3ef",
    color: "#193b4c",
    border: 0,
    borderRadius: 9,
    fontWeight: 650,
    cursor: "pointer",
  },
  muted: { color: "#5f7077", fontSize: 13, lineHeight: 1.5 },
  label: { fontSize: 13, fontWeight: 700, display: "grid", gap: 6 },
};
const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n,
  );
export default function PaperPositionsPage() {
  const [data, setData] = useState<Data>(initial);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    venue: "BTCC",
    trader: "",
    symbol: "BTCUSDT",
    side: "long" as "long" | "short",
    notional: "10",
    entry: "",
    mark: "",
  });
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          Array.isArray(parsed.positions) &&
          Array.isArray(parsed.requests) &&
          Number.isFinite(parsed.maxNotional) &&
          Number.isFinite(parsed.maxLossPct)
        ) {
          setData({
            positions: parsed.positions
              .filter(
                (p: Position) =>
                  p &&
                  typeof p.id === "string" &&
                  Number.isFinite(p.notional) &&
                  Number.isFinite(p.entry) &&
                  Number.isFinite(p.mark),
              )
              .slice(0, 200),
            requests: parsed.requests
              .filter(
                (r: Request) =>
                  r &&
                  typeof r.id === "string" &&
                  ["pending", "approved", "rejected"].includes(r.status),
              )
              .slice(0, 200),
            maxNotional: Math.min(100000, Math.max(1, parsed.maxNotional)),
            maxLossPct: Math.min(100, Math.max(0.1, parsed.maxLossPct)),
          });
        }
      }
    } catch {
      setMessage(
        "Saved paper records could not be loaded. No exchange data was accessed.",
      );
    }
    setReady(true);
  }, []);
  function save(next: Data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      setData(next);
    } catch {
      setMessage("Browser storage is unavailable. Change was not saved.");
    }
  }
  function addPosition(e: React.FormEvent) {
    e.preventDefault();
    const notional = Number(form.notional),
      entry = Number(form.entry),
      mark = Number(form.mark);
    if (
      !form.trader.trim() ||
      !form.symbol.trim() ||
      ![notional, entry, mark].every(Number.isFinite) ||
      notional <= 0 ||
      entry <= 0 ||
      mark <= 0 ||
      notional > data.maxNotional
    ) {
      setMessage(
        "Enter a trader, symbol and positive prices. Paper notional must stay within your configured cap.",
      );
      return;
    }
    if (
      !window.confirm(
        "Record this PAPER position? No exchange instruction will be sent.",
      )
    )
      return;
    save({
      ...data,
      positions: [
        {
          id: crypto.randomUUID(),
          venue: form.venue,
          trader: form.trader.trim().slice(0, 100),
          symbol: form.symbol.trim().toUpperCase().slice(0, 32),
          side: form.side,
          notional,
          entry,
          mark,
          status: "paper-open",
          at: new Date().toISOString(),
        },
        ...data.positions,
      ],
    });
    setForm({ ...form, trader: "", entry: "", mark: "" });
    setMessage(
      "Paper position saved only in this browser. It is not a live exchange position.",
    );
  }
  function requestClose(p: Position) {
    if (
      data.requests.some((r) => r.positionId === p.id && r.status === "pending")
    ) {
      setMessage("A request for this position is already awaiting review.");
      return;
    }
    save({
      ...data,
      requests: [
        {
          id: crypto.randomUUID(),
          positionId: p.id,
          title: "Simulate closing " + p.symbol + " (" + p.venue + ")",
          status: "pending",
          at: new Date().toISOString(),
        },
        ...data.requests,
      ],
    });
    setMessage(
      "Paper close requested. Nothing happens until approval; no exchange order is possible on this page.",
    );
  }
  function decide(r: Request, approved: boolean) {
    if (r.status !== "pending") return;
    const p = data.positions.find((p) => p.id === r.positionId);
    if (!p || (approved && p.status !== "paper-open")) {
      setMessage("This position is no longer eligible.");
      return;
    }
    if (
      approved &&
      !window.confirm(
        "APPROVE PAPER-ONLY SIMULATION? This changes only the browser record; it cannot execute on an exchange.",
      )
    )
      return;
    save({
      ...data,
      requests: data.requests.map((x) =>
        x.id === r.id
          ? { ...x, status: approved ? "approved" : "rejected" }
          : x,
      ),
      positions: approved
        ? data.positions.map((x) =>
            x.id === r.positionId ? { ...x, status: "paper-closed" } : x,
          )
        : data.positions,
    });
    setMessage(
      approved
        ? "Paper close approved and recorded locally. No live action occurred."
        : "Request rejected. Position unchanged.",
    );
  }
  const open = data.positions.filter((p) => p.status === "paper-open");
  const pending = data.requests.filter((r) => r.status === "pending");
  return (
    <div className="cc-shell">
      <main className="cc-paper-page" style={s.page}>
        <a
          href="/copy-center"
          style={{ color: "#136c55", textDecoration: "none", fontWeight: 700 }}
        >
          ← GEM Copy Center
        </a>
        <h1 style={{ fontSize: 28, marginBottom: 5 }}>Your paper workspace</h1>
        <p style={s.muted}>
          Practice positions and approve simulated changes. Records stay in this
          browser; no live orders or exchange data.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={{ ...s.ghost, display: "inline-block" }}>
            PAPER ONLY
          </span>
          <span style={{ ...s.ghost, display: "inline-block" }}>
            {open.length} open records
          </span>
          <span style={{ ...s.ghost, display: "inline-block" }}>
            {pending.length} awaiting approval
          </span>
        </div>
        <details
          className="cc-disclosure cc-add-paper"
          style={{ marginTop: 20 }}
        >
          <summary>
            Add a paper position <span>Manual practice record</span>
          </summary>
          <form onSubmit={addPosition} style={{ display: "grid", gap: 12 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
                gap: 12,
              }}
            >
              <label style={s.label}>
                Venue
                <select
                  style={s.input}
                  value={form.venue}
                  onChange={(e) => setForm({ ...form, venue: e.target.value })}
                >
                  {["BTCC", "Bitget", "MT5", "Other"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label style={s.label}>
                Trader / strategy
                <input
                  style={s.input}
                  maxLength={100}
                  required
                  placeholder="Manual label"
                  value={form.trader}
                  onChange={(e) => setForm({ ...form, trader: e.target.value })}
                />
              </label>
              <label style={s.label}>
                Symbol
                <input
                  style={s.input}
                  maxLength={32}
                  required
                  value={form.symbol}
                  onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                />
              </label>
              <label style={s.label}>
                Side
                <select
                  style={s.input}
                  value={form.side}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      side: e.target.value as "long" | "short",
                    })
                  }
                >
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </select>
              </label>
              <label style={s.label}>
                Paper notional (USD)
                <input
                  style={s.input}
                  type="number"
                  required
                  min="0.01"
                  step="0.01"
                  value={form.notional}
                  onChange={(e) =>
                    setForm({ ...form, notional: e.target.value })
                  }
                />
              </label>
              <label style={s.label}>
                Entry price
                <input
                  style={s.input}
                  type="number"
                  required
                  min="0.00000001"
                  step="any"
                  value={form.entry}
                  onChange={(e) => setForm({ ...form, entry: e.target.value })}
                />
              </label>
              <label style={s.label}>
                Observed / simulated mark
                <input
                  style={s.input}
                  type="number"
                  required
                  min="0.00000001"
                  step="any"
                  value={form.mark}
                  onChange={(e) => setForm({ ...form, mark: e.target.value })}
                />
              </label>
            </div>
            <button style={s.button} type="submit">
              Save paper position
            </button>
          </form>
        </details>
        <section style={s.card}>
          <h2 style={{ marginTop: 0, fontSize: 20 }}>Positions</h2>
          {data.positions.length === 0 ? (
            <p style={s.muted}>
              No paper positions yet. Choose Add a paper position to start.
            </p>
          ) : (
            data.positions.map((p) => {
              const pnl =
                ((p.mark - p.entry) / p.entry) *
                p.notional *
                (p.side === "long" ? 1 : -1);
              return (
                <article
                  key={p.id}
                  style={{
                    padding: "14px 0",
                    borderTop: "1px solid #e4ebf0",
                    display: "grid",
                    gap: 5,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <strong>
                      {p.symbol} · {p.side.toUpperCase()}
                    </strong>
                    <span>
                      {p.status === "paper-open"
                        ? "PAPER OPEN"
                        : "PAPER CLOSED"}
                    </span>
                  </div>
                  <span style={s.muted}>
                    {p.venue} · {p.trader} · {usd(p.notional)} notional
                  </span>
                  <span style={s.muted}>
                    Entry {p.entry} · Mark {p.mark} · Illustrative P/L{" "}
                    {usd(pnl)}
                  </span>
                  {p.status === "paper-open" && (
                    <button style={s.ghost} onClick={() => requestClose(p)}>
                      Request paper close approval
                    </button>
                  )}
                </article>
              );
            })
          )}
        </section>
        <section style={s.card}>
          <h2 style={{ marginTop: 0, fontSize: 20 }}>Approval queue</h2>
          {pending.length === 0 ? (
            <p style={s.muted}>No pending approval requests.</p>
          ) : (
            pending.map((r) => (
              <article
                key={r.id}
                style={{ borderTop: "1px solid #e4ebf0", padding: "14px 0" }}
              >
                <strong>{r.title}</strong>
                <p style={s.muted}>
                  Requested {new Date(r.at).toLocaleString()} · Paper simulation
                  only
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={s.button} onClick={() => decide(r, true)}>
                    Approve paper close
                  </button>
                  <button style={s.ghost} onClick={() => decide(r, false)}>
                    Reject
                  </button>
                </div>
              </article>
            ))
          )}
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 650 }}>
              Approval history ({data.requests.length})
            </summary>
            {data.requests.map((r) => (
              <p key={r.id} style={s.muted}>
                {r.title} — {r.status} — {new Date(r.at).toLocaleString()}
              </p>
            ))}
          </details>
        </section>{" "}
        <details className="cc-disclosure" style={{ marginTop: 20 }}>
          <summary>Paper risk limits</summary>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
              gap: 12,
            }}
          >
            <label style={s.label}>
              Maximum paper position (USD)
              <input
                style={s.input}
                type="number"
                min="1"
                max="100000"
                step="1"
                value={data.maxNotional}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= 1 && n <= 100000)
                    save({ ...data, maxNotional: n });
                }}
              />
            </label>
            <label style={s.label}>
              Maximum planned loss (%)
              <input
                style={s.input}
                type="number"
                min="0.1"
                max="100"
                step="0.1"
                value={data.maxLossPct}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= 0.1 && n <= 100)
                    save({ ...data, maxLossPct: n });
                }}
              />
            </label>
          </div>
          <p style={s.muted}>
            These limits validate paper entries only. They do not control trades
            placed outside this page. Maximum illustrative loss for one capped
            position: {usd((data.maxNotional * data.maxLossPct) / 100)}.
          </p>
        </details>
        {message && (
          <p
            role="status"
            style={{ padding: 12, background: "#e5f4ed", borderRadius: 10 }}
          >
            {message}
          </p>
        )}
        {!ready && <p>Loading browser records…</p>}
      </main>
    </div>
  );
}
