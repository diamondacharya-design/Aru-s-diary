"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const DATABASE_PATH = path.resolve(
  process.env.DATABASE_PATH || path.join(ROOT, "data", "aru-diary.sqlite")
);
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_IMPORTED_ENTRIES = 5000;
const ALLOWED_MOODS = new Set(["😊", "🥰", "😌", "🌱", "🥺", "☁️"]);
const ALLOWED_ORIGINS = new Set(
  [process.env.FRONTEND_ORIGIN, process.env.NETLIFY_SITE_URL]
    .filter(Boolean)
    .flatMap((value) => value.split(","))
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean)
);
const LOCAL_ORIGINS = new Set(
  ["127.0.0.1", "localhost"].map((host) => `http://${host}:${PORT}`)
);
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be a valid TCP port between 1 and 65535.");
}

fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
const database = new DatabaseSync(DATABASE_PATH);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 90),
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
    mood TEXT NOT NULL,
    created_at TEXT NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1))
  );
  CREATE INDEX IF NOT EXISTS entries_created_at_idx ON entries (created_at DESC);
  CREATE TRIGGER IF NOT EXISTS entries_validate_mood_insert
  BEFORE INSERT ON entries
  WHEN NEW.mood NOT IN ('😊', '🥰', '😌', '🌱', '🥺', '☁️')
  BEGIN
    SELECT RAISE(ABORT, 'Invalid journal mood.');
  END;
  CREATE TRIGGER IF NOT EXISTS entries_validate_mood_update
  BEFORE UPDATE OF mood ON entries
  WHEN NEW.mood NOT IN ('😊', '🥰', '😌', '🌱', '🥺', '☁️')
  BEGIN
    SELECT RAISE(ABORT, 'Invalid journal mood.');
  END;
`);

const selectAllEntries = database.prepare(`
  SELECT id, title, body, mood, created_at, favorite
  FROM entries
  ORDER BY created_at DESC
`);
const selectEntry = database.prepare(`
  SELECT id, title, body, mood, created_at, favorite
  FROM entries WHERE id = ?
