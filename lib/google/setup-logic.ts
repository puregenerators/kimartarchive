import type { HeaderComparison } from "@/lib/google/headers";

export type HeaderInitDecision =
  | { action: "write_headers"; reason: "blank_header_row" }
  | { action: "noop"; reason: "headers_already_match" }
  | {
      action: "refuse";
      reason: "headers_mismatch" | "tab_missing";
      detail: string;
    };

export function decideHeaderInitialization(
  comparison: HeaderComparison | { kind: "missing_tab" },
): HeaderInitDecision {
  if (comparison.kind === "missing_tab") {
    return {
      action: "refuse",
      reason: "tab_missing",
      detail:
        "The sheet tab does not exist. Create it manually in Google Sheets, then retry.",
    };
  }

  if (comparison.kind === "blank") {
    return { action: "write_headers", reason: "blank_header_row" };
  }

  if (comparison.kind === "match") {
    return { action: "noop", reason: "headers_already_match" };
  }

  return {
    action: "refuse",
    reason: "headers_mismatch",
    detail:
      "Header row is non-empty and does not match the expected schema. Refusing to overwrite.",
  };
}

export type FailedIntakeDecision =
  | { action: "create"; reason: "missing" }
  | { action: "noop"; reason: "already_exists" };

export function decideFailedIntakeCreation(exists: boolean): FailedIntakeDecision {
  if (exists) {
    return { action: "noop", reason: "already_exists" };
  }
  return { action: "create", reason: "missing" };
}

/** Effective role inferred from Drive file capabilities (no write probe). */
export type GooglePermissionLevel = "editor" | "viewer" | "unknown";

export function mapCapabilitiesToPermissionLevel(input: {
  canEdit?: boolean | null;
}): GooglePermissionLevel {
  if (input.canEdit === true) return "editor";
  if (input.canEdit === false) return "viewer";
  return "unknown";
}

export function formatPermissionLevel(level: GooglePermissionLevel): string {
  switch (level) {
    case "editor":
      return "Editor";
    case "viewer":
      return "Viewer / Read-only";
    case "unknown":
      return "Unknown";
  }
}

export type OverallStatusInput = {
  configReady: boolean;
  sheetsConnected: boolean;
  sheetsPermission: GooglePermissionLevel | null;
  driveConnected: boolean;
  drivePermission: GooglePermissionLevel | null;
  /**
   * When false (Dropbox file storage), Drive root is not required for Ready.
   * Defaults to true for legacy Drive-oriented tooling.
   */
  requireDrive?: boolean;
};

export type OverallStatus = {
  ready: boolean;
  label: "Ready" | "Configuration Incomplete";
  explanation: string;
};

export function buildOverallStatus(input: OverallStatusInput): OverallStatus {
  if (!input.configReady) {
    return {
      ready: false,
      label: "Configuration Incomplete",
      explanation:
        "Required environment variables are missing. See docs/GOOGLE_SETUP.md.",
    };
  }

  const requireDrive = input.requireDrive !== false;
  const issues: string[] = [];

  if (!input.sheetsConnected) {
    issues.push("Google Sheets is not connected");
  } else if (input.sheetsPermission !== "editor") {
    issues.push("Google Sheets requires Editor access");
  }

  if (requireDrive) {
    if (!input.driveConnected) {
      issues.push("Google Drive is not connected");
    } else if (input.drivePermission !== "editor") {
      issues.push("Google Drive requires Editor access");
    }
  }

  if (issues.length === 0) {
    return {
      ready: true,
      label: "Ready",
      explanation: requireDrive
        ? "Environment variables are valid, and Sheets and Drive are reachable with Editor access."
        : "Environment variables are valid, and Google Sheets is reachable with Editor access.",
    };
  }

  return {
    ready: false,
    label: "Configuration Incomplete",
    explanation: `${issues.join(". ")}.`,
  };
}

export function isSectionComplete(
  connected: boolean,
  permission: GooglePermissionLevel | null,
): boolean {
  return connected && permission === "editor";
}
