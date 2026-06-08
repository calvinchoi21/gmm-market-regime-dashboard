/* portfolio.js — cumulative portfolio value chart */

function buildPortfolioChart(data) {
  const capital = parseFloat(document.getElementById("capital-input").value) || 100000;
  const scale = capital / 100000;

  const dates  = data.portfolio.dates.map(d => new Date(d));
  const gmmRaw = data.portfolio.gmm;
  const spyRaw = data.portfolio.spy;

  const gmm = gmmRaw.map(v => v * scale);
  const spy = spyRaw.map(v => v * scale);

  const gmmFinal = gmm[gmm.length - 1];
  const spyFinal = spy[spy.length - 1];
  const gmmRet = (gmmFinal / capital - 1) * 100;
  const spyRet = (spyFinal / capital - 1) * 100;
  const outperf = gmmFinal - spyFinal;

  // Update stats
  document.getElementById("ps-gmm-val").textContent  = fmt.currency(gmmFinal);
  document.getElementById("ps-gmm-ret").textContent  = fmt.pct(gmmRet) + " total return";
  document.getElementById("ps-spy-val").textContent  = fmt.currency(spyFinal);
  document.getElementById("ps-spy-ret").textContent  = fmt.pct(spyRet) + " total return";
  document.getElementById("ps-outperf").textContent  = fmt.currency(outperf);
  document.getElementById("ps-outperf-pct").textContent =
    fmt.pct(((gmmFinal / spyFinal) - 1) * 100) + " vs benchmark";

  // Chart
  const container = document.getElementById("portfolio-chart-container");
  const W = container.clientWidth - 40;
  const H = 320;
  const margin = { top: 20, right: 80, bottom: 36, left: 80 };
  const w = W - margin.left - margin.right;
  const h = H - margin.top - margin.bottom;

  const svg = d3.select("#portfolio-chart")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("width", W).attr("height", H);
  svg.selectAll("*").remove();

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const xScale = d3.scaleTime().domain(d3.extent(dates)).range([0, w]);
  const yScale = d3.scaleLinear()
    .domain([Math.min(...gmm, ...spy) * 0.97, Math.max(...gmm, ...spy) * 1.03])
    .range([h, 0]);

  // Grid lines
  const yTicks = yScale.ticks(6);
  g.selectAll(".grid-y")
    .data(yTicks).enter().append("line")
    .attr("class", "grid-line")
    .attr("x1", 0).attr("x2", w)
    .attr("y1", d => yScale(d)).attr("y2", d => yScale(d))
    .attr("stroke-dasharray", "2,4");

  // Axes
  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(xScale).ticks(8).tickFormat(d3.timeFormat("%Y")))
    .call(g => {
      g.select(".domain").remove();
      g.selectAll("line").attr("stroke", "var(--border)");
      g.selectAll("text").attr("class", "axis-label").attr("dy", "1.2em");
    });

  g.append("g")
    .call(d3.axisLeft(yScale).ticks(6).tickFormat(d => "$" + d3.format(",.0f")(d)))
    .call(g => {
      g.select(".domain").remove();
      g.selectAll("line").remove();
      g.selectAll("text").attr("class", "axis-label").attr("dx", "-0.4em");
    });

  // Lines
  const lineGen = d3.line().x((d, i) => xScale(dates[i])).y(d => yScale(d)).curve(d3.curveMonotoneX);

  g.append("path").datum(spy).attr("class", "chart-line")
    .attr("stroke", "var(--spy-line)").attr("stroke-width", 1.2).attr("opacity", 0.7)
    .attr("d", lineGen);

  g.append("path").datum(gmm).attr("class", "chart-line")
    .attr("stroke", "var(--amber)").attr("stroke-width", 1.8)
    .attr("d", lineGen);

  // End labels
  const lastX = xScale(dates[dates.length - 1]);
  const labelG = g.append("g").attr("class", "axis-label");

  labelG.append("text")
    .attr("x", lastX + 8).attr("y", yScale(gmmFinal) + 4)
    .attr("fill", "var(--amber)").attr("font-family", "var(--mono)").attr("font-size", 9)
    .text(fmt.currency(gmmFinal));

  labelG.append("text")
    .attr("x", lastX + 8).attr("y", yScale(spyFinal) + 4)
    .attr("fill", "var(--spy-line)").attr("font-family", "var(--mono)").attr("font-size", 9)
    .text(fmt.currency(spyFinal));

  // Legend
  const legendG = g.append("g").attr("transform", `translate(10, 6)`);
  [["GMM Strategy", "var(--amber)", 1.8], ["S&P 500", "var(--spy-line)", 1.2]].forEach(([label, color, sw], i) => {
    const lx = i * 140;
    legendG.append("line").attr("x1", lx).attr("x2", lx + 20).attr("y1", 5).attr("y2", 5)
      .attr("stroke", color).attr("stroke-width", sw);
    legendG.append("text").attr("x", lx + 26).attr("y", 9)
      .attr("fill", "var(--text-secondary)").attr("font-family", "var(--mono)").attr("font-size", 10)
      .text(label);
  });

  // Tooltip
  const tooltip = d3.select(container).select(".tooltip-box").node()
    ? d3.select(container).select(".tooltip-box")
    : d3.select(container).append("div").attr("class", "tooltip-box").style("display", "none");

  const bisect = d3.bisector(d => d).left;

  svg.append("rect")
    .attr("fill", "none").attr("pointer-events", "all")
    .attr("x", margin.left).attr("y", margin.top)
    .attr("width", w).attr("height", h)
    .on("mousemove", function(event) {
      const [mx] = d3.pointer(event);
      const x0 = xScale.invert(mx - margin.left);
      const i = bisect(dates, x0, 1);
      if (i < 0 || i >= dates.length) return;
      const d = dates[i];
      tooltip.style("display", "block")
        .style("left", (mx + 16) + "px")
        .style("top", (margin.top + 20) + "px")
        .html(`
          <div style="color:var(--text-dim);font-size:9px;margin-bottom:6px">${d.toLocaleDateString("en-US",{month:"short",year:"numeric"})}</div>
          <div style="color:var(--amber)">GMM: ${fmt.currency(gmm[i])}</div>
          <div style="color:var(--spy-line)">S&P: ${fmt.currency(spy[i])}</div>
        `);
    })
    .on("mouseleave", () => tooltip.style("display", "none"));
}
