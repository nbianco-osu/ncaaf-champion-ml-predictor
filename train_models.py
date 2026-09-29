from __future__ import annotations

import json
import math
from collections import OrderedDict
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import (
    ExtraTreesClassifier,
    GradientBoostingClassifier,
    HistGradientBoostingClassifier,
    RandomForestClassifier,
)
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.utils.class_weight import compute_sample_weight


APP_DIR = Path(__file__).parent
DATASET_PATH = APP_DIR / "data" / "cfb_top25_2005_2025.csv"
DATA_PATH = APP_DIR / "data" / "app-data.json"
PUBLIC_DATA_PATH = APP_DIR / "public" / "data" / "app-data.json"

RANK_FEATURES = ["SOR", "SOS", "Offense", "Defense", "FPI", "Game Control"]
MODEL_FEATURES = [
    "SOR Score",
    "SOS Score",
    "Offense Score",
    "Defense Score",
    "FPI Score",
    "Game Control Score",
    "Resume Composite",
    "Efficiency Composite",
    "Power Composite",
    "Balance Score",
    "Consensus Score",
    "Consistency Score",
    "Elite Signal Share",
]
BASE_MODEL_NAMES = [
    "Logistic Regression",
    "Random Forest",
    "Extra Trees",
    "Gradient Boosting",
    "Histogram Gradient Boosting",
    "RBF Support Vector Machine",
]
ENSEMBLE_NAME = "Soft Voting Ensemble"


def model_factories() -> OrderedDict[str, callable]:
    return OrderedDict(
        {
            "Logistic Regression": lambda: make_pipeline(
                StandardScaler(),
                LogisticRegression(C=0.8, class_weight="balanced", max_iter=5000, random_state=42),
            ),
            "Random Forest": lambda: RandomForestClassifier(
                n_estimators=300,
                min_samples_leaf=2,
                max_features="sqrt",
                class_weight="balanced_subsample",
                random_state=42,
                n_jobs=-1,
            ),
            "Extra Trees": lambda: ExtraTreesClassifier(
                n_estimators=300,
                min_samples_leaf=2,
                max_features=None,
                class_weight="balanced",
                random_state=42,
                n_jobs=-1,
            ),
            "Gradient Boosting": lambda: GradientBoostingClassifier(
                n_estimators=140,
                learning_rate=0.035,
                max_depth=2,
                min_samples_leaf=3,
                subsample=0.85,
                random_state=42,
            ),
            "Histogram Gradient Boosting": lambda: HistGradientBoostingClassifier(
                max_iter=180,
                learning_rate=0.05,
                max_leaf_nodes=12,
                min_samples_leaf=8,
                l2_regularization=0.5,
                random_state=42,
            ),
            "RBF Support Vector Machine": lambda: make_pipeline(
                StandardScaler(),
                SVC(C=1.0, gamma="scale", probability=True, class_weight="balanced", random_state=42),
            ),
        }
    )


def add_features(frame: pd.DataFrame) -> pd.DataFrame:
    out = frame.copy()
    for feature in RANK_FEATURES:
        season_max = out.groupby("Year")[feature].transform("max").clip(lower=1)
        out[f"{feature} Score"] = ((season_max - out[feature] + 1) / season_max) * 100

    out["Resume Composite"] = out[["SOR Score", "SOS Score"]].mean(axis=1)
    out["Efficiency Composite"] = out[["Offense Score", "Defense Score"]].mean(axis=1)
    out["Power Composite"] = out[["FPI Score", "Game Control Score"]].mean(axis=1)
    out["Balance Score"] = out[["Offense Score", "Defense Score"]].min(axis=1)
    out["Consensus Score"] = out[[f"{feature} Score" for feature in RANK_FEATURES]].mean(axis=1)
    out["Consistency Score"] = 100 - out[[f"{feature} Score" for feature in RANK_FEATURES]].std(axis=1)
    out["Elite Signal Share"] = (out[RANK_FEATURES] <= 5).mean(axis=1) * 100
    out["isChampion"] = (out["Ranking"] == 1).astype(int)
    return out


def fit_model(name: str, train: pd.DataFrame):
    model = model_factories()[name]()
    fit_kwargs = {}
    if name in {"Gradient Boosting", "Histogram Gradient Boosting"}:
        fit_kwargs["sample_weight"] = compute_sample_weight("balanced", train["isChampion"])
    model.fit(train[MODEL_FEATURES], train["isChampion"], **fit_kwargs)
    return model


def normalized_probabilities(model, frame: pd.DataFrame) -> np.ndarray:
    raw = np.clip(model.predict_proba(frame[MODEL_FEATURES])[:, 1], 1e-9, None)
    return raw / raw.sum()


def ranked_season(frame: pd.DataFrame, probabilities: np.ndarray) -> pd.DataFrame:
    out = frame.copy()
    out["championProbability"] = probabilities
    out["predictedRank"] = out["championProbability"].rank(method="first", ascending=False).astype(int)
    return out.sort_values("predictedRank")


