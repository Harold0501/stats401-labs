const alternativeRoot = d3.select("#alternative-network");
const tooltip = d3.select("#temporal-tooltip");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const transitionDuration = reducedMotion ? 0 : 380;

const width = 1080;
const alternativeHeight = 750;
const regions = ["Asia", "Europe", "North America"];
const alternativeDiamondSide = 340;
const alternativeDiamondInradius = alternativeDiamondSide * Math.sqrt(3) / 4;
const alternativeDiamondOrigin = [540, 355];
const alternativeDiamondRise = [0, -alternativeDiamondSide];
const alternativeDiamondLeft = [
    -alternativeDiamondSide * Math.sqrt(3) / 2,
    alternativeDiamondSide / 2
];
const alternativeDiamondRight = [
    alternativeDiamondSide * Math.sqrt(3) / 2,
    alternativeDiamondSide / 2
];

function buildRhombus(firstVector, secondVector, offsetX, offsetY) {
    const [originX, originY] = alternativeDiamondOrigin;
    const start = [originX + offsetX, originY + offsetY];
    return [
        start,
        [start[0] + firstVector[0], start[1] + firstVector[1]],
        [start[0] + firstVector[0] + secondVector[0], start[1] + firstVector[1] + secondVector[1]],
        [start[0] + secondVector[0], start[1] + secondVector[1]]
    ];
}

const alternativeRegionPolygons = new Map([
    ["Asia", buildRhombus(alternativeDiamondRise, alternativeDiamondLeft, -8, -5)],
    ["Europe", buildRhombus(alternativeDiamondRise, alternativeDiamondRight, 8, -5)],
    ["North America", buildRhombus(alternativeDiamondRight, alternativeDiamondLeft, 0, 10)]
]);
const alternativeRegionAnchors = new Map(
    [...alternativeRegionPolygons].map(([region, polygon]) => {
        const [x, y] = d3.polygonCentroid(polygon);
        return [region, { x, y }];
    })
);
const alternativeRegionLabelPositions = new Map([
    ["Asia", { x: 465, y: 90 }],
    ["Europe", { x: 615, y: 90 }],
    ["North America", { x: alternativeRegionAnchors.get("North America").x, y: 660 }]
]);
const alternativeHomeFractions = [
    [0.27, 0.29],
    [0.70, 0.26],
    [0.30, 0.72],
    [0.72, 0.68]
];
const sectorColors = new Map([
    ["Manufacturing", "#c94f30"],
    ["Logistics", "#24746e"],
    ["Retail", "#cd8c24"],
    ["Food", "#6f8b3d"],
    ["Technology", "#586aa3"],
    ["Wholesale", "#8d5b8f"],
    ["Materials", "#8a6848"]
]);
const typeColors = new Map([
    ["goods", "#cf6b35"],
    ["shipping", "#24746e"],
    ["components", "#586aa3"],
    ["materials", "#8d5b8f"],
    ["services", "#6f8b3d"]
]);
const parseDate = d3.timeParse("%Y-%m-%d");
const formatDate = d3.timeFormat("%B %-d, %Y");
const formatMoney = d3.format("$,.0f");

let transactions = [];
let companyById = new Map();
let alternativeCompanies = [];
let alternativeSimulation;
let alternativeLinkGroup;
let alternativeNodeSelection;
let alternativeLinkSelection;
let alternativeLinks = [];
let globalAlternativeVolumeExtent = [1, 1];
let currentDay = 1;
let timer = null;

function sourceId(link) {
    return typeof link.source === "object" ? link.source.id : link.source;
}

function targetId(link) {
    return typeof link.target === "object" ? link.target.id : link.target;
}

function edgeKey(link) {
    return [sourceId(link), targetId(link)].sort().join("|");
}

function titleCase(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
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
    d3.select("#alternative-sector-legend")
        .selectAll("span")
        .data([...sectorColors.keys()])
        .join("span")
        .html(d => `<i class="sector-swatch" style="background:${sectorColors.get(d)}"></i>${d}`);

    d3.select("#alternative-type-legend")
        .selectAll("span")
        .data([...typeColors.keys()])
        .join("span")
        .html(d => `<i class="transaction-swatch" style="border-color:${typeColors.get(d)}"></i>${titleCase(d)}`);
}

function dailyVolume(companyId, links) {
    return d3.sum(links, link =>
        sourceId(link) === companyId || targetId(link) === companyId ? link.amount_usd : 0
    );
}

function isActive(companyId, links) {
    return links.some(link => sourceId(link) === companyId || targetId(link) === companyId);
}

function clearAlternativeFocus() {
    if (alternativeNodeSelection) {
        alternativeNodeSelection.classed("is-muted", false);
    }
    if (alternativeLinkSelection) {
        alternativeLinkSelection.classed("is-muted", false).classed("is-active", false);
    }
    hideTooltip();
}

