# Szurubooru Tools Web

Containerfaehige Weboberflaeche fuer e621- und Reddit-Importe nach Szurubooru.

Die App ist als Ersatz fuer lokale Windows-Forms/PowerShell-Workflows gedacht und laeuft als kleine Node.js-Webapp in Docker. Sie bringt keine Datenbank mit; Konfiguration und Jobdaten liegen in einem Docker-Volume.

## Funktionen

- e621 Query oder Artist-Tag suchen
- Treffer nach Pools, Videos und allen Posts anzeigen
- einzelne e621-Posts nach Szurubooru importieren
- komplette e621-Pools nach Szurubooru importieren
- Szurubooru-Pool fuer importierte e621-Pools anlegen oder aktualisieren
- e621-Posts und Pools nach `/data/downloads` herunterladen
- Parent/Child-Familien von e621 importieren und in Szurubooru verknuepfen
- komplette e621 Queries importieren, inklusive `fav:<user>` Favoriten-Sync
- Reddit-Post oder Reddit-Galerie nach Szurubooru importieren
- Basis-Tags fuer Reddit-Importe automatisch erzeugen
- Galerie-Posts in Szurubooru gegenseitig verknuepfen
- lokale Dateien per Bulk-Upload hochladen, taggen, verknuepfen und optional in Pools legen
- Duplicate Scan ueber Szurubooru Checksums
- Pool-Sync fuer `comic_<e621id>_...` Pools: fehlende Posts importieren und Reihenfolge aktualisieren
- laufende und abgeschlossene Jobs im Webinterface anzeigen
- Konfiguration im Webinterface oder ueber Environment-Variablen

## Voraussetzungen

- Docker
- Docker Compose oder Dockge
- erreichbare Szurubooru-Instanz
- optional: e621 Benutzername und API-Key, falls geschuetzte/gelimitete Inhalte importiert werden sollen

## Dateien

```text
.
├── Dockerfile
├── compose.yaml
├── package.json
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
└── web/
    └── server.js
```

## Schnellstart mit Docker Compose

```bash
docker compose up -d --build
```

Danach oeffnen:

```text
http://localhost:8080
```

Auf einem Server oder NAS entsprechend:

```text
http://<server-ip>:8080
```

## Installation auf Synology mit Dockge

1. Dieses Repository oder den Ordner auf die Synology kopieren, zum Beispiel nach:

   ```text
   /volume1/docker/szurubooru-tools
   ```

2. In Dockge einen neuen Stack anlegen.

3. Als Compose-Inhalt die `compose.yaml` verwenden.

4. Wenn Dockge die Compose-Datei nicht direkt aus dem App-Ordner ausfuehrt, im Stack unter Environment setzen:

   ```env
   APP_DIR=/volume1/docker/szurubooru-tools
   ```

   Wichtig: Der Pfad muss mit `/volume1/...` beginnen. Ohne fuehrenden Slash behandelt Docker ihn als relativen Pfad.

5. Stack starten.

6. Webinterface oeffnen:

   ```text
   http://<synology-ip>:8080
   ```

7. Im Tab `Config` Szurubooru und optional e621 eintragen.

## Konfiguration

Die Konfiguration kann im Webinterface gespeichert werden. Alternativ koennen die Werte als Environment-Variablen im Compose-Stack gesetzt werden.

### Szurubooru

```env
SZURU_BASE_URL=http://<szurubooru-host>:<port>
SZURU_USER=Importer
SZURU_TOKEN=<szurubooru-api-token>
```

`SZURU_BASE_URL` muss aus Sicht des Containers erreichbar sein. Wenn Szurubooru auf derselben Synology laeuft, funktioniert oft eine LAN-IP:

```env
SZURU_BASE_URL=http://192.168.1.10:5200
```

Wenn beide Container im selben Docker-Netzwerk laufen, kann auch der Service-Name funktionieren:

```env
SZURU_BASE_URL=http://szurubooru:6666
```

### e621

```env
E621_USER=<e621-user>
E621_API_KEY=<e621-api-key>
```

Ohne e621-Zugang kann die Suche weiterhin fuer oeffentlich erreichbare Posts funktionieren. Fuer gesperrte oder authentifizierte Inhalte werden User und API-Key benoetigt.

## Persistenz

Standardmaessig verwendet die Compose-Datei ein Docker-named-volume:

```yaml
volumes:
  - szurubooru-tools-data:/data
```

