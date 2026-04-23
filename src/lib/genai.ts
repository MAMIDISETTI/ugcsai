import { GoogleGenAI } from "@google/genai";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
if (!apiKey) {
  console.warn("GOOGLE_CLOUD_API_KEY not set – AI features will fail.");
}

const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

// Resolved at runtime from node_modules — not bundled by webpack
const FFMPEG_PATH = ffmpegInstaller.path;

// ─── Constants ────────────────────────────────────────────────────────────────

const VEO_POLL_INTERVAL_MS = 10_000;
const VEO_TIMEOUT_MS       = 300_000;
const RETRY_MAX_ATTEMPTS   = 4;
const RETRY_BASE_DELAY_MS  = 15_000;
const RETRYABLE_CODES      = new Set([14, 8, 429]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as any).code;
  const message = ((error as any).message ?? "").toLowerCase();
  return (
    RETRYABLE_CODES.has(code) ||
    message.includes("high demand") ||
    message.includes("try again") ||
    message.includes("resource exhausted") ||
    message.includes("unavailable")
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxAttempts = RETRY_MAX_ATTEMPTS,
  baseDelayMs = RETRY_BASE_DELAY_MS
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const retryable = isRetryableError(err);
      const isLast = attempt === maxAttempts;
      if (!retryable || isLast) {
        console.error(`[${label}] Failed on attempt ${attempt}/${maxAttempts}:`, err);
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`[${label}] Attempt ${attempt}/${maxAttempts} — retrying in ${delay / 1000}s…`);
      await sleep(delay);
    }
  }
  throw lastError;
}

async function fetchImageAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString("base64");
}

// ─── Extract last frame from a video as base64 JPEG ──────────────────────────

function extractLastFrameAsBase64(videoPath: string): string {
  const framePath = path.join(os.tmpdir(), `veo-lastframe-${Date.now()}.jpg`);

  // sseof=-0.1 seeks to 0.1s before end → grabs the very last frame
  execSync(
    `"${FFMPEG_PATH}" -sseof -0.1 -i "${videoPath}" -frames:v 1 -q:v 2 "${framePath}"`
  );

  const frameBuffer = fs.readFileSync(framePath);
  const base64 = frameBuffer.toString("base64");

  try { fs.unlinkSync(framePath); } catch {}

  return base64;
}

// ─── Generate one Veo clip from an image (base64) ────────────────────────────

async function generateClip(
  imageBase64: string,
  prompt: string,
  clipLabel: string
): Promise<string> {
  // Start generation
  const operation = await withRetry(
    `${clipLabel} — start`,
    () =>
      ai!.models.generateVideos({
        model: "veo-3.1-generate-preview",
        prompt,
        image: {
          imageBytes: imageBase64,
          mimeType: "image/jpeg",
        },
        config: {
          numberOfVideos: 1,
          durationSeconds: 8,
        },
      })
  );

  // Poll until done
  let currentOperation = operation;
  const deadline = Date.now() + VEO_TIMEOUT_MS;

  while (!currentOperation.done && Date.now() < deadline) {
    await sleep(VEO_POLL_INTERVAL_MS);
    currentOperation = await withRetry(
      `${clipLabel} — poll`,
      () => ai!.operations.getVideosOperation({ operation: currentOperation })
    );
  }

  if (!currentOperation.done) {
    throw new Error(`[${clipLabel}] Timed out after ${VEO_TIMEOUT_MS / 1000}s.`);
  }
  if (currentOperation.error) {
    throw new Error(`[${clipLabel}] Failed: ${JSON.stringify(currentOperation.error)}`);
  }

  const video = currentOperation.response?.generatedVideos?.[0]?.video;
  if (!video) throw new Error(`[${clipLabel}] No video object returned.`);

  const tmpPath = path.join(os.tmpdir(), `veo-clip-${Date.now()}.mp4`);

  if (video.videoBytes) {
    fs.writeFileSync(tmpPath, Buffer.from(video.videoBytes, "base64"));
  } else if (video.uri) {
    const generatedVideo = currentOperation.response!.generatedVideos![0]!;
    await withRetry(`${clipLabel} — download`, () =>
      ai!.files.download({
        file: generatedVideo,
        downloadPath: tmpPath,
      })
    );
  } else {
    throw new Error(`[${clipLabel}] No videoBytes or uri in response.`);
  }

  console.log(`✓ ${clipLabel} saved: ${tmpPath}`);
  return tmpPath;
}

// ─── Normalize a clip (fix timestamps + codec) ────────────────────────────────

function normalizeClip(inputPath: string, label: string): string {
  const outputPath = path.join(os.tmpdir(), `veo-norm-${Date.now()}.mp4`);
  console.log(`Normalizing ${label}...`);
  execSync(
    `"${FFMPEG_PATH}" -i "${inputPath}" -c:v libx264 -preset fast -crf 18 -c:a aac -ar 44100 "${outputPath}"`
  );
  console.log(`✓ ${label} normalized`);
  return outputPath;
}

// ─── generateImagePrompt ──────────────────────────────────────────────────────

