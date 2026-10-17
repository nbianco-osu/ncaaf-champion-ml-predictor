const state = {
  data: null,
  scores: [],
  query: "",
  sortMode: "predictedRank",
  selectedYear: null,
  weeklyYear: null,
  weeklyModel: "Weekly ML Ensemble",
  movementCount: 8,
  currentView: "overview",
  watchlist: JSON.parse(localStorage.getItem("ncaaf-watchlist") || "[]"),
  scenarioPicks: {},
  bracketPicks: {},
  teamPage: null,
  replayYear: null,
  replayWeek: null,
};

const fmtPct = (value) => (Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : "-");
const fmtRank = (value) => (Number.isFinite(Number(value)) ? Number(value).toLocaleString() : "-");
const fmtScore = (value) => (Number.isFinite(Number(value)) ? String(value) : "-");
const fmtDecimal = (value, digits = 2) => (Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "-");
const fmtSigned = (value, digits = 1) => {
  if (!Number.isFinite(Number(value))) return "-";
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${number.toFixed(digits)}`;
};
const max = (items, key) => Math.max(...items.map((item) => Number(item[key])));
const chartColors = ["#176b87", "#c44f3b", "#4e7a3e", "#8a5b9d", "#d08a19", "#3659a2", "#a83f70", "#55706e", "#7e642f", "#277d65"];
const teamLogoIds = {
  Alabama: 333,
  Arizona: 12,
  BYU: 252,
  Clemson: 228,
  "Florida State": 52,
  Georgia: 61,
  "Georgia Tech": 59,
  Houston: 248,
  Indiana: 84,
  Iowa: 2294,
  LSU: 99,
  Miami: 2390,
  Michigan: 130,
  Missouri: 142,
  "Notre Dame": 87,
  "Ohio State": 194,
  Oklahoma: 201,
  "Ole Miss": 145,
  Oregon: 2483,
  "Penn State": 213,
  TCU: 2628,
  Tennessee: 2633,
  Texas: 251,
  "Texas A&M": 245,
  "Texas Tech": 2641,
  USC: 30,
  Utah: 254,
  Washington: 264,
};

function logoUrl(team) {
  const id = teamLogoIds[team];
  return id ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png` : "";
}

function currentSeason() {
  return state.data.seasonPredictions[state.selectedYear];
}

function currentWeeklyRows() {
  return state.data.weeklyPredictions?.[state.weeklyYear] || [];
}

async function loadWeeklyYear(year) {
  const key = String(year);
  if (state.data.weeklyPredictions?.[key]) return;
  const response = await fetch(`./data/weekly-${key}.json?v=${state.data.meta.dataVersion || state.data.meta.dataHealth?.lastUpdatedAt || "1"}`);
  if (!response.ok) throw new Error(`Weekly ${key} data returned ${response.status}`);
  const shard = await response.json();
  state.data.weeklyPredictions[key] = shard.snapshots || [];
}

function seasonYears() {
  return Object.keys(state.data.seasonPredictions).sort((a, b) => Number(b) - Number(a));
}

function bySortMode(a, b) {
  if (state.sortMode === "championProbability") {
    return b.championProbability - a.championProbability;
  }
  return Number(a[state.sortMode]) - Number(b[state.sortMode]);
}

function filteredRows() {
  return currentSeason()
    .records.filter((row) => row.Team.toLowerCase().includes(state.query.toLowerCase()))
    .sort(bySortMode);
}

function renderSummary() {
  const { summary, meta } = state.data;
  const season = currentSeason();
  const isCurrentSeason = Boolean(season.isCurrentSeason);
  document.getElementById("predictedChampion").textContent = season.predictedChampion;
  document.getElementById("predictionNote").textContent = isCurrentSeason
    ? `${fmtPct(season.topProbability)} probability after week ${season.latestWeek}.`
    : `${fmtPct(season.topProbability)} model probability for the ${season.year} page.`;
  document.getElementById("actualChampion").textContent = season.actualChampion;
  document.getElementById("actualRankNote").textContent = isCurrentSeason
    ? "Current season in progress."
    : `Actual champion projected rank: ${season.actualChampionPredictedRank}.`;
  document.getElementById("chartSeasonLabel").textContent = `${season.year} top 10`;
  document.getElementById("tableSeasonLabel").textContent = isCurrentSeason ? `Current ${season.year} snapshot` : `Final ${season.year} top 25`;
  document.getElementById("weeklySeasonLabel").textContent = `${state.weeklyYear} week by week`;
  document.getElementById("hitRate").textContent = fmtPct(summary.backtestHitRate);
  document.getElementById("top3Rate").textContent = fmtPct(summary.backtestTop3Rate);
  document.getElementById("meanChampionRank").textContent = fmtDecimal(summary.meanChampionRank);
  document.getElementById("championNll").textContent = fmtDecimal(summary.meanChampionNll);
  document.getElementById("modelChip").textContent = isCurrentSeason ? "Weekly ML Ensemble" : meta.selectedModel;
  const weeklySelect = document.getElementById("weeklyModel");
  const weeklyModels = meta.weeklyModels || ["Balanced ML Blend"];
  if (!weeklySelect.options.length) {
    weeklySelect.innerHTML = weeklyModels.map((model) => `<option value="${model}">${model}</option>`).join("");
  }
  if (!weeklyModels.includes(state.weeklyModel)) {
    state.weeklyModel = weeklyModels[0];
  }
  weeklySelect.value = state.weeklyModel;
  const weeklyRows = currentWeeklyRows();
  const latest = weeklyRows.at(-1);
  document.getElementById("snapshotStatus").textContent = latest
    ? `${latest.isFrozen ? "Frozen" : "Provisional"} snapshot · W${latest.week}`
    : "No snapshot";
  document.querySelectorAll(".season-tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.year === state.selectedYear);
  });
}

function renderProbabilityChart() {
  const container = document.getElementById("probabilityChart");
  const rows = currentSeason().records.slice(0, 10);
  const cap = max(rows, "championProbability");
  container.innerHTML = rows
    .map((row) => {
      const width = Math.max(2, (row.championProbability / cap) * 100);
      return `
        <div class="bar-row">
          <strong>${logoUrl(row.Team) ? `<img class="team-logo-small" src="${logoUrl(row.Team)}" alt="" />` : ""}${row.predictedRank}. ${row.Team}</strong>
          <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
          <span>${fmtPct(row.championProbability)}</span>
        </div>
      `;
    })
    .join("");
}

function renderPredictionExplanation() {
  const container = document.getElementById("predictionExplanation");
  const leader = currentSeason().records[0];
  const reasons = leader?.predictionReasons;
  if (!leader || !reasons) {
    container.innerHTML = "";
    return;
  }
  const strengths = reasons.strengths.map((item) => `${item.label} ${fmtDecimal(item.score, 0)}`).join(" and ");
  container.innerHTML = `
    <div><span>Why ${leader.Team} leads</span><strong>${strengths}</strong></div>
    <div><span>Primary risk</span><strong>${reasons.risk.label} ${fmtDecimal(reasons.risk.score, 0)}</strong></div>
    <div><span>Model rank</span><strong>#${leader.predictedRank} · ${fmtPct(leader.championProbability)}</strong></div>
  `;
}

function renderUncertainty() {
  const rows = currentSeason().records.slice(0, 6);
  const container = document.getElementById("uncertaintyPanel");
  container.innerHTML = rows.map((row) => {
    const low = Number(row.modelProbabilityMin ?? row.championProbability);
    const high = Number(row.modelProbabilityMax ?? row.championProbability);
    const mean = Number(row.modelProbabilityMean ?? row.championProbability);
    const spread = Number(row.modelProbabilityStdDev || 0);
    return `<div class="uncertainty-row">
      <div><strong>${row.Team}</strong><span>${fmtPct(mean)} mean · σ ${fmtPct(spread)}</span></div>
      <div class="uncertainty-track"><i style="left:${Math.min(100, low * 100)}%;width:${Math.max(2, (high - low) * 100)}%"></i><b style="left:${Math.min(100, mean * 100)}%"></b></div>
      <small>${fmtPct(low)}–${fmtPct(high)}</small>
    </div>`;
  }).join("");
}

function deviceIdentity() {
  let value = localStorage.getItem("ncaaf-device-id");
  if (!value) {
    value = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("ncaaf-device-id", value);
  }
  return value;
}

async function watchlistFetch(url, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function saveWatchlist() {
  localStorage.setItem("ncaaf-watchlist", JSON.stringify(state.watchlist));
  const status = document.getElementById("watchSyncStatus");
  try {
    const response = await watchlistFetch("/api/watchlist", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-ncaaf-device": deviceIdentity() },
      body: JSON.stringify({ watchlist: state.watchlist }),
    });
    if (!response.ok) throw new Error("sync unavailable");
    const payload = await response.json();
    status.textContent = `Synced to ${payload.scope === "account" ? "your account" : "this device"}`;
  } catch {
    status.textContent = "Saved in this browser; cloud sync unavailable";
  }
}

async function loadCloudWatchlist() {
  const status = document.getElementById("watchSyncStatus");
  try {
    const response = await watchlistFetch("/api/watchlist", { headers: { "x-ncaaf-device": deviceIdentity() } });
    if (!response.ok) throw new Error("sync unavailable");
    const payload = await response.json();
    if (payload.watchlist?.length) {
      state.watchlist = payload.watchlist;
      localStorage.setItem("ncaaf-watchlist", JSON.stringify(state.watchlist));
    } else if (state.watchlist.length) {
      await saveWatchlist();
      return;
    }
    status.textContent = `Synced to ${payload.scope === "account" ? "your account" : "this device"}`;
  } catch {
    status.textContent = "Saved in this browser; cloud sync unavailable";
  }
}

