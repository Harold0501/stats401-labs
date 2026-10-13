const MAP_WIDTH = 1100;
const MAP_HEIGHT = 610;
const TOPOLOGY_PATH = "../data/lab9_world_countries.topojson";

const REGION_BY_ISO = new Map(Object.entries({
    USA: "Americas", CAN: "Americas", MEX: "Americas", BRA: "Americas",
    ARG: "Americas", COL: "Americas", CHL: "Americas", PER: "Americas",
    DEU: "Europe", GBR: "Europe", FRA: "Europe", ITA: "Europe", RUS: "Europe",
    ESP: "Europe", NLD: "Europe", POL: "Europe", CHE: "Europe", BEL: "Europe",
    IRL: "Europe", SWE: "Europe", AUT: "Europe", NOR: "Europe", DNK: "Europe",
    ROU: "Europe", CZE: "Europe", PRT: "Europe", FIN: "Europe",
    CHN: "Asia", JPN: "Asia", IND: "Asia", KOR: "Asia", IDN: "Asia", TUR: "Asia",
    SAU: "Asia", TWN: "Asia", ISR: "Asia", SGP: "Asia", ARE: "Asia", THA: "Asia",
    PHL: "Asia", VNM: "Asia", BGD: "Asia", MYS: "Asia", HKG: "Asia", PAK: "Asia",
    IRN: "Asia", KAZ: "Asia",
    ZAF: "Africa", EGY: "Africa",
    AUS: "Oceania"
}));

const NAME_ISO_FALLBACK = new Map([
    ["France", "FRA"],
    ["Norway", "NOR"]
]);

const COUNTRY_ALIASES = new Map([
    ["america", "USA"],
    ["united states of america", "USA"],
    ["us", "USA"],
    ["usa", "USA"],
    ["uk", "GBR"],
    ["britain", "GBR"],
    ["south korea", "KOR"],
    ["korea", "KOR"],
    ["uae", "ARE"],
    ["russia", "RUS"],
    ["turkey", "TUR"],
    ["czechia", "CZE"],
    ["hong kong", "HKG"]
]);

const formatInteger = d3.format(",.0f");
const formatOneDecimal = d3.format(",.1f");
const mapRoot = d3.select("#voice-map");
const cartogramRoot = d3.select("#voice-cartogram");
const tooltip = d3.select("#lab10-tooltip");

