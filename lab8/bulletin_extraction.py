"""Structure-first PDF extraction for the DKU Undergraduate Bulletin.

This module preserves PDF text blocks as paragraph candidates. Word count is
never used to merge or split passages: blocks are merged only on layout and
continuation evidence, and split only when they exceed the embedding model's
token limit.
"""

from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from statistics import median

import pandas as pd
import pymupdf as fitz


START_PAGE = 10
MIN_EMBEDDING_WORDS = 5
SHORT_TEXT_WORDS = 15
HEADING_MATCH_THRESHOLD = 0.72
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'“•(])")
EXCLUDED_FLAGS = {
    "table_like",
    "table_heading",
    "table_intro",
    "toc_artifact",
    "figure_caption",
    "byline",
    "contact_list",
    "list_fragment",
    "short_label",
}
TERMINAL_RE = re.compile(r"""[.!?]["'’”)]?$""")
BULLET_RE = re.compile(r"^(?:[•●▪◦‣–—-]|\(?[a-z0-9ivx]+\)[.)]?)\s+", re.IGNORECASE)
COURSE_CODE_RE = re.compile(r"\b[A-Z]{2,10}\s*\d{2,3}[A-Z]?\b")

MOJIBAKE_REPLACEMENTS = {
    "��": "'",
    "�C": "–",
    "�D": "—",
    "\u00ad": "",
    "\ufb01": "fi",
    "\ufb02": "fl",
}


@dataclass
class TextBlock:
    page: int
    index: int
    x0: float
    y0: float
    x1: float
    y1: float
    page_width: float
    page_height: float
    text: str
    lines: list[str]
    font_size: float
    flags: set[str] = field(default_factory=set)


def clean_text(text: str) -> str:
    for bad, replacement in MOJIBAKE_REPLACEMENTS.items():
        text = text.replace(bad, replacement)
    text = re.sub(r"(\w)-\s+(\w)", r"\1\2", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" \t\r\n|")


def normalized(value: str) -> str:
    value = clean_text(value).lower()
    value = re.sub(r"\d+[a-z]?$", "", value).strip()
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def extract_outline(document: fitz.Document) -> list[dict]:
    return [
        {
            "page": int(item[2]),
            "depth": max(0, int(item[0]) - 1),
            "title": clean_text(item[1]),
        }
        for item in document.get_toc(simple=True)
        if int(item[2]) >= START_PAGE
    ]


def block_text(block: dict) -> tuple[str, list[str], float]:
    lines: list[str] = []
    sizes: list[float] = []
    for line in block.get("lines", []):
        spans = line.get("spans", [])
        value = clean_text("".join(span.get("text", "") for span in spans))
        if value:
            lines.append(value)
            sizes.extend(float(span.get("size", 0)) for span in spans if span.get("text", "").strip())

    joined = ""
    for line in lines:
        if not joined:
            joined = line
        elif joined.endswith("-") and line[:1].islower():
            joined = f"{joined[:-1]}{line}"
        else:
            joined = f"{joined} {line}"
    font_size = sum(sizes) / len(sizes) if sizes else 0.0
    return clean_text(joined), lines, font_size


def read_blocks(document: fitz.Document) -> dict[int, list[TextBlock]]:
    pages: dict[int, list[TextBlock]] = {}
    for page_number in range(START_PAGE, document.page_count + 1):
        page = document[page_number - 1]
        page_blocks: list[TextBlock] = []
        for index, raw in enumerate(page.get_text("dict", sort=True).get("blocks", [])):
            if raw.get("type") != 0:
                continue
            text, lines, font_size = block_text(raw)
            if not text:
                continue
            x0, y0, x1, y1 = raw["bbox"]
            page_blocks.append(
                TextBlock(
                    page=page_number,
                    index=index,
                    x0=float(x0),
                    y0=float(y0),
                    x1=float(x1),
                    y1=float(y1),
                    page_width=float(page.rect.width),
                    page_height=float(page.rect.height),
                    text=text,
                    lines=lines,
                    font_size=font_size,
                )
            )
        body_sizes = [block.font_size for block in page_blocks if block.font_size > 0]
        typical_size = median(body_sizes) if body_sizes else 0
        for block in page_blocks:
            looks_like_footnote = (
                block.y0 >= block.page_height * 0.72
                and typical_size > 0
                and block.font_size <= typical_size * 0.86
                and bool(re.match(r"^\d+\s+", block.text))
            )
            if looks_like_footnote:
                block.flags.add("footnote")
        pages[page_number] = page_blocks
    return pages


def margin_signature(text: str) -> str:
    text = normalized(text)
    return re.sub(r"\d+", "#", text)


