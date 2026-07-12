from __future__ import annotations

import json
import math
from pathlib import Path


APP_DIR = Path(__file__).parent
DATA_PATH = APP_DIR / "data" / "app-data.json"

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


def softmax(scores: list[float], temperature: float = 7.5) -> list[float]:
    max_score = max(scores)
    exps = [math.exp((score - max_score) / temperature) for score in scores]
    total = sum(exps)
    return [value / total for value in exps]


def score_record(record: dict, weights: dict[str, float]) -> float:
    return sum(float(record.get(feature) or 0) * weight for feature, weight in weights.items())


def predictions_for_week(week_payload: dict) -> list[dict]:
    predictions = []
    records = week_payload["records"]
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
        actual_rank = next(
            (index + 1 for index, item in enumerate(ranked) if item["team"] == week_payload["actualChampion"]),
            None,
        )
        actual_prob = next(
            (item["probability"] for item in ranked if item["team"] == week_payload["actualChampion"]),
            None,
        )
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


def main() -> None:
    payload = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    for season_rows in payload["weeklyPredictions"].values():
        for week_payload in season_rows:
            predictions = predictions_for_week(week_payload)
            week_payload["modelPredictions"] = predictions
            primary = predictions[0]
            week_payload["predictedChampion"] = primary["predictedChampion"]
            week_payload["predictedProbability"] = primary["predictedProbability"]
            week_payload["actualChampionPredictedRank"] = primary["actualChampionPredictedRank"]
            week_payload["actualChampionProbability"] = primary["actualChampionProbability"]
    payload["meta"]["weeklyModels"] = list(MODEL_WEIGHTS.keys())
    payload["meta"]["weeklySourceNote"] = (
        "Weekly predictions use ESPN College Football Playoff Picture snapshots by week/year. "
        "The weekly chart can switch between a balanced model, a resume-heavy model, and a power-rating blend using SOS, SOR, Game Control, and FPI rank."
    )
    DATA_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
