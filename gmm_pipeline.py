"""
GMM Market Regime Pipeline
Fetches data from Yahoo Finance + FRED, engineers features,
runs PCA + GMM clustering, and returns regime data for caching.

Architecture:
- Model is trained locally or via GitHub Actions quarterly
- Daily refreshes only predict using the saved model
- Historical regime assignments are stable between retrains
"""

import json
import os
import warnings
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import fredapi
import yfinance as yf
from sklearn.decomposition import PCA
from sklearn.mixture import GaussianMixture
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")

# ── Constants ──────────────────────────────────────────────────────────────────
SECTOR_ETFS = ["XLK", "XLF", "XLE", "XLV", "XLY", "XLU", "XLI", "XLB", "IYR", "XLP"]
SECTOR_NAMES = {
    "XLK": "Technology", "XLF": "Financials", "XLE": "Energy",
    "XLV": "Healthcare", "XLY": "Cons. Discretionary", "XLU": "Utilities",
    "XLI": "Industrials", "XLB": "Materials", "IYR": "Real Estate",
    "XLP": "Cons. Staples",
}

# Canonical regime IDs — never change
REGIME_LABELS = {
    0: "Moderate Expansion",
    1: "Bullish Risk-On",
    2: "Choppy Recovery",
    3: "Panic / Market Correction",
    4: "Recovery & Stabilization",
}

REGIME_COLORS = {
    0: "#3b82f6",
    1: "#22c55e",
    2: "#f59e0b",
    3: "#ef4444",
    4: "#a855f7",
}

# Weights keyed to canonical regime IDs — from paper Table 3
REGIME_WEIGHTS = {
    0: {"XLK": 0.24, "XLF": 0.10, "XLE": 0.24, "XLY": 0.10, "XLU": 0.23, "XLI": 0.23, "XLB": 0.00, "IYR": 0.00, "XLP": 0.10, "XLV": 0.00},
    1: {"XLK": 0.10, "XLF": 0.00, "XLE": 0.00, "XLY": 0.23, "XLU": 0.10, "XLI": 0.10, "XLB": 0.10, "IYR": 0.00, "XLP": 0.24, "XLV": 0.23},
    2: {"XLK": 0.00, "XLF": 0.10, "XLE": 0.00, "XLY": 0.00, "XLU": 0.00, "XLI": 0.00, "XLB": 0.00, "IYR": 0.23, "XLP": 0.10, "XLV": 0.23},
    3: {"XLK": 0.23, "XLF": 0.10, "XLE": 0.00, "XLY": 0.23, "XLU": 0.00, "XLI": 0.00, "XLB": 0.00, "IYR": 0.00, "XLP": 0.00, "XLV": 0.00},
    4: {"XLK": 0.00, "XLF": 0.10, "XLE": 0.00, "XLY": 0.23, "XLU": 0.23, "XLI": 0.20, "XLB": 0.10, "IYR": 0.24, "XLP": 0.00, "XLV": 0.00},
}

FETCH_START  = "1998-01-01"
START_DATE   = "2000-01-01"
MODEL_PATH   = Path("cache/gmm_model.joblib")
MAPPING_PATH = Path("cache/regime_mapping.json")

FEATURE_COLS = (
    [f"{t}_ret" for t in SECTOR_ETFS]
    + ["spy_ret", "vix", "rsi", "sma_ratio", "sma_diff",
       "gdp_mom", "cpi_mom", "unemp", "fedfunds", "sentiment",
       "yc_10y2y", "yc_10y3m", "cash_ret"]
)


# ── Data Fetching ──────────────────────────────────────────────────────────────

def fetch_yahoo_data():
    index_raw = yf.download(
        ["SPY", "^VIX"], start=FETCH_START,
        auto_adjust=False, progress=False
    )["Adj Close"]
    index_raw = index_raw.ffill()

    sector_raw = yf.download(
        SECTOR_ETFS, start=FETCH_START,
        auto_adjust=False, progress=False
    )["Adj Close"]
    sector_raw = sector_raw.ffill()

    raw = pd.concat([index_raw, sector_raw], axis=1)
    raw = raw.ffill()
    return raw.dropna(subset=["SPY"])


def fetch_fred_data(fred_api_key):
    fred = fredapi.Fred(api_key=fred_api_key)
    end  = datetime.today()
    series = {
        "gdp":       fred.get_series("GDP",      observation_start=FETCH_START, observation_end=end),
        "cpi":       fred.get_series("CPIAUCSL", observation_start=FETCH_START, observation_end=end),
        "unemp":     fred.get_series("UNRATE",   observation_start=FETCH_START, observation_end=end),
        "fedfunds":  fred.get_series("FEDFUNDS", observation_start=FETCH_START, observation_end=end),
        "t10y":      fred.get_series("DGS10",    observation_start=FETCH_START, observation_end=end),
        "t2y":       fred.get_series("DGS2",     observation_start=FETCH_START, observation_end=end),
        "t3m":       fred.get_series("DGS3MO",   observation_start=FETCH_START, observation_end=end),
        "sentiment": fred.get_series("UMCSENT",  observation_start=FETCH_START, observation_end=end),
    }
    df = pd.DataFrame(series)
    df.index = pd.to_datetime(df.index)
    return df.ffill()