function renderWatchlist() {
  const rows = currentSeason().records;
  const weekly = state.data.weeklyPredictions?.[String(state.selectedYear)] || [];
  const latest = weekly.at(-1);
  const prior = weekly.at(-2);
  const container = document.getElementById("watchlistGrid");
  if (!state.watchlist.length) {
    container.innerHTML = `<p class="muted">Add contenders to track probability thresholds and weekly moves.</p>`;
    return;
  }
  container.innerHTML = state.watchlist.map((watch) => {
    const row = rows.find((item) => item.Team === watch.team);
    if (!row) return "";
    const now = latest?.records.find((item) => item.Team === watch.team)?.mlChampionProbability ?? row.championProbability;
    const before = prior?.records.find((item) => item.Team === watch.team)?.mlChampionProbability ?? now;
    const delta = Number(now) - Number(before);
    const hit = Number(now) >= Number(watch.threshold);
    const moved = Math.abs(delta) >= .02;
    return `<article class="watch-card ${hit || moved ? "has-alert" : ""}">
      <button class="watch-remove" data-remove-watch="${watch.team}" type="button" aria-label="Remove ${watch.team}">×</button>
      <div><strong>${watch.team}</strong><span>#${row.predictedRank} · ${fmtPct(now)}</span></div>
      <p>${hit ? `Threshold reached: ${fmtPct(watch.threshold)}` : moved ? `Moved ${fmtSigned(delta * 100)} pts this week` : `Weekly move ${fmtSigned(delta * 100)} pts`}</p>
      <label>Alert at <input data-watch-threshold="${watch.team}" type="number" min="1" max="90" step="1" value="${Math.round(Number(watch.threshold) * 100)}" />%</label>
    </article>`;
  }).join("");
  container.querySelectorAll("[data-remove-watch]").forEach((button) => button.addEventListener("click", () => {
    state.watchlist = state.watchlist.filter((item) => item.team !== button.dataset.removeWatch);
    saveWatchlist();
    renderWatchlist();
  }));
  container.querySelectorAll("[data-watch-threshold]").forEach((input) => input.addEventListener("change", () => {
    const watch = state.watchlist.find((item) => item.team === input.dataset.watchThreshold);
    if (watch) watch.threshold = Math.max(.01, Math.min(.9, Number(input.value) / 100));
    saveWatchlist();
    renderWatchlist();
  }));
}

function checkWatchlistAlerts() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const rows = currentSeason().records;
  const latestWeek = state.data.meta.dataHealth?.latestWeek || 0;
  const delivered = JSON.parse(localStorage.getItem("ncaaf-alerts-delivered") || "[]");
  for (const watch of state.watchlist) {
    const row = rows.find((item) => item.Team === watch.team);
    if (!row || Number(row.championProbability) < Number(watch.threshold)) continue;
    const key = `${latestWeek}:${watch.team}:${watch.threshold}`;
    if (delivered.includes(key)) continue;
    new Notification(`${watch.team} crossed your title threshold`, {
      body: `${fmtPct(row.championProbability)} championship probability after week ${latestWeek}.`,
      tag: key,
    });
    delivered.push(key);
  }
  localStorage.setItem("ncaaf-alerts-delivered", JSON.stringify(delivered.slice(-50)));
}

function renderAdvancedMetrics() {
  const rows = currentSeason().records;
  const select = document.getElementById("metricsTeam");
  const team = rows.find((row) => row.Team === select.value) || rows[0];
  const metrics = [
    ["Points/game", team["Points For"], (v) => fmtDecimal(v, 1)],
    ["Points allowed", team["Points Against"], (v) => fmtDecimal(v, 1)],
    ["Scoring margin", team["Scoring Margin"], (v) => fmtSigned(v, 1)],
    ["Last 3 margin", team["Recent Form"], (v) => fmtSigned(v, 1)],
    ["Ranked wins", team["Ranked Wins"], fmtRank],
    ["Close-game win", team["Close Game Win Pct"], fmtPct],
    ["Offense index", team["Offensive Index"], (v) => fmtDecimal(v, 0)],
    ["Defense index", team["Defensive Index"], (v) => fmtDecimal(v, 0)],
    ["Success rate", team["Play Success Rate"], fmtPct],
    ["Est. EPA/play", team["Estimated EPA Per Play"], (v) => fmtSigned(v, 3)],
    ["Explosive rate", team["Explosive Play Rate"], fmtPct],
    ["Early-down success", team["Early Down Success Rate"], fmtPct],
    ["Havoc rate", team["Havoc Rate"], fmtPct],
    ["Finishing drives", team["Finishing Drives"], fmtPct],
    ["Adj. success rate", team["Opponent Adjusted Success Rate"], fmtPct],
    ["Adj. EPA/play", team["Opponent Adjusted EPA Per Play"], (v) => fmtSigned(v, 3)],
    ["Def. success allowed", team["Defensive Success Allowed"], fmtPct],
    ["CFP field", team["CFP Selection Probability"], fmtPct],
    ["Game Elo", team["Game Elo"], (v) => fmtDecimal(v, 0)],
    ["Expected wins left", team["Expected Remaining Wins"], (v) => fmtDecimal(v, 1)],
  ];
  document.getElementById("advancedMetrics").innerHTML = metrics.map(([label, value, formatter]) => `<div><span>${label}</span><strong>${formatter(value)}</strong></div>`).join("");
  document.getElementById("metricAvailability").innerHTML = (state.data.meta.advancedMetrics || []).map((item) => `<div class="availability-item ${item.status}"><span>${item.name}</span><strong>${item.status}</strong><small>${item.source}</small></div>`).join("");
}

