# Aru's diary

A cozy, lavender personal journal backed by a local SQLite database.

## Run locally

1. Install Node.js 22.5 or newer.
2. From this folder, run `npm start`.
3. Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

The server listens only on your computer. Journal entries are stored in
`data/aru-diary.sqlite`; that database and its SQLite journal files are ignored
by Git and are not included when sharing the source code.

Use **Save a backup** in the journal to download a JSON copy of your entries.
