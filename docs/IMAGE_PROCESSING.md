# Image processing

Sharp derivative generation is used in three places:

1. **UI TIFF thumbnails** — `POST /api/image-preview` creates temporary JPEG thumbnails so the intake UI can show TIFF masters (browsers cannot render TIFF natively). TIFFs larger than the 4.5 MB Function body limit skip this POST and show a filename/type placeholder instead.
2. **Dev preview** — `/api/dev/process-artwork-image` for local visual testing from the review screen (temporary OS temp files only).
3. **Permanent submission** — JSON prepare + direct Dropbox upload + `POST /api/artwork-batches/process` regenerates HR/web/thumbnail server-side from the Dropbox master (does not reuse client preview results).

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

- Maximum source size: **150 MB**
- Format is determined with **Sharp metadata**, not the filename extension alone
- Unsupported or unreadable files return a clear structured error

---

## Source validation

Before generating derivatives or UI thumbnails, the server:

1. Rejects empty files and files over 150 MB
2. Decodes metadata with Sharp (`failOn: "error"`)
3. Confirms the detected format is jpeg / png / tiff
4. Requires width and height
5. Rejects edges larger than **30,000 px**
6. Rejects decoded pixel counts above **200,000,000** (~200 MP)

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

These routes must not become a general-purpose image CDN.

---

## How to test from the intake UI

1. Start the app: `npm run dev`
2. Open **New Artwork Batch**
3. Select multiple master images at once (JPEG, PNG, or TIFF)—for example 10 small files. Each file becomes its own artwork entry.
4. TIFF cards should show **Generating preview…**, then a JPEG thumbnail with a small **TIFF** badge. Queued previews run at most **2 at a time**.
5. Enter shared details once; use **Apply shared details to all** if needed. Edit titles, media, and dimensions per artwork in the compact rows.
6. Click **Review Batch** — the same temporary TIFF thumbnails appear in review and in the source column of image-processing comparisons when available.
7. On each artwork card, click **Test image processing**, or use **Test next unprocessed artwork**. Do not expect full-batch auto-processing in this milestone.
8. Inspect status: Not tested → Processing → Processed successfully / failed
9. Review the result panel, which is ordered for scanning:
   - Heading plus a quiet `Dev preview · processed in … ms` label, the source filename, and source size
   - Any warnings (for example multi-page TIFF handling), always outside collapsed areas
   - A compact **Master / HR / Web / Thumb / Processed in** summary row
   - Three-column previews (source / HR / web); TIFF sources use the temporary UI thumbnail when available
   - HR and web output details: filename with a **Copy** button, size and dimensions, quality and resize status, and one size-vs-source statement
   - A collapsed **Technical details** disclosure holding format, dimensions, color space, DPI, ICC, alpha, orientation, channels, and page count
   - The planned master filename, with original bytes preserved

Planned filenames are listed above the result before processing (and again while a result is stale); once a fresh result exists, the result panel is the single place all three filenames appear.

Replacing an artwork’s image clears only that artwork’s processing result **and** its TIFF thumbnail. Adding or removing other artworks does not discard unrelated results. Reordering preserves TIFF thumbnail association because it is keyed by the stable artwork client id.

### Stale results

Results are keyed by the artwork’s stable client id and a fingerprint of:

- title
- year
- preview inventory id (order)
- source image identity (name, size, lastModified)

Changing those fields marks the result **stale** with:

> Artwork details changed. Reprocess to update filenames and derivatives.

Notes and other unrelated fields do **not** invalidate processing.

TIFF UI thumbnails are keyed only by artwork id + source file identity (name, size, lastModified).

---

## Known limitations

- Local-only; not the final submission pipeline
- Large masters may stress machine memory/CPU; timeout is 5 minutes
- UI TIFF thumbnails require the local preview endpoint; if generation fails, a placeholder remains and submission is not blocked
- Production masters upload directly to Dropbox (≤ **150 MB**). Vercel process functions download a file-backed copy and must not receive master bytes in the request body.
- Settings are provisional pending visual QA with Kim’s files