def season_metric(year: int, ranked: pd.DataFrame) -> dict:
    champion = ranked.loc[ranked["isChampion"] == 1].iloc[0]
    predicted = ranked.iloc[0]
    probability = float(champion["championProbability"])
    one_hot = ranked["isChampion"].to_numpy(dtype=float)
    probs = ranked["championProbability"].to_numpy(dtype=float)
    rank = int(champion["predictedRank"])
    return {
        "year": int(year),
        "predictedChampion": str(predicted["Team"]),
        "actualChampion": str(champion["Team"]),
        "actualChampionPredictedRank": rank,
        "actualChampionProbability": probability,
        "championNll": -math.log(max(probability, 1e-12)),
        "brierScore": float(np.square(probs - one_hot).sum()),
        "hit": rank == 1,
        "top3": rank <= 3,
        "reciprocalRank": 1 / rank,
    }


def aggregate_metrics(rows: list[dict], labels: list[int], probabilities: list[float]) -> dict:
    return {
        "backtestSeasons": len(rows),
        "top1Rate": float(np.mean([row["hit"] for row in rows])),
        "top3Rate": float(np.mean([row["top3"] for row in rows])),
        "meanChampionRank": float(np.mean([row["actualChampionPredictedRank"] for row in rows])),
        "medianChampionRank": float(np.median([row["actualChampionPredictedRank"] for row in rows])),
        "meanReciprocalRank": float(np.mean([row["reciprocalRank"] for row in rows])),
        "meanChampionProbability": float(np.mean([row["actualChampionProbability"] for row in rows])),
        "meanChampionNll": float(np.mean([row["championNll"] for row in rows])),
        "meanBrierScore": float(np.mean([row["brierScore"] for row in rows])),
        "rocAuc": float(roc_auc_score(labels, probabilities)),
        "averagePrecision": float(average_precision_score(labels, probabilities)),
    }


def evaluate_models(data: pd.DataFrame):
    years = list(range(int(data["Year"].min()) + 1, 2025))
    metric_rows = {name: [] for name in BASE_MODEL_NAMES + [ENSEMBLE_NAME]}
    labels = {name: [] for name in metric_rows}
    probabilities = {name: [] for name in metric_rows}
    predictions = {name: {} for name in metric_rows}

    for year in years:
        train = data[data["Year"] < year]
        test = data[data["Year"] == year]
        base_probabilities = []
        for name in BASE_MODEL_NAMES:
            model = fit_model(name, train)
            probs = normalized_probabilities(model, test)
            ranked = ranked_season(test, probs)
            predictions[name][year] = ranked
            metric_rows[name].append(season_metric(year, ranked))
            labels[name].extend(test["isChampion"].astype(int).tolist())
            probabilities[name].extend(probs.tolist())
            base_probabilities.append(probs)

        ensemble_probs = np.mean(base_probabilities, axis=0)
        ensemble_probs = ensemble_probs / ensemble_probs.sum()
        ranked = ranked_season(test, ensemble_probs)
        predictions[ENSEMBLE_NAME][year] = ranked
        metric_rows[ENSEMBLE_NAME].append(season_metric(year, ranked))
        labels[ENSEMBLE_NAME].extend(test["isChampion"].astype(int).tolist())
        probabilities[ENSEMBLE_NAME].extend(ensemble_probs.tolist())

    metrics = {
        name: aggregate_metrics(metric_rows[name], labels[name], probabilities[name])
        for name in metric_rows
    }
    return metrics, metric_rows, predictions


def holdout_predictions(data: pd.DataFrame):
    train = data[data["Year"] < 2025]
    holdout = data[data["Year"] == 2025]
    fitted = {}
    ranked = {}
    base_probabilities = []
    for name in BASE_MODEL_NAMES:
        fitted[name] = fit_model(name, train)
        probs = normalized_probabilities(fitted[name], holdout)
        ranked[name] = ranked_season(holdout, probs)
        base_probabilities.append(probs)
    ensemble_probs = np.mean(base_probabilities, axis=0)
    ranked[ENSEMBLE_NAME] = ranked_season(holdout, ensemble_probs / ensemble_probs.sum())
    return fitted, ranked


def model_importance(name: str, model, holdout: pd.DataFrame) -> np.ndarray:
    if hasattr(model, "feature_importances_"):
        values = np.asarray(model.feature_importances_, dtype=float)
    elif hasattr(model, "named_steps") and hasattr(model[-1], "coef_"):
        values = np.abs(np.asarray(model[-1].coef_[0], dtype=float))
    else:
        result = permutation_importance(
            model,
            holdout[MODEL_FEATURES],
            holdout["isChampion"],
            scoring="average_precision",
            n_repeats=16,
            random_state=42,
        )
        values = np.clip(result.importances_mean, 0, None)
    total = values.sum()
    return values / total if total else np.repeat(1 / len(values), len(values))


def selected_importance(selected: str, fitted: dict, holdout: pd.DataFrame) -> list[dict]:
    if selected == ENSEMBLE_NAME:
        values = np.mean(
            [model_importance(name, fitted[name], holdout) for name in BASE_MODEL_NAMES],
            axis=0,
        )
    else:
        values = model_importance(selected, fitted[selected], holdout)
    rows = [
        {"feature": feature.replace(" Score", ""), "importance": float(value)}
        for feature, value in zip(MODEL_FEATURES, values)
    ]
    return sorted(rows, key=lambda row: row["importance"], reverse=True)


