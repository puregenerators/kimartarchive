# Artwork Batch Submission Pipeline

This app is a **temporary processing and delivery tool**. After a successful submission:

- permanent files live in **Dropbox** (default storage backend; legacy Google Drive remains available via `ARTWORK_STORAGE_PROVIDER=drive`), including a portable `{inventoryId}_metadata.json` beside each artwork’s images
- permanent inventory metadata also lives in **Google Sheets** (primary database)
- `/artworks` is a visual read-only layer over that Sheet (see `docs/ARTWORK_ARCHIVE.md`); the app does not store a second copy of artwork records
- temporary local image files and form state are **disposable**
- the app is **not** a database

Notion dashboard publishing is planned but **not implemented**.

---

## Endpoint

Production intake uses JSON routes. Master bytes never enter a Vercel Function body.

| Route | Body | Purpose |
| --- | --- | --- |
| `POST /api/artwork-batches/prepare` | JSON metadata + declared file sizes | Preflight, claim inventory IDs, reserve Dropbox folders |
| `POST /api/artwork-batches/upload-link` | JSON path / type / size | Mint a short-lived Dropbox temporary upload link (`mode=add`) |
| Browser | octets to the Dropbox link | Upload the master directly to Dropbox (≤ 150 MB) |
| `POST /api/artwork-batches/process` | JSON metadata + Dropbox path | Download master to `/tmp`, generate derivatives, upload, append Sheet |

`POST /api/artwork-batches/submit` remains as a legacy multipart path for small local scripts. It is disabled on Vercel (`403`) so master bytes cannot pass through a function request body. The intake UI does not send master bytes there.

The server regenerates inventory IDs, filenames, folder names, Dropbox URLs, and derivatives. It does **not** trust preview inventory IDs or client-planned filenames.

Artwork metadata in the submission payload and inventory row covers title, year, medium, dimensions, photographer, exhibition, gallery / venue, notes, and file/folder links. Medium is a single resolved string (Monotype, Painting, or a specific custom value such as Watercolor) — the intake UI may offer an Other choice, but the payload and Sheet row never store the literal word `Other` unless the user intentionally typed it as the custom value (which validation rejects). Series, Edition, Status, and Location are not collected or written during intake. Current physical location and ownership belong in a later Artwork Management workflow.

---

## Global preflight

Before claiming any inventory IDs or creating Sheet / storage artwork resources, the server verifies:

**Always (both storage providers)**

1. Google Sheets service-account env vars are valid (`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`)
2. Archive target resolves (`test` or `production`) without silent fallback — Sheet ID for the target is required
3. Spreadsheet is reachable; `Artwork Inventory` and `Inventory Claims` tabs exist
4. Both header rows **exactly** match expected schemas
5. Service account has Editor access on the Sheet
6. Complete batch passes **server-side** validation (count ≤ 24, ≤ 150 MB/file, ≤ 750 MB total, one valid image per artwork)

**Dropbox storage (default)** — additionally:

7. Dropbox is connected and App Folder archive operations are ready (`Failed Intake` ensured under the App Folder)

Dropbox mode does **not** require `GOOGLE_DRIVE_ROOT_FOLDER_ID` and does **not** run Drive root folder permission checks.

**Legacy Drive storage** (`ARTWORK_STORAGE_PROVIDER=drive`) — additionally:

7. `GOOGLE_DRIVE_ROOT_FOLDER_ID` (and test Drive root when target is `test`) is present
8. Configured Drive item is a folder with Editor access
9. `Failed Intake` exists under the Drive archive root

Unsupported `ARTWORK_STORAGE_PROVIDER` values fail closed with a clear configuration error.

If preflight fails: create nothing, claim nothing, return one safe batch-level error.

---

## Inventory claim allocation

Uses the `Inventory Claims` tab as the permanent ledger.

Headers: `Claim ID` | `Inventory ID` | `Status` | `Created At` | `Completed At`

Statuses: `Claimed` → `Processing` → `Completed` | `Failed`

Algorithm:

1. Acquire the **in-process mutex**
2. Read all existing Inventory ID values (any status)
3. Next ID = `max(existing, 999) + 1` (first ID is **1000**)
4. Allocate sequential IDs for the full batch size
5. Append all new claim rows in one operation (`Status=Claimed`)
6. Release the mutex
7. Process artworks sequentially

Rules:

- Never reuse an ID
- Failed submissions leave permanent gaps
- Never delete or renumber claims
- Claim the **full batch** before processing the first artwork

### Local mutex limitations

`inventoryAllocationMutex` only serializes concurrent submissions inside **one Node process**.

