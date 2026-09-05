"""Acquire, clean, and score a reproducible 1,200-tweet Lab 4 sample.

Source: Cardiff NLP TweetTopic (train_all split)
https://huggingface.co/datasets/cardiffnlp/tweet_topic_multi

The source already masks most usernames and URLs. This script preserves that raw
text, audits the structured fields, creates a lightly normalized copy for
RoBERTa, and writes browser-ready CSV files. Sentiment values are model
estimates, not ground-truth annotations.
"""

from __future__ import annotations

import argparse
import json
import re
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
RAW_PATH = DATA_DIR / "lab4_raw_tweets.csv"
CLEAN_PATH = DATA_DIR / "lab4_clean_tweets.csv"
TOPIC_PATH = DATA_DIR / "lab4_sentiment.csv"

SOURCE_URL = (
    "https://huggingface.co/datasets/cardiffnlp/tweet_topic_multi/"
    "resolve/main/tweet_topic_multi/train_all-00000-of-00001.parquet"
)
MODEL_NAME = "cardiffnlp/twitter-roberta-base-sentiment-latest"
SAMPLE_SIZE = 1_200
RANDOM_SEED = 401


def serialize_topics(value: object) -> str:
    """Store a source topic array losslessly in a CSV cell."""
    if isinstance(value, np.ndarray):
        value = value.tolist()
    if not isinstance(value, list):
        value = []
    return json.dumps(value, ensure_ascii=False)


def acquire_raw(source_parquet: Path | None = None) -> pd.DataFrame:
    """Create the fixed raw CSV sample from the official Parquet split."""
    if source_parquet is None:
        with tempfile.TemporaryDirectory(prefix="stats401_lab4_") as tmp_dir:
            download_path = Path(tmp_dir) / "tweet_topic_train_all.parquet"
            print(f"Downloading TweetTopic from {SOURCE_URL}")
            urllib.request.urlretrieve(SOURCE_URL, download_path)
            source = pd.read_parquet(download_path)
    else:
        source = pd.read_parquet(source_parquet)

    required = {"id", "date", "text", "label_name"}
    missing_columns = required.difference(source.columns)
    if missing_columns:
        raise ValueError(f"Source is missing columns: {sorted(missing_columns)}")

    # Preserve the source's one blank-topic row so the cleaning decision is
    # visible and reproducible, then sample the remaining rows deterministically.
    blank_topic_mask = source["label_name"].map(len).eq(0)
    blank_topic_rows = source.loc[blank_topic_mask].head(1)
    sample_count = SAMPLE_SIZE - len(blank_topic_rows)
    sampled = source.loc[~blank_topic_mask].sample(
        n=sample_count,
        random_state=RANDOM_SEED,
    )
    raw = pd.concat([blank_topic_rows, sampled], ignore_index=True)
    raw = raw.rename(
        columns={
            "id": "tweet_id",
            "date": "created_at",
            "text": "tweet_text",
            "label_name": "topics_raw",
        }
    )[["tweet_id", "created_at", "tweet_text", "topics_raw"]]
    raw["topics_raw"] = raw["topics_raw"].map(serialize_topics)
    raw.to_csv(RAW_PATH, index=False, encoding="utf-8")
    print(f"Saved {len(raw):,} raw records to {RAW_PATH}")
    return raw


def parse_topics(value: object) -> list[str]:
    """Parse the JSON topic array while treating malformed cells as missing."""
    try:
        topics = json.loads(str(value))
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(topics, list):
        return []
    return [str(topic).strip() for topic in topics if str(topic).strip()]


def display_topic(topic: str) -> str:
    """Convert machine-oriented topic labels into concise display labels."""
    return topic.replace("_&_", " & ").replace("_", " ").title()


def clean_for_tfidf(text: object) -> str:
    """Apply stronger normalization for term-frequency analysis."""
    value = str(text).lower()
    value = re.sub(r"\{\{@?url@?\}\}|https?://\S+|www\.\S+", " URL ", value)
    value = re.sub(r"\{\{@?username@?\}\}|\{@.*?@\}|@\w+", " USER ", value)
    value = re.sub(r"\b\d+(?:\.\d+)?\b", " NUMBER ", value)
    tokens = re.findall(r"[a-z]+", value)
    return " ".join(tokens)


