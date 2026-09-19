import NycMap from "@/components/NycMapClient";

export default function Home() {
  return (
    <main className="relative h-screen w-full">
      <NycMap />
      <div className="pointer-events-none absolute left-4 top-4 rounded-lg bg-white/90 px-4 py-3 shadow">
        <h1 className="text-lg font-semibold text-zinc-900">
          Health in Climate NYC
        </h1>
        <p className="text-sm text-zinc-600">Five boroughs</p>
      </div>
    </main>
  );
}
