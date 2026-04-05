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

## Important

If you deploy without persistent storage:
- sellers, tickets, and results may reset after redeploy or restart

So for real public use, persistent volume is required until you move to:
- PostgreSQL
- MongoDB
- Firebase