export async function generateImagePrompt(
  productName: string,
  productDescription: string,
  userPromptPartial: string
): Promise<string[]> {
  if (!ai) return [];
  const prompt = `You are an ad copy expert.

Product Name: ${productName}
Product Description: ${productDescription}

User's Partial Prompt: "${userPromptPartial}"

Based on the user's partial prompt, generate exactly 10 short ad creative prompt suggestions that logically complete the idea.

Rules:
- Each suggestion must be one short line.
- Suggestions must be relevant to the product and the user's partial prompt.
- Do not add numbering, bullets, or extra text.
- Return exactly 10 lines only.
`;
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
  });
  const text = (response.text ?? "").trim();
  return text
    .split("\n")
    .map((s) => s.replace(/^[\d.)\-\*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 10);
}

// ─── generateAdImage ──────────────────────────────────────────────────────────

export async function generateAdImage(
  productImageUrl: string,
  productName: string,
  productDescription: string,
  userPrompt: string,
  _aspectRatio: string
): Promise<Buffer> {
  if (!ai) throw new Error("Google GenAI not configured");
  const imageBase64 = await fetchImageAsBase64(productImageUrl);
  const prompt = `Create a single high-quality UGC-style ad image for social media (Meta/Instagram/Reels). 
Product: ${productName}. Description: ${productDescription}.
User creative direction: ${userPrompt || "Modern, eye-catching UGC ad."}
Output a single image, no text overlay unless requested.`;
  const response = await ai.interactions.create({
    model: "gemini-3-pro-image-preview",
    input: [
      { type: "text", text: prompt },
      { type: "image", data: imageBase64, mime_type: "image/jpeg" },
    ],
    response_modalities: ["image"],
  });
  for (const output of response.outputs ?? []) {
    if (output.type === "image" && output.data) {
      return Buffer.from(output.data, "base64");
    }
  }
  throw new Error("No image in response");
}

// ─── generateVideoFromImage ───────────────────────────────────────────────────

export async function generateVideoFromImage(
  imageUrl: string,
  productName: string,
  userPrompt: string
): Promise<Buffer> {
  if (!ai) throw new Error("Google GenAI not configured");

  // Validate ffmpeg
  try {
    execSync(`"${FFMPEG_PATH}" -version`, { stdio: "ignore" });
  } catch {
    throw new Error(`ffmpeg not accessible at: ${FFMPEG_PATH}. Reinstall @ffmpeg-installer/ffmpeg.`);
  }

  const TARGET_DURATION = 15;
  const allTempFiles: string[] = [];

  const track = (p: string) => { allTempFiles.push(p); return p; };

  try {
    const imageBase64 = await fetchImageAsBase64(imageUrl);

    const basePrompt = `
Create a UGC style social media ad video.
Product: ${productName}
Creative direction: ${userPrompt || "Dynamic, engaging product showcase"}
Keep the scene, motion and audio continuous and natural.
`.trim();

    // ── Step 1: Generate Clip 1 from product image ───────────────────────────
    console.log("=== Generating Clip 1 (from product image) ===");
    const clip1Raw = track(await generateClip(imageBase64, basePrompt, "Clip 1"));
    const clip1 = track(normalizeClip(clip1Raw, "Clip 1"));

    // ── Step 2: Extract last frame of Clip 1 ────────────────────────────────
    // This becomes the "starting image" for Clip 2 so video is seamless
    console.log("=== Extracting last frame of Clip 1 ===");
    const lastFrameBase64 = extractLastFrameAsBase64(clip1);
    console.log("✓ Last frame extracted");

    // ── Step 3: Generate Clip 2 starting from last frame of Clip 1 ──────────
    // Veo sees the last frame as its starting point → scene continues naturally
    console.log("=== Generating Clip 2 (continuing from Clip 1 last frame) ===");
    const clip2Raw = track(await generateClip(lastFrameBase64, basePrompt, "Clip 2"));
    const clip2 = track(normalizeClip(clip2Raw, "Clip 2"));

    // ── Step 4: Concat Clip1 + Clip2 and trim to exactly 15s ────────────────
    // Total = 8s + 8s = 16s → trimmed to 15s
    // Audio is continuous because Clip 2 starts where Clip 1 left off visually
    const listFile = track(path.join(os.tmpdir(), `veo-list-${Date.now()}.txt`));
    const outputPath = track(path.join(os.tmpdir(), `veo-final-${Date.now()}.mp4`));

    fs.writeFileSync(listFile, [`file '${clip1}'`, `file '${clip2}'`].join("\n"));

    console.log("=== Concatenating clips and trimming to 15s ===");
    execSync(
      `"${FFMPEG_PATH}" -f concat -safe 0 -i "${listFile}" -t ${TARGET_DURATION} -c:v libx264 -preset fast -crf 18 -c:a aac -vsync vfr -movflags +faststart "${outputPath}"`
    );

    const finalVideo = fs.readFileSync(outputPath);
    console.log("✓ Final seamless 15s video (audio + video continuous) ready!");

    return finalVideo;

  } finally {
    // ── Cleanup all temp files ───────────────────────────────────────────────
    for (const f of allTempFiles) {
      try { fs.unlinkSync(f); } catch {}
    }
  }
}