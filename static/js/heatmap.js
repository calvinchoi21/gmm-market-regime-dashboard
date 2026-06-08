/* heatmap.js — Sharpe ratio heatmap: sectors × regimes */

function buildHeatmap(data) {
  const hmap    = data.sharpe_heatmap;   // { "0": { XLK: 1.0, ... }, ... }
  const labels  = data.regime_labels;
  const names   = data.sector_names;
  const tickers = Object.keys(names);
  const regimes = [0, 1, 2, 3, 4];

  const container = document.getElementById("heatmap-container");
  const W = container.clientWidth - 40;
  const H = 280;
  const margin = { top: 10, right: 20, bottom: 80, left: 100 };
  const w = W - margin.left - margin.right;
  const h = H - margin.top - margin.bottom;

  const svg = d3.select("#heatmap-chart")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("width", W).attr("height", H);
  svg.selectAll("*").remove();

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const xScale = d3.scaleBand().domain(regimes).range([0, w]).padding(0.05);
  const yScale = d3.scaleBand().domain(tickers).range([0, h]).padding(0.05);

  // Collect all values for colour scale
  const allVals = regimes.flatMap(r => tickers.map(t => hmap[r]?.[t] ?? 0));
  const maxAbs  = Math.max(Math.abs(d3.min(allVals)), Math.abs(d3.max(allVals)));

  const colourScale = d3.scaleLinear()
    .domain([-maxAbs, 0, maxAbs])
    .range(["#7f1d1d", "#1a1a24", "#14532d"]);

  // Cells
  regimes.forEach(r => {
    tickers.forEach(t => {
      const val = hmap[r]?.[t] ?? 0;
      const cx = xScale(r);
      const cy = yScale(t);
      const cw = xScale.bandwidth();
      const ch = yScale.bandwidth();

      g.append("rect")
        .attr("x", cx).attr("y", cy)
        .attr("width", cw).attr("height", ch)
        .attr("fill", colourScale(val))
        .attr("rx", 2);

      g.append("text")
        .attr("class", "hm-cell-text")
        .attr("x", cx + cw / 2).attr("y", cy + ch / 2)
        .attr("fill", Math.abs(val) > maxAbs * 0.4 ? "#e8e8f0" : "#8888a8")
        .text(d3.format(".2f")(val));
    });
  });

  // X axis — regime labels, rotated
  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(xScale).tickFormat(r => labels[r] || r))
    .call(gg => {
      gg.select(".domain").remove();
      gg.selectAll("line").remove();
      gg.selectAll("text")
        .attr("class", "axis-label")
        .attr("transform", "rotate(-30)")
        .attr("text-anchor", "end")
        .attr("dy", "0.35em")
        .attr("dx", "-0.3em");
    });

  // Y axis — ticker names
  g.append("g")
    .call(d3.axisLeft(yScale).tickFormat(t => names[t] || t))
    .call(gg => {
      gg.select(".domain").remove();
      gg.selectAll("line").remove();
      gg.selectAll("text").attr("class", "axis-label").attr("dx", "-0.4em");
    });

  // Tooltip
  d3.select(container).selectAll(".tooltip-box").remove();
  const tooltip = d3.select(container).append("div").attr("class", "tooltip-box").style("display", "none");

  g.selectAll("rect").on("mouseover", function(event, d) {
    // find which rect this is via position
    const rx = +d3.select(this).attr("x");
    const ry = +d3.select(this).attr("y");
    // reverse-lookup regime and ticker
    const regime = regimes.find(r => Math.abs(xScale(r) - rx) < 2);
    const ticker = tickers.find(t => Math.abs(yScale(t) - ry) < 2);
    if (regime === undefined || !ticker) return;
    const val = hmap[regime]?.[ticker] ?? 0;
    tooltip.style("display", "block")
      .style("left", (event.offsetX + 12) + "px")
      .style("top",  (event.offsetY - 10) + "px")
      .html(`
        <div style="color:var(--text-dim);font-size:9px">${labels[regime]}</div>
        <div style="font-size:12px;margin:3px 0">${names[ticker]} (${ticker})</div>
        <div style="color:${val >= 0 ? "var(--green)" : "var(--red)"}">Sharpe: ${d3.format(".3f")(val)}</div>
      `);
  }).on("mouseleave", () => tooltip.style("display", "none"));
}
