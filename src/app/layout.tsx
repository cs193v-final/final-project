import type { Metadata } from "next";
import { Geist, Geist_Mono, Open_Sans } from "next/font/google";
import { Suspense } from "react";
import { AccountStatus } from "@/components/account/AccountStatus";
import { CloudsToggle } from "@/components/CloudsToggle";
import { SiteHeader } from "@/components/SiteHeader";
import { SkyBackdrop } from "@/components/SkyBackdrop";
import { GAME_NAME } from "@/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The display face of the "Picture Island" look (#183): titles, big numbers.
const openSans = Open_Sans({
  variable: "--font-open-sans",
  weight: "800",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: GAME_NAME,
  description: "A daily image-guessing game. Zoom out to reveal more, but every reveal costs points.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${openSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* The drifting sky behind every screen (#183). Decorative. */}
        <SkyBackdrop />
        {/* On every screen: the game's name links home (#50). */}
        <SiteHeader
          account={
            // Reads the session cookie, so it streams in per request (#53).
            <Suspense fallback={null}>
              <AccountStatus />
            </Suspense>
          }
        />
        {children}
        {/* Last in the tab order: pauses the sky's drift (WCAG 2.2.2). */}
        <CloudsToggle />
      </body>
    </html>
  );
}
