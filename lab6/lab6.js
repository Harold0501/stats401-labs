const statusOrder = ["Increase", "Unchanged", "Decrease"];
const statusColors = new Map([
    ["Increase", "#1f766d"],
    ["Unchanged", "#9da8a4"],
    ["Decrease", "#d95d3b"]
]);
const tooltip = d3.select("#gdp-tooltip");
const formatGDP = d3.format(",.0f");

function showTooltip(event, node) {
    const [, continent, area] = node.ancestors().reverse().map(d => d.data.name);
    tooltip
        .html(`
            <strong>${node.data.name}</strong>
            <span>${continent} · ${area}</span>
            <span>GDP: $${formatGDP(node.value)} billion</span>
            <span>Status: ${node.data.status}</span>
        `)
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

function buildLegend() {
    d3.select("#status-legend")
        .selectAll("span")
        .data(statusOrder)
        .join("span")
        .html(d => `<i style="background:${statusColors.get(d)}"></i>${d}`);
}

function fits(node, minimumWidth, minimumHeight) {
    return node.x1 - node.x0 >= minimumWidth && node.y1 - node.y0 >= minimumHeight;
}

function truncateLabel(label, widthAvailable) {
    const maxCharacters = Math.floor((widthAvailable - 14) / 7);
    if (maxCharacters < 4) return "";
    return label.length <= maxCharacters
        ? label
        : `${label.slice(0, maxCharacters - 1)}…`;
}

function drawTreemap(selector, data, tile, label) {
    const width = 1000;
    const height = 620;
    const root = d3.hierarchy(data)
        .sum(d => d.gdp || 0)
        .sort((a, b) => b.value - a.value);

    d3.treemap()
        .tile(tile)
        .size([width, height])
        .paddingOuter(4)
        .paddingTop(d => d.depth === 1 ? 27 : d.depth === 2 ? 19 : 0)
        .paddingInner(3)
        .round(true)(root);

    const container = d3.select(selector);
    container.selectAll("*").remove();

    const svg = container.append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-label", `${label} treemap of GDP by continent, area, and country`);

    svg.append("rect")
        .attr("class", "treemap-background")
        .attr("width", width)
        .attr("height", height);

    const continents = svg.append("g")
        .selectAll("g")
        .data(root.children || [])
        .join("g");

    continents.append("rect")
        .attr("class", "continent-frame")
        .attr("x", d => d.x0)
        .attr("y", d => d.y0)
        .attr("width", d => Math.max(0, d.x1 - d.x0))
        .attr("height", d => Math.max(0, d.y1 - d.y0));

    continents.append("text")
        .attr("class", "continent-label")
        .attr("x", d => d.x0 + 8)
        .attr("y", d => d.y0 + 18)
        .text(d => fits(d, 72, 28) ? `${d.data.name} · $${formatGDP(d.value)}B` : "");

    const areas = svg.append("g")
        .selectAll("g")
        .data(root.descendants().filter(d => d.depth === 2))
        .join("g");

    areas.append("rect")
        .attr("class", "area-frame")
        .attr("x", d => d.x0)
        .attr("y", d => d.y0)
        .attr("width", d => Math.max(0, d.x1 - d.x0))
        .attr("height", d => Math.max(0, d.y1 - d.y0));

    areas.append("text")
        .attr("class", "area-label")
        .attr("x", d => d.x0 + 6)
        .attr("y", d => d.y0 + 14)
        .text(d => fits(d, 78, 22) ? d.data.name : "");

    const cells = svg.append("g")
        .selectAll("g")
        .data(root.leaves())
        .join("g")
        .attr("class", "gdp-cell")
        .attr("tabindex", 0)
        .attr("role", "img")
        .attr("aria-label", d => {
            const path = d.ancestors().reverse().slice(1).map(node => node.data.name).join(", ");
            return `${path}; GDP $${formatGDP(d.value)} billion; status ${d.data.status}`;
        })
        .attr("transform", d => `translate(${d.x0},${d.y0})`);

    cells.append("rect")
        .attr("width", d => Math.max(0, d.x1 - d.x0))
        .attr("height", d => Math.max(0, d.y1 - d.y0))
        .attr("fill", d => statusColors.get(d.data.status));

    cells.append("text")
        .attr("class", "country-label")
        .attr("x", 7)
        .attr("y", 17)
        .each(function (d) {
            const widthAvailable = d.x1 - d.x0;
            const heightAvailable = d.y1 - d.y0;
            if (widthAvailable < 54 || heightAvailable < 25) return;

            const text = d3.select(this);
            text.append("tspan").text(truncateLabel(d.data.name, widthAvailable));
            if (widthAvailable >= 78 && heightAvailable >= 43) {
                text.append("tspan")
                    .attr("x", 7)
                    .attr("dy", 15)
                    .attr("class", "country-value")
                    .text(`$${formatGDP(d.value)}B`);
            }
        });

    cells
        .on("pointerenter", showTooltip)
        .on("pointermove", moveTooltip)
        .on("pointerleave", hideTooltip)
        .on("focus", function (event, d) {
            const bounds = this.getBoundingClientRect();
            showTooltip({ clientX: bounds.right, clientY: bounds.top }, d);
        })
        .on("blur", hideTooltip);
}

buildLegend();

d3.json("../data/lab6_assignment_gdp.json")
    .then(data => {
        drawTreemap("#treemap-squarify", data, d3.treemapSquarify, "Squarify");
        drawTreemap("#treemap-slice-dice", data, d3.treemapSliceDice, "Slice–Dice");
    })
    .catch(error => {
        console.error(error);
        d3.selectAll(".treemap-visualization")
            .html('<p class="chart-error">The GDP hierarchy could not be loaded. Serve this project over HTTP and try again.</p>');
    });
