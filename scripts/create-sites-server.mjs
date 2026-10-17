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

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-cache",
      "content-type": "application/json; charset=utf-8",
      "x-ncaaf-dashboard": "embedded-worker",
      ...headers,
    },
  });
}

function publicJsonResponse(body, status = 200) {
  return jsonResponse(body, status, {
    "cache-control": "public, max-age=60, stale-while-revalidate=300",
  });
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function embeddedJson(route) {
  const asset = ROUTES[route];
  if (!asset) throw new ApiError(404, "Dataset not found.");
  try {
    return JSON.parse(asset.body);
  } catch {
    throw new ApiError(500, "Embedded dataset is invalid.");
  }
}

function requireMethod(request, methods) {
  if (!methods.includes(request.method)) {
    throw new ApiError(405, "Method not allowed.");
  }
}

function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin && origin !== new URL(request.url).origin) || fetchSite === "cross-site") {
    throw new ApiError(403, "Cross-origin requests are not allowed.");
  }
}

async function readJsonBody(request, maxBytes = 32768) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) throw new ApiError(413, "Request body is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new ApiError(413, "Request body is too large.");
  if (!text) throw new ApiError(400, "A JSON request body is required.");
  try {
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("object required");
    return value;
  } catch {
    throw new ApiError(400, "Request body must be a JSON object.");
  }
}

function boundedText(value, field, max, required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new ApiError(400, field + " is required.");
  if (text.length > max) throw new ApiError(400, field + " must be " + max + " characters or fewer.");
  return text;
}

function boundedInteger(value, field, min, max, nullable = false) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new ApiError(400, field + " must be an integer from " + min + " to " + max + ".");
  }
  return number;
}

function sanitizeStructured(value, depth = 0, budget = { nodes: 0 }) {
  budget.nodes += 1;
  if (budget.nodes > 600 || depth > 7) throw new ApiError(400, "Structured payload is too complex.");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ApiError(400, "Structured payload contains an invalid number.");
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 2000) throw new ApiError(400, "Structured payload strings are limited to 2,000 characters.");
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw new ApiError(400, "Structured payload arrays are limited to 100 items.");
    return value.map((item) => sanitizeStructured(item, depth + 1, budget));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > 80) throw new ApiError(400, "Structured payload objects are limited to 80 fields.");
    const result = {};
    for (const [key, item] of entries) {
      if (!key || key.length > 64 || key === "__proto__" || key === "constructor" || key === "prototype") {
        throw new ApiError(400, "Structured payload contains an invalid field name.");
      }
      result[key] = sanitizeStructured(item, depth + 1, budget);
    }
    return result;
  }
  throw new ApiError(400, "Structured payload contains an unsupported value.");
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
  const device = (request.headers.get("x-ncaaf-device") || new URL(request.url).searchParams.get("device") || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
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
    assertSameOrigin(request);
    const body = await readJsonBody(request, 8192);
    const watchlist = Array.isArray(body.watchlist) ? body.watchlist.slice(0, 20).map((row) => {
      const threshold = Number(row?.threshold ?? 0);
      return {
        team: boundedText(row?.team, "team", 80),
        threshold: Number.isFinite(threshold) ? Math.max(0, Math.min(1, threshold)) : 0,
      };
    }).filter((row) => row.team) : [];
    await env.DB.prepare("INSERT INTO watchlists (identity, payload, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(identity) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP").bind(identity, JSON.stringify(watchlist)).run();
    return jsonResponse({ watchlist, saved: true, scope: identity.startsWith("user:") ? "account" : "device" });
  }
  return jsonResponse({ error: "Method not allowed." }, 405);
}

