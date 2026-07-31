import "server-only";

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { IMAGE_PROCESSING_CONFIG } from "@/lib/images/config";
import type { ProcessedImageOutput } from "@/lib/images/types";

const TEMP_ROOT_NAME = "kimartarchive-image-processing";

export type TempAssetKind = "hr" | "web";

export type TempProcessingManifest = {
  resultId: string;
  createdAt: number;
  expiresAt: number;
  artworkId: string | null;
  masterFilename: string;
  hr: Omit<ProcessedImageOutput, "format"> & { format: "jpeg"; storedName: string };
  web: Omit<ProcessedImageOutput, "format"> & { format: "jpeg"; storedName: string };
  sourceOriginalFilename: string;
  warnings: string[];
};

function tempRootDir(): string {
  return path.join(os.tmpdir(), TEMP_ROOT_NAME);
}

function resultDir(resultId: string): string {
  return path.join(tempRootDir(), resultId);
}

function isOpaqueResultId(resultId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    resultId,
  );
}

async function ensureRoot(): Promise<void> {
  await fs.mkdir(tempRootDir(), { recursive: true });
}

async function readManifest(resultId: string): Promise<TempProcessingManifest | null> {
  try {
    const raw = await fs.readFile(path.join(resultDir(resultId), "manifest.json"), "utf8");
    return JSON.parse(raw) as TempProcessingManifest;
  } catch {
    return null;
  }
}

async function removeDirQuiet(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
}

/** Opportunistic cleanup of expired result directories. */
export async function cleanupExpiredTempResults(
  now = Date.now(),
): Promise<number> {
  await ensureRoot();
  let removed = 0;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(tempRootDir());
  } catch {
    return 0;
  }

  for (const entry of entries) {
    if (!isOpaqueResultId(entry)) {
      await removeDirQuiet(path.join(tempRootDir(), entry));
      removed += 1;
      continue;
    }
    const manifest = await readManifest(entry);
    if (!manifest || manifest.expiresAt <= now) {
      await removeDirQuiet(resultDir(entry));
      removed += 1;
    }
  }

  return removed;
}

export type StoreTempOutputsInput = {
  artworkId?: string | null;
  masterFilename: string;
  sourceOriginalFilename: string;
  warnings: string[];
  hr: ProcessedImageOutput & { buffer: Buffer };
  web: ProcessedImageOutput & { buffer: Buffer };
};

export type StoreTempOutputsResult = {
  resultId: string;
  expiresAt: number;
  hrUrl: string;
  webUrl: string;
  hrDownloadUrl: string;
  webDownloadUrl: string;
};

/**
 * Write HR/web buffers to an OS temp directory outside the repo.
 * Returns opaque result IDs — never filesystem paths to the client.
 */
export async function storeTempProcessingOutputs(
  input: StoreTempOutputsInput,
): Promise<StoreTempOutputsResult> {
  await cleanupExpiredTempResults();
  await ensureRoot();

  const resultId = randomUUID();
  const dir = resultDir(resultId);
  const hrStored = "hr.jpg";
  const webStored = "web.jpg";

  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(dir, hrStored), input.hr.buffer, { mode: 0o600 });
    await fs.writeFile(path.join(dir, webStored), input.web.buffer, { mode: 0o600 });

    const createdAt = Date.now();
    const expiresAt = createdAt + IMAGE_PROCESSING_CONFIG.tempTtlMs;

    const manifest: TempProcessingManifest = {
      resultId,
      createdAt,
      expiresAt,
      artworkId: input.artworkId ?? null,
      masterFilename: input.masterFilename,
      sourceOriginalFilename: input.sourceOriginalFilename,
      warnings: input.warnings,
      hr: {
        filename: input.hr.filename,
        width: input.hr.width,
        height: input.hr.height,
        byteLength: input.hr.byteLength,
        format: "jpeg",
        quality: input.hr.quality,
        wasResized: input.hr.wasResized,
        storedName: hrStored,
      },
      web: {
        filename: input.web.filename,
        width: input.web.width,
        height: input.web.height,
        byteLength: input.web.byteLength,
        format: "jpeg",
        quality: input.web.quality,
        wasResized: input.web.wasResized,
        storedName: webStored,
      },
    };

    await fs.writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify(manifest),
      { mode: 0o600 },
    );

    return {
      resultId,
      expiresAt,
      hrUrl: `/api/dev/processed-image/${resultId}/hr`,
      webUrl: `/api/dev/processed-image/${resultId}/web`,
      hrDownloadUrl: `/api/dev/processed-image/${resultId}/hr?download=1`,
      webDownloadUrl: `/api/dev/processed-image/${resultId}/web?download=1`,
    };
  } catch (error) {
    await removeDirQuiet(dir);
    throw error;
  }
}

export async function getTempAsset(
  resultId: string,
  asset: TempAssetKind,
): Promise<{
  buffer: Buffer;
  contentType: "image/jpeg";
  filename: string;
  expiresAt: number;
} | null> {
  if (!isOpaqueResultId(resultId)) return null;

  await cleanupExpiredTempResults();

  const manifest = await readManifest(resultId);
  if (!manifest) return null;
  if (manifest.expiresAt <= Date.now()) {
    await removeDirQuiet(resultDir(resultId));
    return null;
  }

  const entry = asset === "hr" ? manifest.hr : manifest.web;
  const filePath = path.join(resultDir(resultId), entry.storedName);

  // Prevent traversal even if storedName were ever corrupted.
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(resultDir(resultId)) + path.sep)) {
    return null;
  }

  try {
    const buffer = await fs.readFile(resolved);
    return {
      buffer,
      contentType: "image/jpeg",
      filename: entry.filename,
      expiresAt: manifest.expiresAt,
    };
  } catch {
    return null;
  }
}

/** Remove a result directory after a failed partial write. */
export async function discardTempResult(resultId: string): Promise<void> {
  if (!isOpaqueResultId(resultId)) return;
  await removeDirQuiet(resultDir(resultId));
}