`);

function asEntry(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    mood: row.mood,
    createdAt: row.created_at,
    favorite: Boolean(row.favorite)
  };
}

function sendJson(response, statusCode, payload, additionalHeaders = {}) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...additionalHeaders
  });
  response.end(JSON.stringify(payload));
}

function applySecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
}

function handleCors(request, response) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const normalizedOrigin = origin.replace(/\/+$/, "");
  if (!ALLOWED_ORIGINS.has(normalizedOrigin) && !LOCAL_ORIGINS.has(normalizedOrigin)) {
    sendJson(response, 403, { error: "This website is not allowed to access the journal API." });
    return false;
  }
  response.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Vary", "Origin");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return false;
  }
  return true;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let tooLarge = Number(request.headers["content-length"]) > MAX_REQUEST_BYTES;
    if (tooLarge) {
      reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
    }
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    request.on("end", () => {
      if (tooLarge) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function validateContent(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw Object.assign(new Error("Entry details must be a JSON object."), { statusCode: 400 });
  }
  if (typeof payload.title !== "string" || typeof payload.body !== "string") {
    throw Object.assign(new Error("A title and entry text are required."), { statusCode: 400 });
  }
  const title = payload.title.trim();
  const body = payload.body.trim();
  if (!title || title.length > 90 || !body || body.length > 5000) {
    throw Object.assign(new Error("Titles must be 1–90 characters and entries 1–5000 characters."), { statusCode: 400 });
  }
  if (!ALLOWED_MOODS.has(payload.mood)) {
    throw Object.assign(new Error("Choose one of the available journal moods."), { statusCode: 400 });
  }
  return { title, body, mood: payload.mood };
}

function validateImportedEntry(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw Object.assign(new Error("Each imported entry must be a JSON object."), { statusCode: 400 });
  }
  const content = validateContent(payload);
  const date = new Date(payload.createdAt);
  if (typeof payload.id !== "string" || !payload.id.trim() || payload.id.length > 100) {
    throw Object.assign(new Error("A valid entry ID is required for import."), { statusCode: 400 });
  }
  if (typeof payload.createdAt !== "string" || Number.isNaN(date.getTime())) {
    throw Object.assign(new Error("Imported entries need a valid creation date."), { statusCode: 400 });
  }
  if (payload.favorite !== undefined && typeof payload.favorite !== "boolean") {
    throw Object.assign(new Error("Imported favorite status must be true or false."), { statusCode: 400 });
  }
  return {
    ...content,
    id: payload.id,
    createdAt: date.toISOString(),
    favorite: Boolean(payload.favorite)
  };
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/health" && request.method === "GET") {
    const result = database.prepare("SELECT 1 AS ready").get();
    sendJson(response, 200, { status: result.ready === 1 ? "ok" : "error" });
    return;
  }

  if (url.pathname === "/api/entries" && request.method === "GET") {
    sendJson(response, 200, selectAllEntries.all().map(asEntry));
    return;
  }

  if (url.pathname === "/api/entries" && request.method === "POST") {
    const content = validateContent(await readJson(request));
    const entry = { id: randomUUID(), ...content, createdAt: new Date().toISOString(), favorite: false };
    database.prepare(`
      INSERT INTO entries (id, title, body, mood, created_at, favorite)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(entry.id, entry.title, entry.body, entry.mood, entry.createdAt, 0);
    sendJson(response, 201, entry);
    return;
  }

  if (url.pathname === "/api/entries/import" && request.method === "POST") {
    const payload = await readJson(request);
    if (!payload || !Array.isArray(payload.entries)) {
      throw Object.assign(new Error("Import data must contain an entries list."), { statusCode: 400 });
    }
    if (payload.entries.length > MAX_IMPORTED_ENTRIES) {
      throw Object.assign(new Error(`Imports are limited to ${MAX_IMPORTED_ENTRIES} entries at a time.`), { statusCode: 413 });
    }
    const importedEntries = payload.entries.map(validateImportedEntry);
    const insertEntry = database.prepare(`
      INSERT OR IGNORE INTO entries (id, title, body, mood, created_at, favorite)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    database.exec("BEGIN");
    try {
      let imported = 0;
      for (const entry of importedEntries) {
        imported += Number(insertEntry.run(
          entry.id, entry.title, entry.body, entry.mood, entry.createdAt, Number(entry.favorite)
        ).changes);
      }
      database.exec("COMMIT");
      sendJson(response, 200, { imported, entries: selectAllEntries.all().map(asEntry) });
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return;
  }

  const favoriteMatch = url.pathname.match(/^\/api\/entries\/([^/]+)\/favorite$/);
  if (favoriteMatch) {
    if (request.method !== "PATCH") {
      throw Object.assign(new Error("Use PATCH to update a favorite."), { statusCode: 405, allow: "PATCH" });
    }
    const id = decodeEntryId(favoriteMatch[1]);
    const payload = await readJson(request);
    if (!payload || typeof payload.favorite !== "boolean") {
      throw Object.assign(new Error("Favorite status must be true or false."), { statusCode: 400 });
    }
    const result = database.prepare("UPDATE entries SET favorite = ? WHERE id = ?")
      .run(Number(payload.favorite), id);
    if (!result.changes) {
      throw Object.assign(new Error("That journal entry could not be found."), { statusCode: 404 });
    }
    sendJson(response, 200, asEntry(selectEntry.get(id)));
    return;
  }

  const entryMatch = url.pathname.match(/^\/api\/entries\/([^/]+)$/);
  if (entryMatch) {
    const id = decodeEntryId(entryMatch[1]);
    if (request.method === "PUT") {
      const content = validateContent(await readJson(request));
      const result = database.prepare(`
        UPDATE entries SET title = ?, body = ?, mood = ? WHERE id = ?
      `).run(content.title, content.body, content.mood, id);
      if (!result.changes) {
        throw Object.assign(new Error("That journal entry could not be found."), { statusCode: 404 });
      }
      sendJson(response, 200, asEntry(selectEntry.get(id)));
      return;
    }
    if (request.method === "DELETE") {
      const result = database.prepare("DELETE FROM entries WHERE id = ?").run(id);
      if (!result.changes) {
        throw Object.assign(new Error("That journal entry could not be found."), { statusCode: 404 });
      }
      sendJson(response, 200, { deleted: true });
      return;
    }
    throw Object.assign(new Error("Use PUT or DELETE for an entry."), { statusCode: 405, allow: "PUT, DELETE" });
  }

  if (url.pathname === "/api/entries") {
    throw Object.assign(new Error("Use GET or POST for entries."), { statusCode: 405, allow: "GET, POST" });
  }
  if (url.pathname === "/api/entries/import") {
    throw Object.assign(new Error("Use POST to import entries."), { statusCode: 405, allow: "POST" });
  }
  if (url.pathname === "/api/health") {
    throw Object.assign(new Error("Use GET to check database status."), { statusCode: 405, allow: "GET" });
  }
  if (url.pathname.startsWith("/api/")) {
    throw Object.assign(new Error("This API route or method does not exist."), { statusCode: 404 });
  }
  return false;
}

function decodeEntryId(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw Object.assign(new Error("Invalid journal entry ID."), { statusCode: 400 });
  }
}

function serveStatic(request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "This request method is not supported." });
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendJson(response, 400, { error: "Invalid URL path." });
    return;
  }
  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, requestedPath);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    sendJson(response, 403, { error: "This file is not available." });
    return;
  }
  if (!["index.html", "script.js", "style.css", "config.js"].includes(path.relative(ROOT, filePath))) {
    sendJson(response, 404, { error: "This file does not exist." });
    return;
  }
  fs.readFile(filePath, (error, contents) => {
    if (error) {
      sendJson(response, error.code === "ENOENT" ? 404 : 500, { error: "Unable to read the requested file." });
      if (error.code !== "ENOENT") console.error("Unable to serve a journal file.", error);
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Length": contents.length,
      "Content-Type": MIME_TYPES[path.extname(filePath)],
      "X-Content-Type-Options": "nosniff"
    });
    response.end(request.method === "HEAD" ? undefined : contents);
  });
}

const server = http.createServer(async (request, response) => {
  applySecurityHeaders(response);
  if (!handleCors(request, response)) return;
  try {
    const url = new URL(request.url, `http://${HOST}:${PORT}`);
    const handled = await handleApi(request, response, url);
    if (handled === false) serveStatic(request, response, url);
  } catch (error) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    if (statusCode >= 500) console.error("Journal request failed.", error);
    if (!response.headersSent && !response.destroyed) {
      const headers = error.allow ? { Allow: error.allow } : undefined;
      sendJson(response, statusCode, {
        error: statusCode >= 500 ? "The journal database couldn't complete that request." : error.message
      }, headers);
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Aru's diary API is ready at http://${HOST}:${PORT}`);
  console.log(`SQLite database: ${DATABASE_PATH}`);
});

function closeServer() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", closeServer);
process.on("SIGTERM", closeServer);
