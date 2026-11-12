# Commute server

Starts each user's Live Activity on their schedule, keeps it up to date with trains and
traffic, and ends it when they arrive. Node 24, TypeScript run directly, no runtime
dependencies (built-in `node:sqlite`, `node:http2`, `fetch`).

```
npm install      # only TypeScript and Node types, for `npm run typecheck`
npm test
npm start
```

## How a commute runs

1. Every 30 s the scheduler finds users whose start time (in their own time zone) has
   just passed. It skips paused days and, if they asked, UK bank holidays.
2. It works out the first state and sends a **push-to-start** to the phone. iOS shows
   the Live Activity with no app running, then wakes the app in the background. The app
   sends back the activity's own **update token**.
3. Every 2 minutes the server refreshes trains and the drive. It pushes when anything
   changes, and at least every 5 minutes. A **new problem** goes out as an alert, so
   the phone lights up. A routine refresh goes out quietly, at priority 5.
4. The phone has geofences around home, work and both stations. When it crosses one,
   iOS wakes the app, which reports the crossing. The server moves the stage on (left
   home → at the station → on the train → arrived) and pushes. Arriving ends the
   activity. So does a 3 h (morning) or 4 h (evening) limit, or the user swiping it away.

The server is the only thing that writes Live Activity content, so the phone and the
server never disagree.

## Data sources

| What | Source | Needs |
|---|---|---|
| National Rail departures, incl. Elizabeth line and Overground | Rail Data Marketplace, *Live Departure Board* (LDBWS) | Free account and subscription; `RAIL_DATA_API_KEY` |
| Tube and DLR | TfL Unified API | Nothing; an app key raises the rate limit |
| Drive time and "usual" (no-traffic) drive | Apple Maps Server API, ETA | A Maps ID and key in the Apple Developer account |
| Station list for search | `data/stations.json`, [davwheat/uk-railway-stations](https://github.com/davwheat/uk-railway-stations), ODbL | Attribution (in the app's About section) |
| Bank holidays | GOV.UK `bank-holidays.json` | Nothing |

Responses are cached for 30 s to 3 min per URL, so commuters on the same route share
one upstream call.

## Environment

| Variable | Required | |
|---|---|---|
| `APPLE_TEAM_ID` | yes | e.g. `R53MF3F498` |
| `APP_BUNDLE_ID` | yes | `net.leatham.mycommute` |
| `APNS_KEY_ID`, `APNS_PRIVATE_KEY` | yes | An APNs auth key (.p8). Paste the whole file; `\n` escapes are accepted. |
| `MAPS_KEY_ID`, `MAPS_PRIVATE_KEY` | for drive times | A MapKit JS / Maps Server key (.p8). |
| `RAIL_DATA_API_KEY` | for National Rail | The **consumer key** of your LDBWS subscription (not the secret). Without it, National Rail routes fall back to TfL's live times, which cover only stations on the Elizabeth line and Overground; other routes show "No live times for this route yet". |
| `RAIL_DATA_LDBWS_URL` | no | Defaults to `https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120`. Check it against the product's Specification tab. |
| `TFL_APP_KEY` | no | From api-portal.tfl.gov.uk. |
| `DATABASE_PATH` | no | Default `commute.db`; `/data/commute.db` in Docker. |
| `PORT` | no | Default 8080. |

Any variable can instead be given as a file path in `NAME_FILE` (e.g. `APNS_PRIVATE_KEY_FILE`),
which is how `deploy/compose.yaml` passes the `.p8` keys. Anything missing switches that
feature off and is logged at start-up. The rest keeps working.

### Making the Apple keys

- **APNs:** developer.apple.com → Certificates, Identifiers & Profiles → Keys → **+** →
  *Apple Push Notifications service (APNs)*. One key works for every app on the team,
  and for both sandbox and production.
- **Maps:** Identifiers → **+** → *Maps IDs*, then Keys → **+** → *MapKit JS* and pick
  that Maps ID. (The Maps Server API uses the MapKit JS key.)
- In Identifiers, edit `net.leatham.mycommute` and tick **Push Notifications**.

## Deploying

Run **one** instance, always on. The scheduler is inside the server process.

### On the shared backend host (recommended)

The VM is defined in `app-factory/infra/backend-host`: London, its own network with no
open inbound ports, a Cloudflare Tunnel (`apps`) for HTTPS, and daily disk snapshots.
The server lives in `/srv/apps/commute/` on the VM and is published at
`https://commute-api.leatham.net`.

1. DNS is already done: `commute-api.leatham.net` is a CNAME to the `apps` tunnel
   (`cloudflared tunnel route dns apps commute-api.leatham.net`).
2. Deploy from this repo, in PowerShell:
   ```powershell
   ./server/deploy/deploy.ps1
   ```
   It packs `server/` (code and station list only), copies it over the IAP tunnel and
   runs `deploy/install.sh` on the VM. That builds the image, starts it, and adds the
   hostname to the tunnel with `app-site`.
3. **The first run stops early** and creates `/srv/apps/commute/deploy/.env` from
   `commute.env.example`. Fill it in, and copy the keys to `deploy/secrets/apns.p8` and
   `deploy/secrets/maps.p8` there:
   ```bash
   gcloud compute ssh apps --zone=europe-west2-b --tunnel-through-iap
   sudo nano /srv/apps/commute/deploy/.env
   ```
   Then run `deploy.ps1` again. Later deploys replace only the code; `.env`, the keys
   and the database stay.
4. Check it: `https://<domain>/healthz` should return `{"ok":true}`.

### On Fly.io

The `Dockerfile` also runs as it is on Fly, with a volume at `/data`:

```
fly launch --no-deploy            # from server/
fly volumes create data --size 1
fly secrets set APPLE_TEAM_ID=... APP_BUNDLE_ID=... APNS_KEY_ID=... RAIL_DATA_API_KEY=...
fly secrets set APNS_PRIVATE_KEY="$(cat AuthKey_XXXX.p8)" MAPS_KEY_ID=... MAPS_PRIVATE_KEY="$(cat AuthKey_YYYY.p8)"
fly deploy
```

In `fly.toml`, set `auto_stop_machines = "off"` and `min_machines_running = 1`. Fly's
default stops idle machines, which would stop the scheduler.

Wherever it runs, run only one copy: two would both send pushes. (A daily unique key
on each commute stops double starts, but not double refreshes.) Then set `BackendURL`
in `ios/project.yml` to the deployed origin.

## API

All calls except `/healthz` need `Authorization: Bearer <install secret>`. The app makes
the secret on first launch and keeps it in its Keychain. The server stores only its
SHA-256.

| | |
|---|---|
| `GET /v1/stations?q=` · `?near=lat,lon` | Station search; nearest National Rail stations |
| `PUT /v1/me` · `GET` · `DELETE` | Settings (see `src/validate.ts`); `DELETE` erases everything |
| `GET /v1/status?direction=toWork` | What the Live Activity would show now |
| `POST /v1/commutes` `{direction}` | Start now; returns the activity's attributes and first state |
| `PUT /v1/commutes/:id/token` `{token}` | The activity's update token |
| `POST /v1/commutes/:id/events` `{region, kind}` | A geofence crossing |
| `DELETE /v1/commutes/:id` | Stop |

## What's stored

Per install: time zone, home rounded to 3 decimal places (about 100 m), the two
stations, the weekly schedule and alert preferences, and the push-to-start token. Work
location is never sent. Per commute: its stage, its activity token and the last state
pushed. Finished commutes are deleted after 7 days.
