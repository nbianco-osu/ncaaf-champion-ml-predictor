# NCAAF Champion ML Predictor

Static and Streamlit web app for exploring machine-learning champion predictions. The static dashboard now includes weekly history from 2014 forward, 13 weekly models and baselines, forecast uncertainty, week-level evaluation, game-form metrics, a schedule-aware Monte Carlo playoff simulator, browser-local watchlists and alerts, live scores, and pipeline health.

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
- `app.js` - routed dashboard views, watchlists, uncertainty, schedule simulation, research, charts, search, and sorting
- `streamlit_app.py` - Streamlit Cloud entrypoint
- `requirements.txt` - Streamlit dependencies
- `build_weekly_predictions.py` - freezes completed weekly snapshots, refreshes the provisional week, trains weekly models without look-ahead, and produces diagnostics
- `train_models.py` - reproducible seven-model training, forward-season backtesting, and dashboard data refresh
- `data/app-data.json` - trained model outputs and season prediction records
- `data/app-core.json` and `data/weekly-*.json` - performance-oriented core and lazy-loaded weekly shards
- `data/cfb_top25_2005_2025.csv` - augmented top-25 dataset

## Model

The app compares logistic regression, random forest, extra trees, gradient boosting, histogram gradient boosting, an RBF support vector machine, and a soft-voting ensemble. Models use six source rankings plus engineered resume, efficiency, power, balance, consensus, consistency, and elite-signal metrics. Selection is based on forward-season backtesting, and the dashboard reports top-1/top-3 coverage, champion rank, reciprocal rank, negative log likelihood, Brier score, ROC AUC, and average precision.

The weekly pipeline separately trains logistic regression, Gaussian naive Bayes, nearest-neighbor, and ridge-probability models from prior completed seasons. It also benchmarks six weighted blends plus AP and FPI baselines. Their ensemble powers the current weekly ranking. Historical diagnostics exclude seasons with no earlier training data. Prior weeks become immutable as soon as a newer week is captured; the latest week remains provisional so in-week ESPN changes can be incorporated.

The season simulator uses the current ESPN FBS schedule, completed records, conference identifiers, and model strength to simulate remaining games, conference races, 12-team selection, and the playoff bracket. It is a scenario engine, not a betting market or injury-adjusted forecast.

Regenerate the model outputs with:

```bash
python train_models.py
python enrich_weekly_models.py
python build_weekly_predictions.py
```
