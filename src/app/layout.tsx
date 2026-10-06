import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { PeriodProvider } from "@/components/PeriodProvider";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-jakarta",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "LabIQ Kontrol",
  description: "Diacore aylık kapanış kontrol listesi — Bursa & Başakşehir",
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "LabIQ Kontrol", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f1ec",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={jakarta.variable}>
      <body className="font-sans antialiased">
        <PeriodProvider>
          <AppShell>{children}</AppShell>
        </PeriodProvider>
      </body>
    </html>
  );
}
