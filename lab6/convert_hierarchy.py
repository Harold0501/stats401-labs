"""Convert the Lab 6 GDP table into the nested JSON consumed by D3."""

from pathlib import Path
import json

import pandas as pd


BASE_DIR = Path(__file__).resolve().parent
CSV_PATH = BASE_DIR.parent / "data" / "lab6_assignment_gdp.csv"
JSON_PATH = BASE_DIR.parent / "data" / "lab6_assignment_gdp.json"


def build_hierarchy(dataframe: pd.DataFrame, levels: list[str]) -> list[dict]:
    """Recursively group rows, preserving GDP and status on country leaves."""
    current_level = levels[0]

    if len(levels) == 1:
        return [
            {
                "name": row[current_level],
                "gdp": int(row["gdp_billion_usd"]),
                "status": row["gdp_status"],
            }
            for _, row in dataframe.iterrows()
        ]

    return [
        {
            "name": value,
            "children": build_hierarchy(group, levels[1:]),
        }
        for value, group in dataframe.groupby(current_level, sort=False)
    ]


def main() -> None:
    dataframe = pd.read_csv(CSV_PATH)
    hierarchy = {
        "name": "World",
        "children": build_hierarchy(
            dataframe,
            ["continent", "area", "country"],
        ),
    }

    with JSON_PATH.open("w", encoding="utf-8") as output_file:
        json.dump(hierarchy, output_file, indent=2, ensure_ascii=False)
        output_file.write("\n")

    print(f"Wrote {JSON_PATH}")


if __name__ == "__main__":
    main()
