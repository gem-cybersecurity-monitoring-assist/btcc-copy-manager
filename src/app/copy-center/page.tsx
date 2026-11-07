import type { Metadata } from "next";
import { CopyCenterWorkspace } from "@/components/copy-center-workspace";
import "./copy-center.css";

export const metadata: Metadata = {
  title: "GEM Copy Center",
  description:
    "A mobile-friendly multi-provider workspace for connection status, account connectivity, trader intelligence, portfolio oversight, and performance monitoring.",
  robots: { index: false, follow: false },
};

export default function CopyCenterPage() {
  return <CopyCenterWorkspace />;
}
