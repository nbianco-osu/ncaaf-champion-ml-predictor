const state = {
  data: null,
  query: "",
  sortMode: "predictedRank",
  selectedYear: "2025",
};

const fmtPct = (value) => `${(value * 100).toFixed(1)}%`;
const fmtRank = (value) => Number(value).toLocaleString();
const max = (items, key) => Math.max(...items.map((item) => Number(item[key])));

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
  const cap = Math.max(...rows.map((row) => row.predictedProbability));
  container.innerHTML = rows
    .map((row) => {
      const width = Math.max(4, (row.predictedProbability / cap) * 100);
      const actual = row.predictedChampion === row.actualChampion;
      const selected = row.week === rows[rows.length - 1].week;
      return `
        <div class="weekly-row ${actual ? "is-actual" : ""} ${selected ? "is-selected" : ""}">
          <span class="weekly-week">Week ${row.week}</span>
          <span class="weekly-team">${row.predictedChampion}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
          <span class="weekly-prob">${fmtPct(row.predictedProbability)}</span>
        </div>
      `;
    })
    .join("");
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
