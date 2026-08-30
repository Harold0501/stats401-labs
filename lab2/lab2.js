const chart = d3.select("#city-chart");
const tooltip = d3.select("#tooltip");

const width = 1060;
const height = 740;
const margin = {
    top: 170,
    right: 30,
    bottom: 48,
    left: 104
};

const populationPanel = {
    left: margin.left,
    right: 520
};

const temperaturePanel = {
    left: 650,
    right: width - margin.right
};

const regionColors = {
    North: "#24756d",
    South: "#db633f",
    East: "#5d6fb4",
    West: "#a05b92"
};

const developmentOrder = ["Low", "Medium", "High"];

function showTooltip(event, d) {
    tooltip
        .style("opacity", 1)
        .html(`
            <strong>${d.city}</strong>
            <span>Population: ${d.population.toFixed(1)} million</span>
            <span>Temperature: ${d.temp_c.toFixed(1)} °C</span>
            <span>Development: ${d.development_level}</span>
            <span>Region: ${d.region}</span>
        `);

    moveTooltip(event);
}

function moveTooltip(event) {
    const hasPointerPosition = Number.isFinite(event.clientX) && Number.isFinite(event.clientY);
    const targetBounds = event.currentTarget.getBoundingClientRect();
    const tooltipNode = tooltip.node();
    const tooltipWidth = tooltipNode.offsetWidth || 190;
    const tooltipHeight = tooltipNode.offsetHeight || 130;
    const anchorX = hasPointerPosition ? event.clientX : targetBounds.right;
    const anchorY = hasPointerPosition ? event.clientY : targetBounds.top;
    const preferredTop = anchorY + 14 + tooltipHeight <= window.innerHeight
        ? anchorY + 14
        : anchorY - tooltipHeight - 14;
    const left = Math.max(
        12,
        Math.min(anchorX + 14, window.innerWidth - tooltipWidth - 12)
    );
    const top = Math.max(
        12,
        Math.min(preferredTop, window.innerHeight - tooltipHeight - 12)
    );

    tooltip
        .style("left", `${left}px`)
        .style("top", `${top}px`);
}

function hideTooltip() {
    tooltip.style("opacity", 0);
}