function renderTeamPage() {
  const rows = currentSeason().records;
  const select = document.getElementById("teamPageSelect");
  const team = rows.find((row) => row.Team === (state.teamPage || select.value)) || rows[0];
  state.teamPage = team.Team;
  select.value = team.Team;
  document.getElementById("teamPageTitle").textContent = team.Team;
  document.getElementById("teamPageSummary").innerHTML = [
    ["Title probability", fmtPct(team.championProbability)],
    ["CFP field probability", fmtPct(team["CFP Selection Probability"])],
    ["Model rank", `#${team.predictedRank}`],
    ["Game Elo", fmtDecimal(team["Game Elo"], 0)],
    ["Success rate", fmtPct(team["Play Success Rate"])],
    ["Adj. EPA/play", fmtSigned(team["Opponent Adjusted EPA Per Play"], 3)],
    ["Scoring margin", fmtSigned(team["Scoring Margin"], 1)],
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");

  const weekly = state.data.weeklyPredictions?.[String(state.data.meta.currentSeason)] || [];
  const values = weekly.map((snapshot) => ({ week: snapshot.week, value: snapshot.records.find((row) => row.Team === team.Team)?.mlChampionProbability })).filter((row) => row.value !== undefined);
  if (values.length) {
    const width = 900, height = 260, pad = { top: 24, right: 30, bottom: 38, left: 50 };
    const cap = Math.max(.1, ...values.map((row) => row.value)) * 1.15;
    const x = (index) => pad.left + index / Math.max(1, values.length - 1) * (width - pad.left - pad.right);
    const y = (value) => pad.top + (1 - value / cap) * (height - pad.top - pad.bottom);
    document.getElementById("teamPageTimeline").innerHTML = `<svg viewBox="0 0 ${width} ${height}"><polyline points="${values.map((row, index) => `${x(index)},${y(row.value)}`).join(" ")}"/><g>${values.map((row, index) => `<circle cx="${x(index)}" cy="${y(row.value)}" r="5"><title>Week ${row.week}: ${fmtPct(row.value)}</title></circle><text x="${x(index)}" y="${height - 12}" text-anchor="middle">W${row.week}</text>`).join("")}</g></svg>`;
  } else {
    document.getElementById("teamPageTimeline").innerHTML = `<p class="muted">No weekly probability history is available.</p>`;
  }

  const games = String(state.selectedYear) === String(state.data.meta.currentSeason)
    ? (state.data.seasonSchedule?.games || []).filter((game) => game.competitors?.some((item) => item.team === team.Team))
    : [];
  const nextGame = games.find((game) => !game.completed && game.gameModel);
  const factors = (nextGame?.gameModel?.factors || []).map((factor) => ({
    ...factor,
    impact: nextGame.gameModel.teamA === team.Team ? factor.impact : -factor.impact,
  }));
  const reasons = team.predictionReasons || { strengths: [], risk: {} };
  document.getElementById("teamExplanation").innerHTML = `<div class="explanation-list">
    ${reasons.strengths.map((item) => `<div><span>Champion-model signal</span><strong>${item.label}</strong><b>${fmtDecimal(item.score, 1)}</b></div>`).join("")}
    <div class="risk"><span>Weakest champion signal</span><strong>${reasons.risk.label || "Unavailable"}</strong><b>${fmtDecimal(reasons.risk.score, 1)}</b></div>
    ${factors.map((item) => `<div><span>Next-game logit contribution</span><strong>${item.feature}</strong><b>${fmtSigned(item.impact, 2)}</b></div>`).join("")}
    <p>Model range ${fmtPct(team.modelProbabilityMin)}–${fmtPct(team.modelProbabilityMax)} across ${state.data.predictionAudit?.modelCount || 0} weekly models.</p>
  </div>`;

  document.getElementById("teamSchedule").innerHTML = games.length ? games.map((game) => {
    const opponent = game.competitors.find((item) => item.team !== team.Team) || {};
    const model = game.gameModel;
    const probability = model ? (model.teamA === team.Team ? model.teamAWinProbability : model.teamBWinProbability) : null;
    const own = game.competitors.find((item) => item.team === team.Team) || {};
    const result = game.completed ? `${own.winner ? "W" : "L"} ${own.score}-${opponent.score}` : fmtPct(probability);
    return `<div class="team-game"><span>W${game.week}</span><strong>${own.homeAway === "away" ? "at " : "vs "}${opponent.team}</strong><b class="${game.completed && !own.winner ? "loss" : ""}">${result}</b><small>${game.completed ? "Final" : game.status || "Scheduled"}</small></div>`;
  }).join("") : `<p class="muted">Game probabilities are available for the current season.</p>`;
}

function renderGameModel() {
  const model = state.data.gameModel || {};
  document.getElementById("gameModelVersion").textContent = model.version || "Unavailable";
  document.getElementById("gameModelMetrics").innerHTML = [
    ["Training games", fmtRank(model.trainingGames)],
    ["Accuracy", fmtPct(model.accuracy)],
    ["Brier score", fmtDecimal(model.brier, 3)],
    ["Log loss", fmtDecimal(model.logLoss, 3)],
  ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join("");
  const rows = model.forwardValidation || [];
  const width = 800, height = 250, pad = { top: 24, right: 25, bottom: 38, left: 48 };
  const x = (index) => pad.left + index / Math.max(1, rows.length - 1) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - value) * (height - pad.top - pad.bottom);
  document.getElementById("gameModelChart").innerHTML = rows.length ? `<svg viewBox="0 0 ${width} ${height}"><polyline points="${rows.map((row, index) => `${x(index)},${y(row.accuracy)}`).join(" ")}"/><g>${rows.map((row, index) => `<circle cx="${x(index)}" cy="${y(row.accuracy)}" r="4"><title>${row.year}: ${fmtPct(row.accuracy)} accuracy</title></circle><text x="${x(index)}" y="${height - 12}" text-anchor="middle">${row.year}</text>`).join("")}</g></svg>` : "";
  document.getElementById("modelRegistry").innerHTML = (state.data.modelRegistry || []).map((row) => `<div class="registry-row"><span>${row.status}</span><strong>${row.name}</strong><code>${row.version}</code><small>Data through ${row.trainingCutoff} · ${row.validation}</small><small>${row.featureSchema || "versioned features"} · ${row.calibration || "native probability"} · ${row.sourceHash || "-"}</small></div>`).join("");
}

function calibrationSvg(rows, label) {
  if (!rows?.length) return `<p class="muted">No calibration observations available.</p>`;
  const width = 720, height = 280, pad = 42;
  const x = (value) => pad + value * (width - pad * 2);
  const y = (value) => height - pad - value * (height - pad * 2);
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}"><line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" class="calibration-perfect"/>${[0,.25,.5,.75,1].map((tick) => `<text x="${x(tick)}" y="${height-12}" text-anchor="middle">${fmtPct(tick)}</text><text x="32" y="${y(tick)+4}" text-anchor="end">${fmtPct(tick)}</text>`).join("")}${rows.map((row) => `<circle cx="${x(row.predicted)}" cy="${y(row.observed)}" r="${Math.min(14,4+Math.sqrt(row.count))}" class="calibration-point"><title>${row.count} games · ${fmtPct(row.predicted)} predicted · ${fmtPct(row.observed)} observed</title></circle>`).join("")}</svg>`;
}

function projectedField(records = currentSeason().records) {
  return [...records].sort((a, b) => Number(b["CFP Selection Probability"] || b.championProbability) - Number(a["CFP Selection Probability"] || a.championProbability)).slice(0, 12);
}

function fieldMarkup(rows) {
  return rows.map((row, index) => `<div class="field-row"><span>${row.seed || index + 1}</span><strong>${row.team || row.Team}</strong><b>${fmtPct(row.probability ?? row["CFP Selection Probability"] ?? row.championProbability)}</b></div>`).join("");
}

function renderCalibratedModels() {
  const calibration = state.data.gameModel?.calibration || {};
  document.getElementById("calibrationMethod").textContent = calibration.method || "Unavailable";
  document.getElementById("gameCalibrationMetrics").innerHTML = [
    ["Calibration games", fmtRank(calibration.samples)],
    ["Raw Brier", fmtDecimal(calibration.rawBrier, 3)],
    ["Calibrated Brier", fmtDecimal(calibration.calibratedBrier, 3)],
    ["Improvement", fmtSigned((Number(calibration.rawBrier) - Number(calibration.calibratedBrier)) * 1000, 1)],
  ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join("");
  document.getElementById("gameCalibrationChart").innerHTML = calibrationSvg(calibration.bins, "Calibrated game probabilities");
  const selection = state.data.selectionModel || {};
  document.getElementById("selectionModelVersion").textContent = selection.version || "Unavailable";
  document.getElementById("selectionModelMetrics").innerHTML = [["Training teams", fmtRank(selection.trainingTeams)],["Accuracy", fmtPct(selection.accuracy)],["Brier", fmtDecimal(selection.brier,3)]].map(([label,value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
  document.getElementById("selectionField").innerHTML = fieldMarkup(projectedField());
}

function currentModelPredictions() {
  return currentWeeklyRows().at(-1)?.modelPredictions || [];
}

function renderModelLab() {
  const predictions = currentModelPredictions();
  const names = predictions.map((row) => row.model);
  const aSelect = document.getElementById("labModelA"), bSelect = document.getElementById("labModelB");
  if (!aSelect.options.length) {
    aSelect.innerHTML = names.map((name) => `<option value="${name}">${name}</option>`).join("");
    bSelect.innerHTML = aSelect.innerHTML;
    aSelect.value = names.includes("Weekly ML Ensemble") ? "Weekly ML Ensemble" : names[0];
    bSelect.value = names.includes("Balanced ML Blend") ? "Balanced ML Blend" : names[1] || names[0];
  }
  const a = predictions.find((row) => row.model === aSelect.value) || predictions[0];
  const b = predictions.find((row) => row.model === bSelect.value) || predictions[1] || predictions[0];
  if (!a || !b) return;
  const teams = [...new Set([...Object.keys(a.probabilities || {}), ...Object.keys(b.probabilities || {})])];
  const rows = teams.map((team) => ({team,a:Number(a.probabilities?.[team]||0),b:Number(b.probabilities?.[team]||0)})).sort((x,y) => Math.max(y.a,y.b)-Math.max(x.a,x.b)).slice(0,15);
  document.getElementById("labSummary").innerHTML = `<div><strong>${a.predictedChampion}</strong><span>${a.model} leader</span></div><div><strong>${b.predictedChampion}</strong><span>${b.model} leader</span></div><div><strong>${a.predictedChampion === b.predictedChampion ? "Agree" : "Disagree"}</strong><span>top-pick consensus</span></div><div><strong>${fmtPct(Math.abs(Number(a.predictedProbability)-Number(b.predictedProbability)))}</strong><span>leader probability gap</span></div>`;
  document.getElementById("modelLabTable").innerHTML = `<div class="diagnostic-row lab-head"><strong>Team</strong><span>Model A</span><span>Model B</span><span>Gap</span><span>Leader</span></div>${rows.map((row) => `<div class="diagnostic-row"><strong>${row.team}</strong><span>${fmtPct(row.a)}</span><span>${fmtPct(row.b)}</span><span>${fmtSigned((row.a-row.b)*100)} pts</span><span>${row.a>=row.b?"A":"B"}</span></div>`).join("")}`;
}

function reportText() {
  const report = state.data.weeklyReport || {};
  return `${report.season} Week ${report.week}: ${report.leader} leads at ${fmtPct(report.leaderProbability)}. Biggest risers: ${(report.biggestRisers || []).map((row) => `${row.team} ${fmtSigned(row.change*100)} pts`).join(", ")}. Projected field: ${(report.projectedField || []).map((row) => `${row.seed}. ${row.team}`).join(", ")}.`;
}

function renderWeeklyReport() {
  const report = state.data.weeklyReport || {};
  document.getElementById("reportWeekLabel").textContent = `${report.season || "-"} week ${report.week || "-"}`;
  document.getElementById("reportHeadline").textContent = report.leader ? `${report.leader} leads the title forecast` : "Forecast report";
  document.getElementById("weeklyReport").innerHTML = `<div class="report-stat"><span>Leader</span><strong>${report.leader || "-"}</strong><b>${fmtPct(report.leaderProbability)}</b></div><div><h4>Biggest risers</h4>${(report.biggestRisers || []).map((row) => `<p><strong>${row.team}</strong><span>${fmtSigned(row.change*100)} pts · ${fmtPct(row.probability)}</span></p>`).join("")}</div><div><h4>Biggest fallers</h4>${(report.biggestFallers || []).map((row) => `<p><strong>${row.team}</strong><span>${fmtSigned(row.change*100)} pts · ${fmtPct(row.probability)}</span></p>`).join("")}</div>`;
  document.getElementById("reportField").innerHTML = fieldMarkup(report.projectedField || []);
  const votes = state.data.predictionAudit?.votes || [];
  document.getElementById("reportVotes").innerHTML = votes.map((row) => `<div class="model-row"><strong>${row.team}</strong><span>${row.votes} votes</span></div>`).join("");
}

function renderReplay() {
  const year = String(state.replayYear || state.data.meta.currentSeason);
  const snapshots = state.data.weeklyPredictions?.[year] || [];
  const snapshot = snapshots.find((row) => Number(row.week) === Number(state.replayWeek)) || snapshots.at(-1);
  if (!snapshot) return;
  state.replayWeek = snapshot.week;
  const weekSelect = document.getElementById("replayWeek");
  weekSelect.innerHTML = snapshots.map((row) => `<option value="${row.week}">Week ${row.week}</option>`).join("");
  weekSelect.value = String(snapshot.week);
  const model = (snapshot.modelPredictions || []).find((row) => row.model === "Weekly ML Ensemble") || snapshot;
  const records = [...snapshot.records].sort((a,b) => Number(b.mlChampionProbability||b.championProbability)-Number(a.mlChampionProbability||a.championProbability));
  document.getElementById("replaySummary").innerHTML = `<article class="metric-card primary"><span>Forecast leader</span><strong>${model.predictedChampion}</strong><p>${fmtPct(model.predictedProbability)}</p></article><article class="metric-card"><span>Actual champion</span><strong>${snapshot.actualChampion}</strong><p>Projected #${model.actualChampionPredictedRank || "-"}</p></article><article class="metric-card"><span>Snapshot</span><strong>Week ${snapshot.week}</strong><p>${snapshot.isFrozen ? "Frozen" : "Provisional"} · ${snapshot.snapshotId || "legacy"}</p></article>`;
  const cap = Math.max(...records.slice(0,10).map((row) => Number(row.mlChampionProbability||row.championProbability||0)),.01);
  document.getElementById("replayRanking").innerHTML = records.slice(0,10).map((row) => `<div class="bar-row"><strong>${row.Team}</strong><div class="bar-track"><div class="bar-fill" style="width:${Number(row.mlChampionProbability||row.championProbability||0)/cap*100}%"></div></div><span>${fmtPct(row.mlChampionProbability||row.championProbability)}</span></div>`).join("");
  document.getElementById("replayField").innerHTML = fieldMarkup(records.slice(0,12).map((row,index) => ({seed:index+1,team:row.Team,probability:row.mlChampionProbability||row.championProbability})));
}

