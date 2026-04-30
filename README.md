# Szurubooru Tools Web

Docker web interface for importing e621 and Reddit media into Szurubooru.

The app is a small dependency-free Node.js service with a browser UI. It does not require a database. Configuration, downloaded files, and runtime data are stored under `/data` inside the container.

## Features

- Search e621 by artist tag or arbitrary query
- Show search results grouped by pools, videos, and all posts
- Import single e621 posts into Szurubooru
- Import complete e621 pools into Szurubooru
- Create or update Szurubooru pools for imported e621 pools
- Download e621 posts and pools to `/data/downloads`
- Import e621 parent/child families and link them as relations
- Import complete e621 queries, including `fav:<user>` favorite sync queries
- Import Reddit posts, videos, and galleries into Szurubooru
- Create basic Reddit tags automatically
- Link Reddit gallery uploads as relations
- Bulk upload local files with shared tags, safety, source, relations, and optional pool assignment
- Scan Szurubooru for duplicates by `checksum` and `checksumMD5`
- Sync imported `comic_<e621id>_...` pools by importing missing posts and updating order
- Track running and completed jobs in the web UI
- Configure credentials through the web UI or environment variables

## Requirements

- Docker
- Docker Compose
- A reachable Szurubooru instance
- Optional: e621 username and API key for authenticated e621 access

## Project Layout

```text
.
|-- Dockerfile
|-- compose.yaml
|-- package.json
|-- public/
|   |-- app.js
|   |-- index.html
|   `-- styles.css
`-- web/
    `-- server.js
```

## Quick Start

Build and start the container:

```bash
docker compose up -d --build
```

Open the web UI:

```text
http://localhost:8080
```

On a remote Docker host, replace `localhost` with the host address.

## Compose Setup

The included `compose.yaml` uses a named volume for `/data`:

```yaml
services:
  szurubooru-tools:
    build:
      context: ${APP_DIR:-.}
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    volumes:
      - szurubooru-tools-data:/data

volumes:
  szurubooru-tools-data:
```

If your Compose runner starts from a different working directory, set `APP_DIR` to the absolute path of this repository:

```env
APP_DIR=/opt/szurubooru-tools
```

In that directory, `Dockerfile`, `web/`, and `public/` must exist.

## Configuration

Open the `Config` tab in the web UI and enter your Szurubooru and optional e621 credentials.

You can also configure the app with environment variables:

```env
SZURU_BASE_URL=http://<szurubooru-host>:<port>
SZURU_USER=Importer
SZURU_TOKEN=<szurubooru-api-token>
E621_USER=<e621-user>
E621_API_KEY=<e621-api-key>
```

`SZURU_BASE_URL` must be reachable from inside the container. If Szurubooru runs on the same Docker network, a Compose service name can be used:

```env
SZURU_BASE_URL=http://szurubooru:6666
```

If Szurubooru is exposed on the host network, use the host address and exposed port:

```env
SZURU_BASE_URL=http://192.168.1.10:5200
```

Without e621 credentials, public e621 search can still work, but restricted posts may be hidden.

## Persistence

The default Compose file stores runtime data in a Docker named volume:

```yaml
volumes:
  - szurubooru-tools-data:/data
```

The web UI stores its saved config under:

```text
/data/config.json
```

Downloads are stored under:

```text
/data/downloads
```

If you prefer a bind mount, replace the named volume with an absolute host path:

```yaml
volumes:
  - /opt/szurubooru-tools-data:/data
```

Use an absolute path. Relative bind paths depend on the Compose runner's working directory.

## Changing the Port

Change the host port on the left side:

```env
HOST_PORT=8090
```

The app will then be available at:

```text
http://<host>:8090
```

If you also change the internal container port, set both values:

```env
HOST_PORT=10000
APP_PORT=10000
```

The included Compose file maps `${HOST_PORT}` to `${APP_PORT}`.

## Usage

### e621

- `Suchen`: loads posts for an artist tag or e621 query.
- `Query importieren`: imports the complete query. `fav:<user>` works as a favorite sync.
- Pool table:
  - `Import`: imports the complete e621 pool into Szurubooru.
  - `Download`: downloads pool files to `/data/downloads`.
  - `Sync`: imports missing posts and updates Szurubooru pool order.
- Post table:
  - `Import`: imports a single e621 post.
  - `Familie`: imports parent/child posts and sets relations.

### Reddit

Imports direct Reddit images, videos, and galleries. External hosts such as Redgifs or Imgur are not implemented.

### Bulk

Uploads multiple local files. Shared tags, safety, source, relations, and an optional pool name can be set before upload.

### Tools

- `Familie importieren`: parent/child import for one e621 post ID.
- `Post herunterladen`: downloads one e621 file to `/data/downloads/posts`.
- `Pool-Sync`: checks or synchronizes imported e621 pools.
- `Duplicate Scan`: groups Szurubooru posts by `checksum` and `checksumMD5`.

## Updating

```bash
git pull
docker compose up -d --build
```

The Docker volume with saved configuration remains untouched.

## GitHub Upload

Before publishing:

- Do not commit real API tokens.
- Do not commit `data/`.
- Do not commit generated config files.

Suggested first upload:

```bash
git init
git add .
git commit -m "Initial Docker web app"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

## Troubleshooting

### `Bind mount failed ... does not exist`

The bind mount path does not exist or was interpreted relative to the Compose runner's working directory. Prefer the included named volume or use an absolute host path:

```yaml
volumes:
  - /opt/szurubooru-tools-data:/data
```

### `failed to read dockerfile`

The build context does not point at this repository. Set:

```env
APP_DIR=/absolute/path/to/szurubooru-tools
```

### `COPY web: file not found`

Only the Compose file was copied, not the full repository. The build context must include `Dockerfile`, `web/`, and `public/`.

### Logs show `npm error signal SIGTERM`

Rebuild the image. Versions before `1.1.1` started through `npm start`, which printed SIGTERM as an npm error when Docker stopped or recreated the container. The current Dockerfile starts Node directly.

### Web UI loads, but imports cannot reach Szurubooru

`SZURU_BASE_URL` is not reachable from inside the container. Use a Docker service name on the same network or a host address reachable by containers.

### Import returns 401 or 403

Check the Szurubooru user and token. The user needs privileges to create and edit posts, tags, and pools.

### e621 search returns fewer posts than expected

Set `E621_USER` and `E621_API_KEY`, or enter them in the web UI.

## Security

- Do not expose this UI publicly without authentication in front of it.
- Keep API tokens out of public repositories.
- Prefer environment variables or the web UI config for credentials.
