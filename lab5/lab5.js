const networkRoot = d3.select("#network-chart");
const matrixRoot = d3.select("#matrix-chart");
const tooltip = d3.select("#network-tooltip");

const districtOrder = ["Central", "North", "South", "East", "West"];
const districtColors = new Map([
    ["Central", "#c94b2c"],
    ["North", "#25766f"],
    ["South", "#d49b29"],
    ["East", "#5f6fa8"],
    ["West", "#9a5d87"]
]);
const routeColors = new Map([
    ["Metro", "#146c66"],
    ["Express", "#d55231"],
    ["Shuttle", "#6475aa"]
]);
const stationSymbols = new Map([
    ["Local", d3.symbolCircle],
    ["Transfer", d3.symbolDiamond],
    ["Terminal", d3.symbolSquare]
]);
const stationTypeOrder = ["Local", "Transfer", "Terminal"];

let simulation;

function symbolPath(type, size) {
    return d3.symbol().type(stationSymbols.get(type)).size(size)();
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

function buildLegends() {
    ["#district-legend", "#matrix-district-legend"].forEach(selector => {
        d3.select(selector)
            .selectAll("span")
            .data(districtOrder)
            .join("span")
            .html(d => `<i class="district-swatch" style="background:${districtColors.get(d)}"></i>${d}`);
    });

    ["#station-type-legend", "#matrix-station-type-legend"].forEach(selector => {
        const symbolLegend = d3.select(selector)
            .selectAll("span")
            .data(stationTypeOrder)
            .join("span");
        symbolLegend.append("svg")
            .attr("viewBox", "-9 -9 18 18")
            .attr("aria-hidden", "true")
            .append("path")
            .attr("d", d => symbolPath(d, 95));
        symbolLegend.append("em").text(d => d);
    });

    ["#route-legend", "#matrix-route-legend"].forEach(selector => {
        d3.select(selector)
            .selectAll("span")
            .data([...routeColors.keys()])
            .join("span")
            .html(d => `<i class="route-swatch route-swatch--${d.toLowerCase()}" style="border-color:${routeColors.get(d)}"></i>${d}`);
    });
}

function drawNetwork(nodes, links) {
    const width = 1080;
    const height = 700;
    const passengerScale = d3.scaleSqrt()
        .domain(d3.extent(nodes, d => d.daily_passengers))
        .range([170, 680]);
    const travelScale = d3.scaleLinear()
        .domain(d3.extent(links, d => d.travel_time_min))
        .range([1.7, 5.8]);

    networkRoot.selectAll("*").remove();
    const svg = networkRoot.append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-labelledby", "network-heading network-description");

    const link = svg.append("g")
        .attr("class", "network-links")
        .selectAll("line")
        .data(links)
        .join("line")
        .attr("stroke", d => routeColors.get(d.route_type))
        .attr("stroke-width", d => travelScale(d.travel_time_min))
        .attr("stroke-dasharray", d => {
            if (d.route_type === "Express") return "10,5";
            if (d.route_type === "Shuttle") return "3,5";
            return null;
        })
        .attr("stroke-opacity", 0.72);

    const node = svg.append("g")
        .attr("class", "network-nodes")
        .selectAll("g")
        .data(nodes)
        .join("g")
        .attr("class", "network-node")
        .attr("tabindex", 0)
        .attr("role", "img")
        .attr("aria-label", d => `${d.station_name}, ${d.district}, ${d.station_type}, ${d.daily_passengers.toLocaleString()} daily passengers, ${d.degree} direct connections`);

    node.append("path")
        .attr("d", d => symbolPath(d.station_type, passengerScale(d.daily_passengers)))
        .attr("fill", d => districtColors.get(d.district));

    node.append("text")
        .attr("x", 15)
        .attr("dy", "0.34em")
        .text(d => d.id.replace("s", ""));

    function connectedTo(selected, other) {
        return selected.id === other.id || links.some(linkRow =>
            (linkRow.source.id === selected.id && linkRow.target.id === other.id) ||
            (linkRow.target.id === selected.id && linkRow.source.id === other.id)
        );
    }

    function focusNode(event, selected) {
        node.classed("is-muted", other => !connectedTo(selected, other));
        link
            .classed("is-muted", row => row.source.id !== selected.id && row.target.id !== selected.id)
            .classed("is-active", row => row.source.id === selected.id || row.target.id === selected.id);
        const markup = `
            <strong>${selected.station_name}</strong>
            <span>${selected.district} district · ${selected.station_type}</span>
            <span>${selected.daily_passengers.toLocaleString()} daily passengers</span>
            <span>${selected.degree} direct connection${selected.degree === 1 ? "" : "s"}</span>
        `;
        showTooltip(event, markup);
    }

    function clearFocus() {
        node.classed("is-muted", false);
        link.classed("is-muted", false).classed("is-active", false);
        hideTooltip();
    }

    node
        .on("pointerenter", focusNode)
        .on("pointermove", moveTooltip)
        .on("pointerleave", clearFocus)
        .on("focus", function (event, selected) {
            const bounds = this.getBoundingClientRect();
            focusNode({ clientX: bounds.right, clientY: bounds.top }, selected);
        })
        .on("blur", clearFocus);

    const random = d3.randomLcg(0.401);
    simulation = d3.forceSimulation(nodes)
        .randomSource(random)
        .force("link", d3.forceLink(links).id(d => d.id).distance(d => 58 + d.travel_time_min * 2).strength(0.72))
        .force("charge", d3.forceManyBody().strength(-155))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("x", d3.forceX(width / 2).strength(0.025))
        .force("y", d3.forceY(height / 2).strength(0.03))
        .force("collision", d3.forceCollide().radius(d => Math.sqrt(passengerScale(d.daily_passengers) / Math.PI) + 18).iterations(2))
        .on("tick", () => {
            node.each(d => {
                d.x = Math.max(34, Math.min(width - 62, d.x));
                d.y = Math.max(34, Math.min(height - 34, d.y));
            });
            link
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);
            node.attr("transform", d => `translate(${d.x},${d.y})`);
        });

    function dragStarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.25).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(event, d) {
        d.fx = Math.max(30, Math.min(width - 30, event.x));
        d.fy = Math.max(30, Math.min(height - 30, event.y));
    }

    function dragEnded(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }

    node.call(d3.drag().on("start", dragStarted).on("drag", dragged).on("end", dragEnded));

    d3.select("#reset-network").on("click", () => {
        nodes.forEach(d => {
            d.fx = null;
            d.fy = null;
            d.x = NaN;
            d.y = NaN;
            d.vx = 0;
            d.vy = 0;
        });
        simulation.nodes(nodes).alpha(1).restart();
    });
}

