# Changelog

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
