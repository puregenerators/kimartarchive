import { MAX_FILE_BYTES, MAX_FILE_SIZE_LABEL } from "@/lib/artwork/types";
import { multipartMasterSubmitAllowed } from "@/lib/submission/multipart-submit-guard";
import { DROPBOX_ALLOCATION_LOCK_PATH } from "@/lib/dropbox/types";
import {
  isAllocationLockStale,
  withDropboxAllocationLock,
} from "@/lib/submission/allocation-lock";
import {
  applyRepairedInventoryIds,
  findClaimRowByClaimId,
  inventoryIdsAreUnique,
  repairDuplicateClaimInventoryIds,
} from "@/lib/submission/append-claims";
import { canReuseClaimStatus } from "@/lib/submission/upload-link-logic";
import { artworkInventoryHasRow } from "@/lib/submission/inventory-lookup";
import {
  buildTemporaryUploadLinkPayload,
  expectedMasterDropboxPath,
  parseTemporaryUploadLinkResponse,
  validateDeclaredMasterFile,
  validateUploadLinkRequest,
} from "@/lib/submission/upload-link-logic";
import type { ClaimedArtwork } from "@/lib/submission/types";
import type { DropboxFilesOps } from "@/lib/dropbox/files-ops";
import { DropboxIntegrationError } from "@/lib/dropbox/errors";

type TestCase = { name: string; run: () => void | Promise<void> };

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

const validBody = {
  claimId: "claim-1",
  inventoryId: 1401,
  clientArtworkId: "art-1",
  filename: "2026_KO_1401_BlueGarden_master_01.tif",
  dropboxPath: "/2026_KO_1401_BlueGarden/2026_KO_1401_BlueGarden_master_01.tif",
  mimeType: "image/tiff",
  byteLength: 12_000_000,
  year: "2026",
  title: "Blue Garden",
  originalFilename: "BlueGarden.tiff",
};

const processingClaim = {
  claimId: "claim-1",
  inventoryId: 1401,
  claimStatus: "Processing" as const,
};

