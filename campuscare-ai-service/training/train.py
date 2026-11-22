"""
Trains the TF-IDF models and the LSA embedder, and saves them to models/.

  python -m training.train                                  # generated dataset only
  python -m training.train --extra data/real_reports.csv    # plus real reports exported from the backend
"""
import argparse
import logging
from pathlib import Path

from campuscare_ai.config import ROOT
from campuscare_ai.trainer import train_models


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(ROOT / "data" / "campus_issues.csv"), help="main training CSV")
    ap.add_argument("--extra", nargs="*", default=[], help="more CSVs to add (e.g. exported real reports)")
    ap.add_argument("--out", default=str(ROOT / "models"), help="folder for the trained models")
    ap.add_argument("--lsa-dim", type=int, default=128, help="size of the LSA embedding")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    meta = train_models([Path(args.data), *map(Path, args.extra)], Path(args.out), lsa_dim=args.lsa_dim)
    print(f"Trained on {meta['rows']} reports in {meta['seconds']}s → {args.out}")
    print("Run `python -m training.evaluate` to measure accuracy.")


if __name__ == "__main__":
    main()