function storageContext(request, env) {
  if (!env?.DB) throw new ApiError(503, "Cloud storage is not configured.");
  const identity = watchlistIdentity(request);
  if (!identity) throw new ApiError(400, "An account or device identity is required.");
  return {
    db: env.DB,
    identity,
    scope: identity.startsWith("user:") ? "account" : "device",
  };
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function scenarioIdFromPath(pathname) {
  const match = pathname.match(/^\\/api\\/scenarios\\/([^/]+)$/);
  if (!match) return null;
  let id;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    throw new ApiError(400, "Scenario id is invalid.");
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new ApiError(400, "Scenario id must use letters, numbers, underscores, or hyphens.");
  return id;
}

function scenarioFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    season: row.season,
    week: row.week,
    description: row.description,
    state: safeJson(row.payload, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function scenariosResponse(request, env, pathname) {
  const { db, identity, scope } = storageContext(request, env);
  const id = scenarioIdFromPath(pathname);
  if (pathname !== "/api/scenarios" && !id) throw new ApiError(404, "Scenario route not found.");
  if (request.method === "GET") {
    if (id) {
      const row = await db.prepare("SELECT id, name, season, week, description, payload, created_at, updated_at FROM saved_scenarios WHERE identity = ? AND id = ?").bind(identity, id).first();
      if (!row) throw new ApiError(404, "Scenario not found.");
      return jsonResponse({ scenario: scenarioFromRow(row), scope });
    }
    const result = await db.prepare("SELECT id, name, season, week, description, payload, created_at, updated_at FROM saved_scenarios WHERE identity = ? ORDER BY updated_at DESC LIMIT 25").bind(identity).all();
    return jsonResponse({ scenarios: (result.results || []).map(scenarioFromRow), scope, limit: 25 });
  }
  if (request.method === "PUT") {
    if (!id) throw new ApiError(400, "A scenario id is required in the URL.");
    assertSameOrigin(request);
    const body = await readJsonBody(request, 32768);
    const name = boundedText(body.name, "name", 80, true);
    const season = boundedInteger(body.season, "season", 2000, 2100);
    const week = boundedInteger(body.week, "week", 0, 25, true);
    const description = boundedText(body.description, "description", 500);
    const state = sanitizeStructured(body.state ?? {});
    const existing = await db.prepare("SELECT id FROM saved_scenarios WHERE identity = ? AND id = ?").bind(identity, id).first();
    if (!existing) {
      const count = await db.prepare("SELECT COUNT(*) AS count FROM saved_scenarios WHERE identity = ?").bind(identity).first();
      if (Number(count?.count || 0) >= 25) throw new ApiError(409, "The saved-scenario limit of 25 has been reached.");
    }
    await db.prepare("INSERT INTO saved_scenarios (identity, id, name, season, week, description, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(identity, id) DO UPDATE SET name = excluded.name, season = excluded.season, week = excluded.week, description = excluded.description, payload = excluded.payload, updated_at = CURRENT_TIMESTAMP").bind(identity, id, name, season, week, description, JSON.stringify(state)).run();
    const row = await db.prepare("SELECT id, name, season, week, description, payload, created_at, updated_at FROM saved_scenarios WHERE identity = ? AND id = ?").bind(identity, id).first();
    return jsonResponse({ scenario: scenarioFromRow(row), saved: true, scope }, existing ? 200 : 201);
  }
  if (request.method === "DELETE") {
    if (!id) throw new ApiError(400, "A scenario id is required in the URL.");
    assertSameOrigin(request);
    const result = await db.prepare("DELETE FROM saved_scenarios WHERE identity = ? AND id = ?").bind(identity, id).run();
    if (!result.meta?.changes) throw new ApiError(404, "Scenario not found.");
    return jsonResponse({ id, deleted: true, scope });
  }
  throw new ApiError(405, "Method not allowed.");
}

function normalizePreferences(body) {
  const favoriteTeams = Array.isArray(body.favoriteTeams)
    ? [...new Set(body.favoriteTeams.slice(0, 25).map((team) => boundedText(team, "favoriteTeams item", 80)).filter(Boolean))]
    : [];
  const alertInput = body.alerts && typeof body.alerts === "object" && !Array.isArray(body.alerts) ? body.alerts : {};
  const displayInput = body.display && typeof body.display === "object" && !Array.isArray(body.display) ? body.display : {};
  const threshold = Number(alertInput.probabilityMoveThreshold ?? 0.05);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new ApiError(400, "alerts.probabilityMoveThreshold must be from 0 to 1.");
  const density = ["compact", "comfortable"].includes(displayInput.density) ? displayInput.density : "comfortable";
  return {
    favoriteTeams,
    alerts: {
      enabled: Boolean(alertInput.enabled),
      probabilityMoveThreshold: threshold,
      elimination: alertInput.elimination !== false,
      liveGames: Boolean(alertInput.liveGames),
      weeklyDigest: alertInput.weeklyDigest !== false,
      browser: Boolean(alertInput.browser),
    },
    display: {
      defaultView: boundedText(displayInput.defaultView, "display.defaultView", 40) || "overview",
      density,
    },
  };
}

async function preferencesResponse(request, env) {
  const { db, identity, scope } = storageContext(request, env);
  if (request.method === "GET") {
    const row = await db.prepare("SELECT payload, updated_at FROM user_preferences WHERE identity = ?").bind(identity).first();
    return jsonResponse({ preferences: row ? safeJson(row.payload, normalizePreferences({})) : normalizePreferences({}), updatedAt: row?.updated_at || null, scope });
  }
  if (request.method === "PUT") {
    assertSameOrigin(request);
    const preferences = normalizePreferences(await readJsonBody(request, 12288));
    await db.prepare("INSERT INTO user_preferences (identity, payload, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(identity) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP").bind(identity, JSON.stringify(preferences)).run();
    return jsonResponse({ preferences, saved: true, scope });
  }
  if (request.method === "DELETE") {
    assertSameOrigin(request);
    await db.prepare("DELETE FROM user_preferences WHERE identity = ?").bind(identity).run();
    return jsonResponse({ preferences: normalizePreferences({}), deleted: true, scope });
  }
  throw new ApiError(405, "Method not allowed.");
}

function alertFromRow(row) {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    team: row.team,
    title: row.title,
    message: row.message,
    data: safeJson(row.payload, {}),
    createdAt: row.created_at,
    acknowledgedAt: row.acknowledged_at,
  };
}

function alertAcknowledgementId(pathname) {
  const match = pathname.match(/^\\/api\\/alerts\\/([^/]+)\\/acknowledgement$/);
  if (!match) return null;
  let id;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    throw new ApiError(400, "Alert id is invalid.");
  }
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new ApiError(400, "Alert id is invalid.");
  return id;
}