async function drawChart() {
    try {
        const data = await d3.csv(
            "../data/cities_multivariate.csv",
            d => ({
                city: d.city,
                population: +d.population,
                temp_c: +d.temp_c,
                development_level: d.development_level,
                region: d.region
            })
        );

        data.sort((a, b) => d3.descending(a.population, b.population));
        chart.selectAll("*").remove();

        const xPopulation = d3.scaleLinear()
            .domain([0, d3.max(data, d => d.population)])
            .nice()
            .range([populationPanel.left, populationPanel.right]);

        const xTemperature = d3.scaleLinear()
            .domain(d3.extent(data, d => d.temp_c))
            .nice()
            .range([temperaturePanel.left, temperaturePanel.right]);

        const yCity = d3.scaleBand()
            .domain(data.map(d => d.city))
            .range([margin.top, height - margin.bottom])
            .padding(0.3);

        const dotSize = d3.scaleOrdinal()
            .domain(developmentOrder)
            .range([6, 9, 12]);

        const color = d3.scaleOrdinal()
            .domain(Object.keys(regionColors))
            .range(Object.values(regionColors));

        const svg = chart
            .append("svg")
            .attr("viewBox", `0 0 ${width} ${height}`)
            .attr("role", "img")
            .attr("aria-labelledby", "city-chart-title city-chart-description");

        svg.append("title")
            .attr("id", "city-chart-title")
            .text("City population, temperature, development level, and region");

        svg.append("desc")
            .attr("id", "city-chart-description")
            .text(
                "Twelve city rows pair population bars with temperature dots. " +
                "Dot size represents development level and color represents region."
            );

        svg.append("rect")
            .attr("class", "city-plot-background")
            .attr("x", 12)
            .attr("y", margin.top)
            .attr("width", width - margin.right - 12)
            .attr("height", height - margin.top - margin.bottom)
            .attr("fill", "#fffdf7");

        const populationAxis = d3.axisTop(xPopulation)
            .ticks(5)
            .tickSize(-(height - margin.top - margin.bottom))
            .tickFormat(d => `${d}M`);

        const temperatureAxis = d3.axisTop(xTemperature)
            .ticks(5)
            .tickSize(-(height - margin.top - margin.bottom))
            .tickFormat(d => `${d}°`);

        svg.append("g")
            .attr("class", "chart-axis chart-grid")
            .attr("transform", `translate(0, ${margin.top})`)
            .call(populationAxis);

        svg.append("g")
            .attr("class", "chart-axis chart-grid")
            .attr("transform", `translate(0, ${margin.top})`)
            .call(temperatureAxis);

        svg.append("text")
            .attr("class", "panel-title")
            .attr("x", populationPanel.left)
            .attr("y", 38)
            .text("Population");

        svg.append("text")
            .attr("class", "panel-subtitle")
            .attr("x", populationPanel.left)
            .attr("y", 62)
            .text("Bar length · millions");

        svg.append("text")
            .attr("class", "panel-title")
            .attr("x", temperaturePanel.left)
            .attr("y", 38)
            .text("Temperature");

        svg.append("text")
            .attr("class", "panel-subtitle")
            .attr("x", temperaturePanel.left)
            .attr("y", 62)
            .text("Dot position · degrees Celsius");

        svg.append("line")
            .attr("class", "panel-divider")
            .attr("x1", 586)
            .attr("x2", 586)
            .attr("y1", 30)
            .attr("y2", height - margin.bottom);

        const rows = svg.selectAll(".city-row")
            .data(data)
            .join("g")
            .attr("class", "city-row")
            .attr("tabindex", 0)
            .attr(
                "aria-label",
                d => `${d.city}: ${d.population} million people, ${d.temp_c} degrees Celsius, ${d.development_level} development, ${d.region} region`
            )
            .on("mouseenter focus", showTooltip)
            .on("mousemove", moveTooltip)
            .on("mouseleave blur", hideTooltip);

        rows.append("line")
            .attr("class", "row-hit-target")
            .attr("x1", margin.left - 8)
            .attr("x2", width - margin.right)
            .attr("y1", d => yCity(d.city) + yCity.bandwidth() / 2)
            .attr("y2", d => yCity(d.city) + yCity.bandwidth() / 2)
            .attr("stroke", "transparent")
            .attr("stroke-width", yCity.step());

        rows.append("line")
            .attr("class", "row-guide")
            .attr("x1", margin.left - 8)
            .attr("x2", width - margin.right)
            .attr("y1", d => yCity(d.city) + yCity.bandwidth() / 2)
            .attr("y2", d => yCity(d.city) + yCity.bandwidth() / 2);

        rows.append("rect")
            .attr("class", "population-bar")
            .attr("x", populationPanel.left)
            .attr("y", d => yCity(d.city))
            .attr("width", d => xPopulation(d.population) - populationPanel.left)
            .attr("height", yCity.bandwidth())
            .attr("fill", d => color(d.region));

        rows.append("text")
            .attr("class", "population-label")
            .attr("x", d => xPopulation(d.population) + 8)
            .attr("y", d => yCity(d.city) + yCity.bandwidth() / 2)
            .attr("dy", "0.35em")
            .text(d => `${d.population.toFixed(1)}M`);

        rows.append("line")
            .attr("class", "temperature-track")
            .attr("x1", temperaturePanel.left)
            .attr("x2", temperaturePanel.right)
            .attr("y1", d => yCity(d.city) + yCity.bandwidth() / 2)
            .attr("y2", d => yCity(d.city) + yCity.bandwidth() / 2);

        rows.append("circle")
            .attr("class", "temperature-dot")
            .attr("cx", d => xTemperature(d.temp_c))
            .attr("cy", d => yCity(d.city) + yCity.bandwidth() / 2)
            .attr("r", d => dotSize(d.development_level))
            .attr("fill", d => color(d.region));

        rows.append("text")
            .attr("class", "temperature-label")
            .attr("x", d => {
                const offset = dotSize(d.development_level) + 7;
                return xTemperature(d.temp_c) + (d.temp_c >= 24 ? -offset : offset);
            })
            .attr("y", d => yCity(d.city) + yCity.bandwidth() / 2)
            .attr("dy", "0.35em")
            .attr("text-anchor", d => d.temp_c >= 24 ? "end" : "start")
            .text(d => `${d.temp_c.toFixed(1)}°`);

        svg.append("g")
            .attr("class", "chart-axis city-axis")
            .attr("transform", `translate(${populationPanel.left}, 0)`)
            .call(d3.axisLeft(yCity).tickSize(0));

        drawLegends(svg, color, dotSize);
    } catch (error) {
        console.error("Unable to load city data:", error);
        chart.html(
            '<p class="chart-error">The city data could not be loaded. Please view this page through a local web server.</p>'
        );
    }
}

function drawLegends(svg, color, dotSize) {
    const colorLegend = svg.append("g")
        .attr("class", "city-legend")
        .attr("transform", "translate(104, 120)");

    colorLegend.append("text")
        .attr("class", "legend-title")
        .attr("x", 0)
        .attr("y", -22)
        .text("Region");

    const regionItems = colorLegend.selectAll(".region-item")
        .data(color.domain())
        .join("g")
        .attr("class", "region-item")
        .attr("transform", (d, i) => `translate(${i * 94}, 0)`);

    regionItems.append("circle")
        .attr("r", 6)
        .attr("fill", d => color(d));

    regionItems.append("text")
        .attr("x", 11)
        .attr("dy", "0.35em")
        .text(d => d);

    const sizeLegend = svg.append("g")
        .attr("class", "city-legend size-legend")
        .attr("transform", "translate(650, 120)");

    sizeLegend.append("text")
        .attr("class", "legend-title")
        .attr("x", 0)
        .attr("y", -22)
        .text("Development level");

    const sizeItems = sizeLegend.selectAll(".size-item")
        .data(developmentOrder)
        .join("g")
        .attr("class", "size-item")
        .attr("transform", (d, i) => `translate(${i * 100}, 0)`);

    sizeItems.append("circle")
        .attr("r", d => dotSize(d))
        .attr("fill", "none")
        .attr("stroke", "currentColor")
        .attr("stroke-width", 1.5);

    sizeItems.append("text")
        .attr("x", 17)
        .attr("dy", "0.35em")
        .text(d => d);
}

drawChart();