def identify_margin_noise(pages: dict[int, list[TextBlock]]) -> set[str]:
    frequencies: Counter[str] = Counter()
    for blocks in pages.values():
        seen: set[str] = set()
        for block in blocks:
            near_margin = (
                block.y1 <= block.page_height * 0.09
                or block.y0 >= block.page_height * 0.91
            )
            if near_margin:
                signature = margin_signature(block.text)
                if signature:
                    seen.add(signature)
        frequencies.update(seen)
    threshold = max(8, round(len(pages) * 0.08))
    return {signature for signature, count in frequencies.items() if count >= threshold}


def is_margin_noise(block: TextBlock, repeated: set[str]) -> bool:
    standalone_page = bool(re.fullmatch(r"(?:page\s*)?\d{1,3}", block.text, re.IGNORECASE))
    near_margin = (
        block.y1 <= block.page_height * 0.09
        or block.y0 >= block.page_height * 0.91
    )
    return standalone_page or (near_margin and margin_signature(block.text) in repeated)


def heading_similarity(title: str, text: str) -> float:
    title_norm = normalized(title)
    text_norm = normalized(text)
    if not title_norm or not text_norm:
        return 0.0
    if text_norm == title_norm:
        return 1.0
    if text_norm.startswith(title_norm):
        return 0.98
    if title_norm.startswith(text_norm) and len(text_norm) >= 8:
        return 0.9
    return SequenceMatcher(None, title_norm, text_norm).ratio()


def match_headings(
    blocks: list[TextBlock], headings: list[dict]
) -> dict[int, list[dict]]:
    events: dict[int, list[dict]] = defaultdict(list)
    cursor_block = 0
    cursor_line = 0

    for heading in headings:
        best_index = None
        best_line_index = None
        best_line_text = ""
        best_score = 0.0
        for block_index in range(cursor_block, len(blocks)):
            lines = blocks[block_index].lines
            line_start = cursor_line if block_index == cursor_block else 0
            stop_search = False
            for line_index in range(line_start, len(lines)):
                candidates = [lines[line_index]]
                if line_index + 1 < len(lines):
                    candidates.append(f"{lines[line_index]} {lines[line_index + 1]}")
                for candidate in candidates:
                    score = heading_similarity(heading["title"], candidate)
                    if score > best_score:
                        best_index = block_index
                        best_line_index = line_index
                        best_line_text = candidate
                        best_score = score
                    if score >= 0.98:
                        stop_search = True
                        break
                if stop_search:
                    break
            if stop_search:
                break

        if best_index is not None and best_score >= HEADING_MATCH_THRESHOLD:
            events[best_index].append({**heading, "matched_line": best_line_text})
            cursor_block = best_index
            cursor_line = best_line_index or 0
    return events


def title_position(
    text: str,
    title: str,
    start: int = 0,
    matched_line: str = "",
) -> tuple[int, int] | None:
    title_clean = clean_text(title)
    search_start = start
    if matched_line:
        line_start = text.lower().find(clean_text(matched_line).lower(), start)
        if line_start >= 0:
            search_start = line_start

    found = text.lower().find(title_clean.lower(), search_start)
    if found >= 0:
        return found, found + len(title_clean)

    pattern = re.escape(title_clean).replace(r"\ ", r"\s+")
    match = re.search(pattern, text[search_start:], flags=re.IGNORECASE)
    if match:
        return search_start + match.start(), search_start + match.end()
    return None


def update_hierarchy(hierarchy: list[str], heading: dict) -> list[str]:
    depth = int(heading["depth"])
    hierarchy = hierarchy[:depth]
    while len(hierarchy) < depth:
        hierarchy.append("General")
    hierarchy.append(heading["title"])
    return hierarchy


def hierarchy_fields(hierarchy: list[str]) -> tuple[str, str, str]:
    chapter = hierarchy[0] if hierarchy else "Front Matter"
    section = hierarchy[1] if len(hierarchy) > 1 else "Overview"
    subsection = " › ".join(hierarchy[2:]) if len(hierarchy) > 2 else section
    return chapter, section, subsection


def looks_like_table(text: str, lines: list[str]) -> bool:
    course_codes = len(COURSE_CODE_RE.findall(text))
    explicit_header = bool(
        re.search(r"course\s+code\s+course\s+name\s+course\s+credit", text, re.IGNORECASE)
    )
    short_lines = sum(len(line.split()) <= 8 for line in lines)
    line_heavy = len(lines) >= 5 and short_lines / len(lines) >= 0.75
    return explicit_header or course_codes >= 3 or line_heavy