function focusAlternativeNode(event, selected) {
    const connectedIds = new Set([selected.id]);
    alternativeLinks.forEach(link => {
        if (sourceId(link) === selected.id) connectedIds.add(targetId(link));
        if (targetId(link) === selected.id) connectedIds.add(sourceId(link));
    });
    alternativeNodeSelection.classed("is-muted", node => !connectedIds.has(node.id));
    alternativeLinkSelection
        .classed("is-muted", link => sourceId(link) !== selected.id && targetId(link) !== selected.id)
        .classed("is-active", link => sourceId(link) === selected.id || targetId(link) === selected.id);

    const volume = dailyVolume(selected.id, alternativeLinks);
    const directConnections = alternativeLinks.filter(link =>
        sourceId(link) === selected.id || targetId(link) === selected.id
    ).length;
    showTooltip(event, `
        <strong>${selected.company_name}</strong>
        <span>Section: ${selected.sector} </span>
        <span>Region: ${selected.region}</span>
        <span>Current volume: ${formatMoney(volume)}</span>
    `);
}

function focusAlternativeLink(event, link) {
    const source = companyById.get(sourceId(link));
    const target = companyById.get(targetId(link));
    alternativeNodeSelection.classed("is-muted", node => node.id !== source.id && node.id !== target.id);
    alternativeLinkSelection
        .classed("is-muted", row => row !== link)
        .classed("is-active", row => row === link);
    showTooltip(event, `
        <strong>${source.company_name} ↔ ${target.company_name}</strong>
        <span>${titleCase(link.transaction_type)}</span>
        <span>Value: ${formatMoney(link.amount_usd)}</span>
        <span>${link.transaction_count} transaction${link.transaction_count === 1 ? "" : "s"}</span>
        <span>${source.region === target.region ? "Within-region" : "Cross-region"} relationship</span>
    `);
}

function alternativeLinkPath(link) {
    const source = link.source;
    const target = link.target;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.hypot(dx, dy) || 1;
    const unitX = dx / distance;
    const unitY = dy / distance;
    const sourcePadding = (source.radius || 14) + 3;
    const targetPadding = (target.radius || 14) + 3;
    const startX = source.x + unitX * sourcePadding;
    const startY = source.y + unitY * sourcePadding;
    const endX = target.x - unitX * targetPadding;
    const endY = target.y - unitY * targetPadding;
    return `M${startX},${startY}L${endX},${endY}`;
}

function closestPointOnSegment(point, start, end) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    const projection = lengthSquared === 0
        ? 0
        : ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared;
    const t = Math.max(0, Math.min(1, projection));
    return [start[0] + t * dx, start[1] + t * dy];
}

function constrainPointToRegion(region, x, y, padding = 38) {
    const polygon = alternativeRegionPolygons.get(region);
    const anchor = alternativeRegionAnchors.get(region);
    const insetScale = Math.max(0.62, 1 - padding / alternativeDiamondInradius);
    const safePolygon = polygon.map(([pointX, pointY]) => [
        anchor.x + (pointX - anchor.x) * insetScale,
        anchor.y + (pointY - anchor.y) * insetScale
    ]);
    const point = [x, y];
    if (d3.polygonContains(safePolygon, point)) return point;

    let closest = null;
    let closestDistance = Infinity;
    for (let index = 0; index < safePolygon.length; index += 1) {
        const edgePoint = closestPointOnSegment(
            point,
            safePolygon[index],
            safePolygon[(index + 1) % safePolygon.length]
        );
        const distance = Math.hypot(x - edgePoint[0], y - edgePoint[1]);
        if (distance < closestDistance) {
            closest = edgePoint;
            closestDistance = distance;
        }
    }
    const inwardX = anchor.x - closest[0];
    const inwardY = anchor.y - closest[1];
    const inwardDistance = Math.hypot(inwardX, inwardY) || 1;
    return [
        closest[0] + (inwardX / inwardDistance) * 1.5,
        closest[1] + (inwardY / inwardDistance) * 1.5
    ];
}

function constrainToRegion(company) {
    const padding = (company.radius || 14) + 10;
    [company.x, company.y] = constrainPointToRegion(company.region, company.x, company.y, padding);
}

function alternativeTicked() {
    alternativeCompanies.forEach(constrainToRegion);
    if (alternativeLinkSelection) {
        alternativeLinkSelection.selectAll("path").attr("d", alternativeLinkPath);
    }
    alternativeNodeSelection.attr("transform", d => `translate(${d.x},${d.y})`);
}

