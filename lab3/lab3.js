const table = d3.select("#data-table");
const tableBody = table.select("tbody");
const statusMessage = d3.select("#table-status");

const labels = {
    work_id: "Work ID",
    title: "Title",
    authors: "Author(s)",
    first_publish_year: "First published",
    edition_count: "Editions",
    languages: "Languages"
};

const numericColumns = new Set(["first_publish_year", "edition_count"]);
const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base"
});

let allRows = [];
let visibleRows = [];
let sortColumn = "title";
let sortAscending = true;

function compareRows(a, b, column) {
    if (numericColumns.has(column)) {
        const aValue = Number(a[column]);
        const bValue = Number(b[column]);
        const aMissing = !Number.isFinite(aValue) || a[column] === "";
        const bMissing = !Number.isFinite(bValue) || b[column] === "";

        if (aMissing || bMissing) {
            if (aMissing && bMissing) return 0;
            return aMissing ? 1 : -1;
        }

        return aValue - bValue;
    }

    return collator.compare(a[column] ?? "", b[column] ?? "");
}

function updateHeaderState() {
    table.selectAll("th")
        .attr("aria-sort", column => {
            if (column !== sortColumn) return "none";
            return sortAscending ? "ascending" : "descending";
        })
        .select(".sort-indicator")
        .text(column => {
            if (column !== sortColumn) return "↕";
            return sortAscending ? "↑" : "↓";
        });
}

function renderRows() {
    visibleRows.sort((a, b) => {
        const result = compareRows(a, b, sortColumn);
        return sortAscending ? result : -result;
    });

    const rows = tableBody
        .selectAll("tr")
        .data(visibleRows, row => row.work_id)
        .join("tr");

    rows.selectAll("td")
        .data(row => allRows.columns.map(column => ({
            column,
            value: row[column]
        })))
        .join("td")
        .attr("data-label", cell => labels[cell.column] ?? cell.column)
        .classed("numeric-cell", cell => numericColumns.has(cell.column))
        .text(cell => cell.value || "—");

    updateHeaderState();
}

d3.csv("../data/lab3_data.csv", row => ({
    ...row,
    edition_count: row.edition_count === "" ? "" : Number(row.edition_count),
    first_publish_year: row.first_publish_year === ""
        ? ""
        : Number(row.first_publish_year)
}))
    .then(data => {
        allRows = data;
        visibleRows = [...data];

        const header = table.select("thead")
            .append("tr");

        const headerCells = header.selectAll("th")
            .data(data.columns)
            .join("th")
            .attr("scope", "col")
            .attr("aria-sort", "none");

        headerCells.append("button")
            .attr("type", "button")
            .attr("aria-label", column => `Sort by ${labels[column] ?? column}`)
            .on("click", (event, column) => {
                if (sortColumn === column) {
                    sortAscending = !sortAscending;
                } else {
                    sortColumn = column;
                    sortAscending = true;
                }
                renderRows();
            })
            .call(button => {
                button.append("span")
                    .text(column => labels[column] ?? column);
                button.append("span")
                    .attr("class", "sort-indicator")
                    .attr("aria-hidden", "true")
                    .text("↕");
            });

        renderRows();
    })
    .catch(error => {
        console.error(error);
        statusMessage
            .attr("class", "table-error")
            .text("The dataset could not be loaded. Please refresh the page.");
    });
