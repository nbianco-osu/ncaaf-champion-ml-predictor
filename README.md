# NCAAF Champion ML Predictor

Static and Streamlit web app for exploring machine-learning champion predictions. The static dashboard includes weekly history from 2014 forward, 13 weekly models and baselines, a historical game win-probability model, play-level efficiency estimates, forecast uncertainty, team dossiers, a rules-aware playoff simulator, multi-game scenarios, browser alerts, live scores, prediction changelogs, exports, and pipeline health.

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
- `app.js` - routed dashboard views, team dossiers, watchlists, schedule simulation, scenarios, research, charts, exports, search, and sorting
- `streamlit_app.py` - Streamlit Cloud entrypoint
- `requirements.txt` - Streamlit dependencies
- `build_weekly_predictions.py` - freezes completed weekly snapshots, refreshes the provisional week, trains weekly and game models without look-ahead, derives play-level metrics, and produces diagnostics
- `train_models.py` - reproducible seven-model training, forward-season backtesting, and dashboard data refresh
- `data/app-data.json` - trained model outputs and season prediction records
- `data/app-core.json` and `data/weekly-*.json` - performance-oriented core and lazy-loaded weekly shards
- `data/game-history.json` - cached ESPN game history used by the forward-season win-probability model
- `data/play-metrics-cache.json` - cached play-by-play aggregates used for current efficiency metrics
- `data/cfb_top25_2005_2025.csv` - augmented top-25 dataset

## Model

The app compares logistic regression, random forest, extra trees, gradient boosting, histogram gradient boosting, an RBF support vector machine, and a soft-voting ensemble. Models use six source rankings plus engineered resume, efficiency, power, balance, consensus, consistency, and elite-signal metrics. Selection is based on forward-season backtesting, and the dashboard reports top-1/top-3 coverage, champion rank, reciprocal rank, negative log likelihood, Brier score, ROC AUC, and average precision.

The weekly pipeline separately trains logistic regression, Gaussian naive Bayes, nearest-neighbor, and ridge-probability models from prior completed seasons. It also benchmarks six weighted blends plus AP and FPI baselines. Their ensemble powers the current weekly ranking. Historical diagnostics exclude seasons with no earlier training data. Prior weeks become immutable as soon as a newer week is captured; the latest week remains provisional so in-week ESPN changes can be incorporated.

The game model is a standardized logistic regression trained on 2014-2025 results with Elo, poll, record, recent-margin, home-field, and conference-game signals. Forward-season validation reports accuracy, Brier score, and log loss. Current ESPN play-by-play is converted into estimated EPA per play, success rate, explosiveness, early-down success, havoc, and finishing-drives metrics with garbage-time filtering.

The season simulator uses the current ESPN FBS schedule, trained game probabilities, completed records, and conference identifiers. It models the 2026 12-team format with five conference-champion automatic bids, the Notre Dame top-12 guarantee, seven at-large positions when applicable, four first-round byes, and the fixed playoff bracket. It is a scenario engine, not a betting market or injury-adjusted forecast.

Regenerate the model outputs with:

```bash
python train_models.py
python enrich_weekly_models.py
python build_weekly_predictions.py
```
