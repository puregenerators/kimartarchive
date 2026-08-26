export type RetryClaimRef = {
  clientArtworkId: string;
  claimId: string;
  inventoryId: number;
};

export type PreparedArtwork = {
  clientArtworkId: string;
  order: number;
  claimId: string;
  inventoryId: number;
  claimStatus: "Claimed" | "Processing";
  folderName: string;
  folderPath: string;
  masterFilename: string;
  masterPath: string;
  masterAlreadyUploaded: boolean;
  reusedClaim: boolean;
  /** True when the master exceeds the Dropbox temporary-upload-link cap. */
  requiresManualDropboxUpload: boolean;
  /** Signed-in Dropbox web URL for the reserved folder; never a token or temp link. */
  folderWebUrl: string | null;
  declaredByteLength: number;
};