let countryPaths;
let cartogramPaths;
let recordsByIso = new Map();
let recordsByName = new Map();
let selectedIso = null;
let activeRegion = "All";
let recognition = null;
let isListening = false;

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function normalizePhrase(value) {
    return String(value)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function readableGdp(value) {
    return value >= 1000
        ? `$${formatOneDecimal(value / 1000)} trillion`
        : `$${formatInteger(value)} billion`;
}

function featureIso(feature) {
    const supplied = feature.properties["ISO3166-1-Alpha-3"];
    return supplied && supplied !== "-99"
        ? supplied
        : NAME_ISO_FALLBACK.get(feature.properties.name);
}

function setFeedback(heard, action, state = "success") {
    d3.select("#heard-command").text(heard || "—");
    d3.select("#action-feedback").text(action);
    d3.select("#voice-feedback").attr("data-state", state);
}

function setListeningState(listening) {
    isListening = listening;
    d3.select("#voice-button")
        .property("disabled", false)
        .classed("is-listening", listening)
        .attr("aria-label", listening ? "Stop recording and recognize voice command" : "Start voice control")
        .html(listening
            ? '<span aria-hidden="true">■</span><b>Stop &amp; run</b>'
            : '<span aria-hidden="true">●</span><b>Listen</b>');
    d3.select("#voice-indicator").classed("is-listening", listening);
    d3.select("#voice-state-label").text(listening ? "Recording · click to finish" : "Microphone off");
}

function updateCountryResult() {
    const record = selectedIso ? recordsByIso.get(selectedIso) : null;
    if (!record) {
        d3.select("#result-country").text("No country selected");
        d3.select("#result-gdp").text(
            activeRegion === "All"
                ? "Use voice, the fallback controls, or the map."
                : `Showing ${activeRegion}'s top-50 economies.`
        );
        d3.select(".country-result-rank").text("Selection");
        return;
    }

    d3.select(".country-result-rank").text(`Rank #${record.rank}`);
    d3.select("#result-country").text(record.country);
    d3.select("#result-gdp").text(`${readableGdp(record.gdp_2025_billion_usd)} · ${REGION_BY_ISO.get(record.iso3)}`);
}

function updateMap() {
    [countryPaths, cartogramPaths].forEach(paths => {
        if (!paths) return;
        paths
            .classed("is-region-muted", feature => {
                const iso = feature.iso3 || feature.properties?.iso3;
                return activeRegion !== "All" && (!iso || REGION_BY_ISO.get(iso) !== activeRegion);
            })
            .classed("is-selected", feature => {
                const iso = feature.iso3 || feature.properties?.iso3;
                return Boolean(selectedIso) && iso === selectedIso;
            })
            .classed("is-selection-muted", feature => {
                const iso = feature.iso3 || feature.properties?.iso3;
                return Boolean(selectedIso) && iso !== selectedIso;
            });
    });

    d3.select("#region-select").property("value", activeRegion);
    d3.select("#country-select").property("value", selectedIso || "");
    d3.select("#current-view").text(
        selectedIso
            ? recordsByIso.get(selectedIso).country
            : activeRegion === "All"
                ? "All top-50 economies"
                : `${activeRegion} · top-50 economies`
    );
    updateCountryResult();
}

function filterRegion(region, source = "control") {
    activeRegion = region;
    selectedIso = null;
    updateMap();
    const action = region === "All" ? "Showing all top-50 economies" : `Showing ${region}`;
    if (source !== "silent") setFeedback(source === "voice" ? `show ${region.toLowerCase()}` : "Fallback control", action);
}

function highlightCountry(iso, source = "control", spokenName = "") {
    const record = recordsByIso.get(iso);
    if (!record) {
        setFeedback(spokenName || "Unknown country", "Country not found. Try another top-50 economy.", "error");
        return false;
    }

    selectedIso = iso;
    activeRegion = "All";
    updateMap();
    setFeedback(source === "voice" ? `highlight ${spokenName || record.country}` : "Fallback control", `Highlighted ${record.country}`);
    return true;
}

function resetVisualization(source = "control") {
    selectedIso = null;
    activeRegion = "All";
    updateMap();
    hideTooltip();
    setFeedback(source === "voice" ? "reset" : "Fallback control", "Map reset to all top-50 economies");
}

function findCountryIso(name) {
    const normalized = normalizePhrase(name);
    if (COUNTRY_ALIASES.has(normalized)) return COUNTRY_ALIASES.get(normalized);
    if (recordsByName.has(normalized)) return recordsByName.get(normalized).iso3;

    const partialMatches = [...recordsByName.entries()]
        .filter(([countryName]) => countryName.includes(normalized) || normalized.includes(countryName));
    return partialMatches.length === 1 ? partialMatches[0][1].iso3 : null;
}

function handleVoiceCommand(rawCommand, source = "voice") {
    const command = normalizePhrase(rawCommand);
    const shownCommand = rawCommand ? `“${rawCommand}”` : "No speech detected";

    if (!command) {
        setFeedback(shownCommand, "No command detected. Please try again.", "error");
        return;
    }

    if (/\b(reset|clear|show all|all regions)\b/.test(command)) {
        resetVisualization(source);
        d3.select("#heard-command").text(shownCommand);
        return;
    }

    const regionMatchers = [
        ["asia", "Asia"],
        ["europe", "Europe"],
        ["america", "Americas"],
        ["africa", "Africa"],
        ["oceania", "Oceania"],
        ["australia region", "Oceania"]
    ];
    const regionMatch = regionMatchers.find(([phrase]) => command.includes(phrase));
    if ((command.includes("show") || command.includes("filter")) && regionMatch) {
        filterRegion(regionMatch[1], source);
        d3.select("#heard-command").text(shownCommand);
        return;
    }

    const countryMatch = command.match(/^(?:highlight|select|find|show)\s+(.+)$/);
    if (countryMatch) {
        const requestedName = countryMatch[1];
        const iso = findCountryIso(requestedName);
        if (iso) {
            highlightCountry(iso, source, requestedName);
            d3.select("#heard-command").text(shownCommand);
            return;
        }
    }

    setFeedback(
        shownCommand,
        'Command not recognized. Try “Show Asia,” “Highlight Japan,” or “Reset.”',
        "error"
    );
}

function showTooltip(event, feature) {
    const record = feature.gdpRecord;
    const markup = record
        ? `<strong>${escapeHtml(record.country)}</strong><span>${readableGdp(record.gdp_2025_billion_usd)}</span><small>Rank #${record.rank} · ${REGION_BY_ISO.get(record.iso3)}</small>`
        : `<strong>${escapeHtml(feature.properties.name)}</strong><span>Not in the top-50 dataset</span>`;

    tooltip
        .html(markup)
        .attr("aria-hidden", "false")
        .style("left", `${event.clientX + 14}px`)
        .style("top", `${event.clientY + 14}px`)
        .style("opacity", 1);
}

function moveTooltip(event) {
    tooltip.style("left", `${event.clientX + 14}px`).style("top", `${event.clientY + 14}px`);
}

function hideTooltip() {
    tooltip.attr("aria-hidden", "true").style("opacity", 0);
}

function drawLegend(color, domain) {
    const width = 470;
    const height = 58;
    const margin = { top: 4, right: 28, bottom: 23, left: 34 };
    const scale = d3.scaleLog().domain(domain).range([margin.left, width - margin.right]);
    const samples = d3.range(160).map(index => {
        const t = index / 159;
        return domain[0] * Math.pow(domain[1] / domain[0], t);
    });
    const svg = d3.select("#lab10-gdp-legend")
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-label", "Logarithmic GDP color scale from 300 billion to 30.6 trillion dollars");

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
        .call(d3.axisBottom(scale)
            .tickValues([300, 500, 1000, 5000, 10000, 30000])
            .tickSize(5)
            .tickFormat(value => value >= 1000 ? `$${value / 1000}T` : `$${value}B`));
}

function drawMap(features, color) {
    mapRoot.selectAll("*").remove();
    const featureCollection = { type: "FeatureCollection", features };
    const projection = d3.geoEqualEarth().fitExtent([[24, 22], [MAP_WIDTH - 24, MAP_HEIGHT - 22]], featureCollection);
    const path = d3.geoPath(projection);
    const svg = mapRoot.append("svg")
        .attr("viewBox", `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`)
        .attr("role", "img")
        .attr("aria-labelledby", "voice-map-title voice-map-desc");

    svg.append("title").attr("id", "voice-map-title").text("Voice-controlled 2025 GDP choropleth");
    svg.append("desc").attr("id", "voice-map-desc")
        .text("A world map where darker teal indicates higher GDP. Voice or fallback controls filter regions and highlight countries.");
    svg.append("path").datum({ type: "Sphere" }).attr("class", "lab10-sphere").attr("d", path);
    svg.append("path").datum(d3.geoGraticule10()).attr("class", "lab10-graticule").attr("d", path);

    countryPaths = svg.selectAll("path.lab10-country")
        .data(features)
        .join("path")
        .attr("class", "lab10-country")
        .attr("d", path)
        .attr("fill", feature => feature.gdpRecord ? color(feature.gdpRecord.gdp_2025_billion_usd) : "#dfddd4")
        .attr("tabindex", feature => feature.gdpRecord ? 0 : null)
        .attr("role", feature => feature.gdpRecord ? "button" : "img")
        .attr("aria-label", feature => feature.gdpRecord
            ? `${feature.gdpRecord.country}, GDP ${readableGdp(feature.gdpRecord.gdp_2025_billion_usd)}, rank ${feature.gdpRecord.rank}`
            : `${feature.properties.name}, not in the top-50 dataset`)
        .on("pointerenter", showTooltip)
        .on("pointermove", moveTooltip)
        .on("pointerleave", hideTooltip)
        .on("focus", function (_, feature) {
            if (feature.gdpRecord) d3.select(this).classed("is-keyboard-focus", true);
        })
        .on("blur", function () {
            d3.select(this).classed("is-keyboard-focus", false);
        })
        .on("click", function (_, feature) {
            if (feature.gdpRecord) highlightCountry(feature.iso3, "control");
        })
        .on("keydown", function (event, feature) {
            if (feature.gdpRecord && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                highlightCountry(feature.iso3, "control");
            }
        });

    mapRoot.attr("aria-busy", "false");
    updateMap();
    return projection;
}

function wireCartogramInteractions() {
    const paths = cartogramRoot.selectAll("path.feature");
    if (paths.empty()) return false;

    cartogramPaths = paths
        .classed("lab10-country", true)
        .classed("lab10-cartogram-country", true)
        .each(feature => {
            feature.iso3 = feature.properties.iso3;
            feature.gdpRecord = feature.properties.gdpRecord;
        })
        .attr("tabindex", feature => feature.gdpRecord ? 0 : null)
        .attr("role", feature => feature.gdpRecord ? "button" : "img")
        .attr("aria-label", feature => feature.gdpRecord
            ? `${feature.gdpRecord.country}, GDP ${readableGdp(feature.gdpRecord.gdp_2025_billion_usd)}, rank ${feature.gdpRecord.rank}`
            : `${feature.properties.name}, not in the top-50 dataset`)
        .on("pointerenter.lab10", showTooltip)
        .on("pointermove.lab10", moveTooltip)
        .on("pointerleave.lab10", hideTooltip)
        .on("focus.lab10", function (_, feature) {
            if (feature.gdpRecord) d3.select(this).classed("is-keyboard-focus", true);
        })
        .on("blur.lab10", function () {
            d3.select(this).classed("is-keyboard-focus", false);
        })
        .on("click.lab10", function (_, feature) {
            if (feature.gdpRecord) highlightCountry(feature.iso3, "control");
        })
        .on("keydown.lab10", function (event, feature) {
            if (feature.gdpRecord && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                highlightCountry(feature.iso3, "control");
            }
        });

    cartogramRoot.attr("aria-busy", "false");
    updateMap();
    return true;
}

function drawCartogram(topology, objectName, projection, color, domain) {
    cartogramRoot.selectAll("*").remove();
    const missingLayoutWeight = domain[0];

    topology.objects[objectName].geometries.forEach(geometry => {
        geometry.properties.cartogramValue = geometry.properties.gdpRecord
            ? geometry.properties.gdpRecord.gdp_2025_billion_usd
            : missingLayoutWeight;
    });

    new Cartogram(cartogramRoot.node())
        .width(MAP_WIDTH)
        .height(MAP_HEIGHT)
        .topoJson(topology)
        .topoObjectName(objectName)
        .projection(projection)
        .iterations(60)
        .value(feature => feature.properties.cartogramValue)
        .color(feature => feature.properties.gdpRecord
            ? color(feature.properties.gdpRecord.gdp_2025_billion_usd)
            : "#dfddd4");

    const svg = cartogramRoot.select("svg")
        .attr("viewBox", `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`)
        .attr("role", "img")
        .attr("aria-labelledby", "voice-cartogram-title voice-cartogram-desc");
    svg.append("title").attr("id", "voice-cartogram-title").text("Voice-controlled 2025 GDP cartogram");
    svg.append("desc").attr("id", "voice-cartogram-desc")
        .text("Country areas are distorted by GDP. Voice and fallback controls update this view together with the choropleth.");

    requestAnimationFrame(() => {
        if (!wireCartogramInteractions()) requestAnimationFrame(wireCartogramInteractions);
    });
    window.setTimeout(wireCartogramInteractions, 1400);
}

function populateCountrySelect(records) {
    d3.select("#country-select")
        .selectAll("option.country-option")
        .data([...records].sort((a, b) => d3.ascending(a.country, b.country)))
        .join("option")
        .attr("class", "country-option")
        .attr("value", record => record.iso3)
        .text(record => record.country);
}

function initializeVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        d3.select("#voice-button")
            .property("disabled", true)
            .attr("aria-label", "Voice control unavailable in this browser")
            .html('<span aria-hidden="true">×</span><b>Unavailable</b>');
        d3.select("#voice-support-note")
            .text("Speech recognition is not supported in this browser. Use the controls below instead.");
        setFeedback("Browser check", "Voice unavailable; fallback controls are ready.", "error");
        return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        setListeningState(true);
        setFeedback("Listening…", "Say a command now", "listening");
    };
    recognition.onresult = event => {
        const transcript = event.results[0][0].transcript.toLowerCase().trim();
        handleVoiceCommand(transcript, "voice");
    };
    recognition.onerror = event => {
        const messages = {
            "not-allowed": "Microphone permission was denied. Use the fallback controls or allow access and try again.",
            "audio-capture": "No microphone was found. Use the fallback controls instead.",
            "no-speech": "No speech was detected. Press the button and try again.",
            network: "The speech service could not be reached. Try again or use the fallback controls."
        };
        setFeedback("Recognition error", messages[event.error] || `Voice recognition failed (${event.error}).`, "error");
    };
    recognition.onend = () => setListeningState(false);

    d3.select("#voice-button").on("click", () => {
        if (isListening) {
            recognition.stop();
            d3.select("#voice-button").property("disabled", true);
            d3.select("#voice-state-label").text("Processing speech…");
            setFeedback("Processing…", "Recognizing the recorded command", "listening");
            return;
        }
        try {
            recognition.start();
        } catch (error) {
            setListeningState(false);
            setFeedback("Recognition error", "Voice recognition could not start. Please wait and try again.", "error");
            console.error(error);
        }
    });
}

