const WIDTH = 1100;
const HEIGHT = 610;
const TOPOLOGY_PATH = "../data/lab9_world_countries.topojson";

const tooltip = d3.select("#lab9-tooltip");
const choroplethRoot = d3.select("#choropleth-map");
const cartogramRoot = d3.select("#cartogram-map");
const formatInteger = d3.format(",.0f");
const formatOneDecimal = d3.format(",.1f");
const nameIsoFallback = new Map([
    ["France", "FRA"],
    ["Norway", "NOR"]
]);

let countryPaths;
let cartogramPaths;
let pinnedIso = null;

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function sourceIso(feature) {
    const properties = feature.properties;
    const supplied = properties["ISO3166-1-Alpha-3"];
    return supplied && supplied !== "-99"
        ? supplied
        : nameIsoFallback.get(properties.name);
}

function datumIso(datum) {
    return datum.iso3 || datum.properties?.iso3;
}

function datumRecord(datum) {
    return datum.gdpRecord || datum.properties?.gdpRecord;
}

function readableGdp(value) {
    return value >= 1000
        ? `$${formatOneDecimal(value / 1000)} trillion`
        : `$${formatInteger(value)} billion`;
}

function tooltipMarkup(datum) {
    const record = datumRecord(datum);
    const country = record?.country || datum.properties?.name;

    if (!record) {
        return `
            <strong>${escapeHtml(country)}</strong>
            <span>Not in the top-50 dataset</span>
        `;
    }

    return `
        <strong>${escapeHtml(record.country)}</strong>
        <span>GDP: ${readableGdp(record.gdp_2025_billion_usd)}</span>
        <span>Rank: #${record.rank} of 50</span>
        <small>${formatOneDecimal(record.gdp_2025_billion_usd)} billion USD</small>
    `;
}

