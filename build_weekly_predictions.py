from __future__ import annotations

import json
import hashlib
import math
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from http.client import IncompleteRead
from io import StringIO
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import numpy as np
import pandas as pd


APP_DIR = Path(__file__).parent
DATA_PATH = APP_DIR / "data" / "app-data.json"
PUBLIC_DATA_PATH = APP_DIR / "public" / "data" / "app-data.json"
GAME_HISTORY_PATH = APP_DIR / "data" / "game-history.json"
PLAY_CACHE_PATH = APP_DIR / "data" / "play-metrics-cache.json"
PREGAME_STORE_PATH = APP_DIR / "data" / "pregame-feature-store.json"
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
CHAMPIONS = {
    2014: "Ohio State",
    2015: "Alabama",
    2016: "Clemson",
    2017: "Alabama",
    2018: "Clemson",
    2019: "LSU",
    2020: "Alabama",
    2021: "Georgia",
    2022: "Georgia",
    2023: "Michigan",
    2024: "Ohio State",
    2025: "Indiana",
}
COMPLETED_YEARS = sorted(CHAMPIONS)
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
    "AP Poll Baseline": {"AP Poll Score": 1.0},
    "FPI Baseline": {"FPI Score": 1.0},
}

TRAINED_MODEL_NAMES = [
    "Weekly Logistic Regression",
    "Weekly Gaussian Naive Bayes",
    "Weekly K-Nearest Neighbors",
    "Weekly Ridge Probability",
    "Weekly Bayesian Logistic",
    "Weekly Elo Rating",
]
STACKED_MODEL = "Weekly Forward Stacker"
TRAINED_ENSEMBLE = "Weekly ML Ensemble"
GAME_MODEL_FEATURES = [
    "Elo edge",
    "Poll edge",
    "Record edge",
    "Recent margin edge",
    "Home field",
    "Conference game",
]
SELECTION_FEATURES = [
    "Resume Composite",
    "Power Composite",
    "Consensus Score",
    "SOR Score",
    "SOS Score",
    "AP Poll Score",
    "Win Pct",
]
GAME_FEATURE_SCHEMA = "game-features-v3-prior-only-calibrated"
PLAY_METRIC_SCHEMA = 2
PREDICTION_CHANGE_COMPONENTS = {
    "poll": ["AP Poll Score"],
    "resume": ["Resume Composite", "Win Pct"],
    "efficiency": ["Power Composite", "Game Control Score"],
    "opponent": ["SOS Score"],
}


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
        "UCLA Bruins": "UCLA",
        "Northwestern Wildcats": "Northwestern",
        "Mississippi State Bulldogs": "Mississippi St",
        "Mississippi State": "Mississippi St",
        "Kentucky Wildcats": "Kentucky",
        "Wake Forest Demon Deacons": "Wake Forest",
        "Boise State Broncos": "Boise St",
        "SMU Mustangs": "SMU",
        "Oklahoma State Cowboys": "Oklahoma St",
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
        except (ConnectionResetError, TimeoutError, URLError, IncompleteRead):
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
                "probabilities": {item["team"]: item["probability"] for item in ranked},
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


def bayesian_logistic_probability(train_x: np.ndarray, train_y: np.ndarray, target_x: np.ndarray) -> np.ndarray:
    """MAP logistic approximation with a stronger zero-centered Gaussian prior."""
    model = fit_binary_model(train_x, train_y, regularization=0.09)
    return np.asarray([binary_probability(model, row.tolist()) for row in target_x], dtype=float)


def elo_rating_probability(records: list[dict]) -> np.ndarray:
    ratings = np.asarray(
        [
            1200
            + 3.2 * float(record.get("Power Composite") or 0)
            + 2.8 * float(record.get("Resume Composite") or 0)
            + 120 * float(record.get("Win Pct") or 0)
            for record in records
        ],
        dtype=float,
    )
    strengths = np.power(10.0, (ratings - float(np.max(ratings))) / 400.0)
    return normalized_probability(strengths)


def predict_trained_model(name: str, train_x: np.ndarray, train_y: np.ndarray, target_x: np.ndarray) -> np.ndarray:
    predictors = {
        "Weekly Logistic Regression": logistic_probability,
        "Weekly Gaussian Naive Bayes": gaussian_nb_probability,
        "Weekly K-Nearest Neighbors": knn_probability,
        "Weekly Ridge Probability": ridge_probability,
        "Weekly Bayesian Logistic": bayesian_logistic_probability,
    }
    return predictors[name](train_x, train_y, target_x)


def base_weekly_probabilities(training: pd.DataFrame, records: list[dict]) -> dict[str, np.ndarray]:
    target_x = pd.DataFrame(records)[WEEKLY_MODEL_FEATURES].fillna(0).to_numpy(dtype=float)
    fallback_scores = np.array([score_record(record, MODEL_WEIGHTS["Balanced ML Blend"]) for record in records])
    fallback = np.asarray(softmax(fallback_scores.tolist()))
    probabilities: dict[str, np.ndarray] = {}
    if not training.empty and training["isChampion"].nunique() == 2:
        train_x = training[WEEKLY_MODEL_FEATURES].fillna(0).to_numpy(dtype=float)
        train_y = training["isChampion"].to_numpy(dtype=float)
        for name in TRAINED_MODEL_NAMES:
            if name == "Weekly Elo Rating":
                probabilities[name] = elo_rating_probability(records)
                continue
            try:
                probabilities[name] = normalized_probability(predict_trained_model(name, train_x, train_y, target_x))
            except (ValueError, TypeError, np.linalg.LinAlgError):
                probabilities[name] = fallback
    else:
        probabilities = {
            name: elo_rating_probability(records) if name == "Weekly Elo Rating" else fallback
            for name in TRAINED_MODEL_NAMES
        }
    return probabilities


def forward_stacked_probability(training: pd.DataFrame, records: list[dict], target_base: dict[str, np.ndarray]) -> tuple[np.ndarray, dict]:
    base_names = list(TRAINED_MODEL_NAMES)
    oof_x: list[list[float]] = []
    oof_y: list[float] = []
    years = sorted(int(value) for value in training.get("trainingYear", pd.Series(dtype=int)).unique())
    for year in years[1:]:
        prior = training[training["trainingYear"] < year]
        held_out = training[training["trainingYear"] == year]
        if prior.empty or held_out.empty or prior["isChampion"].nunique() < 2:
            continue
        held_records = json.loads(held_out.replace({np.nan: None}).to_json(orient="records"))
        fold = base_weekly_probabilities(prior, held_records)
        for index, (_, row) in enumerate(held_out.iterrows()):
            oof_x.append([float(fold[name][index]) for name in base_names])
            oof_y.append(float(row["isChampion"]))
    target_matrix = np.column_stack([target_base[name] for name in base_names])
    if len(oof_x) >= 25 and len(set(oof_y)) == 2:
        model = fit_binary_model(np.asarray(oof_x, dtype=float), np.asarray(oof_y, dtype=float), regularization=0.12)
        stacked = np.asarray([binary_probability(model, row.tolist()) for row in target_matrix], dtype=float)
        weights = [float(value) for value in model["weights"][1:]]
        return normalized_probability(stacked), {
            "method": "Forward-season level-2 logistic stack",
            "outOfFoldTeams": len(oof_y),
            "baseModels": base_names,
            "coefficients": dict(zip(base_names, weights)),
            "leakagePolicy": "Every level-2 training row was predicted by base models fit only on earlier seasons.",
        }
    return normalized_probability(np.mean(list(target_base.values()), axis=0)), {
        "method": "Equal-weight fallback until forward-season stack has enough classes",
        "outOfFoldTeams": len(oof_y),
        "baseModels": base_names,
        "coefficients": {name: 1 / len(base_names) for name in base_names},
        "leakagePolicy": "Fallback contains no fitted target-season information.",
    }


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
        "probabilities": {item["team"]: item["probability"] for item in ranked},
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
    model_probabilities = base_weekly_probabilities(training, records)
    stacked, stack_metadata = forward_stacked_probability(training, records, model_probabilities)
    model_probabilities[STACKED_MODEL] = stacked
    ensemble = np.mean(list(model_probabilities.values()), axis=0)
    model_probabilities[TRAINED_ENSEMBLE] = normalized_probability(ensemble)
    predictions = [
        prediction_summary(name, records, probabilities, actual, trained_seasons)
        for name, probabilities in model_probabilities.items()
    ]
    for prediction in predictions:
        if prediction["model"] == STACKED_MODEL:
            prediction["stacking"] = stack_metadata
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
            all_predictions = blend_predictions + trained_predictions
            for record in records:
                record["blendChampionProbability"] = record.get("championProbability")
                record["mlChampionProbability"] = ensemble_map.get(record["Team"])
                model_values = [
                    prediction.get("probabilities", {}).get(record["Team"])
                    for prediction in all_predictions
                    if prediction.get("probabilities", {}).get(record["Team"]) is not None
                ]
                if model_values:
                    record["modelProbabilityMean"] = float(np.mean(model_values))
                    record["modelProbabilityStdDev"] = float(np.std(model_values))
                    record["modelProbabilityMin"] = float(np.min(model_values))
                    record["modelProbabilityMax"] = float(np.max(model_values))
            records.sort(key=lambda item: item.get("mlChampionProbability") or 0, reverse=True)
            for index, record in enumerate(records, 1):
                record["mlPredictedRank"] = index
                record["championProbability"] = record.get("mlChampionProbability")
                record["predictedRank"] = index
                record["predictionReasons"] = prediction_reasons(record)
            snapshot["records"] = records
            snapshot["modelPredictions"] = all_predictions
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
        ("Play success", None if record.get("Play Success Rate") is None else float(record["Play Success Rate"]) * 100),
        ("Game-model Elo", None if record.get("Game Elo") is None else max(0, min(100, (float(record["Game Elo"]) - 1200) / 6))),
    ]
    valid = [(label, float(value)) for label, value in signals if value is not None]
    strongest = sorted(valid, key=lambda item: item[1], reverse=True)[:3]
    weakest = min(valid, key=lambda item: item[1]) if valid else ("Unknown", 0)
    return {
        "strengths": [{"label": label, "score": score} for label, score in strongest],
        "risk": {"label": weakest[0], "score": weakest[1]},
    }


