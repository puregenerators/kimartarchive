# Kim Artwork Archive

Private intake and browse app for the Kim Artwork Archive.

**Authoritative systems**

- **Google Sheets** (`Artwork Inventory`) — artwork metadata
- **Dropbox** — permanent artwork files

The app is not a database. Successful intake writes a Sheet row; `/artworks` reads that Sheet on every load.

## App routes

| Route | Purpose |
| --- | --- |
| `/artworks` | Visual, read-only artwork archive |
| `/artworks/[inventoryId]` | Read-only artwork detail |
| `/new-artwork` | New artwork batch intake |
| `/setup/archive` | Google Sheets + Dropbox setup |
| `/login` | Shared-password gate |

The app is private. `APP_ACCESS_PASSWORD` must be set; production fails closed if it is missing. After login, a secure HTTP-only cookie remembers access. Pages, APIs, and server actions all verify that session independently.

Large TIFF intake uploads masters **directly to Dropbox** (150 MB maximum per temporary upload link). Larger masters use authenticated **large-file intake**: the app claims an inventory ID, reserves the folder, and waits for a Dropbox desktop or dropbox.com upload. See `docs/SUBMISSION_PIPELINE.md`.

## Docs

- [Artwork Archive](docs/ARTWORK_ARCHIVE.md)
- [Artwork Intake Spec](docs/ARTWORK_INTAKE_SPEC.md)
- [Submission Pipeline](docs/SUBMISSION_PIPELINE.md)
- [Google Setup](docs/GOOGLE_SETUP.md)
- [Dropbox Setup](docs/DROPBOX_SETUP.md)
- [Image Processing](docs/IMAGE_PROCESSING.md)
