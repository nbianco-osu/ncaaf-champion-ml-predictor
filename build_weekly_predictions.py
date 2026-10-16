from __future__ import annotations

import json
import hashlib
import math
import time
from datetime import date, datetime, timezone
from io import StringIO
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import numpy as np
import pandas as pd


APP_DIR = Path(__file__).parent
DATA_PATH = APP_DIR / "data" / "app-data.json"
PUBLIC_DATA_PATH = APP_DIR / "public" / "data" / "app-data.json"
WEEKLY_FEATURES = ["SOR", "SOS", "FPI", "Game Control"]
WEEKLY_MODEL_FEATURES = [
    "SOR Score",
    "SOS Score",
    "FPI Score",
    "Game Control Score",
    "AP Poll Score",
    "Win Pct",
    "Resume Composite",
    "Power Composite",
    "Consensus Score",
    "Balance Score",
    "Consistency Score",
]
COMPLETED_YEARS = [2021, 2022, 2023, 2024, 2025]
WEEKS = range(1, 17)

MODEL_WEIGHTS = {
    "Balanced ML Blend": {
        "SOR Score": 0.34,
        "FPI Score": 0.28,
        "Game Control Score": 0.24,
        "SOS Score": 0.14,
    },
    "Resume Heavy": {
        "SOR Score": 0.54,
        "SOS Score": 0.18,
        "Game Control Score": 0.18,
        "FPI Score": 0.10,
    },
    "Power Rating Blend": {
        "FPI Score": 0.46,
        "Game Control Score": 0.26,
        "SOR Score": 0.20,
        "SOS Score": 0.08,
    },
    "Consensus Equal Weight": {
        "SOR Score": 0.25,
        "SOS Score": 0.25,
        "FPI Score": 0.25,
        "Game Control Score": 0.25,
    },
    "FPI Resume Ensemble": {
        "SOR Score": 0.35,
        "FPI Score": 0.35,
        "Game Control Score": 0.20,
        "SOS Score": 0.10,
    },
    "Game Control Focus": {
        "Game Control Score": 0.40,
        "SOR Score": 0.30,
        "FPI Score": 0.20,
        "SOS Score": 0.10,
    },
}

TRAINED_MODEL_NAMES = [
    "Weekly Logistic Regression",
    "Weekly Gaussian Naive Bayes",
    "Weekly K-Nearest Neighbors",
    "Weekly Ridge Probability",
]
TRAINED_ENSEMBLE = "Weekly ML Ensemble"


def current_college_football_season(today: date | None = None) -> int:
    today = today or date.today()
    return today.year if today.month >= 8 else today.year - 1


def norm_name(value: str) -> str:
    replacements = {
        "Alabama Crimson Tide": "Alabama",
        "Arizona Wildcats": "Arizona",
        "BYU Cougars": "BYU",
        "Clemson Tigers": "Clemson",
        "Florida State Seminoles": "Florida State",
        "Georgia Bulldogs": "Georgia",
        "Georgia Tech Yellow Jackets": "Georgia Tech",
        "Houston Cougars": "Houston",
        "Indiana Hoosiers": "Indiana",
        "Iowa Hawkeyes": "Iowa",
        "James Madison Dukes": "James Madison",
        "LSU Tigers": "LSU",
        "Miami Hurricanes": "Miami",
        "Michigan Wolverines": "Michigan",
        "Missouri Tigers": "Missouri",
        "Navy Midshipmen": "Navy",
        "North Texas Mean Green": "North Texas",
        "Notre Dame Fighting Irish": "Notre Dame",
        "Ohio State Buckeyes": "Ohio State",
        "Oklahoma Sooners": "Oklahoma",
        "Ole Miss Rebels": "Ole Miss",
        "Oregon Ducks": "Oregon",
        "Penn State Nittany Lions": "Penn State",
        "TCU Horned Frogs": "TCU",
        "Tennessee Volunteers": "Tennessee",
        "Texas Longhorns": "Texas",
        "Texas A&M Aggies": "Texas A&M",
        "Texas Tech Red Raiders": "Texas Tech",
        "Tulane Green Wave": "Tulane",
        "USC Trojans": "USC",
        "Utah Utes": "Utah",
        "Vanderbilt Commodores": "Vanderbilt",
        "Virginia Cavaliers": "Virginia",
        "Washington Huskies": "Washington",
    }
    if value in replacements:
        return replacements[value]
    text = str(value).strip()
    suffixes = [
        " Aggies",
        " Buckeyes",
        " Bulldogs",
        " Cavaliers",
        " Commodores",
        " Cougars",
        " Crimson Tide",
        " Ducks",
        " Fighting Irish",
        " Green Wave",
        " Hawkeyes",
        " Hoosiers",
        " Horned Frogs",
        " Hurricanes",
        " Huskies",
        " Mean Green",
        " Midshipmen",
        " Nittany Lions",
        " Rebels",
        " Seminoles",
        " Sooners",
        " Tigers",
        " Trojans",
        " Utes",
        " Volunteers",
        " Wolverines",
        " Yellow Jackets",
    ]
    for suffix in suffixes:
        if text.endswith(suffix):
            return text[: -len(suffix)]
    return text


