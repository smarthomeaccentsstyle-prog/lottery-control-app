# Backend Start

This is the first backend for the lottery app.

It is intentionally simple:
- Node.js only
- no package install needed
- JSON file storage
- ready to upgrade later to MongoDB or PostgreSQL

## Where To Start

Start here:

```bash
npm run server
```

The API will run on:

```bash
http://localhost:4000
```

Health check:

```bash
http://localhost:4000/api/health
```

## Multi-Mobile LAN Start

If many phones will use the app on the same Wi-Fi, use this flow:

1. Check your LAN URLs:

```bash
npm run network-info
```

2. Start backend:

```bash
npm run server
```

3. Start frontend for LAN:

```bash
npm run start:lan
```

4. Open the printed `Frontend LAN` URL on each mobile browser.

Notes:
- backend now listens on `0.0.0.0`, so other devices on the network can reach it
- frontend now auto-uses the same machine hostname/IP for API calls
- if backend is on another machine, use `.env.lan.example` as your override template

## Data File

Local development fallback:

`server/data/db.json`

Production-safe storage:

- set `DATA_DIR=/data` or `DB_FILE=/data/db.json`
- mount that path to a persistent volume
- on first boot, if the persistent file is empty, the app will try to copy the old bundled data into it
- every write keeps `db.backup.json` plus rotating snapshots in `snapshots/`
- live sessions are stored in the database too, so restarts do not wipe current logins
- `GET /api/health` now shows public-safe readiness warnings, while the master system route shows the detailed security findings
- `GET /api/master/system/export` returns a migration-safe backup payload for future database moves

Recommended production env:

```bash
HOST=0.0.0.0
PORT=4000
DATA_DIR=/data
SESSION_TTL_HOURS=24
REQUEST_BODY_LIMIT_BYTES=262144
# If frontend is on another domain:
# CORS_ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

Operator backup command:

```bash
npm run backup:export
```

Current sections:
- `admin`
- `sellers`
- `tickets`
- `results`
- `settings`

## Main Routes

### Auth

- `POST /api/auth/login`

Body:

```json
{
  "role": "admin",
  "username": "admin",
  "password": "1234"
}
```

### Sellers

- `GET /api/sellers`
- `POST /api/sellers`
- `PATCH /api/sellers/:id`

### Tickets

- `GET /api/tickets`
- `POST /api/tickets`
- `PATCH /api/tickets/:id`

Optional query filters:
- `date`
- `drawTime`
- `sellerUsername`

### Results

- `GET /api/results`
- `PUT /api/results`

### Admin

- `GET /api/dashboard/overview`
- `GET /api/dashboard/risk?date=2026-04-06&drawTime=11:00`
- `GET /api/reports/seller?sellerUsername=seller1&date=2026-04-06&drawTime=ALL`

## Best Next Step

After backend is running, start frontend integration in this order:

1. Replace seller login from localStorage with `POST /api/auth/login`
2. Replace seller list from localStorage with `GET /api/sellers`
3. Replace ticket save/update with `/api/tickets`
4. Replace result save/load with `/api/results`
5. Replace risk board data with `/api/dashboard/risk`
6. Replace seller report data with `/api/reports/seller`

## Why This Is The Right Start

This keeps your current app working logic almost the same.

So you are not jumping straight into:
- Firebase
- MongoDB
- PostgreSQL
- deployment

First finish:
- API shape
- data model
- frontend integration
- daily workflow test

Then upgrade storage later.
