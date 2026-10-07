import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { PeriodProvider } from "@/components/PeriodProvider";
import { themeScript } from "@/components/Theme";
import { NotesProvider } from "@/components/notes/NotesPanel";
import { TodoProvider } from "@/components/todos/TodoProvider";
import { AssistantProvider } from "@/components/assistant/AssistantPanel";
import { GoogleProvider } from "@/components/google/GoogleProvider";
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f1ec" },
    { media: "(prefers-color-scheme: dark)", color: "#111319" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={jakarta.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans antialiased">
        <PeriodProvider>
          <TodoProvider>
            <GoogleProvider>
              <NotesProvider>
                <AssistantProvider>
                  <AppShell>{children}</AppShell>
                </AssistantProvider>
              </NotesProvider>
            </GoogleProvider>
          </TodoProvider>
        </PeriodProvider>
      </body>
    </html>
  );
}
