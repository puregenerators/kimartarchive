/**
 * Controlled three-artwork live batch for post-migration verification.
 * Requires a running Next server with development fault injection enabled:
 *   ARTWORK_TEST_FAIL_OPERATION=upload_high_resolution
 *   ARTWORK_TEST_FAIL_INDEX=1
 *
 * Usage: npx tsx scripts/live-batch-three.ts [baseUrl]
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";

type ArtworkSpec = {
  title: string;
  order: number;
  color: { r: number; g: number; b: number };
  filename: string;
};

const SPECS: ArtworkSpec[] = [
  {
    title: "Batch Test Success A",
    order: 0,
    color: { r: 40, g: 120, b: 200 },
    filename: "kimart-batch-test-a.jpg",
  },
  {
    title: "Batch Test Intentional Failure",
    order: 1,
    color: { r: 200, g: 40, b: 40 },
    filename: "kimart-batch-test-fail.jpg",
  },
  {
    title: "Batch Test Success B",
    order: 2,
    color: { r: 40, g: 160, b: 80 },
    filename: "kimart-batch-test-b.jpg",
  },
];

async function main() {
  const baseUrl = process.argv[2] ?? "http://localhost:3000";
  const submissionAttemptId = randomUUID();
  const fixtureDir = join(process.cwd(), "scripts", ".tmp", "batch-three");
  await mkdir(fixtureDir, { recursive: true });

  const shared = {
    exhibition: "Batch Verification",
    gallery: "Test Studio",
    exhibitionYear: "2026",
    photographer: "Batch Tester",
  };

  const artworks = [];
  const body = new FormData();
  body.set("submissionAttemptId", submissionAttemptId);
  body.set("shared", JSON.stringify(shared));

  for (const spec of SPECS) {
    const clientArtworkId = randomUUID();
    const imagePath = join(fixtureDir, spec.filename);
    await sharp({
      create: {
        width: 160 + spec.order * 20,
        height: 120 + spec.order * 10,
        channels: 3,
        background: spec.color,
      },
    })
      .jpeg({ quality: 90 })
      .toFile(imagePath);

    const bytes = await sharp(imagePath).toBuffer();
    const blob = new Blob([bytes], { type: "image/jpeg" });

    artworks.push({
      clientArtworkId,
      order: spec.order,
      title: spec.title,
      year: "2026",
      medium: "Oil",
      height: "10",
      width: "12",
      depth: "",
      dimensionUnit: "in",
      notes: `Controlled batch fixture: ${spec.title}`,
      overrides: { exhibition: "", gallery: "", photographer: "" },
      originalFilename: spec.filename,
    });

    body.set(`file:${clientArtworkId}`, blob, spec.filename);
  }

  body.set("artworks", JSON.stringify(artworks));

  console.log(
    JSON.stringify({
      event: "live_batch_start",
      baseUrl,
      submissionAttemptId,
      titles: SPECS.map((s) => s.title),
    }),
  );

  const response = await fetch(`${baseUrl}/api/artwork-batches/submit`, {
    method: "POST",
    body,
  });
  const result = (await response.json()) as Record<string, unknown>;

  // Keep fixtures until verification script finishes; caller may delete.
  await writeFile(
    join(fixtureDir, "last-result.json"),
    JSON.stringify(
      { httpStatus: response.status, submissionAttemptId, result },
      null,
      2,
    ),
  );

  console.log(
    JSON.stringify(
      {
        event: "live_batch_result",
        httpStatus: response.status,
        ok: result.ok,
        kind: result.kind,
        summary: result.summary,
        artworks: Array.isArray(result.artworks)
          ? (result.artworks as Array<Record<string, unknown>>).map((a) => ({
              title: a.title,
              ok: a.ok,
              inventoryId: a.inventoryId,
              claimId: a.claimId,
              claimStatus: a.claimStatus,
              stage: a.stage,
              lastCompletedStage: a.lastCompletedStage,
              failedOperation: a.failedOperation,
              sheetRowWritten: a.sheetRowWritten,
              folder: a.driveFolder,
              master: a.master,
              hr: a.hr,
              web: a.web,
              cleanup: a.cleanup,
              message: a.message,
              errorCode: a.errorCode,
            }))
          : result.artworks,
        message: result.message,
      },
      null,
      2,
    ),
  );

  if (!response.ok || result.ok !== true) {
    process.exit(1);
  }

  const completed = Number(result.completed ?? 0);
  const failed = Number(result.failed ?? 0);
  if (completed !== 2 || failed !== 1) {
    console.error("Unexpected batch counts", { completed, failed });
    process.exit(1);
  }
}

void main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
