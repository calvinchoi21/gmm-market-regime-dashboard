/* timeline.js — regime color-band timeline with S&P 500 overlay */

function buildTimelineChart(data) {
  const bands  = data.timeline.bands;
  const dates  = data.timeline.dates.map(d => new Date(d));
  const prices = data.timeline.spy_prices;
  const colors = data.regime_colors;
  const labels = data.regime_labels;

  const showOverlay = () => document.getElementById("spy-overlay-toggle").checked;

  function render() {
    const container = document.getElementById("timeline-chart-container");
    const W = container.clientWidth - 40;
    const H = 320;
    const margin = { top: 20, right: 20, bottom: 36, left: 70 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const svg = d3.select("#timeline-chart")
      .attr("viewBox", `0 0 ${W} ${H}`)
      .attr("width", W).attr("height", H);
    svg.selectAll("*").remove();

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const allDates = bands.flatMap(b => [new Date(b.start), new Date(b.end)]);
    const xScale = d3.scaleTime().domain(d3.extent(allDates)).range([0, w]);

    // Colour bands
    const defs = svg.append("defs");
    bands.forEach((band, bi) => {
      const x1 = xScale(new Date(band.start));
      const x2 = xScale(new Date(band.end));
      const gid = `band-grad-${bi}`;
      const grad = defs.append("linearGradient").attr("id", gid)
        .attr("x1", "0%").attr("x2", "0%").attr("y1", "0%").attr("y2", "100%");
      grad.append("stop").attr("offset", "0%").attr("stop-color", colors[band.regime]).attr("stop-opacity", 0.22);
      grad.append("stop").attr("offset", "100%").attr("stop-color", colors[band.regime]).attr("stop-opacity", 0.04);

      g.append("rect")
        .attr("x", x1).attr("y", 0)
        .attr("width", Math.max(x2 - x1, 1)).attr("height", h)
        .attr("fill", `url(#${gid})`);
    });

    // Grid
    xScale.ticks(8).forEach(t => {
      g.append("line").attr("class", "grid-line")
        .attr("x1", xScale(t)).attr("x2", xScale(t))
        .attr("y1", 0).attr("y2", h).attr("stroke-dasharray", "2,4");
    });

    // S&P 500 overlay
    if (showOverlay()) {
      const yPrice = d3.scaleLinear()
        .domain([d3.min(prices) * 0.95, d3.max(prices) * 1.05])
        .range([h, 0]);

      const lineGen = d3.line()
        .x((d, i) => xScale(dates[i])).y(d => yPrice(d))
        .defined(d => d != null).curve(d3.curveMonotoneX);

      g.append("path").datum(prices)
        .attr("class", "chart-line")
        .attr("stroke", "var(--text-secondary)")
        .attr("stroke-width", 1.2)
        .attr("opacity", 0.6)
        .attr("d", lineGen);

      // Right axis for S&P price
      g.append("g").attr("transform", `translate(${w},0)`)
        .call(d3.axisRight(yPrice).ticks(5).tickFormat(d => "$" + d3.format(",.0f")(d)))
        .call(gg => {
          gg.select(".domain").remove();
          gg.selectAll("line").remove();
          gg.selectAll("text").attr("class", "axis-label").attr("dx", "0.4em");
        });
    }

    // X axis
    g.append("g").attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(xScale).ticks(8).tickFormat(d3.timeFormat("%Y")))
      .call(gg => {
        gg.select(".domain").remove();
        gg.selectAll("line").attr("stroke", "var(--border)");
        gg.selectAll("text").attr("class", "axis-label").attr("dy", "1.2em");
      });

    // Tooltip overlay
    const container2 = document.getElementById("timeline-chart-container");
    d3.select(container2).selectAll(".tooltip-box").remove();
    const tooltip = d3.select(container2).append("div").attr("class", "tooltip-box").style("display", "none");

    svg.append("rect")
      .attr("fill", "none").attr("pointer-events", "all")
      .attr("x", margin.left).attr("y", margin.top)
      .attr("width", w).attr("height", h)
      .on("mousemove", function(event) {
        const [mx] = d3.pointer(event);
        const x0 = xScale.invert(mx - margin.left);
        // Find which band we're in
        const band = bands.find(b => new Date(b.start) <= x0 && x0 <= new Date(b.end));
        if (!band) return;
        const dateStr = x0.toLocaleDateString("en-US", { month: "short", year: "numeric" });
        tooltip.style("display", "block")
          .style("left", (mx + 16) + "px")
          .style("top", "30px")
          .html(`
            <div style="color:var(--text-dim);font-size:9px;margin-bottom:4px">${dateStr}</div>
            <div style="display:flex;align-items:center;gap:6px">
              <div style="width:8px;height:8px;border-radius:50%;background:${colors[band.regime]}"></div>
              <span style="font-size:11px">${labels[band.regime]}</span>
            </div>
            <div style="color:var(--text-dim);font-size:9px;margin-top:3px">
              ${new Date(band.start).toLocaleDateString("en-US",{month:"short",year:"numeric"})} –
              ${new Date(band.end).toLocaleDateString("en-US",{month:"short",year:"numeric"})}
            </div>
          `);
      })
      .on("mouseleave", () => tooltip.style("display", "none"));
  }

  render();
  document.getElementById("spy-overlay-toggle").addEventListener("change", render);
}
