# Artwork Intake Spec

Private intake app for new artwork batches: capture shared exhibition details and per-artwork metadata/images, claim one inventory ID per artwork, generate standardized files, store them in Google Drive, and append one Google Sheets row per artwork.

**Authoritative systems:** Google Sheets (metadata), Google Drive (files).  
**Stack:** Next.js (App Router), TypeScript, Tailwind CSS, Sharp, Google Sheets API, Google Drive API, Vercel.

**Google resources (display names):**

| Resource | Display name | Runtime identity |
| --- | --- | --- |
| Spreadsheet | Artwork Inventory | `GOOGLE_SHEET_ID` |
| Drive root folder | Kim Artwork Archive | `GOOGLE_DRIVE_ROOT_FOLDER_ID` |

Do **not** resolve the Drive root by name at runtime. Always use `GOOGLE_DRIVE_ROOT_FOLDER_ID`.

---

## Implementation status

| Area | Status |
| --- | --- |
| Local batch intake UI | Implemented (no persistence) |
| Google auth / Sheets / Drive foundation | Implemented |
| `/setup/google` diagnostics + confirmed setup actions | Implemented |
| Final artwork submission (claim, upload, sheet row) | **Implemented** — see `docs/SUBMISSION_PIPELINE.md` |
| Read-only visual archive (`/artworks`) | **Implemented** — see `docs/ARTWORK_ARCHIVE.md` |
| Sharp image processing (local test milestone) | **Implemented** (dev preview + reused by submission) |
| Application password auth | **Not implemented** |
| Production large-file upload architecture | **Unresolved** (see §12) |
| Notion dashboard publishing | **Not implemented** (planned extension only) |

Env vars for Google (server-only; never `NEXT_PUBLIC_`):

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_SHEET_ID`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID`
- `ARTWORK_SUBMISSION_TARGET` (`test` \| `production`)
- `GOOGLE_TEST_SHEET_ID` / `GOOGLE_TEST_DRIVE_ROOT_FOLDER_ID` (required when target is `test`)

See `docs/GOOGLE_SETUP.md` and `docs/SUBMISSION_PIPELINE.md`.

**Authoritative archive:** Dropbox (files, default) and Google Sheets (metadata). Local form state and temp files are discarded after delivery. The app is not a database. `/artworks` is a visual read layer over the live Sheet — see `docs/ARTWORK_ARCHIVE.md`.

---

## 1. Scope

### Batch-first workflow

Users commonly upload **about 10–12 artwork images together**.

- Start with a **batch image upload** (multi-select or drag-and-drop).
- Each uploaded source file becomes **exactly one** artwork draft automatically.
- Do **not** treat multiple uploaded files as multiple views of one artwork.
- Shared details are entered once and inherited by newly created artworks.
- Artwork-specific fields (title, medium, dimensions, etc.) remain independently editable.
- Each artwork becomes its **own** final record: own inventory claim, filenames, archive folder, three image files (master / HR / web), portable `{inventoryId}_metadata.json`, and Sheet row.
- Shared batch metadata (exhibition, gallery, photographer, etc.) is copied onto each final artwork record, with optional per-artwork overrides for exhibition / gallery / photographer.

A one-image selection remains a valid one-artwork batch.

### On successful batch submission the app must

For **each** artwork in the batch:

1. Accept artwork metadata (with shared defaults / overrides resolved).
2. Accept exactly one master image file.
3. Claim the next inventory number (duplicate-safe).
4. Generate standardized filenames (sequence `01`).
5. Preserve the original master file (no recompression).
6. Create high-resolution JPG, web JPG, and thumbnail JPG derivatives.
7. Upload all image files plus portable `{inventoryId}_metadata.json` via the storage provider.
8. Append **one** artwork row to the primary sheet tab (including file links).

Then show a success summary for the batch (inventory IDs and generated files).

**MVP auth:** gate the app with a single shared application password (`APP_ACCESS_PASSWORD`) and an HTTP-only session cookie. Keep auth isolated so it can be replaced later. If the password is missing in production, fail closed.

**MVP processing:** local processing is supported first. Production upload architecture for large files is unresolved (see §12).

---

## 2. Explicit non-goals

Out of scope for this app (initial build):

- Full archive **management** (editing or deletion of existing artworks)
- Clerk, Supabase Auth, Auth.js, or any full user-account system
- Any database other than Google Sheets (no Supabase, Prisma, Postgres, etc.)
- Encoding meaning into inventory IDs (year, type, title)
- Photographer in filenames (unless deliberately added later)
- Notion as a required part of intake (optional future extension only)
- Treating multiple uploaded files as multiple images of **one** artwork (superseded: one image per artwork)
- Video, PDF, or non-image masters beyond the listed formats
- Admin retry UI for failed intakes (document as future path only)
- Choosing Vercel Blob or another temporary storage service before real TIFF testing