def rank_norm(series: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(series, errors="coerce")
    max_rank = numeric.max()
    if pd.isna(max_rank) or max_rank <= 0:
        return pd.Series([0.0] * len(series), index=series.index)
    return ((max_rank - numeric + 1) / max_rank) * 100


def add_scores(frame: pd.DataFrame) -> pd.DataFrame:
    out = frame.copy()
    for feature in WEEKLY_FEATURES:
        out[f"{feature} Score"] = rank_norm(out[feature])
    if "AP POLL" in out.columns:
        out["AP Poll Score"] = rank_norm(out["AP POLL"])
    else:
        out["AP Poll Score"] = 0.0
    records = out.get("RECORD", pd.Series([""] * len(out), index=out.index)).fillna("").astype(str)
    parsed = records.str.extract(r"(?P<wins>\d+)-(?P<losses>\d+)").astype(float)
    games = parsed["wins"].fillna(0) + parsed["losses"].fillna(0)
    out["Win Pct"] = np.where(games > 0, parsed["wins"].fillna(0) / games, 0.0)
    out["Resume Composite"] = out[["SOR Score", "SOS Score"]].mean(axis=1)
    out["Power Composite"] = out[["FPI Score", "Game Control Score"]].mean(axis=1)
    out["Consensus Score"] = out[[f"{feature} Score" for feature in WEEKLY_FEATURES]].mean(axis=1)
    out["Balance Score"] = out[[f"{feature} Score" for feature in WEEKLY_FEATURES]].min(axis=1)
    out["Consistency Score"] = 100 - out[[f"{feature} Score" for feature in WEEKLY_FEATURES]].std(axis=1)
    return out


def softmax(scores: list[float], temperature: float = 7.5) -> list[float]:
    max_score = max(scores)
    exps = [math.exp((score - max_score) / temperature) for score in scores]
    total = sum(exps)
    return [value / total for value in exps]


def score_record(record: dict, weights: dict[str, float]) -> float:
    return sum(float(record.get(feature) or 0) * weight for feature, weight in weights.items())


def fetch_text(url: str) -> str | None:
    request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=30) as response:
                if response.status != 200:
                    return None
                return response.read().decode("utf-8", "replace")
        except HTTPError as exc:
            if exc.code == 404:
                return None
        except (ConnectionResetError, TimeoutError, URLError):
            if attempt == 2:
                return None
            time.sleep(2 * (attempt + 1))
    return None


