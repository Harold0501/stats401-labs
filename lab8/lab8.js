const tooltip = d3.select("#lab8-tooltip");
const mapRoot = d3.select("#semantic-map");
const matrixRoot = d3.select("#topic-matrix");
const detailPanel = d3.select("#detail-panel");
const dataVersion = "2026-09-27-summary-layout";
const topicColors = [
    "#1f6d66",
    "#d65b35",
    "#6676aa",
    "#b78328",
    "#7f5a83",
    "#64813f",
    "#3c879f",
    "#a04c56",
    "#80684a"
];

const state = {
    query: "",
    section: "all",
    topic: "all",
    matrixCell: null,
    selectedId: null,
    neighborIds: new Set()
};

let passages = [];
let passageById = new Map();
let points;
let matrixCells;
let color;
let zoomBehavior;
let mapSvg;

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function truncate(value, length = 46) {
    return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function formalSection(d) {
    return `${d.chapter} › ${d.section}`;
}

function compactSectionLabel(value, length = 46) {
    const section = value.split(" › ").at(-1);
    return truncate(section, length);
}

function showTooltip(event, markup) {
    tooltip
        .html(markup)
        .attr("aria-hidden", "false")
        .style("left", `${event.clientX + 14}px`)
        .style("top", `${event.clientY + 14}px`)
        .style("opacity", 1);
}

function moveTooltip(event) {
    tooltip
        .style("left", `${event.clientX + 14}px`)
        .style("top", `${event.clientY + 14}px`);
}

function hideTooltip() {
    tooltip.attr("aria-hidden", "true").style("opacity", 0);
}

function populateStats(summary) {
    d3.select("#raw-passage-count").text(d3.format(",")(summary.raw_passages));
    d3.select("#clean-passage-count").text(d3.format(",")(passages.length));
    d3.select("#average-passage-length").text(`${d3.format(".1f")(d3.mean(passages, d => d.word_count))} words`);
    d3.select("#formal-section-count").text(new Set(passages.map(formalSection)).size);
}

function drawColumnBars(selector, data, valueAccessor, formatValue) {
    const ranked = [...data]
        .sort((a, b) => d3.descending(valueAccessor(a), valueAccessor(b)))
        .slice(0, 10);
    const width = 520;
    const height = 360;
    const margin = { top: 32, right: 54, bottom: 112, left: 54 };
    const x = d3.scaleBand()
        .domain(d3.range(ranked.length))
        .range([margin.left, width - margin.right])
        .padding(0.2);
    const y = d3.scaleLinear()
        .domain([0, d3.max(ranked, valueAccessor) || 1])
        .nice()
        .range([height - margin.bottom, margin.top]);

    const svg = d3.select(selector)
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img");

    svg.append("g")
        .attr("class", "summary-axis")
        .attr("transform", `translate(${margin.left},0)`)
        .call(
            d3.axisLeft(y)
                .ticks(4)
                .tickSize(-(width - margin.left - margin.right))
                .tickFormat(formatValue)
        );

    const columns = svg.selectAll(".summary-column")
        .data(ranked)
        .join("g")
        .attr("class", "summary-column");

    columns.append("rect")
        .attr("class", "summary-bar")
        .attr("x", (_, index) => x(index))
        .attr("y", d => y(valueAccessor(d)))
        .attr("width", x.bandwidth())
        .attr("height", d => y(0) - y(valueAccessor(d)))
        .attr("rx", 2);

    columns.append("text")
        .attr("class", "summary-value")
        .attr("x", (_, index) => x(index) + x.bandwidth() / 2)
        .attr("y", d => y(valueAccessor(d)) - 7)
        .attr("text-anchor", "middle")
        .text(d => formatValue(valueAccessor(d)));

    columns.append("text")
        .attr("class", "summary-label")
        .attr("text-anchor", "end")
        .attr(
            "transform",
            (_, index) =>
                `translate(${x(index) + x.bandwidth() / 2},${height - margin.bottom + 13}) rotate(-48)`
        )
        .text(d => d.section
            ? compactSectionLabel(d.section, 27)
            : truncate(d.term, 22));
}

function drawSummaries(summary, sectionCounts) {
    drawColumnBars(
        "#section-summary",
        sectionCounts,
        d => d.count,
        d3.format(",")
    );
    drawColumnBars(
        "#term-summary",
        summary.top_terms,
        d => d.score,
        d3.format(".3f")
    );
}

function buildControls(topics, sections) {
    d3.select("#section-filter")
        .selectAll("option.section-option")
        .data(sections)
        .join("option")
        .attr("class", "section-option")
        .attr("value", d => d)
        .text(d => d);

    d3.select("#topic-filter")
        .selectAll("option.topic-option")
        .data(topics)
        .join("option")
        .attr("class", "topic-option")
        .attr("value", d => d)
        .text(d => d);

    d3.select("#topic-legend")
        .selectAll("span")
        .data(topics)
        .join("span")
        .html(d => `<i class="topic-swatch" style="background:${color(d)}"></i>${escapeHtml(d)}`);

    d3.select("#passage-search").on("input", function () {
        state.query = this.value.trim().toLowerCase();
        updateMapStyles();
    });

    d3.select("#section-filter").on("change", function () {
        state.section = this.value;
        updateMapStyles();
    });

    d3.select("#topic-filter").on("change", function () {
        state.topic = this.value;
        updateMapStyles();
    });

    d3.select("#reset-map").on("click", resetExploration);
}

function matchesControls(d) {
    const queryMatch = !state.query || d.text.toLowerCase().includes(state.query);
    const sectionMatch = state.section === "all" || formalSection(d) === state.section;
    const topicMatch = state.topic === "all" || d.cluster_name === state.topic;
    return queryMatch && sectionMatch && topicMatch;
}

function matchesMatrixCell(d) {
    return !state.matrixCell
        || (formalSection(d) === state.matrixCell.section
            && d.cluster_name === state.matrixCell.topic);
}

function updateMapStyles() {
    if (!points) return;

    const matchedCount = passages.filter(d => matchesControls(d) && matchesMatrixCell(d)).length;
    d3.select("#match-count").text(`${d3.format(",")(matchedCount)} passages`);

    points
        .classed("is-selected", d => d.passage_id === state.selectedId)
        .classed("is-neighbor", d => state.neighborIds.has(d.passage_id))
        .classed("is-muted", d => {
            const emphasized = d.passage_id === state.selectedId || state.neighborIds.has(d.passage_id);
            return !emphasized && !matchesControls(d);
        })
        .classed("is-context", d => {
            const emphasized = d.passage_id === state.selectedId || state.neighborIds.has(d.passage_id);
            return !emphasized && matchesControls(d) && !matchesMatrixCell(d);
        })
        .attr("pointer-events", d => matchesControls(d) ? "all" : "none");

    updateMatrixStyles();
}

function updateMatrixStyles() {
    if (!matrixCells) return;
    const selected = state.selectedId ? passageById.get(state.selectedId) : null;
    matrixCells
        .classed("is-active", d => Boolean(
            state.matrixCell
            && d.section === state.matrixCell.section
            && d.cluster_name === state.matrixCell.topic
        ))
        .classed("is-selected-point", d => Boolean(
            selected
            && d.section === formalSection(selected)
            && d.cluster_name === selected.cluster_name
        ));
}

function resetExploration() {
    state.query = "";
    state.section = "all";
    state.topic = "all";
    state.matrixCell = null;
    state.selectedId = null;
    state.neighborIds.clear();
    d3.select("#passage-search").property("value", "");
    d3.select("#section-filter").property("value", "all");
    d3.select("#topic-filter").property("value", "all");
    if (mapSvg && zoomBehavior) {
        mapSvg.transition().duration(350).call(zoomBehavior.transform, d3.zoomIdentity);
    }
    detailPanel.html(`
        <p class="detail-kicker">Details on demand</p>
        <h3>Select a passage</h3>
        <p>Click any point to inspect its formal location, full text, and nearest semantic neighbors.</p>
    `);
    updateMapStyles();
}

function drawSemanticMap() {
    const width = 1080;
    const height = 680;
    const padding = 35;
    const x = d3.scaleLinear()
        .domain(d3.extent(passages, d => d.x))
        .nice()
        .range([padding, width - padding]);
    const y = d3.scaleLinear()
        .domain(d3.extent(passages, d => d.y))
        .nice()
        .range([height - padding, padding]);
    const radius = d3.scaleSqrt()
        .domain(d3.extent(passages, d => d.word_count))
        .range([2.8, 8.5]);

    mapRoot.html("").attr("aria-busy", "false");
    mapSvg = mapRoot.append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-label", "UMAP projection of bulletin passage embeddings");

    const clipId = "semantic-map-clip";
    mapSvg.append("defs")
        .append("clipPath")
        .attr("id", clipId)
        .append("rect")
        .attr("width", width)
        .attr("height", height);

    const viewport = mapSvg.append("g")
        .attr("clip-path", `url(#${clipId})`);

    points = viewport.selectAll("circle")
        .data(passages)
        .join("circle")
        .attr("class", "passage-point")
        .attr("cx", d => x(d.x))
        .attr("cy", d => y(d.y))
        .attr("r", d => radius(d.word_count))
        .attr("fill", d => color(d.cluster_name))
        .attr("tabindex", 0)
        .attr("role", "button")
        .attr("aria-label", d => `${d.cluster_name}, ${d.chapter}, page ${d.page}`)
        .on("mouseenter focus", (event, d) => showTooltip(event, `
            <strong>${escapeHtml(d.cluster_name)}</strong>
            <span>${escapeHtml(d.chapter)}</span>
            <span>Page ${d.page} · ${d.word_count} words</span>
        `))
        .on("mousemove", moveTooltip)
        .on("mouseleave blur", hideTooltip)
        .on("click", (event, d) => {
            event.stopPropagation();
            selectPassage(d.passage_id);
        })
        .on("keydown", (event, d) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                selectPassage(d.passage_id);
            }
        });

    zoomBehavior = d3.zoom()
        .scaleExtent([0.75, 12])
        .on("zoom", event => viewport.attr("transform", event.transform));

    mapSvg.call(zoomBehavior).on("dblclick.zoom", null);
    updateMapStyles();
}

