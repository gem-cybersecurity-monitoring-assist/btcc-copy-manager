import { ManagerShell } from "@/components/manager-shell";

const quickLinkStyle = {
  position: "fixed" as const,
  right: 14,
  zIndex: 1000,
  borderRadius: 999,
  padding: "10px 14px",
  background: "#e2e8f0",
  color: "#0f172a",
  textDecoration: "none",
  fontWeight: 800,
  boxShadow: "0 12px 36px rgba(0,0,0,.32)"
};

export default function HomePage() {
  return <>
    <a href="/purchase" style={{ ...quickLinkStyle, bottom: 62 }}>Finite BTC purchase</a>
    <a href="/steel" style={{ ...quickLinkStyle, bottom: 14 }}>Steel browser</a>
    <ManagerShell />
  </>;
}
