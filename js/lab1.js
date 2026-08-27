const chart = d3.select("#chart");

async function drawChart() {
    try {
        const data = await d3.csv("../data/students.csv", d => ({
            name: d.name,
            score: +d.score
        }));

        chart.selectAll("*").remove();

        const width = 920;
        const height = 500;
        const margin = { top: 24, right: 16, bottom: 94, left: 16 };
        const chartHeight = height - margin.top - margin.bottom;

        const x = d3.scaleBand()
            .domain(data.map(d => d.name))
            .range([margin.left, width - margin.right])
            .padding(0.22);

        const y = d3.scaleLinear()
            .domain([0, 100])
            .range([chartHeight, margin.top]);

        const svg = chart
            .append("svg")
            .attr("viewBox", `0 0 ${width} ${height}`)
            .attr("role", "img")
            .attr("aria-labelledby", "chart-title chart-description");

        svg.append("title")
            .attr("id", "chart-title")
            .text("Student score bar chart");

        svg.append("desc")
            .attr("id", "chart-description")
            .text("Eight bars compare student scores from 66 to 95 points.");

        svg.append("line")
            .attr("class", "baseline")
            .attr("x1", margin.left)
            .attr("x2", width - margin.right)
            .attr("y1", chartHeight)
            .attr("y2", chartHeight);

        const groups = svg.selectAll(".bar-group")
            .data(data)
            .join("g")
            .attr("class", "bar-group")
            .attr("transform", d => `translate(${x(d.name)}, 0)`);

        groups.append("rect")
            .attr("class", "bar")
            .attr("x", 0)
            .attr("y", d => y(d.score))
            .attr("width", x.bandwidth())
            .attr("height", d => chartHeight - y(d.score))
            .attr("rx", 8);

        groups.append("text")
            .attr("class", "bar-value")
            .attr("x", x.bandwidth() / 2)
            .attr("y", d => y(d.score) + 29)
            .attr("text-anchor", "middle")
            .text(d => d.score);

        groups.append("text")
            .attr("class", "bar-name")
            .attr("x", x.bandwidth() / 2)
            .attr("y", chartHeight + 32)
            .attr("text-anchor", "middle")
            .text(d => d.name);

        groups.append("text")
            .attr("class", "bar-score-label")
            .attr("x", x.bandwidth() / 2)
            .attr("y", chartHeight + 54)
            .attr("text-anchor", "middle")
            .text(d => `${d.score} points`);
    } catch (error) {
        console.error("Unable to load student data:", error);
        chart.html(
            '<p class="chart-error">The student data could not be loaded. Please view this page through a local web server.</p>'
        );
    }
}

drawChart();