function selectPassage(passageId) {
    const passage = passageById.get(passageId);
    if (!passage) return;

    state.selectedId = passageId;
    state.neighborIds = new Set(passage.neighbor_ids.filter(id => passageById.has(id)));
    state.matrixCell = null;
    updateDetailPanel(passage);
    updateMapStyles();
}

function updateDetailPanel(passage) {
    const neighbors = passage.neighbor_ids
        .map(id => passageById.get(id))
        .filter(Boolean);

    detailPanel.html(`
        <p class="detail-kicker">${escapeHtml(passage.passage_id)} · Selected passage</p>
        <h3>${escapeHtml(passage.cluster_name)}</h3>
        <dl class="detail-list">
            <dt>Chapter</dt><dd>${escapeHtml(passage.chapter)}</dd>
            <dt>Section</dt><dd>${escapeHtml(passage.section)}</dd>
            <dt>Subsection</dt><dd>${escapeHtml(passage.subsection)}</dd>
            <dt>Page</dt><dd>${passage.page}</dd>
            <dt>Length</dt><dd>${passage.word_count} words</dd>
        </dl>
        <p class="detail-text">${escapeHtml(passage.text)}</p>
        <h4 class="neighbor-heading">Five nearest semantic neighbors</h4>
        <div class="neighbor-list">
            ${neighbors.map(neighbor => `
                <button class="neighbor-button" type="button" data-passage-id="${neighbor.passage_id}">
                    <strong>${escapeHtml(neighbor.chapter)} · p. ${neighbor.page}</strong>
                    <span>${escapeHtml(truncate(neighbor.text, 105))}</span>
                </button>
            `).join("")}
        </div>
    `);

    detailPanel.selectAll(".neighbor-button").on("click", function () {
        selectPassage(this.dataset.passageId);
    });
}

