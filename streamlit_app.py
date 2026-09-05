from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from urllib.request import Request, urlopen

import altair as alt
import pandas as pd
import streamlit as st


APP_DIR = Path(__file__).parent
DATA_PATH = APP_DIR / "data" / "app-data.json"
SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=100"
CORE_EVENTS_URL = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events"
TEAM_LOGO_IDS = {
    "Alabama": 333,
    "Arizona": 12,
    "BYU": 252,
    "Clemson": 228,
    "Florida State": 52,
    "Georgia": 61,
    "Georgia Tech": 59,
    "Houston": 248,
    "Indiana": 84,
    "Iowa": 2294,
    "LSU": 99,
    "Miami": 2390,
    "Michigan": 130,
    "Missouri": 142,
    "Notre Dame": 87,
    "Ohio State": 194,
    "Oklahoma": 201,
    "Ole Miss": 145,
    "Oregon": 2483,
    "Penn State": 213,
    "TCU": 2628,
    "Tennessee": 2633,
    "Texas": 251,
    "Texas A&M": 245,
    "Texas Tech": 2641,
    "USC": 30,
    "Utah": 254,
    "Washington": 264,
}


@st.cache_data
def load_data() -> dict:
    with DATA_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


@st.cache_data(ttl=60)
def fetch_json(url: str) -> dict:
    request = Request(url.replace("http://", "https://"), headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


@st.cache_data(ttl=60)
def load_scores() -> list[dict]:
    try:
        payload = fetch_json(SCOREBOARD_URL)
    except Exception:
        return load_core_scores()
    games = []
    for event in payload.get("events", []):
        competition = (event.get("competitions") or [{}])[0]
        competitors = []
        for competitor in competition.get("competitors", []):
            rank = (competitor.get("curatedRank") or {}).get("current")
            competitors.append(
                {
                    "homeAway": competitor.get("homeAway"),
                    "Team": (competitor.get("team") or {}).get("shortDisplayName") or (competitor.get("team") or {}).get("displayName"),
                    "Rank": rank if rank and rank < 99 else None,
                    "Score": competitor.get("score") or "-",
                }
            )
        games.append(
            {
                "Status": ((event.get("status") or {}).get("type") or {}).get("shortDetail"),
                "Game": event.get("shortName"),
                "Venue": (competition.get("venue") or {}).get("fullName"),
                "Broadcast": ", ".join(((competition.get("broadcasts") or [{}])[0]).get("names", [])),
                "competitors": competitors,
            }
        )
    return games


def load_core_scores() -> list[dict]:
    today = date.today().strftime("%Y%m%d")
    payload = fetch_json(f"{CORE_EVENTS_URL}?dates={today}&limit=100")
    games = []
    for item in payload.get("items", []):
        event = fetch_json(item["$ref"])
        competition = (event.get("competitions") or [{}])[0]
        status = fetch_json(competition["status"]["$ref"]) if competition.get("status") else {}
        competitors = []
        for competitor in competition.get("competitors", []):
            team = fetch_json(competitor["team"]["$ref"]) if competitor.get("team") else {}
            score = fetch_json(competitor["score"]["$ref"]) if competitor.get("score") else {}
            rank = (competitor.get("curatedRank") or {}).get("current")
            competitors.append(
                {
                    "homeAway": competitor.get("homeAway"),
                    "Team": team.get("shortDisplayName") or team.get("displayName"),
                    "Rank": rank if rank and rank < 99 else None,
                    "Score": score.get("displayValue", "-"),
                }
            )
        games.append(
            {
                "Status": ((status.get("type") or {}).get("shortDetail")),
                "Game": event.get("shortName"),
                "Venue": (competition.get("venue") or {}).get("fullName"),
                "Broadcast": "",
                "competitors": competitors,
            }
        )
    return games


def pct(value: float | None) -> str:
    if value is None or pd.isna(value):
        return "-"
    return f"{value * 100:.1f}%"


def logo_url(team: str) -> str:
    team_id = TEAM_LOGO_IDS.get(team)
    return f"https://a.espncdn.com/i/teamlogos/ncaa/500/{team_id}.png" if team_id else ""


def season_frame(payload: dict, year: str) -> pd.DataFrame:
    frame = pd.DataFrame(payload["seasonPredictions"][year]["records"])
    frame["Champion Probability"] = frame["championProbability"] * 100
    if "Ranking" not in frame and "CFP" in frame:
        frame["Ranking"] = frame["CFP"]
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


def weekly_chart(payload: dict, selected_year: str, weekly_model: str) -> alt.Chart:
    frame = pd.DataFrame(payload.get("weeklyPredictions", {}).get(selected_year, []))
    if frame.empty:
        return alt.Chart(pd.DataFrame({"week": [], "predictedChampion": [], "predictedProbabilityPct": []}))
    model_rows = []
    for row in payload.get("weeklyPredictions", {}).get(selected_year, []):
        selected = next(
            (prediction for prediction in row.get("modelPredictions", []) if prediction["model"] == weekly_model),
            row,
        )
        model_rows.append(
            {
                **row,
                "predictedChampion": selected["predictedChampion"],
                "predictedProbability": selected["predictedProbability"],
                "actualChampionPredictedRank": selected.get("actualChampionPredictedRank"),
            }
        )
    frame = pd.DataFrame(model_rows)
    frame["predictedProbabilityPct"] = frame["predictedProbability"] * 100
    frame["pickedActualChampion"] = frame["predictedChampion"] == frame["actualChampion"]
    frame["logoUrl"] = frame["predictedChampion"].map(logo_url)
    base = alt.Chart(frame).encode(
        x=alt.X("week:O", title="Week"),
        y=alt.Y("predictedProbabilityPct:Q", title="Predicted winner probability (%)"),
        tooltip=[
            "week:O",
            "predictedChampion:N",
            alt.Tooltip("predictedProbabilityPct:Q", format=".1f"),
            "actualChampion:N",
            "actualChampionPredictedRank:Q",
        ],
    )
    line = base.mark_line(color="#2f72b7", strokeWidth=3)
    labels = base.mark_text(dy=-28, fontSize=11, fontWeight="bold", color="#163449").encode(
        text=alt.Text("predictedProbabilityPct:Q", format=".1f")
    )
    logos = (
        alt.Chart(frame)
        .mark_image(width=34, height=34)
        .encode(
            x=alt.X("week:O", title="Week"),
            y=alt.Y("predictedProbabilityPct:Q", title="Predicted winner probability (%)"),
            url="logoUrl:N",
            tooltip=["week:O", "predictedChampion:N", alt.Tooltip("predictedProbabilityPct:Q", format=".1f")],
        )
    )
    teams = base.mark_text(dy=30, fontSize=10, color="#60707c").encode(text="predictedChampion:N")
    return (line + logos + labels + teams).properties(height=390)


def weekly_table(payload: dict, selected_year: str, weekly_model: str) -> pd.DataFrame:
    model_rows = []
    for row in payload.get("weeklyPredictions", {}).get(selected_year, []):
        selected = next(
            (prediction for prediction in row.get("modelPredictions", []) if prediction["model"] == weekly_model),
            row,
        )
        model_rows.append(
            {
                **row,
                "predictedChampion": selected["predictedChampion"],
                "predictedProbability": selected["predictedProbability"],
                "actualChampionPredictedRank": selected.get("actualChampionPredictedRank"),
            }
        )
    frame = pd.DataFrame(model_rows)
    if frame.empty:
        return frame
    frame["Probability"] = frame["predictedProbability"].map(pct)
    frame["Actual Champ Rank"] = frame["actualChampionPredictedRank"].fillna("Not in snapshot")
    return frame[["week", "predictedChampion", "Probability", "actualChampion", "Actual Champ Rank"]].rename(
        columns={
            "week": "Week",
            "predictedChampion": "Predicted Winner",
            "actualChampion": "Actual Champion",
        }
    )


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


def render_live_scores() -> None:
    st.subheader("College Football Scores")
    try:
        games = load_scores()
    except Exception:
        st.info("Live scores are unavailable right now. Try refreshing again in a minute.")
        return
    if not games:
        st.info("No FBS games found for today.")
        return
    cols = st.columns(3)
    for index, game in enumerate(games):
        with cols[index % 3]:
            st.markdown(f"**{game['Game']}**")
            st.caption(" - ".join(item for item in [game.get("Status"), game.get("Broadcast"), game.get("Venue")] if item))
            for team in game["competitors"]:
                label = f"{int(team['Rank'])} {team['Team']}" if team.get("Rank") else team["Team"]
                st.metric(label, team["Score"])


def main() -> None:
    st.set_page_config(page_title="NCAAF Champion ML Predictor", layout="wide")
    payload = load_data()
    seasons = sorted(payload["seasonPredictions"].keys(), key=int, reverse=True)
    default_year = str(payload["meta"].get("currentSeason", seasons[0]))
    selected_year = st.sidebar.radio("Season", seasons, index=seasons.index(default_year) if default_year in seasons else 0)
    season = payload["seasonPredictions"][selected_year]
    frame = season_frame(payload, selected_year)
    is_current_season = season.get("isCurrentSeason", False)

    st.sidebar.markdown("### Model")
    st.sidebar.write(payload["meta"]["selectedModel"])
    weekly_model = st.sidebar.selectbox("Weekly model", payload["meta"].get("weeklyModels", ["Balanced ML Blend"]))
    st.sidebar.markdown("### Data")
    st.sidebar.write("Top-25 seasons: 2005-2025")

    st.title("NCAAF Champion ML Predictor")
    st.caption("Machine-learning champion predictions for historical champions plus the current season's weekly snapshots.")

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Predicted Champion", season["predictedChampion"], pct(season["topProbability"]))
    actual_delta = f"Through week {season.get('latestWeek')}" if is_current_season else f"Projected rank {season['actualChampionPredictedRank']}"
    c2.metric("Actual Champion", season["actualChampion"], actual_delta)
    c3.metric("Backtest Hit Rate", pct(payload["summary"]["backtestHitRate"]))
    c4.metric("Top-3 Champ Coverage", pct(payload["summary"]["backtestTop3Rate"]))

    chart_col, feature_col = st.columns([1.6, 1])
    with chart_col:
        st.subheader(f"{selected_year} Top 10 Champion Probability")
        st.altair_chart(probability_chart(frame), use_container_width=True)
    with feature_col:
        st.subheader("Feature Importance")
        st.altair_chart(feature_chart(payload), use_container_width=True)

    st.subheader(f"{selected_year} Week-by-Week Predicted Winner")
    st.caption(payload["meta"].get("weeklySourceNote", "Weekly predictions use ESPN playoff-picture snapshots."))
    weekly_col, weekly_table_col = st.columns([1.4, 1])
    with weekly_col:
        st.altair_chart(weekly_chart(payload, selected_year, weekly_model), use_container_width=True)
    with weekly_table_col:
        table = weekly_table(payload, selected_year, weekly_model)
        if table.empty:
            st.info("No weekly snapshots available for this season.")
        else:
            st.dataframe(table, use_container_width=True, hide_index=True)

    render_live_scores()

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
    if sort_mode in display:
        display = display.sort_values(sort_mode, ascending=ascending)
    display["Champion Probability"] = display["championProbability"].map(pct)
    columns = [
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
    st.dataframe(
        display.reindex(columns=columns).rename(
            columns={
                "predictedRank": "Pred",
                "Ranking": "Final AP / CFP",
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