---

## 3. Intake fields

### 3.1 Shared batch details

Entered once per batch. Exhibition and Gallery / Venue are optional.

| Field | Notes |
| --- | --- |
| Exhibition | Optional |
| Gallery / Venue | Optional |
| Exhibition Year | Optional documentation context |
| Default Artwork Year | Copied onto new artwork cards |
| Photographer | Shared default; overridable per artwork |
| Default Medium | Controlled: blank, Monotype, Painting, or Other (with Specify default medium). Stored as the resolved value only — never the literal `Other`. Inherited by new artwork drafts. |
| Default Dimension Unit | `in` or `cm`; **default `in`** |

### 3.2 Per-artwork fields

| Field | Required | Notes |
| --- | --- | --- |
| Title | Yes* | Required unless the user explicitly checks **Missing / no known title**. That records the canonical archived title exactly `Untitled` — never `Untitled 1`, `Untitled 2026`, or `Untitled (1047)`. Inventory IDs provide uniqueness. Blank titles are **not** auto-converted to Untitled. Typing the literal title `Untitled` is also valid without the checkbox. |
| Artwork Year | Yes | Four-digit; used in filenames and Drive year folder |
| Medium | Yes | Controlled: Monotype, Painting, or Other. Common values are Monotype and Painting. Other reveals a required **Specify medium** field (e.g. Watercolor, Drawing, Mixed media). The final stored value is the resolved string — never the literal dropdown value `Other`. Existing custom values load as Other + the stored text. |
| Height / Width | No | Positive numbers when provided |
| Dimension Unit | No | `in` or `cm`; **default `in`** |
| Master image | Yes | Exactly one; TIFF, JPEG, or PNG |
| Depth | No | Positive when provided |
| Notes | No | |

### 3.3 Per-artwork overrides

Compact overrides (not shown in the main card by default):

- Exhibition
- Gallery / Venue
- Photographer

Empty override → use shared value on the final record.

### 3.4 Shared default behavior

- Newly created artwork drafts from uploaded files **inherit** current shared defaults as normal field values, including the **resolved** default medium (e.g. shared Other + “Watercolor” → artwork `medium` = `Watercolor`).
- Later edits to shared defaults do **not** silently overwrite artwork values already on cards.
- Explicit action: **Apply shared details to all artworks** lets the user choose which fields to update (Year, Medium, Dimension Unit, and optionally Exhibition / Gallery / Photographer overrides). When Medium is selected, the resolved shared medium value is applied — artwork-specific medium is left alone unless Medium is explicitly chosen.
- That action **never** overwrites Title, Height, Width, Depth, Notes, or image.
- **Apply Untitled to selected artworks** is a separate batch action. It does **not** run automatically and does **not** mark every artwork untitled. The user must select artworks. Works that already have a title are not overwritten unless the user explicitly confirms replacing those titles. The archived title is exactly `Untitled`; the previous typed/suggested title is kept in UI state so unchecking **Missing / no known title** can restore it.
- Batch review and confirmation display the resolved medium only (never the dropdown label `Other`). Review shows **Title: Untitled** for works marked missing-title — not wording such as “Missing title”. The server resolves the submitted title to exactly `Untitled` when the transient `isUntitled` flag is set. An empty browser title is not treated as untitled.

### 3.5 Untitled / unknown titles

Unknown or missing titles may be recorded explicitly as `Untitled`:

- All such artworks share the same canonical title string: `Untitled`.
- Permanent Inventory IDs provide uniqueness (and appear in filenames and folder names).
- Blank Title fields are not automatically converted to Untitled. The user must check **Missing / no known title** (or type the literal title `Untitled`).
- `isUntitled` is a transient intake/validation flag only. Google Sheets continues to store a single **Title** column.

### 3.6 Captured archive metadata

The current archive captures:

- title, year, medium, dimensions
- photographer, exhibition, gallery / venue, notes
- master / high-resolution / web filenames and URLs, artwork folder URL

Series, Edition, Status, and Location are **not** part of the active intake model or Sheet schema.

Physical location and ownership (for example when a work enters a museum or notable collection) are intentionally managed after intake in a separate Artwork Management workflow, not during new-artwork processing.

---

## 4. Google Sheet schema

**Spreadsheet:** Artwork Inventory (`GOOGLE_SHEET_ID`).

