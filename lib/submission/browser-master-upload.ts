/**
 * Browser helper: POST master bytes to a Dropbox temporary upload link.
 * Never attaches Dropbox access or refresh tokens.
 */

export async function uploadMasterToTemporaryLink(params: {
  uploadUrl: string;
  file: Blob;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", params.uploadUrl);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !params.onProgress) return;
      params.onProgress(event.total > 0 ? event.loaded / event.total : 0);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        params.onProgress?.(1);
        resolve();
        return;
      }
      reject(
        new Error(
          `Dropbox rejected the master upload (${xhr.status}). The file was not sent through this app’s server.`,
        ),
      );
    };
    xhr.onerror = () => {
      reject(
        new Error(
          "The master upload to Dropbox failed. Check your connection and try again.",
        ),
      );
    };
    xhr.onabort = () => {
      reject(new Error("The master upload was cancelled."));
    };
    if (params.signal) {
      if (params.signal.aborted) {
        xhr.abort();
        return;
      }
      params.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(params.file);
  });
}
