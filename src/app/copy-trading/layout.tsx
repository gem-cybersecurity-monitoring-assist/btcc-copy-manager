import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GEM Copy Center",
  description: "Multi-provider copy-trading research, portfolio planning, and risk analysis. No automatic exchange execution.",
  robots: { index: false, follow: false },
};

export default function CopyTradingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