It does **not** protect against:

- two computers
- two `next dev` / server instances
- multiple replicas

Google Sheets does **not** provide database-grade locking. Production allocation therefore:

1. Takes the in-process mutex
2. Creates `/_system/inventory-allocation.lock` with Dropbox `mode=add` (atomic; stale locks older than 30s may be stolen)
3. Reads claims, appends the new rows, then **re-reads**
4. If an inventory ID appears twice, the later row is repaired to `max+1` and re-checked
5. Releases the Dropbox lock

Retry of a **Processing** or **Claimed** claim reuses that inventory ID. Failed and Completed IDs are never reused.

---

## Sequential artwork processing

Order per artwork (direct-to-Dropbox path):

1. Mark claim `Processing`
2. Reserve artwork folder (reuse on retry if it already belongs to this claim)
3. Browser uploads the master to a path-bound Dropbox temporary upload link (`mode=add`)
4. Server downloads the master from Dropbox to a unique file-backed temp directory
5. Generate HR, then web, then thumbnail sequentially from one decoded master pixel buffer (settings unchanged; thumbnail is produced from the original source, not from the HR or web JPEG)
6. Upload HR, web, and thumbnail JPGs
7. Generate and upload portable `{inventoryId}_metadata.json`
8. Append one complete `Artwork Inventory` row only if that inventory ID does not already have a row
9. Mark claim `Completed`
10. Delete temporary local files (success and failure)

If derivative generation fails after the master exists in Dropbox, the claim stays **Processing** so the same inventory ID can be retried. The master is not overwritten (`mode=add`). Derivative JPEGs may be overwritten on retry.

Do **not** append the inventory row until all four image files and the metadata file exist.

Artwork folder layout (flat under root — no year subfolder, no Original/Derivatives subfolders):

```text
Kim Artwork Archive/
└── 2026_KO_1000_BlueGarden/
    ├── 2026_KO_1000_BlueGarden_master_01.tif
    ├── 2026_KO_1000_BlueGarden_hr_01.jpg
    ├── 2026_KO_1000_BlueGarden_web_01.jpg
    ├── 2026_KO_1000_BlueGarden_thumb_01.jpg
    └── 1000_metadata.json
```

`{inventoryId}_metadata.json` is a UTF-8 portable archival record (`schemaVersion: 1`) that travels with the folder. The Inventory ID in the filename keeps the file identifiable if it is copied or downloaded outside its folder. Google Sheets remains the primary inventory database; the JSON file enables future Sheet rebuilds, DAM/CMS migration, and restore if the spreadsheet is lost.

Folder name: `YYYY_KO_INVENTORYID_SanitizedTitle`

Files are never made public; inherited storage permissions are preserved.

Before creating a folder, the server checks for an exact-name direct child. If it exists: conflict → mark claim `Failed` → continue to next artwork → retain the inventory ID.

---

## Failure isolation

One artwork failure does **not** stop later artworks.

| Situation | Behavior |
| --- | --- |
| Failure before folder exists | Mark claim `Failed`; continue |
| Failure after folder exists | Best-effort move folder to `Failed Intake`; mark claim `Failed`; retain resource IDs; continue |
| Move to Failed Intake also fails | Leave folder in place; report primary failure **and** cleanup failure |
| Images uploaded, metadata file upload fails | Do not append inventory row; preserve claim ID, folder, and image files; mark claim `Failed`; report `upload_metadata` as the failed operation |
| Images + metadata uploaded, Sheet append fails | Move folder to Failed Intake; mark claim `Failed`; report files exist without inventory row |
| Sheet append succeeds, claim Completed update fails | Return `reconciliation_required` (not a normal failure); storage files + Sheet row exist; claim needs manual correction; do not auto-retry |
| Marking claim Failed itself fails | Include reconciliation warning; preserve original failure |

Do not automatically delete uploaded files.

---

## Reconciliation-required scenarios

1. **Inventory row written, claim not Completed** — Drive files + Sheet row exist; fix claim status manually.
2. **Claim mark-Failed failed after a primary error** — primary failure details preserved plus warning.
3. Prefer manual inspection of Inventory Claims / Failed Intake over blind resubmit.

---

## Duplicate submission-attempt protection

- Client creates one stable attempt ID immediately before confirmation.
- Server rejects reuse of the same ID within a local in-memory TTL (~6 hours).
- Restarting the app **clears** this protection.
- Not a database-backed idempotency system.
- UI disables Submit while a request is active and never auto-retries the whole batch.

---

## Temporary-file cleanup

