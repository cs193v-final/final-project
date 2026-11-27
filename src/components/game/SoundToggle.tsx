"use client";

import { Button } from "../ui/controls";
import { setSoundOn, sounds, unlockAudio, useSoundOn } from "./sound";

/** Turns the game's sound effects and vibration on or off (#283). Remembered in this browser. */
export function SoundToggle() {
  const on = useSoundOn();
  return (
    <Button
      variant="quiet"
      aria-pressed={on}
      onClick={() => {
        setSoundOn(!on);
        if (!on) {
          unlockAudio();
          sounds.blip();
        }
      }}
    >
      <span aria-hidden="true">{on ? "🔊" : "🔇"}</span>
      Sound
    </Button>
  );
}
