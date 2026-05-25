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
- `data/app-data.json` - trained model outputs and season prediction records
- `data/cfb_top25_2005_2025.csv` - augmented top-25 dataset

## Model

The app uses offline-trained model outputs from the source CFB dataset plus 2025 final-season metrics. The selected model is Gradient Boosting, trained on prior seasons and displayed with holdout/backtest context in the dashboard.