async function alertsResponse(request, env, url) {
  const { db, identity, scope } = storageContext(request, env);
  const acknowledgementId = alertAcknowledgementId(url.pathname);
  if (acknowledgementId) {
    requireMethod(request, ["PUT", "DELETE"]);
    assertSameOrigin(request);
    const result = request.method === "PUT"
      ? await db.prepare("UPDATE alert_events SET acknowledged_at = CURRENT_TIMESTAMP WHERE identity = ? AND id = ?").bind(identity, acknowledgementId).run()
      : await db.prepare("UPDATE alert_events SET acknowledged_at = NULL WHERE identity = ? AND id = ?").bind(identity, acknowledgementId).run();
    if (!result.meta?.changes) throw new ApiError(404, "Alert event not found.");
    return jsonResponse({ id: acknowledgementId, acknowledged: request.method === "PUT", scope });
  }
  if (url.pathname !== "/api/alerts") throw new ApiError(404, "Alert route not found.");
  requireMethod(request, ["GET"]);
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "50", 10) || 50));
  const status = url.searchParams.get("status") || "all";
  if (!["all", "unread", "acknowledged"].includes(status)) throw new ApiError(400, "status must be all, unread, or acknowledged.");
  const condition = status === "unread" ? " AND acknowledged_at IS NULL" : status === "acknowledged" ? " AND acknowledged_at IS NOT NULL" : "";
  const result = await db.prepare("SELECT id, type, severity, team, title, message, payload, created_at, acknowledged_at FROM alert_events WHERE identity = ?" + condition + " ORDER BY created_at DESC LIMIT ?").bind(identity, limit).all();
  const count = await db.prepare("SELECT COUNT(*) AS count FROM alert_events WHERE identity = ? AND acknowledged_at IS NULL").bind(identity).first();
  return jsonResponse({ alerts: (result.results || []).map(alertFromRow), unreadCount: Number(count?.count || 0), status, limit, scope });
}

function apiEnvelope(data, core, extra = {}) {
  return {
    apiVersion: "1.0",
    season: Number(extra.season ?? core.meta?.currentSeason ?? core.meta?.updatedSeason),
    week: extra.week ?? core.meta?.dataHealth?.latestWeek ?? null,
    snapshotId: extra.snapshotId ?? core.weeklyReport?.snapshotId ?? null,
    updatedAt: core.meta?.dataHealth?.lastUpdatedAt || null,
    data,
  };
}

