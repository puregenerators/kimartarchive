import { MAX_FILE_BYTES } from "@/lib/artwork/types";
import {
  nextInventoryIdFromExisting,
  parseInventoryIdsFromClaimRows,
} from "@/lib/submission/claim-logic";
import {
  buildPendingLargeFileIntake,
  canCheckOrProcessClaimStatus,
  decideDismissIncompleteIntake,
  decideIncompleteIntakeListing,
  derivedReservedMaster,
  dismissPreservesArchiveArtifacts,
  dropboxFolderDisplayPath,
  dropboxFolderHomeUrl,
  emptyArchiveFilePresence,
  estimateProcessingMemory,
  gateLargeFileClaimAccess,
  inspectDropboxMasterMetadata,
  isGenuinelyCompletedArchive,
  isPreviewOrDecodeLeakMessage,
  isSafeClaimId,
  isTerminalClaimStatus,
  LARGE_FILE_FILE_NOT_FOUND_MESSAGE,
  LARGE_FILE_INCORRECT_FILENAME_MESSAGE,
  LARGE_FILE_WAITING_INSTRUCTION,
  largeFileNeedsUploadHeading,
  largeFileStatusLabel,
  parsePendingLargeFileIntake,
  pendingIntakeDropboxPath,
  preferSafeFolderUrl,
  rejectClientProvidedDropboxPath,
  REMOVE_INCOMPLETE_INTAKE_ACTION_LABEL,
  REMOVE_INCOMPLETE_INTAKE_CONFIRM_LABEL,
  REMOVE_INCOMPLETE_INTAKE_CONFIRM_TITLE,
  REMOVE_INCOMPLETE_INTAKE_KEEP_LABEL,
  removeIncompleteIntakeConfirmationBody,
  requiredCompletedArchivePaths,
  requiresLargeFileDropboxIntake,
  statusFromLargeFileProcessError,
  visibleLargeFileIntakeMessage,
  VERCEL_PROCESSING_SAFETY_BYTES,
  VERCEL_SAFE_DOWNLOAD_BYTES,
  type ArchiveCompletenessEvidence,
  type RequiredArchiveFilesPresence,
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

function allRequiredFilesPresent(): RequiredArchiveFilesPresence {
  return {
    master: true,
    hr: true,
    web: true,
    thumb: true,
    metadata: true,
  };
}

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
      assertEqual(canCheckOrProcessClaimStatus("Abandoned"), false, "abandoned");
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
    name: "missing reserved master is file-not-found and does not complete the claim",
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
        assertEqual(inspected.status, "file_not_found", "not found");
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
      if (!inspected.ok) {
        assertEqual(inspected.status, "incorrect_filename", "filename");
        assertEqual(
          inspected.message,
          LARGE_FILE_INCORRECT_FILENAME_MESSAGE,
          "copy",
        );
      }
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
      assertEqual(largeFileStatusLabel("file_not_found"), "File not found", "missing");
      assertEqual(
        largeFileStatusLabel("incorrect_filename"),
        "Incorrect filename",
        "filename",
      );
      assertEqual(
        largeFileStatusLabel("unsupported_file"),
        "Unsupported file",
        "unsupported",
      );
      assertEqual(largeFileStatusLabel("master_found"), "Master file found", "found");
      assertEqual(largeFileStatusLabel("processing"), "Processing", "processing");
      assertEqual(
        largeFileStatusLabel("completed"),
        "Artwork added to the archive",
        "completed",
      );
      assertEqual(largeFileStatusLabel("failed"), "Processing failed", "failed");
      assertEqual(
        statusFromLargeFileProcessError({
          status: "unsupported_file",
          errorCode: "INVALID_BATCH",
        }),
        "unsupported_file",
        "process maps decode to unsupported",
      );
      assertEqual(
        statusFromLargeFileProcessError({ errorCode: "MISSING_FILE" }),
        "file_not_found",
        "process maps missing file",
      );
      assertEqual(
        largeFileStatusLabel("local_processing_required"),
        "Local processing required",
        "local",
      );
      assertEqual(
        largeFileNeedsUploadHeading(1),
        "1 artwork needs a large-file upload",
        "singular heading",
      );
      assertEqual(
        dropboxFolderDisplayPath("2026_KO_1401_BlueGarden"),
        "Apps/Kim Art Archive/2026_KO_1401_BlueGarden",
        "folder path",
      );
      assertEqual(
        visibleLargeFileIntakeMessage(
          "waiting_for_dropbox",
          "The image could not be decoded. It may be corrupted or an unsupported variant.",
        ),
        null,
        "waiting hides decode leak",
      );
      assertEqual(
        visibleLargeFileIntakeMessage("file_not_found", "other"),
        LARGE_FILE_FILE_NOT_FOUND_MESSAGE,
        "not-found copy",
      );
      assertTrue(
        isPreviewOrDecodeLeakMessage(
          "The image could not be decoded. It may be corrupted or an unsupported variant.",
        ),
        "decode leak detected",
      );
      assertEqual(
        visibleLargeFileIntakeMessage(
          "unsupported_file",
          "The image could not be decoded. It may be corrupted or an unsupported variant.",
        ),
        "The image could not be decoded. It may be corrupted or an unsupported variant.",
        "decode shown after inspection",
      );
      assertEqual(
        LARGE_FILE_WAITING_INSTRUCTION.includes("too large to upload directly"),
        true,
        "waiting instruction",
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
  {
    name: "a truly completed archive is reconciled, not listed, and not recreated",
    run: () => {
      const pending = buildPendingLargeFileIntake({
        ...pendingInput,
        inventoryId: 1405,
        originalFilename: "VauxsSwiftWatch.tiff",
        artwork: {
          ...pendingInput.artwork,
          title: "Vaux’s Swift Watch",
          year: "2017",
          originalFilename: "VauxsSwiftWatch.tiff",
        },
      })!;
      const paths = requiredCompletedArchivePaths(pending);
      assertEqual(
        paths.folderPath,
        "/2017_KO_1405_VauxsSwiftWatch",
        "folder",
      );
      assertEqual(
        paths.masterPath,
        "/2017_KO_1405_VauxsSwiftWatch/2017_KO_1405_VauxsSwiftWatch_master_01.tif",
        "master",
      );
      assertEqual(
        paths.hrPath,
        "/2017_KO_1405_VauxsSwiftWatch/2017_KO_1405_VauxsSwiftWatch_hr_01.jpg",
        "hr",
      );
      assertEqual(
        paths.webPath,
        "/2017_KO_1405_VauxsSwiftWatch/2017_KO_1405_VauxsSwiftWatch_web_01.jpg",
        "web",
      );
      assertEqual(
        paths.thumbPath,
        "/2017_KO_1405_VauxsSwiftWatch/2017_KO_1405_VauxsSwiftWatch_thumb_01.jpg",
        "thumb",
      );
      assertEqual(
        paths.metadataPath,
        "/2017_KO_1405_VauxsSwiftWatch/1405_metadata.json",
        "metadata",
      );
      const completeness: ArchiveCompletenessEvidence = {
        hasInventorySheetRow: true,
        folderExists: true,
        files: allRequiredFilesPresent(),
      };
      assertEqual(isGenuinelyCompletedArchive(completeness), true, "complete");
      const decision = decideIncompleteIntakeListing({
        claimStatus: "Processing",
        hasPendingIntake: true,
        completeness,
      });
      assertEqual(decision.kind, "reconcile_completed", "reconcile");
      assertEqual(
        decision.sideEffects.some(
          (effect) =>
            effect.kind === "update_claim_status" &&
            effect.status === "Completed" &&
            effect.setCompletedAt,
        ),
        true,
        "mark Completed",
      );
      assertEqual(
        decision.sideEffects.some((effect) => effect.kind === "delete_pending_intake"),
        true,
        "drop pending json only",
      );
      assertEqual(
        decision.sideEffects.some(
          (effect) =>
            effect.kind === "update_claim_status" && effect.status === "Abandoned",
        ),
        false,
        "not Abandoned",
      );
    },
  },
  {
    name: "missing sheet row, folder, or any required file is not Completed",
    run: () => {
      const files = allRequiredFilesPresent();
      const cases: [string, ArchiveCompletenessEvidence][] = [
        [
          "no sheet",
          { hasInventorySheetRow: false, folderExists: true, files },
        ],
        [
          "no folder",
          {
            hasInventorySheetRow: true,
            folderExists: false,
            files: emptyArchiveFilePresence(),
          },
        ],
        [
          "no master",
          {
            hasInventorySheetRow: true,
            folderExists: true,
            files: { ...files, master: false },
          },
        ],
        [
          "no hr",
          {
            hasInventorySheetRow: true,
            folderExists: true,
            files: { ...files, hr: false },
          },
        ],
        [
          "no web",
          {
            hasInventorySheetRow: true,
            folderExists: true,
            files: { ...files, web: false },
          },
        ],
        [
          "no thumb",
          {
            hasInventorySheetRow: true,
            folderExists: true,
            files: { ...files, thumb: false },
          },
        ],
        [
          "no metadata",
          {
            hasInventorySheetRow: true,
            folderExists: true,
            files: { ...files, metadata: false },
          },
        ],
      ];
      for (const [label, completeness] of cases) {
        assertEqual(
          isGenuinelyCompletedArchive(completeness),
          false,
          `${label} is incomplete`,
        );
        const decision = decideIncompleteIntakeListing({
          claimStatus: "Claimed",
          hasPendingIntake: true,
          completeness,
        });
        assertEqual(decision.kind !== "reconcile_completed", true, `${label} not reconciled`);
        assertEqual(
          decision.sideEffects.some(
            (effect) =>
              effect.kind === "update_claim_status" &&
              effect.status === "Completed",
          ),
          false,
          `${label} not marked Completed`,
        );
      }
    },
  },
  {
    name: "stale incomplete intakes can be dismissed as Abandoned without touching archive files",
    run: () => {
      const pending = buildPendingLargeFileIntake({
        ...pendingInput,
        inventoryId: 1405,
      })!;
      const dismissed = decideDismissIncompleteIntake({
        authenticated: true,
        claim: {
          claimId,
          inventoryId: 1405,
          claimStatus: "Processing",
        },
        pending,
        requestedClaimId: claimId,
        requestedInventoryId: 1405,
      });
      assertEqual(dismissed.ok, true, "ok");
      if (!dismissed.ok) return;
      assertEqual(dismissed.claimStatus, "Abandoned", "Abandoned");
      assertEqual(dismissed.alreadyTerminal, false, "first dismiss");
      assertEqual(
        dismissed.sideEffects.length === 1 &&
          dismissed.sideEffects[0]?.kind === "update_claim_status" &&
          dismissed.sideEffects[0].status === "Abandoned" &&
          dismissed.sideEffects[0].setCompletedAt === false,
        true,
        "only abandon claim",
      );
      assertEqual(
        dismissPreservesArchiveArtifacts(dismissed.sideEffects),
        true,
        "no dropbox or sheet-row deletes",
      );
      assertEqual(
        dismissed.sideEffects.some((effect) => effect.kind === "delete_pending_intake"),
        false,
        "pending json left in Dropbox",
      );
      const listedAfter = decideIncompleteIntakeListing({
        claimStatus: "Abandoned",
        hasPendingIntake: true,
        completeness: {
          hasInventorySheetRow: false,
          folderExists: false,
          files: emptyArchiveFilePresence(),
        },
      });
      assertEqual(listedAfter.kind, "hide", "removed from resume list");
      assertEqual(isTerminalClaimStatus("Abandoned"), true, "terminal");
      assertEqual(
        nextInventoryIdFromExisting(
          parseInventoryIdsFromClaimRows([
            [claimId, "1405", "Abandoned", "t", ""],
          ]),
        ),
        1406,
        "inventory ID stays retired",
      );
    },
  },
  {
    name: "dismissing an abandoned intake is idempotent and never reallocates the ID",
    run: () => {
      const pending = buildPendingLargeFileIntake({
        ...pendingInput,
        inventoryId: 1405,
      })!;
      const first = decideDismissIncompleteIntake({
        authenticated: true,
        claim: {
          claimId,
          inventoryId: 1405,
          claimStatus: "Claimed",
        },
        pending,
        requestedClaimId: claimId,
        requestedInventoryId: 1405,
      });
      const second = decideDismissIncompleteIntake({
        authenticated: true,
        claim: {
          claimId,
          inventoryId: 1405,
          claimStatus: "Abandoned",
        },
        pending,
        requestedClaimId: claimId,
        requestedInventoryId: 1405,
      });
      assertEqual(first.ok && second.ok, true, "both ok");
      if (!first.ok || !second.ok) return;
      assertEqual(second.alreadyTerminal, true, "already abandoned");
      assertEqual(second.sideEffects.length, 0, "no second mutation");
      assertEqual(second.claimStatus, "Abandoned", "stays Abandoned");
      assertEqual(first.claimStatus === "Completed", false, "not Completed");
      const gated = gateLargeFileClaimAccess({
        authenticated: true,
        claim: {
          claimId,
          inventoryId: 1405,
          claimStatus: "Abandoned",
        },
        pending,
        requestedClaimId: claimId,
        requestedInventoryId: 1405,
      });
      assertEqual(gated.ok, false, "not resumable");
    },
  },
  {
    name: "dismiss confirmation copy names the retired inventory ID",
    run: () => {
      assertEqual(
        REMOVE_INCOMPLETE_INTAKE_CONFIRM_TITLE,
        "Remove this incomplete intake?",
        "title",
      );
      assertEqual(
        removeIncompleteIntakeConfirmationBody(1405),
        "It will no longer appear here. Inventory 1405 will remain retired, and no Dropbox files or completed artwork records will be deleted.",
        "body",
      );
      assertEqual(REMOVE_INCOMPLETE_INTAKE_KEEP_LABEL, "Keep intake", "keep");
      assertEqual(
        REMOVE_INCOMPLETE_INTAKE_CONFIRM_LABEL,
        "Remove from list",
        "confirm",
      );
      assertEqual(
        REMOVE_INCOMPLETE_INTAKE_ACTION_LABEL,
        "Already completed this upload or want to start it over later? Dismiss upload.",
        "action",
      );
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
