# NCAAF Champion ML Predictor

Static and Streamlit web app for exploring machine-learning champion predictions. The static dashboard includes weekly history from 2014 forward, 16 weekly models and baselines, calibrated game probabilities, era-aware CFP selection models, opponent-adjusted play efficiency, forecast uncertainty, team dossiers, historical replay, weekly reports, a model laboratory, a rules-aware interactive playoff bracket, live scores with in-game win probability, and a Decision Center for explanations, conference races, availability, scenarios, alerts, drift, provenance, and API access.

## Run locally

### Static app

```bash
python -m http.server 8765 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:8765/
```

### Streamlit app

```bash
pip install -r requirements.txt
streamlit run streamlit_app.py
```

## Deploy on Streamlit Cloud

1. Connect Streamlit Cloud to this GitHub repository.
2. Set the app entrypoint to `streamlit_app.py`.
3. Keep `requirements.txt` in the repository root so Streamlit installs `streamlit`, `pandas`, and `altair`.
4. Deploy from the `main` branch.

## Contents

- `index.html` - app shell
- `styles.css` - dashboard styling
- `app.js` - routed dashboard views, reports, replay, team dossiers, cloud watchlists, schedule simulation, interactive bracket, model lab, Decision Center, shareable scenarios, preferences, charts, exports, search, and sorting
- `streamlit_app.py` - Streamlit Cloud entrypoint
- `requirements.txt` - Streamlit dependencies
- `build_weekly_predictions.py` - freezes completed weekly snapshots, refreshes the provisional week, builds the pregame feature store, trains weekly/game/selection models without look-ahead, calibrates game probabilities, derives opponent-adjusted play metrics, and produces diagnostics
- `train_models.py` - reproducible seven-model training, forward-season backtesting, and dashboard data refresh
- `data/app-data.json` - trained model outputs and season prediction records
- `data/app-core.json` and `data/weekly-*.json` - performance-oriented core and lazy-loaded weekly shards
- `data/game-history.json` - cached ESPN game history used by the forward-season win-probability model
- `data/play-metrics-cache.json` - cached play-by-play aggregates used for current efficiency metrics
- `data/pregame-feature-store.json` - immutable, prior-information-only game features with source and schema hashes
- `data/cfb_top25_2005_2025.csv` - augmented top-25 dataset
- `scripts/validate-data.mjs` - release gate for provenance, leakage controls, calibration, selection-model, schedule, and metric coverage
- `drizzle/` - immutable Sites D1 migrations for account/device watchlists, scenarios, preferences, and alert events

## Model

The app compares logistic regression, random forest, extra trees, gradient boosting, histogram gradient boosting, an RBF support vector machine, and a soft-voting ensemble. Models use six source rankings plus engineered resume, efficiency, power, balance, consensus, consistency, and elite-signal metrics. Selection is based on forward-season backtesting, and the dashboard reports top-1/top-3 coverage, champion rank, reciprocal rank, negative log likelihood, Brier score, ROC AUC, and average precision.

The weekly pipeline separately trains logistic regression, Gaussian naive Bayes, nearest-neighbor, ridge-probability, Bayesian logistic, Elo, and a forward-season stacker from prior completed seasons. It also benchmarks six weighted blends plus AP and FPI baselines. Their expanded ensemble powers the current weekly ranking. The level-two stacker only sees out-of-fold predictions produced by models trained on earlier seasons. Historical diagnostics exclude seasons with no earlier training data. Prior weeks become immutable as soon as a newer week is captured; the latest week remains provisional so in-week ESPN changes can be incorporated.

The game model is a standardized logistic regression trained on 2014-2025 results with Elo, poll, record, recent-margin, home-field, and conference-game signals. Forward-season out-of-fold predictions fit a Platt probability calibrator, and the dashboard reports reliability bins alongside raw and calibrated Brier scores. The CFP selection model uses true final CFP rankings, with separate four-team (2014-2023) and 12-team (2024 onward) eras. Features come from an earlier weekly snapshot than the final ranking label. Current ESPN play-by-play is converted into estimated EPA per play, success rate, explosiveness, early-down success, havoc, finishing-drives, and opponent-adjusted efficiency with garbage-time filtering.

The season simulator uses the current ESPN FBS schedule, calibrated game probabilities, completed records, the learned selection score, and conference identifiers. It models the 2026 12-team format with five conference-champion automatic bids, the Notre Dame top-12 guarantee, seven at-large positions when applicable, four first-round byes, and the fixed playoff bracket. Users can lock schedule outcomes and select winners in each playoff round, then save or share the encoded scenario. Availability adjustments are deliberately neutral when a stable, attributable roster feed is unavailable; the dashboard never silently invents an injury adjustment. It is a scenario engine, not a betting market.

## Decision Center and API

The Decision Center explains each team's week-over-week probability movement across poll, resume, efficiency, opponent, and model-consensus effects. It also shows current conference-title races and tiebreaker evidence, roster-feed confidence, model-drift thresholds, saved scenarios, personal alert preferences, and end-to-end data lineage.

The Worker exposes read-only, versioned JSON endpoints:

```text
GET /api/v1
GET /api/v1/forecast?season=2026&week=7&limit=25
GET /api/v1/rankings?season=2026&week=7&limit=25&model=Weekly%20ML%20Ensemble
GET /api/v1/teams/Georgia?season=2026&week=7
GET /api/v1/weekly-report?season=2026&week=7
GET /api/v1/models?season=2026&week=7
GET /api/v1/conference-races?season=2026&week=7
GET /api/v1/health
```

Same-origin storage routes persist watchlists, scenarios, preferences, and alert acknowledgements. They scope records to the authenticated Sites account when available and otherwise use a device identifier.

## Sites deployment

The Sites worker serves the static build, proxies live ESPN scores, computes contextual live win probability, and persists watchlists through the logical D1 binding `DB`. The release archive includes `.openai/hosting.json` and the Drizzle migration automatically.

```bash
npm run check:data
npm run build
node scripts/create-sites-server.mjs
```

Run `npm run check:data` before publishing. It fails when the pregame store, feature provenance, calibration diagnostics, selection model, opponent-adjusted metrics, current schedule, or weekly report is missing.

Regenerate the model outputs with:

```bash
python train_models.py
python enrich_weekly_models.py
python build_weekly_predictions.py
```
