"use client";

import dynamic from "next/dynamic";

/** Ana sayfa: canlı ada — her bina uygulamanın bir bölümü (Denetim, Beyin, Google ofis…). */
const IslandHome = dynamic(() => import("@/components/island/IslandHome"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 grid place-items-center bg-[#dfeaf1]">
      <div className="text-[13px] font-extrabold tracking-[0.32em] text-[#1d2433]/70">
        LABIQ <span className="font-medium opacity-60">ADA</span>
      </div>
    </div>
  ),
});

export default function Home() {
  return <IslandHome />;
}