function weeklyShard(year) {
  return embeddedJson("/data/weekly-" + year + ".json");
}

function apiSelection(url) {
  const core = embeddedJson("/data/app-core.json");
  const defaultSeason = Number(core.meta?.currentSeason || core.meta?.updatedSeason);
  const seasonValue = url.searchParams.get("season");
  const season = seasonValue === null ? defaultSeason : boundedInteger(seasonValue, "season", 2005, 2100);
  const shard = weeklyShard(season);
  const snapshots = Array.isArray(shard.snapshots) ? shard.snapshots : [];
  const weekValue = url.searchParams.get("week");
  const requestedWeek = weekValue === null ? null : boundedInteger(weekValue, "week", 0, 25);
  const snapshot = requestedWeek === null
    ? snapshots[snapshots.length - 1]
    : snapshots.find((item) => Number(item.week) === requestedWeek);
  if (!snapshot) throw new ApiError(404, "No weekly forecast exists for the requested season and week.");
  return { core, season, shard, snapshot };
}

function probability(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function teamKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sameTeam(left, right) {
  const a = teamKey(left);
  const b = teamKey(right);
  return Boolean(a && b && (a === b || (a.length >= 5 && b.startsWith(a)) || (b.length >= 5 && a.startsWith(b))));
}

function findTeam(records, name) {
  return (records || []).find((record) => sameTeam(record.Team, name));
}

function rankingRecord(record, probabilityOverride = null, rankOverride = null) {
  return {
    rank: rankOverride ?? record.predictedRank ?? record.mlPredictedRank ?? null,
    team: record.Team,
    record: record.RECORD || null,
    championProbability: probabilityOverride ?? probability(record.championProbability ?? record.mlChampionProbability),
    playoffProbability: probability(record["CFP Selection Probability"]),
    projectedSeed: record["Projected CFP Seed"] ?? null,
    apRank: record["AP POLL"] ?? null,
    fpiRank: record.FPI ?? null,
    strengthOfRecordRank: record.SOR ?? null,
    strengthOfScheduleRank: record.SOS ?? null,
    gameControlRank: record["Game Control"] ?? null,
    scoringMargin: probability(record["Scoring Margin"]),
    gameElo: probability(record["Game Elo"]),
    expectedRemainingWins: probability(record["Expected Remaining Wins"]),
    opponentAdjustedSuccessRate: probability(record["Opponent Adjusted Success Rate"]),
    opponentAdjustedEpaPerPlay: probability(record["Opponent Adjusted EPA Per Play"]),
    modelDisagreement: probability(record.modelProbabilityStdDev),
  };
}

function modelRanking(snapshot, modelName) {
  if (!modelName) return null;
  const model = (snapshot.modelPredictions || []).find((item) => String(item.model).toLowerCase() === modelName.toLowerCase());
  if (!model) throw new ApiError(404, "Requested model was not found for this snapshot.");
  const ordered = Object.entries(model.probabilities || {}).sort((a, b) => Number(b[1]) - Number(a[1]));
  return { model, ranks: new Map(ordered.map(([team, value], index) => [teamKey(team), { probability: Number(value), rank: index + 1 }])) };
}

function forecastApi(url) {
  const { core, season, snapshot } = apiSelection(url);
  const limit = Math.min(25, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "12", 10) || 12));
  const contenders = (snapshot.records || []).slice().sort((a, b) => Number(a.predictedRank || 999) - Number(b.predictedRank || 999)).slice(0, limit).map((record) => rankingRecord(record));
  const projectedField = (snapshot.records || []).filter((record) => record["Projected CFP Seed"]).sort((a, b) => Number(a["Projected CFP Seed"]) - Number(b["Projected CFP Seed"])).slice(0, 12).map((record) => ({
    seed: record["Projected CFP Seed"],
    team: record.Team,
    playoffProbability: probability(record["CFP Selection Probability"]),
    championProbability: probability(record.championProbability),
  }));
  return publicJsonResponse(apiEnvelope({
    leader: {
      team: snapshot.predictedChampion,
      championProbability: probability(snapshot.predictedProbability),
    },
    topContenders: contenders,
    projectedPlayoffField: projectedField,
    modelCount: (snapshot.modelPredictions || []).length,
    sourceUrl: snapshot.sourceUrl || null,
    capturedAt: snapshot.capturedAt || null,
    frozen: Boolean(snapshot.isFrozen),
  }, core, { season, week: snapshot.week, snapshotId: snapshot.snapshotId }));
}

