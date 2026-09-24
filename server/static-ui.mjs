import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

/**
 * Serve the built Frontier UI (`npm run build:frontier` → `dist/frontier`) from the companion's
 * own origin, so one port carries both the UI and `/api` with no dev server or proxy in front.
 *
 * It only answers GET and HEAD outside `/api/`, after the same host/origin boundary the API
 * uses. Paths are resolved inside the build directory and anything that escapes it is a 404.
 * A path with no file extension that is not a file falls back to `index.html`, which is what a
 * client-routed page needs on reload. Hashed files under `assets/` are cached as immutable;
 * `index.html` is never cached, so a rebuild is picked up on the next load. Byte ranges are
 * honoured because Safari will not play the welcome video without them.
 */
export async function createStaticUi(directory) {
  const root = path.resolve(directory);
  const index = path.join(root, "index.html");
  if (!(await isFile(index))) return null;

  return async function serveStaticUi(request, response, url) {
    if (request.method !== "GET" && request.method !== "HEAD") return false;
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return false;

    let relative;
    try {
      relative = decodeURIComponent(url.pathname);
    } catch {
      return false;
    }
    if (relative.includes("\0")) return false;
    let file = path.resolve(root, `.${relative}`);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) return false;

    let info = await statOf(file);
    if (info?.isDirectory()) {
      file = path.join(file, "index.html");
      info = await statOf(file);
    }
    if (!info?.isFile()) {
      if (path.extname(relative)) return false;
      file = index;
      info = await statOf(file);
      if (!info?.isFile()) return false;
    }

    sendFile(request, response, file, info, root);
    return true;
  };
}

function sendFile(request, response, file, info, root) {
  const headers = {
    "content-type": CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "cache-control": cacheControlFor(file, root),
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
    "last-modified": info.mtime.toUTCString(),
  };
  const range = parseRange(request.headers.range, info.size);
  if (range === "unsatisfiable") {
    response.writeHead(416, { ...headers, "content-range": `bytes */${info.size}` });
    response.end();
    return;
  }
  const [start, end] = range ?? [0, info.size - 1];
  const length = info.size === 0 ? 0 : end - start + 1;
  response.writeHead(range ? 206 : 200, {
    ...headers,
    "content-length": String(length),
    ...(range ? { "content-range": `bytes ${start}-${end}/${info.size}` } : {}),
  });
  if (request.method === "HEAD" || length === 0) {
    response.end();
    return;
  }
  const stream = createReadStream(file, { start, end });
  stream.on("error", () => response.destroy());
  stream.pipe(response);
}

// One `bytes=start-end` range, the only form browsers send for media. Anything else is served
// whole, which the HTTP spec allows.
function parseRange(header, size) {
  if (typeof header !== "string") return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start;
  let end;
  if (!match[1]) {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return "unsatisfiable";
  return [start, end];
}

function cacheControlFor(file, root) {
  const relative = path.relative(root, file).split(path.sep);
  return relative[0] === "assets" ? "public, max-age=31536000, immutable" : "no-cache";
}

async function statOf(file) {
  try {
    return await stat(file);
  } catch {
    return null;
  }
}

async function isFile(file) {
  return Boolean((await statOf(file))?.isFile());
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".wasm": "application/wasm",
  ".ktx2": "image/ktx2",
  ".txt": "text/plain; charset=utf-8",
};
