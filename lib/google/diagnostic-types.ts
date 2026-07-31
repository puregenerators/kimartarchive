import type { EnvPresence } from "@/lib/google/env";
import type { HeaderComparison } from "@/lib/google/headers";
import {
  ARTWORK_INVENTORY_TAB,
  INVENTORY_CLAIMS_TAB,
} from "@/lib/google/headers";
import type {
  GooglePermissionLevel,
  OverallStatus,
} from "@/lib/google/setup-logic";

export type SheetTabName =
  | typeof ARTWORK_INVENTORY_TAB
  | typeof INVENTORY_CLAIMS_TAB;

export type TabHeaderStatus = {
  tab: SheetTabName;
  exists: boolean;
  comparison: HeaderComparison | { kind: "missing_tab" };
  canInitializeHeaders: boolean;
};

export type ConfigDiagnostics = {
  presence: EnvPresence;
  missing: string[];
  ready: boolean;
  /** Active artwork file storage backend. */
  storageKind: "dropbox" | "drive";
  /** True when GOOGLE_DRIVE_ROOT_FOLDER_ID is required for submission. */
  driveRootRequired: boolean;
};

export type ResourcePermissionDiagnostics = {
  level: GooglePermissionLevel;
  label: string;
  hasEditorAccess: boolean;
  warning?: string;
};

export type SheetsDiagnostics = {
  ok: boolean;
  complete: boolean;
  error?: { code: string; message: string };
  title?: string;
  spreadsheetIdPresent: boolean;
  permission: ResourcePermissionDiagnostics | null;
  artworkInventory: TabHeaderStatus | null;
  inventoryClaims: TabHeaderStatus | null;
  artworkInventorySummary?: { label: string; details: string[] };
  inventoryClaimsSummary?: { label: string; details: string[] };
};

export type DriveFolderMetadataPublic = {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
};

export type DriveChildFolder = {
  id: string;
  name: string;
};

export type DriveDiagnostics = {
  ok: boolean;
  complete: boolean;
  error?: { code: string; message: string };
  folder?: DriveFolderMetadataPublic;
  permission: ResourcePermissionDiagnostics | null;
  childFolders: DriveChildFolder[];
  failedIntakePresent: boolean;
  failedIntakeFolderName: string;
};

export type GoogleDiagnostics = {
  checkedAt: string;
  overall: OverallStatus;
  config: ConfigDiagnostics;
  archiveTarget: {
    target: "test" | "production" | "invalid";
    ready: boolean;
    message: string;
    testConfigPresent: boolean;
    productionConfigPresent: boolean;
  };
  sheets: SheetsDiagnostics;
  drive: DriveDiagnostics;
  expectedHeaders: {
    artworkInventory: readonly string[];
    inventoryClaims: readonly string[];
  };
};
