# Artwork Archive

`/artworks` is a **visual, read-only** view of completed work.

It is not a second catalog. It does not store artwork records, sync them, or publish them.

## Sources of truth

| Role | System |
| --- | --- |
| Artwork metadata catalog | Google Sheets tab **Artwork Inventory** |
| Permanent artwork files | Dropbox (default) or legacy Google Drive |

The app never duplicates inventory rows into a database, and it does not write to Notion.

## How a work appears

1. A successful **New Artwork Batch** submission writes one Artwork Inventory row (and stores files in Dropbox).
2. Refresh `/artworks`.
3. That row is read from the live Sheet and shown in the archive.

There is no “Publish to Archive” step and no app-side archive cache. Every page load re-reads Google Sheets.

## Pages

| Route | Purpose |
| --- | --- |
| `/artworks` | Year-grouped visual grid of completed works |
| `/artworks/[inventoryId]` | Read-only detail for one Inventory ID |

Inventory ID is the permanent numeric identifier from the Sheet (for example `1004`). The archive does not invent a second ID format.

The detail page is read-only for now. A future Artwork Management form will extend this route.

Archive pages require the shared app password (`APP_ACCESS_PASSWORD`). Unauthenticated requests are redirected to `/login`. Delete is a Server Action and verifies the same session cookie independently.

## Images and files

- Grid and detail **previews** use only the **Web File URL** (web JPG).
- The Artwork Inventory **Thumbnail** column is a Sheets display formula for browsing the spreadsheet. The `/artworks` gallery does not read that column.
- Master and high-resolution files are never loaded into the gallery.
- The Sheet stores Dropbox **shared** URLs. The archive derives a separate display URL for `<img>` rendering and does not rewrite the stored value.
- If a web preview cannot be shown, the card still appears with an “Image unavailable” placeholder.
- File actions on the detail page (**View image folder in Dropbox**, **Master File**, **High Resolution File**, **Web File**) open the **canonical stored** shared links.

## Minimum row to display

A Sheet row is shown only when it has:

- a valid Inventory ID
- Title
- Year

Blank rows are ignored. A malformed row is skipped with a safe warning; it does not take down the rest of the archive. Duplicate Inventory IDs are omitted from the grid, and the detail route reports the conflict instead of picking a row at random.

## Search

On `/artworks`, search filters the visible grid across title, Inventory ID, year, medium, exhibition, and gallery / venue.

## If the archive cannot load

The page does not expose Google credentials or raw API errors. Use **Archive Setup** (`/setup/archive`) to confirm the Sheet is connected.