def quality_flags(text: str, lines: list[str]) -> set[str]:
    flags: set[str] = set()
    words = len(text.split())
    if looks_like_table(text, lines):
        flags.add("table_like")
    if not TERMINAL_RE.search(text) and not BULLET_RE.match(text):
        flags.add("no_terminal_punctuation")
    if re.match(r"^(?:table of contents|part \d+)\b", text, re.IGNORECASE):
        flags.add("toc_artifact")
    if re.match(r"^figure\s+\d+", text, re.IGNORECASE):
        flags.add("figure_caption")
    if re.match(r"^--?(?:prof|dr)\.", text, re.IGNORECASE):
        flags.add("byline")
    if re.search(r"\bcost of attendance\b", text, re.IGNORECASE):
        flags.add("table_heading")
    if len(re.findall(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", text)) >= 2:
        flags.add("contact_list")
    if (
        words < SHORT_TEXT_WORDS
        and not TERMINAL_RE.search(text)
        and (
            text.startswith("*")
            or bool(re.search(r"\s+\d(?:\.\d)?$", text))
        )
    ):
        flags.add("list_fragment")
    title_case_words = sum(
        token[:1].isupper()
        for token in re.findall(r"[A-Za-z][A-Za-z&/-]*", text)
    )
    if (
        words <= 8
        and not TERMINAL_RE.search(text)
        and title_case_words >= max(2, words // 2)
    ):
        flags.add("short_label")
    return flags


def should_merge(previous: dict, current: dict) -> bool:
    same_hierarchy = (
        previous["chapter"],
        previous["section"],
        previous["subsection"],
    ) == (
        current["chapter"],
        current["section"],
        current["subsection"],
    )
    if (
        same_hierarchy
        and previous["text"].rstrip().endswith(":")
        and BULLET_RE.match(current["text"])
    ):
        return True
    if BULLET_RE.match(previous["text"]) or BULLET_RE.match(current["text"]):
        return False
    strong_continuation = bool(
        re.match(r"^(?:[a-z]|[,;:)])", current["text"])
    )
    adjacent_page = current["page"] in {previous["page_end"], previous["page_end"] + 1}
    if (
        strong_continuation
        and adjacent_page
        and not TERMINAL_RE.search(previous["text"])
    ):
        return True
    if not same_hierarchy:
        return False

    course_metadata = bool(
        re.match(
            r"^(?:pre-?requisite|anti-?requisite|continuation of)\b",
            current["text"],
            re.IGNORECASE,
        )
    )
    if course_metadata:
        return True
    if TERMINAL_RE.search(previous["text"]):
        return False

    continuation = current["text"][:1].islower() or previous["text"].endswith("-")
    if previous["page_end"] != current["page"]:
        return continuation and current["page"] == previous["page_end"] + 1

    aligned = abs(previous["x0"] - current["x0"]) <= 18
    vertical_gap = current["y0"] - previous["y1"]
    line_height = max(10.0, previous["font_size"] * 1.5)
    visually_contiguous = aligned and -2 <= vertical_gap <= line_height
    return continuation or visually_contiguous


def merge_passage(previous: dict, current: dict) -> dict:
    joiner = "" if previous["text"].endswith("-") else " "
    previous["text"] = clean_text(
        f"{previous['text'][:-1] if previous['text'].endswith('-') else previous['text']}"
        f"{joiner}{current['text']}"
    )
    previous["page_end"] = current["page_end"]
    previous["y1"] = current["y1"]
    previous["lines"].extend(current["lines"])
    return previous


def same_hierarchy(first: dict, second: dict) -> bool:
    return all(
        first[key] == second[key] for key in ("chapter", "section", "subsection")
    )


def mark_table_intros(rows: list[dict]) -> None:
    """Exclude lead-in sentences whose content is an excluded table."""
    for current, following in zip(rows, rows[1:]):
        if (
            current["text"].rstrip().endswith(":")
            and same_hierarchy(current, following)
            and {"table_like", "table_heading"} & following["flags"]
        ):
            current["flags"].add("table_intro")


def split_sentences(text: str) -> list[str]:
    return [part.strip() for part in SENTENCE_SPLIT_RE.split(text) if part.strip()]


def split_for_token_limit(
    text: str,
    count_tokens: Callable[[str], int],
    max_tokens: int,
) -> list[str]:
    """Split at sentence boundaries into the fewest, most even chunks that fit."""
    total = count_tokens(text)
    if total <= max_tokens:
        return [text]

    sentences = split_sentences(text)
    pieces: list[str] = []
    for sentence in sentences:
        if count_tokens(sentence) <= max_tokens:
            pieces.append(sentence)
            continue
        # A single sentence over the limit (rare run-on lists) falls back to
        # word boundaries, still bounded by the tokenizer rather than words.
        words = sentence.split()
        current: list[str] = []
        for word in words:
            if current and count_tokens(" ".join(current + [word])) > max_tokens:
                pieces.append(" ".join(current))
                current = []
            current.append(word)
        if current:
            pieces.append(" ".join(current))

    target = total / math.ceil(total / max_tokens)
    chunks: list[str] = []
    current_chunk = ""
    for piece in pieces:
        candidate = f"{current_chunk} {piece}".strip()
        if current_chunk and (
            count_tokens(candidate) > max_tokens
            or count_tokens(current_chunk) >= target
        ):
            chunks.append(current_chunk)
            current_chunk = piece
        else:
            current_chunk = candidate
    if current_chunk:
        chunks.append(current_chunk)
    return chunks


def extract_structured_passages(
    pdf_path: Path,
    count_tokens: Callable[[str], int],
    max_tokens: int,
) -> pd.DataFrame:
    """Return every deduplicated passage with an include_for_embedding flag."""
    document = fitz.open(pdf_path)
    outline = extract_outline(document)
    outline_by_page: dict[int, list[dict]] = defaultdict(list)
    for heading in outline:
        outline_by_page[heading["page"]].append(heading)

    blocks_by_page = read_blocks(document)
    repeated_margins = identify_margin_noise(blocks_by_page)
    hierarchy: list[str] = []
    candidates: list[dict] = []

    def add_candidate(text: str, block: TextBlock) -> None:
        text = clean_text(text)
        if not text:
            return
        chapter, section, subsection = hierarchy_fields(hierarchy)
        candidate = {
            "chapter": chapter,
            "section": section,
            "subsection": subsection,
            "page": block.page,
            "page_end": block.page,
            "text": text,
            "x0": block.x0,
            "y0": block.y0,
            "y1": block.y1,
            "font_size": round(block.font_size, 2),
            "lines": [text],
        }
        if candidates and should_merge(candidates[-1], candidate):
            merge_passage(candidates[-1], candidate)
        else:
            candidates.append(candidate)

    for page_number in range(START_PAGE, document.page_count + 1):
        blocks = [
            block
            for block in blocks_by_page.get(page_number, [])
            if "footnote" not in block.flags
            and not is_margin_noise(block, repeated_margins)
        ]

        headings = outline_by_page.get(page_number, [])
        events = match_headings(blocks, headings)
        found_titles = {
            event["title"]
            for page_events in events.values()
            for event in page_events
        }

        for block_index, block in enumerate(blocks):
            block_cursor = 0
            for heading in events.get(block_index, []):
                position = title_position(
                    block.text,
                    heading["title"],
                    block_cursor,
                    heading.get("matched_line", ""),
                )
                if position is None:
                    # Fuzzy-matched headings are still used as hierarchy events,
                    # but cannot safely split text at an unknown character.
                    hierarchy = update_hierarchy(hierarchy, heading)
                    continue
                start, end = position
                add_candidate(block.text[block_cursor:start], block)
                hierarchy = update_hierarchy(hierarchy, heading)
                block_cursor = end
            add_candidate(block.text[block_cursor:], block)

        # Preserve the hierarchy for following pages even when a bookmark title
        # could not be matched to a visible text block on this page.
        for heading in headings:
            if heading["title"] not in found_titles:
                hierarchy = update_hierarchy(hierarchy, heading)

    passages: list[dict] = []
    seen_text: set[str] = set()
    for candidate in candidates:
        text = clean_text(candidate["text"])
        if text in seen_text:
            continue
        seen_text.add(text)
        passages.append(
            {
                **candidate,
                "text": text,
                "flags": quality_flags(text, candidate["lines"]),
            }
        )
    mark_table_intros(passages)

    rows: list[dict] = []
    for passage in passages:
        include = (
            len(passage["text"].split()) >= MIN_EMBEDDING_WORDS
            and not passage["flags"] & EXCLUDED_FLAGS
        )
        chunks = (
            split_for_token_limit(passage["text"], count_tokens, max_tokens)
            if include
            else [passage["text"]]
        )
        for chunk in chunks:
            rows.append(
                {
                    "chapter": passage["chapter"],
                    "section": passage["section"],
                    "subsection": passage["subsection"],
                    "page": passage["page"],
                    "text": chunk,
                    "word_count": len(chunk.split()),
                    "include_for_embedding": include,
                }
            )

    document.close()
    return pd.DataFrame(rows)