- Submission temps live under `os.tmpdir()` (`kimartarchive-submit-*`), never inside the repository.
- Each artwork gets a subdirectory; temps are removed after that artwork succeeds or fails.
- The batch temp root is removed when the request finishes.
- Browser object URLs and `File` references are cleared only when the user chooses **Start New Batch** / reset (completion result stays in page state until then).

---

## Test vs production archive targets

| Variable | Purpose |
| --- | --- |
| `ARTWORK_SUBMISSION_TARGET` | `test` or `production` (default `production`) |
| `GOOGLE_TEST_SHEET_ID` | Required when target is `test` |
| `GOOGLE_TEST_DRIVE_ROOT_FOLDER_ID` | Required when target is `test` **and** `ARTWORK_STORAGE_PROVIDER=drive` |

- Test mode **never** falls back to production IDs.
- Filenames/metadata are **not** prefixed with `TEST`; the archive target distinguishes environments.
- Diagnostics show which target is active without displaying IDs.
- Same service account may be used; Sheet (and Drive, when used) resources must differ from production.
- Google Sheets credentials remain required in both Dropbox and Drive modes. `GOOGLE_DRIVE_ROOT_FOLDER_ID` is optional in Dropbox mode.

---

## Google API retries

Conservative retries only for clearly transient failures (5xx / rate limits):

- limited attempts + exponential backoff
- **do not** blindly retry Sheet row appends
- **do not** blindly retry Drive folder creation without an exact-name existence check

Favor reconciliation warnings over duplicate data.

---

## Audit logging

Structured server logs include: submission-attempt ID, artwork stable ID, inventory ID, claim ID, stage transitions, `lastCompletedStage`, `failedOperation` / `nextOperation`, created Google resource IDs, safe error codes, normalized error codes, Google HTTP status / reason when available, outcomes.

An `intake_timings` log line records approximate milliseconds for master read/decode, HR / web / thumbnail generation, Dropbox master upload, Dropbox derivative uploads, Sheets append, and total intake. These are server/dev diagnostics only and are not written as artwork metadata.

Failure responses separate **last completed stage** from **failed operation**. Example: folder created then master upload rejected → `lastCompletedStage=folder_created`, `failedOperation=upload_master` (never `master_uploaded` unless the master file exists in Drive). Concurrent derivative generation or upload failures still name the specific operation (`generate_thumbnail`, `upload_hr`, `upload_web`, or `upload_thumb`).

Never log: private keys, tokens, credentials, image bytes, derivative buffers, raw multipart bodies.

---

## First controlled live-test procedure

1. Set `ARTWORK_SUBMISSION_TARGET=test` with dedicated test Sheet + Drive root (shared as Editor with the service account).
2. Initialize headers and `Failed Intake` via `/setup/google` against those test resources (or mirror setup manually).
3. Confirm diagnostics show **TEST** target and Editor access.
4. Submit a **1-artwork** batch with a small JPEG.
5. Verify: one claim Completed, one inventory row, one artwork folder with four image files plus `{inventoryId}_metadata.json`, no public permissions changes.
6. Submit a deliberate failure case (e.g. conflict by pre-creating the folder name) and confirm Failed claim + Failed Intake move.
7. Only then try a small multi-artwork batch.
8. Do not point `ARTWORK_SUBMISSION_TARGET=production` until test results are reviewed.

---

## Production hosting limits (Vercel)

The intake UI uploads masters **directly to Dropbox**. Vercel Functions receive JSON only.

| Constraint | Current production | Consequence |
| --- | --- | --- |
| Request body | **4.5 MB** (JSON only on the new path) | Masters never pass through a Function body |
| Duration | `maxDuration = 300` on the process route (Hobby maximum) | One large TIFF should finish; a 24-artwork batch is sequential and can still time out |
| Memory | Hobby default **2 GB** (not configurable) | Measured Sharp RSS ~643 MB for a 56 MB / 20 MP TIFF is within this budget if derivatives encode sequentially from a file-backed download |

A successful deploy still does not prove every archive TIFF will process. 16-bit or ~200 MP files can exceed 2 GB. Files over **150 MB** are rejected until Dropbox upload-session support exists.

API JSON routes still verify the access cookie themselves. Temporary upload links are path-bound and short-lived; Dropbox access and refresh tokens stay server-only.

---

## Related docs

- `docs/ARTWORK_INTAKE_SPEC.md` — product/spec overview
- `docs/GOOGLE_SETUP.md` — credentials and sharing
- `docs/IMAGE_PROCESSING.md` — Sharp derivative settings
