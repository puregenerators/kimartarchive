/**
 * Storage abstraction unit tests (mock Dropbox ops — no network).
 */

import { DropboxIntegrationError } from "@/lib/dropbox/errors";
import type { DropboxFilesOps } from "@/lib/dropbox/files-ops";
import {
  DROPBOX_ARCHIVE_ROOT_WEB_URL,
  DROPBOX_FAILED_INTAKE_PATH,
  type DropboxFileMetadata,
} from "@/lib/dropbox/types";
import { createDropboxStorageProvider } from "@/lib/storage/dropbox-provider-logic";
import {
  getStorageProviderKind,
  UnsupportedStorageProviderError,
} from "@/lib/storage/provider-kind";
import type { StorageProvider } from "@/lib/storage/types";

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

function createMockOps(
  overrides: Partial<DropboxFilesOps> = {},
): DropboxFilesOps {
  const paths = new Set<string>();
  const files = new Map<string, Buffer>();

  const base: DropboxFilesOps = {
    async pathExists(path) {
      return paths.has(path) || files.has(path);
    },
    async createFolder(path) {
      paths.add(path);
      return { pathDisplay: path };
    },
    async deleteFolder(path) {
      paths.delete(path);
    },
    async uploadBuffer(path, contents, options) {
      const buf =
        typeof contents === "string"
          ? Buffer.from(contents, "utf8")
          : Buffer.from(contents);
      if (options?.mode === "add" && (paths.has(path) || files.has(path))) {
        throw new DropboxIntegrationError({
          code: "PATH_ERROR",
          message: "path/conflict/file",
        });
      }
      files.set(path, buf);
      paths.add(path);
      return {
        pathDisplay: path,
        id: `id:${path}`,
        name: path.split("/").pop() ?? "",
        size: buf.byteLength,
      };
    },
    async getMetadata(path) {
      if (!paths.has(path) && !files.has(path)) {
        throw new DropboxIntegrationError({
          code: "PATH_ERROR",
          message: "path/not_found/",
        });
      }
      const meta: DropboxFileMetadata = {
        id: "id:meta",
        name: path.split("/").pop() ?? "",
        pathDisplay: path,
        pathLower: path.toLowerCase(),
        size: files.get(path)?.byteLength ?? 0,
        isFolder: paths.has(path) && !files.has(path),
      };
      return meta;
    },
    async createSharedLink(path) {
      if (!paths.has(path) && !files.has(path)) {
        throw new DropboxIntegrationError({
          code: "PATH_ERROR",
          message: "path/not_found/",
        });
      }
      return {
        url: `https://www.dropbox.com/s/mock${path}?dl=0`,
        pathDisplay: path,
      };
    },
    async downloadFile(path) {
      const buf = files.get(path);
      if (!buf) {
        throw new DropboxIntegrationError({
          code: "PATH_ERROR",
          message: "path/not_found/",
        });
      }
      return Buffer.from(buf);
    },
    async downloadFileToPath(path, destPath) {
      const { writeFile } = await import("node:fs/promises");
      const buf = files.get(path);
      if (!buf) {
        throw new DropboxIntegrationError({
          code: "PATH_ERROR",
          message: "path/not_found/",
        });
      }
      await writeFile(destPath, buf);
      return { size: buf.byteLength };
    },
    async getTemporaryUploadLink(params) {
      if (!params.path.startsWith("/")) {
        throw new DropboxIntegrationError({
          code: "PATH_ERROR",
          message: "invalid path",
        });
      }
      return { link: `https://content.dropboxapi.com/apitul/1/${encodeURIComponent(params.path)}` };
    },
    async deleteFile(path) {
      files.delete(path);
      paths.delete(path);
    },
    async movePath(fromPath, toPath) {
      if (!paths.has(fromPath) && !files.has(fromPath)) {
        throw new DropboxIntegrationError({
          code: "PATH_ERROR",
          message: "path/not_found/",
        });
      }
      paths.delete(fromPath);
      paths.add(toPath);
      for (const key of [...files.keys()]) {
        if (key === fromPath || key.startsWith(`${fromPath}/`)) {
          const next =
            key === fromPath
              ? toPath
              : `${toPath}${key.slice(fromPath.length)}`;
          files.set(next, files.get(key)!);
          files.delete(key);
          paths.delete(key);
          paths.add(next);
        }
      }
      return { pathDisplay: toPath };
    },
  };

  return { ...base, ...overrides };
}