# ── Feature Engineering ────────────────────────────────────────────────────────

def engineer_features(yahoo_df, fred_df):
    df = yahoo_df.copy().ffill()

    for ticker in SECTOR_ETFS:
        df[f"{ticker}_ret"] = df[ticker].pct_change()

    df["spy_ret"]   = df["SPY"].pct_change()
    df["spy_price"] = df["SPY"]
    df["vix"]       = df["^VIX"]

    delta    = df["SPY"].diff()
    gain     = np.where(delta > 0, delta, 0)
    loss     = np.where(delta < 0, -delta, 0)
    avg_gain = pd.Series(gain, index=df.index).rolling(14, min_periods=1).mean()
    avg_loss = pd.Series(loss, index=df.index).rolling(14, min_periods=1).mean()
    df["rsi"] = 100 - (100 / (1 + avg_gain / avg_loss))

    sma50  = df["SPY"].rolling(50,  min_periods=1).mean()
    sma200 = df["SPY"].rolling(200, min_periods=1).mean()
    df["sma_ratio"] = sma50 / sma200
    df["sma_diff"]  = sma50 - sma200

    fred_daily    = fred_df.reindex(df.index, method="ffill")
    df["gdp_mom"] = fred_daily["gdp"].pct_change().bfill()
    df["cpi_mom"] = fred_daily["cpi"].pct_change().bfill()
    df["unemp"]     = fred_daily["unemp"]
    df["fedfunds"]  = fred_daily["fedfunds"]
    df["sentiment"] = fred_daily["sentiment"]
    df["yc_10y2y"]  = fred_daily["t10y"] - fred_daily["t2y"]
    df["yc_10y3m"]  = fred_daily["t10y"] - fred_daily["t3m"]
    df["t3m"]       = fred_daily["t3m"]
    df["cash_ret"]  = fred_daily["t3m"] / 100 / 252

    return df


# ── Regime Identification ──────────────────────────────────────────────────────

def identify_regimes(df):
    """
    Map GMM cluster numbers to canonical regime IDs.
    Uses the same logic as the original notebook narrative.
    """
    stats = df.groupby("gmm_cluster").agg(
        median_vix=("vix",      "median"),
        median_sma_diff=("sma_diff", "median"),
        median_yc=("yc_10y2y", "median"),
        median_rsi=("rsi",     "median"),
    )

    print("\nCluster stats for identification:")
    print(stats.round(3))

    remaining = list(stats.index)

    # Regime 3 — Panic: highest VIX
    panic = stats.loc[remaining, "median_vix"].idxmax()
    remaining.remove(panic)

    # Regime 2 — Choppy Recovery: negative SMA diff + highest VIX among remaining
    neg_sma = stats.loc[remaining][stats.loc[remaining, "median_sma_diff"] < 0]
    choppy  = neg_sma["median_vix"].idxmax() if len(neg_sma) > 0 else stats.loc[remaining, "median_vix"].idxmax()
    remaining.remove(choppy)

    # Remaining 3 all have positive SMA diff
    # Regime 4 — Recovery & Stabilization: highest VIX among remaining 3
    recovery = stats.loc[remaining, "median_vix"].idxmax()
    remaining.remove(recovery)

    # Regime 0 — Moderate Expansion: lowest yield curve among remaining 2
    # (notebook shows slight inversion as key signal)
    moderate = stats.loc[remaining, "median_yc"].idxmin()
    remaining.remove(moderate)

    # Regime 1 — Bullish Risk-On: whatever's left
    bullish = remaining[0]

    mapping = {
        int(panic):    3,
        int(choppy):   2,
        int(recovery): 4,
        int(moderate): 0,
        int(bullish):  1,
    }

    print(f"\n  Regime mapping (gmm_cluster -> canonical_id):")
    for cluster, regime_id in sorted(mapping.items()):
        print(f"    Cluster {cluster} -> {REGIME_LABELS[regime_id]}")

    return mapping


# ── Model Training ─────────────────────────────────────────────────────────────

