/**
 * Escape a value for use inside a Google Drive `q` string literal.
 * Drive queries wrap string values in single quotes.
 */
export function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Build a Drive `q` clause that finds a folder named `name` directly under `parentId`.
 */
export function buildChildFolderQuery(parentId: string, name: string): string {
  const safeParent = escapeDriveQueryValue(parentId);
  const safeName = escapeDriveQueryValue(name);
  return [
    `'${safeParent}' in parents`,
    `name = '${safeName}'`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    `trashed = false`,
  ].join(" and ");
}

export const FAILED_INTAKE_FOLDER_NAME = "Failed Intake";
