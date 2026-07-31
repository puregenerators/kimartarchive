# Image processing

Sharp derivative generation is used in two places:

1. **Dev preview** — `/api/dev/process-artwork-image` for local visual testing from the review screen (temporary OS temp files only).
2. **Permanent submission** — `POST /api/artwork-batches/submit` regenerates HR/web server-side during delivery (does not reuse client preview results).

Derivative settings live only in `lib/images/config.ts` and must not be duplicated in submission code. See `docs/SUBMISSION_PIPELINE.md` for Drive/Sheets delivery.

**The app is not the archive.** Drive stores permanent files; Sheets stores permanent metadata; local temps and form state are discarded after delivery.

---

## Supported source formats

| Format | Extensions | Notes |
| --- | --- | --- |
| TIFF | `.tif`, `.tiff` | Multi-page: page 1 only for derivatives |
| JPEG | `.jpg`, `.jpeg` | |
| PNG | `.png` | Transparency flattened to white |

- Maximum source size: **250 MB**
- Format is determined with **Sharp metadata**, not the filename extension alone
- Unsupported or unreadable files return a clear structured error

---

## Source validation

Before generating derivatives, the server:

1. Rejects empty files and files over 250 MB
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
- Multi-page TIFFs remain unchanged as the master even when only page 1 is used for derivatives

---

## Flat artwork folder structure (planned)

When Drive upload is implemented, each inventory artwork folder will be **flat** (no Master / High Resolution / Web subfolders):

```text
YYYY/INVENTORYID_SanitizedTitle/
  YYYY_KO_INVENTORYID_SanitizedTitle_master_01.<ext>
  YYYY_KO_INVENTORYID_SanitizedTitle_hr_01.jpg
  YYYY_KO_INVENTORYID_SanitizedTitle_web_01.jpg
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

---

## Color-space and metadata behavior

- EXIF orientation is applied via Sharp `rotate()` / auto-orient before measuring and encoding
- Output colourspace is forced to **sRGB** with `toColourspace('srgb')` and `withIccProfile('srgb')`
- Most source EXIF/XMP is stripped by default Sharp JPEG output
- Source ICC presence is reported in metadata (`hasIccProfile`) for inspection

**Known limitation:** Unusual source profiles (CMYK, exotic ICC) are converted to sRGB for derivatives. Soft-proofing / absolute colorimetric intent is not implemented. Validate with Kim’s real masters before locking settings.

---

## TIFF handling

- Only **page 1** is used for HR and web generation
- If `pages > 1`, the UI/API includes a warning that only page 1 was used
- The original multi-page file remains the planned master bytes
- Unsupported TIFF compression surfaces as a structured error when Sharp cannot decode

**Known limitation:** Some TIFF variants (JPEG2000 compression, unusual photometric interpretations, password-protected files) may fail decode. Prefer LZW / uncompressed TIFF, JPEG, or PNG for intake when possible.

---

## Temporary local output behavior

Processing writes under the OS temp directory, **outside the Git repository**:

```text
{os.tmpdir()}/kimartarchive-image-processing/{resultId}/
  hr.jpg
  web.jpg
  manifest.json
```

| Behavior | Detail |
| --- | --- |
| Result ID | Opaque UUID (never raw filesystem paths in the API) |
| Preview / download | `GET /api/dev/processed-image/{resultId}/hr\|web` |
| TTL | **45 minutes**; expired dirs removed opportunistically |
| Permissions | Directory `0700`, files `0600` |
| Failed runs | Partial dirs are deleted |
| Isolation | No directory listing; unknown IDs → 404 |

Buffers are not kept in global process state after the response is written.

---

## Development API

### `POST /api/dev/process-artwork-image`

Multipart form fields:

- `file` — exactly one image
- `artworkId` — client artwork id (for error context)
- `originalFilename`, `title`, `year`, `inventoryId`
- `masterFilename`, `hrFilename`, `webFilename` — planned names (validated; no paths)

Returns JSON with source metadata, derivative metadata, comparison stats, and opaque preview/download URLs. Errors are structured and never include stack traces.

### `GET /api/dev/processed-image/[resultId]/[asset]`

Serves `hr` or `web` JPEG. Add `?download=1` for attachment disposition.

These routes are **temporary development tooling** and must not become a general-purpose image CDN.

---

## How to test from the intake UI

1. Start the app: `npm run dev`
2. Open **New Artwork Batch**
3. Select multiple master images at once (JPEG, PNG, or TIFF)—for example 10 small files. Each file becomes its own artwork entry.
4. Enter shared details once; use **Apply shared details to all** if needed. Edit titles, media, and dimensions per artwork in the compact rows.
5. Click **Review Batch**
6. On each artwork card, click **Test image processing**, or use **Test next unprocessed artwork**. Do not expect full-batch auto-processing in this milestone.
7. Inspect status: Not tested → Processing → Processed successfully / failed
8. Review the result panel, which is ordered for scanning:
   - Heading plus a quiet `Dev preview · processed in … ms` label, the source filename, and source size
   - Any warnings (for example multi-page TIFF handling), always outside collapsed areas
   - A compact **Master / HR / Web / Processed in** summary row
   - Three-column previews (source / HR / web); TIFF sources show a placeholder
   - HR and web output details: filename with a **Copy** button, size and dimensions, quality and resize status, and one size-vs-source statement
   - A collapsed **Technical details** disclosure holding format, dimensions, color space, DPI, ICC, alpha, orientation, channels, and page count
   - The planned master filename, with original bytes preserved

Planned filenames are listed above the result before processing (and again while a result is stale); once a fresh result exists, the result panel is the single place all three filenames appear.

Replacing an artwork’s image clears only that artwork’s processing result. Adding or removing other artworks does not discard unrelated results. Reordering may change preview inventory IDs and planned filenames, which marks affected results stale.

### Stale results

Results are keyed by the artwork’s stable client id and a fingerprint of:

- title
- year
- preview inventory id (order)
- source image identity (name, size, lastModified)

Changing those fields marks the result **stale** with:

> Artwork details changed. Reprocess to update filenames and derivatives.

Notes and other unrelated fields do **not** invalidate processing.

---

## Known limitations

- Local-only; not the final submission pipeline
- Large masters may stress machine memory/CPU; timeout is 5 minutes
- Browser TIFF preview may be unavailable (placeholder shown); JPG previews still work
- Production upload architecture for large TIFFs remains unresolved (see `ARTWORK_INTAKE_SPEC.md` §12)
- Settings are provisional pending visual QA with Kim’s files
