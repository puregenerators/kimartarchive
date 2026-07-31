import { createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Temporary submission workspace under the OS temp directory.
 * Never write temporary files inside the repository.
 */
export async function createSubmissionTempDir(
  submissionAttemptId: string,
): Promise<string> {
  const safe = submissionAttemptId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
  return mkdtemp(join(tmpdir(), `kimartarchive-submit-${safe || "batch"}-`));
}

export async function writeTempFile(
  dir: string,
  filename: string,
  data: Buffer | Uint8Array,
): Promise<string> {
  const path = join(dir, filename);
  await writeFile(path, data, { mode: 0o600 });
  return path;
}

export async function fileToBufferAndTemp(
  dir: string,
  filename: string,
  file: File,
): Promise<{ path: string; buffer: Buffer; byteLength: number }> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const path = await writeTempFile(dir, filename, buffer);
  return { path, buffer, byteLength: buffer.byteLength };
}

export function openTempReadStream(path: string) {
  return createReadStream(path);
}

export async function removeTempDir(
  dir: string | null | undefined,
): Promise<boolean> {
  if (!dir) return true;
  try {
    await rm(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
