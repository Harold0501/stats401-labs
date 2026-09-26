"""Prepare the DKU 2021-2022 Undergraduate Bulletin for Lab 8.

Run from the repository root:
    python lab8/prepare_bulletin.py

The script downloads the official PDF when necessary, uses its bookmark
hierarchy to structure passages, embeds the passages, projects them with UMAP,
clusters them, names clusters from distinctive terms, and exports the compact
files used by the D3 page.
"""

from __future__ import annotations

import json
import re
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import CountVectorizer, TfidfVectorizer

from bulletin_extraction import extract_structured_passages


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
PDF_PATH = DATA_DIR / "V2021-22_DKU_UG_Bulletin.pdf"
PASSAGES_PATH = DATA_DIR / "lab8_embedding_map.csv"
SUMMARY_PATH = DATA_DIR / "lab8_summary.json"

SOURCE_URL = (
    "https://dku-web-admissions.s3.cn-north-1.amazonaws.com.cn/"
    "dkumain/files/V2021-22_DKU_UG_Bulletin.pdf"
)
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
# all-MiniLM-L6-v2 truncates input beyond 256 tokens, special tokens included.
MAX_MODEL_TOKENS = 256
N_CLUSTERS = 9
NAME_TERMS = 3

MOJIBAKE_REPLACEMENTS = {
    "��": "'",
    "�C": "–",
    "�D": "—",
    "\u00ad": "",
    "\ufb01": "fi",
    "\ufb02": "fl",
}


def download_pdf() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    if PDF_PATH.exists():
        return
    print(f"Downloading {SOURCE_URL}")
    urllib.request.urlretrieve(SOURCE_URL, PDF_PATH)


def clean_text(text: str) -> str:
    for bad, replacement in MOJIBAKE_REPLACEMENTS.items():
        text = text.replace(bad, replacement)
    text = re.sub(r"(\w)-\s+(\w)", r"\1\2", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" \t\r\n|")


def tfidf_terms(frame: pd.DataFrame) -> tuple[TfidfVectorizer, np.ndarray]:
    vectorizer = TfidfVectorizer(
        stop_words="english",
        min_df=3,
        max_df=0.82,
        ngram_range=(1, 2),
        max_features=6000,
    )
    matrix = vectorizer.fit_transform(frame["text_clean"])
    return vectorizer, matrix


def distinctive_cluster_terms(
    frame: pd.DataFrame, count: int = 6
) -> dict[int, list[str]]:
    """Rank terms by p_in * log(p_in / p_out), where p is the share of passages
    containing the term inside versus outside the cluster. Terms must be both
    common within the cluster and over-represented relative to the rest."""
    vectorizer = CountVectorizer(
        stop_words="english",
        ngram_range=(1, 2),
        min_df=5,
        binary=True,
        token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z]+\b",
    )
    presence = vectorizer.fit_transform(frame["text_clean"])
    terms = vectorizer.get_feature_names_out()
    labels = frame["cluster"].to_numpy()
    result: dict[int, list[str]] = {}
    for cluster in sorted(np.unique(labels)):
        inside = labels == cluster
        p_in = (np.asarray(presence[inside].sum(axis=0)).ravel() + 0.5) / (
            inside.sum() + 1
        )
        p_out = (np.asarray(presence[~inside].sum(axis=0)).ravel() + 0.5) / (
            (~inside).sum() + 1
        )
        scores = p_in * np.log(p_in / p_out)
        chosen: list[str] = []
        for index in np.argsort(scores)[::-1]:
            term = terms[index]
            words = set(term.split())
            if any(words & set(existing.split()) for existing in chosen):
                continue
            chosen.append(term)
            if len(chosen) == count:
                break
        result[int(cluster)] = chosen
    return result


def cluster_name(terms: list[str]) -> str:
    return " / ".join(term.title() for term in terms[:NAME_TERMS])


def add_semantic_analysis(frame: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    import umap
    from sentence_transformers import SentenceTransformer
    from sklearn.cluster import KMeans
    from sklearn.metrics.pairwise import cosine_similarity

    print(f"Embedding {len(frame):,} passages with {MODEL_NAME}")
    model = SentenceTransformer(MODEL_NAME)
    embeddings = model.encode(
        frame["text_clean"].tolist(),
        batch_size=64,
        normalize_embeddings=True,
        show_progress_bar=True,
    )

    reducer = umap.UMAP(
        n_components=2,
        n_neighbors=15,
        min_dist=0.15,
        metric="cosine",
        random_state=401,
    )
    coordinates = reducer.fit_transform(embeddings)
    frame["x"] = coordinates[:, 0].round(5)
    frame["y"] = coordinates[:, 1].round(5)

    kmeans = KMeans(n_clusters=N_CLUSTERS, random_state=401, n_init=20)
    frame["cluster"] = kmeans.fit_predict(embeddings)

    vectorizer, tfidf = tfidf_terms(frame)
    topic_terms = distinctive_cluster_terms(frame)
    frame["cluster_name"] = frame["cluster"].map(
        lambda cluster: cluster_name(topic_terms[cluster])
    )

    similarity = cosine_similarity(embeddings)
    np.fill_diagonal(similarity, -1)
    nearest = np.argpartition(-similarity, kth=5, axis=1)[:, :5]
    nearest = np.take_along_axis(
        nearest,
        np.argsort(-np.take_along_axis(similarity, nearest, axis=1), axis=1),
        axis=1,
    )
    passage_ids = frame["passage_id"].to_numpy()
    frame["neighbor_ids"] = [
        "|".join(passage_ids[row].tolist()) for row in nearest
    ]

    global_scores = np.asarray(tfidf.mean(axis=0)).ravel()
    terms = vectorizer.get_feature_names_out()
    top_global = [
        {"term": terms[index], "score": round(float(global_scores[index]), 5)}
        for index in np.argsort(global_scores)[::-1][:12]
    ]
    return frame, {
        "top_terms": top_global,
    }


def build_summary(raw_count: int, analysis: dict) -> dict:
    return {
        "raw_passages": raw_count,
        "top_terms": analysis["top_terms"],
    }


def export(frame: pd.DataFrame, summary: dict) -> None:
    columns = [
        "passage_id",
        "chapter",
        "section",
        "subsection",
        "page",
        "text",
        "cluster_name",
        "x",
        "y",
        "neighbor_ids",
    ]
    frame[columns].to_csv(PASSAGES_PATH, index=False)
    SUMMARY_PATH.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"Wrote {PASSAGES_PATH.relative_to(ROOT)} ({len(frame):,} passages)")
    print(f"Wrote {SUMMARY_PATH.relative_to(ROOT)}")


def model_token_counter():
    from transformers import AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    return lambda text: len(
        tokenizer.encode(text, add_special_tokens=True, verbose=False)
    )


def main() -> None:
    download_pdf()
    structured = extract_structured_passages(
        PDF_PATH, model_token_counter(), MAX_MODEL_TOKENS
    )
    frame = structured[structured["include_for_embedding"]].copy()
    frame["text_clean"] = frame["text"].map(clean_text)
    frame["passage_id"] = [f"p{i:04d}" for i in range(1, len(frame) + 1)]
    frame, analysis = add_semantic_analysis(frame)
    summary = build_summary(len(structured), analysis)
    export(frame, summary)


if __name__ == "__main__":
    main()
