import type { Metadata } from "next";
import ScoreApp from "@/components/ScoreApp";

export const metadata: Metadata = {
  title: "Score",
  description: "Draw a US neighborhood and score air temperature, hours above threshold, and indoor access.",
};

export default function AppPage() {
  return <ScoreApp />;
}
