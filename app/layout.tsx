import type { Metadata, Viewport } from "next";

// Root layout for the deployed GEM Copy Center. Note: because this root-level `app/` directory exists,
// Next.js ignores `src/app` entirely (see README "Repository layout").
export const metadata: Metadata = {
  title: { default: "GEM Copy Center", template: "%s | GEM Copy Center" },
  description: "Copy-trading planning dashboard: compare traders, keep review notes and manual portfolio snapshots. Copy-trading enrollment and trades happen on the exchange's own website or app.",
  applicationName: "GEM Copy Center",
  icons: { icon: "/icon.svg" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f6f8fb" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f6f8fb" }}>{children}</body>
    </html>
  );
}