def fetch_season_schedule(year: int) -> dict:
    games: dict[str, dict] = {}
    for week in WEEKS:
        url = (
            "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard"
            f"?groups=80&seasontype=2&week={week}&dates={year}&limit=1000"
        )
        text = fetch_text(url)
        if not text:
            continue
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            continue
        for event in payload.get("events", []):
            competition = (event.get("competitions") or [{}])[0]
            competitors = []
            for competitor in competition.get("competitors", []):
                team = competitor.get("team", {})
                overall = next(
                    (item.get("summary") for item in competitor.get("records", []) if item.get("type") == "total"),
                    None,
                )
                rank = (competitor.get("curatedRank") or {}).get("current")
                competitors.append(
                    {
                        "team": norm_name(team.get("displayName") or team.get("shortDisplayName") or ""),
                        "teamId": team.get("id"),
                        "conferenceId": team.get("conferenceId"),
                        "homeAway": competitor.get("homeAway"),
                        "record": overall,
                        "rank": rank if rank and rank < 99 else None,
                        "score": float(competitor.get("score") or 0),
                        "winner": bool(competitor.get("winner")),
                        "logo": team.get("logo"),
                    }
                )
            if len(competitors) != 2:
                continue
            group = competition.get("groups") or {}
            games[str(event.get("id"))] = {
                "id": str(event.get("id")),
                "week": week,
                "date": event.get("date"),
                "name": event.get("name"),
                "completed": bool((event.get("status") or {}).get("type", {}).get("completed")),
                "status": (event.get("status") or {}).get("type", {}).get("shortDetail"),
                "conferenceGame": bool(competition.get("conferenceCompetition")),
                "conference": group.get("shortName"),
                "neutralSite": bool(competition.get("neutralSite")),
                "competitors": competitors,
            }
    ordered = sorted(games.values(), key=lambda item: (item["week"], item.get("date") or "", item["id"]))
    return {
        "year": year,
        "source": "ESPN FBS scoreboard",
        "games": ordered,
    }


def load_game_history() -> list[dict]:
    if GAME_HISTORY_PATH.exists():
        cached = json.loads(GAME_HISTORY_PATH.read_text(encoding="utf-8"))
        if cached.get("years") == COMPLETED_YEARS and cached.get("games"):
            for game in cached["games"]:
                for competitor in game.get("competitors", []):
                    competitor["team"] = norm_name(competitor.get("team") or "")
            return cached["games"]
    schedules = {}
    with ThreadPoolExecutor(max_workers=min(12, len(COMPLETED_YEARS))) as executor:
        futures = {executor.submit(fetch_season_schedule, year): year for year in COMPLETED_YEARS}
        for future in as_completed(futures):
            year = futures[future]
            schedules[year] = future.result()
            print("game history", year, len(schedules[year].get("games", [])))
    games = [
        {**game, "year": year}
        for year in sorted(schedules)
        for game in schedules[year].get("games", [])
        if game.get("completed")
    ]
    GAME_HISTORY_PATH.write_text(
        json.dumps({"years": COMPLETED_YEARS, "games": games}, separators=(",", ":")),
        encoding="utf-8",
    )
    return games


def record_win_pct(value: str | None) -> float:
    try:
        wins, losses = [int(part) for part in str(value).split("-")[:2]]
        return wins / max(1, wins + losses)
    except (TypeError, ValueError):
        return 0.5


def game_feature_rows(games: list[dict], initial_elo: dict[str, float] | None = None) -> tuple[list[dict], dict[str, float], dict[str, list[float]]]:
    elo = dict(initial_elo or {})
    margins: dict[str, list[float]] = {}
    season_records: dict[str, list[int]] = {}
    active_year = None
    rows = []
    ordered = sorted(games, key=lambda item: (int(item.get("year", 0)), int(item.get("week", 0)), item.get("date") or "", item.get("id") or ""))
    for game in ordered:
        year = int(game.get("year", 0))
        if year != active_year:
            season_records = {}
            active_year = year
        competitors = game.get("competitors", [])
        if len(competitors) != 2:
            continue
        a, b = competitors
        team_a, team_b = a.get("team"), b.get("team")
        if not team_a or not team_b:
            continue
        elo_a, elo_b = elo.get(team_a, 1500.0), elo.get(team_b, 1500.0)
        recent_a = float(np.mean(margins.get(team_a, [0])[-3:]))
        recent_b = float(np.mean(margins.get(team_b, [0])[-3:]))
        rank_a = float(a.get("rank") or 35)
        rank_b = float(b.get("rank") or 35)
        home = 0 if game.get("neutralSite") else (1 if a.get("homeAway") == "home" else -1)
        record_a = season_records.get(team_a, [0, 0])
        record_b = season_records.get(team_b, [0, 0])
        prior_pct_a = record_a[0] / max(1, sum(record_a)) if sum(record_a) else 0.5
        prior_pct_b = record_b[0] / max(1, sum(record_b)) if sum(record_b) else 0.5
        features = [
            (elo_a - elo_b) / 100,
            (rank_b - rank_a) / 10,
            prior_pct_a - prior_pct_b,
            (recent_a - recent_b) / 14,
            home,
            int(bool(game.get("conferenceGame"))),
        ]
        row = {
            "year": int(game.get("year", 0)),
            "week": int(game.get("week", 0)),
            "gameId": game.get("id"),
            "teamA": team_a,
            "teamB": team_b,
            "features": features,
            "teamAWon": int(bool(a.get("winner"))),
        }
        rows.append(row)
        if game.get("completed"):
            score_a, score_b = float(a.get("score") or 0), float(b.get("score") or 0)
            margin = score_a - score_b
            result = 1.0 if margin > 0 else 0.0
            expected = 1 / (1 + 10 ** ((elo_b - elo_a - home * 55) / 400))
            multiplier = math.log(abs(margin) + 1) * (2.2 / ((elo_a - elo_b) * 0.001 + 2.2))
            change = 24 * multiplier * (result - expected)
            elo[team_a], elo[team_b] = elo_a + change, elo_b - change
            margins.setdefault(team_a, []).append(margin)
            margins.setdefault(team_b, []).append(-margin)
            season_records.setdefault(team_a, [0, 0])[0 if result else 1] += 1
            season_records.setdefault(team_b, [0, 0])[1 if result else 0] += 1
    return rows, elo, margins


def fit_binary_model(x: np.ndarray, y: np.ndarray, regularization: float = 0.012) -> dict:
    mean, scale = x.mean(axis=0), x.std(axis=0)
    scale[scale < 1e-8] = 1.0
    standardized = (x - mean) / scale
    design = np.column_stack([np.ones(len(standardized)), standardized])
    weights = np.zeros(design.shape[1])
    for _ in range(40):
        predicted = 1 / (1 + np.exp(-np.clip(design @ weights, -20, 20)))
        gradient = design.T @ (predicted - y) / len(y)
        gradient[1:] += regularization * weights[1:]
        curvature = np.clip(predicted * (1 - predicted), 1e-6, None)
        hessian = (design.T @ (design * curvature[:, None])) / len(y)
        hessian[1:, 1:] += np.eye(design.shape[1] - 1) * regularization
        step = np.linalg.solve(hessian + np.eye(design.shape[1]) * 1e-8, gradient)
        weights -= step
        if float(np.linalg.norm(step)) < 1e-8:
            break
    return {"mean": mean, "scale": scale, "weights": weights}


def fit_game_model(rows: list[dict]) -> dict:
    x = np.asarray([row["features"] for row in rows], dtype=float)
    y = np.asarray([row["teamAWon"] for row in rows], dtype=float)
    return fit_binary_model(x, y)


def binary_probability(model: dict, features: list[float]) -> float:
    standardized = (np.asarray(features, dtype=float) - model["mean"]) / model["scale"]
    logit = model["weights"][0] + standardized @ model["weights"][1:]
    return float(1 / (1 + math.exp(-float(np.clip(logit, -20, 20)))))


def fit_platt_calibrator(probabilities: list[float], labels: list[int]) -> dict:
    logits = np.asarray([math.log(max(value, 1e-8) / max(1 - value, 1e-8)) for value in probabilities], dtype=float)
    x = logits.reshape(-1, 1)
    y = np.asarray(labels, dtype=float)
    model = fit_binary_model(x, y, regularization=0.002)
    return {
        "mean": float(model["mean"][0]),
        "scale": float(model["scale"][0]),
        "intercept": float(model["weights"][0]),
        "slope": float(model["weights"][1]),
    }


