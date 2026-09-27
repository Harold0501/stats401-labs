(() => {
    "use strict";

    const captureMode = new URLSearchParams(window.location.search).get("capture") === "redesign";
    document.body.classList.toggle("capture-mode", captureMode);

    const chartHost = document.querySelector("#exoplanet-chart");
    const summary = document.querySelector("#chart-summary");
    const detail = document.querySelector("#planet-detail");
    const tooltip = document.querySelector("#project-tooltip");
    const accessSummary = document.querySelector("#chart-access-summary");

    if (!window.d3) {
        chartHost.innerHTML = '<p class="chart-error">D3.js could not be loaded. Check the network connection and reload the page.</p>';
        chartHost.setAttribute("aria-busy", "false");
        return;
    }

    const colors = new Map([
        ["Transit", "#6f4a8e"],
        ["Radial Velocity", "#07866f"],
        ["Transit Timing Variations", "#d64c72"],
        ["Imaging", "#d69200"],
        ["Eclipse Timing Variations", "#719f47"],
        ["Microlensing", "#3676b9"],
        ["Pulsar Timing", "#007f8f"],
        ["Astrometry", "#c52a8c"],
        ["Orbital Brightness Modulation", "#dc6c0c"],
        ["Pulsation Timing Variations", "#ef746b"]
    ]);

    const fallbackColor = "#667773";
    const number = (value) => value === "" || value == null ? null : +value;
    const integer = (value) => value === "" || value == null ? null : Number.parseInt(value, 10);
    const formatCompact = d3.format(".3~g");
    const formatEarthMass = d3.format(",.3~g");

    const escapeHtml = (value) => String(value ?? "—").replace(/[&<>'"]/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;"
    })[character]);

    const parseExoplanet = (row) => ({
        ...row,
        disc_year: integer(row.disc_year),
        pl_orbper: number(row.pl_orbper),
        pl_orbpererr1: number(row.pl_orbpererr1),
        pl_orbpererr2: number(row.pl_orbpererr2),
        pl_bmassj: number(row.pl_bmassj),
        pl_bmassjerr1: number(row.pl_bmassjerr1),
        pl_bmassjerr2: number(row.pl_bmassjerr2),
        pl_bmasse: number(row.pl_bmasse),
        pl_bmasseerr1: number(row.pl_bmasseerr1),
        pl_bmasseerr2: number(row.pl_bmasseerr2),
        sy_dist: number(row.sy_dist)
    });

    const parseSolarPlanet = (row) => ({
        ...row,
        orbital_period_days: number(row.orbital_period_days),
        mass_1e24_kg: number(row.mass_1e24_kg),
        mass_jupiter: number(row.mass_jupiter)
    });

    const methodButtons = document.querySelector("#method-buttons");
    const methodAll = document.querySelector("#method-all");
    const searchInput = document.querySelector("#planet-search");
    const provenanceSelect = document.querySelector("#mass-provenance");
    const yearInput = document.querySelector("#year-cutoff");
    const yearOutput = document.querySelector("#year-output");
    const solarToggle = document.querySelector("#solar-toggle");
    const controls = document.querySelector("#exoplanet-controls");

    const state = {
        methods: new Set(),
        year: +yearInput.value,
        provenance: "all",
        search: "",
        showSolar: true,
        selected: null,
        keyboardIndex: -1
    };

    let exoplanets = [];
    let solarPlanets = [];
    let methods = [];
    let visiblePlanets = [];
    let pointSelection;
    let solarSelection;
    let selectionLayer;
    let xScale;
    let yScale;
    let svg;

    const methodColor = (method) => colors.get(method) || fallbackColor;

    const formatPeriod = (value) => {
        if (value >= 1_000_000) return `${formatCompact(value / 1_000_000)} million days`;
        if (value >= 1_000) return `${d3.format(",.0f")(value)} days`;
        if (value >= 10) return `${d3.format(",.1~f")(value)} days`;
        return `${d3.format(".3~f")(value)} days`;
    };

    const formatJupiterMass = (value) => {
        if (value >= 0.01) return `${formatCompact(value)} M♃`;
        return `${d3.format(".3~e")(value)} M♃`;
    };

    const formatTick = (value) => {
        if (value >= 1_000_000) return `${value / 1_000_000}M`;
        if (value >= 1_000) return `${value / 1_000}k`;
        if (value >= 1) return `${value}`;
        if (value >= 0.01) return d3.format(".2~f")(value);
        return d3.format(".0e")(value).replace("e-0", "e−").replace("e-", "e−");
    };

    const provenanceLabel = (value) => ({
        Mass: "Measured mass",
        Msini: "Minimum mass (M sin(i))",
        "Msin(i)/sin(i)": "Derived mass (M sin(i) / sin(i))"
    })[value] || value || "Not reported";

    const uncertaintyText = (value, upper, lower, formatter) => {
        if (upper == null || lower == null) return "Not reported";
        return `+${formatter(upper)} / −${formatter(Math.abs(lower))}`;
    };

    const isVisible = (planet) => {
        const methodMatch = state.methods.has(planet.discoverymethod);
        const yearMatch = planet.disc_year <= state.year;
        const provenanceMatch = state.provenance === "all" || planet.pl_bmassprov === state.provenance;
        const searchMatch = !state.search || `${planet.pl_name} ${planet.hostname}`.toLowerCase().includes(state.search);
        return methodMatch && yearMatch && provenanceMatch && searchMatch;
    };

    const renderMethodButtons = () => {
        const counts = d3.rollup(exoplanets, (values) => values.length, (planet) => planet.discoverymethod);

        methodButtons.replaceChildren();
        methods.forEach((method) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "method-button";
            button.dataset.method = method;
            button.setAttribute("aria-pressed", "true");
            button.style.setProperty("--method-color", methodColor(method));
            button.innerHTML = `<span class="method-swatch" aria-hidden="true"></span><span>${escapeHtml(method)}</span><strong>${counts.get(method)}</strong>`;
            button.addEventListener("click", () => {
                if (state.methods.has(method)) state.methods.delete(method);
                else state.methods.add(method);
                state.keyboardIndex = -1;
                update();
            });
            methodButtons.append(button);
        });
    };

    const renderChart = () => {
        const width = 1000;
        const height = 660;
        const margin = { top: 34, right: 36, bottom: 82, left: 92 };
        const plotWidth = width - margin.left - margin.right;
        const plotHeight = height - margin.top - margin.bottom;

        xScale = d3.scaleLog()
            .domain([0.08, 10_000_000])
            .range([margin.left, width - margin.right]);

        yScale = d3.scaleLog()
            .domain([0.00005, 40])
            .range([height - margin.bottom, margin.top]);

        chartHost.replaceChildren();
        svg = d3.select(chartHost)
            .append("svg")
            .attr("viewBox", `0 0 ${width} ${height}`)
            .attr("role", "img")
            .attr("tabindex", 0)
            .attr("aria-labelledby", "chart-svg-title chart-svg-description")
            .attr("aria-describedby", "chart-access-summary");

        svg.append("title")
            .attr("id", "chart-svg-title")
            .text("Interactive scatterplot of confirmed exoplanet mass and orbital period");

        svg.append("desc")
            .attr("id", "chart-svg-description")
            .text("A logarithmic scatterplot. Use the controls to filter the data. With the plot focused, use the left and right arrow keys to inspect visible planets.");

        svg.append("defs")
            .append("clipPath")
            .attr("id", "exoplanet-plot-clip")
            .append("rect")
            .attr("x", margin.left)
            .attr("y", margin.top)
            .attr("width", plotWidth)
            .attr("height", plotHeight);

        const xTicks = [0.1, 1, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000];
        const yTicks = [0.0001, 0.001, 0.01, 0.1, 1, 10];

        svg.append("g")
            .attr("class", "project-grid")
            .attr("transform", `translate(0,${height - margin.bottom})`)
            .call(d3.axisBottom(xScale).tickValues(xTicks).tickSize(-plotHeight).tickFormat(""));

        svg.append("g")
            .attr("class", "project-grid")
            .attr("transform", `translate(${margin.left},0)`)
            .call(d3.axisLeft(yScale).tickValues(yTicks).tickSize(-plotWidth).tickFormat(""));

        svg.append("g")
            .attr("class", "project-axis")
            .attr("transform", `translate(0,${height - margin.bottom})`)
            .call(d3.axisBottom(xScale).tickValues(xTicks).tickFormat(formatTick).tickSizeOuter(0));

        svg.append("g")
            .attr("class", "project-axis")
            .attr("transform", `translate(${margin.left},0)`)
            .call(d3.axisLeft(yScale).tickValues(yTicks).tickFormat(formatTick).tickSizeOuter(0));

        svg.append("text")
            .attr("class", "project-axis-label")
            .attr("x", margin.left + plotWidth / 2)
            .attr("y", height - 20)
            .attr("text-anchor", "middle")
            .text("Orbital period · Earth days (log scale)");

        svg.append("text")
            .attr("class", "project-axis-label")
            .attr("transform", "rotate(-90)")
            .attr("x", -(margin.top + plotHeight / 2))
            .attr("y", 25)
            .attr("text-anchor", "middle")
            .text("Best mass · Jupiter masses (log scale)");

        const pointLayer = svg.append("g")
            .attr("class", "exoplanet-point-layer")
            .attr("clip-path", "url(#exoplanet-plot-clip)");

        pointSelection = pointLayer.selectAll("circle")
            .data(exoplanets, (planet) => planet.pl_name)
            .join("circle")
            .attr("class", "exo-point")
            .attr("cx", (planet) => xScale(planet.pl_orbper))
            .attr("cy", (planet) => yScale(planet.pl_bmassj))
            .attr("r", 3.2)
            .attr("fill", (planet) => methodColor(planet.discoverymethod))
            .attr("aria-hidden", "true")
            .on("pointerenter", (event, planet) => showTooltip(event, planet, "exoplanet"))
            .on("pointermove", moveTooltip)
            .on("pointerleave", hideTooltip)
            .on("click", (event, planet) => {
                event.stopPropagation();
                selectPlanet(planet, "exoplanet");
            });

        const solarOffsets = new Map([
            ["Mercury", { dx: -10, dy: -13, anchor: "end" }],
            ["Venus", { dx: -12, dy: -17, anchor: "end" }],
            ["Earth", { dx: 13, dy: 17, anchor: "start" }],
            ["Mars", { dx: 12, dy: 15, anchor: "start" }],
            ["Jupiter", { dx: 12, dy: -12, anchor: "start" }],
            ["Saturn", { dx: 12, dy: 4, anchor: "start" }],
            ["Uranus", { dx: 12, dy: 4, anchor: "start" }],
            ["Neptune", { dx: 12, dy: 4, anchor: "start" }]
        ]);

        const solarLayer = svg.append("g").attr("class", "solar-layer");
        solarSelection = solarLayer.selectAll("g")
            .data(solarPlanets, (planet) => planet.name)
            .join("g")
            .attr("class", "solar-planet")
            .attr("transform", (planet) => `translate(${xScale(planet.orbital_period_days)},${yScale(planet.mass_jupiter)})`)
            .on("pointerenter", (event, planet) => showTooltip(event, planet, "solar"))
            .on("pointermove", moveTooltip)
            .on("pointerleave", hideTooltip)
            .on("click", (event, planet) => {
                event.stopPropagation();
                selectPlanet(planet, "solar");
            });

        solarSelection.append("circle")
            .attr("r", 7)
            .attr("aria-hidden", "true");

        solarSelection.append("text")
            .attr("x", (planet) => solarOffsets.get(planet.name).dx)
            .attr("y", (planet) => solarOffsets.get(planet.name).dy)
            .attr("text-anchor", (planet) => solarOffsets.get(planet.name).anchor)
            .text((planet) => planet.name);

        selectionLayer = svg.append("g")
            .attr("class", "selection-layer")
            .attr("clip-path", "url(#exoplanet-plot-clip)");

        svg.on("keydown", handleChartKeydown);
        chartHost.setAttribute("aria-busy", "false");
        update();

    };

    const update = () => {
        visiblePlanets = exoplanets.filter(isVisible).sort((a, b) => d3.ascending(a.pl_orbper, b.pl_orbper));
        const visibleNames = new Set(visiblePlanets.map((planet) => planet.pl_name));

        pointSelection
            .classed("is-hidden", (planet) => !visibleNames.has(planet.pl_name))
            .classed("is-selected", (planet) => state.selected?.kind === "exoplanet" && state.selected.datum.pl_name === planet.pl_name)
            .attr("pointer-events", (planet) => visibleNames.has(planet.pl_name) ? "auto" : "none");

        solarSelection
            .classed("is-hidden", !state.showSolar)
            .classed("is-selected", (planet) => state.selected?.kind === "solar" && state.selected.datum.name === planet.name)
            .attr("pointer-events", state.showSolar ? "auto" : "none");

        document.querySelectorAll(".method-button").forEach((button) => {
            const active = state.methods.has(button.dataset.method);
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", `${active}`);
        });

        yearOutput.value = `${state.year}`;
        yearOutput.textContent = `${state.year}`;

        const selectedStillVisible = !state.selected ||
            (state.selected.kind === "solar" ? state.showSolar : visibleNames.has(state.selected.datum.pl_name));
        if (!selectedStillVisible) state.selected = null;

        renderSelection();
        renderDetail();
        updateSummary();
    };

    const updateSummary = () => {
        const methodPhrase = state.methods.size === methods.length
            ? `all ${methods.length} discovery methods`
            : `${state.methods.size} selected ${state.methods.size === 1 ? "method" : "methods"}`;
        const searchPhrase = state.search ? ` matching “${searchInput.value.trim()}”` : "";
        const provenancePhrase = state.provenance === "all" ? "all mass types" : provenanceLabel(state.provenance);
        const solarPhrase = state.showSolar ? "Solar System reference on" : "Solar System reference off";
        summary.textContent = `Showing ${visiblePlanets.length.toLocaleString()} of ${exoplanets.length.toLocaleString()} confirmed planets${searchPhrase} through ${state.year} · ${methodPhrase} · ${provenancePhrase} · ${solarPhrase}.`;
        accessSummary.textContent = `${summary.textContent} The x axis spans 0.08 to 10 million Earth days. The y axis spans 0.00005 to 40 Jupiter masses. Both axes are logarithmic.`;
    };

    const renderSelection = () => {
        selectionLayer.selectAll("*").remove();
        if (!state.selected) return;

        const { datum, kind } = state.selected;
        const xValue = kind === "solar" ? datum.orbital_period_days : datum.pl_orbper;
        const yValue = kind === "solar" ? datum.mass_jupiter : datum.pl_bmassj;
        const x = xScale(xValue);
        const y = yScale(yValue);

        if (kind === "exoplanet") {
            const periodLow = datum.pl_orbpererr2 == null ? null : datum.pl_orbper + datum.pl_orbpererr2;
            const periodHigh = datum.pl_orbpererr1 == null ? null : datum.pl_orbper + datum.pl_orbpererr1;
            const massLow = datum.pl_bmassjerr2 == null ? null : datum.pl_bmassj + datum.pl_bmassjerr2;
            const massHigh = datum.pl_bmassjerr1 == null ? null : datum.pl_bmassj + datum.pl_bmassjerr1;

            if (periodLow > 0 && periodHigh > 0) {
                selectionLayer.append("line")
                    .attr("class", "selection-uncertainty")
                    .attr("x1", xScale(periodLow))
                    .attr("x2", xScale(periodHigh))
                    .attr("y1", y)
                    .attr("y2", y);
            }

            if (massLow > 0 && massHigh > 0) {
                selectionLayer.append("line")
                    .attr("class", "selection-uncertainty")
                    .attr("x1", x)
                    .attr("x2", x)
                    .attr("y1", yScale(massLow))
                    .attr("y2", yScale(massHigh));
            }
        }

        selectionLayer.append("circle")
            .attr("class", "selection-ring")
            .attr("cx", x)
            .attr("cy", y)
            .attr("r", kind === "solar" ? 11 : 8);
    };

    const renderDetail = () => {
        if (!state.selected) {
            detail.innerHTML = `
                <p class="detail-kicker">Details on demand</p>
                <h3>Select a planet</h3>
                <p>Point to a mark, click it, search by name, or focus the chart and use the arrow keys.</p>
                <dl class="planet-detail-list">
                    <dt>X</dt><dd>Orbital period in Earth days</dd>
                    <dt>Y</dt><dd>Best mass in Jupiter masses</dd>
                    <dt>Color</dt><dd>Discovery method</dd>
                </dl>`;
            return;
        }

        const { datum, kind } = state.selected;
        if (kind === "solar") {
            detail.innerHTML = `
                <p class="detail-kicker">Solar System reference</p>
                <h3>${escapeHtml(datum.name)}</h3>
                <dl class="planet-detail-list">
                    <dt>Period</dt><dd>${formatPeriod(datum.orbital_period_days)}</dd>
                    <dt>Mass</dt><dd>${formatJupiterMass(datum.mass_jupiter)}</dd>
                    <dt>Mass</dt><dd>${formatCompact(datum.mass_1e24_kg)} × 10²⁴ kg</dd>
                    <dt>Source</dt><dd>JPL Planetary Physical Parameters</dd>
                </dl>
                <button class="detail-clear" type="button">Clear selection</button>`;
        } else {
            detail.innerHTML = `
                <p class="detail-kicker">Confirmed exoplanet</p>
                <h3>${escapeHtml(datum.pl_name)}</h3>
                <p class="detail-method"><i style="--detail-color:${methodColor(datum.discoverymethod)}"></i>${escapeHtml(datum.discoverymethod)}</p>
                <dl class="planet-detail-list">
                    <dt>Period</dt><dd>${formatPeriod(datum.pl_orbper)}</dd>
                    <dt>Uncertainty</dt><dd>${uncertaintyText(datum.pl_orbper, datum.pl_orbpererr1, datum.pl_orbpererr2, formatCompact)}</dd>
                    <dt>Best mass</dt><dd>${formatJupiterMass(datum.pl_bmassj)}${datum.pl_bmasse == null ? "" : ` · ${formatEarthMass(datum.pl_bmasse)} M⊕`}</dd>
                    <dt>Uncertainty</dt><dd>${uncertaintyText(datum.pl_bmassj, datum.pl_bmassjerr1, datum.pl_bmassjerr2, formatCompact)}</dd>
                    <dt>Mass type</dt><dd>${escapeHtml(provenanceLabel(datum.pl_bmassprov))}</dd>
                    <dt>Discovered</dt><dd>${datum.disc_year ?? "—"}</dd>
                    <dt>Facility</dt><dd>${escapeHtml(datum.disc_facility || "Not reported")}</dd>
                    <dt>Distance</dt><dd>${datum.sy_dist == null ? "Not reported" : `${formatCompact(datum.sy_dist)} parsecs`}</dd>
                    <dt>Host type</dt><dd>${escapeHtml(datum.st_spectype || "Not reported")}</dd>
                </dl>
                <button class="detail-clear" type="button">Clear selection</button>`;
        }

        detail.querySelector(".detail-clear").addEventListener("click", () => {
            state.selected = null;
            renderSelection();
            renderDetail();
            pointSelection.classed("is-selected", false);
            solarSelection.classed("is-selected", false);
        });
    };

    const selectPlanet = (datum, kind) => {
        state.selected = { datum, kind };
        if (kind === "exoplanet") {
            state.keyboardIndex = visiblePlanets.findIndex((planet) => planet.pl_name === datum.pl_name);
        }
        update();
    };

    const tooltipContent = (datum, kind) => {
        if (kind === "solar") {
            return `<strong>${escapeHtml(datum.name)}</strong><span>${formatPeriod(datum.orbital_period_days)}</span><span>${formatJupiterMass(datum.mass_jupiter)}</span><small>Solar System · click for details</small>`;
        }
        return `<strong>${escapeHtml(datum.pl_name)}</strong><span>${formatPeriod(datum.pl_orbper)}</span><span>${formatJupiterMass(datum.pl_bmassj)} · ${escapeHtml(provenanceLabel(datum.pl_bmassprov))}</span><small>${escapeHtml(datum.discoverymethod)} · ${datum.disc_year} · click for details</small>`;
    };

    const showTooltip = (event, datum, kind) => {
        tooltip.innerHTML = tooltipContent(datum, kind);
        tooltip.hidden = false;
        moveTooltip(event);
    };

    function moveTooltip(event) {
        if (tooltip.hidden) return;
        const gap = 16;
        const bounds = tooltip.getBoundingClientRect();
        const left = Math.min(event.clientX + gap, window.innerWidth - bounds.width - 10);
        const top = Math.min(event.clientY + gap, window.innerHeight - bounds.height - 10);
        tooltip.style.left = `${Math.max(10, left)}px`;
        tooltip.style.top = `${Math.max(10, top)}px`;
    }

    const hideTooltip = () => {
        tooltip.hidden = true;
    };

    const handleChartKeydown = (event) => {
        if (!visiblePlanets.length) return;
        const handledKeys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
        if (!handledKeys.includes(event.key)) return;
        event.preventDefault();

        if (event.key === "Home") state.keyboardIndex = 0;
        else if (event.key === "End") state.keyboardIndex = visiblePlanets.length - 1;
        else {
            const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
            state.keyboardIndex = state.keyboardIndex < 0
                ? (direction > 0 ? 0 : visiblePlanets.length - 1)
                : (state.keyboardIndex + direction + visiblePlanets.length) % visiblePlanets.length;
        }

        selectPlanet(visiblePlanets[state.keyboardIndex], "exoplanet");
    };

    searchInput.addEventListener("input", () => {
        state.search = searchInput.value.trim().toLowerCase();
        state.keyboardIndex = -1;
        update();
    });

    searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && visiblePlanets.length) {
            event.preventDefault();
            selectPlanet(visiblePlanets[0], "exoplanet");
            svg.node().focus();
        }
    });

    provenanceSelect.addEventListener("change", () => {
        state.provenance = provenanceSelect.value;
        state.keyboardIndex = -1;
        update();
    });

    yearInput.addEventListener("input", () => {
        state.year = +yearInput.value;
        state.keyboardIndex = -1;
        update();
    });

    solarToggle.addEventListener("change", () => {
        state.showSolar = solarToggle.checked;
        update();
    });

    methodAll.addEventListener("click", () => {
        state.methods = new Set(methods);
        update();
    });

    controls.addEventListener("reset", (event) => {
        event.preventDefault();
        searchInput.value = "";
        provenanceSelect.value = "all";
        yearInput.value = `${d3.max(exoplanets, (planet) => planet.disc_year)}`;
        solarToggle.checked = true;
        state.search = "";
        state.provenance = "all";
        state.year = +yearInput.value;
        state.showSolar = true;
        state.methods = new Set(methods);
        state.selected = null;
        state.keyboardIndex = -1;
        update();
    });

    Promise.all([
        d3.csv("data/exoplanets_mass_period.csv", parseExoplanet),
        d3.csv("data/solar_system_planets.csv", parseSolarPlanet)
    ]).then(([exoplanetRows, solarRows]) => {
        exoplanets = exoplanetRows.filter((planet) => planet.pl_orbper > 0 && planet.pl_bmassj > 0 && planet.disc_year);
        solarPlanets = solarRows.filter((planet) => planet.orbital_period_days > 0 && planet.mass_jupiter > 0);
        methods = Array.from(d3.rollup(exoplanets, (values) => values.length, (planet) => planet.discoverymethod))
            .sort((a, b) => d3.descending(a[1], b[1]))
            .map(([method]) => method);
        state.methods = new Set(methods);

        const minYear = d3.min(exoplanets, (planet) => planet.disc_year);
        const maxYear = d3.max(exoplanets, (planet) => planet.disc_year);
        yearInput.min = `${minYear}`;
        yearInput.max = `${maxYear}`;
        yearInput.value = `${maxYear}`;
        state.year = maxYear;

        renderMethodButtons();
        renderChart();
    }).catch((error) => {
        console.error(error);
        chartHost.innerHTML = '<p class="chart-error">The project data could not be loaded. Serve this site over HTTP or check that both CSV files are available.</p>';
        chartHost.setAttribute("aria-busy", "false");
        summary.textContent = "Data unavailable.";
    });
})();
