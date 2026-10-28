import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./usability.css";
import "./copy-center.css";

export const metadata: Metadata = {
  title: { default: "GEM Copy Center", template: "%s | GEM Copy Center" },
  description: "A mobile-friendly multi-provider workspace for connection status, portfolio planning, and risk-aware copy-trading research.",
  applicationName: "GEM Copy Center"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4f7fb"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
