# NCAAF Champion ML Predictor

Static web app for exploring machine-learning champion predictions for the last five national champion seasons: 2025, 2024, 2023, 2022, and 2021.

## Run locally

```bash
python -m http.server 8765 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:8765/
```

## Contents

- `index.html` - app shell
- `styles.css` - dashboard styling
- `app.js` - season navigation, charts, search, and sorting
- `data/app-data.json` - trained model outputs and season prediction records
- `data/cfb_top25_2005_2025.csv` - augmented top-25 dataset

## Model

The app uses offline-trained model outputs from the source CFB dataset plus 2025 final-season metrics. The selected model is Gradient Boosting, trained on prior seasons and displayed with holdout/backtest context in the dashboard.