def fetch_week(year: int, week: int) -> pd.DataFrame | None:
    url = f"https://www.espn.com/college-football/playoffPicture/_/week/{week}/year/{year}"
    html = fetch_text(url)
    if not html:
        return None
    tables = pd.read_html(StringIO(html))
    if not tables:
        return None
    table = tables[0]
    if table.shape[0] < 4:
        return None
    header = table.iloc[1].tolist()
    rows = table.iloc[2:].copy()
    rows.columns = header
    rows = rows[rows["TEAM"].notna()].copy()
    rows = rows.rename(columns={"TEAM": "Team", "RK": "FPI", "GC": "Game Control"})
    keep = ["Team", "RECORD", "CFP", "AP POLL", "SOS", "SOR", "Game Control", "RAT", "FPI"]
    rows = rows[[column for column in keep if column in rows.columns]]
    rows["Team"] = rows["Team"].map(norm_name)
    for column in ["CFP", "AP POLL", "SOS", "SOR", "Game Control", "FPI"]:
        if column in rows.columns:
            rows[column] = pd.to_numeric(rows[column].replace("--", np.nan), errors="coerce")
    rows["Year"] = year
    rows["Week"] = week
    rows["Source URL"] = url
    return rows.dropna(subset=WEEKLY_FEATURES)


def predictions_for_week(records: list[dict], actual_champion: str | None) -> list[dict]:
    predictions = []
    for model_name, weights in MODEL_WEIGHTS.items():
        scores = [score_record(record, weights) for record in records]
        probabilities = softmax(scores)
        ranked = sorted(
            [
                {
                    "team": record["Team"],
                    "score": score,
                    "probability": probability,
                }
                for record, score, probability in zip(records, scores, probabilities)
            ],
            key=lambda item: item["probability"],
            reverse=True,
        )
        actual_rank = None
        actual_prob = None
        if actual_champion and actual_champion != "TBD":
            actual_rank = next((index + 1 for index, item in enumerate(ranked) if item["team"] == actual_champion), None)
            actual_prob = next((item["probability"] for item in ranked if item["team"] == actual_champion), None)
        predictions.append(
            {
                "model": model_name,
                "predictedChampion": ranked[0]["team"],
                "predictedProbability": ranked[0]["probability"],
                "actualChampionPredictedRank": actual_rank,
                "actualChampionProbability": actual_prob,
            }
        )
    return predictions


def normalized_probability(raw: np.ndarray) -> np.ndarray:
    values = np.clip(np.asarray(raw, dtype=float), 1e-9, None)
    total = values.sum()
    return values / total if total else np.repeat(1 / len(values), len(values))


