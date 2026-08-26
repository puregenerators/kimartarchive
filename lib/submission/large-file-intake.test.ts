import { MAX_FILE_BYTES } from "@/lib/artwork/types";
import {
  buildPendingLargeFileIntake,
  canCheckOrProcessClaimStatus,
  derivedReservedMaster,
  dropboxFolderHomeUrl,
  estimateProcessingMemory,
  gateLargeFileClaimAccess,
  inspectDropboxMasterMetadata,
  isSafeClaimId,
  largeFileStatusLabel,
  parsePendingLargeFileIntake,
  pendingIntakeDropboxPath,
  preferSafeFolderUrl,
  rejectClientProvidedDropboxPath,
  requiresLargeFileDropboxIntake,
  VERCEL_PROCESSING_SAFETY_BYTES,
  VERCEL_SAFE_DOWNLOAD_BYTES,
} from "@/lib/submission/large-file-intake-logic";

type TestCase = { name: string; run: () => void };

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
    );
  }
}

function assertTrue(value: unknown, message: string) {
  if (!value) throw new Error(message);
}

const claimId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const pendingInput = {
  claimId,
  inventoryId: 1401,
  clientArtworkId: "art-1",
  submissionAttemptId: "attempt-1",
  originalFilename: "BlueGarden.tiff",
  declaredByteLength: MAX_FILE_BYTES + 1,
  createdAt: "2026-08-26T00:00:00.000Z",
  shared: {
    exhibition: "",
    gallery: "",
    exhibitionYear: "",
    photographer: "",
  },
  artwork: {
    clientArtworkId: "art-1",
    order: 0,
    title: "Blue Garden",
    year: "2026",
    medium: "Monotype",
    height: "",
    width: "",
    depth: "",
    dimensionUnit: "in",
    notes: "",
    overrides: { exhibition: "", gallery: "", photographer: "" },
    originalFilename: "BlueGarden.tiff",
  },
};

