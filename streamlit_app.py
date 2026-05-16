from __future__ import annotations

import json
from pathlib import Path

import altair as alt
import pandas as pd
import streamlit as st


APP_DIR = Path(__file__).parent
DATA_PATH = APP_DIR / "data" / "app-data.json"
SEASONS = ["2025", "2024", "2023", "2022", "2021"]


@st.cache_data
def load_data() -> dict:
    with DATA_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


def pct(value: float) -> str:
    return f"{value * 100:.1f}%"


def season_frame(payload: dict, year: str) -> pd.DataFrame:
    frame = pd.DataFrame(payload["seasonPredictions"][year]["records"])
    frame["Champion Probability"] = frame["championProbability"] * 100
    return frame


def probability_chart(frame: pd.DataFrame) -> alt.Chart:
    top = frame.sort_values("predictedRank").head(10)
    return (
        alt.Chart(top)
        .mark_bar(cornerRadiusTopRight=4, cornerRadiusBottomRight=4)
        .encode(
            y=alt.Y("Team:N", sort=list(top["Team"]), title=None),
            x=alt.X("Champion Probability:Q", title="Champion probability (%)"),
            color=alt.condition(
                alt.datum.Ranking == 1,
                alt.value("#22735f"),
                alt.value("#2f72b7"),
            ),
            tooltip=[
                "predictedRank:Q",
                "Team:N",
                alt.Tooltip("Champion Probability:Q", format=".1f"),
                "Ranking:Q",
            ],
        )
        .properties(height=330)
    )


def feature_chart(payload: dict) -> alt.Chart:
    frame = pd.DataFrame(payload["featureImportance"])
    return (
        alt.Chart(frame)
        .mark_bar(cornerRadiusTopRight=4, cornerRadiusBottomRight=4)
        .encode(
            y=alt.Y("feature:N", sort="-x", title=None),
            x=alt.X("importance:Q", title="Permutation importance"),
            color=alt.value("#163449"),
            tooltip=["feature:N", alt.Tooltip("importance:Q", format=".4f")],
        )
        .properties(height=230)
    )


def backtest_chart(payload: dict, selected_year: str) -> alt.Chart:
    frame = pd.DataFrame(payload["backtest"])
    frame["selected"] = frame["year"].astype(str) == selected_year
    return (
        alt.Chart(frame)
        .mark_line(point=False, color="#2f72b7", strokeWidth=3)
        .encode(
            x=alt.X("year:O", title="Season"),
            y=alt.Y("actualChampionPredictedRank:Q", title="Actual champion projected rank", scale=alt.Scale(reverse=True)),
            tooltip=[
                "year:O",
                "predictedChampion:N",
                "actualChampion:N",
                "actualChampionPredictedRank:Q",
                "hit:N",
            ],
        )
        + alt.Chart(frame)
        .mark_circle(size=90)
        .encode(
            x="year:O",
            y="actualChampionPredictedRank:Q",
            color=alt.condition("datum.selected", alt.value("#d4a017"), alt.value("#22735f")),
            tooltip=["year:O", "actualChampion:N", "actualChampionPredictedRank:Q"],
        )
    ).properties(height=300)


def model_comparison(payload: dict) -> pd.DataFrame:
    frame = pd.DataFrame(payload["models"])
    frame["Top Probability"] = frame["championProbability"].map(pct)
    frame["Picked Champion"] = frame["pickedChampion"].map(lambda value: "Yes" if value else "No")
    return frame[["model", "holdoutPick", "Top Probability", "holdoutLogLoss", "Picked Champion"]].rename(
        columns={
            "model": "Model",
            "holdoutPick": "2025 Pick",
            "holdoutLogLoss": "Holdout Log Loss",
        }
    )


def main() -> None:
    st.set_page_config(page_title="NCAAF Champion ML Predictor", layout="wide")
    payload = load_data()
    selected_year = st.sidebar.radio("Season", SEASONS, index=0)
    season = payload["seasonPredictions"][selected_year]
    frame = season_frame(payload, selected_year)

    st.sidebar.markdown("### Model")
    st.sidebar.write(payload["meta"]["selectedModel"])
    st.sidebar.markdown("### Data")
    st.sidebar.write("Top-25 seasons: 2005-2025")

    st.title("NCAAF Champion ML Predictor")
    st.caption("Machine-learning champion prediction pages for 2025, 2024, 2023, 2022, and 2021.")

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Predicted Champion", season["predictedChampion"], pct(season["topProbability"]))
    c2.metric("Actual Champion", season["actualChampion"], f"Projected rank {season['actualChampionPredictedRank']}")
    c3.metric("Backtest Hit Rate", pct(payload["summary"]["backtestHitRate"]))
    c4.metric("Top-3 Champ Coverage", pct(payload["summary"]["backtestTop3Rate"]))

    chart_col, feature_col = st.columns([1.6, 1])
    with chart_col:
        st.subheader(f"{selected_year} Top 10 Champion Probability")
        st.altair_chart(probability_chart(frame), use_container_width=True)
    with feature_col:
        st.subheader("Feature Importance")
        st.altair_chart(feature_chart(payload), use_container_width=True)

    st.subheader("Prediction Table")
    query = st.text_input("Search team", "")
    sort_mode = st.selectbox(
        "Sort table",
        ["predictedRank", "Ranking", "championProbability", "FPI"],
        format_func={
            "predictedRank": "Predicted rank",
            "Ranking": "Final AP rank",
            "championProbability": "ML probability",
            "FPI": "FPI rank",
        }.get,
    )
    display = frame[frame["Team"].str.contains(query, case=False, na=False)].copy()
    ascending = sort_mode != "championProbability"
    display = display.sort_values(sort_mode, ascending=ascending)
    display["Champion Probability"] = display["championProbability"].map(pct)
    st.dataframe(
        display[
            [
                "predictedRank",
                "Team",
                "Champion Probability",
                "Ranking",
                "SOR",
                "SOS",
                "Offense",
                "Defense",
                "FPI",
                "Game Control",
            ]
        ].rename(
            columns={
                "predictedRank": "Pred",
                "Ranking": "Final AP",
            }
        ),
        use_container_width=True,
        hide_index=True,
    )

    backtest_col, model_col = st.columns([1.4, 1])
    with backtest_col:
        st.subheader("Actual Champion Projected Rank by Year")
        st.altair_chart(backtest_chart(payload, selected_year), use_container_width=True)
    with model_col:
        st.subheader("Model Comparison")
        st.dataframe(model_comparison(payload), use_container_width=True, hide_index=True)

    st.subheader("Sources")
    for source in payload["meta"]["sources"]:
        st.markdown(f"- [{source['label']}]({source['url']}) - {source['note']}")


if __name__ == "__main__":
    main()
