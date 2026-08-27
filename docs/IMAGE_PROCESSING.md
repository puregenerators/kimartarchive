# Image processing

Sharp derivative generation is used in three places:

1. **UI TIFF thumbnails** — `POST /api/image-preview` creates temporary JPEG thumbnails so the intake UI can show TIFF masters (browsers cannot render TIFF natively). TIFFs larger than the 4.5 MB Function body limit skip this POST and show a filename/type placeholder instead. Masters over **150 MB** never call this route: the UI shows the filename/type placeholder and large-file intake copy, and does not treat a missing preview as a Failed master.
2. **Local diagnostic** — `/api/dev/process-artwork-image` for visual testing from **Archive setup** (`/setup/archive`) only (temporary OS temp files). This path is disabled on Vercel so source files cannot pass through a production function body. It is not shown on New Artwork Batch or Review Batch, and results are not reused by submission. Files over 150 MB are not accepted here; they use Dropbox intake during submission.
3. **Permanent submission** — JSON prepare + direct Dropbox upload + `POST /api/artwork-batches/process` regenerates HR/web/thumbnail server-side from the Dropbox master (does not reuse diagnostic preview results). Large-file intake inspects the Dropbox master only after it is in place.

During submission (and the local dev preview), Sharp reads source metadata and decodes the master **once** into an in-memory raw pixel buffer. HR, web, and thumbnail are then encoded **sequentially** from that buffer. Sharp `.clone()` is not used for this: it shares the compressed input but still decodes independently per pipeline. The thumbnail is **not** produced by decoding the HR or web JPEG.

Derivative settings live only in `lib/images/config.ts` and must not be duplicated in submission code. Preview thumbnail settings are a **separate** `preview` block and must not be mixed with HR / web / archival-thumb settings. See `docs/SUBMISSION_PIPELINE.md` for delivery.

**The app is not the archive.** Drive stores permanent files; Sheets stores permanent metadata; local temps and form state are discarded after delivery.

**TIFF UI thumbnails are temporary UI previews only.** They are not archival outputs, are never uploaded to Dropbox, and are never written to Google Sheets.

---

## Supported source formats

| Format | Extensions | Notes |
| --- | --- | --- |
| TIFF | `.tif`, `.tiff` | Multi-page: page 1 only for derivatives and UI thumbnails |
| JPEG | `.jpg`, `.jpeg` | Browser preview via object URL |
| PNG | `.png` | Transparency flattened to white |

- Maximum source size for **direct upload**: **150 MB**
- Masters over 150 MB use **large-file Dropbox intake**. Preview availability is separate from master-file validity. Processing still inspects pixel dimensions, bit depth, and estimated memory before decode. Unsafe files are labeled **Local processing required**.
- Format is determined with **Sharp metadata**, not the filename extension alone. A Photoshop document (`8BPS` / `8BPB`) named `.tif` is rejected as an unsupported format after Dropbox placement — it is not treated as a corrupt TIFF.
- Unsupported or unreadable files return a clear structured error. “The image could not be decoded” is reserved for a real decode attempt on a file already in Dropbox.

---

## Source validation

Before generating derivatives or UI thumbnails, the server:

1. Rejects empty files. Direct-upload processing still rejects files over 150 MB. Large-file Dropbox intake may process a larger master only after the Vercel memory safety check.
2. Reads the first bytes for known unsupported signatures (Photoshop `8BPS` / `8BPB`)
3. Decodes metadata with Sharp (`failOn: "error"`)
4. Confirms the detected format is jpeg / png / tiff
5. Requires width and height
6. Rejects edges larger than **30,000 px**
7. Rejects decoded pixel counts above **200,000,000** (~200 MP)

These limits are intended for high-resolution artwork photography while reducing decompression-bomb risk.

---

## Master preservation

The master is the **original uploaded bytes**, not rewritten in this milestone.

- Original bytes are preserved (no recompression)
- Planned master filename uses a normalized extension:
  - `.jpeg` → `.jpg`
  - `.tiff` → `.tif`
- Multi-page TIFFs remain unchanged as the master even when only page 1 is used for derivatives or UI thumbnails

---

## Flat artwork folder structure (planned)

When Drive upload is implemented, each inventory artwork folder will be **flat** (no Master / High Resolution / Web subfolders):

```text
YYYY/INVENTORYID_SanitizedTitle/
  YYYY_KO_INVENTORYID_SanitizedTitle_master_01.<ext>
  YYYY_KO_INVENTORYID_SanitizedTitle_hr_01.jpg
  YYYY_KO_INVENTORYID_SanitizedTitle_web_01.jpg
  YYYY_KO_INVENTORYID_SanitizedTitle_thumb_01.jpg
```

