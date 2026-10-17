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
if (records.some((row) => !Number.isFinite(row["Opponent Adjusted EPA Per Play"]))) failures.push("Opponent-adjusted EPA is incomplete.");
if (!data.gameModel?.pregameFeatureStore?.sha256) failures.push("Pregame feature-store provenance is missing.");
if (data.dataQuality?.status !== "healthy") failures.push(`Data quality status is ${data.dataQuality?.status || "missing"}.`);

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Validated ${records.length} ranked teams, ${games.length} games, ${data.gameModel.trainingGames} training games, and ${data.gameModel.pregameFeatureStore.rows} pregame feature rows.`);