function wireFallbackControls() {
    d3.select("#region-select").on("change", event => filterRegion(event.target.value));
    d3.select("#highlight-country").on("click", () => {
        const iso = d3.select("#country-select").property("value");
        if (iso) highlightCountry(iso);
        else setFeedback("Fallback control", "Choose a country before selecting Highlight.", "error");
    });
    d3.select("#country-select").on("change", event => {
        if (event.target.value) highlightCountry(event.target.value);
    });
    d3.select("#reset-map").on("click", () => resetVisualization());
    d3.selectAll(".command-example").on("click", function () {
        handleVoiceCommand(this.dataset.command, "example");
    });
    d3.select(window).on("keydown.lab10", event => {
        if (event.key === "Escape") resetVisualization("keyboard");
    });
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
        recordsByIso = new Map(records.map(record => [record.iso3, record]));
        recordsByName = new Map(records.map(record => [normalizePhrase(record.country), record]));
        const gdpByIso = recordsByIso;
        const objectName = Object.keys(topology.objects)[0];
        const topologyObject = topology.objects[objectName];

        topologyObject.geometries = topologyObject.geometries.map(geometry => {
            geometry.properties.iso3 = featureIso(geometry);
            geometry.properties.gdpRecord = gdpByIso.get(geometry.properties.iso3);
            return geometry;
        });

        const features = topojson.feature(topology, topologyObject).features
            .filter(feature => feature.properties.name !== "Antarctica")
            .map(feature => {
                feature.iso3 = feature.properties.iso3;
                feature.gdpRecord = feature.properties.gdpRecord;
                return feature;
            });
        const missingJoins = records.filter(record => !features.some(feature => feature.iso3 === record.iso3));
        if (missingJoins.length) throw new Error(`Unmatched ISO-3 codes: ${missingJoins.map(record => record.iso3).join(", ")}`);

        topologyObject.geometries = topologyObject.geometries.filter(geometry => {
            if (geometry.properties.name === "Antarctica") return false;
            if (geometry.properties.gdpRecord) return true;
            return d3.geoArea(topojson.feature(topology, geometry)) > 0.0001;
        });

        const domain = d3.extent(records, record => record.gdp_2025_billion_usd);
        const color = d3.scaleSequentialLog(
            d3.interpolateRgbBasis(["#cfe4dc", "#75ad9c", "#28776f", "#123f43"])
        ).domain(domain);

        populateCountrySelect(records);
        drawLegend(color, domain);
        const projection = drawMap(features, color);
        drawCartogram(topology, objectName, projection, color, domain);
    })
    .catch(error => {
        console.error(error);
        [mapRoot, cartogramRoot].forEach(root => root
            .html('<p class="chart-error">The geographic data could not be loaded. Start a local web server and refresh the page.</p>')
            .attr("aria-busy", "false"));
    });

wireFallbackControls();
initializeVoiceRecognition();