---

## Derivative settings (provisional)

Centralized in `lib/images/config.ts`. Refine after visual testing with Kim’s files.

### High-resolution JPG

| Setting | Value |
| --- | --- |
| Filename | `…_hr_01.jpg` |
| Dimensions | Original (after EXIF orientation); never enlarge |
| JPEG quality | **95** |
| Progressive | Yes |
| Color | Convert to sRGB when supported; embed sRGB ICC |
| Transparency | Flatten against white |
| Metadata | Strip unnecessary tags; retain sRGB output intent |
| Sharpening | None (full-size output) |

### Web JPG

| Setting | Value |
| --- | --- |
| Filename | `…_web_01.jpg` |
| Max long edge | **2400 px** (never enlarge; preserve aspect ratio) |
| JPEG quality | **86** |
| Progressive | Yes |
| Resize kernel | Lanczos3 |
| Color | Convert to sRGB when supported; embed sRGB ICC |
| Transparency | Flatten against white |
| Metadata | Strip unnecessary tags; retain sRGB output intent |
| Sharpening | Mild, **only if resized** (`sigma: 0.5`) |

### Archival thumbnail JPG

Stored in the artwork Dropbox folder and rendered in the Artwork Inventory **Thumbnail** cell. Distinct from the temporary UI TIFF preview.

| Setting | Value |
| --- | --- |
| Filename | `…_thumb_01.jpg` |
| Max long edge | **500 px** (never enlarge; preserve aspect ratio; never crop) |
| JPEG quality | **84** |
| Progressive | Yes |
| Resize kernel | Lanczos3 |
| Color | Convert to sRGB when supported; embed sRGB ICC |
| Transparency | Flatten against white |
| Sharpening | Mild, **only if resized** (same as web) |

### UI preview thumbnail (temporary)

Used only so the intake UI can display TIFF masters. **Not** an archival derivative.

| Setting | Value |
| --- | --- |
| Max box | **600 × 600 px** (`fit: inside`; preserve aspect ratio) |
| Never enlarge | Yes |
| JPEG quality | **78** |
| Progressive | Yes |
| Color | Convert to sRGB; embed sRGB ICC |
| Transparency | Flatten against white |
| Multi-page TIFF | Page 1 only |
| Concurrency | Client queue limit **2** simultaneous Sharp preview jobs |

---

## Color-space and metadata behavior

- EXIF orientation is applied via Sharp `rotate()` / auto-orient before measuring and encoding
- Output colourspace is forced to **sRGB** with `toColourspace('srgb')` and `withIccProfile('srgb')`
- Most source EXIF/XMP is stripped by default Sharp JPEG output
- Source ICC presence is reported in metadata (`hasIccProfile`) for inspection

**Known limitation:** Unusual source profiles (CMYK, exotic ICC) are converted to sRGB for derivatives. Soft-proofing / absolute colorimetric intent is not implemented. Validate with Kim’s real masters before locking settings.

---

## TIFF handling

- Only **page 1** is used for HR, web, thumbnail, and UI thumbnail generation
- If `pages > 1`, the UI shows a quiet note: “Multi-page TIFF · previewing page 1”
- The original multi-page file remains the planned master bytes
- Unsupported TIFF compression surfaces as a structured error when Sharp cannot decode
- If UI thumbnail generation fails, the neutral TIFF placeholder remains and intake validation / submission are **not** blocked
- Masters over 150 MB skip `/api/image-preview`. Review Batch shows large-file Dropbox intake copy instead of treating a missing preview as Failed.

**Known limitation:** Some TIFF variants (JPEG2000 compression, unusual photometric interpretations, password-protected files) may fail decode. Prefer LZW / uncompressed TIFF, JPEG, or PNG for intake when possible.

---

## Temporary local output behavior

Processing writes under the OS temp directory, **outside the Git repository**:

```text
{os.tmpdir()}/kimartarchive-image-processing/{resultId}/
  hr.jpg          ← HR derivative
  web.jpg         ← web derivative
  thumb.jpg       ← archival thumbnail derivative
  preview.jpg     ← UI-only TIFF thumbnail (when kind is preview)
  manifest.json
```