def apply_platt(probability: float, calibrator: dict) -> float:
    logit = math.log(max(probability, 1e-8) / max(1 - probability, 1e-8))
    standardized = (logit - calibrator["mean"]) / calibrator["scale"]
    calibrated_logit = calibrator["intercept"] + calibrator["slope"] * standardized
    return float(1 / (1 + math.exp(-float(np.clip(calibrated_logit, -20, 20)))))


def reliability_bins(probabilities: list[float], labels: list[int]) -> list[dict]:
    bins = []
    for low in np.arange(0, 1, 0.1):
        selected = [
            (probability, label)
            for probability, label in zip(probabilities, labels)
            if low <= probability < low + 0.1 or (low == 0.9 and probability == 1)
        ]
        if selected:
            bins.append(
                {
                    "low": float(low),
                    "high": float(low + 0.1),
                    "predicted": float(np.mean([row[0] for row in selected])),
                    "observed": float(np.mean([row[1] for row in selected])),
                    "count": len(selected),
                }
            )
    return bins


def build_pregame_feature_store(rows: list[dict]) -> dict:
    stored_rows = [
        {
            "season": row["year"],
            "week": row["week"],
            "gameId": row["gameId"],
            "teamA": row["teamA"],
            "teamB": row["teamB"],
            "features": {name: float(value) for name, value in zip(GAME_MODEL_FEATURES, row["features"])},
            "label": int(row["teamAWon"]),
        }
        for row in rows
    ]
    content = {"schema": GAME_FEATURE_SCHEMA, "rows": stored_rows}
    rendered = json.dumps(content, separators=(",", ":"))
    PREGAME_STORE_PATH.write_text(rendered, encoding="utf-8")
    return {
        "schema": GAME_FEATURE_SCHEMA,
        "rows": len(stored_rows),
        "seasons": f"{min(row['year'] for row in rows)}-{max(row['year'] for row in rows)}",
        "features": GAME_MODEL_FEATURES,
        "leakagePolicy": "Every feature is reconstructed from information available before kickoff; season records reset annually.",
        "sha256": hashlib.sha256(rendered.encode()).hexdigest(),
    }


def game_probability(model: dict, features: list[float], calibrator: dict | None = None) -> tuple[float, list[dict], float]:
    standardized = (np.asarray(features, dtype=float) - model["mean"]) / model["scale"]
    contributions = standardized * model["weights"][1:]
    logit = model["weights"][0] + contributions.sum()
    raw_probability = float(1 / (1 + math.exp(-float(np.clip(logit, -20, 20)))))
    probability = apply_platt(raw_probability, calibrator) if calibrator else raw_probability
    factors = sorted(
        [{"feature": name, "impact": float(value)} for name, value in zip(GAME_MODEL_FEATURES, contributions)],
        key=lambda item: abs(item["impact"]),
        reverse=True,
    )[:3]
    return probability, factors, raw_probability


def build_game_model(history_games: list[dict], current_schedule: dict) -> dict:
    historical_rows, historical_elo, historical_margins = game_feature_rows(history_games)
    evaluations = []
    oof_probabilities = []
    oof_labels = []
    for year in range(2017, max(COMPLETED_YEARS) + 1):
        train = [row for row in historical_rows if row["year"] < year]
        test = [row for row in historical_rows if row["year"] == year]
        if not train or not test:
            continue
        fold_model = fit_game_model(train)
        probs = [game_probability(fold_model, row["features"])[0] for row in test]
        labels = [row["teamAWon"] for row in test]
        oof_probabilities.extend(probs)
        oof_labels.extend(labels)
        evaluations.append(
            {
                "year": year,
                "games": len(test),
                "accuracy": sum((prob >= 0.5) == bool(label) for prob, label in zip(probs, labels)) / len(test),
                "brier": sum((prob - label) ** 2 for prob, label in zip(probs, labels)) / len(test),
                "logLoss": sum(-(label * math.log(max(prob, 1e-9)) + (1 - label) * math.log(max(1 - prob, 1e-9))) for prob, label in zip(probs, labels)) / len(test),
            }
        )
    calibrator = fit_platt_calibrator(oof_probabilities, oof_labels)
    calibrated_oof = [apply_platt(probability, calibrator) for probability in oof_probabilities]
    model = fit_game_model(historical_rows)
    current_games = [{**game, "year": int(current_schedule.get("year", 0))} for game in current_schedule.get("games", [])]
    current_rows, current_elo, current_margins = game_feature_rows(current_games, historical_elo)
    row_map = {row["gameId"]: row for row in current_rows}
    expected_wins: dict[str, float] = {}
    for game in current_schedule.get("games", []):
        row = row_map.get(game.get("id"))
        if not row:
            continue
        probability, factors, raw_probability = game_probability(model, row["features"], calibrator)
        game["gameModel"] = {
            "teamA": row["teamA"],
            "teamB": row["teamB"],
            "teamAWinProbability": probability,
            "teamBWinProbability": 1 - probability,
            "rawTeamAWinProbability": raw_probability,
            "factors": factors,
        }
        if not game.get("completed"):
            expected_wins[row["teamA"]] = expected_wins.get(row["teamA"], 0) + probability
            expected_wins[row["teamB"]] = expected_wins.get(row["teamB"], 0) + 1 - probability
    digest = hashlib.sha256(
        json.dumps(
            {
                "schema": GAME_FEATURE_SCHEMA,
                "games": [[row["gameId"], row["teamAWon"]] for row in historical_rows],
                "weights": [round(float(value), 8) for value in model["weights"]],
            },
            separators=(",", ":"),
        ).encode()
    ).hexdigest()[:12]
    current_team_names = {
        competitor.get("team")
        for game in current_schedule.get("games", [])
        for competitor in game.get("competitors", [])
        if competitor.get("team")
    }
    return {
        "name": "Historical Game Logistic + Elo",
        "version": f"game-{max(COMPLETED_YEARS)}-{digest}",
        "trainingGames": len(historical_rows),
        "trainingSeasons": f"{min(COMPLETED_YEARS)}-{max(COMPLETED_YEARS)}",
        "features": GAME_MODEL_FEATURES,
        "featureSchema": GAME_FEATURE_SCHEMA,
        "coefficients": [
            {"feature": name, "coefficient": float(weight)}
            for name, weight in zip(GAME_MODEL_FEATURES, model["weights"][1:])
        ],
        "forwardValidation": evaluations,
        "accuracy": float(np.average([row["accuracy"] for row in evaluations], weights=[row["games"] for row in evaluations])),
        "brier": float(np.average([row["brier"] for row in evaluations], weights=[row["games"] for row in evaluations])),
        "logLoss": float(np.average([row["logLoss"] for row in evaluations], weights=[row["games"] for row in evaluations])),
        "calibration": {
            "method": "Platt scaling on forward-season out-of-fold games",
            "samples": len(oof_labels),
            "parameters": calibrator,
            "rawBrier": float(np.mean([(probability - label) ** 2 for probability, label in zip(oof_probabilities, oof_labels)])),
            "calibratedBrier": float(np.mean([(probability - label) ** 2 for probability, label in zip(calibrated_oof, oof_labels)])),
            "bins": reliability_bins(calibrated_oof, oof_labels),
        },
        "pregameFeatureStore": build_pregame_feature_store(historical_rows),
        "currentTeams": {
            team: {
                "elo": float(current_elo.get(team, historical_elo.get(team, 1500.0))),
                "recentMargin": float(np.mean(current_margins.get(team, historical_margins.get(team, [0]))[-3:])),
                "expectedRemainingWins": float(expected_wins.get(team, 0)),
            }
            for team in sorted(current_team_names)
        },
    }


def expected_points(state: dict | None) -> float:
    if not state:
        return 0.0
    yards = float(state.get("yardsToEndzone", 50) or 50)
    down = float(state.get("down", 1) or 1)
    distance = float(state.get("distance", 10) or 10)
    return 6.2 * (1 - yards / 100) - 1.7 - (down - 1) * 0.55 - min(distance, 20) * 0.045


