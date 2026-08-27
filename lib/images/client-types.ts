import type {
  ArtworkImageProcessingTimings,
  ArtworkSourceMetadata,
} from "@/lib/images/types";

export type ClientProcessedDerivative = {
  filename: string;
  width: number;
  height: number;
  byteLength: number;
  format: "jpeg";
  quality: number;
  wasResized: boolean;
  previewUrl: string;
  downloadUrl: string;
};

export type ClientProcessingComparisons = {
  hrSizeRatio: number | null;
  webSizeRatio: number | null;
  webSizeReductionPercent: number | null;
  webWasResized: boolean;
};

export type ArtworkProcessingSuccess = {
  status: "success";
  resultId: string;
  expiresAt: number;
  durationMs: number;
  warnings: string[];
  source: ArtworkSourceMetadata;
  master: {
    filename: string;
    extension: string;
    byteLength: number;
    preservedOriginalBytes: true;
  };
  hr: ClientProcessedDerivative;
  web: ClientProcessedDerivative;
  thumb: ClientProcessedDerivative;
  comparisons: ClientProcessingComparisons;
};

export type ProcessArtworkImageApiSuccess = {
  ok: true;
  developmentOnly: true;
  artworkId: string | null;
  resultId: string;
  expiresAt: number;
  durationMs: number;
  timings: ArtworkImageProcessingTimings;
  warnings: string[];
  source: ArtworkSourceMetadata;
  master: ArtworkProcessingSuccess["master"];
  hr: ClientProcessedDerivative;
  web: ClientProcessedDerivative;
  thumb: ClientProcessedDerivative;
  comparisons: ClientProcessingComparisons;
};

export type ProcessArtworkImageApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    artworkId: string | null;
  };
};
