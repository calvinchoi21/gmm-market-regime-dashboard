"""
Flask backend for Market Regime Dashboard.
Serves cached regime data; refreshes daily via APScheduler.
"""

import json
import logging
import os
import threading
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, render_template, abort

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

CACHE_FILE = Path(__file__).parent / "cache" / "regime_data.json"
FRED_API_KEY = os.environ.get("FRED_API_KEY", "")

_cache_lock = threading.Lock()


def load_cache():
    if CACHE_FILE.exists():
        with open(CACHE_FILE) as f:
            return json.load(f)
    return None


def refresh_cache():
    """Run the GMM pipeline and save results to cache."""
    if not FRED_API_KEY:
        logger.error("FRED_API_KEY not set — cannot refresh cache")
        return
    try:
        logger.info("Starting GMM pipeline refresh...")
        from gmm_pipeline import run_pipeline
        data = run_pipeline(FRED_API_KEY, retrain=False)
        CACHE_FILE.parent.mkdir(exist_ok=True)
        with _cache_lock:
            with open(CACHE_FILE, "w") as f:
                json.dump(data, f)
        logger.info(f"Cache refreshed successfully. Current regime: {data['current_regime_label']}")
    except Exception as e:
        logger.error(f"Pipeline refresh failed: {e}", exc_info=True)


def start_scheduler():
    """Run refresh once on startup, then daily at 6:30 AM ET."""
    import time
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger

    # Run immediately on first start if no cache
    if not CACHE_FILE.exists():
        logger.info("No cache found — running initial pipeline...")
        t = threading.Thread(target=refresh_cache, daemon=True)
        t.start()
    else:
        logger.info(f"Cache found (generated: {load_cache().get('generated_at', 'unknown')})")

    scheduler = BackgroundScheduler()
    scheduler.add_job(refresh_cache, CronTrigger(hour=6, minute=30), id="daily_refresh")
    scheduler.start()
    logger.info("Scheduler started — daily refresh at 06:30")


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/data")
def api_data():
    with _cache_lock:
        data = load_cache()
    if data is None:
        return jsonify({"status": "loading", "message": "Pipeline is running for the first time. Check back in ~60 seconds."}), 202
    return jsonify(data)


@app.route("/api/refresh", methods=["GET", "POST"])
def api_refresh():
    """Manual trigger for refresh (admin use)."""
    t = threading.Thread(target=refresh_cache, daemon=True)
    t.start()
    return jsonify({"status": "started", "message": "Refresh triggered"})


@app.route("/api/status")
def api_status():
    data = load_cache()
    if data is None:
        return jsonify({"ready": False, "message": "Cache not yet populated"})
    return jsonify({
        "ready": True,
        "generated_at": data.get("generated_at"),
        "data_through": data.get("data_through"),
        "current_regime": data.get("current_regime_label"),
    })


if __name__ == "__main__":
    start_scheduler()
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
