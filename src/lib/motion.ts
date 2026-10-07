// Hareket ön ayarları — freshtechbro/claudedesignskills (motion-framer, modern-web-design,
// react-spring-physics) önerilerine göre. Yalnızca transform/opacity canlandırılır.
import type { Transition, Variants } from "motion/react";

export const spring = {
  gentle: { type: "spring", stiffness: 100, damping: 20 },
  wobbly: { type: "spring", stiffness: 200, damping: 10 },
  stiff: { type: "spring", stiffness: 400, damping: 30 },
  slow: { type: "spring", stiffness: 50, damping: 20 },
  /** hover lift / buton (modern-web-design 1.1) */
  lift: { type: "spring", stiffness: 400, damping: 17 },
  /** sayfa ve kart girişleri */
  enter: { type: "spring", stiffness: 260, damping: 26 },
  pop: { type: "spring", stiffness: 500, damping: 15 },
} satisfies Record<string, Transition>;

export const easeOutExpo = [0.22, 1, 0.36, 1] as const;

/** Kademeli liste (staggerChildren) */
export const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.03 } },
};
export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: spring.enter },
};

/** Ekrana girince açılma (whileInView, once) */
export const reveal = {
  initial: { opacity: 0, y: 26 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.15 },
  transition: { duration: 0.55, ease: easeOutExpo },
} as const;

export const hoverLift = { y: -3, transition: spring.lift };
export const tapPress = { scale: 0.97, transition: spring.lift };