def prepare_for_roberta(text: object) -> str:
    """Normalize only account and URL placeholders, preserving sentiment cues."""
    value = str(text)
    value = re.sub(r"\{\{URL\}\}|https?://\S+|www\.\S+", "http", value)
    value = re.sub(r"\{\{USERNAME\}\}|\{@.*?@\}|@\w+", "@user", value)
    return value.strip()


def audit_raw(raw: pd.DataFrame) -> dict[str, object]:
    """Summarize data-quality checks before any rows are removed."""
    parsed_dates = pd.to_datetime(raw["created_at"], errors="coerce")
    parsed_topics = raw["topics_raw"].map(parse_topics)
    return {
        "raw_rows": int(len(raw)),
        "missing_by_column": {
            column: int(count) for column, count in raw.isna().sum().items()
        },
        "blank_text_rows": int(raw["tweet_text"].fillna("").str.strip().eq("").sum()),
        "duplicate_rows": int(raw.duplicated().sum()),
        "duplicate_tweet_ids": int(raw.duplicated("tweet_id").sum()),
        "invalid_dates": int(parsed_dates.isna().sum()),
        "blank_or_malformed_topics": int(parsed_topics.map(len).eq(0).sum()),
    }


def clean_structured_fields(raw: pd.DataFrame) -> pd.DataFrame:
    """Clean identifiers, dates, text, and the supplied multi-label topics."""
    df = raw.drop_duplicates().drop_duplicates(subset=["tweet_id"], keep="first").copy()
    df["tweet_id"] = df["tweet_id"].astype("string").str.strip()
    df["tweet_text"] = (
        df["tweet_text"].astype("string").str.replace(r"\s+", " ", regex=True).str.strip()
    )
    df["date"] = pd.to_datetime(df["created_at"], errors="coerce")
    df["topic_list"] = df["topics_raw"].map(parse_topics)

    critical = df["tweet_id"].notna() & df["tweet_text"].notna() & df["date"].notna()
    critical &= df["tweet_id"].ne("") & df["tweet_text"].ne("")
    critical &= df["topic_list"].map(len).gt(0)
    df = df.loc[critical].copy()

    df["topics"] = df["topic_list"].map(
        lambda values: "|".join(display_topic(value) for value in values)
    )
    df["year"] = df["date"].dt.year
    df["month"] = df["date"].dt.to_period("M").astype(str)
    df["sentiment_text"] = df["tweet_text"].map(prepare_for_roberta)
    df["text_clean"] = df["tweet_text"].map(clean_for_tfidf)
    df["word_count"] = df["text_clean"].str.split().map(len)
    return df.reset_index(drop=True)


def inspect_tfidf(df: pd.DataFrame) -> tuple[int, int]:
    """Build the lab's pruned TF-IDF matrix and report its dimensions."""
    vectorizer = TfidfVectorizer(min_df=2, max_df=0.90, stop_words="english")
    matrix = vectorizer.fit_transform(df["text_clean"])
    print(f"TF-IDF matrix: {matrix.shape[0]:,} tweets × {matrix.shape[1]:,} terms")
    return matrix.shape


def score_sentiment(df: pd.DataFrame, batch_size: int = 16) -> pd.DataFrame:
    """Estimate negative/neutral/positive probabilities with Twitter-RoBERTa."""
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    print(f"Loading {MODEL_NAME}")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    model.eval()
    print(f"Sentiment inference device: {device}")

    score_batches: list[np.ndarray] = []
    texts = df["sentiment_text"].tolist()
    with torch.inference_mode():
        for start in range(0, len(texts), batch_size):
            encoded = tokenizer(
                texts[start : start + batch_size],
                padding=True,
                truncation=True,
                max_length=512,
                return_tensors="pt",
            )
            encoded = {name: tensor.to(device) for name, tensor in encoded.items()}
            logits = model(**encoded).logits
            probabilities = torch.softmax(logits, dim=1).cpu().numpy()
            score_batches.append(probabilities)
            completed = min(start + batch_size, len(texts))
            if completed % 160 == 0 or completed == len(texts):
                print(f"Scored {completed:,}/{len(texts):,} tweets")

    scores = np.vstack(score_batches)
    result = df.copy()
    result["sentiment_negative"] = scores[:, 0]
    result["sentiment_neutral"] = scores[:, 1]
    result["sentiment_positive"] = scores[:, 2]
    labels = np.array(["Negative", "Neutral", "Positive"])
    result["sentiment"] = labels[scores.argmax(axis=1)]
    result["sentiment_score"] = scores[:, 2] - scores[:, 0]
    result["model_confidence"] = scores.max(axis=1)
    return result


