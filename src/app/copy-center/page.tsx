import type { Metadata } from "next";
import { CopyCenterWorkspace } from "@/components/copy-center-workspace";
import "./copy-center.css";

export const metadata: Metadata = {
  title: "GEM Copy Center",
  description: "A mobile-friendly multi-provider workspace for connection status, portfolio planning, and risk-aware copy-trading research.",
  robots: { index: false, follow: false },
};

export default function CopyCenterPage() {
  return <><div style={{ padding: "12px 20px", background: "#e9f7f0", borderBottom: "1px solid #c4e5d3", fontFamily: "system-ui, sans-serif", fontSize: 13 }}><strong>Paper mode:</strong> <a href="/copy-center/positions" style={{ color: "#116448", fontWeight: 700 }}>Open positions &amp; approval queue →</a> <span style={{ color: "#536d61" }}>· No live transactions</span></div><CopyCenterWorkspace /></>;
}
