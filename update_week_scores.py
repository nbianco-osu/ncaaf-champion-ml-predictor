from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen


APP_DIR = Path(__file__).parent
DATA_PATH = APP_DIR / "data" / "app-data.json"
PUBLIC_DATA_PATH = APP_DIR / "public" / "data" / "app-data.json"
CORE_WEEK_EVENTS_URL = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/{year}/types/2/weeks/{week}/events?limit=300"


def https_ref(value: str) -> str:
    return value.replace("http://", "https://")


def fetch_json(url: str) -> dict:
    request = Request(https_ref(url), headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def get_nested(record: dict, *keys: str):
    value = record
    for key in keys:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def normalize_competitor(competitor: dict) -> dict:
    team = fetch_json(get_nested(competitor, "team", "$ref")) if get_nested(competitor, "team", "$ref") else {}
    score = fetch_json(get_nested(competitor, "score", "$ref")) if get_nested(competitor, "score", "$ref") else {}
    rank = get_nested(competitor, "curatedRank", "current")
    logos = team.get("logos") or []
    return {
        "homeAway": competitor.get("homeAway"),
        "teamId": competitor.get("id") or team.get("id"),
        "team": team.get("displayName") or team.get("name"),
        "shortName": team.get("shortDisplayName") or team.get("abbreviation") or team.get("displayName"),
        "abbreviation": team.get("abbreviation"),
        "rank": rank if rank and rank < 99 else None,
        "score": score.get("displayValue"),
        "scoreValue": score.get("value"),
        "winner": competitor.get("winner"),
        "logo": logos[0].get("href") if logos else None,
    }


def normalize_event(event_ref: dict) -> dict:
    event = fetch_json(event_ref["$ref"])
    competition = (event.get("competitions") or [{}])[0]
    status = fetch_json(get_nested(competition, "status", "$ref")) if get_nested(competition, "status", "$ref") else {}
    competitors = [normalize_competitor(competitor) for competitor in competition.get("competitors", [])]
    competitors = sorted(competitors, key=lambda item: 0 if item.get("homeAway") == "away" else 1)
    return {
        "id": event.get("id"),
        "name": event.get("name"),
        "shortName": event.get("shortName"),
        "date": event.get("date"),
        "statusType": get_nested(status, "type", "name"),
        "statusDetail": get_nested(status, "type", "detail"),
        "statusShort": get_nested(status, "type", "shortDetail"),
        "completed": bool(get_nested(status, "type", "completed")),
        "period": status.get("period"),
        "clock": status.get("displayClock"),
        "venue": get_nested(competition, "venue", "fullName"),
        "competitors": competitors,
    }


def update_scores(year: int, week: int) -> dict:
    payload = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    week_url = CORE_WEEK_EVENTS_URL.format(year=year, week=week)
    events = fetch_json(week_url)
    games = [normalize_event(item) for item in events.get("items", [])]
    snapshot = {
        "year": year,
        "seasonType": 2,
        "week": week,
        "source": week_url,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "gameCount": len(games),
        "completedGameCount": sum(1 for game in games if game.get("completed")),
        "games": games,
    }
    payload.setdefault("scoreSnapshots", {}).setdefault(str(year), {})[str(week)] = snapshot
    rendered = json.dumps(payload, indent=2)
    DATA_PATH.write_text(rendered, encoding="utf-8")
    PUBLIC_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_DATA_PATH.write_text(rendered, encoding="utf-8")
    return snapshot


def main() -> None:
    snapshot = update_scores(year=2026, week=1)
    print(f"Updated {snapshot['year']} week {snapshot['week']}: {snapshot['gameCount']} games, {snapshot['completedGameCount']} completed")


if __name__ == "__main__":
    main()