| Tab | Purpose |
| --- | --- |
| `Artwork Inventory` | One row per successfully completed artwork |
| `Inventory Claims` | Append-only inventory ID claims (see §5) |

### 4.1 Artwork Inventory columns

Column order is fixed. Shared batch metadata is copied onto each row.

| # | Column |
| --- | --- |
| 1 | Inventory ID |
| 2 | Thumbnail |
| 3 | Title |
| 4 | Year |
| 5 | Medium |
| 6 | Height |
| 7 | Width |
| 8 | Depth |
| 9 | Dimension Unit |
| 10 | Photographer |
| 11 | Exhibition |
| 12 | Gallery / Venue |
| 13 | Notes |
| 14 | Master Filename |
| 15 | Master File URL |
| 16 | High Resolution Filename |
| 17 | High Resolution File URL |
| 18 | Web Filename |
| 19 | Web File URL |
| 20 | Artwork Folder URL |
| 21 | Created At |
| 22 | Updated At |

**Medium column:** stores only the resolved medium string (Monotype, Painting, Watercolor, Mixed media, etc.). There is no second column for custom medium. The intake UI may present Monotype / Painting / Other, but Google Sheets never receives a separate “custom medium” field — Other is resolved before submission.

**Title column:** stores the artwork title, including the canonical value `Untitled` when the work has no known title. There is no `isUntitled`, “Missing title”, or similar column.

**Thumbnail column:** display-only. Intake writes `=IMAGE("direct-dropbox-url", 1)` so the cell renders the thumbnail while preserving aspect ratio. There is no Thumbnail Filename or Thumbnail URL column.

Copyable header row:

```text
Inventory ID	Thumbnail	Title	Year	Medium	Height	Width	Depth	Dimension Unit	Photographer	Exhibition	Gallery / Venue	Notes	Master Filename	Master File URL	High Resolution Filename	High Resolution File URL	Web Filename	Web File URL	Artwork Folder URL	Created At	Updated At
```

### 4.2 Filename / URL cells

With one master image per artwork, these cells normally contain a **single** value. Newline-separated multi-value support remains acceptable for forward compatibility.

### 4.3 Inventory Claims columns

| Column | Notes |
| --- | --- |
| Claim ID | Unique claim identifier for the row |
| Inventory ID | Permanent inventory number derived for this claim |
| Status | Claim lifecycle (e.g. Claimed / Completed / Failed) |
| Created At | When the claim was appended |
| Completed At | When processing finished successfully (empty if failed/incomplete) |

---

## 5. Inventory-number rules

- Inventory IDs are **meaningless sequential integers**.
- Do **not** encode year, medium, or title in the ID.
- **One inventory claim per artwork** (not one claim per batch).
- Claim the **full batch’s** inventory numbers **before** processing the first artwork.
- Use an **append-based claim** on the `Inventory Claims` tab.
- Derive the next Inventory ID from the **highest existing claimed ID** (any status), beginning at **1000**.
- A local in-process mutex serializes allocation in one Node process only — it is **not** multi-instance locking. See `docs/SUBMISSION_PIPELINE.md`.

**Local UI preview only:** temporary preview IDs follow current artwork order (`1000`, `1001`, …). These are **not** final claimed IDs. Reordering updates preview IDs and filename plans.

**Permanence:** Once claimed, an inventory number is permanent. If processing fails, mark the claim **Failed** and **leave the gap**. Do **not** reuse the ID. A retry creates a **new** claim and receives a **new** inventory ID.

---

## 6. Filename rules

**Format:**

```text
YYYY_KO_INVENTORYID_SanitizedTitle_ASSETTYPE_SEQUENCE.ext
```

**Batch workflow examples (one image → sequence always `01`):**

```text
2026_KO_1047_BlueGarden_master_01.tif
2026_KO_1047_BlueGarden_hr_01.jpg
2026_KO_1047_BlueGarden_web_01.jpg
```

Works with no known title use the same pattern with the title segment `Untitled`. Inventory IDs keep multiple untitled works unique:

```text
2026_KO_1047_Untitled_master_01.tif
2026_KO_1047_Untitled_hr_01.jpg
2026_KO_1047_Untitled_web_01.jpg
```

**Rules:**

- Separators are underscores.
- Strip spaces and unsafe filename characters from the title segment.
- Title segment is readable **PascalCase**, not a lowercase URL slug.
- `YYYY` comes from the artwork Year field.
- `KO` is a fixed artist/code prefix.
- Asset types: `master`, `hr`, `web`.
- For the current one-image-per-artwork workflow, sequence is always **`01`**.
- Master files keep the **original extension** (normalize `.jpeg` → `.jpg`).
- HR and web derivatives are always `.jpg`.
- Do **not** include photographer in the filename unless added later by deliberate decision.