def fetch_play_metrics(game: dict) -> dict:
    url = f"https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event={game['id']}"
    text = fetch_text(url)
    if not text:
        return {}
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return {}
    competitors = game.get("competitors", [])
    id_to_name = {str(item.get("teamId")): item.get("team") for item in competitors}
    aggregates = {
        name: {"plays": 0, "successes": 0, "explosives": 0, "epa": 0.0, "earlyPlays": 0, "earlySuccesses": 0, "havoc": 0, "opportunities": 0, "finishes": 0, "defensePlays": 0, "successesAllowed": 0, "epaAllowed": 0.0, "explosivesAllowed": 0}
        for name in id_to_name.values()
        if name
    }
    for drive in (payload.get("drives") or {}).get("previous", []):
        plays = drive.get("plays", [])
        offense_ids = [str((play.get("start") or {}).get("team", {}).get("id")) for play in plays if (play.get("start") or {}).get("team")]
        offense_id = next((value for value in offense_ids if value in id_to_name), None)
        offense_name = id_to_name.get(offense_id)
        if offense_name and any(float((play.get("start") or {}).get("yardsToEndzone", 100) or 100) <= 40 for play in plays):
            aggregates[offense_name]["opportunities"] += 1
            aggregates[offense_name]["finishes"] += int(bool(drive.get("isScore")))
        for play in plays:
            start = play.get("start") or {}
            down = int(start.get("down") or 0)
            if down not in [1, 2, 3, 4]:
                continue
            offense_id = str((start.get("team") or {}).get("id") or "")
            offense_name = id_to_name.get(offense_id)
            if not offense_name:
                continue
            defense_name = next((name for team_id, name in id_to_name.items() if team_id != offense_id), None)
            period = int((play.get("period") or {}).get("number") or 1)
            margin = abs(float(play.get("homeScore") or 0) - float(play.get("awayScore") or 0))
            if margin > (28 if period <= 2 else 21):
                continue
            yards = float(play.get("statYardage") or 0)
            distance = max(1.0, float(start.get("distance") or 10))
            threshold = 0.5 if down == 1 else 0.7 if down == 2 else 1.0
            success = yards >= distance * threshold and not play.get("isTurnover")
            row = aggregates[offense_name]
            row["plays"] += 1
            row["successes"] += int(success)
            row["explosives"] += int(yards >= 20)
            play_epa = float(np.clip(expected_points(play.get("end")) - expected_points(start), -8, 8))
            row["epa"] += play_epa
            if defense_name:
                defense = aggregates[defense_name]
                defense["defensePlays"] += 1
                defense["successesAllowed"] += int(success)
                defense["epaAllowed"] += play_epa
                defense["explosivesAllowed"] += int(yards >= 20)
            if down <= 2:
                row["earlyPlays"] += 1
                row["earlySuccesses"] += int(success)
            text_value = str(play.get("text") or "").lower()
            if defense_name and (play.get("isTurnover") or "sack" in text_value or (yards < 0 and not play.get("isPenalty"))):
                aggregates[defense_name]["havoc"] += 1
    return aggregates


def build_play_level_metrics(schedule: dict, contender_names: set[str]) -> dict:
    cache = json.loads(PLAY_CACHE_PATH.read_text(encoding="utf-8")) if PLAY_CACHE_PATH.exists() else {}
    targets = [
        game for game in schedule.get("games", [])
        if game.get("completed") and any(item.get("team") in contender_names for item in game.get("competitors", []))
    ]
    missing = [
        game for game in targets
        if game.get("id") not in cache
        or any("defensePlays" not in values for values in cache.get(game.get("id"), {}).values())
    ]
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(fetch_play_metrics, game): game for game in missing}
        for future in as_completed(futures):
            game = futures[future]
            cache[game["id"]] = future.result()
    PLAY_CACHE_PATH.write_text(json.dumps(cache, separators=(",", ":")), encoding="utf-8")
    combined: dict[str, dict] = {}
    for game in targets:
        for team, values in cache.get(game["id"], {}).items():
            normalized_team = norm_name(team)
            row = combined.setdefault(normalized_team, {key: 0 for key in values})
            for key, value in values.items():
                row[key] += value
    result = {}
    for team, row in combined.items():
        plays = max(1, row["plays"])
        result[team] = {
            "plays": int(row["plays"]),
            "successRate": row["successes"] / plays,
            "estimatedEpaPerPlay": row["epa"] / plays,
            "explosivePlayRate": row["explosives"] / plays,
            "earlyDownSuccessRate": row["earlySuccesses"] / max(1, row["earlyPlays"]),
            "havocRate": row["havoc"] / plays,
            "finishingDrives": row["finishes"] / max(1, row["opportunities"]),
            "defensiveSuccessAllowed": row["successesAllowed"] / max(1, row["defensePlays"]),
            "estimatedEpaAllowedPerPlay": row["epaAllowed"] / max(1, row["defensePlays"]),
            "explosiveAllowedRate": row["explosivesAllowed"] / max(1, row["defensePlays"]),
            "gamesCovered": sum(any(norm_name(name) == team for name in cache.get(game["id"], {})) for game in targets),
        }
    league_success = float(np.mean([row["successRate"] for row in result.values()])) if result else 0
    league_epa = float(np.mean([row["estimatedEpaPerPlay"] for row in result.values()])) if result else 0
    opponents: dict[str, list[str]] = {}
    for game in targets:
        names = [norm_name(item.get("team") or "") for item in game.get("competitors", [])]
        if len(names) == 2:
            opponents.setdefault(names[0], []).append(names[1])
            opponents.setdefault(names[1], []).append(names[0])
    for team, row in result.items():
        opponent_rows = [result[name] for name in opponents.get(team, []) if name in result]
        opponent_success_allowed = float(np.mean([item["defensiveSuccessAllowed"] for item in opponent_rows])) if opponent_rows else league_success
        opponent_epa_allowed = float(np.mean([item["estimatedEpaAllowedPerPlay"] for item in opponent_rows])) if opponent_rows else league_epa
        row["opponentAdjustedSuccessRate"] = row["successRate"] + (league_success - opponent_success_allowed)
        row["opponentAdjustedEpaPerPlay"] = row["estimatedEpaPerPlay"] + (league_epa - opponent_epa_allowed)
        row["metricSchema"] = PLAY_METRIC_SCHEMA
    return result


def add_score_metrics(payload: dict, year: int, records: list[dict]) -> None:
    aggregates: dict[str, dict] = {}
    schedule = payload.get("seasonSchedule", {})
    games = schedule.get("games", []) if int(schedule.get("year", 0) or 0) == year else []
    for game in games:
        competitors = game.get("competitors", [])
        if len(competitors) != 2 or not game.get("completed"):
            continue
        for index, team in enumerate(competitors):
            opponent = competitors[1 - index]
            name = norm_name(team.get("team") or "")
            points = float(team.get("score") or 0)
            allowed = float(opponent.get("score") or 0)
            row = aggregates.setdefault(
                name,
                {"games": 0, "pointsFor": 0, "pointsAgainst": 0, "wins": 0, "rankedWins": 0, "closeWins": 0, "closeGames": 0, "margins": []},
            )
            margin = points - allowed
            row["games"] += 1
            row["pointsFor"] += points
            row["pointsAgainst"] += allowed
            row["wins"] += int(margin > 0)
            row["rankedWins"] += int(margin > 0 and opponent.get("rank") is not None)
            row["closeGames"] += int(abs(margin) <= 8)
            row["closeWins"] += int(0 < margin <= 8)
            row["margins"].append(margin)
    for record in records:
        metric = aggregates.get(record["Team"])
        if not metric or not metric["games"]:
            continue
        games = metric["games"]
        record["Games Tracked"] = int(games)
        record["Points For"] = metric["pointsFor"] / games
        record["Points Against"] = metric["pointsAgainst"] / games
        record["Scoring Margin"] = (metric["pointsFor"] - metric["pointsAgainst"]) / games
        record["Recent Form"] = float(np.mean(metric["margins"][-3:]))
        record["Ranked Wins"] = int(metric["rankedWins"])
        record["Close Game Win Pct"] = metric["closeWins"] / metric["closeGames"] if metric["closeGames"] else None
        record["Offensive Index"] = min(100.0, metric["pointsFor"] / games / 0.45)
        record["Defensive Index"] = min(100.0, max(0.0, (45 - metric["pointsAgainst"] / games) / 0.45))
        record["Form Index"] = min(100.0, max(0.0, 50 + record["Recent Form"] * 2))


def add_play_metrics(records: list[dict], metrics: dict[str, dict]) -> None:
    for record in records:
        row = metrics.get(record["Team"])
        if not row:
            continue
        record["Play Success Rate"] = row["successRate"]
        record["Estimated EPA Per Play"] = row["estimatedEpaPerPlay"]
        record["Explosive Play Rate"] = row["explosivePlayRate"]
        record["Early Down Success Rate"] = row["earlyDownSuccessRate"]
        record["Havoc Rate"] = row["havocRate"]
        record["Finishing Drives"] = row["finishingDrives"]
        record["Defensive Success Allowed"] = row["defensiveSuccessAllowed"]
        record["Estimated EPA Allowed Per Play"] = row["estimatedEpaAllowedPerPlay"]
        record["Opponent Adjusted Success Rate"] = row["opponentAdjustedSuccessRate"]
        record["Opponent Adjusted EPA Per Play"] = row["opponentAdjustedEpaPerPlay"]
        record["Play Data Games"] = row["gamesCovered"]


def prediction_change_explanation(prior: dict | None, current: dict | None) -> dict:
    prior = prior or {}
    current = current or {}
    probability_change = float(current.get("mlChampionProbability") or 0) - float(prior.get("mlChampionProbability") or 0)
    direct_effects = {}
    evidence = {}
    for component, features in PREDICTION_CHANGE_COMPONENTS.items():
        deltas = []
        for feature in features:
            old = float(prior.get(feature) or 0)
            new = float(current.get(feature) or 0)
            scale = 100.0 if feature == "Win Pct" else 1.0
            deltas.append((new - old) * scale)
        score_delta = float(np.mean(deltas)) if deltas else 0.0
        direct_effects[component] = score_delta * 0.00035
        evidence[component] = {"scoreDelta": score_delta, "features": features}
    feature_total = sum(direct_effects.values())
    direct_effects["modelConsensus"] = probability_change - feature_total
    consensus_delta = float(current.get("modelProbabilityMean") or 0) - float(prior.get("modelProbabilityMean") or 0)
    evidence["modelConsensus"] = {
        "scoreDelta": consensus_delta,
        "features": ["modelProbabilityMean", "modelProbabilityStdDev"],
        "includesReconciliationResidual": True,
    }
    strongest = max(direct_effects, key=lambda key: abs(direct_effects[key]))
    return {
        "probabilityChange": probability_change,
        "effects": direct_effects,
        "evidence": evidence,
        "strongestEffect": strongest,
        "decompositionResidual": probability_change - sum(direct_effects.values()),
        "method": "Local week-over-week score deltas with model-consensus reconciliation",
    }


