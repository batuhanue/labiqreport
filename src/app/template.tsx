"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, ViewTransition } from "react";
import { routeCommitted } from "@/lib/vt";

/**
 * Sayfa geçişleri (React <ViewTransition> + tarayıcının View Transitions API'si):
 * - bölümler arası: menü sırasına göre yönlü, yaylı kayma (page-fwd / page-back)
 * - ada ↔ bölüm: tüm ekran dairesel kapı (portal / to-island, globals.css'te kök düzeyinde)
 * - içerik: data-cascade ile bölümler sırayla yükselir
 * Tarayıcı desteklemezse sayfa normal açılır.
 */
const DIR = { "nav-forward": "page-fwd", "nav-back": "page-back", default: "none" };

export default function Template({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  // kök düzeyindeki geçiş (ada ↔ bölüm) yeni sayfanın işlendiğini bekliyor
  useLayoutEffect(() => routeCommitted(), [path]);
  // ada tam ekran: geçişi kök düzeyindeki dairesel kapı yapar
  if (path === "/") return <>{children}</>;
  return (
    <ViewTransition enter={DIR} exit={DIR} default="none">
      <div data-cascade>{children}</div>
    </ViewTransition>
  );
}