function sectionsInDocumentOrder() {
    return Array.from(new Set(passages.map(formalSection)));
}

function drawMatrix(matrixData, topics, sections) {
    const width = 940;
    const margin = { top: 200, right: 20, bottom: 20, left: 300 };
    const rowHeight = 24;
    const groupHeight = 30;
    const chapterOf = section => section.split(" › ")[0];

    const rows = [];
    let cursor = margin.top;
    sections.forEach((section, index) => {
        if (index === 0 || chapterOf(section) !== chapterOf(sections[index - 1])) {
            rows.push({ type: "chapter", label: chapterOf(section), y: cursor });
            cursor += groupHeight;
        }
        rows.push({ type: "section", section, y: cursor });
        cursor += rowHeight;
    });
    const height = cursor + margin.bottom;
    const rowY = new Map(rows.filter(d => d.type === "section").map(d => [d.section, d.y]));

    const x = d3.scaleBand()
        .domain(topics)
        .range([margin.left, width - margin.right])
        .paddingInner(0.08);
    const cellHeight = rowHeight - 3;
    const maxCount = d3.max(matrixData, d => d.count) || 1;
    const fill = d3.scaleSequentialLog()
        .domain([1, maxCount])
        .interpolator(d3.interpolateRgb("#aac9c0", "#123f3c"));

    d3.select("#matrix-key-min").text("1 passage");
    d3.select("#matrix-key-max").text(`${d3.format(",")(maxCount)} passages`);

    const matrixLookup = new Map(
        matrixData.map(d => [`${d.section}|${d.cluster_name}`, d])
    );
    const cells = sections.flatMap(section => topics.map(topic => {
        const existing = matrixLookup.get(`${section}|${topic}`);
        return existing || { section, cluster_name: topic, count: 0 };
    }));

    matrixRoot.html("").attr("aria-busy", "false");
    const svg = matrixRoot.append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-label", "Matrix of passage counts by formal bulletin section and semantic topic");

    const chapterRows = rows.filter(d => d.type === "chapter");
    svg.selectAll(".topic-matrix-rule")
        .data(chapterRows)
        .join("line")
        .attr("class", "topic-matrix-rule")
        .attr("x1", 12)
        .attr("x2", width - margin.right)
        .attr("y1", d => d.y + 4)
        .attr("y2", d => d.y + 4);

    svg.selectAll(".topic-matrix-chapter")
        .data(chapterRows)
        .join("text")
        .attr("class", "topic-matrix-chapter")
        .attr("x", 12)
        .attr("y", d => d.y + groupHeight - 9)
        .text(d => d.label);

    svg.selectAll(".topic-matrix-label")
        .data(rows.filter(d => d.type === "section"))
        .join("text")
        .attr("class", "topic-matrix-label")
        .attr("x", margin.left - 10)
        .attr("y", d => d.y + cellHeight / 2 + 4)
        .attr("text-anchor", "end")
        .text(d => truncate(d.section.split(" › ")[1], 44))
        .append("title")
        .text(d => d.section);

    svg.selectAll(".topic-matrix-topic")
        .data(topics)
        .join("text")
        .attr("class", "topic-matrix-topic")
        .attr("text-anchor", "end")
        .attr("transform", d => `translate(${x(d) + x.bandwidth() / 2},${margin.top - 10}) rotate(45)`)
        .text(d => d);

    matrixCells = svg.selectAll("rect")
        .data(cells)
        .join("rect")
        .attr("class", d => d.count ? "topic-matrix-cell" : "topic-matrix-cell is-empty")
        .attr("x", d => x(d.cluster_name))
        .attr("y", d => rowY.get(d.section))
        .attr("width", x.bandwidth())
        .attr("height", cellHeight)
        .attr("rx", 3)
        .attr("fill", d => d.count ? fill(d.count) : "none")
        .attr("tabindex", d => d.count ? 0 : null)
        .attr("role", d => d.count ? "button" : null)
        .attr("aria-label", d => d.count
            ? `${d.section}, ${d.cluster_name}: ${d.count} passages`
            : null)
        .on("mouseenter focus", (event, d) => showTooltip(event, `
            <strong>${escapeHtml(d.cluster_name)}</strong>
            <span>${escapeHtml(d.section)}</span>
            <span>${d3.format(",")(d.count)} passages</span>
        `))
        .on("mousemove", moveTooltip)
        .on("mouseleave blur", hideTooltip)
        .on("click", (_, d) => toggleMatrixCell(d))
        .on("keydown", (event, d) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleMatrixCell(d);
            }
        });

    updateMatrixStyles();
}