def build_prediction_changelog(current_rows: list[dict]) -> list[dict]:
    entries = []
    for prior, current in zip(current_rows, current_rows[1:]):
        prior_records = {row["Team"]: row for row in prior.get("records", [])}
        current_records = {row["Team"]: row for row in current.get("records", [])}
        prior_map = {team: float(row.get("mlChampionProbability") or 0) for team, row in prior_records.items()}
        current_map = {team: float(row.get("mlChampionProbability") or 0) for team, row in current_records.items()}
        team_changes = []
        for team in sorted(set(prior_records) | set(current_records)):
            explanation = prediction_change_explanation(prior_records.get(team), current_records.get(team))
            team_changes.append(
                {
                    "team": team,
                    "priorProbability": prior_map.get(team, 0),
                    "probability": current_map.get(team, 0),
                    "change": explanation["probabilityChange"],
                    "status": "entered" if team not in prior_records else "left" if team not in current_records else "tracked",
                    "explanation": explanation,
                }
            )
            if team in current_records:
                current_records[team]["predictionChange"] = explanation
        moves = sorted(
            team_changes,
            key=lambda item: abs(item["change"]),
            reverse=True,
        )
        prior_top12 = set(team for team, _ in sorted(prior_map.items(), key=lambda item: item[1], reverse=True)[:12])
        current_top12 = set(team for team, _ in sorted(current_map.items(), key=lambda item: item[1], reverse=True)[:12])
        entries.append(
            {
                "week": current.get("week"),
                "snapshotId": current.get("snapshotId"),
                "leader": current.get("predictedChampion"),
                "leaderChanged": prior.get("predictedChampion") != current.get("predictedChampion"),
                "largestMoves": moves[:5],
                "teamChanges": sorted(team_changes, key=lambda item: item["probability"], reverse=True),
                "components": ["poll", "resume", "efficiency", "opponent", "modelConsensus"],
                "enteredTop12": sorted(current_top12 - prior_top12),
                "leftTop12": sorted(prior_top12 - current_top12),
            }
        )
    return entries


def selection_training_rows(weekly: dict[str, list[dict]], start_year: int, end_year: int, field_size: int) -> list[dict]:
    rows = []
    for year_text, snapshots in weekly.items():
        year = int(year_text)
        if year not in COMPLETED_YEARS or not start_year <= year <= end_year or not snapshots:
            continue
        label_snapshot = snapshots[-1]
        feature_snapshot = snapshots[-2] if len(snapshots) > 1 else snapshots[-1]
        label_records = {record["Team"]: record for record in label_snapshot.get("records", [])}
        for record in feature_snapshot.get("records", []):
            label_record = label_records.get(record["Team"], {})
            if label_record.get("CFP") is not None:
                rank, source, proxy = label_record["CFP"], "final CFP rank", False
            elif label_record.get("AP POLL") is not None:
                rank, source, proxy = label_record["AP POLL"], "final AP rank proxy", True
            else:
                rank, source, proxy = label_record.get("predictedRank"), "model rank proxy", True
            values = [record.get(feature) for feature in SELECTION_FEATURES]
            if rank is None or any(value is None for value in values):
                continue
            rows.append(
                {
                    "year": year,
                    "team": record["Team"],
                    "features": [float(value) for value in values],
                    "selected": int(float(rank) <= field_size),
                    "fieldSize": field_size,
                    "featureWeek": int(feature_snapshot.get("week", 0)),
                    "labelWeek": int(label_snapshot.get("week", 0)),
                    "labelRank": float(rank),
                    "labelSource": source,
                    "isProxyLabel": proxy,
                    "leakageSafe": int(feature_snapshot.get("week", 0)) < int(label_snapshot.get("week", 0)),
                }
            )
    return rows


def fit_selection_era(weekly: dict[str, list[dict]], name: str, start_year: int, end_year: int, field_size: int) -> dict:
    rows = selection_training_rows(weekly, start_year, end_year, field_size)
    evaluations = []
    for year in sorted({row["year"] for row in rows})[1:]:
        train = [row for row in rows if row["year"] < year]
        test = [row for row in rows if row["year"] == year]
        if not train or not test or len({row["selected"] for row in train}) < 2:
            continue
        model = fit_binary_model(
            np.asarray([row["features"] for row in train], dtype=float),
            np.asarray([row["selected"] for row in train], dtype=float),
            regularization=0.025,
        )
        probabilities = [binary_probability(model, row["features"]) for row in test]
        labels = [row["selected"] for row in test]
        evaluations.append(
            {
                "year": year,
                "teams": len(test),
                "accuracy": sum((probability >= 0.5) == bool(label) for probability, label in zip(probabilities, labels)) / len(test),
                "brier": float(np.mean([(probability - label) ** 2 for probability, label in zip(probabilities, labels)])),
                "featureCutoffWeek": max(row["featureWeek"] for row in test),
                "labelWeek": max(row["labelWeek"] for row in test),
            }
        )
    model = fit_binary_model(
        np.asarray([row["features"] for row in rows], dtype=float),
        np.asarray([row["selected"] for row in rows], dtype=float),
        regularization=0.025,
    )
    source_counts = {
        source: sum(row["labelSource"] == source for row in rows)
        for source in sorted({row["labelSource"] for row in rows})
    }
    digest = hashlib.sha256(
        json.dumps(
            {
                "schema": "cfp-selection-v2-era-split",
                "era": name,
                "rows": [[row["year"], row["team"], row["selected"], row["labelSource"]] for row in rows],
            },
            separators=(",", ":"),
        ).encode()
    ).hexdigest()[:12]
    return {
        "name": name,
        "fieldSize": field_size,
        "years": f"{start_year}-{end_year}",
        "version": f"selection-{field_size}-{max(row['year'] for row in rows)}-{digest}",
        "trainingTeams": len(rows),
        "trainingSeasons": f"{min(row['year'] for row in rows)}-{max(row['year'] for row in rows)}",
        "target": f"Final {field_size}-team CFP field",
        "labelPolicy": "Final CFP rank when present; final AP rank or model rank only as an explicitly marked proxy.",
        "labelEvidence": source_counts,
        "proxyLabels": sum(row["isProxyLabel"] for row in rows),
        "leakageSafeRows": sum(row["leakageSafe"] for row in rows),
        "leakagePolicy": "Features come from the prior available weekly snapshot; final ranking evidence supplies labels only.",
        "features": SELECTION_FEATURES,
        "coefficients": [
            {"feature": feature, "coefficient": float(weight)}
            for feature, weight in zip(SELECTION_FEATURES, model["weights"][1:])
        ],
        "forwardValidation": evaluations,
        "accuracy": float(np.average([row["accuracy"] for row in evaluations], weights=[row["teams"] for row in evaluations])) if evaluations else None,
        "brier": float(np.average([row["brier"] for row in evaluations], weights=[row["teams"] for row in evaluations])) if evaluations else None,
        "model": model,
    }


def build_selection_model(weekly: dict[str, list[dict]], current_records: list[dict], current_year: int) -> dict:
    era_specs = [
        ("Four-team CFP era", 2014, 2023, 4),
        ("Twelve-team CFP era", 2024, max(COMPLETED_YEARS), 12),
    ]
    eras = [fit_selection_era(weekly, *spec) for spec in era_specs]
    active = next(era for era in eras if era["fieldSize"] == (12 if current_year >= 2024 else 4))
    model = active.pop("model")
    for era in eras:
        era.pop("model", None)
    for record in current_records:
        values = [record.get(feature) for feature in SELECTION_FEATURES]
        record["CFP Selection Probability"] = binary_probability(model, [float(value or 0) for value in values])
    ranked = sorted(current_records, key=lambda row: row.get("CFP Selection Probability", 0), reverse=True)
    for seed, record in enumerate(ranked, 1):
        record["Projected CFP Seed"] = seed if seed <= active["fieldSize"] else None
    return {
        "name": "CFP Selection Logistic",
        "version": active["version"],
        "schema": "cfp-selection-v2-era-split",
        "activeEra": active["name"],
        "activeFieldSize": active["fieldSize"],
        "trainingTeams": active["trainingTeams"],
        "trainingSeasons": active["trainingSeasons"],
        "target": active["target"],
        "features": SELECTION_FEATURES,
        "coefficients": active["coefficients"],
        "forwardValidation": active["forwardValidation"],
        "accuracy": active["accuracy"],
        "brier": active["brier"],
        "labelPolicy": active["labelPolicy"],
        "leakagePolicy": active["leakagePolicy"],
        "eras": eras,
    }


