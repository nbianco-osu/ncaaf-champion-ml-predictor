from __future__ import annotations

import json
from io import StringIO
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from sklearn.ensemble import GradientBoostingClassifier


APP_DIR = Path(__file__).parent
DATA_PATH = APP_DIR / "data" / "app-data.json"
CSV_PATH = APP_DIR / "data" / "cfb_top25_2005_2025.csv"
WEEKLY_FEATURES = ["SOR", "SOS", "FPI", "Game Control"]
YEARS = [2021, 2022, 2023, 2024, 2025]
WEEKS = range(1, 17)


def norm_name(value: str) -> str:
    replacements = {
        "Georgia Bulldogs": "Georgia",
        "Michigan Wolverines": "Michigan",
        "Ohio State Buckeyes": "Ohio State",
        "Indiana Hoosiers": "Indiana",
        "Alabama Crimson Tide": "Alabama",
        "TCU Horned Frogs": "TCU",
        "Washington Huskies": "Washington",
        "Oregon Ducks": "Oregon",
        "Texas Longhorns": "Texas",
        "Penn State Nittany Lions": "Penn State",
        "Notre Dame Fighting Irish": "Notre Dame",
        "Miami Hurricanes": "Miami",
        "Ole Miss Rebels": "Ole Miss",
        "Texas Tech Red Raiders": "Texas Tech",
        "BYU Cougars": "BYU",
        "Oklahoma Sooners": "Oklahoma",
        "Utah Utes": "Utah",
        "Vanderbilt Commodores": "Vanderbilt",
        "Iowa Hawkeyes": "Iowa",
        "Navy Midshipmen": "Navy",
        "USC Trojans": "USC",
        "James Madison Dukes": "James Madison",
        "Tulane Green Wave": "Tulane",
        "Virginia Cavaliers": "Virginia",
        "Houston Cougars": "Houston",
        "North Texas Mean Green": "North Texas",
    }
    if value in replacements:
        return replacements[value]
    suffixes = [
        " Buckeyes",
        " Bulldogs",
        " Wolverines",
        " Hoosiers",
        " Crimson Tide",
        " Fighting Irish",
        " Nittany Lions",
        " Hurricanes",
        " Ducks",
        " Longhorns",
        " Rebels",
        " Cougars",
        " Sooners",
        " Utes",
        " Commodores",
        " Hawkeyes",
        " Midshipmen",
        " Trojans",
        " Dukes",
        " Green Wave",
        " Cavaliers",
        " Mean Green",
        " Horned Frogs",
    ]
    text = str(value).strip()
    for suffix in suffixes:
        if text.endswith(suffix):
            return text[: -len(suffix)]
    return text


def rank_norm(series: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(series, errors="coerce")
    max_rank = numeric.max()
    return ((max_rank - numeric + 1) / max_rank) * 100


def add_scores(frame: pd.DataFrame, group_col: str) -> pd.DataFrame:
    out = frame.copy()
    for feature in WEEKLY_FEATURES:
        out[f"{feature} Score"] = out.groupby(group_col)[feature].transform(rank_norm)
    return out


def softmax(values: np.ndarray, temperature: float = 0.18) -> np.ndarray:
    shifted = values.astype(float) - values.max()
    exp_values = np.exp(shifted / temperature)
    return exp_values / exp_values.sum()


def train_model() -> GradientBoostingClassifier:
    dataset = pd.read_csv(CSV_PATH)
    dataset["Champion"] = (dataset["Ranking"] == 1).astype(int)
    scored = add_scores(dataset, "Year")
    features = [f"{feature} Score" for feature in WEEKLY_FEATURES]
    model = GradientBoostingClassifier(random_state=42, n_estimators=90, learning_rate=0.035, max_depth=2)
    model.fit(scored[features], scored["Champion"])
    return model


def fetch_week(year: int, week: int) -> pd.DataFrame | None:
    url = f"https://www.espn.com/college-football/playoffPicture/_/week/{week}/year/{year}"
    response = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    if response.status_code != 200:
        return None
    tables = pd.read_html(StringIO(response.text))
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


def predict_week(model: GradientBoostingClassifier, year: int, week: int, actual_champion: str) -> dict | None:
    frame = fetch_week(year, week)
    if frame is None or frame.empty:
        return None
    scored = add_scores(frame, "Week")
    features = [f"{feature} Score" for feature in WEEKLY_FEATURES]
    raw = model.predict_proba(scored[features])[:, 1]
    scored["championProbability"] = softmax(raw)
    scored["predictedRank"] = scored["championProbability"].rank(method="first", ascending=False).astype(int)
    scored = scored.sort_values("predictedRank")
    top = scored.iloc[0]
    champ_rows = scored[scored["Team"] == actual_champion]
    actual_rank = None if champ_rows.empty else int(champ_rows.iloc[0]["predictedRank"])
    actual_prob = None if champ_rows.empty else float(champ_rows.iloc[0]["championProbability"])
    return {
        "year": year,
        "week": week,
        "predictedChampion": str(top["Team"]),
        "predictedProbability": float(top["championProbability"]),
        "actualChampion": actual_champion,
        "actualChampionPresent": not champ_rows.empty,
        "actualChampionPredictedRank": actual_rank,
        "actualChampionProbability": actual_prob,
        "sourceUrl": str(top["Source URL"]),
        "records": json.loads(scored.replace({np.nan: None}).to_json(orient="records")),
    }


def main() -> None:
    payload = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    model = train_model()
    weekly = {}
    for year in YEARS:
        actual = payload["seasonPredictions"][str(year)]["actualChampion"]
        season_rows = []
        for week in WEEKS:
            prediction = predict_week(model, year, week, actual)
            if prediction is not None:
                season_rows.append(prediction)
        weekly[str(year)] = season_rows
        print(year, len(season_rows), [row["predictedChampion"] for row in season_rows])
    payload["weeklyPredictions"] = weekly
    payload["meta"]["weeklySourceNote"] = (
        "Weekly predictions use ESPN College Football Playoff Picture snapshots by week/year. "
        "Those snapshots expose contender rows with SOS, SOR, Game Control, and FPI rank, so the weekly model uses that overlapping feature set."
    )
    DATA_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
