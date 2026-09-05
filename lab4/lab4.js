const chartRoot = d3.select("#topic-chart");
const tooltip = d3.select("#topic-tooltip");
const sortControl = d3.select("#topic-sort");

const sentimentKeys = ["negative", "neutral", "positive"];
let topicData = [];
let resizeTimer;

function sortedTopics(sortMode) {
    const rows = [...topicData];
    if (sortMode === "count") {
        return rows.sort((a, b) => d3.descending(a.tweet_count, b.tweet_count));
    }
    if (sortMode === "topic") {
        return rows.sort((a, b) => d3.ascending(a.topic, b.topic));
    }
    return rows.sort((a, b) => d3.descending(a.average_sentiment, b.average_sentiment));
}

function tooltipMarkup(row) {
    const total = row.negative + row.neutral + row.positive;
    const percent = value => d3.format(".0%")(value / total);
    return `
        <strong>${row.topic}</strong>
        <span>${row.tweet_count.toLocaleString()} tweets</span>
        <span>Positive: ${row.positive} (${percent(row.positive)})</span>
        <span>Neutral: ${row.neutral} (${percent(row.neutral)})</span>
        <span>Negative: ${row.negative} (${percent(row.negative)})</span>
        <span>Average score: ${d3.format("+.2f")(row.average_sentiment)}</span>
    `;
}

function showTooltip(event, row) {
    tooltip
        .html(tooltipMarkup(row))
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

function drawChart() {
    if (!topicData.length) return;

    const rows = sortedTopics(sortControl.property("value"));
    const containerWidth = chartRoot.node().clientWidth;
    const width = Math.max(containerWidth, 760);
    const compact = width < 900;
    const margin = {
        top: 40,
        right: compact ? 76 : 96,
        bottom: 48,
        left: compact ? 190 : 220
    };
    const rowHeight = 38;
    const height = margin.top + margin.bottom + rows.length * rowHeight;
    const innerWidth = width - margin.left - margin.right;

    chartRoot.selectAll("*").remove();

    const svg = chartRoot
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-labelledby", "sentiment-heading sentiment-description");

    const x = d3.scaleLinear().domain([0, 1]).range([margin.left, width - margin.right]);
    const y = d3.scaleBand()
        .domain(rows.map(row => row.topic))
        .range([margin.top, height - margin.bottom])
        .padding(0.26);

    const axis = d3.axisTop(x)
        .tickValues([0, 0.25, 0.5, 0.75, 1])
        .tickFormat(d3.format(".0%"))
        .tickSize(-(height - margin.top - margin.bottom));

    svg.append("g")
        .attr("class", "topic-axis topic-axis--x")
        .attr("transform", `translate(0,${margin.top})`)
        .call(axis)
        .call(group => group.select(".domain").remove());

    const rowGroups = svg.selectAll(".topic-row")
        .data(rows, row => row.topic)
        .join("g")
        .attr("class", "topic-row")
        .attr("transform", row => `translate(0,${y(row.topic)})`)
        .attr("tabindex", 0)
        .attr("role", "img")
        .attr("aria-label", row => {
            const total = row.negative + row.neutral + row.positive;
            return `${row.topic}: ${row.tweet_count} tweets, ` +
                `${Math.round(100 * row.positive / total)} percent positive, ` +
                `${Math.round(100 * row.neutral / total)} percent neutral, ` +
                `${Math.round(100 * row.negative / total)} percent negative, ` +
                `average score ${d3.format("+.2f")(row.average_sentiment)}`;
        })
        .on("pointerenter", showTooltip)
        .on("pointermove", moveTooltip)
        .on("pointerleave", hideTooltip)
        .on("focus", function (event, row) {
            const bounds = this.getBoundingClientRect();
            showTooltip({ clientX: bounds.right, clientY: bounds.top }, row);
        })
        .on("blur", hideTooltip);

    rowGroups.append("text")
        .attr("class", "topic-label")
        .attr("x", margin.left - 14)
        .attr("y", y.bandwidth() / 2)
        .attr("dy", "0.35em")
        .attr("text-anchor", "end")
        .text(row => row.topic);

    rowGroups.each(function (row) {
        const total = row.negative + row.neutral + row.positive;
        let cumulative = 0;
        const segments = sentimentKeys.map(key => {
            const start = cumulative;
            cumulative += row[key] / total;
            return { key, start, end: cumulative, count: row[key] };
        });

        d3.select(this)
            .selectAll("rect.sentiment-segment")
            .data(segments)
            .join("rect")
            .attr("class", segment => `sentiment-segment sentiment-segment--${segment.key}`)
            .attr("x", segment => x(segment.start))
            .attr("y", 0)
            .attr("width", segment => Math.max(0, x(segment.end) - x(segment.start)))
            .attr("height", y.bandwidth());
    });

    rowGroups.append("text")
        .attr("class", "topic-score")
        .attr("x", width - margin.right + 14)
        .attr("y", y.bandwidth() / 2)
        .attr("dy", "0.35em")
        .text(row => d3.format("+.2f")(row.average_sentiment));

    svg.append("text")
        .attr("class", "score-column-label")
        .attr("x", width - margin.right + 14)
        .attr("y", 18)
        .text("Mean score");

    svg.append("text")
        .attr("class", "axis-title")
        .attr("x", margin.left + innerWidth / 2)
        .attr("y", height - 10)
        .attr("text-anchor", "middle")
        .text("Share of tweets in topic");
}

d3.csv("../data/lab4_sentiment.csv", row => ({
    topic: row.topic,
    tweet_count: Number(row.tweet_count),
    average_sentiment: Number(row.average_sentiment),
    average_confidence: Number(row.average_confidence),
    negative: Number(row.negative),
    neutral: Number(row.neutral),
    positive: Number(row.positive)
}))
    .then(data => {
        topicData = data;
        drawChart();

        sortControl.on("change", drawChart);
        new ResizeObserver(() => {
            window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(drawChart, 120);
        }).observe(chartRoot.node());
    })
    .catch(error => {
        console.error(error);
        chartRoot
            .html("")
            .append("p")
            .attr("class", "chart-error")
            .text("The sentiment data could not be loaded. Please refresh the page.");
    });
