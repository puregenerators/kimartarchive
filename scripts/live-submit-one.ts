/**
 * One-shot live submission against the running Next server.
 * Creates a tiny JPEG and POSTs a 1-artwork batch to /api/artwork-batches/submit.
 *
 * Usage: npx tsx scripts/live-submit-one.ts [baseUrl]
 */
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";

async function main() {
  const baseUrl = process.argv[2] ?? "http://localhost:3000";
  const clientArtworkId = randomUUID();
  const submissionAttemptId = randomUUID();
  const imagePath = join(tmpdir(), `kimart-live-${clientArtworkId}.jpg`);

  await sharp({
    create: {
      width: 120,
      height: 90,
      channels: 3,
      background: { r: 180, g: 90, b: 40 },
    },
  })
    .jpeg({ quality: 90 })
    .toFile(imagePath);

  const bytes = await sharp(imagePath).toBuffer();
  const blob = new Blob([bytes], { type: "image/jpeg" });

  const artworks = [
    {
      clientArtworkId,
      order: 0,
      title: "Dropbox Live Probe",
      year: "2026",
      medium: "Oil",
      height: "12",
      width: "16",
      depth: "",
      dimensionUnit: "in",
      notes: "One-artwork Dropbox storage verification",
      overrides: { exhibition: "", gallery: "", photographer: "" },
      originalFilename: "dropbox-live-probe.jpg",
    },
  ];

  const shared = {
    exhibition: "",
    gallery: "",
    exhibitionYear: "2026",
    photographer: "Live Probe",
  };

  const body = new FormData();
  body.set("submissionAttemptId", submissionAttemptId);
  body.set("shared", JSON.stringify(shared));
  body.set("artworks", JSON.stringify(artworks));
  body.set(`file:${clientArtworkId}`, blob, "dropbox-live-probe.jpg");

  console.log(
    JSON.stringify({
      event: "live_submit_start",
      baseUrl,
      submissionAttemptId,
      clientArtworkId,
    }),
  );

  const response = await fetch(`${baseUrl}/api/artwork-batches/submit`, {
    method: "POST",
    body,
  });
  const result = (await response.json()) as Record<string, unknown>;

  await unlink(imagePath).catch(() => undefined);

  console.log(
    JSON.stringify(
      {
        event: "live_submit_result",
        httpStatus: response.status,
        result,
      },
      null,
      2,
    ),
  );

  if (!response.ok || result.ok !== true) {
    process.exit(1);
  }

  const artworksOut = result.artworks as Array<Record<string, unknown>>;
  const first = artworksOut?.[0];
  if (!first || first.ok !== true || first.stage !== "completed") {
    console.error("Artwork did not complete successfully.");
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        event: "live_submit_verified",
        inventoryId: first.inventoryId,
        claimId: first.claimId,
        folder: first.driveFolder,
        master: first.master,
        hr: first.hr,
        web: first.web,
        sheetRowWritten: first.sheetRowWritten,
        claimStatus: first.claimStatus,
      },
      null,
      2,
    ),
  );
}

void main();
