"use client";

/**
 * Kök düzeyindeki sayfa geçişleri (ada ↔ bölüm): tarayıcının View Transitions API'si türlerle (types) başlatılır,
 * yeni rota ekrana işlendiğinde (template'in layout effect'i) geçiş tamamlanır. React'in <ViewTransition>
 * sınırları bu geçişte devreye girmez (tür eşlemeleri "none"), böylece iki geçiş çakışmaz.
 */
let resolve: (() => void) | null = null;

/** yeni rota DOM'a işlendi: bekleyen geçişin "yeni" görüntüsü alınabilir */
export function routeCommitted() {
  const r = resolve;
  resolve = null;
  r?.();
}

type VTDoc = Document & { startViewTransition?: (o: { update: () => Promise<void>; types: string[] }) => unknown };

export function vtNavigate(push: (href: string) => void, href: string, type: "portal" | "to-island") {
  const d = document as VTDoc;
  const typed = typeof window !== "undefined" && "ViewTransitionTypeSet" in window;
  if (!d.startViewTransition || !typed || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return push(href);
  d.startViewTransition({
    types: [type],
    update: () =>
      new Promise<void>((res) => {
        resolve = res;
        push(href);
        // rota gecikirse sayfa donmasın
        setTimeout(() => {
          if (resolve === res) routeCommitted();
        }, 2500);
      }),
  });
}