const tests: TestCase[] = [
  {
    name: "unauthenticated upload-link requests are rejected",
    run: () => {
      const result = validateUploadLinkRequest({
        authenticated: false,
        body: validBody,
        claim: processingClaim,
      });
      assertEqual(result.ok, false, "rejected");
      if (result.ok) return;
      assertEqual(result.code, "UNAUTHENTICATED", "code");
    },
  },
  {
    name: "invalid Dropbox path is rejected",
    run: () => {
      const result = validateUploadLinkRequest({
        authenticated: true,
        body: { ...validBody, dropboxPath: "/other/secret.tif" },
        claim: processingClaim,
      });
      assertEqual(result.ok, false, "rejected");
      if (result.ok) return;
      assertEqual(result.code, "INVALID_PATH", "code");
    },
  },
  {
    name: "path traversal filename is rejected",
    run: () => {
      const declared = validateDeclaredMasterFile({
        clientArtworkId: "art-1",
        filename: "../escape.tif",
        mimeType: "image/tiff",
        byteLength: 1000,
      });
      assertEqual(declared.ok, false, "rejected");
      if (declared.ok) return;
      assertEqual(declared.code, "INVALID_FILENAME", "code");
    },
  },
  {
    name: "invalid extension is rejected",
    run: () => {
      const declared = validateDeclaredMasterFile({
        clientArtworkId: "art-1",
        filename: "notes.pdf",
        mimeType: "application/pdf",
        byteLength: 1000,
      });
      assertEqual(declared.ok, false, "rejected");
      if (declared.ok) return;
      assertEqual(declared.code, "INVALID_EXTENSION", "code");
    },
  },
  {
    name: "invalid MIME type is rejected",
    run: () => {
      const declared = validateDeclaredMasterFile({
        clientArtworkId: "art-1",
        filename: "BlueGarden.tif",
        mimeType: "application/octet-stream",
        byteLength: 1000,
      });
      assertEqual(declared.ok, false, "rejected");
      if (declared.ok) return;
      assertEqual(declared.code, "INVALID_TYPE", "code");
    },
  },
  {
    name: "empty files are rejected",
    run: () => {
      const declared = validateDeclaredMasterFile({
        clientArtworkId: "art-1",
        filename: "BlueGarden.tif",
        mimeType: "image/tiff",
        byteLength: 0,
      });
      assertEqual(declared.ok, false, "rejected");
      if (declared.ok) return;
      assertEqual(declared.code, "FILE_EMPTY", "code");
    },
  },
  {
    name: "files over 150 MB are rejected",
    run: () => {
      const declared = validateDeclaredMasterFile({
        clientArtworkId: "art-1",
        filename: "BlueGarden.tif",
        mimeType: "image/tiff",
        byteLength: MAX_FILE_BYTES + 1,
      });
      assertEqual(declared.ok, false, "rejected");
      if (declared.ok) return;
      assertEqual(declared.code, "FILE_TOO_LARGE", "code");
      assertTrue(declared.message.includes(MAX_FILE_SIZE_LABEL), "150 MB copy");
    },
  },
  {
    name: "expected master path matches year, inventory ID, title, and planned name",
    run: () => {
      const path = expectedMasterDropboxPath({
        year: "2026",
        inventoryId: 1401,
        title: "Blue Garden",
        masterFilename: "2026_KO_1401_BlueGarden_master_01.tif",
      });
      assertEqual(
        path,
        "/2026_KO_1401_BlueGarden/2026_KO_1401_BlueGarden_master_01.tif",
        "path",
      );
    },
  },
  {
    name: "Dropbox temporary upload link is minted with mode=add and a short TTL",
    run: () => {
      const payload = buildTemporaryUploadLinkPayload(
        "/2026_KO_1401_BlueGarden/2026_KO_1401_BlueGarden_master_01.tif",
      );
      assertEqual(payload.commit_info.mode, "add", "mode");
      assertEqual(payload.commit_info.autorename, false, "autorename");
      assertEqual(payload.commit_info.strict_conflict, true, "strict conflict");
      assertEqual(payload.duration, 900, "ttl");
      const parsed = parseTemporaryUploadLinkResponse({
        link: "https://content.dropboxapi.com/apitul/1/example",
      });
      assertEqual(parsed.ok, true, "https link accepted");
    },
  },
  {
    name: "temporary upload link responses that look like access tokens are rejected",
    run: () => {
      const parsed = parseTemporaryUploadLinkResponse({
        link: "https://content.dropboxapi.com/?access_token=secret",
      });
      assertEqual(parsed.ok, false, "rejected");
    },
  },
  {
    name: "a Processing claim can be retried and keeps its inventory ID",
    run: () => {
      assertEqual(canReuseClaimStatus("Processing"), true, "processing");
      assertEqual(canReuseClaimStatus("Claimed"), true, "claimed");
      assertEqual(canReuseClaimStatus("Failed"), false, "failed");
      assertEqual(canReuseClaimStatus("Completed"), false, "completed");
      const row = findClaimRowByClaimId(
        [["claim-1", "1401", "Processing", "t", ""]],
        "claim-1",
      );
      assertEqual(row?.inventoryId, 1401, "same inventory ID");
    },
  },
  {
    name: "duplicate inventory allocation repairs the later claim row",
    run: () => {
      const dataRows = [
        ["claim-a", "1401", "Claimed", "t", ""],
        ["claim-b", "1401", "Claimed", "t", ""],
      ];
      const repaired = repairDuplicateClaimInventoryIds({
        dataRows,
        ourClaimIds: new Set(["claim-b"]),
      });
      assertEqual(repaired.updates.length, 1, "one repair");
      assertEqual(repaired.updates[0]?.from, 1401, "from");
      assertEqual(repaired.updates[0]?.to, 1402, "to");
      assertEqual(repaired.nextByClaimId.get("claim-b"), 1402, "our id");
      const claims: ClaimedArtwork[] = [
        {
          clientArtworkId: "b",
          order: 0,
          claimId: "claim-b",
          inventoryId: 1401,
          claimStatus: "Claimed",
        },
      ];
      const applied = applyRepairedInventoryIds(claims, repaired.nextByClaimId);
      assertEqual(applied[0]?.inventoryId, 1402, "updated claim");
      assertEqual(inventoryIdsAreUnique([1401, 1402]), true, "unique after");
    },
  },
  {
    name: "Dropbox mode=add allocation lock refuses a second holder",
    run: async () => {
      const files = new Map<string, Buffer>();
      const ops: DropboxFilesOps = {
        async createFolder() {
          return { pathDisplay: "/_system" };
        },
        async pathExists(path) {
          return path === "/_system" || files.has(path);
        },
        async uploadBuffer(path, contents, options) {
          if (options?.mode === "add" && files.has(path)) {
            throw new DropboxIntegrationError({
              code: "PATH_ERROR",
              message: "path/conflict/file",
            });
          }
          const buf =
            typeof contents === "string"
              ? Buffer.from(contents)
              : Buffer.from(contents);
          files.set(path, buf);
          return {
            pathDisplay: path,
            id: "id",
            name: "lock",
            size: buf.byteLength,
          };
        },
        async deleteFile(path) {
          files.delete(path);
        },
        async getMetadata() {
          throw new Error("unused");
        },
        async downloadFile() {
          throw new Error("unused");
        },
        async downloadFileToPath() {
          throw new Error("unused");
        },
        async createSharedLink() {
          throw new Error("unused");
        },
        async getTemporaryUploadLink() {
          throw new Error("unused");
        },
        async deleteFolder() {},
        async movePath() {
          return { pathDisplay: "" };
        },
      };

      let concurrent = 0;
      let maxConcurrent = 0;
      const run = () =>
        withDropboxAllocationLock({
          ops,
          attempts: 40,
          sleepMs: 5,
          run: async () => {
            concurrent += 1;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            await new Promise((resolve) => setTimeout(resolve, 20));
            concurrent -= 1;
            return true;
          },
        });

      await Promise.all([run(), run()]);
      assertEqual(maxConcurrent, 1, "serialized");
      assertEqual(files.has(DROPBOX_ALLOCATION_LOCK_PATH), false, "released");
    },
  },
  {
    name: "stale allocation locks may be stolen after 30s",
    run: () => {
      assertEqual(
        isAllocationLockStale({
          createdAtMs: 0,
          nowMs: 30_000,
        }),
        true,
        "stale at 30s",
      );
      assertEqual(
        isAllocationLockStale({
          createdAtMs: 0,
          nowMs: 29_999,
        }),
        false,
        "not stale before 30s",
      );
    },
  },
  {
    name: "failure after master upload keeps the claim retryable",
    run: () => {
      assertTrue(
        canReuseClaimStatus("Processing"),
        "Processing remains retryable when derivatives fail",
      );
      assertEqual(
        canReuseClaimStatus("Failed"),
        false,
        "Failed IDs stay retired",
      );
    },
  },
  {
    name: "existing Artwork Inventory rows block a duplicate Sheet append",
    run: () => {
      const rows = [
        ["1400", "", "Old"],
        ["1401", "", "Blue Garden"],
      ];
      assertEqual(artworkInventoryHasRow(rows, 1401), true, "exists");
      assertEqual(artworkInventoryHasRow(rows, 1402), false, "missing");
    },
  },
  {
    name: "legacy multipart submit is blocked on Vercel and allowed locally",
    run: () => {
      assertEqual(
        multipartMasterSubmitAllowed({ VERCEL: "1" }),
        false,
        "blocked on Vercel",
      );
      assertEqual(
        multipartMasterSubmitAllowed({}),
        true,
        "allowed off Vercel",
      );
    },
  },
  {
    name: "authenticated valid upload-link request is accepted",
    run: () => {
      const result = validateUploadLinkRequest({
        authenticated: true,
        body: validBody,
        claim: processingClaim,
      });
      assertEqual(result.ok, true, "ok");
      if (!result.ok) return;
      assertEqual(
        result.plannedMasterFilename,
        "2026_KO_1401_BlueGarden_master_01.tif",
        "planned name",
      );
    },
  },
];

let failed = 0;

async function main() {
  for (const test of tests) {
    try {
      await test.run();
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
}

void main();