const tests: TestCase[] = [
  {
    name: "files over 150 MB require large-file Dropbox intake",
    run: () => {
      assertEqual(requiresLargeFileDropboxIntake(MAX_FILE_BYTES), false, "at cap");
      assertEqual(
        requiresLargeFileDropboxIntake(MAX_FILE_BYTES + 1),
        true,
        "over cap",
      );
    },
  },
  {
    name: "pending intake path is bound to a UUID claim ID",
    run: () => {
      assertEqual(
        pendingIntakeDropboxPath(claimId),
        `/_system/pending-intakes/${claimId}.json`,
        "path",
      );
      assertEqual(pendingIntakeDropboxPath("../escape"), null, "rejected");
      assertEqual(pendingIntakeDropboxPath("not-a-uuid"), null, "not uuid");
      assertTrue(isSafeClaimId(claimId), "uuid ok");
    },
  },
  {
    name: "reserved master path is derived from the claim, not a client path",
    run: () => {
      const derived = derivedReservedMaster({
        year: "2026",
        inventoryId: 1401,
        title: "Blue Garden",
        originalFilename: "BlueGarden.tiff",
      });
      assertEqual(
        derived?.masterPath,
        "/2026_KO_1401_BlueGarden/2026_KO_1401_BlueGarden_master_01.tif",
        "path",
      );
      assertTrue(rejectClientProvidedDropboxPath({ dropboxPath: "/other.tif" }), "client path");
      assertEqual(rejectClientProvidedDropboxPath({ claimId }), false, "no path");
    },
  },
  {
    name: "pending payload round-trips and rejects a swapped Dropbox path",
    run: () => {
      const pending = buildPendingLargeFileIntake(pendingInput);
      assertTrue(pending, "built");
      const parsed = parsePendingLargeFileIntake(pending);
      assertEqual(parsed?.inventoryId, 1401, "id");
      assertEqual(
        parsePendingLargeFileIntake({
          ...pending,
          masterPath: "/other/secret.tif",
        }),
        null,
        "tampered path",
      );
    },
  },
  {
    name: "checking or retrying does not mint a new inventory ID",
    run: () => {
      assertEqual(canCheckOrProcessClaimStatus("Processing"), true, "processing");
      assertEqual(canCheckOrProcessClaimStatus("Claimed"), true, "claimed");
      assertEqual(canCheckOrProcessClaimStatus("Failed"), false, "failed");
      assertEqual(canCheckOrProcessClaimStatus("Completed"), false, "completed");
      const pending = buildPendingLargeFileIntake(pendingInput)!;
      const gated = gateLargeFileClaimAccess({
        authenticated: true,
        claim: {
          claimId,
          inventoryId: 1401,
          claimStatus: "Processing",
        },
        pending,
        requestedClaimId: claimId,
        requestedInventoryId: 1401,
      });
      assertEqual(gated.ok, true, "ok");
      if (gated.ok) {
        assertEqual(gated.pending.inventoryId, 1401, "same id");
      }
    },
  },
  {
    name: "unauthenticated check and process gates fail closed",
    run: () => {
      const pending = buildPendingLargeFileIntake(pendingInput);
      const gated = gateLargeFileClaimAccess({
        authenticated: false,
        claim: {
          claimId,
          inventoryId: 1401,
          claimStatus: "Processing",
        },
        pending,
        requestedClaimId: claimId,
        requestedInventoryId: 1401,
      });
      assertEqual(gated.ok, false, "rejected");
      if (!gated.ok) assertEqual(gated.code, "UNAUTHENTICATED", "code");
    },
  },
  {
    name: "Dropbox folder home URL is a signed-in web URL without tokens",
    run: () => {
      const url = dropboxFolderHomeUrl("2026_KO_1401_BlueGarden");
      assertTrue(url?.startsWith("https://www.dropbox.com/"), "https");
      assertEqual(url?.includes("access_token"), false, "no token");
      assertEqual(dropboxFolderHomeUrl("../escape"), null, "no traversal");
      const preferred = preferSafeFolderUrl({
        sharedUrl: "https://www.dropbox.com/scl/fo/abc/folder?dl=0",
        folderName: "2026_KO_1401_BlueGarden",
      });
      assertTrue(preferred?.includes("dropbox.com"), "shared ok");
    },
  },
  {
    name: "missing reserved master stays waiting and does not complete the claim",
    run: () => {
      const inspected = inspectDropboxMasterMetadata({
        expectedPath: "/2026_KO_1401_BlueGarden/2026_KO_1401_BlueGarden_master_01.tif",
        expectedFilename: "2026_KO_1401_BlueGarden_master_01.tif",
        path: "/2026_KO_1401_BlueGarden/2026_KO_1401_BlueGarden_master_01.tif",
        name: "2026_KO_1401_BlueGarden_master_01.tif",
        isFolder: false,
        size: 0,
      });
      assertEqual(inspected.ok, false, "empty");
      if (!inspected.ok) {
        assertEqual(inspected.status, "waiting_for_dropbox", "waiting");
      }
    },
  },
  {
    name: "unexpected filename at the reserved path is not overwritten",
    run: () => {
      const inspected = inspectDropboxMasterMetadata({
        expectedPath: "/2026_KO_1401_BlueGarden/2026_KO_1401_BlueGarden_master_01.tif",
        expectedFilename: "2026_KO_1401_BlueGarden_master_01.tif",
        path: "/2026_KO_1401_BlueGarden/2026_KO_1401_BlueGarden_master_01.tif",
        name: "random.tif",
        isFolder: false,
        size: 2000,
      });
      assertEqual(inspected.ok, false, "rejected");
      if (!inspected.ok) assertEqual(inspected.status, "failed", "failed");
    },
  },
  {
    name: "client-provided path that does not match the reserved master is rejected",
    run: () => {
      const inspected = inspectDropboxMasterMetadata({
        expectedPath: "/2026_KO_1401_BlueGarden/2026_KO_1401_BlueGarden_master_01.tif",
        expectedFilename: "2026_KO_1401_BlueGarden_master_01.tif",
        path: "/other/secret.tif",
        name: "2026_KO_1401_BlueGarden_master_01.tif",
        isFolder: false,
        size: 2000,
      });
      assertEqual(inspected.ok, false, "rejected");
    },
  },
  {
    name: "status labels distinguish waiting, found, processing, completed, and failed",
    run: () => {
      assertEqual(
        largeFileStatusLabel("waiting_for_dropbox"),
        "Waiting for Dropbox upload",
        "waiting",
      );
      assertEqual(largeFileStatusLabel("master_found"), "Master found", "found");
      assertEqual(largeFileStatusLabel("processing"), "Processing", "processing");
      assertEqual(largeFileStatusLabel("completed"), "Completed", "completed");
      assertEqual(largeFileStatusLabel("failed"), "Failed", "failed");
      assertEqual(
        largeFileStatusLabel("local_processing_required"),
        "Local processing required",
        "local",
      );
    },
  },
  {
    name: "huge pixel/bit-depth estimates are labeled local processing required",
    run: () => {
      const estimate = estimateProcessingMemory({
        width: 30000,
        height: 20000,
        channels: 3,
        bytesPerSample: 2,
        sourceByteLength: 180 * 1024 * 1024,
      });
      assertEqual(estimate.safeToProcessOnVercel, false, "unsafe");
      assertTrue(
        estimate.estimatedPeakBytes > VERCEL_PROCESSING_SAFETY_BYTES,
        "over safety",
      );
      const download = estimateProcessingMemory({
        width: 100,
        height: 100,
        channels: 3,
        bytesPerSample: 1,
        sourceByteLength: VERCEL_SAFE_DOWNLOAD_BYTES + 1,
      });
      assertEqual(download.safeToProcessOnVercel, false, "too big to download");
    },
  },
];

let failed = 0;

for (const test of tests) {
  try {
    test.run();
    console.log(`ok  — ${test.name}`);
  } catch (error) {
    failed += 1;
    console.error(`fail — ${test.name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

if (failed > 0) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}

console.log(`\n${tests.length} passed`);