---

## 7. Google Drive structure

**Root folder display name:** Kim Artwork Archive  
**Runtime root:** configured Drive root folder ID for the active archive target (never discover by name)

```text
Kim Artwork Archive/          ← archive root folder ID
  2026_KO_1000_BlueGarden/    ← one folder per artwork (direct child)
    2026_KO_1000_BlueGarden_master_01.<ext>
    2026_KO_1000_BlueGarden_hr_01.jpg
    2026_KO_1000_BlueGarden_web_01.jpg
    1000_metadata.json        ← portable archival metadata (schemaVersion 1)
  Failed Intake/              ← destination for incomplete intakes
```

- **One artwork folder per artwork**, named `YYYY_KO_INVENTORYID_SanitizedTitle` (untitled works use the title segment `Untitled`, e.g. `2026_KO_1047_Untitled`).
- Artwork folders are **flat**: master, HR JPG, web JPG, and `{inventoryId}_metadata.json` live directly in the artwork folder (no year parent folder; no `Master/` / `High Resolution/` / `Web/` subfolders).
- Sheet column **Artwork Folder URL** points at that artwork folder.
- Google Sheets remains the primary inventory database; `{inventoryId}_metadata.json` is a portable backup that travels with the folder and stays identifiable if copied outside it.

---

## 8. Image-processing and upload limits

### 8.1 Derivatives

| Output | Behavior |
| --- | --- |
| Master | Preserve original bytes; no recompression or re-encode; normalize `.jpeg`→`.jpg`, `.tiff`→`.tif` |
| High Resolution JPG | Quality **95**; preserve original pixel dimensions (after orientation); apply EXIF orientation; convert to **sRGB** where supported; flatten transparency on white; progressive JPEG; strip unnecessary metadata but embed sRGB; **never enlarge**; no sharpening |
| Web JPG | Max **2400px** on longest edge; preserve aspect ratio; **never enlarge**; quality **86**; Lanczos3 resize; mild sharpening only when resized; otherwise same color/flatten/progressive rules as HR |
| UI TIFF thumbnail | Temporary JPEG only for intake display (max **600×600**, quality ~78, page 1 only). **Not archival.** Never uploaded to Dropbox or written to Sheets. |

**Provisional:** HR quality 95 and web quality 86 / 2400px long edge are starting points pending visual testing with Kim’s actual artwork files. See `docs/IMAGE_PROCESSING.md` and `lib/images/config.ts`.

**Initial master formats:** TIFF, JPEG, PNG.

**Local milestone:** `/api/dev/process-artwork-image` processes one artwork at a time for UI preview/download of temporary derivatives. It does not claim inventory IDs or write to Drive/Sheets.

**TIFF UI previews:** `POST /api/image-preview` generates temporary JPEG thumbnails for selected TIFF masters so artwork cards and Batch Review can show an image. These thumbnails are temporary UI previews only — not archival outputs — and are discarded on replace/remove/batch reset or TTL expiry. Preview failure does not block validation or submission.

### 8.2 Product upload limits (MVP)

| Limit | Value |
| --- | --- |
| Images per artwork | Exactly **1** |
| Max size per individual file | **250 MB** |
| Max total source size per batch | **750 MB** |
| Max artworks per batch | **24** (typical working batch ~10–12) |

Batch upload creates one artwork draft per selected file. Users may add more images later; duplicates (same File object or matching name/size/lastModified) warn before adding.

Previous “5 masters / 750 MB per single-artwork intake” limits are superseded by the one-image-per-artwork batch model. Per-file **250 MB** and batch **750 MB** remain.

These are **product** limits, not proof that Vercel can accept or process them in a single request.

### 8.3 Local vs production processing

- **First local implementation:** support local processing / UI review without upload.
- **Production:** do **not** send large TIFF files through a normal Vercel server action or API request body. Final production upload must use a **direct or staged upload** approach and must be tested with representative TIFF files before deployment.
- Do **not** select Vercel Blob or another temporary storage provider in this spec yet (see §12).

---

## 9. End-to-end submission flow

1. Authenticated user uploads a batch of images (commonly ~10–12), each becoming one artwork draft, then enters shared batch details and per-artwork metadata.
2. On **Submit Batch** (after explicit confirmation), the server runs global preflight and validates the batch.
3. The server claims inventory IDs for the full batch, then for each artwork sequentially:
   1. Mark claim Processing; create Drive folder; upload master; generate + upload HR/web; append inventory row; mark claim Completed.
