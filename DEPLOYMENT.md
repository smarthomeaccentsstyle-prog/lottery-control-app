# Public Deployment

This app is now prepared to run as one public service:
- backend API
- frontend build
- single URL for seller and admin

## Best Simple Path

Use one Node service with persistent storage.

Good fit:
- Railway web service
- persistent volume mounted to `/data`

Why:
- many mobiles can use one shared URL
- your `db.json` can stay persistent
- you do not need a separate frontend hosting service right now

## What The App Expects

- build command:

```bash
npm install && npm run build
```

- start command:

```bash
npm run start:prod
```

- environment variables:

```bash
HOST=0.0.0.0
PORT=4000
DATA_DIR=/data
SESSION_TTL_HOURS=24
REQUEST_BODY_LIMIT_BYTES=262144
```

Recommended in real production:

```bash
CORS_ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

## Railway Example

1. Push this project to GitHub
2. Create a new Railway project from that repo
3. Add a persistent volume
4. Mount the volume at:

```text
/data
```

5. Set variables:

```text
HOST=0.0.0.0
PORT=4000
DATA_DIR=/data
SESSION_TTL_HOURS=24
REQUEST_BODY_LIMIT_BYTES=262144
# If frontend is on another domain:
# CORS_ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

6. Build command:

```text
npm install && npm run build
```

7. Start command:

```text
npm run start:prod
```

## What Happens In Production

- `server/index.js` serves `/api/*`
- same server also serves the React build from `/build`
- all mobiles open the same public URL
- all data writes to `DATA_DIR/db.json`
- login sessions are stored inside the database file, so restart or redeploy does not immediately log everyone out
- if `DATA_DIR/db.json` is empty on first boot, the app now tries to migrate old data from the bundled `server/data/db.json`
- every write also keeps:
  - `db.backup.json`
  - rotating timestamp snapshots in `DATA_DIR/snapshots/`
- the health endpoint now reports public-safe readiness warnings, and the master system route shows detailed security warnings
- master can export a migration-safe backup from `GET /api/master/system/export`
- operators can also write a full backup file with:

```bash
npm run backup:export
```

## Important

If you deploy without persistent storage:
- sellers, tickets, and results may reset after redeploy or restart

The code now warns in startup logs when storage is unsafe, but it still cannot magically preserve data on an ephemeral container.

So for real public use, persistent volume is required until you move to:
- PostgreSQL
- MongoDB
- Firebase

## Upgrade Path For A Bigger App

Today this project is safest as:
- one Node service
- one persistent storage volume
- one always-on process

That setup can handle normal real users well, but true multi-instance scaling should not stay on a shared JSON file forever.

Before you move to a bigger stack:
- keep `DATA_DIR` on persistent storage
- change all default master, admin, and seller passwords
- set `CORS_ALLOWED_ORIGINS` to your real production domains
- run `npm run backup:export` and keep the exported file before major deploys
- use the backup export as the source file when migrating into PostgreSQL or another managed database

If you later move to PostgreSQL:
- keep the same data shape first
- import sellers, admins, tickets, results, settings, and meta from the export file
- cut over only after the new database has the same counts and a full restore backup
