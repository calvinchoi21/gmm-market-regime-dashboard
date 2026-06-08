# Market Regime Dashboard

A production Bloomberg-dark dashboard for detecting market regimes using Gaussian Mixture Models (GMM) and running a dynamic sector rotation strategy.

**Live data** from Yahoo Finance + FRED, refreshed daily. No waiting on load — data is cached and served instantly.

## Features

- **Live regime detection** — current market regime with GMM confidence %
- **Macro snapshot** — VIX, RSI, yield curves, SMA ratio updated daily
- **Portfolio tracker** — $100K GMM strategy vs. S&P 500 from 2000 to today (adjustable capital)
- **Regime timeline** — color-coded regime bands across 25 years with S&P 500 overlay toggle
- **Sector allocation donut** — current portfolio weights based on detected regime
- **Sharpe ratio heatmap** — risk-adjusted sector performance by regime
- **Regime profiles** — historical frequency and macro characteristics of all 5 regimes

## Local Setup

```bash
# 1. Clone the repo
git clone https://github.com/calvinchoi21/market-regime-dashboard
cd market-regime-dashboard

# 2. Create virtual environment
py -3.11 -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Mac/Linux

# 3. Install dependencies
pip install -r requirements.txt

# 4. Set your FRED API key
# Create a .env file (or set env var directly):
# FRED_API_KEY=your_key_here

# 5. Run
set FRED_API_KEY=your_key_here   # Windows
# export FRED_API_KEY=your_key_here  # Mac/Linux

python app.py
```

Open http://localhost:5000

> **First run:** The app will automatically kick off the GMM pipeline in the background (~60 seconds). The page will show a loading indicator until the cache is populated.

## Deployment on Render

1. Push to GitHub
2. Create a new **Web Service** on [render.com](https://render.com)
3. Connect the repo
4. Set **Build Command**: `pip install -r requirements.txt`
5. Set **Start Command**: `gunicorn app:app --workers 1 --timeout 120 --bind 0.0.0.0:$PORT`
6. Add **Environment Variable**: `FRED_API_KEY` = your key
7. Deploy

> **Note:** On Render's free tier, the first load after a cold start will trigger the pipeline (~60s). Subsequent loads are instant from cache. Data refreshes daily at 06:30 AM.

## Requirements

- Python 3.11+
- FRED API key (free at [fred.stlouisfed.org](https://fred.stlouisfed.org/docs/api/api_key.html))
- Internet access for Yahoo Finance + FRED

## Project Structure

```
├── app.py              # Flask backend + APScheduler daily refresh
├── gmm_pipeline.py     # Data fetch, feature engineering, GMM, backtest
├── cache/
│   └── regime_data.json   # Auto-generated daily cache
├── static/
│   ├── css/style.css
│   └── js/
│       ├── main.js         # Data fetch, hero banner, regime cards
│       ├── portfolio.js    # Portfolio value chart
│       ├── timeline.js     # Regime timeline with S&P overlay
│       ├── heatmap.js      # Sharpe ratio heatmap
│       └── allocation.js   # Current allocation donut
├── templates/
│   └── index.html
├── requirements.txt
└── Procfile               # Render deployment
```
