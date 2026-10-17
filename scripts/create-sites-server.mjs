import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

const distDir = join(process.cwd(), "dist");
const serverDir = join(process.cwd(), "dist", "server");
const serverEntry = join(serverDir, "index.js");

// The dashboard loads the compact core plus weekly shards. Keep the legacy
// monolith in source for Streamlit and automation compatibility, not hosting.
await rm(join(distDir, "data", "app-data.json"), { force: true });

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
const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=100";
const CORE_EVENTS_URL = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-cache",
      "content-type": "application/json; charset=utf-8",
      "x-ncaaf-dashboard": "embedded-worker",
    },
  });
}

function normalizeGame(event) {
  const competition = event.competitions?.[0] || {};
  const competitors = (competition.competitors || []).map((competitor) => ({
    homeAway: competitor.homeAway,
    id: competitor.team?.id,
    name: competitor.team?.displayName || competitor.team?.name,
    shortName: competitor.team?.shortDisplayName || competitor.team?.abbreviation,
    abbreviation: competitor.team?.abbreviation,
    rank: competitor.curatedRank?.current && competitor.curatedRank.current < 99 ? competitor.curatedRank.current : null,
    score: competitor.score === undefined || competitor.score === "" ? null : Number(competitor.score),
    winner: Boolean(competitor.winner),
    logo: competitor.team?.logo,
  }));
  const situation = competition.situation || {};
  const status = event.status || {};
  const liveWinProbability = calculateLiveWinProbability(competitors, status, situation);
  return {
    id: event.id,
    name: event.name,
    shortName: event.shortName,
    date: event.date,
    statusType: event.status?.type?.name,
    statusShort: event.status?.type?.shortDetail,
    statusDetail: event.status?.type?.detail,
    completed: Boolean(event.status?.type?.completed),
    venue: competition.venue?.fullName || null,
    broadcast: competition.broadcasts?.[0]?.names?.join(", ") || null,
    situation: {
      possession: situation.possession || null,
      downDistance: situation.downDistanceText || null,
      lastPlay: situation.lastPlay?.text || null,
      homeTimeouts: situation.homeTimeouts ?? null,
      awayTimeouts: situation.awayTimeouts ?? null,
    },
    liveWinProbability,
    competitors,
  };
}

function clockToSeconds(displayValue) {
  const parts = String(displayValue || "0:00").split(":").map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function calculateLiveWinProbability(competitors, status, situation) {
  if (status.type?.name !== "STATUS_IN_PROGRESS") return null;
  const home = competitors.find((team) => team.homeAway === "home") || competitors[1];
  const away = competitors.find((team) => team.homeAway === "away") || competitors[0];
  if (!home || !away) return null;
  const period = Number(status.period || 1);
  const seconds = Math.max(0, (4 - Math.min(period, 4)) * 900 + clockToSeconds(status.displayClock));
  const leverage = 1 + (3600 - seconds) / 1050;
  const scoreEdge = (Number(home.score || 0) - Number(away.score || 0)) * 0.12 * leverage;
  const rankEdge = ((Number(away.rank || 35) - Number(home.rank || 35)) / 35) * 0.55;
  const possessionEdge = String(situation.possession || "") === String(home.id || "") ? 0.16 : -0.16;
  const homeProbability = 1 / (1 + Math.exp(-(scoreEdge + rankEdge + possessionEdge + 0.12)));
  return {
    home: Math.max(0.001, Math.min(0.999, homeProbability)),
    away: Math.max(0.001, Math.min(0.999, 1 - homeProbability)),
    method: "Score-clock-possession model",
  };
}

async function fetchScores() {
  try {
    const response = await fetch(SCOREBOARD_URL, {
      headers: {
        "accept": "application/json",
        "user-agent": "Mozilla/5.0",
      },
    });

    if (!response.ok) {
      throw new Error("ESPN scoreboard returned " + response.status);
    }

    const payload = await response.json();
    return {
      updatedAt: new Date().toISOString(),
      source: SCOREBOARD_URL,
      games: (payload.events || []).map(normalizeGame),
    };
  } catch (error) {
    return fetchCoreScores();
  }
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

function httpsRef(value) {
  return value?.replace("http://", "https://");
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0",
    },
  });

  if (!response.ok) {
    throw new Error("ESPN core API returned " + response.status);
  }

  return response.json();
}