function renderAuditProducts() {
  document.getElementById("predictionChangelog").innerHTML = [...(state.data.predictionChangelog || [])].reverse().map((entry) => `<div class="change-row"><div><strong>Week ${entry.week}</strong><span>${entry.leader}${entry.leaderChanged ? " · new leader" : ""}</span></div><p>${entry.largestMoves.slice(0, 3).map((move) => `${move.team} ${fmtSigned(move.change * 100)} pts`).join(" · ")}</p><small>${entry.enteredTop12.length ? `${entry.enteredTop12.join(", ")} entered top 12.` : "Top 12 unchanged."}</small></div>`).join("");
  const quality = state.data.dataQuality || { issues: [], coverage: {}, featureDrift: [] };
  document.getElementById("dataQuality").innerHTML = `<div class="quality-status ${quality.status}">${quality.status}</div>
    <div class="quality-grid">${Object.entries(quality.coverage || {}).map(([key, value]) => `<div><strong>${fmtRank(value)}</strong><span>${key.replace(/([A-Z])/g, " $1")}</span></div>`).join("")}</div>
    <div class="quality-issues">${quality.issues.length ? quality.issues.map((issue) => `<p>${issue}</p>`).join("") : `<p>No blocking data issues detected.</p>`}</div>
    <div class="drift-list">${(quality.featureDrift || []).map((row) => `<span>${row.feature.replace(" Composite", "")}: ${fmtSigned(row.meanShift, 1)}</span>`).join("")}</div>`;
}

function renderWeeklyTimeline() {
  const container = document.getElementById("weeklyTimeline");
  const rows = currentWeeklyRows();
  if (!rows.length) {
    container.innerHTML = `<p class="muted">No weekly snapshots available for this season.</p>`;
    return;
  }
  const chartRows = rows.map((row) => {
    const modelPrediction = (row.modelPredictions || []).find((item) => item.model === state.weeklyModel) || row;
    return {
      ...row,
      predictedChampion: modelPrediction.predictedChampion,
      predictedProbability: modelPrediction.predictedProbability,
      actualChampionPredictedRank: modelPrediction.actualChampionPredictedRank,
      actualChampionProbability: modelPrediction.actualChampionProbability,
    };
  });
  const width = 980;
  const height = 430;
  const pad = { top: 30, right: 24, bottom: 66, left: 58 };
  const maxProb = Math.max(0.5, Math.max(...chartRows.map((row) => row.predictedProbability)) * 1.12);
  const x = (week) => pad.left + ((week - chartRows[0].week) / (chartRows[chartRows.length - 1].week - chartRows[0].week || 1)) * (width - pad.left - pad.right);
  const y = (prob) => pad.top + (1 - prob / maxProb) * (height - pad.top - pad.bottom);
  const points = chartRows.map((row) => `${x(row.week)},${y(row.predictedProbability)}`).join(" ");
  const yTicks = [0, 0.1, 0.2, 0.3, 0.4, 0.5].filter((tick) => tick <= maxProb);
  const grid = yTicks
    .map((tick) => {
      const yPos = y(tick);
      return `<line x1="${pad.left}" y1="${yPos}" x2="${width - pad.right}" y2="${yPos}" stroke="#e5ecef"/><text x="${pad.left - 12}" y="${yPos + 4}" text-anchor="end">${Math.round(tick * 100)}%</text>`;
    })
    .join("");
  const weekLabels = chartRows
    .map((row) => `<text x="${x(row.week)}" y="${height - 30}" text-anchor="middle">${row.week}</text>`)
    .join("");
  const logoMarkers = chartRows
    .map((row) => {
      const xPos = x(row.week);
      const yPos = y(row.predictedProbability);
      const actual = row.predictedChampion === row.actualChampion;
      const logo = logoUrl(row.predictedChampion);
      return `
        <g class="weekly-logo-point">
          <circle cx="${xPos}" cy="${yPos}" r="${actual ? 24 : 21}" fill="${actual ? "#f2faf5" : "#ffffff"}" stroke="${actual ? "#22735f" : "#d7e1e6"}" stroke-width="2"/>
          ${logo ? `<image href="${logo}" x="${xPos - 16}" y="${yPos - 16}" width="32" height="32" preserveAspectRatio="xMidYMid meet"/>` : `<text x="${xPos}" y="${yPos + 4}" text-anchor="middle">${row.predictedChampion.slice(0, 2)}</text>`}
          <text x="${xPos}" y="${yPos - 30}" text-anchor="middle" class="weekly-prob-label">${fmtPct(row.predictedProbability)}</text>
          <text x="${xPos}" y="${height - 12}" text-anchor="middle" class="weekly-team-label">${row.predictedChampion}</text>
          <title>${state.weeklyModel} - Week ${row.week}: ${row.predictedChampion} (${fmtPct(row.predictedProbability)})</title>
        </g>
      `;
    })
    .join("");

  container.innerHTML = `
    <svg class="weekly-logo-chart" viewBox="0 0 ${width} ${height}" role="img">
      <g class="axis">${grid}${weekLabels}</g>
      <text x="${width / 2}" y="${height - 46}" text-anchor="middle" class="axis-title">Week</text>
      <text x="18" y="${height / 2}" transform="rotate(-90 18 ${height / 2})" text-anchor="middle" class="axis-title">Predicted winner probability</text>
      <polyline points="${points}" fill="none" stroke="#2f72b7" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      ${logoMarkers}
    </svg>
  `;
}

function renderFeatureImportance() {
  const container = document.getElementById("importanceChart");
  const rows = state.data.featureImportance;
  const cap = Math.max(...rows.map((row) => row.importance));
  container.innerHTML = rows
    .map(
      (row) => `
      <div class="mini-bar">
        <span>${row.feature}</span>
        <div class="bar-track">
          <div class="bar-fill" style="width:${Math.max(3, (row.importance / cap) * 100)}%"></div>
        </div>
      </div>
    `,
    )
    .join("");
}

function renderModelCards() {
  const container = document.getElementById("modelCards");
  container.innerHTML = state.data.models
    .map(
      (model) => `
      <div class="model-row">
        <div class="model-row-main">
          <div class="model-title">
            <strong>${model.model}</strong>
            ${model.selected ? `<span class="selected-model">Selected</span>` : ""}
          </div>
          <p>2025 pick: ${model.holdoutPick} at ${fmtPct(model.championProbability)}; champion ranked ${model.holdoutChampionRank}.</p>
          <div class="model-metrics">
            <span><b>${fmtPct(model.top1Rate)}</b> CV hit</span>
            <span><b>${fmtPct(model.top3Rate)}</b> top 3</span>
            <span><b>${fmtDecimal(model.meanChampionRank)}</b> mean rank</span>
            <span><b>${fmtDecimal(model.meanChampionNll)}</b> NLL</span>
            <span><b>${fmtDecimal(model.meanBrierScore, 3)}</b> Brier</span>
            <span><b>${fmtDecimal(model.rocAuc, 3)}</b> ROC AUC</span>
            <span><b>${fmtDecimal(model.averagePrecision, 3)}</b> avg precision</span>
          </div>
        </div>
        <span class="status ${model.pickedChampion ? "" : "is-miss"}">${model.pickedChampion ? "2025 hit" : "2025 miss"}</span>
      </div>
    `,
    )
    .join("");
}

function renderWeeklyDiagnostics() {
  const rows = [...(state.data.weeklyModelDiagnostics || [])]
    .filter((row) => row.model.startsWith("Weekly"))
    .sort((a, b) => b.top1Rate - a.top1Rate || a.meanChampionNll - b.meanChampionNll);
  document.getElementById("weeklyModelDiagnostics").innerHTML = `
    <div class="diagnostic-row diagnostic-head"><span>Model</span><span>Hit</span><span>Top 3</span><span>Mean rank</span><span>NLL</span></div>
    ${rows.map((row) => `
      <div class="diagnostic-row ${row.model === "Weekly ML Ensemble" ? "is-selected" : ""}">
        <strong>${row.model}</strong>
        <span>${fmtPct(row.top1Rate)}</span>
        <span>${fmtPct(row.top3Rate)}</span>
        <span>${fmtDecimal(row.meanChampionRank)}</span>
        <span>${fmtDecimal(row.meanChampionNll)}</span>
      </div>
    `).join("")}
  `;
  const audit = state.data.predictionAudit || {};
  document.getElementById("agreementChip").textContent = audit.modelCount
    ? `${audit.leaderVotes}/${audit.modelCount} models agree`
    : "No current audit";
}