function showTooltip(event, datum) {
    tooltip
        .html(tooltipMarkup(datum))
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

function updateLinkedHighlight(iso = pinnedIso) {
    const hasSelection = Boolean(iso);

    if (countryPaths) {
        countryPaths
            .classed("is-linked-active", d => hasSelection && datumIso(d) === iso)
            .classed("is-linked-muted", d => hasSelection && datumIso(d) !== iso);
    }

    if (cartogramPaths) {
        cartogramPaths
            .classed("is-linked-active", d => hasSelection && datumIso(d) === iso)
            .classed("is-linked-muted", d => hasSelection && datumIso(d) !== iso);
    }

    d3.select("#clear-country").property("disabled", !pinnedIso);
}

function addLinkedInteractions(selection, getIso) {
    selection
        .on("pointerenter.lab9", function (event, d) {
            const iso = getIso(d);
            updateLinkedHighlight(iso || pinnedIso);
            showTooltip(event, d);
        })
        .on("pointermove.lab9", moveTooltip)
        .on("pointerleave.lab9", function () {
            updateLinkedHighlight();
            hideTooltip();
        })
        .on("focus.lab9", function (_, d) {
            updateLinkedHighlight(getIso(d) || pinnedIso);
        })
        .on("blur.lab9", function () {
            updateLinkedHighlight();
        })
        .on("click.lab9", function (event, d) {
            const iso = getIso(d);
            if (!iso) return;
            event.stopPropagation();
            pinnedIso = pinnedIso === iso ? null : iso;
            updateLinkedHighlight();
        });
}

function drawLegend(color, domain) {
    const width = 470;
    const height = 58;
    const margin = { top: 4, right: 28, bottom: 23, left: 34 };
    const scale = d3.scaleLog()
        .domain(domain)
        .range([margin.left, width - margin.right]);
    const samples = d3.range(160).map(index => {
        const t = index / 159;
        return domain[0] * Math.pow(domain[1] / domain[0], t);
    });

    const svg = d3.select("#gdp-legend")
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-label", "Logarithmic color legend from 300 billion to 30.6 trillion dollars");

    svg.selectAll("rect")
        .data(samples)
        .join("rect")
        .attr("x", (_, index) => margin.left + index * (width - margin.left - margin.right) / samples.length)
        .attr("y", margin.top)
        .attr("width", (width - margin.left - margin.right) / samples.length + 0.5)
        .attr("height", 15)
        .attr("fill", color);

    svg.append("g")
        .attr("class", "lab9-legend-axis")
        .attr("transform", `translate(0,${margin.top + 15})`)
        .call(
            d3.axisBottom(scale)
                .tickValues([300, 500, 1000, 5000, 10000, 30000])
                .tickSize(5)
                .tickFormat(value => value >= 1000 ? `$${value / 1000}T` : `$${value}B`)
        );
}

function drawChoropleth(features, projection, path, color) {
    choroplethRoot.selectAll("*").remove();

    const svg = choroplethRoot
        .append("svg")
        .attr("viewBox", `0 0 ${WIDTH} ${HEIGHT}`)
        .attr("role", "img")
        .attr("aria-labelledby", "choropleth-svg-title choropleth-svg-desc");

    svg.append("title")
        .attr("id", "choropleth-svg-title")
        .text("2025 nominal GDP choropleth map");
    svg.append("desc")
        .attr("id", "choropleth-svg-desc")
        .text("A world map where darker teal countries have higher GDP. Countries outside the top 50 are gray.");

    svg.append("path")
        .datum({ type: "Sphere" })
        .attr("class", "lab9-sphere")
        .attr("d", path);

    const zoomLayer = svg.append("g").attr("class", "lab9-zoom-layer");

    zoomLayer.append("path")
        .datum(d3.geoGraticule10())
        .attr("class", "lab9-graticule")
        .attr("d", path);

    countryPaths = zoomLayer.selectAll("path.lab9-country")
        .data(features)
        .join("path")
        .attr("class", "lab9-country")
        .attr("d", path)
        .attr("fill", d => d.gdpRecord ? color(d.gdpRecord.gdp_2025_billion_usd) : "#dfddd4")
        .attr("tabindex", d => d.gdpRecord ? 0 : null)
        .attr("role", d => d.gdpRecord ? "button" : "img")
        .attr("aria-label", d => d.gdpRecord
            ? `${d.gdpRecord.country}, GDP ${readableGdp(d.gdpRecord.gdp_2025_billion_usd)}, rank ${d.gdpRecord.rank}`
            : `${d.properties.name}, not in the top-50 dataset`);

    addLinkedInteractions(countryPaths, d => d.gdpRecord ? d.iso3 : null);

    const zoom = d3.zoom()
        .scaleExtent([1, 8])
        .translateExtent([[0, 0], [WIDTH, HEIGHT]])
        .extent([[0, 0], [WIDTH, HEIGHT]])
        .on("zoom", event => {
            zoomLayer.attr("transform", event.transform);
            countryPaths.attr("stroke-width", 0.75 / event.transform.k);
        });

    svg.call(zoom).on("dblclick.zoom", null);

    d3.select("#reset-choropleth").on("click", () => {
        svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity);
    });

    choroplethRoot.attr("aria-busy", "false");
}

function wireCartogramInteractions() {
    const paths = cartogramRoot.selectAll("path.feature");
    if (paths.empty()) return false;

    cartogramPaths = paths
        .classed("lab9-cartogram-country", true)
        .each(d => {
            d.iso3 = d.properties.iso3;
            d.gdpRecord = d.properties.gdpRecord;
        })
        .classed("has-gdp", d => Boolean(d.gdpRecord))
        .attr("tabindex", d => d.gdpRecord ? 0 : null)
        .attr("role", d => d.gdpRecord ? "button" : "img")
        .attr("aria-label", d => d.gdpRecord
            ? `${d.gdpRecord.country}, GDP ${readableGdp(d.gdpRecord.gdp_2025_billion_usd)}, rank ${d.gdpRecord.rank}`
            : `${d.properties.name}, not in the top-50 dataset`);

    addLinkedInteractions(cartogramPaths, d => d.gdpRecord ? d.iso3 : null);
    updateLinkedHighlight();
    cartogramRoot.attr("aria-busy", "false");
    return true;
}

