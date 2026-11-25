// CLIP, run locally in Node with transformers.js (#56). Owner: Darian.
//
// The one place that loads the model. Everything else (labels.ts, decide.ts,
// analyze.ts) talks to it through `ClipModel`, so the tests use a fake one and
// never need the model or its 735 MB install.
//
// Scripts only: never import src/images/clip from app code (boundary.test.ts
// checks). transformers.js has its own install in tools/clip/, so the app's
// install, CI and Vercel don't carry onnxruntime. Install it once with
// `npm run clip:install`. The first run downloads the model (about 610 MB) into
// tools/clip/.cache/ (git-ignored); after that everything runs offline, with no
// API key and no cost per call. Both stay out of src/, which tests read file by
// file.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The model, pinned to one revision so every run (the picker's scores and the
 * solver's `aiSolvedLevel`) uses the same weights. ViT-B/32: the smallest and
 * fastest CLIP, fine for "what is this a photo of" over a few hundred labels.
 * fp32, the reference weights: 254 MB (text) + 352 MB (image).
 */
export const CLIP_MODEL = {
  id: "Xenova/clip-vit-base-patch32",
  revision: "6b7c523703ae26e39be4b03774966f8571c7f523",
  dtype: "fp32",
} as const;

/** CLIP looks at a 224 × 224 square. analyze.ts fits every view into one. */
export const CLIP_INPUT_SIZE = 224;

/** CLIP's own install: tools/clip/package.json and its node_modules. */
const CLIP_TOOL = new URL("../../../tools/clip/", import.meta.url);

/** Where the downloaded model is kept: inside the repo, so it survives a container restart, but git-ignored. */
export const CLIP_CACHE_DIR = fileURLToPath(new URL(".cache/", CLIP_TOOL));

/** The model's files, as transformers.js keeps them in the cache: `<cache>/<id>/<revision>/<file>`. */
const MODEL_FILES = ["config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json", "onnx/text_model.onnx", "onnx/vision_model.onnx"];
const modelDir = (cacheDir: string) => join(cacheDir, CLIP_MODEL.id, CLIP_MODEL.revision);

/** True once every file of the pinned model is in `cacheDir`, so it can load without the network. */
export function isDownloaded(cacheDir = CLIP_CACHE_DIR): boolean {
  return MODEL_FILES.every((file) => existsSync(join(modelDir(cacheDir), file)));
}

/** An RGB image, 3 bytes per pixel, row by row. */
export type RgbImage = { data: Uint8Array; width: number; height: number };

/** What the rest of the module needs from CLIP: unit-length embeddings of texts and images, in order. */
export type ClipModel = {
  /** e.g. "Xenova/clip-vit-base-patch32@6b7c523", for reports. */
  readonly name: string;
  embedTexts(texts: readonly string[]): Promise<Float32Array[]>;
  embedImages(images: readonly RgbImage[]): Promise<Float32Array[]>;
};

/** `v` scaled to length 1 (a zero vector stays zero). */
export function unit(v: Float32Array): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const length = Math.sqrt(sum);
  return length === 0 ? v : v.map((x) => x / length);
}

/** Splits a batch output of `rows` embeddings into one vector each, made unit length. */
export function splitRows(data: Float32Array, rows: number): Float32Array[] {
  if (rows === 0) return [];
  if (data.length % rows !== 0) throw new Error(`can't split ${data.length} numbers into ${rows} rows`);
  const width = data.length / rows;
  return Array.from({ length: rows }, (_, i) => unit(data.slice(i * width, (i + 1) * width)));
}

