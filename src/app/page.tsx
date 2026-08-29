import { ManagerShell } from "@/components/manager-shell";

export default function HomePage() {
  return <>
    <a
      href="/steel"
      style={{
        position: "fixed",
        right: 14,
        bottom: 14,
        zIndex: 1000,
        borderRadius: 999,
        padding: "10px 14px",
        background: "#e2e8f0",
        color: "#0f172a",
        textDecoration: "none",
        fontWeight: 800,
        boxShadow: "0 12px 36px rgba(0,0,0,.32)",
      }}
    >
      Steel browser
    </a>
    <ManagerShell />
  </>;
}
