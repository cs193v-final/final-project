import Image from "next/image";

/**
 * The home screen's "Picture Island" (#183), and the game in one gesture: it
 * opens on a tight close-up of the camera's lens inside a viewfinder, then
 * zooms out to the whole island, the way a round clears up. Once landed, it
 * floats gently for a few cycles and settles.
 *
 * Decorative and not interactive, so it adds no tab stop before the daily
 * (#291 review). All CSS animation on `transform` (globals.css: `.island-*`),
 * so it stays smooth while the page loads; with reduced motion it's still.
 */
export function IslandHero() {
  return (
    <div aria-hidden="true" className="relative -mb-4 w-full max-w-xl">
      <div className="island-bob">
        <div data-island-zoom className="relative overflow-hidden rounded-3xl">
          <Image
            src="/brand/island.webp"
            alt=""
            width={1100}
            height={733}
            preload
            sizes="(min-width: 640px) 36rem, 100vw"
            className="island-photo block h-auto w-full"
          />
          {/* The viewfinder the close-up is seen through; it opens out and fades as the zoom lands. */}
          <div className="island-viewfinder pointer-events-none absolute inset-[6%]">
            <i className="absolute top-0 left-0 size-7 border-t-[3px] border-l-[3px] border-plum dark:border-[#fff5e6]" />
            <i className="absolute top-0 right-0 size-7 border-t-[3px] border-r-[3px] border-plum dark:border-[#fff5e6]" />
            <i className="absolute bottom-0 left-0 size-7 border-b-[3px] border-l-[3px] border-plum dark:border-[#fff5e6]" />
            <i className="absolute right-0 bottom-0 size-7 border-r-[3px] border-b-[3px] border-plum dark:border-[#fff5e6]" />
          </div>
        </div>
      </div>
    </div>
  );
}
