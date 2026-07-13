import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

const distDir = join(process.cwd(), "dist");
const serverDir = join(process.cwd(), "dist", "server");
const serverEntry = join(serverDir, "index.js");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === "server") {
      continue;
    }

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

const routes = {};

for (const filePath of await collectFiles(distDir)) {
  const route = `/${relative(distDir, filePath).split(sep).join("/")}`;
  routes[route] = {
    body: await readFile(filePath, "utf8"),
    contentType: contentTypes[extname(filePath)] || "text/plain; charset=utf-8",
  };
}

const source = `const ROUTES = ${JSON.stringify(routes)};

function responseFor(route, status = 200) {
  const asset = ROUTES[route];

  if (!asset) {
    return null;
  }

  return new Response(asset.body, {
    status,
    headers: {
      "cache-control": route === "/index.html" ? "no-cache" : "public, max-age=31536000, immutable",
      "content-type": asset.contentType,
      "x-ncaaf-dashboard": "embedded-worker",
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const route = url.pathname === "/" ? "/index.html" : url.pathname;
    const assetResponse = responseFor(route);

    if (assetResponse) {
      return assetResponse;
    }

    return responseFor("/index.html", 200);
  },
};
`;

await mkdir(serverDir, { recursive: true });
await writeFile(serverEntry, source);