| Behavior | Detail |
| --- | --- |
| Result ID | Opaque UUID (never raw filesystem paths in the API) |
| HR / web / thumb preview | `GET /api/dev/processed-image/{resultId}/hr\|web\|thumb` |
| UI thumbnail | `GET /api/image-preview/{resultId}` |
| TTL | **45 minutes**; expired dirs removed opportunistically |
| Permissions | Directory `0700`, files `0600` |
| Failed runs | Partial dirs are deleted |
| Isolation | No directory listing; unknown IDs → 404 |
| Client cleanup | Replacing / removing a TIFF or resetting the batch `DELETE`s that artwork’s preview result |

Buffers are not kept in global process state after the response is written. UI thumbnails are never stored in `localStorage` or permanent app state.

---

## Development / intake APIs

### `POST /api/image-preview`

Multipart form fields:

- `file` — exactly one image (TIFF, JPEG, or PNG)
- `artworkId` — client artwork id (for error context)
- `originalFilename` — optional display name

Returns JSON with an opaque `resultId`, `previewUrl`, dimensions, multi-page flags, and `uiPreviewOnly: true`. Errors are structured. This is **not** a general-purpose image transformation API.

### `GET /api/image-preview/[resultId]`

Serves the temporary preview JPEG. `DELETE` removes it early (TTL remains the safety net).

### `POST /api/dev/process-artwork-image`

Multipart form fields:

- `file` — exactly one image
- `artworkId` — client artwork id (for error context)
- `originalFilename`, `title`, `year`, `inventoryId`
- `masterFilename`, `hrFilename`, `webFilename` — planned names (validated; no paths)

Returns JSON with source metadata, derivative metadata, comparison stats, and opaque preview/download URLs. Errors are structured and never include stack traces.

### `GET /api/dev/processed-image/[resultId]/[asset]`

Serves `hr`, `web`, or `thumb` JPEG. Add `?download=1` for attachment disposition.

These routes must not become a general-purpose image CDN. `POST /api/dev/process-artwork-image` is blocked when `VERCEL=1` so production deployments cannot accept multipart source files.

---

## How to review a batch from the intake UI

1. Start the app: `npm run dev`
2. Open **New Artwork Batch**
3. Select multiple master images at once (JPEG, PNG, or TIFF)—for example 10 small files. Each file becomes its own artwork entry.
4. TIFF cards should show **Generating preview…**, then a JPEG thumbnail with a small **TIFF** badge. Queued previews run at most **2 at a time**.
5. Enter shared details once; use **Apply to all artworks** if needed. Edit titles, media, and dimensions per artwork in the compact rows.
6. Click **Review Batch** — the same temporary TIFF thumbnails appear in review. Planned filenames use preview inventory IDs only.
7. Submit the batch. Permanent delivery runs the canonical image-processing pipeline from the Dropbox master.

Replacing an artwork’s image clears only that artwork’s TIFF thumbnail. Adding or removing other artworks does not discard unrelated thumbnails. Reordering preserves TIFF thumbnail association because it is keyed by the stable artwork client id.

TIFF UI thumbnails are keyed only by artwork id + source file identity (name, size, lastModified).

---

## How to run the local processing diagnostic

Use this only on a local `npm run dev` server. It is not part of intake or Review Batch.

1. Start the app: `npm run dev`
2. Open **Archive setup** (`/setup/archive`)
3. Choose a JPEG, PNG, or TIFF under **150 MB**
4. Click **Process image**
5. Inspect the result panel, which is ordered for scanning:
   - Heading plus a quiet `Dev preview · processed in … ms` label, the source filename, and source size
   - Any warnings (for example multi-page TIFF handling), always outside collapsed areas
   - A compact **Master / HR / Web / Thumb / Processed in** summary row
   - Three-column previews (source / HR / web); TIFF sources may not have a browser thumbnail
   - HR and web output details: filename with a **Copy** button, size and dimensions, quality and resize status, and one size-vs-source statement
   - A collapsed **Technical details** disclosure holding format, dimensions, color space, DPI, ICC, alpha, orientation, channels, and page count
   - The planned master filename, with original bytes preserved

Diagnostic outputs are temporary and are **not** reused for permanent delivery.

---

## Known limitations

- Local-only; not the final submission pipeline
- Large masters may stress machine memory/CPU; timeout is 5 minutes
- UI TIFF thumbnails require the local preview endpoint; if generation fails, a placeholder remains and submission is not blocked
- Production masters upload directly to Dropbox (≤ **150 MB**). Vercel process functions download a file-backed copy and must not receive master bytes in the request body.
- Settings are provisional pending visual QA with Kim’s files