function drawAlternativeNetwork() {
    alternativeRoot.selectAll("*").remove();
    alternativeRoot.attr("aria-busy", "false");

    const alternativeSvg = alternativeRoot.append("svg")
        .attr("viewBox", `0 0 ${width} ${alternativeHeight}`)
        .attr("role", "img")
        .attr("aria-labelledby", "alternative-heading");

    const clusters = alternativeSvg.append("g").attr("class", "alternative-region-clusters");
    const cluster = clusters.selectAll("g")
        .data(regions)
        .join("g");

    cluster.append("polygon")
        .attr("points", region => alternativeRegionPolygons.get(region).map(point => point.join(",")).join(" "));
    cluster.append("text")
        .attr("x", region => alternativeRegionLabelPositions.get(region).x)
        .attr("y", region => alternativeRegionLabelPositions.get(region).y)
        .attr("text-anchor", "middle")
        .text(region => region);

    alternativeLinkGroup = alternativeSvg.append("g").attr("class", "alternative-links");

    alternativeNodeSelection = alternativeSvg.append("g")
        .attr("class", "alternative-nodes")
        .selectAll("g")
        .data(alternativeCompanies, d => d.id)
        .join("g")
        .attr("class", "alternative-node")
        .attr("tabindex", 0)
        .attr("role", "img");

    alternativeNodeSelection.append("circle")
        .attr("class", "alternative-node-body")
        .attr("r", 14)
        .attr("fill", d => sectorColors.get(d.sector));
    alternativeNodeSelection.append("text")
        .attr("x", 24)
        .attr("dy", "0.34em")
        .text(d => d.company_name.split(" ")[0]);

    alternativeNodeSelection
        .on("pointerenter", focusAlternativeNode)
        .on("pointermove", moveTooltip)
        .on("pointerleave", clearAlternativeFocus)
        .on("focus", function (event, d) {
            const bounds = this.getBoundingClientRect();
            focusAlternativeNode({ clientX: bounds.right, clientY: bounds.top }, d);
        })
        .on("blur", clearAlternativeFocus);

    regions.forEach(region => {
        const polygon = alternativeRegionPolygons.get(region);
        const origin = polygon[0];
        const firstAxis = [polygon[1][0] - origin[0], polygon[1][1] - origin[1]];
        const secondAxis = [polygon[3][0] - origin[0], polygon[3][1] - origin[1]];
        const regionalCompanies = alternativeCompanies.filter(company => company.region === region);
        regionalCompanies.forEach((company, index) => {
            const [firstFraction, secondFraction] = alternativeHomeFractions[index];
            company.homeX = origin[0]
                + firstAxis[0] * firstFraction
                + secondAxis[0] * secondFraction;
            company.homeY = origin[1]
                + firstAxis[1] * firstFraction
                + secondAxis[1] * secondFraction;
            company.x = company.homeX;
            company.y = company.homeY;
        });
    });

    alternativeSimulation = d3.forceSimulation(alternativeCompanies)
        .randomSource(d3.randomLcg(0.704))
        .alphaDecay(0.065)
        .velocityDecay(0.55)
        .force("link", d3.forceLink().id(d => d.id).distance(215).strength(0.07))
        .force("charge", d3.forceManyBody().strength(-165).distanceMax(310))
        .force("x", d3.forceX(d => d.homeX).strength(0.13))
        .force("y", d3.forceY(d => d.homeY).strength(0.13))
        .force("collision", d3.forceCollide().radius(d => d.radius + 23).strength(0.9).iterations(3))
        .on("tick", alternativeTicked);

    function dragStarted(event, company) {
        if (!event.active) alternativeSimulation.alphaTarget(0.08).restart();
        company.fx = company.x;
        company.fy = company.y;
    }

    function dragged(event, company) {
        const [x, y] = constrainPointToRegion(
            company.region,
            event.x,
            event.y,
            (company.radius || 14) + 10
        );
        company.fx = x;
        company.fy = y;
    }

    function dragEnded(event, company) {
        if (!event.active) alternativeSimulation.alphaTarget(0);
        company.fx = null;
        company.fy = null;
    }

    alternativeNodeSelection.call(
        d3.drag().on("start", dragStarted).on("drag", dragged).on("end", dragEnded)
    );
}