function renderCalibration() {
  const rows = state.data.weeklyCalibration || [];
  const container = document.getElementById("calibrationChart");
  if (!rows.length) {
    container.innerHTML = `<p class="muted">Calibration becomes available after completed-season tests.</p>`;
    return;
  }
  const width = 360;
  const height = 250;
  const pad = 36;
  const x = (value) => pad + value * (width - pad * 2);
  const y = (value) => height - pad - value * (height - pad * 2);
  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Weekly ensemble calibration">
      <line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" class="calibration-perfect" />
      ${[0, .25, .5, .75, 1].map((tick) => `<text x="${x(tick)}" y="${height - 12}" text-anchor="middle">${Math.round(tick * 100)}%</text><text x="28" y="${y(tick) + 4}" text-anchor="end">${Math.round(tick * 100)}%</text>`).join("")}
      ${rows.map((row) => `<circle cx="${x(row.predicted)}" cy="${y(row.observed)}" r="${Math.min(12, 4 + Math.sqrt(row.count))}" class="calibration-point"><title>${row.count} observations: ${fmtPct(row.predicted)} predicted, ${fmtPct(row.observed)} observed</title></circle>`).join("")}
      <text x="${width / 2}" y="${height - 1}" text-anchor="middle" class="axis-title">Predicted</text>
      <text x="10" y="${height / 2}" transform="rotate(-90 10 ${height / 2})" text-anchor="middle" class="axis-title">Observed</text>
    </svg>
  `;
}

function renderMovement() {
  const container = document.getElementById("movementChart");
  const rows = currentWeeklyRows();
  if (rows.length < 2) {
    container.innerHTML = `<p class="muted">At least two weekly snapshots are needed for movement tracking.</p>`;
    document.getElementById("movers").innerHTML = "";
    return;
  }
  const latest = rows.at(-1);
  const teams = latest.records.slice(0, state.movementCount).map((record) => record.Team);
  const width = 980;
  const height = 380;
  const pad = { top: 24, right: 120, bottom: 46, left: 54 };
  const allValues = rows.flatMap((week) => teams.map((team) => week.records.find((row) => row.Team === team)?.mlChampionProbability || 0));
  const maxProbability = Math.max(.25, ...allValues) * 1.12;
  const x = (index) => pad.left + (index / (rows.length - 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - value / maxProbability) * (height - pad.top - pad.bottom);
  const ticks = [0, .1, .2, .3, .4, .5].filter((tick) => tick <= maxProbability);
  const grid = ticks.map((tick) => `<line x1="${pad.left}" y1="${y(tick)}" x2="${width - pad.right}" y2="${y(tick)}"/><text x="${pad.left - 10}" y="${y(tick) + 4}" text-anchor="end">${fmtPct(tick)}</text>`).join("");
  const series = teams.map((team, teamIndex) => {
    const values = rows.map((week) => week.records.find((record) => record.Team === team)?.mlChampionProbability || 0);
    const points = values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
    const lastX = x(values.length - 1);
    const lastY = y(values.at(-1));
    return `<g class="movement-series"><polyline points="${points}" style="stroke:${chartColors[teamIndex]}"/><circle cx="${lastX}" cy="${lastY}" r="5" style="fill:${chartColors[teamIndex]}"/><text x="${lastX + 9}" y="${lastY + 4}" style="fill:${chartColors[teamIndex]}">${team}</text><title>${team}: ${fmtPct(values.at(-1))}</title></g>`;
  }).join("");
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Contender probability movement"><g class="movement-grid">${grid}</g>${series}${rows.map((row, index) => `<text x="${x(index)}" y="${height - 16}" text-anchor="middle">W${row.week}</text>`).join("")}</svg>`;

  const previous = rows.at(-2);
  const movers = latest.records.map((record) => {
    const prior = previous.records.find((item) => item.Team === record.Team);
    return { team: record.Team, change: record.championProbability - (prior?.championProbability || 0), probability: record.championProbability };
  }).sort((a, b) => b.change - a.change);
  document.getElementById("movers").innerHTML = [
    { label: "Biggest riser", row: movers[0] },
    { label: "Biggest faller", row: movers.at(-1) },
    { label: "Current leader", row: { ...movers.find((item) => item.team === latest.predictedChampion), team: latest.predictedChampion } },
  ].map(({ label, row }) => `<div><span>${label}</span><strong>${row.team}</strong><b>${fmtSigned(row.change * 100)} pts</b></div>`).join("");
}

function teamOptions() {
  return currentSeason().records.map((row) => `<option value="${row.Team}">${row.Team}</option>`).join("");
}

function populateTeamControls() {
  const ids = ["scenarioTeam", "researchTeam", "metricsTeam", "watchTeam", "teamPageSelect"];
  ids.forEach((id) => {
    const select = document.getElementById(id);
    const prior = select.value;
    select.innerHTML = teamOptions();
    if (prior && currentSeason().records.some((row) => row.Team === prior)) select.value = prior;
  });
}

function renderScenario() {
  const rows = currentSeason().records;
  const team = rows.find((row) => row.Team === document.getElementById("scenarioTeam").value) || rows[0];
  const result = document.getElementById("scenarioResult").value;
  const opponent = document.getElementById("scenarioOpponent").value;
  const margin = Number(document.getElementById("scenarioMargin").value);
  document.getElementById("marginOutput").value = margin;
  const opponentImpact = { top5: .62, top25: .42, ranked: .28, unranked: .10 }[opponent];
  const direction = result === "win" ? 1 : -1;
  const delta = direction * (opponentImpact + Math.min(margin, 28) / 70);
  const factor = Math.exp(delta);
  const base = Number(team.championProbability);
  const adjusted = (base * factor) / ((1 - base) + base * factor);
  const sorted = rows.map((row) => ({ team: row.Team, probability: row.Team === team.Team ? adjusted : row.championProbability * ((1 - adjusted) / (1 - base)) })).sort((a, b) => b.probability - a.probability);
  const rank = sorted.findIndex((row) => row.team === team.Team) + 1;
  document.getElementById("scenarioResultPanel").innerHTML = `<span>${team.Team} after a ${margin}-point ${result}</span><strong>${fmtPct(adjusted)}</strong><p>${fmtSigned((adjusted - base) * 100)} percentage points · projected rank #${rank}</p>`;
}

function seededRandom(seed = 20261016) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}

function playGame(teamA, teamB, ratings, random, homeTeam = null) {
  const home = teamA === homeTeam ? .22 : teamB === homeTeam ? -.22 : 0;
  const probability = 1 / (1 + Math.exp(-((ratings[teamA] ?? 5.8) - (ratings[teamB] ?? 5.8) + home)));
  return random() < probability ? teamA : teamB;
}

function renderScenarioBuilder() {
  const ranked = new Set(currentSeason().records.map((row) => row.Team));
  const games = (state.data.seasonSchedule?.games || []).filter((game) => !game.completed && game.competitors?.some((item) => ranked.has(item.team))).slice(0, 24);
  document.getElementById("scenarioBuilder").innerHTML = games.map((game) => {
    const [a, b] = game.competitors;
    const selected = state.scenarioPicks[game.id] || "";
    return `<div class="scenario-game"><div><span>Week ${game.week}</span><strong>${a.team} vs ${b.team}</strong></div><select data-scenario-game="${game.id}"><option value="">Model decides</option><option value="${a.team}" ${selected === a.team ? "selected" : ""}>${a.team}</option><option value="${b.team}" ${selected === b.team ? "selected" : ""}>${b.team}</option></select><small>${game.gameModel ? `${fmtPct(game.gameModel.teamAWinProbability)} / ${fmtPct(game.gameModel.teamBWinProbability)}` : "No game line"}</small></div>`;
  }).join("");
  document.querySelectorAll("[data-scenario-game]").forEach((select) => select.addEventListener("change", () => {
    if (select.value) state.scenarioPicks[select.dataset.scenarioGame] = select.value;
    else delete state.scenarioPicks[select.dataset.scenarioGame];
  }));
}

function runSeasonSimulation() {
  const runs = Number(document.getElementById("simulationRuns").value);
  const records = currentSeason().records;
  const schedule = state.data.seasonSchedule?.games || [];
  const currentTeams = state.data.gameModel?.currentTeams || {};
  const scheduledTeams = new Set(schedule.flatMap((game) => (game.competitors || []).map((team) => team.team)));
  const teams = Object.keys(currentTeams).filter((team) => scheduledTeams.has(team));
  const teamSet = new Set(teams);
  const ratings = Object.fromEntries(teams.map((team) => [team, Number(currentTeams[team]?.elo || 1450) / 250]));
  const baseWins = Object.fromEntries(teams.map((team) => [team, 0]));
  const conferences = {};
  for (const game of schedule) for (const competitor of game.competitors || []) {
    if (teamSet.has(competitor.team) && competitor.conferenceId) conferences[competitor.team] = String(competitor.conferenceId);
    if (game.completed && competitor.winner && teamSet.has(competitor.team)) baseWins[competitor.team] += 1;
  }
  const remaining = schedule.filter((game) => !game.completed && (game.competitors || []).every((team) => teamSet.has(team.team)));
  const playoffCounts = Object.fromEntries(teams.map((team) => [team, 0]));
  const titleCounts = Object.fromEntries(teams.map((team) => [team, 0]));
  const semifinalCounts = Object.fromEntries(teams.map((team) => [team, 0]));
  const finalCounts = Object.fromEntries(teams.map((team) => [team, 0]));
  const byeCounts = Object.fromEntries(teams.map((team) => [team, 0]));
  const conferenceCounts = Object.fromEntries(teams.map((team) => [team, 0]));
  const rankBoost = Object.fromEntries(records.map((row) => {
    const selection = Math.max(.001, Math.min(.999, Number(row["CFP Selection Probability"] || .01)));
    return [row.Team, Math.log(selection / (1 - selection)) * .35 + 3.5 - Number(row.predictedRank || 25) * .08];
  }));
  const p4 = ["1", "4", "5", "8"];
  const g6 = ["151", "12", "15", "17", "9", "37"];
  const conferenceCount = new Set(Object.values(conferences)).size;
  const random = seededRandom(Number(state.data.meta.currentSeason) * 100 + (currentWeeklyRows().at(-1)?.week || 0));

  for (let run = 0; run < runs; run += 1) {
    const wins = { ...baseWins };
    for (const game of remaining) {
      const competitors = game.competitors || [];
      if (competitors.length !== 2) continue;
      const a = competitors[0].team;
      const b = competitors[1].team;
      const home = competitors.find((item) => item.homeAway === "home")?.team;
      let winner = state.scenarioPicks[game.id];
      if (!winner && game.gameModel) winner = random() < Number(game.gameModel.teamAWinProbability) ? game.gameModel.teamA : game.gameModel.teamB;
      if (!winner) winner = playGame(a, b, ratings, random, game.neutralSite ? null : home);
      wins[winner] = (wins[winner] || 0) + 1;
    }
    const selectionScore = (team) => wins[team] * 1.2 + (ratings[team] || 5.8) + (rankBoost[team] || 0) + random() * .12;
    const conferenceTeams = teams.filter((team) => conferences[team]).reduce((out, team) => ((out[conferences[team]] ||= []).push(team), out), {});
    const champions = {};
    for (const [conference, group] of Object.entries(conferenceTeams)) {
      if (group.length < 2) continue;
      const finalists = [...group].sort((a, b) => selectionScore(b) - selectionScore(a)).slice(0, 2);
      const champion = playGame(finalists[0], finalists[1], ratings, random);
      champions[conference] = champion;
      conferenceCounts[champion] += 1;
    }
    const automatic = new Set(p4.map((conference) => champions[conference]).filter(Boolean));
    const g6Champion = g6.map((conference) => champions[conference]).filter(Boolean).sort((a, b) => selectionScore(b) - selectionScore(a))[0];
    if (g6Champion) automatic.add(g6Champion);
    const ranking = teams.map((team) => ({ team, score: selectionScore(team) })).sort((a, b) => b.score - a.score);
    if (ranking.slice(0, 12).some((item) => item.team === "Notre Dame")) automatic.add("Notre Dame");
    const fieldSet = new Set(automatic);
    for (const item of ranking) {
      if (fieldSet.size >= 12) break;
      fieldSet.add(item.team);
    }
    const field = [...fieldSet].sort((a, b) => selectionScore(b) - selectionScore(a)).slice(0, 12);
    field.forEach((team) => { playoffCounts[team] += 1; });
    field.slice(0, 4).forEach((team) => { byeCounts[team] += 1; });
    const opening = [
      playGame(field[4], field[11], ratings, random, field[4]),
      playGame(field[5], field[10], ratings, random, field[5]),
      playGame(field[6], field[9], ratings, random, field[6]),
      playGame(field[7], field[8], ratings, random, field[7]),
    ];
    const quarterfinals = [
      playGame(field[0], opening[3], ratings, random),
      playGame(field[3], opening[0], ratings, random),
      playGame(field[1], opening[2], ratings, random),
      playGame(field[2], opening[1], ratings, random),
    ];
    quarterfinals.forEach((team) => { semifinalCounts[team] += 1; });
    const finalists = [playGame(quarterfinals[0], quarterfinals[1], ratings, random), playGame(quarterfinals[2], quarterfinals[3], ratings, random)];
    finalists.forEach((team) => { finalCounts[team] += 1; });
    titleCounts[playGame(finalists[0], finalists[1], ratings, random)] += 1;
  }

  const results = teams.map((team) => ({ team, playoff: playoffCounts[team] / runs, bye: byeCounts[team] / runs, semifinal: semifinalCounts[team] / runs, final: finalCounts[team] / runs, title: titleCounts[team] / runs, conference: conferenceCounts[team] / runs }))
    .sort((a, b) => b.title - a.title).slice(0, 12);
  document.getElementById("simulationSummary").innerHTML = `<div><strong>${runs.toLocaleString()}</strong><span>simulations</span></div><div><strong>${remaining.length}</strong><span>remaining games</span></div><div><strong>${conferenceCount}</strong><span>conference races</span></div><div><strong>${Object.keys(state.scenarioPicks).length}</strong><span>locked outcomes</span></div>`;
  document.getElementById("simulationResults").innerHTML = results.map((row, index) => `<div class="simulation-row"><span>${index + 1}</span><strong>${row.team}</strong><div><i style="width:${Math.max(1, row.title * 100)}%"></i></div><b>${fmtPct(row.title)}</b><small>${fmtPct(row.playoff)} field · ${fmtPct(row.bye)} bye · ${fmtPct(row.semifinal)} semi · ${fmtPct(row.final)} final</small></div>`).join("");
}