function rankingsApi(url) {
  const { core, season, snapshot } = apiSelection(url);
  const limit = Math.min(25, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "25", 10) || 25));
  const selectedModel = modelRanking(snapshot, url.searchParams.get("model"));
  let rankings = (snapshot.records || []).map((record) => {
    const modelValue = selectedModel?.ranks.get(teamKey(record.Team));
    return rankingRecord(record, modelValue?.probability ?? null, modelValue?.rank ?? null);
  });
  rankings.sort((a, b) => Number(a.rank || 999) - Number(b.rank || 999));
  rankings = rankings.slice(0, limit);
  return publicJsonResponse(apiEnvelope({
    model: selectedModel?.model.model || "Weekly ML Ensemble",
    rankings,
    availableModels: (snapshot.modelPredictions || []).map((item) => item.model),
  }, core, { season, week: snapshot.week, snapshotId: snapshot.snapshotId }));
}

function teamApi(url, pathname) {
  const { core, season, shard, snapshot } = apiSelection(url);
  let requested;
  try {
    requested = decodeURIComponent(pathname.slice("/api/v1/teams/".length));
  } catch {
    throw new ApiError(400, "Team name is invalid.");
  }
  requested = boundedText(requested, "team", 100, true);
  const record = findTeam(snapshot.records, requested);
  if (!record) throw new ApiError(404, "Team was not found in the requested ranking snapshot.");
  const history = (shard.snapshots || []).map((item) => {
    const weekly = findTeam(item.records, record.Team);
    return weekly ? {
      week: item.week,
      rank: weekly.predictedRank ?? weekly.mlPredictedRank ?? null,
      championProbability: probability(weekly.championProbability ?? weekly.mlChampionProbability),
      playoffProbability: probability(weekly["CFP Selection Probability"]),
      record: weekly.RECORD || null,
      snapshotId: item.snapshotId || null,
    } : null;
  }).filter(Boolean);
  const games = (core.seasonSchedule?.games || []).filter((game) => (game.competitors || []).some((competitor) => sameTeam(competitor.team, record.Team))).slice(0, 20);
  return publicJsonResponse(apiEnvelope({
    team: rankingRecord(record),
    predictionReasons: record.predictionReasons || null,
    metrics: {
      resumeComposite: probability(record["Resume Composite"]),
      powerComposite: probability(record["Power Composite"]),
      consensusScore: probability(record["Consensus Score"]),
      consistencyScore: probability(record["Consistency Score"]),
      pointsFor: probability(record["Points For"]),
      pointsAgainst: probability(record["Points Against"]),
      recentForm: probability(record["Recent Form"]),
      rankedWins: probability(record["Ranked Wins"]),
      playSuccessRate: probability(record["Play Success Rate"]),
      estimatedEpaPerPlay: probability(record["Estimated EPA Per Play"]),
      defensiveSuccessAllowed: probability(record["Defensive Success Allowed"]),
      estimatedEpaAllowedPerPlay: probability(record["Estimated EPA Allowed Per Play"]),
    },
    weeklyHistory: history,
    schedule: games,
  }, core, { season, week: snapshot.week, snapshotId: snapshot.snapshotId }));
}

