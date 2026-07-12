const state = {
  data: null,
  query: "",
  sortMode: "predictedRank",
  selectedYear: "2025",
  weeklyModel: "Balanced ML Blend",
};

const fmtPct = (value) => `${(value * 100).toFixed(1)}%`;
const fmtRank = (value) => Number(value).toLocaleString();
const max = (items, key) => Math.max(...items.map((item) => Number(item[key])));
const teamLogoIds = {
  Alabama: 333,
  BYU: 252,
  Georgia: 61,
  Indiana: 84,
  Michigan: 130,
  "Ohio State": 194,
  Oklahoma: 201,
  Oregon: 2483,
  Tennessee: 2633,
  Texas: 251,
  "Texas A&M": 245,
};

function logoUrl(team) {
  const id = teamLogoIds[team];
  return id ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png` : "";
}

function currentSeason() {
  return state.data.seasonPredictions[state.selectedYear];
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
  document.getElementById("predictedChampion").textContent = season.predictedChampion;
  document.getElementById("predictionNote").textContent = `${fmtPct(season.topProbability)} model probability for the ${season.year} page.`;
  document.getElementById("actualChampion").textContent = season.actualChampion;
  document.getElementById("actualRankNote").textContent = `Actual champion projected rank: ${season.actualChampionPredictedRank}.`;
  document.getElementById("chartSeasonLabel").textContent = `${season.year} top 10`;
  document.getElementById("tableSeasonLabel").textContent = `Final ${season.year} top 25`;
  document.getElementById("weeklySeasonLabel").textContent = `${season.year} week by week`;
  document.getElementById("hitRate").textContent = fmtPct(summary.backtestHitRate);
  document.getElementById("top3Rate").textContent = fmtPct(summary.backtestTop3Rate);
  document.getElementById("modelChip").textContent = meta.selectedModel;
  const weeklySelect = document.getElementById("weeklyModel");
  const weeklyModels = meta.weeklyModels || ["Balanced ML Blend"];
  if (!weeklySelect.options.length) {
    weeklySelect.innerHTML = weeklyModels.map((model) => `<option value="${model}">${model}</option>`).join("");
  }
  if (!weeklyModels.includes(state.weeklyModel)) {
    state.weeklyModel = weeklyModels[0];
  }
  weeklySelect.value = state.weeklyModel;
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
          <strong>${row.predictedRank}. ${row.Team}</strong>
          <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
          <span>${fmtPct(row.championProbability)}</span>
        </div>
      `;
    })
    .join("");
}

function renderWeeklyTimeline() {
  const container = document.getElementById("weeklyTimeline");
  const rows = state.data.weeklyPredictions?.[state.selectedYear] || [];
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
        <div>
          <strong>${model.model}</strong>
          <p>2025 holdout pick: ${model.holdoutPick} - ${fmtPct(model.championProbability)} top probability - log loss ${model.holdoutLogLoss.toFixed(3)}</p>
        </div>
        <span class="status">${model.pickedChampion ? "Hit" : "Miss"}</span>
      </div>
    `,
    )
    .join("");
}

function renderBacktestChart() {
  const container = document.getElementById("backtestChart");
  const rows = state.data.backtest;
  const width = 900;
  const height = 260;
  const pad = { top: 18, right: 18, bottom: 36, left: 42 };
  const x = (index) => pad.left + (index / (rows.length - 1)) * (width - pad.left - pad.right);
  const y = (rank) => pad.top + ((rank - 1) / 4) * (height - pad.top - pad.bottom);
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
  const rankLabels = [1, 2, 3, 4, 5]
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
        <td>${fmtRank(row.Ranking)}</td>
        <td>${fmtRank(row.SOR)}</td>
        <td>${fmtRank(row.SOS)}</td>
        <td>${fmtRank(row.Offense)}</td>
        <td>${fmtRank(row.Defense)}</td>
        <td>${fmtRank(row.FPI)}</td>
        <td>${fmtRank(row["Game Control"])}</td>
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

function renderAll() {
  renderSummary();
  renderProbabilityChart();
  renderFeatureImportance();
  renderModelCards();
  renderBacktestChart();
  renderWeeklyTimeline();
  renderTable();
  renderSources();
}

async function init() {
  const response = await fetch("./data/app-data.json");
  state.data = await response.json();
  renderAll();

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

  document.querySelectorAll(".season-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedYear = button.dataset.year;
      state.query = "";
      document.getElementById("teamSearch").value = "";
      renderAll();
    });
  });
}

init().catch((error) => {
  document.body.innerHTML = `<pre>${error.stack || error.message}</pre>`;
});
