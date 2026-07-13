import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const serverDir = join(process.cwd(), "dist", "server");
const serverEntry = join(serverDir, "index.js");

const source = `const INDEX_PATH = "/index.html";

function wantsHtml(request) {
  const accept = request.headers.get("accept") || "";
  return request.method === "GET" && accept.includes("text/html");
}

export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);

    if (response.status !== 404 || !wantsHtml(request)) {
      return response;
    }

    const indexUrl = new URL(INDEX_PATH, request.url);
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
`;

await mkdir(serverDir, { recursive: true });
await writeFile(serverEntry, source);
