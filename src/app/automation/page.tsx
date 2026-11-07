import type { Metadata } from "next";
import { AutomationCenter } from "@/components/automation-center";

export const metadata: Metadata = {
  title: "Automation | GEM Copy Center",
  description: "Monitor dashboard risk-review schedules and verified connectivity.",
  robots: { index: false, follow: false },
};

export default function AutomationPage() { return <AutomationCenter />; }
