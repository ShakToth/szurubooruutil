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

Start the container from a prebuilt image:

```bash
IMAGE=ghcr.io/shaktoth/szurubooru-tools-web:latest docker compose up -d
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
    image: ${IMAGE:-ghcr.io/your-github-user/szurubooru-tools-web:latest}
    ports:
      - "8080:8080"
    volumes:
      - szurubooru-tools-data:/data

volumes:
  szurubooru-tools-data:
```

Set the `IMAGE` variable to your published image:

```env
IMAGE=ghcr.io/<github-user-or-org>/szurubooru-tools-web:latest
```

For local development builds, use `compose.build.yaml` instead:

```bash
docker compose -f compose.build.yaml up -d --build
```

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

## Security

- Do not expose this UI publicly without authentication in front of it.

## License

MIT. See [LICENSE](LICENSE).
