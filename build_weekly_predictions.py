from __future__ import annotations

import json
import math
import time
from datetime import date
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
    current_year = current_college_football_season()
    years = COMPLETED_YEARS + ([] if current_year in COMPLETED_YEARS else [current_year])
    weekly = {}
    for year in years:
        season = payload["seasonPredictions"].get(str(year), {})
        actual = season.get("actualChampion", "TBD")
        if year == current_year and year not in COMPLETED_YEARS:
            actual = "TBD"
        season_rows = []
        for week in WEEKS:
            prediction = predict_week(year, week, actual)
            if prediction is not None:
                season_rows.append(prediction)
        weekly[str(year)] = season_rows
        print(year, len(season_rows), [row["predictedChampion"] for row in season_rows])
    payload["weeklyPredictions"] = weekly
    update_current_season_page(payload, current_year, weekly.get(str(current_year), []))
    payload["meta"]["weeklyModels"] = list(MODEL_WEIGHTS.keys())
    payload["meta"]["weeklySourceNote"] = (
        "Weekly predictions use ESPN College Football Playoff Picture snapshots by week/year. "
        "The current season updates as new weekly snapshots become available."
    )
    rendered = json.dumps(payload, indent=2)
    DATA_PATH.write_text(rendered, encoding="utf-8")
    PUBLIC_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_DATA_PATH.write_text(rendered, encoding="utf-8")


if __name__ == "__main__":
    main()
