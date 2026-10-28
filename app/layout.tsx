import type { Metadata, Viewport } from "next";
import "./copy-center.css";

export const metadata: Metadata = {
  title: { default: "GEM Copy Center", template: "%s | GEM Copy Center" },
  description: "A mobile-friendly multi-provider workspace for connection status, portfolio planning, and risk-aware copy-trading research.",
  applicationName: "GEM Copy Center",
  icons: { icon: "/icon.svg" },
  robots: { index: false, follow: false }
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f4f7fb" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f4f7fb" }}>{children}</body>
    </html>
  );
}
