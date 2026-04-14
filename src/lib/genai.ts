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

// Use @ffmpeg-installer path — works on Windows/Mac/Linux without bundling issues
const FFMPEG_PATH = ffmpegInstaller.path;

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

Generate exactly 10 short ad creative prompts.

Rules:
Each suggestion must be one line.
No numbering.
Return only 10 lines.
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

export async function generateAdImage(
  productImageUrl: string,
  productName: string,
  productDescription: string,
  userPrompt: string
): Promise<Buffer> {
  if (!ai) throw new Error("Google GenAI not configured");

  const imageBase64 = await fetchImageAsBase64(productImageUrl);

  const prompt = `Create a high-quality UGC-style ad image.

Product: ${productName}
Description: ${productDescription}

Creative direction: ${userPrompt || "Modern eye catching ad"}

No text overlay unless requested.
`;

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

  throw new Error("No image generated");
}

async function fetchImageAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString("base64");
}

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
      console.warn(
        `[${label}] Attempt ${attempt}/${maxAttempts} hit retryable error. ` +
        `Retrying in ${delay / 1000}s…`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

// ─── generateVideoFromImage ───────────────────────────────────────────────────

export async function generateVideoFromImage(
  imageUrl: string,
  productName: string,
  userPrompt: string
): Promise<Buffer> {
  if (!ai) throw new Error("Google GenAI not configured");

  // Validate ffmpeg is accessible before starting expensive API calls
  try {
    execSync(`"${FFMPEG_PATH}" -version`, { stdio: "ignore" });
  } catch {
    throw new Error(
      `ffmpeg not accessible at path: ${FFMPEG_PATH}. ` +
      `Try reinstalling @ffmpeg-installer/ffmpeg.`
    );
  }

  const imageBase64 = await fetchImageAsBase64(imageUrl);

  const NUMBER_OF_CLIPS = 2;
  const clipPaths: string[] = [];

  for (let i = 0; i < NUMBER_OF_CLIPS; i++) {
    const clipLabel = `Clip ${i + 1}/${NUMBER_OF_CLIPS}`;

    const clipPrompt = `
Create a UGC style social media ad video.

Product: ${productName}

Creative direction:
${userPrompt || "Dynamic engaging product showcase"}

Scene ${i + 1} of 3.
`;

    // ── Step 1: Start generation ─────────────────────────────────────────────
    const operation = await withRetry(
      `${clipLabel} — start generation`,
      () =>
        ai!.models.generateVideos({
          model: "veo-3.1-generate-preview",
          prompt: clipPrompt,
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

    // ── Step 2: Poll until done ──────────────────────────────────────────────
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
      if (isRetryableError(currentOperation.error)) {
        throw new Error(
          `[${clipLabel}] High demand error — please retry. ` +
          `Details: ${JSON.stringify(currentOperation.error)}`
        );
      }
      throw new Error(
        `[${clipLabel}] Generation failed: ${JSON.stringify(currentOperation.error)}`
      );
    }

    // ── Step 3: Save clip ────────────────────────────────────────────────────
    const video = currentOperation.response?.generatedVideos?.[0]?.video;

    if (!video) {
      throw new Error(`[${clipLabel}] No video object returned.`);
    }

    const tmpPath = path.join(os.tmpdir(), `veo-clip-${Date.now()}-${i}.mp4`);

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

    clipPaths.push(tmpPath);
    console.log(`✓ ${clipLabel} saved: ${tmpPath}`);
  }

  // ── Step 4: Concat & trim to 20s ──────────────────────────────────────────
  const listFile   = path.join(os.tmpdir(), `veo-list-${Date.now()}.txt`);
  const outputPath = path.join(os.tmpdir(), `veo-final-${Date.now()}.mp4`);

  fs.writeFileSync(
    listFile,
    clipPaths.map((p) => `file '${p}'`).join("\n")
  );

  // Quote the ffmpeg path to handle spaces in Windows paths (e.g. OneDrive\Desktop)
  execSync(
    `"${FFMPEG_PATH}" -f concat -safe 0 -i "${listFile}" -t 15 -c copy "${outputPath}"`

  );

  const finalVideo = fs.readFileSync(outputPath);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  try {
    fs.unlinkSync(listFile);
    fs.unlinkSync(outputPath);
    clipPaths.forEach((p) => fs.unlinkSync(p));
  } catch (cleanupErr) {
    console.warn("Cleanup warning:", cleanupErr);
  }

  return finalVideo;
}