async function normalizeCoreCompetitor(competitor) {
  const team = competitor.team?.$ref ? await fetchJson(httpsRef(competitor.team.$ref)) : {};
  const score = competitor.score?.$ref ? await fetchJson(httpsRef(competitor.score.$ref)) : {};
  const rank = competitor.curatedRank?.current && competitor.curatedRank.current < 99 ? competitor.curatedRank.current : null;
  return {
    homeAway: competitor.homeAway,
    id: competitor.id || team.id,
    name: team.displayName || team.name,
    shortName: team.shortDisplayName || team.abbreviation || team.displayName,
    abbreviation: team.abbreviation,
    rank,
    score: score.displayValue === undefined ? null : Number(score.displayValue),
    winner: Boolean(competitor.winner),
    logo: team.logos?.[0]?.href || null,
  };
}

async function normalizeCoreGame(eventRef) {
  const event = await fetchJson(httpsRef(eventRef.$ref));
  const competition = event.competitions?.[0] || {};
  const status = competition.status?.$ref ? await fetchJson(httpsRef(competition.status.$ref)) : {};
  const competitors = await Promise.all((competition.competitors || []).map(normalizeCoreCompetitor));
  return {
    id: event.id,
    name: event.name,
    shortName: event.shortName,
    date: event.date,
    statusType: status.type?.name,
    statusShort: status.type?.shortDetail,
    statusDetail: status.type?.detail,
    completed: Boolean(status.type?.completed),
    venue: competition.venue?.fullName || null,
    broadcast: null,
    competitors,
  };
}

async function fetchCoreScores() {
  const payload = await fetchJson(CORE_EVENTS_URL + "?dates=" + todayYmd() + "&limit=100");
  const refs = (payload.items || []).slice(0, 100);
  const games = await Promise.all(refs.map(normalizeCoreGame));
  return {
    updatedAt: new Date().toISOString(),
    source: CORE_EVENTS_URL,
    games,
  };
}

function watchlistIdentity(request) {
  const authenticated = request.headers.get("oai-authenticated-user-email");
  if (authenticated) return "user:" + authenticated.toLowerCase();
  const device = (request.headers.get("x-ncaaf-device") || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return device ? "device:" + device : null;
}

async function watchlistResponse(request, env) {
  if (!env?.DB) return jsonResponse({ error: "Cloud watchlists are not configured." }, 503);
  const identity = watchlistIdentity(request);
  if (!identity) return jsonResponse({ error: "A device identity is required." }, 400);
  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT payload, updated_at FROM watchlists WHERE identity = ?").bind(identity).first();
    return jsonResponse({ watchlist: row ? JSON.parse(row.payload) : [], updatedAt: row?.updated_at || null, scope: identity.startsWith("user:") ? "account" : "device" });
  }
  if (request.method === "PUT") {
    const body = await request.json();
    const watchlist = Array.isArray(body.watchlist) ? body.watchlist.slice(0, 20).map((row) => ({ team: String(row.team || "").slice(0, 80), threshold: Math.max(0, Math.min(1, Number(row.threshold || 0))) })).filter((row) => row.team) : [];
    await env.DB.prepare("INSERT INTO watchlists (identity, payload, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(identity) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP").bind(identity, JSON.stringify(watchlist)).run();
    return jsonResponse({ watchlist, saved: true, scope: identity.startsWith("user:") ? "account" : "device" });
  }
  return jsonResponse({ error: "Method not allowed." }, 405);
}

function responseFor(route, status = 200) {
  const asset = ROUTES[route];

  if (!asset) {
    return null;
  }

  const isLiveData = route.startsWith("/data/") || route.endsWith(".json");
  return new Response(asset.body, {
    status,
    headers: {
      "cache-control": route === "/index.html" || isLiveData ? "no-cache" : "public, max-age=31536000, immutable",
      "content-type": asset.contentType,
      "x-ncaaf-dashboard": "embedded-worker",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/scores") {
      try {
        return jsonResponse(await fetchScores());
      } catch (error) {
        return jsonResponse({ updatedAt: new Date().toISOString(), error: error.message, games: [] }, 502);
      }
    }
    if (url.pathname === "/api/watchlist") {
      try {
        return await watchlistResponse(request, env);
      } catch (error) {
        return jsonResponse({ error: error.message }, 500);
      }
    }

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
await mkdir(join(distDir, ".openai"), { recursive: true });
await cp(join(process.cwd(), ".openai", "hosting.json"), join(distDir, ".openai", "hosting.json"), { force: true });
await cp(join(process.cwd(), "drizzle"), join(distDir, "drizzle"), { recursive: true, force: true });