function showAlternativeDay(day) {
    clearAlternativeFocus();
    alternativeLinks = transactions
        .filter(d => d.day === day)
        .map(d => ({ ...d }));

    const nodeRadius = d3.scaleSqrt()
        .domain(globalAlternativeVolumeExtent)
        .range([18, 39])
        .clamp(true);
    const amountScale = d3.scaleSqrt()
        .domain(d3.extent(transactions, d => d.amount_usd))
        .range([3, 11]);
    const pulseGap = d3.scaleLinear().domain([1, 5]).range([25, 7]);

    alternativeCompanies.forEach(company => {
        company.volume = dailyVolume(company.id, alternativeLinks);
        if (company.volume > 0) {
            company.radius = nodeRadius(company.volume);
        }
    });

    alternativeLinkSelection = alternativeLinkGroup.selectAll("g")
        .data(alternativeLinks, edgeKey)
        .join(
            enter => {
                const group = enter.append("g")
                    .attr("class", "alternative-link is-entering")
                    .attr("opacity", 0)
                    .on("pointerenter", focusAlternativeLink)
                    .on("pointermove", moveTooltip)
                    .on("pointerleave", clearAlternativeFocus);
                group.append("path").attr("class", "alternative-link-base").attr("fill", "none");
                group.append("path").attr("class", "alternative-link-flow").attr("fill", "none");
                return group.call(entering => entering.transition().duration(transitionDuration).attr("opacity", 1));
            },
            update => update
                .attr("class", "alternative-link")
                .call(updating => updating.transition().duration(transitionDuration).attr("opacity", 1)),
            exit => exit
                .style("pointer-events", "none")
                .call(leaving => leaving.transition().duration(transitionDuration).attr("opacity", 0).remove())
        );

    alternativeLinkSelection.select(".alternative-link-base")
        .attr("stroke", d => typeColors.get(d.transaction_type))
        .attr("stroke-width", d => amountScale(d.amount_usd))
        .attr("stroke-opacity", 0.78);

    alternativeLinkSelection.select(".alternative-link-flow")
        .attr("stroke-width", d => Math.max(1.5, amountScale(d.amount_usd) * 0.35))
        .attr("stroke-dasharray", d => `2 ${pulseGap(d.transaction_count)}`)
        .attr("stroke", "#fffdf7")
        .attr("stroke-opacity", 0.95);

    alternativeNodeSelection
        .classed("is-inactive", d => !isActive(d.id, alternativeLinks))
        .attr("aria-label", d => `${d.company_name}, ${d.sector}, ${d.region}; Day ${day} volume ${formatMoney(d.volume)}`);

    alternativeNodeSelection.select(".alternative-node-body")
        .transition()
        .duration(transitionDuration)
        .attr("r", d => d.radius);

    const date = transactions.find(d => d.day === day).date;
    d3.select("#alternative-current-day").text(`Day ${day}`);
    d3.select("#alternative-current-date").text(formatDate(date));
    d3.select("#alternative-time-slider").property("value", day);
    d3.select("#alternative-slider-value").text(day);

    alternativeSimulation.force("link").links(alternativeLinks);
    alternativeSimulation
        .force("collision", d3.forceCollide().radius(d => d.radius + 23).strength(0.9).iterations(3))
        .alpha(0.16)
        .restart();
}

function showDay(day) {
    currentDay = Math.max(1, Math.min(60, +day));
    showAlternativeDay(currentDay);
}

function updateControlState(isPlaying) {
    d3.select("#alternative-play").property("disabled", isPlaying);
    d3.select("#alternative-pause").property("disabled", !isPlaying);
}

function pause() {
    if (timer) {
        timer.stop();
        timer = null;
    }
    updateControlState(false);
}

function play() {
    if (timer) return;
    if (currentDay >= 60) showDay(1);
    updateControlState(true);
    timer = d3.interval(() => {
        if (currentDay >= 60) {
            pause();
            return;
        }
        showDay(currentDay + 1);
    }, reducedMotion ? 750 : 650);
}

function reset() {
    pause();
    showDay(1);
}

function connectControls() {
    d3.select("#alternative-play").on("click", play);
    d3.select("#alternative-pause").on("click", pause);
    d3.select("#alternative-reset").on("click", reset);
    d3.select("#alternative-time-slider").on("input", function () {
        pause();
        showDay(+this.value);
    });
    updateControlState(false);
}

buildLegends();
connectControls();

Promise.all([
    d3.csv("../data/lab7_assignment_companies.csv"),
    d3.csv("../data/lab7_assignment_transactions_60days.csv", d => ({
        date: parseDate(d.date),
        day: +d.day,
        source: d.source,
        target: d.target,
        amount_usd: +d.amount_usd,
        transaction_type: d.transaction_type,
        transaction_count: +d.transaction_count
    }))
])
    .then(([companyData, transactionData]) => {
        alternativeCompanies = companyData.map(company => ({ ...company, radius: 20 }));
        transactions = transactionData;
        companyById = new Map(companyData.map(d => [d.id, d]));
        const transactionsByDay = d3.group(transactions, d => d.day);
        const positiveDailyVolumes = companyData.flatMap(company => d3.range(1, 61)
            .map(day => dailyVolume(company.id, transactionsByDay.get(day) || []))
            .filter(volume => volume > 0));
        globalAlternativeVolumeExtent = d3.extent(positiveDailyVolumes);
        drawAlternativeNetwork();
        showDay(1);
    })
    .catch(error => {
        console.error(error);
        alternativeRoot
            .attr("aria-busy", "false")
            .html('<p class="chart-error">The temporal network could not be loaded. Serve this project over HTTP and try again.</p>');
    });
