// The motion switch's server-safe parts (#183): no "use client", so the root
// layout can read them. The rest of the switch lives in game/motion.ts.

export const MOTION_STORAGE_KEY = "zoomout:motion";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Runs before the first paint (layout.tsx), so the CSS motion rules
 * (`:root[data-reduced-motion]` in globals.css) are right from the first
 * frame: the player's in-app choice ("on"/"off"), else the system setting.
 * `MotionToggle` keeps the attribute in step afterwards.
 */
export const MOTION_BOOT_SCRIPT = `(function(){var d=document.documentElement;var s=false;try{s=window.matchMedia("${REDUCED_MOTION_QUERY}").matches}catch(e){}var c=null;try{c=localStorage.getItem("${MOTION_STORAGE_KEY}")}catch(e){}if(c==="off"||(c!=="on"&&s))d.setAttribute("data-reduced-motion","")})();`;
