"""
One-time script to train the GMM model locally and save it.
Run this before first deploy to Render.

Usage:
    python train_initial_model.py
"""

import json
import os
import sys
from pathlib import Path

def main():
    key = os.environ.get("FRED_API_KEY", "")
    if not key:
        print("ERROR: Set FRED_API_KEY environment variable first")
        print("  Windows: $env:FRED_API_KEY='your_key'")
        sys.exit(1)

    print("=" * 60)
    print("GMM Initial Model Training")
    print("=" * 60)

    from gmm_pipeline import (
        fetch_yahoo_data, fetch_fred_data, engineer_features,
        train_model, predict_regimes, identify_regimes,
        run_pipeline, START_DATE, MAPPING_PATH, MODEL_PATH
    )

    print("\nStep 1: Fetching data...")
    yahoo_df = fetch_yahoo_data()
    fred_df  = fetch_fred_data(key)

    print("\nStep 2: Engineering features...")
    df = engineer_features(yahoo_df, fred_df)

    print("\nStep 3: Training GMM model...")
    Path("cache").mkdir(exist_ok=True)
    scaler, pca, gmm, X = train_model(df)

    print("\nStep 4: Predicting regimes...")
    df = predict_regimes(df, scaler, pca, gmm)

    print("\nStep 5: Identifying regime mapping...")
    display_df = df[df.index >= START_DATE].copy()
    mapping    = identify_regimes(display_df)
    with open(MAPPING_PATH, "w") as f:
        json.dump(mapping, f)

    print("\nStep 6: Running full pipeline to generate cache...")
    data = run_pipeline(key, retrain=False)
    with open("cache/regime_data.json", "w") as f:
        json.dump(data, f)

    print("\n" + "=" * 60)
    print("Training complete! Files saved:")
    print(f"  {MODEL_PATH}")
    print(f"  {MAPPING_PATH}")
    print("  cache/regime_data.json")
    print("\nNext steps:")
    print("  1. Verify the dashboard looks correct: python app.py")
    print("  2. Commit these files to GitHub:")
    print("     git add cache/gmm_model.joblib cache/regime_mapping.json")
    print("     git commit -m 'Add initial trained GMM model'")
    print("     git push")
    print("=" * 60)

if __name__ == "__main__":
    main()
