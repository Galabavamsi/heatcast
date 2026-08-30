import type { Metadata } from "next";
import { ToolsProvider } from "@/components/tools/ToolsProvider";

export const metadata: Metadata = {
  title: "Tools",
  description: "HeatCast inferred tools — cooling plan, walk exposure, peak hours, compound hours.",
};

export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return <ToolsProvider>{children}</ToolsProvider>;
}