// The slice of transformers.js this file uses. It's loaded from tools/clip at
// run time, so TypeScript never looks for the package: CI and the app never
// install it.
type Tensor = { data: Float32Array; dims: number[] };
type Loader<T> = { from_pretrained(id: string, options: Record<string, unknown>): Promise<T> };
type Tokenizer = (texts: string[], options: { padding: boolean; truncation: boolean }) => Record<string, unknown>;
type Transformers = {
  env: { cacheDir: string | null; allowRemoteModels: boolean };
  AutoTokenizer: Loader<Tokenizer>;
  CLIPTokenizer: new (tokenizerJson: unknown, tokenizerConfig: unknown) => Tokenizer;
  AutoProcessor: Loader<(images: unknown[]) => Promise<Record<string, unknown>>>;
  CLIPTextModelWithProjection: Loader<(inputs: Record<string, unknown>) => Promise<{ text_embeds: Tensor }>>;
  CLIPVisionModelWithProjection: Loader<(inputs: Record<string, unknown>) => Promise<{ image_embeds: Tensor }>>;
  RawImage: new (data: Uint8Array, width: number, height: number, channels: 3) => unknown;
};

function loadTransformers(): Transformers {
  try {
    return createRequire(new URL("package.json", CLIP_TOOL))("@huggingface/transformers") as Transformers;
  } catch (error) {
    if ((error as { code?: string }).code === "MODULE_NOT_FOUND") {
      throw new Error("CLIP isn't installed. Run `npm run clip:install` once (about 735 MB), then try again.");
    }
    throw error;
  }
}

export type LoadClipOptions = {
  /** Where to keep the downloaded model. Default CLIP_CACHE_DIR. */
  cacheDir?: string;
  /** Called with download progress, e.g. to print it. */
  onProgress?: (event: { status: string; file?: string; progress?: number }) => void;
};

/**
 * The tokenizer, from the pinned revision's files in the cache. transformers.js
 * 4.3.2's AutoTokenizer first checks that a tokenizer exists on the model's
 * latest revision, not the pinned one, so it can't load offline; it's only used
 * here to download the files the first time.
 */
async function loadTokenizer(t: Transformers, cacheDir: string, options: Record<string, unknown>): Promise<Tokenizer> {
  const dir = modelDir(cacheDir);
  if (!existsSync(join(dir, "tokenizer.json")) || !existsSync(join(dir, "tokenizer_config.json"))) {
    await t.AutoTokenizer.from_pretrained(CLIP_MODEL.id, options);
  }
  const [json, config] = await Promise.all(
    ["tokenizer.json", "tokenizer_config.json"].map(async (file) => JSON.parse(await readFile(join(dir, file), "utf8")) as unknown),
  );
  return new t.CLIPTokenizer(json, config);
}

/** Texts and images per call to the model: large enough to be quick, small enough for a laptop's memory. */
const TEXT_BATCH = 64;
const IMAGE_BATCH = 16;

/**
 * Loads CLIP and returns a `ClipModel`. The first run downloads it into
 * `cacheDir`; after that it loads from there with the network turned off.
 */
export async function loadClip({ cacheDir = CLIP_CACHE_DIR, onProgress }: LoadClipOptions = {}): Promise<ClipModel> {
  const t = loadTransformers();
  t.env.cacheDir = cacheDir;
  t.env.allowRemoteModels = !isDownloaded(cacheDir);
  const options = { revision: CLIP_MODEL.revision, dtype: CLIP_MODEL.dtype, device: "cpu", progress_callback: onProgress };
  const [tokenizer, processor, textModel, visionModel] = await Promise.all([
    loadTokenizer(t, cacheDir, options),
    t.AutoProcessor.from_pretrained(CLIP_MODEL.id, options),
    t.CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL.id, options),
    t.CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL.id, options),
  ]);

  return {
    name: `${CLIP_MODEL.id}@${CLIP_MODEL.revision.slice(0, 7)}`,
    async embedTexts(texts) {
      const out: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += TEXT_BATCH) {
        const batch = texts.slice(i, i + TEXT_BATCH);
        const { text_embeds } = await textModel(tokenizer([...batch], { padding: true, truncation: true }));
        out.push(...splitRows(text_embeds.data, batch.length));
      }
      return out;
    },
    async embedImages(images) {
      const out: Float32Array[] = [];
      for (let i = 0; i < images.length; i += IMAGE_BATCH) {
        const batch = images.slice(i, i + IMAGE_BATCH).map((img) => new t.RawImage(img.data, img.width, img.height, 3));
        const { image_embeds } = await visionModel(await processor(batch));
        out.push(...splitRows(image_embeds.data, batch.length));
      }
      return out;
    },
  };
}