function toggleMatrixCell(d) {
    const alreadySelected = state.matrixCell
        && state.matrixCell.section === d.section
        && state.matrixCell.topic === d.cluster_name;
    state.matrixCell = alreadySelected
        ? null
        : { section: d.section, topic: d.cluster_name };
    state.selectedId = null;
    state.neighborIds.clear();
    if (state.matrixCell) {
        detailPanel.html(`
            <p class="detail-kicker">Matrix selection</p>
            <h3>${escapeHtml(d.cluster_name)}</h3>
            <dl class="detail-list">
                <dt>Section</dt><dd>${escapeHtml(d.section)}</dd>
                <dt>Passages</dt><dd>${d3.format(",")(d.count)}</dd>
            </dl>
            <p>Matching points are emphasized on the semantic map; all other visible passages remain as context.</p>
        `);
    }
    updateMapStyles();
}

function topicBreadth(matrixData) {
    return d3.rollups(
        matrixData.filter(d => d.count > 0),
        values => new Set(values.map(d => d.section)).size,
        d => d.cluster_name
    ).sort((a, b) => d3.descending(a[1], b[1]));
}

function sectionDiversity(matrixData) {
    return d3.rollups(
        matrixData,
        values => {
            const total = d3.sum(values, d => d.count);
            const entropy = -d3.sum(values, d => {
                const p = d.count / total;
                return p ? p * Math.log(p) : 0;
            });
            return { entropy, topics: values.filter(d => d.count > 0).length };
        },
        d => d.section
    ).sort((a, b) => d3.descending(a[1].entropy, b[1].entropy));
}

