# Aru's diary

A cozy lavender journal with an SQLite backend.

## Run locally

1. Install Node.js 22.5 or newer.
2. Run `npm start` from this folder.
3. Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

Locally, entries are stored in `data/aru-diary.sqlite`. The database and its
journal files are excluded from Git.

## Deploy the site on Netlify

The Netlify site serves the static journal UI. The Node API and SQLite database
run separately on Render, with a persistent disk so entries survive restarts.

1. Push this repository to GitHub and create a Netlify site from that repository.
2. Deploy the Render service using **New → Blueprint** and this repository's
   `render.yaml`. The blueprint uses a paid Render plan because persistent
   disks are needed to keep the SQLite database between deployments.
3. In Netlify, set `API_BASE_URL` to the Render service's origin, for example
   `https://arus-diary-api.onrender.com` (no trailing slash), and trigger a
   new deploy.
4. Set Render's `FRONTEND_ORIGIN` to the exact Netlify site origin, for example
   `https://arus-diary.netlify.app`, then redeploy the Render service.
5. Check `https://<your-render-service>/api/health`; it should return
   `{"status":"ok"}`. Open the Netlify site and create a test entry.

The Netlify build creates `dist/` and writes `API_BASE_URL` into its generated
`config.js`. For a local static build, run `npm run build`. The live Netlify
site needs `API_BASE_URL` to point to its backend.

## Backups and privacy

Use **Save a backup** to download your entries as JSON. Keep a separate backup
before changing hosts or deleting a deployed service.

The hosted API is intentionally unauthenticated. Restricting CORS to the
Netlify site prevents other websites from reading responses in a browser, but
it does not prevent direct API clients from reading, changing, or deleting
entries. Do not deploy private journal entries to this configuration; add
authentication before using it for sensitive content. Anyone who can access
the public site can use its journal API.
