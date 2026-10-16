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

function saveWatchlist() {
  localStorage.setItem("ncaaf-watchlist", JSON.stringify(state.watchlist));
}

function renderWatchlist() {
  const rows = currentSeason().records;
  const weekly = state.data.weeklyPredictions?.[String(state.data.meta.currentSeason)] || [];
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
  ];
  document.getElementById("advancedMetrics").innerHTML = metrics.map(([label, value, formatter]) => `<div><span>${label}</span><strong>${formatter(value)}</strong></div>`).join("");
  document.getElementById("metricAvailability").innerHTML = (state.data.meta.advancedMetrics || []).map((item) => `<div class="availability-item ${item.status}"><span>${item.name}</span><strong>${item.status}</strong><small>${item.source}</small></div>`).join("");
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
  const ids = ["scenarioTeam", "researchTeam", "metricsTeam", "watchTeam"];
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
  const home = teamA === homeTeam ? .16 : teamB === homeTeam ? -.16 : 0;
  const probability = 1 / (1 + Math.exp(-((ratings[teamA] ?? -1.2) - (ratings[teamB] ?? -1.2) + home)));
  return random() < probability ? teamA : teamB;
}

function runSeasonSimulation() {
  const runs = Number(document.getElementById("simulationRuns").value);
  const records = currentSeason().records;
  const schedule = state.data.seasonSchedule?.games || [];
  const teams = records.map((row) => row.Team);
  const teamSet = new Set(teams);
  const ratings = Object.fromEntries(records.map((row) => {
    const probability = Math.max(.002, Math.min(.8, Number(row.championProbability || .002)));
    return [row.Team, Math.log(probability / (1 - probability)) + Number(row["Consensus Score"] || 0) / 35];
  }));
  const baseWins = Object.fromEntries(records.map((row) => [row.Team, Number(String(row.RECORD || "0-0").split("-")[0]) || 0]));
  const conferences = {};
  for (const game of schedule) for (const competitor of game.competitors || []) {
    if (teamSet.has(competitor.team) && competitor.conferenceId) conferences[competitor.team] = competitor.conferenceId;
  }
  const remaining = schedule.filter((game) => !game.completed && (game.competitors || []).some((team) => teamSet.has(team.team)));
  const playoffCounts = Object.fromEntries(teams.map((team) => [team, 0]));
  const titleCounts = Object.fromEntries(teams.map((team) => [team, 0]));
  const conferenceCounts = Object.fromEntries(teams.map((team) => [team, 0]));
  const random = seededRandom(Number(state.data.meta.currentSeason) * 100 + (currentWeeklyRows().at(-1)?.week || 0));

  for (let run = 0; run < runs; run += 1) {
    const wins = { ...baseWins };
    for (const game of remaining) {
      const competitors = game.competitors || [];
      if (competitors.length !== 2) continue;
      const a = competitors[0].team;
      const b = competitors[1].team;
      const home = competitors.find((item) => item.homeAway === "home")?.team;
      const winner = playGame(a, b, ratings, random, game.neutralSite ? null : home);
      if (teamSet.has(winner)) wins[winner] = (wins[winner] || 0) + 1;
    }
    const conferenceBonus = {};
    const conferenceTeams = Object.groupBy ? Object.groupBy(teams.filter((team) => conferences[team]), (team) => conferences[team]) : teams.filter((team) => conferences[team]).reduce((out, team) => ((out[conferences[team]] ||= []).push(team), out), {});
    for (const group of Object.values(conferenceTeams)) {
      if (group.length < 2) continue;
      const finalists = [...group].sort((a, b) => (wins[b] - wins[a]) || (ratings[b] - ratings[a])).slice(0, 2);
      const champion = playGame(finalists[0], finalists[1], ratings, random);
      conferenceBonus[champion] = 1;
      conferenceCounts[champion] += 1;
    }
    const field = teams.map((team) => ({ team, score: wins[team] * 1.45 + ratings[team] + (conferenceBonus[team] || 0) * .8 + random() * .35 }))
      .sort((a, b) => b.score - a.score).slice(0, 12).map((item) => item.team);
    field.forEach((team) => { playoffCounts[team] += 1; });
    const opening = [[field[4], field[11]], [field[5], field[10]], [field[6], field[9]], [field[7], field[8]]]
      .map(([a, b]) => playGame(a, b, ratings, random));
    let round = [field[0], field[1], field[2], field[3], ...opening];
    while (round.length > 1) {
      const next = [];
      for (let index = 0; index < round.length; index += 2) next.push(playGame(round[index], round[index + 1], ratings, random));
      round = next;
    }
    titleCounts[round[0]] += 1;
  }

  const results = teams.map((team) => ({ team, playoff: playoffCounts[team] / runs, title: titleCounts[team] / runs, conference: conferenceCounts[team] / runs }))
    .sort((a, b) => b.title - a.title).slice(0, 12);
  document.getElementById("simulationSummary").innerHTML = `<div><strong>${runs.toLocaleString()}</strong><span>simulations</span></div><div><strong>${remaining.length}</strong><span>remaining games modeled</span></div><div><strong>${new Set(Object.values(conferences)).size}</strong><span>conference races</span></div>`;
  document.getElementById("simulationResults").innerHTML = results.map((row, index) => `<div class="simulation-row"><span>${index + 1}</span><strong>${row.team}</strong><div><i style="width:${Math.max(1, row.title * 100)}%"></i></div><b>${fmtPct(row.title)}</b><small>${fmtPct(row.playoff)} playoff · ${fmtPct(row.conference)} conf.</small></div>`).join("");
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
  const allowed = ["overview", "weekly", "models", "simulator", "scores", "data"];
  state.currentView = allowed.includes(view) ? view : "overview";
  document.querySelector("main").dataset.activeView = state.currentView;
  document.querySelectorAll("[data-route]").forEach((item) => item.classList.toggle("is-active", item.dataset.route === state.currentView));
  if (location.hash !== `#${state.currentView}`) history.replaceState(null, "", `#${state.currentView}`);
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
  renderWatchlist();
  renderAdvancedMetrics();
  renderScenario();
  renderWeeklyEvaluation();
  renderResearch();
  renderHealth();
  renderTable();
  renderSources();
  renderSavedScores();
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
  renderSeasonTabs();
  renderAll();
  setView(location.hash.slice(1) || "overview");

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
  document.getElementById("evaluationMetric").addEventListener("change", renderWeeklyEvaluation);
  document.getElementById("runSimulation").addEventListener("click", runSeasonSimulation);
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
