// Zoom (#257): starts 16× on the focus point and pulls back to the whole
// photo. For harder photos. Near an edge the window slides inward instead of
// showing empty space, as the old zoom levels did (`cropTransform`).

import { clamp, focusPoint, type EffectSetup, type Pixels } from "./pixels.ts";
import { resampler } from "./resample.ts";

/** How far in it starts: the first frame shows 1/16 of the photo's width and height. */
export const ZOOM_START = 16;
/** Below 1, it pulls back faster at the start. */
export const ZOOM_EASE = 0.8;

/**
 * Given a photo bigger than the frame, zoom samples it while its view is no
 * bigger than the frame (so the close-up is sharp), the frame-sized copy once
 * the view is twice the frame (so fine detail doesn't flicker), and a blend
 * of the two in between.
 */
export const zoom: EffectSetup = (frame, options, bigger) => {
  const { width, height } = frame;
  const focus = focusPoint(options.focus);
  const resample = resampler(width, height);
  const blend = bigger ? new Uint8ClampedArray(frame.data.length) : undefined;

  /** The view at zoom `z` of `photo` (any size), drawn into `out`. */
  const view = (photo: Pixels, z: number, out: Uint8ClampedArray) => {
    const viewW = photo.width / z, viewH = photo.height / z;
    resample(
      photo.data, photo.width, photo.height, out,
      { offset: clamp(focus.x * photo.width - viewW / 2, 0, photo.width - viewW), scale: viewW / width },
      { offset: clamp(focus.y * photo.height - viewH / 2, 0, photo.height - viewH), scale: viewH / height },
    );
  };

  return (progress, out) => {
    const z = ZOOM_START ** (1 - progress ** ZOOM_EASE);
    if (!bigger || !blend) return view(frame, z, out);
    // How many of the big photo's pixels each frame pixel would cover.
    const cover = Math.max(bigger.width / width, bigger.height / height) / z;
    if (cover >= 2) return view(frame, z, out);
    view(bigger, z, out);
    if (cover <= 1) return;
    view(frame, z, blend);
    const t = Math.log2(cover);
    for (let i = 0; i < out.length; i++) out[i] = out[i]! + (blend[i]! - out[i]!) * t;
  };
};
