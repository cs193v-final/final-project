// Tiles (#257): the photo under a grid of 48 covers that open one by one in a
// random order. For harder photos. The order comes from the seed (the
// puzzle's id), so every player, and the AI solver, sees the same one.

import { packPixel, shuffled, words, type EffectSetup } from "./pixels.ts";

/** The grid on a landscape or square photo; a portrait photo gets it turned (6 across, 8 down). */
export const TILES_ACROSS = 8;
export const TILES_DOWN = 6;
/** Above 1, the first tiles open a little slower than the last. */
export const TILES_EASE = 1.15;
/** The covers: a checkerboard of two greys with a darker edge, so you can count what's left. */
export const TILE_COLORS = { light: [63, 63, 70], dark: [39, 39, 42], edge: [24, 24, 27] } as const;
/** The edge's width, as a fraction of a tile's shorter side. */
export const TILE_EDGE = 0.02;

const LIGHT = packPixel(...TILE_COLORS.light);
const DARK = packPixel(...TILE_COLORS.dark);
const EDGE = packPixel(...TILE_COLORS.edge);

/** The grid for a photo: `[across, down]`. */
export function tileGrid(width: number, height: number): [number, number] {
  return height > width ? [TILES_DOWN, TILES_ACROSS] : [TILES_ACROSS, TILES_DOWN];
}

/** How many tiles are open at `progress` (0 ≤ progress < 1). */
export function openTiles(progress: number): number {
  return Math.floor(progress ** TILES_EASE * TILES_ACROSS * TILES_DOWN);
}

/** The order the tiles open in: tile indexes, row by row from the top left. */
export function tileOrder(seed: string): number[] {
  return shuffled(TILES_ACROSS * TILES_DOWN, seed);
}

export const tiles: EffectSetup = ({ data, width, height }, { seed }) => {
  const [across, down] = tileGrid(width, height);
  const order = tileOrder(seed);
  return (progress, out) => {
    out.set(data);
    const pixels = words(out);
    for (let k = openTiles(progress); k < order.length; k++) {
      const tile = order[k]!;
      const col = tile % across, row = Math.floor(tile / across);
      const x0 = Math.round((col * width) / across), x1 = Math.round(((col + 1) * width) / across);
      const y0 = Math.round((row * height) / down), y1 = Math.round(((row + 1) * height) / down);
      const edge = Math.max(1, Math.round(Math.min(x1 - x0, y1 - y0) * TILE_EDGE));
      const fill = (row + col) % 2 === 0 ? LIGHT : DARK;
      for (let y = y0; y < y1; y++) {
        const start = y * width;
        if (y < y0 + edge || y >= y1 - edge) {
          pixels.fill(EDGE, start + x0, start + x1);
        } else {
          pixels.fill(EDGE, start + x0, start + Math.min(x0 + edge, x1));
          pixels.fill(fill, start + x0 + edge, start + x1 - edge);
          pixels.fill(EDGE, start + Math.max(x1 - edge, x0), start + x1);
        }
      }
    }
  };
};