def standardize(train_x: np.ndarray, target_x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    mean = train_x.mean(axis=0)
    scale = train_x.std(axis=0)
    scale[scale < 1e-8] = 1.0
    return (train_x - mean) / scale, (target_x - mean) / scale


def logistic_probability(train_x: np.ndarray, train_y: np.ndarray, target_x: np.ndarray) -> np.ndarray:
    train, target = standardize(train_x, target_x)
    train = np.column_stack([np.ones(len(train)), train])
    target = np.column_stack([np.ones(len(target)), target])
    weights = np.zeros(train.shape[1])
    positives = max(1, int(train_y.sum()))
    negatives = max(1, len(train_y) - positives)
    sample_weights = np.where(train_y == 1, len(train_y) / (2 * positives), len(train_y) / (2 * negatives))
    for _ in range(350):
        logits = np.clip(train @ weights, -20, 20)
        predicted = 1 / (1 + np.exp(-logits))
        gradient = train.T @ ((predicted - train_y) * sample_weights) / len(train_y)
        gradient[1:] += 0.02 * weights[1:]
        weights -= 0.06 * gradient
    return 1 / (1 + np.exp(-np.clip(target @ weights, -20, 20)))


def gaussian_nb_probability(train_x: np.ndarray, train_y: np.ndarray, target_x: np.ndarray) -> np.ndarray:
    train, target = standardize(train_x, target_x)
    log_scores = []
    for label in [0, 1]:
        subset = train[train_y == label]
        if not len(subset):
            log_scores.append(np.full(len(target), -30.0))
            continue
        mean = subset.mean(axis=0)
        variance = subset.var(axis=0) + 0.35
        prior = max(len(subset) / len(train), 1e-9)
        score = np.log(prior) - 0.5 * np.sum(np.log(2 * np.pi * variance) + ((target - mean) ** 2) / variance, axis=1)
        log_scores.append(score)
    difference = np.clip(log_scores[1] - log_scores[0], -20, 20)
    return 1 / (1 + np.exp(-difference))


def knn_probability(train_x: np.ndarray, train_y: np.ndarray, target_x: np.ndarray) -> np.ndarray:
    train, target = standardize(train_x, target_x)
    k = max(3, min(17, int(math.sqrt(len(train))) | 1))
    probabilities = []
    for row in target:
        distances = np.sqrt(np.sum((train - row) ** 2, axis=1))
        nearest = np.argsort(distances)[:k]
        weights = 1 / (distances[nearest] + 0.35)
        probabilities.append(float(np.average(train_y[nearest], weights=weights)))
    return np.asarray(probabilities)


def ridge_probability(train_x: np.ndarray, train_y: np.ndarray, target_x: np.ndarray) -> np.ndarray:
    train, target = standardize(train_x, target_x)
    train = np.column_stack([np.ones(len(train)), train])
    target = np.column_stack([np.ones(len(target)), target])
    penalty = np.eye(train.shape[1]) * 3.0
    penalty[0, 0] = 0
    weights = np.linalg.pinv(train.T @ train + penalty) @ train.T @ train_y
    return np.clip(target @ weights, 1e-5, 1)


def predict_trained_model(name: str, train_x: np.ndarray, train_y: np.ndarray, target_x: np.ndarray) -> np.ndarray:
    predictors = {
        "Weekly Logistic Regression": logistic_probability,
        "Weekly Gaussian Naive Bayes": gaussian_nb_probability,
        "Weekly K-Nearest Neighbors": knn_probability,
        "Weekly Ridge Probability": ridge_probability,
    }
    return predictors[name](train_x, train_y, target_x)


def snapshot_frame(snapshot: dict) -> pd.DataFrame:
    frame = pd.DataFrame(snapshot.get("records", []))
    if frame.empty:
        return frame
    return add_scores(frame)


def prior_training_frame(weekly: dict[str, list[dict]], target_year: int, target_week: int) -> pd.DataFrame:
    rows = []
    for year_text, snapshots in weekly.items():
        year = int(year_text)
        if year >= target_year or year not in COMPLETED_YEARS:
            continue
        eligible = [item for item in snapshots if int(item.get("week", 0)) == target_week]
        if not eligible:
            eligible = [item for item in snapshots if int(item.get("week", 0)) <= target_week]
        if not eligible:
            continue
        snapshot = eligible[-1]
        actual = snapshot.get("actualChampion")
        if not actual or actual == "TBD":
            continue
        frame = snapshot_frame(snapshot)
        if frame.empty or actual not in set(frame["Team"]):
            continue
        frame["isChampion"] = (frame["Team"] == actual).astype(int)
        frame["trainingYear"] = year
        rows.append(frame)
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()


def prediction_summary(name: str, records: list[dict], probabilities: np.ndarray, actual: str | None, trained_seasons: int) -> dict:
    ranked = sorted(
        [
            {"team": record["Team"], "probability": float(probability)}
            for record, probability in zip(records, probabilities)
        ],
        key=lambda item: item["probability"],
        reverse=True,
    )
    actual_rank = next((index + 1 for index, item in enumerate(ranked) if item["team"] == actual), None)
    actual_prob = next((item["probability"] for item in ranked if item["team"] == actual), None)
    return {
        "model": name,
        "predictedChampion": ranked[0]["team"],
        "predictedProbability": ranked[0]["probability"],
        "actualChampionPredictedRank": actual_rank,
        "actualChampionProbability": actual_prob,
        "trainedSeasons": trained_seasons,
    }


def trained_predictions_for_snapshot(weekly: dict[str, list[dict]], snapshot: dict) -> tuple[list[dict], dict[str, float]]:
    records = json.loads(snapshot_frame(snapshot).replace({np.nan: None}).to_json(orient="records"))
    if not records:
        return [], {}
    target_year = int(snapshot["year"])
    target_week = int(snapshot["week"])
    actual = snapshot.get("actualChampion")
    training = prior_training_frame(weekly, target_year, target_week)
    trained_seasons = int(training["trainingYear"].nunique()) if not training.empty else 0
    fallback_scores = np.array([score_record(record, MODEL_WEIGHTS["Balanced ML Blend"]) for record in records])
    fallback = np.asarray(softmax(fallback_scores.tolist()))
    model_probabilities: dict[str, np.ndarray] = {}

    if trained_seasons and training["isChampion"].nunique() == 2:
        train_x = training[WEEKLY_MODEL_FEATURES].fillna(0)
        train_y = training["isChampion"]
        target_x = pd.DataFrame(records)[WEEKLY_MODEL_FEATURES].fillna(0)
        for name in TRAINED_MODEL_NAMES:
            try:
                raw = predict_trained_model(
                    name,
                    train_x.to_numpy(dtype=float),
                    train_y.to_numpy(dtype=float),
                    target_x.to_numpy(dtype=float),
                )
                model_probabilities[name] = normalized_probability(raw)
            except (ValueError, TypeError, np.linalg.LinAlgError):
                model_probabilities[name] = fallback
    else:
        model_probabilities = {name: fallback for name in TRAINED_MODEL_NAMES}

    ensemble = np.mean(list(model_probabilities.values()), axis=0)
    model_probabilities[TRAINED_ENSEMBLE] = normalized_probability(ensemble)
    predictions = [
        prediction_summary(name, records, probabilities, actual, trained_seasons)
        for name, probabilities in model_probabilities.items()
    ]
    return predictions, {
        record["Team"]: float(probability)
        for record, probability in zip(records, model_probabilities[TRAINED_ENSEMBLE])
    }


def add_snapshot_identity(snapshot: dict, frozen: bool, captured_at: str | None = None) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    previous_id = snapshot.get("snapshotId")
    source_fields = ["Team", "RECORD", "CFP", "AP POLL", "SOS", "SOR", "Game Control", "RAT", "FPI", "Year", "Week"]
    core = {
        "year": snapshot.get("year"),
        "week": snapshot.get("week"),
        "records": [
            {key: record.get(key) for key in source_fields if key in record}
            for record in snapshot.get("records", [])
        ],
    }
    digest = hashlib.sha256(json.dumps(core, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]
    snapshot["snapshotId"] = f"{snapshot.get('year')}-w{snapshot.get('week')}-{digest}"
    snapshot["capturedAt"] = captured_at or snapshot.get("capturedAt") or now
    snapshot["lastCheckedAt"] = (
        snapshot.get("lastCheckedAt")
        if previous_id == snapshot["snapshotId"] and snapshot.get("lastCheckedAt")
        else now
    )
    snapshot["isFrozen"] = frozen
    return snapshot


def enrich_predictions(weekly: dict[str, list[dict]]) -> None:
    for year_text in sorted(weekly, key=int):
        for snapshot in weekly[year_text]:
            frame = snapshot_frame(snapshot)
            if frame.empty:
                continue
            records = json.loads(frame.replace({np.nan: None}).to_json(orient="records"))
            blend_predictions = predictions_for_week(records, snapshot.get("actualChampion"))
            trained_predictions, ensemble_map = trained_predictions_for_snapshot(weekly, {**snapshot, "records": records})
            for record in records:
                record["blendChampionProbability"] = record.get("championProbability")
                record["mlChampionProbability"] = ensemble_map.get(record["Team"])
            records.sort(key=lambda item: item.get("mlChampionProbability") or 0, reverse=True)
            for index, record in enumerate(records, 1):
                record["mlPredictedRank"] = index
                record["championProbability"] = record.get("mlChampionProbability")
                record["predictedRank"] = index
                record["predictionReasons"] = prediction_reasons(record)
            snapshot["records"] = records
            snapshot["modelPredictions"] = blend_predictions + trained_predictions
            selected = next((item for item in trained_predictions if item["model"] == TRAINED_ENSEMBLE), None)
            if selected:
                snapshot["predictedChampion"] = selected["predictedChampion"]
                snapshot["predictedProbability"] = selected["predictedProbability"]
                snapshot["actualChampionPredictedRank"] = selected["actualChampionPredictedRank"]
                snapshot["actualChampionProbability"] = selected["actualChampionProbability"]


def prediction_reasons(record: dict) -> dict:
    signals = [
        ("Resume", record.get("Resume Composite")),
        ("Power", record.get("Power Composite")),
        ("Game control", record.get("Game Control Score")),
        ("Schedule", record.get("SOS Score")),
        ("Poll", record.get("AP Poll Score")),
    ]
    valid = [(label, float(value)) for label, value in signals if value is not None]
    strongest = sorted(valid, key=lambda item: item[1], reverse=True)[:2]
    weakest = min(valid, key=lambda item: item[1]) if valid else ("Unknown", 0)
    return {
        "strengths": [{"label": label, "score": score} for label, score in strongest],
        "risk": {"label": weakest[0], "score": weakest[1]},
    }


def add_score_metrics(payload: dict, year: int, records: list[dict]) -> None:
    aggregates: dict[str, dict[str, float]] = {}
    snapshots = payload.get("scoreSnapshots", {}).get(str(year), {})
    for snapshot in snapshots.values():
        for game in snapshot.get("games", []):
            competitors = game.get("competitors", [])
            if len(competitors) != 2 or not game.get("completed"):
                continue
            for index, team in enumerate(competitors):
                opponent = competitors[1 - index]
                name = norm_name(team.get("shortName") or team.get("team") or "")
                points = float(team.get("scoreValue") or team.get("score") or 0)
                allowed = float(opponent.get("scoreValue") or opponent.get("score") or 0)
                row = aggregates.setdefault(name, {"games": 0, "pointsFor": 0, "pointsAgainst": 0})
                row["games"] += 1
                row["pointsFor"] += points
                row["pointsAgainst"] += allowed
    for record in records:
        metric = aggregates.get(record["Team"])
        if not metric or not metric["games"]:
            continue
        games = metric["games"]
        record["Games Tracked"] = int(games)
        record["Points For"] = metric["pointsFor"] / games
        record["Points Against"] = metric["pointsAgainst"] / games
        record["Scoring Margin"] = (metric["pointsFor"] - metric["pointsAgainst"]) / games


def build_weekly_diagnostics(weekly: dict[str, list[dict]]) -> dict:
    results: dict[str, list[dict]] = {}
    calibration_rows = []
    for year_text, snapshots in weekly.items():
        if int(year_text) not in COMPLETED_YEARS:
            continue
        for snapshot in snapshots:
            actual = snapshot.get("actualChampion")
            for prediction in snapshot.get("modelPredictions", []):
                if prediction["model"].startswith("Weekly") and not prediction.get("trainedSeasons"):
                    continue
                rank = prediction.get("actualChampionPredictedRank")
                probability = prediction.get("actualChampionProbability")
                if not rank or probability is None:
                    continue
                results.setdefault(prediction["model"], []).append({"rank": rank, "probability": probability})
            for record in snapshot.get("records", []):
                probability = record.get("mlChampionProbability")
                if probability is not None:
                    calibration_rows.append((float(probability), 1 if record["Team"] == actual else 0))
    diagnostics = []
    for name, rows in results.items():
        diagnostics.append(
            {
                "model": name,
                "samples": len(rows),
                "top1Rate": sum(row["rank"] == 1 for row in rows) / len(rows),
                "top3Rate": sum(row["rank"] <= 3 for row in rows) / len(rows),
                "meanChampionRank": sum(row["rank"] for row in rows) / len(rows),
                "meanChampionNll": sum(-math.log(max(row["probability"], 1e-9)) for row in rows) / len(rows),
            }
        )
    bins = []
    for low in np.arange(0, 1, 0.1):
        rows = [row for row in calibration_rows if low <= row[0] < low + 0.1 or (low == 0.9 and row[0] == 1)]
        if rows:
            bins.append(
                {
                    "low": float(low),
                    "high": float(low + 0.1),
                    "predicted": sum(row[0] for row in rows) / len(rows),
                    "observed": sum(row[1] for row in rows) / len(rows),
                    "count": len(rows),
                }
            )
    return {"models": diagnostics, "calibration": bins}


def build_champion_profile(payload: dict) -> dict:
    features = ["Resume Composite", "Power Composite", "Consensus Score", "Balance Score"]
    champions = []
    for year_text, season in payload.get("seasonPredictions", {}).items():
        if season.get("isCurrentSeason") or season.get("actualChampion") == "TBD":
            continue
        champion = next((row for row in season.get("records", []) if row.get("Team") == season.get("actualChampion")), None)
        if champion:
            champions.append({"year": int(year_text), "team": champion["Team"], **{feature: champion.get(feature) for feature in features}})
    averages = {
        feature: float(np.mean([row[feature] for row in champions if row.get(feature) is not None]))
        for feature in features
    }
    return {"features": features, "averages": averages, "champions": champions}


def predict_week(year: int, week: int, actual_champion: str | None) -> dict | None:
    frame = fetch_week(year, week)
    if frame is None or frame.empty:
        return None
    scored = add_scores(frame)
    balanced_scores = [score_record(record, MODEL_WEIGHTS["Balanced ML Blend"]) for record in scored.to_dict("records")]
    scored["championProbability"] = softmax(balanced_scores)
    scored["predictedRank"] = scored["championProbability"].rank(method="first", ascending=False).astype(int)
    scored = scored.sort_values("predictedRank")
    records = json.loads(scored.replace({np.nan: None}).to_json(orient="records"))
    model_predictions = predictions_for_week(records, actual_champion)
    primary = model_predictions[0]
    return {
        "year": year,
        "week": week,
        "predictedChampion": primary["predictedChampion"],
        "predictedProbability": primary["predictedProbability"],
        "actualChampion": actual_champion or "TBD",
        "actualChampionPresent": False if not actual_champion or actual_champion == "TBD" else any(row["Team"] == actual_champion for row in records),
        "actualChampionPredictedRank": primary["actualChampionPredictedRank"],
        "actualChampionProbability": primary["actualChampionProbability"],
        "sourceUrl": f"https://www.espn.com/college-football/playoffPicture/_/week/{week}/year/{year}",
        "records": records,
        "modelPredictions": model_predictions,
    }


def update_current_season_page(payload: dict, current_year: int, rows: list[dict]) -> None:
    if not rows:
        return
    latest = rows[-1]
    payload["seasonPredictions"][str(current_year)] = {
        "year": current_year,
        "predictedChampion": latest["predictedChampion"],
        "actualChampion": "TBD",
        "topProbability": latest["predictedProbability"],
        "actualChampionPredictedRank": None,
        "isCurrentSeason": True,
        "latestWeek": latest["week"],
        "records": latest["records"],
    }
    payload["meta"]["currentSeason"] = current_year
    payload["meta"]["updatedSeason"] = current_year


def main() -> None:
    payload = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    existing_weekly = payload.get("weeklyPredictions", {})
    current_year = current_college_football_season()
    years = COMPLETED_YEARS + ([] if current_year in COMPLETED_YEARS else [current_year])
    weekly = {}
    for year in years:
        season = payload["seasonPredictions"].get(str(year), {})
        actual = season.get("actualChampion", "TBD")
        if year in COMPLETED_YEARS and existing_weekly.get(str(year)):
            season_rows = [
                add_snapshot_identity(dict(row), frozen=True, captured_at=row.get("capturedAt"))
                for row in existing_weekly[str(year)]
            ]
            weekly[str(year)] = season_rows
            print(year, len(season_rows), [row["predictedChampion"] for row in season_rows])
            continue
        if year == current_year and year not in COMPLETED_YEARS:
            actual = "TBD"
        existing_by_week = {
            int(row["week"]): dict(row)
            for row in existing_weekly.get(str(year), [])
            if row.get("week") is not None
        }
        latest_existing = max(existing_by_week, default=0)
        fetched_by_week: dict[int, dict] = {}
        for week in range(max(1, latest_existing), max(WEEKS) + 1):
            prediction = predict_week(year, week, actual)
            if prediction is not None:
                fetched_by_week[week] = prediction

        new_weeks = sorted(week for week in fetched_by_week if week > latest_existing)
        if new_weeks:
            for week in new_weeks:
                existing_by_week[week] = add_snapshot_identity(
                    fetched_by_week[week],
                    frozen=week != new_weeks[-1],
                )
        elif latest_existing and latest_existing in fetched_by_week:
            previous = existing_by_week[latest_existing]
            refreshed = add_snapshot_identity(
                fetched_by_week[latest_existing],
                frozen=False,
                captured_at=previous.get("capturedAt"),
            )
            if refreshed["snapshotId"] == previous.get("snapshotId"):
                refreshed["lastCheckedAt"] = previous.get("lastCheckedAt", refreshed["lastCheckedAt"])
            existing_by_week[latest_existing] = refreshed
        elif not existing_by_week:
            for week, prediction in fetched_by_week.items():
                existing_by_week[week] = add_snapshot_identity(
                    prediction,
                    frozen=week != max(fetched_by_week),
                )

        newest = max(existing_by_week, default=0)
        season_rows = []
        for week in sorted(existing_by_week):
            row = existing_by_week[week]
            season_rows.append(
                add_snapshot_identity(
                    row,
                    frozen=week < newest,
                    captured_at=row.get("capturedAt"),
                )
            )
        weekly[str(year)] = season_rows
        print(year, len(season_rows), [row["predictedChampion"] for row in season_rows])

    enrich_predictions(weekly)
    payload["weeklyPredictions"] = weekly
    update_current_season_page(payload, current_year, weekly.get(str(current_year), []))
    current_records = payload["seasonPredictions"].get(str(current_year), {}).get("records", [])
    add_score_metrics(payload, current_year, current_records)
    payload["meta"]["weeklyModels"] = [*MODEL_WEIGHTS.keys(), *TRAINED_MODEL_NAMES, TRAINED_ENSEMBLE]
    payload["meta"]["weeklySourceNote"] = (
        "Weekly predictions use frozen ESPN College Football Playoff Picture snapshots. "
        "Prior weeks never refresh after a new week is captured. Four classifiers and an ensemble "
        "are trained only on completed seasons before the season being predicted."
    )
    diagnostics = build_weekly_diagnostics(weekly)
    payload["weeklyModelDiagnostics"] = diagnostics["models"]
    payload["weeklyCalibration"] = diagnostics["calibration"]
    payload["championProfile"] = build_champion_profile(payload)
    all_snapshots = [row for rows in weekly.values() for row in rows]
    current_rows = weekly.get(str(current_year), [])
    latest = current_rows[-1] if current_rows else None
    current_predictions = latest.get("modelPredictions", []) if latest else []
    votes: dict[str, int] = {}
    for prediction in current_predictions:
        votes[prediction["predictedChampion"]] = votes.get(prediction["predictedChampion"], 0) + 1
    payload["predictionAudit"] = {
        "modelCount": len(current_predictions),
        "uniquePicks": len(votes),
        "leaderVotes": max(votes.values(), default=0),
        "votes": sorted(
            [{"team": team, "votes": count} for team, count in votes.items()],
            key=lambda item: item["votes"],
            reverse=True,
        ),
    }
    score_weeks = sum(len(weeks) for weeks in payload.get("scoreSnapshots", {}).values())
    payload["meta"]["dataHealth"] = {
        "lastUpdatedAt": latest.get("lastCheckedAt") if latest else None,
        "latestSeason": current_year,
        "latestWeek": latest.get("week") if latest else None,
        "snapshotCount": len(all_snapshots),
        "frozenSnapshots": sum(bool(row.get("isFrozen")) for row in all_snapshots),
        "provisionalSnapshots": sum(not bool(row.get("isFrozen")) for row in all_snapshots),
        "scoreWeeks": score_weeks,
        "sourceCoverage": len(all_snapshots) / max(1, len(years) * 16),
        "status": "healthy" if latest else "needs attention",
        "issues": [] if latest else ["No current-season weekly snapshot is available."],
    }
    payload["meta"]["weeklyModelMethod"] = (
        "Forward-season training: each historical season uses only earlier completed seasons; "
        "the current season uses 2021-2025 snapshots."
    )
    rendered = json.dumps(payload, indent=2)
    DATA_PATH.write_text(rendered, encoding="utf-8")
    PUBLIC_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_DATA_PATH.write_text(rendered, encoding="utf-8")


if __name__ == "__main__":
    main()