function renderPlayoffBracket() {
  const field = projectedField();
  if (field.length < 12) return;
  const seeded = Object.fromEntries(field.map((row,index) => [index+1,row.Team]));
  const probability = Object.fromEntries(field.map((row) => [row.Team,Number(row.championProbability||0)]));
  const choose = (key,a,b) => {
    const locked = state.bracketPicks[key];
    if (locked === a || locked === b) return locked;
    return Number(probability[a]||0) >= Number(probability[b]||0) ? a : b;
  };
  const opening = [[5,12],[6,11],[7,10],[8,9]].map(([a,b],index) => ({key:`opening-${index}`,a:seeded[a],b:seeded[b],winner:choose(`opening-${index}`,seeded[a],seeded[b])}));
  const quartersInput = [[seeded[1],opening[3].winner],[seeded[4],opening[0].winner],[seeded[2],opening[2].winner],[seeded[3],opening[1].winner]];
  const quarters = quartersInput.map(([a,b],index) => ({key:`quarter-${index}`,a,b,winner:choose(`quarter-${index}`,a,b)}));
  const semisInput = [[quarters[0].winner,quarters[1].winner],[quarters[2].winner,quarters[3].winner]];
  const semis = semisInput.map(([a,b],index) => ({key:`semi-${index}`,a,b,winner:choose(`semi-${index}`,a,b)}));
  const final = {key:"final",a:semis[0].winner,b:semis[1].winner,winner:choose("final",semis[0].winner,semis[1].winner)};
  const match = (row) => `<div class="bracket-match"><button type="button" data-bracket-key="${row.key}" data-bracket-team="${row.a}" class="${row.winner===row.a?"is-winner":""}">${row.a}</button><button type="button" data-bracket-key="${row.key}" data-bracket-team="${row.b}" class="${row.winner===row.b?"is-winner":""}">${row.b}</button></div>`;
  document.getElementById("playoffBracket").innerHTML = `<div class="bracket-round"><h4>First round</h4>${opening.map(match).join("")}</div><div class="bracket-round"><h4>Quarterfinals</h4>${quarters.map(match).join("")}</div><div class="bracket-round"><h4>Semifinals</h4>${semis.map(match).join("")}</div><div class="bracket-round"><h4>Championship</h4>${match(final)}<div class="bracket-champion"><span>Projected champion</span><strong>${final.winner}</strong></div></div>`;
  document.querySelectorAll("[data-bracket-key]").forEach((button) => button.addEventListener("click", () => {
    state.bracketPicks[button.dataset.bracketKey] = button.dataset.bracketTeam;
    renderPlayoffBracket();
  }));
}

function renderWeeklyEvaluation() {
  const container = document.getElementById("weeklyEvaluationChart");
  const metric = document.getElementById("evaluationMetric").value;
  const preferred = ["Weekly ML Ensemble", "Weekly Logistic Regression", "Balanced ML Blend", "AP Poll Baseline", "FPI Baseline"];
  const rows = (state.data.weeklyEvaluationByWeek || []).filter((row) => preferred.includes(row.model));
  if (!rows.length) {
    container.innerHTML = `<p class="muted">No week-level evaluation data available.</p>`;
    return;
  }
  const weeks = [...new Set(rows.map((row) => row.week))].sort((a, b) => a - b);
  const values = rows.map((row) => Number(row[metric]));
  const higherIsBetter = metric.includes("Rate");
  const minValue = higherIsBetter ? 0 : Math.min(...values) * .9;
  const maxValue = higherIsBetter ? 1 : Math.max(...values) * 1.05;
  const width = 980, height = 340, pad = { top: 25, right: 170, bottom: 42, left: 54 };
  const x = (week) => pad.left + ((week - weeks[0]) / Math.max(1, weeks.at(-1) - weeks[0])) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - (value - minValue) / Math.max(.0001, maxValue - minValue)) * (height - pad.top - pad.bottom);
  const series = preferred.map((model, index) => {
    const modelRows = rows.filter((row) => row.model === model).sort((a, b) => a.week - b.week);
    if (!modelRows.length) return "";
    const points = modelRows.map((row) => `${x(row.week)},${y(Number(row[metric]))}`).join(" ");
    const last = modelRows.at(-1);
    return `<g class="movement-series"><polyline points="${points}" style="stroke:${chartColors[index]}"/><text x="${x(last.week) + 8}" y="${y(Number(last[metric])) + 4}" style="fill:${chartColors[index]}">${model.replace("Weekly ", "")}</text></g>`;
  }).join("");
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Model evaluation by week">${series}${weeks.map((week) => `<text x="${x(week)}" y="${height - 14}" text-anchor="middle">W${week}</text>`).join("")}</svg>`;
}

function setView(view) {
  const decoded = decodeURIComponent(view || "");
  if (decoded.startsWith("team=")) {
    state.teamPage = decoded.slice(5);
    view = "team";
  }
  const allowed = ["overview", "team", "weekly", "report", "replay", "models", "lab", "simulator", "scores", "data"];
  state.currentView = allowed.includes(view) ? view : "overview";
  document.querySelector("main").dataset.activeView = state.currentView;
  document.querySelectorAll("[data-route]").forEach((item) => item.classList.toggle("is-active", item.dataset.route === state.currentView));
  if (state.currentView === "team") renderTeamPage();
  const nextHash = state.currentView === "team" && state.teamPage ? `#team=${encodeURIComponent(state.teamPage)}` : `#${state.currentView}`;
  if (location.hash !== nextHash) history.replaceState(null, "", nextHash);
}

function renderResearch() {
  const rows = currentSeason().records;
  const team = rows.find((row) => row.Team === document.getElementById("researchTeam").value) || rows[0];
  const profile = state.data.championProfile || { features: [], averages: {} };
  const differences = profile.features.map((feature) => Math.abs(Number(team[feature] || 0) - Number(profile.averages[feature] || 0)));
  const similarity = Math.max(0, 100 - (differences.reduce((sum, value) => sum + value, 0) / Math.max(1, differences.length)));
  document.getElementById("championProfile").innerHTML = `
    <div class="similarity-score"><span>Champion similarity</span><strong>${fmtDecimal(similarity, 0)}</strong><p>Compared with the 2021-2025 champion profile.</p></div>
    <div class="profile-features">${profile.features.map((feature) => `<div><span>${feature.replace(" Composite", "")}</span><b>${fmtDecimal(team[feature], 0)}</b><div class="profile-track"><i style="width:${team[feature] || 0}%"></i><em style="left:${profile.averages[feature] || 0}%" title="Champion average ${fmtDecimal(profile.averages[feature], 0)}"></em></div></div>`).join("")}</div>
  `;
  const weekly = currentWeeklyRows();
  const values = weekly.map((snapshot) => snapshot.records.find((row) => row.Team === team.Team)?.mlChampionProbability || 0);
  const width = 360;
  const height = 220;
  const pad = 32;
  const cap = Math.max(.1, ...values) * 1.15;
  const x = (index) => pad + (index / Math.max(1, values.length - 1)) * (width - pad * 2);
  const y = (value) => pad + (1 - value / cap) * (height - pad * 2);
  document.getElementById("teamTimeline").innerHTML = values.length ? `<svg viewBox="0 0 ${width} ${height}"><polyline points="${values.map((value, index) => `${x(index)},${y(value)}`).join(" ")}"/><g>${values.map((value, index) => `<circle cx="${x(index)}" cy="${y(value)}" r="4"><title>Week ${weekly[index].week}: ${fmtPct(value)}</title></circle><text x="${x(index)}" y="${height - 8}" text-anchor="middle">${weekly[index].week}</text>`).join("")}</g></svg>` : `<p class="muted">No weekly history for this team.</p>`;
}