function drawMatrix(nodes, links) {
    const orderedNodes = [...nodes].sort((a, b) =>
        d3.ascending(+a.id.slice(1), +b.id.slice(1))
    );
    const linkByPair = new Map();
    links.forEach(link => {
        const sourceId = typeof link.source === "object" ? link.source.id : link.source;
        const targetId = typeof link.target === "object" ? link.target.id : link.target;
        linkByPair.set(`${sourceId}|${targetId}`, link);
        linkByPair.set(`${targetId}|${sourceId}`, link);
    });

    const cells = orderedNodes.flatMap(row => orderedNodes.map(col => ({
        row,
        col,
        link: linkByPair.get(`${row.id}|${col.id}`) || null
    })));
    const width = 730;
    const height = 585;
    const matrixSize = 500;
    const left = 115;
    const top = 55;
    const x = d3.scaleBand().domain(orderedNodes.map(d => d.id)).range([0, matrixSize]).paddingInner(0.06);
    const y = d3.scaleBand().domain(orderedNodes.map(d => d.id)).range([0, matrixSize]).paddingInner(0.06);
    const opacity = d3.scaleLinear().domain(d3.extent(links, d => d.travel_time_min)).range([0.34, 1]);

    matrixRoot.selectAll("*").remove();
    const svg = matrixRoot.append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-labelledby", "matrix-heading matrix-description");
    const matrix = svg.append("g").attr("transform", `translate(${left},${top})`);

    matrix.append("rect")
        .attr("class", "matrix-frame")
        .attr("width", matrixSize)
        .attr("height", matrixSize);

    const cell = matrix.selectAll("rect.matrix-cell")
        .data(cells)
        .join("rect")
        .attr("class", "matrix-cell")
        .attr("x", d => x(d.col.id))
        .attr("y", d => y(d.row.id))
        .attr("width", x.bandwidth())
        .attr("height", y.bandwidth())
        .attr("fill", d => d.link ? routeColors.get(d.link.route_type) : "#ece8dc")
        .attr("fill-opacity", d => d.link ? opacity(d.link.travel_time_min) : 0.72)
        .attr("tabindex", d => d.link ? 0 : -1)
        .attr("role", "img")
        .attr("aria-label", d => d.link
            ? `${d.row.station_name} and ${d.col.station_name}: ${d.link.route_type}, ${d.link.travel_time_min} minutes`
            : `${d.row.station_name} and ${d.col.station_name}: no direct connection`);

    const rowLabels = matrix.selectAll("g.matrix-row-label")
        .data(orderedNodes)
        .join("g")
        .attr("class", "matrix-row-label")
        .attr("transform", d => `translate(-8,${y(d.id) + y.bandwidth() / 2})`);
    rowLabels.append("path")
        .attr("d", d => symbolPath(d.station_type, 28))
        .attr("fill", d => districtColors.get(d.district))
        .attr("transform", "translate(-57,0)");
    rowLabels.append("text")
        .attr("dy", "0.34em")
        .attr("text-anchor", "end")
        .attr("fill", d => districtColors.get(d.district))
        .text(d => d.station_name);

    const colLabels = matrix.selectAll("g.matrix-col-label")
        .data(orderedNodes)
        .join("g")
        .attr("class", "matrix-col-label")
        .attr("transform", d => `translate(${x(d.id) + x.bandwidth() / 2},-8)`);
    colLabels.append("path")
        .attr("d", d => symbolPath(d.station_type, 28))
        .attr("fill", d => districtColors.get(d.district))
        .attr("transform", "translate(0,-24)");
    colLabels.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", 0)
        .attr("dy", "0.34em")
        .attr("fill", d => districtColors.get(d.district))
        .text(d => d.id.replace("s", ""));

    function focusCell(event, d) {
        rowLabels.classed("is-muted", node => node.id !== d.row.id);
        colLabels.classed("is-muted", node => node.id !== d.col.id);
        cell.classed("is-active", item => item === d);
        const markup = d.link
            ? `<strong>${d.row.station_name} ↔ ${d.col.station_name}</strong><span>${d.link.route_type} route</span><span>${d.link.travel_time_min} minutes direct travel</span>`
            : `<strong>${d.row.station_name} ↔ ${d.col.station_name}</strong><span>No direct connection</span>`;
        showTooltip(event, markup);
    }

    function clearCell() {
        rowLabels.classed("is-muted", false);
        colLabels.classed("is-muted", false);
        cell.classed("is-active", false);
        hideTooltip();
    }

    cell
        .on("pointerenter", focusCell)
        .on("pointermove", moveTooltip)
        .on("pointerleave", clearCell)
        .on("focus", function (event, d) {
            const bounds = this.getBoundingClientRect();
            focusCell({ clientX: bounds.right, clientY: bounds.top }, d);
        })
        .on("blur", clearCell);
}

buildLegends();

Promise.all([
    d3.csv("../data/lab5_assignment_stations.csv", d => ({
        id: d.id,
        station_name: d.station_name,
        district: d.district,
        daily_passengers: +d.daily_passengers,
        station_type: d.station_type
    })),
    d3.csv("../data/lab5_assignment_routes.csv", d => ({
        source: d.source,
        target: d.target,
        travel_time_min: +d.travel_time_min,
        route_type: d.route_type
    }))
])
    .then(([nodes, links]) => {
        const degree = new Map(nodes.map(d => [d.id, 0]));
        links.forEach(d => {
            degree.set(d.source, degree.get(d.source) + 1);
            degree.set(d.target, degree.get(d.target) + 1);
        });
        nodes.forEach(d => { d.degree = degree.get(d.id); });
        drawNetwork(nodes, links);
        drawMatrix(nodes, links);
    })
    .catch(error => {
        console.error(error);
        networkRoot.html('<p class="chart-error">The station and route data could not be loaded. Please refresh the page.</p>');
        matrixRoot.html('<p class="chart-error">The adjacency matrix could not be loaded.</p>');
    });
