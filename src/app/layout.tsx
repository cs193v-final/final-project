import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Open_Sans } from "next/font/google";
import { Suspense } from "react";
import { AccountStatus } from "@/components/account/AccountStatus";
import { CloudsToggle } from "@/components/CloudsToggle";
import { MOTION_BOOT_SCRIPT } from "@/components/motion-boot";
import { SiteHeader } from "@/components/SiteHeader";
import { SkyBackdrop } from "@/components/SkyBackdrop";
import { chipClass, FOCUS_RING } from "@/components/ui/controls";
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

// The browser's own bar in the page's colours: Cloud Lavender, or the dark page.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e4ddfa" },
    { media: "(prefers-color-scheme: dark)", color: "#201a32" },
  ],
};

// Where "Skip to content" goes: the wrapper around each page, whose content is the page's own <main>.
const CONTENT_ID = "content";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${openSans.variable} h-full antialiased`}
      // The motion script below sets data-reduced-motion on <html> before React hydrates.
      suppressHydrationWarning
    >
      <head>
        {/* Before first paint: animations on or off, from the player's choice or the system (#183). */}
        <script dangerouslySetInnerHTML={{ __html: MOTION_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        {/* First in the tab order, so keyboard users can jump past the header (WCAG 2.4.1). Above the
            top edge until it has focus (not `sr-only`, whose reset would drop the chip's padding). */}
        <a
          href={`#${CONTENT_ID}`}
          className={chipClass("paper", `fixed top-3 left-3 z-50 -translate-y-[200%] focus:translate-y-0 ${FOCUS_RING}`)}
        >
          Skip to content
        </a>
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
        {/* Each page renders its own <main>; this wrapper is the skip link's target, laid out like the body. */}
        <div id={CONTENT_ID} className="flex flex-1 flex-col">
          {children}
        </div>
        {/* Last in the tab order: pauses the sky's drift (WCAG 2.2.2). */}
        <CloudsToggle />
      </body>
    </html>
  );
}
