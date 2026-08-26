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
};
