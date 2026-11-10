import type { Puzzle } from "@/game/types";

// PLACEHOLDER puzzles so the guessing UI (#14) can be played before the real
// puzzle data lands. Joseph's #17 replaces this file with puzzles/sample.json
// and real images. There are no images here, only answers.
export const PLACEHOLDER_PUZZLES: Puzzle[] = [
  {
    id: "placeholder-1",
    imageUrl: "",
    answer: "Golden Gate Bridge",
    acceptedAnswers: ["Golden Gate"],
    reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [8, 4, 2, 1] },
    credit: { source: "placeholder (no image)", license: "n/a" },
  },
  {
    id: "placeholder-2",
    imageUrl: "",
    answer: "Eiffel Tower",
    acceptedAnswers: ["Tour Eiffel"],
    reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [8, 4, 2, 1] },
    credit: { source: "placeholder (no image)", license: "n/a" },
  },
  {
    id: "placeholder-3",
    imageUrl: "",
    answer: "Statue of Liberty",
    acceptedAnswers: ["Lady Liberty"],
    reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [8, 4, 2, 1] },
    credit: { source: "placeholder (no image)", license: "n/a" },
  },
];
