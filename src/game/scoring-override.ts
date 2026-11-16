// Per-pack scoring overrides (#64): turning whatever is stored in
// `packs.scoring` into a `ScoringConfig`. Pure, no database imports, so it is
// unit-testable and also usable by the update script (scripts/pack-scoring.ts).
//
// Relative imports keep their `.ts` extension so Node can run this file
// directly (type stripping) when the script loads it.
import { SCORING_CONFIG } from "./scoring-config.ts";
import { validateScoringConfig } from "./scoring.ts";
import type { ScoringConfig } from "./types.ts";

/** Some or all `ScoringConfig` fields. Missing fields take the default. */
export type ScoringOverride = Partial<ScoringConfig>;

/** Thrown when a stored or supplied scoring override is malformed or invalid. */
export class ScoringConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoringConfigError";
  }
}

const SCORING_KEYS = Object.keys(SCORING_CONFIG) as (keyof ScoringConfig)[];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks a stored override and returns it, or `null` if there is none
 * (`null`/`undefined`). Throws `ScoringConfigError` if it isn't an object,
 * has a field `ScoringConfig` doesn't (a typo like `basepoints` would
 * otherwise be ignored without anyone noticing), has a non-number value, or
 * if the result of merging it over `base` fails `validateScoringConfig`.
 */
export function parseScoringOverride(
  stored: unknown,
  base: ScoringConfig = SCORING_CONFIG,
): ScoringOverride | null {
  if (stored === null || stored === undefined) return null;
  if (!isPlainObject(stored)) {
    throw new ScoringConfigError(`scoring override must be a JSON object, got ${JSON.stringify(stored)}`);
  }
  const override: ScoringOverride = {};
  for (const [key, value] of Object.entries(stored)) {
    if (!(SCORING_KEYS as string[]).includes(key)) {
      throw new ScoringConfigError(
        `scoring override has an unknown field "${key}" (expected some of ${SCORING_KEYS.join(", ")})`,
      );
    }
    if (typeof value !== "number") {
      throw new ScoringConfigError(`ScoringConfig.${key} must be a number, got ${JSON.stringify(value)}`);
    }
    override[key as keyof ScoringConfig] = value;
  }
  mergeAndValidate(override, base);
  return override;
}

function mergeAndValidate(override: ScoringOverride, base: ScoringConfig): ScoringConfig {
  const merged: ScoringConfig = { ...base, ...override };
  try {
    validateScoringConfig(merged);
  } catch (error) {
    throw new ScoringConfigError(error instanceof Error ? error.message : String(error));
  }
  return merged;
}

/**
 * The config a pack plays with, given its stored `packs.scoring` value:
 *
 * - `null`/`undefined` (no override): `base`, the default `SCORING_CONFIG`.
 * - A full or partial override: merged over `base`, so fields left out keep
 *   the default. The merged result must pass `validateScoringConfig`.
 * - Anything else: throws `ScoringConfigError`. This function is strict; the
 *   database reader (`src/db/pack-scoring.ts`) decides what a game does with
 *   a bad stored value.
 *
 * Always returns a fresh object, never `base` itself.
 */
export function resolveScoringConfig(stored: unknown, base: ScoringConfig = SCORING_CONFIG): ScoringConfig {
  const override = parseScoringOverride(stored, base);
  return mergeAndValidate(override ?? {}, base);
}
