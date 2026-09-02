"""Scrape all 1,000 book listings from the Books to Scrape sandbox."""

from __future__ import annotations

import csv
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup


BASE_URL = "https://books.toscrape.com/"
START_URL = urljoin(BASE_URL, "catalogue/page-1.html")
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "data" / "lab3_data.csv"
CHECKPOINT_PATH = OUTPUT_PATH.with_name("lab3_progress.csv")
TARGET_RECORDS = 1_000
REQUEST_DELAY_SECONDS = 1.0
RETRY_BACKOFF_SECONDS = 5.0
MAX_RETRIES = 5
USER_AGENT = "STATS401-Lab3-Educational-Scraper/1.0"
CSV_COLUMNS = (
    "book_id",
    "title",
    "category",
    "price_gbp",
    "rating",
    "available_quantity",
)
RATING_VALUES = {
    "One": 1,
    "Two": 2,
    "Three": 3,
    "Four": 4,
    "Five": 5,
}


def request_page(session: requests.Session, url: str) -> requests.Response:
    """Download one catalogue page, retrying temporary request failures."""
    for attempt in range(1, MAX_RETRIES + 1):
        time.sleep(REQUEST_DELAY_SECONDS)
        try:
            response = session.get(url, timeout=30)
            response.raise_for_status()
            response.encoding = "utf-8"
            return response
        except requests.RequestException as error:
            print(
                f"Request failed (attempt {attempt}/{MAX_RETRIES}): {error}"
            )
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF_SECONDS * attempt)

    raise RuntimeError(f"Could not download {url} after {MAX_RETRIES} attempts.")


def parse_listing(book: object) -> dict[str, object] | None:
    """Extract the fields available on a catalogue product card."""
    title_link = book.select_one("h3 a")
    price_node = book.select_one(".price_color")
    rating_node = book.select_one(".star-rating")

    if not all((title_link, price_node, rating_node)):
        return None

    href = str(title_link.get("href", ""))
    id_match = re.search(r"_(\d+)/index\.html$", href)
    rating_class = next(
        (name for name in RATING_VALUES if name in rating_node.get("class", [])),
        None,
    )

    try:
        book_id = int(id_match.group(1)) if id_match else 0
        price_gbp = float(price_node.get_text(strip=True).replace("£", ""))
        rating = RATING_VALUES[rating_class] if rating_class else 0
    except (KeyError, TypeError, ValueError):
        return None

    title = str(title_link.get("title", "")).strip()
    if not all((book_id, title, price_gbp, rating, href)):
        return None

    return {
        "book_id": book_id,
        "title": title,
        "price_gbp": price_gbp,
        "rating": rating,
        "detail_path": href,
    }


def parse_detail(soup: BeautifulSoup) -> tuple[str, int] | None:
    """Extract category and numeric stock from one book detail page."""
    category_node = soup.select_one("ul.breadcrumb li:nth-of-type(3) a")
    availability_node = soup.select_one(".product_main .availability")

    if category_node is None or availability_node is None:
        return None

    category = category_node.get_text(strip=True)
    availability_text = " ".join(availability_node.stripped_strings)
    quantity_match = re.search(r"\((\d+)\s+available\)", availability_text)

    if not category or quantity_match is None:
        return None

    return category, int(quantity_match.group(1))


def load_checkpoint() -> dict[int, dict[str, object]]:
    """Load complete records saved by an earlier interrupted run."""
    if not CHECKPOINT_PATH.exists():
        return {}

    records: dict[int, dict[str, object]] = {}
    with CHECKPOINT_PATH.open(encoding="utf-8-sig", newline="") as csv_file:
        for row in csv.DictReader(csv_file):
            try:
                book_id = int(row["book_id"])
                record: dict[str, object] = {
                    "book_id": book_id,
                    "title": row["title"],
                    "category": row["category"],
                    "price_gbp": f"{float(row['price_gbp']):.2f}",
                    "rating": int(row["rating"]),
                    "available_quantity": int(row["available_quantity"]),
                }
            except (KeyError, TypeError, ValueError):
                continue

            if all(str(value).strip() for value in record.values()):
                records[book_id] = record

    print(f"Resuming with {len(records):,} records from the checkpoint")
    return records


def write_csv(path: Path, records: list[dict[str, object]]) -> None:
    """Write complete records to a UTF-8 CSV file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(records)


def scrape_books() -> list[dict[str, object]]:
    """Follow catalogue pagination until 1,000 unique records are collected."""
    records_by_id = load_checkpoint()
    next_url: str | None = START_URL
    page = 1

    with requests.Session() as session:
        session.headers.update({"User-Agent": USER_AGENT})

        while next_url and len(records_by_id) < TARGET_RECORDS:
            response = request_page(session, next_url)
            soup = BeautifulSoup(response.text, "html.parser")
            book_cards = soup.select("article.product_pod")

            if not book_cards:
                raise RuntimeError(f"No book records were found on page {page}.")

            for book_card in book_cards:
                listing = parse_listing(book_card)
                if listing is None:
                    continue

                book_id = int(listing["book_id"])
                if book_id in records_by_id:
                    continue

                detail_url = urljoin(response.url, str(listing.pop("detail_path")))
                detail_response = request_page(session, detail_url)
                detail_soup = BeautifulSoup(detail_response.text, "html.parser")
                detail = parse_detail(detail_soup)
                if detail is None:
                    raise RuntimeError(
                        f"Required detail fields were missing from {detail_url}."
                    )

                category, available_quantity = detail
                record = {
                    "book_id": listing["book_id"],
                    "title": listing["title"],
                    "category": category,
                    "price_gbp": f"{float(listing['price_gbp']):.2f}",
                    "rating": listing["rating"],
                    "available_quantity": available_quantity,
                }
                records_by_id[book_id] = record

            print(f"Page {page}: collected {len(records_by_id):,} unique records")
            write_csv(CHECKPOINT_PATH, list(records_by_id.values()))

            next_link = soup.select_one("li.next a")
            next_url = (
                urljoin(response.url, str(next_link["href"]))
                if next_link is not None
                else None
            )
            page += 1

    records = list(records_by_id.values())[:TARGET_RECORDS]
    if len(records) < TARGET_RECORDS:
        raise RuntimeError(
            f"Only {len(records):,} complete records were collected; "
            f"at least {TARGET_RECORDS:,} are required."
        )

    return records


def save_csv(records: list[dict[str, object]]) -> None:
    """Write the scraped records to the repository's data directory."""
    write_csv(OUTPUT_PATH, records)
    if CHECKPOINT_PATH.exists():
        CHECKPOINT_PATH.unlink()


def main() -> None:
    records = scrape_books()
    save_csv(records)
    print(f"Saved {len(records):,} records to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