4. Return a batch completion report (success / failure / reconciliation per artwork).
5. Local form state and temp files are discarded when the user starts a new batch.

Ideal success criterion per artwork: claim Completed, sheet row exists, Drive files present under the artwork folder.

See `docs/SUBMISSION_PIPELINE.md` for failure isolation and reconciliation-required cases.

---

## 10. Failure and rollback expectations

Fail closed on global preflight. Avoid silent partial archives. Inventory IDs already claimed are never reused.

| Failure point | Expectation |
| --- | --- |
| Validation / preflight fails | No claims; no Drive/Sheet artwork writes |
| Per-artwork processing / Drive / Sheet fails | Continue remaining artworks; best-effort move of that artwork folder into Drive **`Failed Intake`**; mark claim **Failed**; return detailed per-artwork result |
| Sheet row written but claim Completed update fails | `reconciliation_required` — manual claim correction; do not auto-retry |

**Compensation preference:** move incomplete artwork folders to `Failed Intake` when practical. Do not auto-delete masters.

Details: `docs/SUBMISSION_PIPELINE.md`.

**Future (not in first UI):** an admin retry path for failed intakes.

---

## 11. Private access (MVP)

- Single shared password in env: `APP_ACCESS_PASSWORD` (server-only; never `NEXT_PUBLIC_`).
- After successful login, store access in a **secure, HTTP-only, SameSite=Lax** cookie. The cookie holds an HMAC session token, not the password.
- Pages, API routes, and Server Actions each verify the session. Do not rely on page redirects alone.
- If `APP_ACCESS_PASSWORD` is missing, **fail closed** (no public access), including in production.
- Keep authentication code isolated so it can later be replaced with a proper user account system.
- Do **not** use Clerk, Supabase Auth, or Auth.js for the initial build.

---

## 12. Unresolved production concern — large TIFF / Vercel limits

**Status: unresolved. Do not treat TIFF intake as production-ready because a deploy succeeded.**

Intake still POSTs the full master file through `POST /api/artwork-batches/submit`. On Vercel that is a Function request body.

Current Vercel constraints (see [Functions limitations](https://vercel.com/docs/functions/limitations)):

| Constraint | Limit | Effect on this app |
| --- | --- | --- |
| Function request/response body | **4.5 MB** (hard; not configurable) | Masters larger than ~4.5 MB return `413 FUNCTION_PAYLOAD_TOO_LARGE` before Sharp or Dropbox run |
| Function duration | Hobby 300s max; Pro default 300s, max 800s | This app sets `maxDuration = 300` on submit |
| Function memory | Hobby 2 GB; Pro up to 4 GB | Large TIFF decode in Sharp can still OOM |
| Next.js Proxy body buffer | 10 MB default if Proxy reads/clones the body | Upload APIs are **excluded** from `proxy.ts` so masters are not truncated there |

Product limits (250 MB / file, 750 MB / batch) are **not** achievable through this request path. Production-scale TIFF intake needs a direct-to-storage upload (presigned URL or similar) that never passes the master through a Vercel Function.

- Do **not** assume a normal Vercel Route Handler can receive full master binaries.
- Do **not** choose Vercel Blob or another temporary storage service yet.
- Local implementation may process files available on disk / local upload for development.
- Decide production upload architecture **after** testing representative master files (especially large TIFFs) against the target runtime.

---

## 13. Future Notion extension point

A later **optional** step may create a Notion database entry per artwork, using the **web JPG** as a preview image.

- Notion is **not** authoritative.
- Google Sheets and Google Drive remain the source of truth.
- Notion must not be required for a successful intake.

---

## 14. Environment variables (initial set)

| Variable | Purpose |
| --- | --- |
| `APP_ACCESS_PASSWORD` | Shared MVP app password (required; fail closed if missing) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email |
| `GOOGLE_PRIVATE_KEY` | Service account private key (PEM; `\n` normalized) |
| `GOOGLE_SHEET_ID` | Production Artwork Inventory spreadsheet ID |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Production Kim Artwork Archive root folder ID |
| `ARTWORK_SUBMISSION_TARGET` | `test` or `production` |
| `GOOGLE_TEST_SHEET_ID` | Test spreadsheet ID (required when target is `test`) |
| `GOOGLE_TEST_DRIVE_ROOT_FOLDER_ID` | Test Drive root ID (required when target is `test`) |

---

## 15. Submission algorithm documentation

The claim/append algorithm, mutex limitations, failure isolation, and test/production targets are documented in **`docs/SUBMISSION_PIPELINE.md`**.