def build_roster_availability(current_records: list[dict], as_of: str | None) -> dict:
    teams = {}
    for record in current_records:
        record["Roster Availability Adjustment"] = 0.0
        record["Roster Availability Confidence"] = 0.0
        teams[record["Team"]] = {
            "adjustment": 0.0,
            "confidence": 0.0,
            "source": "neutral fallback",
            "sourceUrl": None,
            "reportedAt": None,
            "status": "no stable structured feed",
        }
    return {
        "contractVersion": "roster-availability-v1",
        "asOf": as_of,
        "feedStatus": "neutral-fallback",
        "appliedToPredictions": False,
        "neutralAdjustment": 0.0,
        "confidenceScale": {"minimum": 0.0, "maximum": 1.0},
        "requiredSourceFields": ["source", "sourceUrl", "reportedAt", "confidence"],
        "policy": "No adjustment is applied without a stable, attributable roster-availability feed.",
        "teams": teams,
    }


def build_conference_race(schedule: dict, current_records: list[dict], game_model: dict) -> dict:
    teams: dict[str, dict] = {}
    conference_names: dict[str, str] = {}
    head_to_head: dict[str, list[str]] = {}
    for game in schedule.get("games", []):
        competitors = game.get("competitors", [])
        if len(competitors) != 2:
            continue
        for competitor in competitors:
            team = competitor.get("team")
            conference_id = str(competitor.get("conferenceId") or "independent")
            if not team:
                continue
            teams.setdefault(
                team,
                {
                    "team": team,
                    "conferenceId": conference_id,
                    "conference": game.get("conference") if game.get("conferenceGame") else None,
                    "conferenceWins": 0,
                    "conferenceLosses": 0,
                    "pointsFor": 0.0,
                    "pointsAgainst": 0.0,
                    "projectedRemainingConferenceWins": 0.0,
                },
            )
            if game.get("conferenceGame") and game.get("conference"):
                teams[team]["conference"] = game["conference"]
                conference_names[conference_id] = game["conference"]
        if not game.get("conferenceGame"):
            continue
        a, b = competitors
        if game.get("completed"):
            for competitor, opponent in [(a, b), (b, a)]:
                row = teams[competitor["team"]]
                row["conferenceWins" if competitor.get("winner") else "conferenceLosses"] += 1
                row["pointsFor"] += float(competitor.get("score") or 0)
                row["pointsAgainst"] += float(opponent.get("score") or 0)
                if competitor.get("winner"):
                    head_to_head.setdefault(competitor["team"], []).append(opponent["team"])
        else:
            probability = (game.get("gameModel") or {}).get("teamAWinProbability")
            modeled_a = (game.get("gameModel") or {}).get("teamA")
            if probability is None:
                probability = 0.5
            for competitor in competitors:
                win_probability = float(probability) if competitor["team"] == modeled_a else 1 - float(probability)
                teams[competitor["team"]]["projectedRemainingConferenceWins"] += win_probability
    grouped: dict[str, list[dict]] = {}
    current_map = {row["Team"]: row for row in current_records}
    for team, row in teams.items():
        row["conference"] = row["conference"] or conference_names.get(row["conferenceId"]) or "Independent / unknown"
        row["projectedConferenceWins"] = row["conferenceWins"] + row["projectedRemainingConferenceWins"]
        row["pointDifferential"] = row["pointsFor"] - row["pointsAgainst"]
        row["elo"] = float(game_model.get("currentTeams", {}).get(team, {}).get("elo", 1500.0))
        grouped.setdefault(row["conferenceId"], []).append(row)
    conferences = []
    for conference_id, members in grouped.items():
        if conference_id == "independent" or len(members) < 2:
            continue
        logits = np.asarray(
            [member["projectedConferenceWins"] * 1.35 + (member["elo"] - 1500) / 240 for member in members],
            dtype=float,
        )
        probabilities = normalized_probability(np.exp(logits - np.max(logits)))
        projected = []
        for member, probability in zip(members, probabilities):
            evidence = [
                f"Conference record {member['conferenceWins']}-{member['conferenceLosses']}",
                f"Projected remaining conference wins {member['projectedRemainingConferenceWins']:.2f}",
                f"Head-to-head wins: {', '.join(head_to_head.get(member['team'], [])) or 'none recorded'}",
                "Point differential and Elo are projection inputs, not official tiebreakers",
            ]
            projected.append(
                {
                    **member,
                    "conferenceTitleProbability": float(probability),
                    "tiebreakerEvidence": evidence,
                }
            )
            if member["team"] in current_map:
                current_map[member["team"]]["Conference Title Probability"] = float(probability)
                current_map[member["team"]]["Conference Projected Wins"] = member["projectedConferenceWins"]
        projected.sort(key=lambda item: item["conferenceTitleProbability"], reverse=True)
        conferences.append(
            {
                "conferenceId": conference_id,
                "conference": conference_names.get(conference_id) or projected[0]["conference"],
                "projectedChampion": projected[0]["team"],
                "teams": projected,
            }
        )
    conferences.sort(key=lambda item: item["conference"])
    return {
        "season": schedule.get("year"),
        "method": "Conference record plus modeled remaining conference games and Elo strength",
        "tiebreakerStatus": "Evidence is informational; conference-specific multi-team procedures are not fully encoded.",
        "conferenceCount": len(conferences),
        "conferences": conferences,
    }


def rank_stability(prior: dict, current: dict, model: str) -> float | None:
    prior_prediction = next((row for row in prior.get("modelPredictions", []) if row.get("model") == model), None)
    current_prediction = next((row for row in current.get("modelPredictions", []) if row.get("model") == model), None)
    if not prior_prediction or not current_prediction:
        return None
    teams = sorted(set(prior_prediction.get("probabilities", {})) & set(current_prediction.get("probabilities", {})))
    if len(teams) < 3:
        return None
    prior_order = {team: rank for rank, team in enumerate(sorted(teams, key=lambda team: prior_prediction["probabilities"][team], reverse=True), 1)}
    current_order = {team: rank for rank, team in enumerate(sorted(teams, key=lambda team: current_prediction["probabilities"][team], reverse=True), 1)}
    left = np.asarray([prior_order[team] for team in teams], dtype=float)
    right = np.asarray([current_order[team] for team in teams], dtype=float)
    correlation = np.corrcoef(left, right)[0, 1]
    return None if np.isnan(correlation) else float(correlation)


def snapshot_feature_drift(prior: dict, current: dict) -> float | None:
    prior_map = {row["Team"]: row for row in prior.get("records", [])}
    current_map = {row["Team"]: row for row in current.get("records", [])}
    teams = set(prior_map) & set(current_map)
    values = []
    for feature in ["Resume Composite", "Power Composite", "Consensus Score", "Balance Score"]:
        baseline = [float(prior_map[team].get(feature) or 0) for team in teams]
        scale = float(np.std(baseline)) or 1.0
        values.extend(abs(float(current_map[team].get(feature) or 0) - float(prior_map[team].get(feature) or 0)) / scale for team in teams)
    return float(np.mean(values)) if values else None


def build_model_drift(weekly: dict[str, list[dict]]) -> dict:
    thresholds = {
        "calibrationDelta": {"warning": 0.15, "critical": 0.30},
        "rankingStability": {"warningBelow": 0.65, "criticalBelow": 0.35},
        "featureDrift": {"warning": 0.75, "critical": 1.50},
    }
    rows = []
    for year_text, snapshots in weekly.items():
        for index, snapshot in enumerate(snapshots):
            prior = snapshots[index - 1] if index else None
            actual = snapshot.get("actualChampion")
            feature_drift = snapshot_feature_drift(prior, snapshot) if prior else None
            for prediction in snapshot.get("modelPredictions", []):
                probabilities = prediction.get("probabilities", {})
                brier = None
                if actual and actual != "TBD" and actual in probabilities:
                    brier = float(sum((float(value) - (1 if team == actual else 0)) ** 2 for team, value in probabilities.items()))
                rows.append(
                    {
                        "season": int(year_text),
                        "week": int(snapshot.get("week", 0)),
                        "model": prediction.get("model"),
                        "multiclassBrier": brier,
                        "calibrationDelta": None,
                        "rankingStability": rank_stability(prior, snapshot, prediction.get("model")) if prior else None,
                        "featureDrift": feature_drift,
                    }
                )
    baselines: dict[tuple[str, int], float] = {}
    for row in rows:
        key = (row["model"], row["week"])
        peers = [item["multiclassBrier"] for item in rows if (item["model"], item["week"]) == key and item["season"] < row["season"] and item["multiclassBrier"] is not None]
        if peers:
            baselines[key] = float(np.median(peers))
        if row["multiclassBrier"] is not None and key in baselines:
            row["calibrationDelta"] = row["multiclassBrier"] - baselines[key]
        critical = (
            row["calibrationDelta"] is not None and abs(row["calibrationDelta"]) >= thresholds["calibrationDelta"]["critical"]
        ) or (
            row["rankingStability"] is not None and row["rankingStability"] <= thresholds["rankingStability"]["criticalBelow"]
        ) or (row["featureDrift"] is not None and row["featureDrift"] >= thresholds["featureDrift"]["critical"])
        warning = (
            row["calibrationDelta"] is not None and abs(row["calibrationDelta"]) >= thresholds["calibrationDelta"]["warning"]
        ) or (
            row["rankingStability"] is not None and row["rankingStability"] <= thresholds["rankingStability"]["warningBelow"]
        ) or (row["featureDrift"] is not None and row["featureDrift"] >= thresholds["featureDrift"]["warning"])
        row["status"] = "critical" if critical else "warning" if warning else "stable"
    latest_season = max((int(year) for year in weekly if weekly[year]), default=0)
    latest_week = max((int(row.get("week", 0)) for row in weekly.get(str(latest_season), [])), default=0)
    latest = [row for row in rows if row["season"] == latest_season and row["week"] == latest_week]
    return {
        "contractVersion": "model-drift-v1",
        "thresholds": thresholds,
        "latestSeason": latest_season,
        "latestWeek": latest_week,
        "latest": latest,
        "byWeekModel": rows,
        "statusCounts": {status: sum(row["status"] == status for row in latest) for status in ["stable", "warning", "critical"]},
    }