def aggregate_topics(df: pd.DataFrame) -> pd.DataFrame:
    """Create one row per topic for the D3 chart; tweets may have many topics."""
    exploded = df.assign(topic=df["topics"].str.split("|")).explode("topic")
    counts = pd.crosstab(exploded["topic"], exploded["sentiment"])
    for label in ("Negative", "Neutral", "Positive"):
        if label not in counts:
            counts[label] = 0

    aggregate = (
        exploded.groupby("topic", as_index=True)
        .agg(
            tweet_count=("tweet_id", "nunique"),
            average_sentiment=("sentiment_score", "mean"),
            average_confidence=("model_confidence", "mean"),
        )
        .join(counts[["Negative", "Neutral", "Positive"]])
        .reset_index()
        .rename(
            columns={
                "Negative": "negative",
                "Neutral": "neutral",
                "Positive": "positive",
            }
        )
        .sort_values("tweet_count", ascending=False)
    )
    return aggregate


def validate_outputs(df: pd.DataFrame, topics: pd.DataFrame) -> None:
    """Fail loudly if the generated browser data violates core assumptions."""
    if len(df) < 1_000:
        raise ValueError(f"Only {len(df):,} cleaned tweets remain; 1,000 are required.")
    if df["tweet_id"].duplicated().any():
        raise ValueError("Cleaned tweet IDs are not unique.")
    probability_sum = df[
        ["sentiment_negative", "sentiment_neutral", "sentiment_positive"]
    ].sum(axis=1)
    if not np.allclose(probability_sum, 1.0, atol=1e-5):
        raise ValueError("Sentiment probabilities do not sum to one.")
    if topics.empty:
        raise ValueError("Topic aggregation is empty.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-parquet",
        type=Path,
        help="Use a local TweetTopic Parquet file when creating the raw sample.",
    )
    parser.add_argument(
        "--reacquire",
        action="store_true",
        help="Recreate the raw sample even if data/lab4_raw_tweets.csv exists.",
    )
    parser.add_argument("--batch-size", type=int, default=16)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if args.reacquire or not RAW_PATH.exists():
        raw = acquire_raw(args.source_parquet)
    else:
        raw = pd.read_csv(RAW_PATH, dtype={"tweet_id": "string"})

    report = audit_raw(raw)
    print(json.dumps(report, indent=2))
    cleaned = clean_structured_fields(raw)
    inspect_tfidf(cleaned)
    scored = score_sentiment(cleaned, batch_size=args.batch_size)
    topics = aggregate_topics(scored)
    validate_outputs(scored, topics)

    output_columns = [
        "tweet_id",
        "date",
        "year",
        "month",
        "tweet_text",
        "sentiment_text",
        "text_clean",
        "word_count",
        "topics",
        "sentiment_negative",
        "sentiment_neutral",
        "sentiment_positive",
        "sentiment_score",
        "model_confidence",
        "sentiment",
    ]
    scored[output_columns].to_csv(CLEAN_PATH, index=False, encoding="utf-8")
    topics.to_csv(TOPIC_PATH, index=False, encoding="utf-8")

    print(f"Saved {len(scored):,} cleaned tweets to {CLEAN_PATH}")
    print(f"Saved {len(topics):,} topic aggregates to {TOPIC_PATH}")


if __name__ == "__main__":
    main()
