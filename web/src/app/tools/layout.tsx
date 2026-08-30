import type { Metadata } from "next";
import { ToolsProvider } from "@/components/tools/ToolsProvider";

export const metadata: Metadata = {
  title: "Tools",
  description: "HeatCast inferred tools — site hours, peak, compound, shift window, cooling plan, walk, district score.",
};

export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return <ToolsProvider>{children}</ToolsProvider>;
}