function renderHealth() {
  const health = state.data.meta.dataHealth || {};
  document.getElementById("healthStatus").textContent = health.status || "Unknown";
  document.getElementById("healthStatus").classList.toggle("needs-attention", health.status !== "healthy");
  const rows = [
    ["Latest week", health.latestWeek],
    ["Snapshots", health.snapshotCount],
    ["Frozen", health.frozenSnapshots],
    ["Provisional", health.provisionalSnapshots],
    ["Source coverage", fmtPct(health.sourceCoverage)],
    ["Score weeks", health.scoreWeeks],
  ];
  document.getElementById("healthMetrics").innerHTML = rows.map(([label, value]) => `<div><strong>${value ?? "-"}</strong><span>${label}</span></div>`).join("");
  const snapshots = currentWeeklyRows();
  document.getElementById("snapshotAudit").innerHTML = snapshots.map((snapshot) => `<div><span>Week ${snapshot.week}</span><strong>${snapshot.isFrozen ? "Frozen" : "Provisional"}</strong><code>${snapshot.snapshotId || "legacy"}</code></div>`).join("");
}

function renderBacktestChart() {
  const container = document.getElementById("backtestChart");
  const rows = state.data.backtest;
  const width = 900;
  const height = 260;
  const pad = { top: 18, right: 18, bottom: 36, left: 42 };
  const x = (index) => pad.left + (index / (rows.length - 1)) * (width - pad.left - pad.right);
  const maxRank = Math.max(5, ...rows.map((row) => Number(row.actualChampionPredictedRank) || 1));
  const y = (rank) => pad.top + ((rank - 1) / (maxRank - 1)) * (height - pad.top - pad.bottom);
  const points = rows.map((row, index) => `${x(index)},${y(row.actualChampionPredictedRank)}`).join(" ");
  const hitDots = rows
    .map((row, index) => {
      const selected = String(row.year) === state.selectedYear;
      const color = selected ? "#d4a017" : row.hit ? "#22735f" : "#b84a48";
      const radius = selected ? 6.5 : 4.5;
      return `<circle cx="${x(index)}" cy="${y(row.actualChampionPredictedRank)}" r="${radius}" fill="${color}"><title>${row.year}: ${row.actualChampion} ranked ${row.actualChampionPredictedRank}</title></circle>`;
    })
    .join("");
  const yearLabels = rows
    .filter((_, index) => index % 2 === 0 || index === rows.length - 1)
    .map((row, index) => `<text x="${x(index * 2 >= rows.length ? rows.length - 1 : index * 2)}" y="${height - 10}" text-anchor="middle">${row.year}</text>`)
    .join("");
  const rankStep = maxRank <= 6 ? 1 : 2;
  const rankLabels = Array.from({ length: Math.ceil((maxRank - 1) / rankStep) + 1 }, (_, index) => 1 + index * rankStep)
    .filter((rank) => rank <= maxRank)
    .map((rank) => `<text x="28" y="${y(rank) + 4}" text-anchor="end">${rank}</text><line x1="${pad.left}" x2="${width - pad.right}" y1="${y(rank)}" y2="${y(rank)}" stroke="#e5ecef"/>`)
    .join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img">
      <g class="axis">${rankLabels}${yearLabels}</g>
      <polyline points="${points}" fill="none" stroke="#2f72b7" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      ${hitDots}
      <text x="8" y="18" transform="rotate(-90 8 18)" class="axis-title">Projected rank</text>
    </svg>
  `;
}

function renderDatasetMetrics() {
  const metrics = state.data.meta.datasetMetrics || {};
  const rows = [
    ["Team-seasons", metrics.teamSeasons],
    ["Seasons", metrics.seasons],
    ["Programs", metrics.teams],
    ["Source metrics", metrics.sourceMetrics],
    ["Engineered metrics", metrics.engineeredMetrics],
    ["Models", metrics.modelsEvaluated],
  ];
  document.getElementById("datasetMetrics").innerHTML = rows
    .map(([label, value]) => `<div><strong>${fmtRank(value)}</strong><span>${label}</span></div>`)
    .join("");
  document.getElementById("evaluationNote").textContent = state.data.meta.modelEvaluation || "";
}

function renderTable() {
  const body = document.getElementById("resultsBody");
  const rows = filteredRows();
  document.getElementById("rowCount").textContent = `${rows.length} teams shown`;
  body.innerHTML = rows
    .map(
      (row) => `
      <tr class="${row.Ranking === 1 ? "champion-row" : ""}">
        <td><span class="rank-badge">${row.predictedRank}</span></td>
        <td><strong>${row.Team}</strong></td>
        <td>${fmtPct(row.championProbability)}</td>
        <td>${fmtRank(row.Ranking ?? row.CFP ?? row["AP POLL"])}</td>
        <td>${fmtRank(row.SOR)}</td>
        <td>${fmtRank(row.SOS)}</td>
        <td>${fmtRank(row.Offense)}</td>
        <td>${fmtRank(row.Defense)}</td>
        <td>${fmtRank(row.FPI)}</td>
        <td>${fmtRank(row["Game Control"])}</td>
        <td>${fmtPct(row["Win Pct"])}</td>
        <td>${fmtSigned(row["Scoring Margin"])}</td>
        <td>${fmtDecimal(row["Consensus Score"], 1)}</td>
        <td>${fmtDecimal(row["Balance Score"], 1)}</td>
      </tr>
    `,
    )
    .join("");
}

function renderSources() {
  const container = document.getElementById("sourceLinks");
  container.innerHTML = state.data.meta.sources
    .map((source) => `<a href="${source.url}" target="_blank" rel="noreferrer">${source.label}</a>`)
    .join("");
}

function renderSeasonTabs() {
  const container = document.getElementById("seasonTabs");
  container.innerHTML = seasonYears()
    .map((year) => `<button class="season-tab" data-year="${year}" type="button">${year}</button>`)
    .join("");
  container.querySelectorAll(".season-tab").forEach((button) => {
    button.addEventListener("click", async () => {
      state.selectedYear = button.dataset.year;
      if ((state.data.meta.weeklyYears || []).includes(Number(state.selectedYear))) {
        state.weeklyYear = state.selectedYear;
        await loadWeeklyYear(state.weeklyYear);
        document.getElementById("historyYear").value = state.weeklyYear;
      }
      state.query = "";
      document.getElementById("teamSearch").value = "";
      renderAll();
    });
  });
}

function formatGameTime(game) {
  if (game.statusType === "STATUS_SCHEDULED") {
    return new Date(game.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (game.statusType === "STATUS_FINAL") {
    return "Final";
  }
  return game.statusDetail || game.statusShort || "Live";
}

function liveImpactMarkup(game, away, home) {
  if (game.statusType !== "STATUS_IN_PROGRESS") return "";
  const rows = currentSeason().records;
  const awayRow = rows.find((row) => row.Team === (away.shortName || away.name));
  const homeRow = rows.find((row) => row.Team === (home.shortName || home.name));
  const focus = [awayRow, homeRow].filter(Boolean).sort((a, b) => b.championProbability - a.championProbability)[0];
  const live = game.liveWinProbability;
  const gameOdds = live ? (focus === awayRow ? live.away : live.home) : null;
  if (!focus) return live ? `<div class="live-impact"><span>Live win probability</span><strong>${away.shortName || away.name} ${fmtPct(live.away)} · ${home.shortName || home.name} ${fmtPct(live.home)}</strong><small>${game.situation?.downDistance || live.method}</small></div>` : "";
  const focusIsAway = focus === awayRow;
  const leading = Number(focusIsAway ? away.score : home.score) >= Number(focusIsAway ? home.score : away.score);
  const base = Number(focus.championProbability);
  const shift = gameOdds === null ? (leading ? Math.min(.12, (1 - base) * .14) : -Math.min(.1, base * .42)) : (gameOdds - .5) * Math.min(.24, (1-base)*.3);
  return `<div class="live-impact"><span>${focus.Team} live win · title forecast</span><strong>${fmtPct(gameOdds)} · ${fmtPct(base)} → ${fmtPct(Math.max(.001, Math.min(.95, base + shift)))}</strong><small>${game.situation?.downDistance || live?.method || "Score-based estimate"}${game.situation?.lastPlay ? ` · ${game.situation.lastPlay}` : ""}</small></div>`;
}

function renderScores() {
  const container = document.getElementById("scoresGrid");
  const status = document.getElementById("scoresStatus");
  if (!state.scores.length) {
    container.innerHTML = `<p class="muted">No FBS games found for today.</p>`;
    status.textContent = "No games";
    return;
  }
  status.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  container.innerHTML = state.scores
    .map((game) => {
      const teams = game.competitors || [];
      const away = teams.find((team) => team.homeAway === "away") || teams[0] || {};
      const home = teams.find((team) => team.homeAway === "home") || teams[1] || {};
      const isLive = game.statusType === "STATUS_IN_PROGRESS";
      return `
        <article class="score-card ${isLive ? "is-live" : ""}">
          <div class="score-card-head">
            <span>${formatGameTime(game)}</span>
            <strong>${game.statusDetail || game.statusShort || ""}</strong>
          </div>
          <div class="score-team">
            <span>${away.rank ? `${away.rank} ` : ""}${away.shortName || away.name || "Away"}</span>
            <strong>${fmtScore(away.score)}</strong>
          </div>
          <div class="score-team">
            <span>${home.rank ? `${home.rank} ` : ""}${home.shortName || home.name || "Home"}</span>
            <strong>${fmtScore(home.score)}</strong>
          </div>
          ${liveImpactMarkup(game, away, home)}
          <p>${game.venue || "Venue TBD"}${game.broadcast ? ` - ${game.broadcast}` : ""}</p>
        </article>
      `;
    })
    .join("");
}

function scoreCard(game) {
  const teams = game.competitors || [];
  const away = teams.find((team) => team.homeAway === "away") || teams[0] || {};
  const home = teams.find((team) => team.homeAway === "home") || teams[1] || {};
  const isLive = game.statusType === "STATUS_IN_PROGRESS";
  return `
    <article class="score-card ${isLive ? "is-live" : ""}">
      <div class="score-card-head">
        <span>${formatGameTime(game)}</span>
        <strong>${game.statusDetail || game.statusShort || ""}</strong>
      </div>
      <div class="score-team">
        <span>${away.rank ? `${away.rank} ` : ""}${away.shortName || away.name || away.team || "Away"}</span>
        <strong>${fmtScore(away.score)}</strong>
      </div>
      <div class="score-team">
        <span>${home.rank ? `${home.rank} ` : ""}${home.shortName || home.name || home.team || "Home"}</span>
        <strong>${fmtScore(home.score)}</strong>
      </div>
      <p>${game.venue || "Venue TBD"}${game.broadcast ? ` - ${game.broadcast}` : ""}</p>
    </article>
  `;
}

function renderSavedScores() {
  const snapshots = state.data.scoreSnapshots || {};
  const latestYear = Object.keys(snapshots).sort((a, b) => Number(b) - Number(a))[0];
  const latestWeek = latestYear ? Object.keys(snapshots[latestYear]).sort((a, b) => Number(b) - Number(a))[0] : null;
  const snapshot = latestYear && latestWeek ? snapshots[latestYear][latestWeek] : null;
  const container = document.getElementById("savedScoresGrid");
  if (!snapshot) {
    document.getElementById("savedScoresTitle").textContent = "Stored weekly scores";
    document.getElementById("savedScoresCount").textContent = "No snapshot";
    container.innerHTML = `<p class="muted">No stored weekly score snapshot is available yet.</p>`;
    return;
  }
  document.getElementById("savedScoresTitle").textContent = `${latestYear} week ${latestWeek} scores`;
  document.getElementById("savedScoresCount").textContent = `${snapshot.completedGameCount} of ${snapshot.gameCount} final`;
  container.innerHTML = snapshot.games.map(scoreCard).join("");
}

async function loadScores() {
  const status = document.getElementById("scoresStatus");
  status.textContent = "Refreshing";
  try {
    const response = await fetch(`/api/scores?ts=${Date.now()}`);
    if (!response.ok) {
      throw new Error(`Scoreboard returned ${response.status}`);
    }
    const payload = await response.json();
    state.scores = payload.games || [];
    renderScores();
  } catch (error) {
    status.textContent = "Unavailable";
    document.getElementById("scoresGrid").innerHTML = `<p class="muted">Live scores are unavailable right now. Try refreshing again in a minute.</p>`;
  }
}

function downloadBlob(name, content, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 500);
}

function exportCsv() {
  const rows = currentSeason().records;
  const columns = ["predictedRank", "Team", "championProbability", "Game Elo", "Expected Remaining Wins", "Play Success Rate", "Estimated EPA Per Play", "Explosive Play Rate", "Havoc Rate", "Finishing Drives", "Scoring Margin", "Resume Composite", "Power Composite"];
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => escape(row[column])).join(","))].join("\n");
  downloadBlob(`ncaaf-predictions-${state.selectedYear}.csv`, csv, "text/csv;charset=utf-8");
}

async function shareCurrentView() {
  const url = new URL(location.href);
  url.hash = state.currentView === "team" ? `team=${encodeURIComponent(state.teamPage)}` : state.currentView;
  try {
    await navigator.clipboard.writeText(url.toString());
    document.getElementById("shareView").textContent = "Link copied";
  } catch {
    prompt("Share this dashboard view", url.toString());
  }
  setTimeout(() => { document.getElementById("shareView").textContent = "Share view"; }, 1800);
}

function exportVisibleChart() {
  const visible = [...document.querySelectorAll(`main[data-active-view="${state.currentView}"] svg`)].find((svg) => svg.getClientRects().length);
  if (!visible) return;
  const source = new XMLSerializer().serializeToString(visible);
  downloadBlob(`ncaaf-${state.currentView}-chart.svg`, source, "image/svg+xml;charset=utf-8");
}

function renderAll() {
  renderSummary();
  renderProbabilityChart();
  renderPredictionExplanation();
  renderUncertainty();
  renderFeatureImportance();
  renderModelCards();
  renderWeeklyDiagnostics();
  renderCalibration();
  renderDatasetMetrics();
  renderBacktestChart();
  renderWeeklyTimeline();
  renderMovement();
  populateTeamControls();
  renderTeamPage();
  renderWatchlist();
  renderAdvancedMetrics();
  renderScenario();
  renderWeeklyEvaluation();
  renderGameModel();
  renderCalibratedModels();
  renderModelLab();
  renderWeeklyReport();
  renderReplay();
  renderScenarioBuilder();
  renderPlayoffBracket();
  renderResearch();
  renderHealth();
  renderAuditProducts();
  renderTable();
  renderSources();
  renderSavedScores();
  checkWatchlistAlerts();
}

async function init() {
  const response = await fetch(`./data/app-core.json?v=${Date.now()}`, { cache: "no-store" });
  state.data = await response.json();
  state.selectedYear = String(state.data.meta.currentSeason || seasonYears()[0]);
  state.weeklyYear = state.selectedYear;
  await loadWeeklyYear(state.weeklyYear);
  const history = document.getElementById("historyYear");
  history.innerHTML = (state.data.meta.weeklyYears || []).map((year) => `<option value="${year}">${year}</option>`).join("");
  history.value = state.weeklyYear;
  state.replayYear = state.selectedYear;
  const replayYear = document.getElementById("replayYear");
  replayYear.innerHTML = (state.data.meta.weeklyYears || []).map((year) => `<option value="${year}">${year}</option>`).join("");
  replayYear.value = state.replayYear;
  renderSeasonTabs();
  renderAll();
  setView(location.hash.slice(1) || "overview");
  loadCloudWatchlist().then(renderWatchlist);

  document.getElementById("teamSearch").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderTable();
  });

  document.getElementById("sortMode").addEventListener("change", (event) => {
    state.sortMode = event.target.value;
    renderTable();
  });

  document.getElementById("weeklyModel").addEventListener("change", (event) => {
    state.weeklyModel = event.target.value;
    renderSummary();
    renderWeeklyTimeline();
  });

  document.getElementById("historyYear").addEventListener("change", async (event) => {
    state.weeklyYear = event.target.value;
    event.target.disabled = true;
    try {
      await loadWeeklyYear(state.weeklyYear);
      renderSummary();
      renderWeeklyTimeline();
      renderMovement();
      renderResearch();
      renderHealth();
    } finally {
      event.target.disabled = false;
    }
  });

  document.getElementById("movementCount").addEventListener("change", (event) => {
    state.movementCount = Number(event.target.value);
    renderMovement();
  });

  ["scenarioTeam", "scenarioResult", "scenarioOpponent", "scenarioMargin"].forEach((id) => document.getElementById(id).addEventListener("input", renderScenario));
  document.getElementById("researchTeam").addEventListener("change", renderResearch);
  document.getElementById("metricsTeam").addEventListener("change", renderAdvancedMetrics);
  document.getElementById("teamPageSelect").addEventListener("change", (event) => {
    state.teamPage = event.target.value;
    renderTeamPage();
    history.replaceState(null, "", `#team=${encodeURIComponent(state.teamPage)}`);
  });
  document.getElementById("evaluationMetric").addEventListener("change", renderWeeklyEvaluation);
  ["labModelA", "labModelB"].forEach((id) => document.getElementById(id).addEventListener("change", renderModelLab));
  document.getElementById("replayYear").addEventListener("change", async (event) => {
    state.replayYear = event.target.value;
    await loadWeeklyYear(state.replayYear);
    state.replayWeek = state.data.weeklyPredictions[state.replayYear].at(-1)?.week;
    renderReplay();
  });
  document.getElementById("replayWeek").addEventListener("change", (event) => { state.replayWeek = Number(event.target.value); renderReplay(); });
  document.getElementById("copyReport").addEventListener("click", async () => {
    await navigator.clipboard.writeText(reportText());
    document.getElementById("copyReport").textContent = "Copied";
    setTimeout(() => { document.getElementById("copyReport").textContent = "Copy report"; }, 1600);
  });
  document.getElementById("runSimulation").addEventListener("click", runSeasonSimulation);
  document.getElementById("clearScenario").addEventListener("click", () => {
    state.scenarioPicks = {};
    renderScenarioBuilder();
    runSeasonSimulation();
  });
  document.getElementById("resetBracket").addEventListener("click", () => { state.bracketPicks = {}; renderPlayoffBracket(); });
  document.getElementById("enableAlerts").addEventListener("click", async () => {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    document.getElementById("enableAlerts").textContent = permission === "granted" ? "Alerts enabled" : "Alerts blocked";
    checkWatchlistAlerts();
  });
  document.getElementById("shareView").addEventListener("click", shareCurrentView);
  document.getElementById("exportCsv").addEventListener("click", exportCsv);
  document.getElementById("exportChart").addEventListener("click", exportVisibleChart);
  document.getElementById("addWatchTeam").addEventListener("click", () => {
    const team = document.getElementById("watchTeam").value;
    if (!state.watchlist.some((item) => item.team === team)) {
      const row = currentSeason().records.find((item) => item.Team === team);
      state.watchlist.push({ team, threshold: Math.min(.9, Math.max(.05, Number(row?.championProbability || .05) + .03)) });
      saveWatchlist();
      renderWatchlist();
    }
  });
  document.querySelectorAll("[data-route]").forEach((item) => item.addEventListener("click", (event) => {
    event.preventDefault();
    setView(item.dataset.route);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
  window.addEventListener("hashchange", () => setView(location.hash.slice(1)));

  document.getElementById("refreshScores").addEventListener("click", loadScores);
  loadScores();
  window.setInterval(loadScores, 60_000);
  runSeasonSimulation();
}

init().catch((error) => {
  document.body.innerHTML = `<pre>${error.stack || error.message}</pre>`;
});