def build_weekly_report(current_rows: list[dict]) -> dict:
    if not current_rows:
        return {}
    latest = current_rows[-1]
    prior = current_rows[-2] if len(current_rows) > 1 else None
    latest_records = latest.get("records", [])
    prior_map = {row["Team"]: float(row.get("mlChampionProbability") or 0) for row in (prior or {}).get("records", [])}
    movers = sorted(
        [
            {
                "team": row["Team"],
                "probability": float(row.get("mlChampionProbability") or 0),
                "change": float(row.get("mlChampionProbability") or 0) - prior_map.get(row["Team"], 0),
            }
            for row in latest_records
        ],
        key=lambda row: row["change"],
        reverse=True,
    )
    field = sorted(latest_records, key=lambda row: row.get("CFP Selection Probability", 0), reverse=True)[:12]
    return {
        "season": latest.get("year"),
        "week": latest.get("week"),
        "leader": latest.get("predictedChampion"),
        "leaderProbability": latest.get("predictedProbability"),
        "leaderChanged": bool(prior and prior.get("predictedChampion") != latest.get("predictedChampion")),
        "biggestRisers": movers[:3],
        "biggestFallers": list(reversed(movers[-3:])),
        "projectedField": [{"seed": index, "team": row["Team"], "probability": row.get("CFP Selection Probability")} for index, row in enumerate(field, 1)],
        "modelAgreement": latest.get("modelPredictions", []),
        "snapshotId": latest.get("snapshotId"),
    }


def build_data_quality(payload: dict, current_records: list[dict]) -> dict:
    schedule = payload.get("seasonSchedule", {})
    games = schedule.get("games", [])
    ids = [game.get("id") for game in games]
    scheduled_teams = {item.get("team") for game in games for item in game.get("competitors", [])}
    issues = []
    if len(ids) != len(set(ids)):
        issues.append("Duplicate schedule event IDs detected.")
    missing_teams = [row["Team"] for row in current_records if row["Team"] not in scheduled_teams]
    if missing_teams:
        issues.append(f"No schedule match for {len(missing_teams)} ranked teams.")
    missing_play = [row["Team"] for row in current_records if not row.get("Play Data Games")]
    if missing_play:
        issues.append(f"Play-level coverage missing for {len(missing_play)} ranked teams.")
    missing_adjusted = [row["Team"] for row in current_records if row.get("Opponent Adjusted EPA Per Play") is None]
    if missing_adjusted:
        issues.append(f"Opponent-adjusted efficiency missing for {len(missing_adjusted)} ranked teams.")
    unmodeled_games = [game for game in games if not game.get("gameModel")]
    if unmodeled_games:
        issues.append(f"Game probabilities missing for {len(unmodeled_games)} scheduled games.")
    if not payload.get("gameModel", {}).get("calibration", {}).get("bins"):
        issues.append("Game probability calibration is unavailable.")
    if not payload.get("selectionModel", {}).get("version"):
        issues.append("CFP selection model is unavailable.")
    if len(payload.get("selectionModel", {}).get("eras", [])) != 2:
        issues.append("Era-specific CFP selection models are unavailable.")
    if not payload.get("rosterAvailability", {}).get("contractVersion"):
        issues.append("Roster-availability adjustment contract is unavailable.")
    if not payload.get("conferenceRace", {}).get("conferences"):
        issues.append("Conference race projections are unavailable.")
    if not payload.get("modelDrift", {}).get("byWeekModel"):
        issues.append("Model drift monitoring is unavailable.")
    if not payload.get("gameModel", {}).get("pregameFeatureStore", {}).get("sha256"):
        issues.append("Pregame feature store provenance is unavailable.")
    history = payload.get("weeklyPredictions", {})
    current_year = str(payload.get("meta", {}).get("currentSeason"))
    current_snapshots = history.get(current_year, [])
    weeks = [int(row.get("week", 0)) for row in current_snapshots]
    if weeks != sorted(set(weeks)):
        issues.append("Current weekly snapshots are duplicated or out of order.")
    prior_records = history.get(str(int(current_year) - 1), [{}])[-1].get("records", []) if history.get(str(int(current_year) - 1)) else []
    drift = []
    for feature in ["Resume Composite", "Power Composite", "Consensus Score", "Balance Score"]:
        current_values = [float(row[feature]) for row in current_records if row.get(feature) is not None]
        prior_values = [float(row[feature]) for row in prior_records if row.get(feature) is not None]
        if current_values and prior_values:
            drift.append({"feature": feature, "meanShift": float(np.mean(current_values) - np.mean(prior_values))})
    coverage = {
        "scheduleTeams": len(scheduled_teams),
        "rankedTeamsMatched": len(current_records) - len(missing_teams),
        "playLevelTeams": len(current_records) - len(missing_play),
        "completedGames": sum(bool(game.get("completed")) for game in games),
        "scheduledGames": len(games),
        "modeledGames": len(games) - len(unmodeled_games),
        "opponentAdjustedTeams": len(current_records) - len(missing_adjusted),
        "conferenceRaceTeams": sum(len(row.get("teams", [])) for row in payload.get("conferenceRace", {}).get("conferences", [])),
        "rosterAvailabilityTeams": len(payload.get("rosterAvailability", {}).get("teams", {})),
    }
    return {"status": "healthy" if not issues else "attention", "issues": issues, "coverage": coverage, "featureDrift": drift}


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
                probabilities = prediction.get("probabilities", {})
                multiclass_brier = sum(
                    (float(value) - (1 if team == actual else 0)) ** 2
                    for team, value in probabilities.items()
                )
                results.setdefault(prediction["model"], []).append(
                    {"rank": rank, "probability": probability, "week": int(snapshot.get("week", 0)), "brier": multiclass_brier}
                )
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
                "meanBrierScore": sum(row["brier"] for row in rows) / len(rows),
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
    by_week = []
    for name, rows in results.items():
        for week in sorted({row["week"] for row in rows}):
            week_rows = [row for row in rows if row["week"] == week]
            by_week.append(
                {
                    "model": name,
                    "week": week,
                    "samples": len(week_rows),
                    "top1Rate": sum(row["rank"] == 1 for row in week_rows) / len(week_rows),
                    "top3Rate": sum(row["rank"] <= 3 for row in week_rows) / len(week_rows),
                    "meanChampionRank": sum(row["rank"] for row in week_rows) / len(week_rows),
                    "meanChampionNll": sum(-math.log(max(row["probability"], 1e-9)) for row in week_rows) / len(week_rows),
                }
            )
    ece = sum(abs(row["predicted"] - row["observed"]) * row["count"] for row in bins) / max(
        1, sum(row["count"] for row in bins)
    )
    return {"models": diagnostics, "calibration": bins, "byWeek": by_week, "expectedCalibrationError": ece}


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


