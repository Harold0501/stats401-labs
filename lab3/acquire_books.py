"""Acquire 1,000 public book-work records from the Open Library Search API."""

from __future__ import annotations

import csv
import time
from pathlib import Path
from typing import Any

import requests


API_URL = "https://openlibrary.org/search.json"
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "data" / "lab3_data.csv"
TARGET_RECORDS = 1_000
PAGE_SIZE = 100
REQUEST_DELAY_SECONDS = 1.1
MAX_RETRIES = 3
MAX_PAGES = 25
USER_AGENT = "STATS401-Lab3-Educational-Project/1.0"
FIELDS = (
    "key,title,author_name,first_publish_year,edition_count,language"
)
CSV_COLUMNS = (
    "work_id",
    "title",
    "authors",
    "first_publish_year",
    "edition_count",
    "languages",
)


def join_values(value: Any) -> str:
    """Turn an API list field into a compact, readable CSV value."""
    if not value:
        return ""
    if isinstance(value, list):
        return "; ".join(
            str(item).strip() for item in value if str(item).strip()
        )
    return str(value).strip()


def normalize_book(book: dict[str, Any]) -> dict[str, Any] | None:
    """Select and normalize the fields displayed by the Lab 3 webpage."""
    work_key = str(book.get("key", "")).strip()
    title = str(book.get("title", "")).strip()
    authors = join_values(book.get("author_name"))
    languages = join_values(book.get("language"))

    try:
        first_publish_year = int(book["first_publish_year"])
        edition_count = int(book["edition_count"])
    except (KeyError, TypeError, ValueError):
        return None

    if not all((work_key, title, authors, languages)):
        return None
    if first_publish_year <= 0 or edition_count <= 0:
        return None

    return {
        "work_id": work_key.removeprefix("/works/"),
        "title": title,
        "authors": authors,
        "first_publish_year": first_publish_year,
        "edition_count": edition_count,
        "languages": languages,
    }


def request_page(
    session: requests.Session, page: int
) -> list[dict[str, Any]]:
    """Request one results page, retrying temporary request failures."""
    params = {
        "q": "subject_key:fiction language:eng",
        "fields": FIELDS,
        "sort": "key",
        "page": page,
        "limit": PAGE_SIZE,
    }

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = session.get(API_URL, params=params, timeout=30)
            response.raise_for_status()
            payload = response.json()
            documents = payload.get("docs")

            if not isinstance(documents, list):
                raise ValueError("The API response did not contain a docs list.")

            return documents
        except (requests.RequestException, ValueError) as error:
            print(
                f"Page {page} failed (attempt {attempt}/{MAX_RETRIES}): "
                f"{error}"
            )
            if attempt < MAX_RETRIES:
                time.sleep(REQUEST_DELAY_SECONDS * attempt)

    return []


def acquire_books() -> list[dict[str, Any]]:
    """Collect unique records with automatic pagination and rate limiting."""
    records_by_id: dict[str, dict[str, Any]] = {}

    with requests.Session() as session:
        session.headers.update({"User-Agent": USER_AGENT})

        for page in range(1, MAX_PAGES + 1):
            documents = request_page(session, page)
            if not documents:
                print(f"No usable response for page {page}; moving on.")
                time.sleep(REQUEST_DELAY_SECONDS)
                continue

            for document in documents:
                record = normalize_book(document)
                if record is not None:
                    records_by_id[record["work_id"]] = record

                if len(records_by_id) >= TARGET_RECORDS:
                    break

            print(
                f"Page {page}: collected {len(records_by_id):,} unique records"
            )

            if len(records_by_id) >= TARGET_RECORDS:
                break

            time.sleep(REQUEST_DELAY_SECONDS)

    records = list(records_by_id.values())[:TARGET_RECORDS]
    if len(records) < TARGET_RECORDS:
        raise RuntimeError(
            f"Only {len(records):,} records were collected; "
            f"at least {TARGET_RECORDS:,} are required."
        )

    return records


def save_csv(records: list[dict[str, Any]]) -> None:
    """Write the normalized records to the repository's data directory."""
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8-sig", newline="") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(records)


def main() -> None:
    records = acquire_books()
    save_csv(records)
    print(f"Saved {len(records):,} records to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