def train_model(df):
    """Train GMM on full dataset. Called quarterly or on first deploy."""
    X = df[FEATURE_COLS].dropna()

    scaler  = StandardScaler()
    scaled  = scaler.fit_transform(X)

    pca     = PCA(n_components=0.95, random_state=42)
    reduced = pca.fit_transform(scaled)

    gmm = GaussianMixture(n_components=5, covariance_type="full", random_state=42, n_init=5)
    gmm.fit(reduced)

    MODEL_PATH.parent.mkdir(exist_ok=True)
    joblib.dump({
        "scaler":     scaler,
        "pca":        pca,
        "gmm":        gmm,
        "trained_on": datetime.now().isoformat(),
    }, MODEL_PATH)
    print(f"  Model trained and saved to {MODEL_PATH}")

    return scaler, pca, gmm, X


def predict_regimes(df, scaler, pca, gmm):
    """Use saved model to predict regimes on full dataset."""
    X = df[FEATURE_COLS].dropna()

    scaled  = scaler.transform(X)
    reduced = pca.transform(scaled)

    raw_labels = gmm.predict(reduced)
    probs      = gmm.predict_proba(reduced)

    # 5-day smoothing buffer
    smoothed = raw_labels.copy()
    window   = 5
    for i in range(window, len(smoothed)):
        window_labels = raw_labels[i - window:i + 1]
        if len(set(window_labels)) == 1:
            smoothed[i] = window_labels[0]
        else:
            smoothed[i] = smoothed[i - 1]

    # Write clusters back to full df
    df = df.copy()
    df["gmm_cluster"] = np.nan
    df["regime_prob"] = np.nan
    df.loc[X.index, "gmm_cluster"] = smoothed.astype(float)
    df.loc[X.index, "regime_prob"] = probs[np.arange(len(probs)), smoothed]
    df["gmm_cluster"] = df["gmm_cluster"].ffill()
    df["regime_prob"] = df["regime_prob"].ffill()

    return df


def apply_model(df, retrain=False):
    """
    Apply GMM to df.
    - If model exists and retrain=False: load and predict only
    - If model missing or retrain=True: train from scratch
    """
    if MODEL_PATH.exists() and not retrain:
        print("  Loading saved model...")
        model  = joblib.load(MODEL_PATH)
        scaler = model["scaler"]
        pca    = model["pca"]
        gmm    = model["gmm"]
        print(f"  Model trained on: {model.get('trained_on', 'unknown')}")
    else:
        print("  Training model from scratch...")
        scaler, pca, gmm, _ = train_model(df)

    df = predict_regimes(df, scaler, pca, gmm)

    # Load or compute regime mapping
    if MAPPING_PATH.exists() and not retrain:
        with open(MAPPING_PATH) as f:
            mapping = {int(k): v for k, v in json.load(f).items()}
        print(f"  Loaded saved regime mapping: {mapping}")
    else:
        display_df = df[df.index >= START_DATE].copy()
        mapping    = identify_regimes(display_df)
        MAPPING_PATH.parent.mkdir(exist_ok=True)
        with open(MAPPING_PATH, "w") as f:
            json.dump(mapping, f)
        print(f"  Regime mapping saved to {MAPPING_PATH}")

    df["regime"] = df["gmm_cluster"].map(mapping)
    return df


# ── Analytics ──────────────────────────────────────────────────────────────────

def compute_portfolio(result_df):
    initial    = 100_000
    gmm_val    = initial
    gmm_series = []
    dates      = []

    for date, row in result_df.iterrows():
        regime  = int(row["regime"])
        weights = REGIME_WEIGHTS[regime]
        gmm_ret = sum(weights.get(t, 0) * row[f"{t}_ret"] for t in SECTOR_ETFS)
        if not np.isnan(gmm_ret):
            gmm_val *= (1 + gmm_ret)
        gmm_series.append(round(gmm_val, 2))
        dates.append(date.strftime("%Y-%m-%d"))

    spy_series = [round(v, 2) for v in (initial * (1 + result_df["spy_ret"].fillna(0)).cumprod()).values]

    return dates, gmm_series, spy_series


def compute_sharpe_heatmap(result_df):
    ret_cols = [f"{t}_ret" for t in SECTOR_ETFS]
    heatmap  = {}
    for regime_id in range(5):
        subset  = result_df[result_df["regime"] == regime_id][ret_cols]
        sharpes = {}
        for col in ret_cols:
            ticker = col.replace("_ret", "")
            mu     = subset[col].mean() * 252
            sigma  = subset[col].std() * np.sqrt(252)
            sharpes[ticker] = round(mu / sigma, 3) if sigma > 0 else 0.0
        heatmap[regime_id] = sharpes
    return heatmap


def _safe_round(val, ndigits):
    f = float(val)
    return None if np.isnan(f) else round(f, ndigits)


