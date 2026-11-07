import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./usability.css";
import { WorkspaceNavigation } from "@/components/workspace-navigation";
import { DashboardReviewRunner } from "@/components/dashboard-review-runner";

export const metadata: Metadata = {
  title: { default: "BTCC Copy Manager", template: "%s | BTCC Copy Manager" },
  description: "Risk-controlled BTCC live futures execution, position monitoring, and guarded connectivity.",
  applicationName: "BTCC Copy Manager"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#07111f"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><WorkspaceNavigation /><DashboardReviewRunner />{children}</body>
    </html>
  );
}