const tests: TestCase[] = [
  {
    name: "storage provider kind defaults to dropbox when unset",
    run: () => {
      assertEqual(getStorageProviderKind({}), "dropbox", "default");
      assertEqual(
        getStorageProviderKind({ ARTWORK_STORAGE_PROVIDER: "" }),
        "dropbox",
        "empty → dropbox",
      );
      assertEqual(
        getStorageProviderKind({ ARTWORK_STORAGE_PROVIDER: "dropbox" }),
        "dropbox",
        "explicit dropbox",
      );
      assertEqual(
        getStorageProviderKind({ ARTWORK_STORAGE_PROVIDER: "DROPBOX" }),
        "dropbox",
        "case insensitive",
      );
      assertEqual(
        getStorageProviderKind({ ARTWORK_STORAGE_PROVIDER: "drive" }),
        "drive",
        "legacy drive",
      );
    },
  },
  {
    name: "unsupported storage provider throws clear configuration error",
    run: () => {
      let caught: unknown;
      try {
        getStorageProviderKind({ ARTWORK_STORAGE_PROVIDER: "s3" });
      } catch (error) {
        caught = error;
      }
      assertTrue(
        caught instanceof UnsupportedStorageProviderError,
        "throws UnsupportedStorageProviderError",
      );
      if (caught instanceof UnsupportedStorageProviderError) {
        assertEqual(caught.code, "UNSUPPORTED_STORAGE_PROVIDER", "code");
        assertTrue(caught.message.includes("s3"), "mentions value");
      }
    },
  },
  {
    name: "verifyReady creates Failed Intake when missing",
    run: async () => {
      const ops = createMockOps();
      const storage = createDropboxStorageProvider(async () => ops);
      const ready = await storage.verifyReady();
      assertEqual(ready.ok, true, "ready");
      assertEqual(await ops.pathExists(DROPBOX_FAILED_INTAKE_PATH), true, "failed intake");
      if (ready.ok) {
        assertEqual(ready.archiveRootUrl, DROPBOX_ARCHIVE_ROOT_WEB_URL, "root url");
      }
    },
  },
  {
    name: "create folder, upload images plus thumbnail and Inventory-ID metadata file, record Dropbox shared URLs",
    run: async () => {
      const ops = createMockOps();
      const storage = createDropboxStorageProvider(async () => ops);
      await storage.verifyReady();

      const folder = await storage.createArtworkFolder("2026_KO_1000_BlueGarden");
      assertEqual(folder.id, "/2026_KO_1000_BlueGarden", "folder path id");
      assertTrue(folder.webViewLink.includes("dropbox.com"), "folder shared url");

      const master = await storage.uploadFile({
        parentId: folder.id,
        name: "2026_KO_1000_BlueGarden_master_01.jpg",
        mimeType: "image/jpeg",
        contents: Buffer.from("master-bytes"),
      });
      const hr = await storage.uploadFile({
        parentId: folder.id,
        name: "2026_KO_1000_BlueGarden_hr_01.jpg",
        mimeType: "image/jpeg",
        contents: Buffer.from("hr-bytes"),
      });
      const web = await storage.uploadFile({
        parentId: folder.id,
        name: "2026_KO_1000_BlueGarden_web_01.jpg",
        mimeType: "image/jpeg",
        contents: Buffer.from("web-bytes"),
      });
      const thumb = await storage.uploadFile({
        parentId: folder.id,
        name: "2026_KO_1000_BlueGarden_thumb_01.jpg",
        mimeType: "image/jpeg",
        contents: Buffer.from("thumb-bytes"),
      });
      const metadataFilename = "1000_metadata.json";
      const metadataJson = JSON.stringify(
        {
          schemaVersion: 1,
          inventoryId: 1000,
          title: "Blue Garden",
          files: { metadata: { filename: metadataFilename } },
        },
        null,
        2,
      );
      const metadata = await storage.uploadFile({
        parentId: folder.id,
        name: metadataFilename,
        mimeType: "application/json",
        contents: Buffer.from(metadataJson, "utf8"),
      });

      assertTrue(master.webViewLink.includes("dropbox.com"), "master url");
      assertTrue(hr.webViewLink.includes("dropbox.com"), "hr url");
      assertTrue(web.webViewLink.includes("dropbox.com"), "web url");
      assertTrue(thumb.webViewLink.includes("dropbox.com"), "thumb url");
      assertTrue(metadata.webViewLink.includes("dropbox.com"), "metadata url");
      assertEqual(metadata.name, "1000_metadata.json", "metadata filename");
      assertEqual(
        await ops.pathExists(
          "/2026_KO_1000_BlueGarden/2026_KO_1000_BlueGarden_master_01.jpg",
        ),
        true,
        "master exists",
      );
      assertEqual(
        await ops.pathExists(
          "/2026_KO_1000_BlueGarden/2026_KO_1000_BlueGarden_web_01.jpg",
        ),
        true,
        "web exists",
      );
      assertEqual(
        await ops.pathExists(
          "/2026_KO_1000_BlueGarden/2026_KO_1000_BlueGarden_thumb_01.jpg",
        ),
        true,
        "thumb exists",
      );
      assertEqual(
        await ops.pathExists("/2026_KO_1000_BlueGarden/1000_metadata.json"),
        true,
        "metadata file exists",
      );
      const downloaded = await ops.downloadFile(
        "/2026_KO_1000_BlueGarden/1000_metadata.json",
      );
      assertEqual(
        JSON.parse(downloaded.toString("utf8")).schemaVersion,
        1,
        "metadata JSON valid",
      );
      // Neutral Sheet columns receive these same shared URLs from either provider.
      assertTrue(
        [
          master.webViewLink,
          hr.webViewLink,
          web.webViewLink,
          thumb.webViewLink,
          metadata.webViewLink,
          folder.webViewLink,
        ].every((u) => u.includes("dropbox.com")),
        "neutral URL columns hold Dropbox links",
      );
    },
  },
  {
    name: "Drive-shaped StorageProvider uploads Inventory-ID metadata file like any other file",
    run: async () => {
      const files = new Map<string, { mimeType: string; contents: Buffer }>();
      const storage: StorageProvider = {
        kind: "drive",
        async verifyReady() {
          return { ok: true, rootName: "Archive", archiveRootUrl: null };
        },
        async findChildFolderByName() {
          return null;
        },
        async createArtworkFolder(name) {
          return {
            id: "folder-id",
            name,
            webViewLink: "https://drive.google.com/drive/folders/folder-id",
          };
        },
        async uploadFile(params) {
          files.set(params.name, {
            mimeType: params.mimeType,
            contents: Buffer.from(params.contents),
          });
          return {
            id: `file-${params.name}`,
            name: params.name,
            webViewLink: `https://drive.google.com/file/d/${params.name}`,
          };
        },
        async moveFolderToFailedIntake() {},
        getArchiveRootUrl() {
          return null;
        },
      };

      const folder = await storage.createArtworkFolder("2026_KO_1000_BlueGarden");
      await storage.uploadFile({
        parentId: folder.id,
        name: "master.tif",
        mimeType: "image/tiff",
        contents: Buffer.from("master"),
      });
      const meta = await storage.uploadFile({
        parentId: folder.id,
        name: "1000_metadata.json",
        mimeType: "application/json",
        contents: Buffer.from(
          JSON.stringify({ schemaVersion: 1 }, null, 2),
          "utf8",
        ),
      });

      assertEqual(meta.name, "1000_metadata.json", "drive metadata name");
      assertEqual(
        files.get("1000_metadata.json")?.mimeType,
        "application/json",
        "mime",
      );
      assertEqual(
        JSON.parse(files.get("1000_metadata.json")!.contents.toString("utf8"))
          .schemaVersion,
        1,
        "drive metadata JSON",
      );
    },
  },
  {
    name: "folder conflict detection uses exact child path",
    run: async () => {
      const ops = createMockOps();
      const storage = createDropboxStorageProvider(async () => ops);
      await storage.createArtworkFolder("2026_KO_1001_Conflict");
      const found = await storage.findChildFolderByName("2026_KO_1001_Conflict");
      assertEqual(found?.id, "/2026_KO_1001_Conflict", "found");
      assertEqual(
        await storage.findChildFolderByName("missing"),
        null,
        "missing",
      );
    },
  },
  {
    name: "moveFolderToFailedIntake relocates artwork folder",
    run: async () => {
      const ops = createMockOps();
      const storage = createDropboxStorageProvider(async () => ops);
      await storage.verifyReady();
      const folder = await storage.createArtworkFolder("2026_KO_1002_Fail");
      await storage.uploadFile({
        parentId: folder.id,
        name: "file.jpg",
        mimeType: "image/jpeg",
        contents: Buffer.from("x"),
      });
      await storage.moveFolderToFailedIntake({ folderId: folder.id });
      assertEqual(await ops.pathExists(folder.id), false, "removed from root");
      assertEqual(
        await ops.pathExists(`${DROPBOX_FAILED_INTAKE_PATH}/2026_KO_1002_Fail`),
        true,
        "under failed intake",
      );
      assertEqual(
        await ops.pathExists(
          `${DROPBOX_FAILED_INTAKE_PATH}/2026_KO_1002_Fail/file.jpg`,
        ),
        true,
        "file moved with folder",
      );
    },
  },
  {
    name: "retry overwrite of the same thumbnail path does not create a second file",
    run: async () => {
      const ops = createMockOps();
      const storage = createDropboxStorageProvider(async () => ops);
      const folder = await storage.createArtworkFolder("2026_KO_1000_BlueGarden");
      const name = "2026_KO_1000_BlueGarden_thumb_01.jpg";
      await storage.uploadFile({
        parentId: folder.id,
        name,
        mimeType: "image/jpeg",
        contents: Buffer.from("first"),
      });
      await storage.uploadFile({
        parentId: folder.id,
        name,
        mimeType: "image/jpeg",
        contents: Buffer.from("second"),
      });
      const path = `/${folder.name}/${name}`;
      const downloaded = await ops.downloadFile(path);
      assertEqual(downloaded.toString("utf8"), "second", "overwritten bytes");
      assertEqual(await ops.pathExists(path), true, "single canonical path");
    },
  },
];

async function main() {
  let failed = 0;
  for (const test of tests) {
    try {
      await test.run();
      console.log(`ok - ${test.name}`);
    } catch (error) {
      failed += 1;
      console.error(`fail - ${test.name}`);
      console.error(error);
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} storage test(s) failed`);
    process.exit(1);
  }
  console.log(`\n${tests.length} storage tests passed`);
}

void main();