def write_data_files(payload: dict) -> None:
    rendered = json.dumps(payload, indent=2)
    DATA_PATH.write_text(rendered, encoding="utf-8")
    PUBLIC_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_DATA_PATH.write_text(rendered, encoding="utf-8")

    weekly = payload.get("weeklyPredictions", {})
    core = {**payload, "weeklyPredictions": {}}
    core["meta"] = {
        **core.get("meta", {}),
        "weeklyYears": sorted((int(year) for year in weekly), reverse=True),
        "dataShards": True,
    }
    core_rendered = json.dumps(core, separators=(",", ":"))
    for root in [DATA_PATH.parent, PUBLIC_DATA_PATH.parent]:
        (root / "app-core.json").write_text(core_rendered, encoding="utf-8")
        for year, snapshots in weekly.items():
            shard = {"year": int(year), "snapshots": snapshots}
            (root / f"weekly-{year}.json").write_text(json.dumps(shard, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    payload = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    existing_weekly = payload.get("weeklyPredictions", {})
    current_year = current_college_football_season()
    years = COMPLETED_YEARS + ([] if current_year in COMPLETED_YEARS else [current_year])
    weekly = {}
    for year in years:
        season = payload["seasonPredictions"].get(str(year), {})
        actual = CHAMPIONS.get(year, season.get("actualChampion", "TBD"))
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
        weeks_to_fetch = list(range(max(1, latest_existing), max(WEEKS) + 1))
        with ThreadPoolExecutor(max_workers=min(8, len(weeks_to_fetch))) as executor:
            futures = {executor.submit(predict_week, year, week, actual): week for week in weeks_to_fetch}
            for future in as_completed(futures):
                week = futures[future]
                prediction = future.result()
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
    payload["seasonSchedule"] = fetch_season_schedule(current_year)
    add_score_metrics(payload, current_year, current_records)
    game_history = load_game_history()
    payload["gameModel"] = build_game_model(game_history, payload["seasonSchedule"])
    for record in current_records:
        team_model = payload["gameModel"].get("currentTeams", {}).get(record["Team"], {})
        record["Game Elo"] = team_model.get("elo")
        record["Expected Remaining Wins"] = team_model.get("expectedRemainingWins")
    payload["playLevelMetrics"] = build_play_level_metrics(
        payload["seasonSchedule"], {record["Team"] for record in current_records}
    )
    add_play_metrics(current_records, payload["playLevelMetrics"])
    payload["selectionModel"] = build_selection_model(weekly, current_records, current_year)
    for record in current_records:
        record["predictionReasons"] = prediction_reasons(record)
    payload["meta"]["weeklyModels"] = [*MODEL_WEIGHTS.keys(), *TRAINED_MODEL_NAMES, STACKED_MODEL, TRAINED_ENSEMBLE]
    payload["meta"]["weeklySourceNote"] = (
        "Weekly predictions use frozen ESPN College Football Playoff Picture snapshots. "
        "Prior weeks never refresh after a new week is captured. Six base variants, a forward stacker and an ensemble "
        "are trained only on completed seasons before the season being predicted."
    )
    diagnostics = build_weekly_diagnostics(weekly)
    payload["weeklyModelDiagnostics"] = diagnostics["models"]
    payload["weeklyCalibration"] = diagnostics["calibration"]
    payload["weeklyEvaluationByWeek"] = diagnostics["byWeek"]
    payload["summary"]["weeklyExpectedCalibrationError"] = diagnostics["expectedCalibrationError"]
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
    payload["predictionChangelog"] = build_prediction_changelog(current_rows)
    payload["rosterAvailability"] = build_roster_availability(
        current_records, latest.get("lastCheckedAt") if latest else None
    )
    payload["conferenceRace"] = build_conference_race(payload["seasonSchedule"], current_records, payload["gameModel"])
    payload["modelDrift"] = build_model_drift(weekly)
    latest_stack = next(
        (prediction.get("stacking") for prediction in current_predictions if prediction.get("model") == STACKED_MODEL),
        None,
    )
    payload["ensembleMetadata"] = {
        "contractVersion": "weekly-ensemble-v3",
        "productionEnsemble": TRAINED_ENSEMBLE,
        "members": [
            {"name": name, "family": "Bayesian MAP logistic" if name == "Weekly Bayesian Logistic" else "Elo-style rating" if name == "Weekly Elo Rating" else "base classifier"}
            for name in TRAINED_MODEL_NAMES
        ] + [{"name": STACKED_MODEL, "family": "forward-season stacking"}],
        "stacking": latest_stack,
        "combination": "Normalized mean of base and forward-stacked championship probabilities",
        "thirdPartyDependenciesAdded": False,
    }
    payload["weeklyReport"] = build_weekly_report(current_rows)
    champion_version = hashlib.sha256(
        json.dumps([row.get("snapshotId") for rows in weekly.values() for row in rows], separators=(",", ":")).encode()
    ).hexdigest()[:12]
    payload["meta"]["lineage"] = {
        "contractVersion": "source-lineage-v2",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "pipeline": "build_weekly_predictions.py",
        "sourceHash": champion_version,
        "sources": [
            {"name": "ESPN Playoff Picture", "role": "weekly rankings and resume/power inputs", "frozenSnapshots": True},
            {"name": "ESPN FBS scoreboard", "role": "schedule, scores, records and conference games", "frozenSnapshots": False},
            {"name": "ESPN play-by-play summary", "role": "efficiency and opponent-adjusted metrics", "frozenSnapshots": False},
        ],
        "transformations": [
            "rank normalization and composite feature construction",
            "forward-season champion model training",
            "Platt-calibrated pregame probability training",
            "era-specific CFP selection classification",
            "conference record and remaining-game projection",
        ],
        "leakageControls": [
            "Champion models train only on earlier completed seasons.",
            "Game features are reconstructed from information available before kickoff.",
            "CFP selection features precede the final ranking label snapshot whenever history permits.",
            "Stacker meta-features are generated by earlier-season base models.",
        ],
        "artifacts": {
            "weeklySnapshotHash": champion_version,
            "pregameFeatureStoreHash": payload["gameModel"]["pregameFeatureStore"]["sha256"],
            "gameModelVersion": payload["gameModel"]["version"],
            "selectionModelVersion": payload["selectionModel"]["version"],
        },
    }
    payload["publicApi"] = {
        "contractVersion": "ncaaf-public-data-v2",
        "generatedAt": payload["meta"]["lineage"]["generatedAt"],
        "season": current_year,
        "staticData": [
            {"path": "/data/app-core.json", "payload": "Core forecasts, diagnostics, provenance and current season"},
            *[
                {"path": f"/data/weekly-{year}.json", "payload": f"Frozen weekly snapshots for {year}"}
                for year in sorted(weekly, key=int)
            ],
        ],
        "dynamicEndpoints": [
            {"path": "/api/scores", "method": "GET", "payload": "Live scoreboard and win probability"},
            {"path": "/api/watchlist", "method": "GET/PUT", "payload": "Identity-scoped watchlist"},
        ],
        "additiveCompatibility": "Existing fields remain stable; new contracts are additive.",
        "freshness": {
            "latestSnapshotId": latest.get("snapshotId") if latest else None,
            "latestCheckedAt": latest.get("lastCheckedAt") if latest else None,
            "latestWeek": latest.get("week") if latest else None,
        },
    }
    payload["modelRegistry"] = [
        {
            "name": "Weekly ML Ensemble",
            "version": f"weekly-{champion_version}",
            "status": "production",
            "trainingCutoff": max(COMPLETED_YEARS),
            "validation": "Forward-season champion ranking",
            "featureSchema": "weekly-features-v2",
            "sourceHash": champion_version,
            "calibration": "Season-normalized ensemble",
            "members": payload["ensembleMetadata"]["members"],
            "stacking": payload["ensembleMetadata"]["stacking"],
        },
        {
            "name": payload["gameModel"]["name"],
            "version": payload["gameModel"]["version"],
            "status": "production",
            "trainingCutoff": max(COMPLETED_YEARS),
            "validation": "Forward-season game probability",
            "featureSchema": payload["gameModel"]["featureSchema"],
            "sourceHash": payload["gameModel"]["pregameFeatureStore"]["sha256"][:16],
            "calibration": payload["gameModel"]["calibration"]["method"],
        },
        {
            "name": payload["selectionModel"]["name"],
            "version": payload["selectionModel"]["version"],
            "status": "production",
            "trainingCutoff": max(COMPLETED_YEARS),
            "validation": "Forward-season era-specific CFP field classification",
            "featureSchema": payload["selectionModel"]["schema"],
            "sourceHash": payload["selectionModel"]["version"].split("-")[-1],
            "calibration": "Native logistic probability",
            "eras": payload["selectionModel"]["eras"],
        },
    ]
    payload["dataQuality"] = build_data_quality(payload, current_records)
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
        "status": "healthy" if latest and payload["dataQuality"]["status"] == "healthy" else "needs attention",
        "issues": ([] if latest else ["No current-season weekly snapshot is available."]) + payload["dataQuality"]["issues"],
    }
    payload["meta"]["weeklyModelMethod"] = (
        "Forward-season training: each historical season uses only earlier completed seasons; "
        f"the current season uses {min(COMPLETED_YEARS)}-{max(COMPLETED_YEARS)} snapshots."
    )
    payload["meta"]["advancedMetrics"] = [
        {"name": "Points per game", "status": "available", "source": "ESPN scoreboard"},
        {"name": "Points allowed", "status": "available", "source": "ESPN scoreboard"},
        {"name": "Scoring margin", "status": "available", "source": "ESPN scoreboard"},
        {"name": "Recent form", "status": "available", "source": "Last three completed games"},
        {"name": "Ranked wins", "status": "available", "source": "Opponent game-day rank"},
        {"name": "Close-game record", "status": "available", "source": "Games decided by 8 or fewer"},
        {"name": "Estimated EPA/play", "status": "available", "source": "ESPN play-by-play state model"},
        {"name": "Success rate", "status": "available", "source": "ESPN play-by-play"},
        {"name": "Explosiveness", "status": "available", "source": "20+ yard scrimmage plays"},
        {"name": "Havoc rate", "status": "available", "source": "Turnovers, sacks and negative plays"},
        {"name": "Finishing drives", "status": "available", "source": "Scoring opportunities inside the 40"},
        {"name": "Opponent-adjusted EPA/play", "status": "available", "source": "Play-by-play adjusted for opponent defensive efficiency"},
        {"name": "Opponent-adjusted success rate", "status": "available", "source": "Play-by-play adjusted for opponent defensive efficiency"},
        {"name": "CFP selection probability", "status": "available", "source": "Forward-season top-12 selection model"},
        {"name": "Roster availability adjustments", "status": "neutral fallback", "source": "Contract requires attributable source and confidence"},
        {"name": "Conference title probability", "status": "available", "source": "Conference record, remaining game probabilities and Elo"},
        {"name": "Model drift monitoring", "status": "available", "source": "Weekly calibration, rank stability and standardized feature drift"},
    ]
    write_data_files(payload)


if __name__ == "__main__":
    main()
