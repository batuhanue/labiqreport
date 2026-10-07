"use client";

import { motion } from "motion/react";
import { easeOutExpo } from "@/lib/motion";

/**
 * Sayfa geçişi: her rota değişiminde içerik yumuşakça yukarı kayarak gelir.
 * Not: yalnızca opacity + y (bitince transform "none" olur; içerideki fixed öğeler bozulmaz).
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: easeOutExpo }}>
      {children}
    </motion.div>
  );
}
