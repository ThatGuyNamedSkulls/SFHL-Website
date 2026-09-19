import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider } from "@/components/session-provider";
import { Sidebar } from "@/components/sidebar";
import { RightSidebar } from "@/components/right-sidebar";
import { TopBar } from "@/components/top-bar";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { CountryPrompt } from "@/components/country-prompt";
import { MatchReadyModal } from "@/components/match-ready-modal";
import { VerifyPrompt } from "@/components/verify-prompt";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HyperLeague — Strike Force Matchmaking",
  description:
    "HyperLeague competitive Strike Force league. Ranked 5v5 matchmaking, ELO tracking, leaderboards, match history, and stats — synced live with the HyperLeague Discord.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full bg-hl-base text-white">
        <TooltipProvider>
          <SessionProvider>
            <div className="flex h-dvh overflow-hidden bg-[#111]">
              <Sidebar />
              <div className="flex-1 min-w-0 flex flex-col">
                <TopBar />
                <main className="hl-main flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                  {children}
                </main>
              </div>
              <RightSidebar />
              <MobileTabBar />
            </div>
            <CountryPrompt />
            <VerifyPrompt />
            <MatchReadyModal />
          </SessionProvider>
        </TooltipProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}
