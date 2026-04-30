# Changelog

## 1.2.3 - Job log scroll preservation

### Fixed

- Job refresh now updates existing job cards in place instead of rebuilding the whole list.
- Log scroll position is preserved during automatic and manual refreshes.
- Logs auto-follow only when the viewer is already at the bottom.

## 1.2.2 - Szurubooru JSON accept header

### Fixed

- Szurubooru API requests now send `Accept: application/json`, fixing `406 Not Acceptable` responses from endpoints such as `/api/tag-categories`.

## 1.2.1 - e621 rate limit backoff

### Added

- Retry/backoff handling for e621 search requests returning 429 or 503.
- Configurable e621 paging delay through `E621_PAGE_DELAY_MS`.
- Configurable retry behavior through `E621_RETRY_COUNT` and `E621_RETRY_BASE_MS`.
- Query-import logs now show each e621 search page being loaded.
- README now explicitly documents rule34.xxx support and its pool limitation.

### Fixed

- Large `fav:<user>` query imports are less likely to abort during search paging due to e621 rate limiting.

## 1.2.0 - rule34.xxx support

### Added

- rule34.xxx config support with optional `RULE34_USER_ID` and `RULE34_API_KEY`.
- rule34.xxx search tab.
- rule34.xxx single-post import into Szurubooru.
- rule34.xxx full-query import.
- rule34.xxx parent/child family import where parent metadata is available.
- rule34.xxx post download to `/data/downloads/rule34`.

### Notes

- rule34.xxx does not expose the same pool API as e621, so e621 pool import, pool download, and pool sync remain e621-only.

## 1.1.3 - Job display improvements

### Added

- Jobs now include structured `details` metadata such as query, post ID, pool ID, URL, or file count.
- Jobs write an initial log entry immediately after creation.
- MIT license file and package metadata.

### Fixed

- Running jobs without a result no longer show `null` in the UI.
- Job cards now show details, logs, and results separately.

## 1.1.2 - Prebuilt image workflow

### Added

- GitHub Actions workflow to build and publish a multi-arch image to GitHub Container Registry.
- `compose.yaml` now uses a prebuilt image by default so Compose runners do not need to build locally.
- `compose.build.yaml` keeps the local-build variant for development.

### Changed

- `.env.example` includes the `IMAGE` variable used by the pull-only Compose setup.

## 1.1.1 - Container runtime cleanup

### Changed

- Container now starts `node web/server.js` directly instead of going through `npm start`.
- Compose port mapping is configurable with `HOST_PORT` and `APP_PORT`.
- Compose comments are generic Docker-oriented text.

### Fixed

- Avoids noisy npm `SIGTERM` error logs when the container is stopped or recreated.

## 1.1.0 - Docker web feature parity update

### Added

- e621 pool downloads to `/data/downloads`.
- e621 single-post downloads.
- e621 parent/child family import with Szurubooru relations.
- Full e621 query import.
- Favorite sync support through `fav:<user>` queries.
- Bulk upload tab for local files.
- Shared bulk upload metadata: tags, safety, source, relations, optional pool.
- Duplicate scan by Szurubooru `checksum` and `checksumMD5`.
- Pool sync for imported `comic_<e621id>_...` pools.
- Pool sync can import missing posts and update pool order.
- Additional `Bulk` and `Tools` UI tabs.

### Changed

- README now documents a generic Docker environment instead of a host-specific setup.
- GitHub package docs now avoid host-specific paths and credentials.
- Runtime data remains under `/data` with a Docker named volume by default.

### Verified

- `web/server.js` syntax check passes.
- `public/app.js` syntax check passes.
- Basic `/api/config` smoke test passes.

## 1.0.0 - Initial Docker web app

### Added

- Dockerfile and Compose setup.
- Browser UI for e621 search.
- e621 post and pool import into Szurubooru.
- Reddit post and gallery import into Szurubooru.
- Web-based configuration page.
- Job log page for long-running imports.
