# Dropbox Setup — Kim Osgood Archive

How to connect this local archive app to Dropbox with OAuth (offline refresh token).

**Roles**

- **Google Sheets** — permanent artwork metadata
- **Dropbox** — permanent artwork file archive (App Folder)

**Never commit** `.env`, `.env.local`, or `.data/dropbox-credentials.json`.

Do not use `NEXT_PUBLIC_` for Dropbox secrets.

---

## 1. Create a Dropbox app

1. Open the [Dropbox App Console](https://www.dropbox.com/developers/apps)
2. Create an app
3. Choose **Scoped access**
4. Choose **App folder** (not Full Dropbox)
5. Name the app **Kim Art Archive** (or similar)

The App Folder appears in Dropbox as:

```text
Apps/Kim Art Archive/
```

This app only sees that folder. Diagnostics and future uploads use paths relative to that root.

---

## 2. Required scopes

In the app’s **Permissions** tab, enable at least:

| Scope | Purpose |
| --- | --- |
| `account_info.read` | Account display name / email |
| `files.metadata.read` | List App Folder |
| `files.metadata.write` | Create folders |
| `files.content.write` | Upload / delete files |
| `files.content.read` | Read files when needed |
| `sharing.write` | Create shared links |
| `sharing.read` | Read existing shared links |

Submit permission changes if the console requires it, then reconnect OAuth so the new scopes are granted.

The authorize URL requests these scopes explicitly.

---

## 3. Redirect URI

In the Dropbox app **OAuth 2** settings, add:

```text
http://localhost:3000/api/auth/dropbox/callback
```

Must match `DROPBOX_REDIRECT_URI` exactly.

---

## 4. Environment variables

Copy `.env.example` values into `.env.local` (preferred) or `.env`:

```bash
DROPBOX_APP_KEY=your_app_key
DROPBOX_APP_SECRET=your_app_secret
DROPBOX_REDIRECT_URI=http://localhost:3000/api/auth/dropbox/callback
```

Notes:

- Server-only. Never expose via `NEXT_PUBLIC_*`.
- Restart `npm run dev` after changing env files.
- App key / secret come from the Dropbox app settings page.

**Google (still required for metadata)**

Dropbox is the default artwork **file** store. Google Sheets remains the permanent **metadata** store. You still need:

```bash
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY=...
GOOGLE_SHEET_ID=...
```

You do **not** need `GOOGLE_DRIVE_ROOT_FOLDER_ID` for Dropbox-mode submission. That variable is required only for legacy Drive file storage (`ARTWORK_STORAGE_PROVIDER=drive`). See `docs/GOOGLE_SETUP.md`.

`ARTWORK_STORAGE_PROVIDER` defaults to `dropbox` when unset. Set it to `drive` only to use the legacy Drive provider.

---

## 5. OAuth flow

1. Open [Archive Setup](http://localhost:3000/setup/archive)
2. Click **Connect Dropbox**
3. Browser goes to `GET /api/auth/dropbox/connect`
4. App generates a CSRF `state`, stores it in an **HttpOnly cookie** (not credentials), and redirects to Dropbox with:
   - `response_type=code`
   - `token_access_type=offline`
   - configured `scope`
5. After consent, Dropbox redirects to `GET /api/auth/dropbox/callback`
6. App verifies `state`, exchanges the code for:
   - short-lived **access token**
   - long-lived **refresh token**
   - account id
7. App loads account profile (display name, email)
8. Refresh token + account metadata are written to local server storage
9. User returns to `/setup/archive` with a success or failure message

**Never** put access or refresh tokens in URLs, cookies (except ephemeral CSRF state), localStorage, or logs.

---

## 6. Refresh tokens

Dropbox access tokens expire quickly.

This app:

1. Loads a **refresh token** from local `.data/dropbox-credentials.json` (dev) or `DROPBOX_REFRESH_TOKEN` (Vercel)
2. Keeps the access token **in memory only**
3. On expiry / HTTP 401, silently calls `/oauth2/token` with `grant_type=refresh_token`
4. Retries the Dropbox request once

Locally you should not need to log in again unless the refresh token is revoked or deleted.

On **Vercel**, OAuth Connect cannot persist to disk. Connect once on your machine, then copy values from `.data/dropbox-credentials.json` into the Vercel project environment (see below).

---

## 7. Credential storage

### Local development

Path (under the project working directory):

```text
.data/dropbox-credentials.json
```

Contains:

- `refreshToken`
- `accountId`
- `displayName`
- `email`
- `connectedAt`

This directory is gitignored. File mode is set to `0600` when the OS allows it.

### Vercel / production

Set these **server-only** env vars on the Vercel project (never `NEXT_PUBLIC_`):

| Variable | Required | Notes |
| --- | --- | --- |
| `DROPBOX_REFRESH_TOKEN` | Yes | From local `.data/dropbox-credentials.json` |
| `DROPBOX_ACCOUNT_ID` | Recommended | Shown in Archive Setup |
| `DROPBOX_ACCOUNT_DISPLAY_NAME` | Optional | Defaults to `Dropbox (env)` |
| `DROPBOX_ACCOUNT_EMAIL` | Optional | |
| `DROPBOX_REDIRECT_URI` | Yes | Production callback, e.g. `https://YOUR_DOMAIN/api/auth/dropbox/callback` |

Also add the production redirect URI in the Dropbox App Console (OAuth 2 settings).

**Do not** store Dropbox tokens in:

- browser `localStorage`
- cookies (except short-lived OAuth `state`)
- client React state
- `NEXT_PUBLIC_*` env vars

---

## 8. Archive Setup page

```text
http://localhost:3000/setup/archive
```

Shows:

- Overall status (green only if Google Sheets **and** Dropbox pass)
- Google Sheets connection
- Dropbox connection / account / archive folder / permission test
- Connect / Reconnect / Disconnect / Run Diagnostics / Run Dropbox Upload Test

Diagnostics verify:

1. Refresh token exists
2. Access token refresh succeeds
3. Account lookup succeeds
4. App Folder root is listable
5. Diagnostics folder can be created
6. A temporary file can be uploaded
7. That temporary file can be deleted

Probes use `/.kimartarchive-diagnostics` inside the App Folder. Artwork paths are not modified.

**Run Dropbox Upload Test** exercises create/upload/metadata/shared-link/download/delete against a temporary `Integration Test` folder, then removes that folder. It does not write artwork archive content.

---

## 9. Revoking access

**From this app**

- Local: **Disconnect** on Archive Setup deletes `.data/dropbox-credentials.json` and clears the in-memory access token.
- Vercel: remove `DROPBOX_REFRESH_TOKEN` (and optional `DROPBOX_ACCOUNT_*`) from the project environment, then redeploy.

**From Dropbox**

- https://www.dropbox.com/account/connected_apps — disconnect **Kim Art Archive**

After Dropbox-side revoke, refresh will fail until you **Reconnect**.

---

## 10. Reconnecting

Use **Reconnect** (or **Connect Dropbox** when disconnected). Completing OAuth overwrites the stored refresh token and account metadata.

---

## 11. Security warnings

- Do not commit `.data/` or env files with secrets.
- Do not log access tokens, refresh tokens, or the app secret.
- Do not return tokens from API routes or Server Actions to the browser.
- This app is gated by a shared password (`APP_ACCESS_PASSWORD`) and an HTTP-only session cookie. Missing password fails closed.