def json_records(frame: pd.DataFrame) -> list[dict]:
    columns = ["Team", *RANK_FEATURES, "Year", "Ranking", *MODEL_FEATURES, "championProbability", "predictedRank"]
    return json.loads(frame[columns].replace({np.nan: None}).to_json(orient="records"))


def main() -> None:
    payload = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    data = add_features(pd.read_csv(DATASET_PATH))
    metrics, metric_rows, predictions = evaluate_models(data)
    fitted, holdout = holdout_predictions(data)

    model_order = BASE_MODEL_NAMES + [ENSEMBLE_NAME]
    selected = sorted(
        model_order,
        key=lambda name: (
            -metrics[name]["top1Rate"],
            -metrics[name]["top3Rate"],
            -metrics[name]["meanReciprocalRank"],
            metrics[name]["meanChampionNll"],
        ),
    )[0]

    models = []
    for name in model_order:
        ranked = holdout[name]
        holdout_metric = season_metric(2025, ranked)
        models.append(
            {
                "model": name,
                "selected": name == selected,
                "holdoutPick": holdout_metric["predictedChampion"],
                "pickedChampion": holdout_metric["hit"],
                "championProbability": float(ranked.iloc[0]["championProbability"]),
                "holdoutChampionRank": holdout_metric["actualChampionPredictedRank"],
                "holdoutChampionProbability": holdout_metric["actualChampionProbability"],
                "holdoutNll": holdout_metric["championNll"],
                "holdoutBrierScore": holdout_metric["brierScore"],
                **metrics[name],
            }
        )
    models.sort(key=lambda row: (not row["selected"], -row["top1Rate"], row["meanChampionNll"]))

    selected_metrics = metrics[selected]
    payload["meta"]["selectedModel"] = selected
    payload["meta"]["features"] = RANK_FEATURES
    payload["meta"]["engineeredFeatures"] = [feature for feature in MODEL_FEATURES if feature not in [f"{x} Score" for x in RANK_FEATURES]]
    payload["meta"]["datasetMetrics"] = {
        "teamSeasons": int(len(data)),
        "seasons": int(data["Year"].nunique()),
        "teams": int(data["Team"].nunique()),
        "sourceMetrics": len(RANK_FEATURES),
        "engineeredMetrics": len(MODEL_FEATURES) - len(RANK_FEATURES),
        "modelsEvaluated": len(model_order),
    }
    payload["meta"]["modelEvaluation"] = (
        "Forward-season backtest from 2006-2024; each season is predicted only from earlier seasons. "
        "Probabilities are normalized across that season's top 25."
    )
    payload["models"] = models
    payload["featureImportance"] = selected_importance(selected, fitted, data[data["Year"] == 2025])
    payload["backtest"] = metric_rows[selected]
    payload["summary"]["backtestHitRate"] = selected_metrics["top1Rate"]
    payload["summary"]["backtestTop3Rate"] = selected_metrics["top3Rate"]
    payload["summary"]["meanChampionRank"] = selected_metrics["meanChampionRank"]
    payload["summary"]["meanReciprocalRank"] = selected_metrics["meanReciprocalRank"]
    payload["summary"]["meanChampionNll"] = selected_metrics["meanChampionNll"]
    payload["summary"]["meanBrierScore"] = selected_metrics["meanBrierScore"]
    payload["summary"]["rocAuc"] = selected_metrics["rocAuc"]
    payload["summary"]["averagePrecision"] = selected_metrics["averagePrecision"]

    for year in range(2021, 2026):
        ranked = holdout[selected] if year == 2025 else predictions[selected][year]
        champion = ranked.loc[ranked["isChampion"] == 1].iloc[0]
        top = ranked.iloc[0]
        payload["seasonPredictions"][str(year)] = {
            "year": year,
            "predictedChampion": str(top["Team"]),
            "actualChampion": str(champion["Team"]),
            "topProbability": float(top["championProbability"]),
            "actualChampionPredictedRank": int(champion["predictedRank"]),
            "isCurrentSeason": False,
            "records": json_records(ranked),
        }

    selected_2025 = payload["seasonPredictions"]["2025"]
    payload["summary"]["predictedChampion"] = selected_2025["predictedChampion"]
    payload["summary"]["actualChampion"] = selected_2025["actualChampion"]
    payload["summary"]["topProbability"] = selected_2025["topProbability"]
    payload["summary"]["actualChampionPredictedRank"] = selected_2025["actualChampionPredictedRank"]
    payload["results2025"] = selected_2025["records"]

    rendered = json.dumps(payload, indent=2)
    DATA_PATH.write_text(rendered, encoding="utf-8")
    PUBLIC_DATA_PATH.write_text(rendered, encoding="utf-8")
    print(selected)
    for row in models:
        print(row["model"], f"top1={row['top1Rate']:.3f}", f"top3={row['top3Rate']:.3f}", f"rank={row['meanChampionRank']:.2f}")


if __name__ == "__main__":
    main()