function computedWeeklyReport(core, shard, snapshot) {
  if (Number(core.weeklyReport?.season) === Number(snapshot.year) && Number(core.weeklyReport?.week) === Number(snapshot.week)) {
    return core.weeklyReport;
  }
  const index = (shard.snapshots || []).findIndex((item) => item.snapshotId === snapshot.snapshotId);
  const previous = index > 0 ? shard.snapshots[index - 1] : null;
  const movements = (snapshot.records || []).map((record) => {
    const oldRecord = findTeam(previous?.records, record.Team);
    return {
      team: record.Team,
      probability: probability(record.championProbability),
      change: Number(record.championProbability || 0) - Number(oldRecord?.championProbability || 0),
    };
  });
  return {
    season: snapshot.year,
    week: snapshot.week,
    leader: snapshot.predictedChampion,
    leaderProbability: probability(snapshot.predictedProbability),
    leaderChanged: Boolean(previous && previous.predictedChampion !== snapshot.predictedChampion),
    biggestRisers: movements.slice().sort((a, b) => b.change - a.change).slice(0, 3),
    biggestFallers: movements.slice().sort((a, b) => a.change - b.change).slice(0, 3),
    projectedField: (snapshot.records || []).filter((record) => record["Projected CFP Seed"]).sort((a, b) => Number(a["Projected CFP Seed"]) - Number(b["Projected CFP Seed"])).slice(0, 12).map((record) => ({ seed: record["Projected CFP Seed"], team: record.Team, probability: record["CFP Selection Probability"] })),
    modelAgreement: (snapshot.modelPredictions || []).map((model) => ({ model: model.model, predictedChampion: model.predictedChampion, predictedProbability: model.predictedProbability })),
    snapshotId: snapshot.snapshotId,
    capturedAt: snapshot.capturedAt || null,
    lastCheckedAt: snapshot.lastCheckedAt || null,
    isFrozen: Boolean(snapshot.isFrozen),
  };
}

function weeklyReportApi(url) {
  const { core, season, shard, snapshot } = apiSelection(url);
  return publicJsonResponse(apiEnvelope(computedWeeklyReport(core, shard, snapshot), core, { season, week: snapshot.week, snapshotId: snapshot.snapshotId }));
}

function modelsApi(url) {
  const { core, season, snapshot } = apiSelection(url);
  const modelSummaries = (snapshot.modelPredictions || []).map((model) => ({
    model: model.model,
    predictedChampion: model.predictedChampion,
    predictedProbability: probability(model.predictedProbability),
    trainedSeasons: model.trainedSeasons ?? null,
  }));
  return publicJsonResponse(apiEnvelope({
    selectedModel: core.meta?.selectedModel || null,
    snapshotModels: modelSummaries,
    seasonBacktests: core.models || [],
    weeklyDiagnostics: core.weeklyModelDiagnostics || [],
    weeklyCalibration: core.weeklyCalibration || [],
    gameModel: core.gameModel || null,
    selectionModel: core.selectionModel || null,
    registry: core.modelRegistry || [],
    featureImportance: core.featureImportance || [],
  }, core, { season, week: snapshot.week, snapshotId: snapshot.snapshotId }));
}

function conferenceRacesApi(url) {
  const { core, season, snapshot } = apiSelection(url);
  const standings = new Map();
  for (const game of core.seasonSchedule?.games || []) {
    if (!game.conferenceGame || !game.conference || Number(game.week || 0) > Number(snapshot.week || 25)) continue;
    if (!standings.has(game.conference)) standings.set(game.conference, new Map());
    const conference = standings.get(game.conference);
    for (const competitor of game.competitors || []) {
      if (!conference.has(competitor.team)) conference.set(competitor.team, { team: competitor.team, conferenceWins: 0, conferenceLosses: 0, conferenceGames: 0 });
      const team = conference.get(competitor.team);
      if (game.completed) {
        team.conferenceGames += 1;
        if (competitor.winner) team.conferenceWins += 1;
        else team.conferenceLosses += 1;
      }
    }
  }
  const races = [...standings.entries()].map(([conference, teamMap]) => {
    const teams = [...teamMap.values()].map((team) => {
      const record = findTeam(snapshot.records, team.team);
      const winPct = team.conferenceGames ? team.conferenceWins / team.conferenceGames : 0;
      const playoffProbability = probability(record?.["CFP Selection Probability"]) || 0;
      const championProbability = probability(record?.championProbability) || 0;
      return {
        ...team,
        conferenceWinPct: winPct,
        nationalRank: record?.predictedRank ?? null,
        playoffProbability,
        championProbability,
        projectionScore: winPct * 0.5 + playoffProbability * 0.3 + championProbability * 0.2,
      };
    }).sort((a, b) => b.projectionScore - a.projectionScore || b.conferenceWins - a.conferenceWins || a.conferenceLosses - b.conferenceLosses);
    return {
      conference,
      projectedChampion: teams[0]?.team || null,
      teams: teams.slice(0, 20),
    };
  }).sort((a, b) => a.conference.localeCompare(b.conference));
  return publicJsonResponse(apiEnvelope({
    races,
    projectionMethod: "50% conference win percentage, 30% CFP selection probability, 20% national champion probability",
  }, core, { season, week: snapshot.week, snapshotId: snapshot.snapshotId }));
}