Das vermeidet Dockge-Pfadprobleme und bleibt bei Container-Neustarts und Image-Updates erhalten.

Downloads aus der Webapp landen ebenfalls in diesem Volume unter:

```text
/data/downloads
```

Wenn du stattdessen einen sichtbaren Synology-Ordner verwenden willst:

```yaml
volumes:
  - /volume1/docker/szurubooru-tools/data:/data
```

Der fuehrende Slash ist wichtig.

## Port aendern

Host-Port links anpassen:

```yaml
ports:
  - "8090:8080"
```

Dann ist die App unter `http://<host>:8090` erreichbar.

## Update

Bei Nutzung per Git:

```bash
git pull
docker compose up -d --build
```

In Dockge:

1. Repository/Ordner aktualisieren.
2. Stack neu bauen/starten.

Das Docker-Volume mit der gespeicherten Konfiguration bleibt erhalten.

## Bedienung

### e621

- `Suchen`: laedt Posts fuer einen Artist-Tag oder eine e621 Query.
- `Query importieren`: importiert die komplette Query. Bei `fav:<user>` entspricht das dem Favoriten-Sync aus dem Windows-Tool.
- In der Pool-Tabelle:
  - `Import`: importiert den kompletten e621-Pool nach Szurubooru.
  - `Download`: speichert die Pool-Dateien unter `/data/downloads`.
  - `Sync`: importiert fehlende Posts und aktualisiert die Pool-Reihenfolge in Szurubooru.
- In der Post-Tabelle:
  - `Import`: importiert den einzelnen Post.
  - `Familie`: importiert Parent/Child-Posts und setzt Relationen.

### Reddit

Importiert direkte Reddit-Bilder, Videos und Galerien. Externe Hoster wie Redgifs/Imgur sind nicht Ziel dieser Webapp.

### Bulk

Mehrere lokale Dateien hochladen. Gemeinsame Tags, Safety, Source, Relationen und optional ein Pool-Name koennen gesetzt werden.

### Tools

- `Familie importieren`: Parent/Child-Import fuer eine e621 Post-ID.
- `Post herunterladen`: e621-Datei nach `/data/downloads/posts`.
- `Pool-Sync`: Status pruefen oder bestimmte e621 Pool-IDs synchronisieren.
- `Duplicate Scan`: gruppiert Szurubooru-Posts nach `checksum` und `checksumMD5`.

## GitHub-Upload

Vor dem Upload pruefen:

- keine echten Tokens in `compose.yaml`
- keine `data/` Ordner committen
- keine lokalen `config.json` Dateien committen

Empfohlen:

```bash
git init
git add .
git commit -m "Initial Docker web app"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

## Troubleshooting

### `Bind mount failed ... /opt/stacks/.../volume1/...`

Der Pfad wurde relativ interpretiert. Verwende entweder das named volume aus der mitgelieferten `compose.yaml` oder einen absoluten Pfad:

```yaml
volumes:
  - /volume1/docker/szurubooru-tools/data:/data
```

Nicht:

```yaml
volumes:
  - volume1/docker/szurubooru-tools/data:/data
```

### `failed to read dockerfile`

Dockge findet den Build-Kontext nicht. Setze:

```env
APP_DIR=/volume1/docker/szurubooru-tools
```

In diesem Ordner muessen `Dockerfile`, `web/` und `public/` liegen.

### `COPY web: file not found`

Es wurde nur die Compose-Datei kopiert, aber nicht der komplette App-Ordner.

### Webinterface laedt, Import erreicht Szurubooru aber nicht

`SZURU_BASE_URL` oder die im Webinterface gespeicherte Base URL ist aus Sicht des Containers nicht erreichbar. Verwende die LAN-IP der Synology oder den Docker-Service-Namen im gleichen Netzwerk.

### Import meldet 401 oder 403

Token oder Benutzerrechte in Szurubooru pruefen. Der User braucht Rechte zum Erstellen/Bearbeiten von Posts, Tags und Pools.

### e621-Suche liefert weniger als erwartet

e621 kann Inhalte ohne Authentifizierung ausblenden. e621 User und API-Key hinterlegen.

## Sicherheit

- Tokens nicht in ein oeffentliches Repository committen.
- API-Keys besser in Dockge Environment-Variablen oder im Webinterface hinterlegen.
- Das Webinterface hat aktuell keine eigene Anmeldung. Betreibe es nur in einem vertrauenswuerdigen Netzwerk oder hinter einem Reverse Proxy mit Authentifizierung.