function drawCartogram(topology, objectName, projection, color, domain) {
    cartogramRoot.selectAll("*").remove();

    const missingLayoutWeight = domain[0];
    const geometries = topology.objects[objectName].geometries;
    geometries.forEach(geometry => {
        const record = geometry.properties.gdpRecord;
        geometry.properties.cartogramValue = record
            ? record.gdp_2025_billion_usd
            : missingLayoutWeight;
    });

    const chart = new Cartogram(cartogramRoot.node())
        .width(WIDTH)
        .height(HEIGHT)
        .topoJson(topology)
        .topoObjectName(objectName)
        .projection(projection)
        .iterations(60)
        .value(feature => feature.properties.cartogramValue)
        .color(feature => {
            const record = feature.properties.gdpRecord;
            return record ? color(record.gdp_2025_billion_usd) : "#dfddd4";
        });

    const svg = cartogramRoot.select("svg")
        .attr("viewBox", `0 0 ${WIDTH} ${HEIGHT}`)
        .attr("role", "img")
        .attr("aria-labelledby", "cartogram-svg-title cartogram-svg-desc");

    svg.append("title")
        .attr("id", "cartogram-svg-title")
        .text("2025 nominal GDP continuous area cartogram");
    svg.append("desc")
        .attr("id", "cartogram-svg-desc")
        .text("Country boundaries are continuously distorted so colored top-50 country areas approximate GDP. Gray countries have no data.");

    requestAnimationFrame(() => {
        if (!wireCartogramInteractions()) {
            requestAnimationFrame(wireCartogramInteractions);
        }
    });
    window.setTimeout(wireCartogramInteractions, 1400);

    return chart;
}

function showLoadError(error) {
    console.error(error);
    const message = `
        <p class="chart-error">
            The geographic data could not be loaded. Check the network connection and refresh the page.
        </p>
    `;
    choroplethRoot.html(message).attr("aria-busy", "false");
    cartogramRoot.html(message).attr("aria-busy", "false");
}

Promise.all([
    d3.csv("../data/lab9_gdp_2025_top50.csv", row => ({
        iso3: row.iso3,
        country: row.country,
        gdp_2025_billion_usd: +row.gdp_2025_billion_usd,
        rank: +row.rank
    })),
    d3.json(TOPOLOGY_PATH)
])
    .then(([records, topology]) => {
        const objectName = Object.keys(topology.objects)[0];
        const topologyObject = topology.objects[objectName];
        const gdpByIso = new Map(records.map(record => [record.iso3, record]));

        topologyObject.geometries = topologyObject.geometries.map(geometry => {
            geometry.properties.iso3 = sourceIso(geometry);
            geometry.properties.gdpRecord = gdpByIso.get(geometry.properties.iso3);
            return geometry;
        });

        const completeGeoJson = topojson.feature(topology, topologyObject);
        const features = completeGeoJson.features
            .filter(feature => feature.properties.name !== "Antarctica")
            .map(feature => {
                feature.iso3 = feature.properties.iso3;
                feature.gdpRecord = feature.properties.gdpRecord;
                return feature;
            });
        const mapGeoJson = { type: "FeatureCollection", features };
        const featureByIso = new Map(
            features
                .filter(feature => feature.iso3)
                .map(feature => [feature.iso3, feature])
        );
        const missingJoins = records.filter(record => !featureByIso.has(record.iso3));

        if (missingJoins.length) {
            throw new Error(`Unmatched ISO-3 codes: ${missingJoins.map(d => d.iso3).join(", ")}`);
        }

        topologyObject.geometries = topologyObject.geometries.filter(geometry => {
            if (geometry.properties.name === "Antarctica") return false;
            if (geometry.properties.gdpRecord) return true;
            return d3.geoArea(topojson.feature(topology, geometry)) > 0.0001;
        });

        const projection = d3.geoEqualEarth()
            .fitExtent([[24, 22], [WIDTH - 24, HEIGHT - 22]], mapGeoJson);
        const path = d3.geoPath(projection);
        const domain = d3.extent(records, d => d.gdp_2025_billion_usd);
        const interpolator = d3.interpolateRgbBasis([
            "#cfe4dc",
            "#75ad9c",
            "#28776f",
            "#123f43"
        ]);
        const color = d3.scaleSequentialLog(interpolator).domain(domain);

        drawLegend(color, domain);
        drawChoropleth(features, projection, path, color);
        drawCartogram(topology, objectName, projection, color, domain);
        updateLinkedHighlight();

        d3.select("#clear-country").on("click", () => {
            pinnedIso = null;
            updateLinkedHighlight();
            hideTooltip();
        });
    })
    .catch(showLoadError);