function crossSectionNeighborPair() {
    for (const passage of passages) {
        const neighbor = passage.neighbor_ids
            .map(id => passageById.get(id))
            .find(candidate => candidate && formalSection(candidate) !== formalSection(passage));
        if (neighbor) return [passage, neighbor];
    }
    return null;
}

function populateFindings(topicCounts, matrixData) {
    const topicSentence = topicCounts
        .slice(0, 5)
        .map(d => `${d.cluster_name} (${d3.format(",")(d.count)})`)
        .join(", ");
    d3.select("#finding-topics").text(
        `Nine clusters organize the corpus, each named by its three most distinctive terms. The largest are ${topicSentence}. The labels mix disciplinary course content with academic rules and institutional identity, so semantic regions follow both curricular and administrative lines.`
    );

    const broad = topicBreadth(matrixData).slice(0, 2);
    d3.select("#finding-cross-section").text(
        `${broad.map(([topic, count]) => `${topic} appears in ${count} formal sections`).join(", while ")}. Their wide matrix columns show that semantic themes recur outside the sections where their names might suggest they belong.`
    );

    const diverse = sectionDiversity(matrixData).slice(0, 2);
    d3.select("#finding-diversity").text(
        `${diverse.map(([section, result]) => `${section} spans ${result.topics} topics`).join("; ")}. These sections also have the highest topic entropy, indicating a comparatively even semantic mix rather than one dominant cluster.`
    );

    const pair = crossSectionNeighborPair();
    if (pair) {
        d3.select("#finding-neighbors").text(
            `A cross-section nearest-neighbor link connects page ${pair[0].page} in ${formalSection(pair[0])} (“${truncate(pair[0].text, 74)}”) with page ${pair[1].page} in ${formalSection(pair[1])} (“${truncate(pair[1].text, 74)}”). The map surfaces this relationship despite their formal separation.`
        );
    }

    const creditPassages = passages.filter(d => /\bcredits?\b/i.test(d.text));
    const creditTopics = d3.rollups(
        creditPassages,
        values => values.length,
        d => d.cluster_name
    ).sort((a, b) => d3.descending(a[1], b[1]));
    const creditSections = new Set(creditPassages.map(formalSection)).size;
    d3.select("#finding-search").text(
        `“Credit” appears in ${d3.format(",")(creditPassages.length)} passages across ${creditSections} formal sections and ${creditTopics.length} semantic topics. It is concentrated in ${creditTopics.slice(0, 3).map(([topic]) => topic).join(", ")}, so the concept occupies several regions rather than one isolated neighborhood.`
    );
}

function showLoadError(error) {
    console.error(error);
    const message = "The Lab 8 data could not be loaded. Serve the repository through a local web server and try again.";
    mapRoot.html(`<p class="chart-error">${message}</p>`).attr("aria-busy", "false");
    matrixRoot.html(`<p class="chart-error">${message}</p>`).attr("aria-busy", "false");
    d3.select("#corpus-stats").html(`<p class="chart-error">${message}</p>`);
}

Promise.all([
    d3.csv(`../data/lab8_embedding_map.csv?v=${dataVersion}`, d => ({
        ...d,
        page: +d.page,
        word_count: d.text.trim().split(/\s+/).filter(Boolean).length,
        x: +d.x,
        y: +d.y,
        neighbor_ids: d.neighbor_ids.split("|").filter(Boolean)
    })),
    d3.json(`../data/lab8_summary.json?v=${dataVersion}`)
])
    .then(([passageData, summary]) => {
        passages = passageData;
        passageById = new Map(passages.map(d => [d.passage_id, d]));
        const matrixData = d3.flatRollup(
            passages,
            values => values.length,
            formalSection,
            d => d.cluster_name
        ).map(([section, cluster_name, count]) => ({ section, cluster_name, count }));
        const sectionCounts = d3.rollups(
            passages,
            values => values.length,
            formalSection
        ).map(([section, count]) => ({ section, count }));
        const topicCounts = d3.rollups(
            passages,
            values => values.length,
            d => d.cluster_name
        )
            .map(([cluster_name, count]) => ({ cluster_name, count }))
            .sort((a, b) => d3.descending(a.count, b.count));
        const topics = topicCounts.map(d => d.cluster_name);
        const sections = sectionsInDocumentOrder();
        color = d3.scaleOrdinal(topics, topicColors);

        populateStats(summary);
        drawSummaries(summary, sectionCounts);
        buildControls(topics, sections);
        drawSemanticMap();
        drawMatrix(matrixData, topics, sections);
        populateFindings(topicCounts, matrixData);
    })
    .catch(showLoadError);
