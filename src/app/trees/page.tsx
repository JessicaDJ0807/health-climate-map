import type { Metadata } from "next";
import TreeExplorer from "@/components/TreeExplorer";

export const metadata: Metadata = {
  title: "NYC Street Trees",
  description: "Map of NYC street trees from the 2015 Street Tree Census",
};

export default function TreesPage() {
  return (
    <main className="relative h-screen w-full bg-[#f9f9f7]">
      <TreeExplorer />
    </main>
  );
}
