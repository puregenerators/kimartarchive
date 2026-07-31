# Google Setup — Kim Artwork Archive

How to connect this app to Google Sheets (and legacy Drive tooling) using a service account.

**Archive roles**

- **Google Sheets** — permanent artwork **metadata** store
- **Dropbox** — permanent artwork **file** archive (see `docs/DROPBOX_SETUP.md`)

Google Drive remains available as **legacy file storage** when `ARTWORK_STORAGE_PROVIDER=drive`. With the default Dropbox backend, `GOOGLE_DRIVE_ROOT_FOLDER_ID` is optional. New archive setup lives at `/setup/archive`.

**Never commit** the downloaded JSON key file, `.env`, or `.env.local`.

---

## 1. Enable Google APIs

In [Google Cloud Console](https://console.cloud.google.com/) for your project:

1. Enable **Google Sheets API**
2. Enable **Google Drive API**

---

## 2. Create a service account

1. Open **IAM & Admin → Service Accounts**
2. Create a service account (name is arbitrary, e.g. `kim-artwork-archive`)
3. Create a JSON key for that account and download it
4. Note the service account email (`…@….iam.gserviceaccount.com`)

You will copy values into `.env.local` — not into the repo.

---

## 3. Share Sheet (and Drive folder only for legacy Drive storage)

Share with the **service account email** (Editor):

1. **Spreadsheet** “Artwork Inventory” — **always required**
2. **Drive folder** “Kim Artwork Archive” — **only when** `ARTWORK_STORAGE_PROVIDER=drive`

With the default Dropbox file backend, you do **not** need to share a Drive archive root for submission. Drive API remains enabled so the service account can read Sheet file capabilities.

**Important — Shared Drive vs My Drive (legacy Drive storage only):** Prefer a **Shared Drive** (content manager / manager) as the archive root. Service accounts have **no storage quota** of their own. Sharing a personal My Drive folder as Editor lets the service account create empty folders and move them, but **file uploads** often fail with `storageQuotaExceeded` (HTTP 403). That is not a missing-share problem.

If sharing is missing, diagnostics will report access denied even when IDs are correct.

---

## 4. Find Sheet and folder IDs

**Spreadsheet ID** — from the Sheet URL:

```text
https://docs.google.com/spreadsheets/d/THIS_IS_THE_SHEET_ID/edit
```

**Drive folder ID** — from the folder URL:

```text
https://drive.google.com/drive/folders/THIS_IS_THE_FOLDER_ID
```

Use the folder ID directly in env. The app does **not** search Drive by folder name.

---

## 5. Required `.env.local` variables

Copy `.env.example` to `.env.local` (preferred for local secrets) or `.env`:

```bash
# Always required — Google Sheets metadata + service-account auth
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=your_spreadsheet_id

# Legacy Drive file storage only — required when ARTWORK_STORAGE_PROVIDER=drive.
# Optional / unused when Dropbox is the artwork storage provider (default).
GOOGLE_DRIVE_ROOT_FOLDER_ID=your_folder_id

# Archive target: production (default) or test
ARTWORK_SUBMISSION_TARGET=production
GOOGLE_TEST_SHEET_ID=
# Required for test target only when ARTWORK_STORAGE_PROVIDER=drive
GOOGLE_TEST_DRIVE_ROOT_FOLDER_ID=
```

Notes:

- Prefer `.env.local` (gitignored).
- Private keys often need literal `\n` sequences in a single-line env value; the app normalizes them to real newlines.
- Never use `NEXT_PUBLIC_` for these values.
- Restart `npm run dev` after changing env files.
- Google Sheets credentials remain required in both Dropbox and Drive storage modes.
- `GOOGLE_DRIVE_ROOT_FOLDER_ID` is **optional in Dropbox mode** and **required only for legacy Drive storage** (`ARTWORK_STORAGE_PROVIDER=drive`).
- When `ARTWORK_SUBMISSION_TARGET=test`, `GOOGLE_TEST_SHEET_ID` is required. `GOOGLE_TEST_DRIVE_ROOT_FOLDER_ID` is required only with Drive storage. The app **never** silently falls back to production IDs.
- Permanent submission writes to the active archive target. See `docs/SUBMISSION_PIPELINE.md`.

Optional later (not required for Google setup):

```bash
APP_ACCESS_PASSWORD=
```

---

## 6. Create required Sheet tabs manually

Create these tabs in the spreadsheet if they do not exist:

- `Artwork Inventory`
- `Inventory Claims`

The app **will not** silently create missing tabs. It can initialize **blank** header rows after you confirm on the diagnostic page.

---

## 7. Run the diagnostic page

Primary archive status (Sheets + Dropbox):

```text
http://localhost:3000/setup/archive
```

Google Sheets header / Drive tooling:

```text
http://localhost:3000/setup/google
```

The Google tools page checks (server-side):

- Which env vars are present (not their values)
- Whether Drive root is required for the active `ARTWORK_STORAGE_PROVIDER`
- Which archive submission target is active (`test` / `production`) without displaying IDs
- Spreadsheet connection and title
- Effective permission level on the spreadsheet (Editor / Viewer / Unknown)
- Presence of required tabs and header status
- Drive root folder access (when Drive storage is active, or when a Drive root ID is set for tooling)
- Effective permission level on the Drive root folder (Editor / Viewer / Unknown)
- Whether a child folder named `Failed Intake` exists

**Overall Status** is Ready when required env vars are valid and Google Sheets is connected with **Editor** access. Legacy Drive Editor access is also required when `ARTWORK_STORAGE_PROVIDER=drive`. Setup actions stay disabled without Editor access on the resources they touch.

Permission level is inferred from Drive file `capabilities` (read-only metadata). No write probes are used.

Explicit confirmed actions:

1. Initialize blank header rows for a tab
2. Create the `Failed Intake` folder under the Drive root

---

## 8. Common permission errors

| Symptom | Likely cause |
| --- | --- |
| Missing env vars | `.env.local` incomplete; restart dev server |
| Auth failure / malformed key | Private key paste broken; check BEGIN/END lines and `\n` normalization |
| Sheet access denied | Spreadsheet not shared with the service account email |
| Sheet Viewer / Read-only (Incomplete) | Spreadsheet shared as Viewer; re-share as Editor |
| Sheet not found | Wrong `GOOGLE_SHEET_ID` |
| Drive access denied | Folder not shared with the service account (Editor) |
| Drive Viewer / Read-only (Incomplete) | Folder shared as Viewer; re-share as Editor |
| Drive not found | Wrong `GOOGLE_DRIVE_ROOT_FOLDER_ID` |
| Drive not a folder | ID points to a file instead of a folder |
| Tab missing | Create the tab name exactly in the spreadsheet |

---

## 9. Security warnings

- Do **not** commit service-account JSON keys.
- Do **not** commit `.env` / `.env.local`.
- Do **not** expose credentials via `NEXT_PUBLIC_*`.
- Do **not** log private keys, tokens, or full credential objects.
- `/setup/google` and `/setup/archive` are local development tooling; add auth before any public deployment.
- Do not confuse Sheets (metadata) with Dropbox (files). Both must be ready for a complete archive.
