// What CLIP chooses between (#56): a pack's or theme's answers, which come from
// the content or the command line at run time and are never committed, plus
// the committed generic list. Owner: Darian.

import { normalizeGuess } from "../../game/guess.ts";
import { GENERIC_LABELS } from "./generic-labels.ts";

/**
 * Each label is described in several sentences, and CLIP's embeddings of them
 * are averaged: steadier than one sentence (the CLIP paper's "prompt
 * ensembling"). These four suit zoomed-in, low-detail views.
 */
export const PROMPT_TEMPLATES = [
  "a photo of a {}.",
  "a close-up photo of a {}.",
  "a cropped photo of a {}.",
  "a low resolution photo of a {}.",
] as const;

/** The sentences for one label, one per template. */
export function prompts(label: string, templates: readonly string[] = PROMPT_TEMPLATES): string[] {
  return templates.map((template) => template.replace("{}", label));
}

/**
 * The labels: the answers first, then the generic list, each once. Two labels
 * are the same if they normalize the same way as a guess does ("Golden Gate
 * Bridge" and "golden gate bridge"); the first one written is kept.
 */
export function buildLabels(answers: readonly string[], generic: readonly string[] = GENERIC_LABELS): string[] {
  if (!answers.some((answer) => normalizeGuess(answer) !== "")) throw new RangeError("buildLabels: give at least one answer");
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const label of [...answers, ...generic]) {
    const key = normalizeGuess(label);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    labels.push(label.trim());
  }
  return labels;
}
