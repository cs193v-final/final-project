// The game's "monitor" (#183): the deep-plum frame a photo is played in, and
// the small pieces drawn on it. Shared by the timed round, the zoom-level
// game, the daily intro and the error screens, so they stay one design.

/** The plum frame around the photo, with its instrument rows. */
export const MONITOR = "w-full rounded-2xl border border-plum bg-plum p-2 text-[#fffbec] shadow-[0_5px_0_#473764]";

/** The photo frame inside the monitor. */
export const MONITOR_FRAME =
  "relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-[10px] bg-[#393052]";

/** The frame before there's a photo: hatched, with light text. */
export const MONITOR_EMPTY =
  "bg-[repeating-linear-gradient(45deg,#352b4b_0px,#352b4b_13px,#3b3054_13px,#3b3054_26px)] text-[#e5d2fc]";

/** The monitor's small caps labels. */
export const CAPS = "font-mono text-xs font-bold tracking-[0.1em] uppercase text-[#e0d4f2]";

/** The viewfinder corners over the photo while it clears (#183). Decorative. */
export function Corners() {
  const corner = "absolute size-4 border-[#fffbec]/75";
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-y-[15%] inset-x-[22%]">
      <i className={`${corner} top-0 left-0 border-t-2 border-l-2`} />
      <i className={`${corner} top-0 right-0 border-t-2 border-r-2`} />
      <i className={`${corner} bottom-0 left-0 border-b-2 border-l-2`} />
      <i className={`${corner} right-0 bottom-0 border-r-2 border-b-2`} />
    </span>
  );
}

/** The crop-and-lens mark, the brand glyph's shape (#183). Decorative. */
export function CropMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 4H4v4m12-4h4v4m0 8v4h-4M4 16v4h4" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}
