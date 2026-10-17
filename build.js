"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const OUTPUT_DIRECTORY = path.join(ROOT, "dist");
const apiBaseUrl = (process.env.API_BASE_URL || "").trim().replace(/\/+$/, "");

if (apiBaseUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(apiBaseUrl);
  } catch {
    throw new Error("API_BASE_URL must be an absolute HTTP or HTTPS URL.");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    throw new Error("API_BASE_URL must be an HTTP or HTTPS URL without credentials.");
  }
}

fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
for (const fileName of ["index.html", "script.js", "style.css"]) {
  fs.copyFileSync(path.join(ROOT, fileName), path.join(OUTPUT_DIRECTORY, fileName));
}
fs.writeFileSync(
  path.join(OUTPUT_DIRECTORY, "config.js"),
  `window.ARU_DIARY_API_URL = ${JSON.stringify(apiBaseUrl)};\n`,
  "utf8"
);

console.log(`Built Aru's diary in ${OUTPUT_DIRECTORY}`);
if (!apiBaseUrl) {
  console.warn("API_BASE_URL is not set; configure it before deploying the Netlify site.");
}
