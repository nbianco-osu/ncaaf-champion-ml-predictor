# NCAAF Champion ML Predictor

Static and Streamlit web app for exploring machine-learning champion predictions for the last five national champion seasons: 2025, 2024, 2023, 2022, and 2021. The app also includes week-by-week predicted winners through each season using ESPN playoff-picture snapshots, plotted as team logos by week and model probability.

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
- `app.js` - season navigation, charts, search, and sorting
- `streamlit_app.py` - Streamlit Cloud entrypoint
- `requirements.txt` - Streamlit dependencies
- `build_weekly_predictions.py` - utility script that refreshes weekly prediction snapshots
- `train_models.py` - reproducible seven-model training, forward-season backtesting, and dashboard data refresh
- `data/app-data.json` - trained model outputs and season prediction records
- `data/cfb_top25_2005_2025.csv` - augmented top-25 dataset

## Model

The app compares logistic regression, random forest, extra trees, gradient boosting, histogram gradient boosting, an RBF support vector machine, and a soft-voting ensemble. Models use six source rankings plus engineered resume, efficiency, power, balance, consensus, consistency, and elite-signal metrics. Selection is based on forward-season backtesting, and the dashboard reports top-1/top-3 coverage, champion rank, reciprocal rank, negative log likelihood, Brier score, ROC AUC, and average precision.

Regenerate the model outputs with:

```bash
python train_models.py
python enrich_weekly_models.py
```
