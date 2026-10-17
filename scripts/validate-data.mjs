import { readFile } from "node:fs/promises";

const data = JSON.parse(await readFile(new URL("../data/app-core.json", import.meta.url), "utf8"));
const season = String(data.meta.currentSeason);
const records = data.seasonPredictions?.[season]?.records || [];
const games = data.seasonSchedule?.games || [];
const failures = [];

if (records.length !== 25) failures.push(`Expected 25 ranked teams, found ${records.length}.`);
if (new Set(games.map((game) => game.id)).size !== games.length) failures.push("Duplicate schedule IDs detected.");
if (games.some((game) => !game.gameModel)) failures.push("At least one scheduled game lacks a probability.");
if (Object.keys(data.gameModel?.currentTeams || {}).length < 150) failures.push("Current game-model team coverage is incomplete.");
if (!data.gameModel?.calibration?.bins?.length) failures.push("Game calibration bins are missing.");
if (!Number.isFinite(data.gameModel?.calibration?.calibratedBrier)) failures.push("Calibrated Brier score is invalid.");
if (!data.selectionModel?.version) failures.push("CFP selection model is missing.");
if (records.some((row) => !Number.isFinite(row["CFP Selection Probability"]))) failures.push("CFP selection probabilities are incomplete.");
const selectionEras = data.selectionModel?.eras || [];
if (selectionEras.length !== 2 || ![4, 12].every((size) => selectionEras.some((era) => era.fieldSize === size))) {
  failures.push("Four-team and twelve-team CFP selection eras are required.");
}
if (selectionEras.some((era) => !era.labelPolicy || !era.leakagePolicy || !era.labelEvidence)) {
  failures.push("CFP era label evidence or leakage policy is missing.");
}
if (records.some((row) => !Number.isFinite(row["Opponent Adjusted EPA Per Play"]))) failures.push("Opponent-adjusted EPA is incomplete.");
if (!data.gameModel?.pregameFeatureStore?.sha256) failures.push("Pregame feature-store provenance is missing.");
const changelog = data.predictionChangelog || [];
if (!changelog.length || changelog.some((week) => !week.teamChanges?.length)) failures.push("Prediction-change explanations are missing.");
const requiredEffects = ["poll", "resume", "efficiency", "opponent", "modelConsensus"];
if (changelog.some((week) => week.teamChanges.some((team) => requiredEffects.some((key) => !Number.isFinite(team.explanation?.effects?.[key]))))) {
  failures.push("Prediction-change effect decomposition is incomplete.");
}
if (changelog.some((week) => week.teamChanges.some((team) => Math.abs(team.explanation?.decompositionResidual || 0) > 1e-10))) {
  failures.push("Prediction-change effects do not reconcile to the probability change.");
}
if (data.rosterAvailability?.contractVersion !== "roster-availability-v1") failures.push("Roster-availability contract is missing.");
if (data.rosterAvailability?.feedStatus === "neutral-fallback" && records.some((row) => row["Roster Availability Adjustment"] !== 0)) {
  failures.push("Neutral roster fallback must not alter predictions.");
}
if (!data.conferenceRace?.conferences?.length) failures.push("Conference race projections are missing.");
if (data.conferenceRace?.conferences?.some((conference) => !conference.projectedChampion || conference.teams?.some((team) => !team.tiebreakerEvidence?.length))) {
  failures.push("Conference race tiebreaker evidence is incomplete.");
}
if (!data.modelDrift?.byWeekModel?.length || !data.modelDrift?.latest?.length) failures.push("Model drift monitoring is missing.");
if (data.modelDrift?.latest?.some((row) => !["stable", "warning", "critical"].includes(row.status))) failures.push("Model drift status is invalid.");
const ensembleNames = (data.ensembleMetadata?.members || []).map((row) => row.name);
for (const name of ["Weekly Bayesian Logistic", "Weekly Elo Rating", "Weekly Forward Stacker"]) {
  if (!ensembleNames.includes(name)) failures.push(`${name} metadata is missing.`);
}
if (!data.ensembleMetadata?.stacking?.leakagePolicy) failures.push("Forward-stacking leakage policy is missing.");
if (!data.meta?.lineage?.artifacts?.weeklySnapshotHash || !data.meta?.lineage?.sources?.length) failures.push("Source lineage is incomplete.");
if (data.publicApi?.contractVersion !== "ncaaf-public-data-v2" || !data.publicApi?.staticData?.length) failures.push("Public API metadata is missing.");
if (data.dataQuality?.status !== "healthy") failures.push(`Data quality status is ${data.dataQuality?.status || "missing"}.`);

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Validated ${records.length} ranked teams, ${games.length} games, ${data.gameModel.trainingGames} training games, ${data.gameModel.pregameFeatureStore.rows} pregame feature rows, ${data.conferenceRace.conferenceCount} conference races, and ${data.modelDrift.latest.length} current drift monitors.`);