def compute_regime_stats(result_df):
    total = len(result_df)
    stats = {}
    for regime_id in range(5):
        subset = result_df[result_df["regime"] == regime_id]
        stats[regime_id] = {
            "count":           int(len(subset)),
            "pct":             round(len(subset) / total * 100, 1),
            "median_vix":      _safe_round(subset["vix"].median(), 2),
            "median_rsi":      _safe_round(subset["rsi"].median(), 2),
            "median_yc_10y2y": _safe_round(subset["yc_10y2y"].median(), 3),
            "median_yc_10y3m": _safe_round(subset["yc_10y3m"].median(), 3),
            "median_sma_diff": _safe_round(subset["sma_diff"].median(), 3),
        }
    return stats


def compute_regime_timeline(result_df):
    dates   = result_df.index
    regimes = result_df["regime"].values
    bands   = []
    i = 0
    while i < len(regimes):
        j = i
        while j < len(regimes) and regimes[j] == regimes[i]:
            j += 1
        bands.append({
            "regime": int(regimes[i]),
            "start":  dates[i].strftime("%Y-%m-%d"),
            "end":    dates[j - 1].strftime("%Y-%m-%d"),
        })
        i = j
    return bands


# ── Main Pipeline ──────────────────────────────────────────────────────────────

def run_pipeline(fred_api_key, retrain=False):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Fetching Yahoo Finance data...")
    yahoo_df = fetch_yahoo_data()

    print(f"[{datetime.now().strftime('%H:%M:%S')}] Fetching FRED data...")
    fred_df = fetch_fred_data(fred_api_key)

    print(f"[{datetime.now().strftime('%H:%M:%S')}] Engineering features...")
    df = engineer_features(yahoo_df, fred_df)

    print(f"[{datetime.now().strftime('%H:%M:%S')}] Applying GMM model...")
    df = apply_model(df, retrain=retrain)

    # Clip to display/backtest start
    result_df = df[df.index >= START_DATE].copy()
    result_df = result_df.dropna(subset=["regime"])

    current_regime = int(result_df["regime"].iloc[-1])
    current_prob   = float(result_df["regime_prob"].iloc[-1])

    latest = result_df.iloc[-1]
    macro_snapshot = {
        "vix":       round(float(latest["vix"]), 2),
        "rsi":       round(float(latest["rsi"]), 2),
        "yc_10y2y":  round(float(latest["yc_10y2y"]), 3),
        "yc_10y3m":  round(float(latest["yc_10y3m"]), 3),
        "sma_ratio": round(float(latest["sma_ratio"]), 4),
    }

    print(f"[{datetime.now().strftime('%H:%M:%S')}] Computing outputs...")
    dates, gmm_portfolio, spy_portfolio = compute_portfolio(result_df)
    sharpe_heatmap = compute_sharpe_heatmap(result_df)
    regime_stats   = compute_regime_stats(result_df)
    timeline_bands = compute_regime_timeline(result_df)
    spy_prices     = [round(float(p), 2) for p in result_df["spy_price"].values]

    output = {
        "generated_at":         datetime.now().isoformat(),
        "data_through":         result_df.index[-1].strftime("%Y-%m-%d"),
        "current_regime":       current_regime,
        "current_regime_label": REGIME_LABELS[current_regime],
        "current_regime_color": REGIME_COLORS[current_regime],
        "current_confidence":   round(current_prob * 100, 1),
        "current_allocation":   REGIME_WEIGHTS[current_regime],
        "macro_snapshot":       macro_snapshot,
        "regime_labels":        REGIME_LABELS,
        "regime_colors":        REGIME_COLORS,
        "regime_stats":         {str(k): v for k, v in regime_stats.items()},
        "sharpe_heatmap":       {str(k): v for k, v in sharpe_heatmap.items()},
        "portfolio": {
            "dates":            dates,
            "gmm":              gmm_portfolio,
            "spy":              spy_portfolio,
            "gmm_final":        gmm_portfolio[-1],
            "spy_final":        spy_portfolio[-1],
            "gmm_total_return": round((gmm_portfolio[-1] / 100_000 - 1) * 100, 1),
            "spy_total_return": round((spy_portfolio[-1] / 100_000 - 1) * 100, 1),
        },
        "timeline": {
            "bands":      timeline_bands,
            "dates":      dates,
            "spy_prices": spy_prices,
        },
        "sector_names": SECTOR_NAMES,
    }

    return output


if __name__ == "__main__":
    import sys
    key = os.environ.get("FRED_API_KEY", "")
    if not key:
        print("Set FRED_API_KEY environment variable")
        sys.exit(1)

    retrain = "--retrain" in sys.argv
    if retrain:
        print("Force retraining model from scratch...")

    data = run_pipeline(key, retrain=retrain)
    Path("cache").mkdir(exist_ok=True)
    with open("cache/regime_data.json", "w") as f:
        json.dump(data, f)
    print("Done. Saved to cache/regime_data.json")