function healthApi() {
  const core = embeddedJson("/data/app-core.json");
  return publicJsonResponse(apiEnvelope({
    status: core.dataQuality?.status || core.meta?.dataHealth?.status || "unknown",
    dataHealth: core.meta?.dataHealth || null,
    dataQuality: core.dataQuality || null,
    provenance: {
      sources: core.meta?.sources || [],
      trainingSeasons: core.meta?.trainingSeasons || null,
      holdoutSeason: core.meta?.holdoutSeason || null,
      modelEvaluation: core.meta?.modelEvaluation || null,
      weeklyModelMethod: core.meta?.weeklyModelMethod || null,
      registries: core.modelRegistry || [],
      gameFeatureSchema: core.gameModel?.featureSchema || null,
      gameModelVersion: core.gameModel?.version || null,
      selectionModelVersion: core.selectionModel?.version || null,
    },
  }, core));
}

function publicApiResponse(request, url) {
  requireMethod(request, ["GET"]);
  if (url.pathname === "/api/v1") {
    return publicJsonResponse({
      apiVersion: "1.0",
      routes: [
        "/api/v1/forecast",
        "/api/v1/rankings",
        "/api/v1/teams/{team}",
        "/api/v1/weekly-report",
        "/api/v1/models",
        "/api/v1/conference-races",
        "/api/v1/health",
      ],
    });
  }
  if (url.pathname === "/api/v1/forecast") return forecastApi(url);
  if (url.pathname === "/api/v1/rankings") return rankingsApi(url);
  if (url.pathname.startsWith("/api/v1/teams/")) return teamApi(url, url.pathname);
  if (url.pathname === "/api/v1/weekly-report") return weeklyReportApi(url);
  if (url.pathname === "/api/v1/models") return modelsApi(url);
  if (url.pathname === "/api/v1/conference-races") return conferenceRacesApi(url);
  if (url.pathname === "/api/v1/health") return healthApi();
  throw new ApiError(404, "API route not found.");
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
    try {
      if (url.pathname === "/api/scores") {
        requireMethod(request, ["GET"]);
        return jsonResponse(await fetchScores());
      }
      if (url.pathname === "/api/watchlist") {
        return await watchlistResponse(request, env);
      }
      if (url.pathname === "/api/scenarios" || url.pathname.startsWith("/api/scenarios/")) {
        return await scenariosResponse(request, env, url.pathname);
      }
      if (url.pathname === "/api/preferences") {
        return await preferencesResponse(request, env);
      }
      if (url.pathname === "/api/alerts" || url.pathname.startsWith("/api/alerts/")) {
        return await alertsResponse(request, env, url);
      }
      if (url.pathname === "/api/v1" || url.pathname.startsWith("/api/v1/")) {
        return publicApiResponse(request, url);
      }
      if (url.pathname.startsWith("/api/")) {
        throw new ApiError(404, "API route not found.");
      }

      const route = url.pathname === "/" ? "/index.html" : url.pathname;
      const assetResponse = responseFor(route);

      if (assetResponse) {
        return assetResponse;
      }

      return responseFor("/index.html", 200);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : (url.pathname === "/api/scores" ? 502 : 500);
      const body = url.pathname === "/api/scores"
        ? { updatedAt: new Date().toISOString(), error: error.message, games: [] }
        : { error: status >= 500 ? "The request could not be completed." : error.message };
      return jsonResponse(body, status);
    }
  },
};
`;

await mkdir(serverDir, { recursive: true });
await writeFile(serverEntry, source);
await mkdir(join(distDir, ".openai"), { recursive: true });
await cp(join(process.cwd(), ".openai", "hosting.json"), join(distDir, ".openai", "hosting.json"), { force: true });
await cp(join(process.cwd(), "drizzle"), join(distDir, "drizzle"), { recursive: true, force: true });
