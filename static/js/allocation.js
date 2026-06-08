/* allocation.js — donut chart for current regime sector allocation */

// Sector colour palette (independent of regime colours)
const SECTOR_COLORS = [
  "#f5a623", "#6b7aff", "#22c55e", "#ef4444", "#a855f7",
  "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#14b8a6"
];

function buildAllocationDonut(data) {
  const alloc  = data.current_allocation;   // { XLK: 0.10, ... }
  const names  = data.sector_names;
  const regime = data.current_regime_label;

  document.getElementById("alloc-regime-label").textContent = regime;

  // Filter out zero weights
  const entries = Object.entries(alloc)
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1]);

  const W = 200, H = 200, R = 85, innerR = 50;
  const svg = d3.select("#alloc-donut")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("width", W).attr("height", H);
  svg.selectAll("*").remove();

  const g = svg.append("g").attr("transform", `translate(${W / 2},${H / 2})`);

  const pie = d3.pie().value(([, w]) => w).sort(null);
  const arc = d3.arc().innerRadius(innerR).outerRadius(R);
  const arcHover = d3.arc().innerRadius(innerR).outerRadius(R + 6);

  const arcs = g.selectAll("path")
    .data(pie(entries))
    .enter().append("path")
    .attr("fill", (d, i) => SECTOR_COLORS[i % SECTOR_COLORS.length])
    .attr("stroke", "var(--bg-panel)")
    .attr("stroke-width", 2)
    .attr("d", arc)
    .style("cursor", "pointer")
    .on("mouseover", function(event, d) {
      d3.select(this).transition().duration(120).attr("d", arcHover);
      // Update centre text
      g.select(".donut-pct").text(Math.round(d.data[1] * 100) + "%");
      g.select(".donut-label").text(d.data[0]);
    })
    .on("mouseleave", function() {
      d3.select(this).transition().duration(120).attr("d", arc);
      g.select(".donut-pct").text("");
      g.select(".donut-label").text("");
    });

  // Centre text
  g.append("text").attr("class", "donut-pct")
    .attr("text-anchor", "middle").attr("dy", "0.1em")
    .attr("font-family", "var(--mono)").attr("font-size", 20)
    .attr("font-weight", 600).attr("fill", "var(--text-primary)");
  g.append("text").attr("class", "donut-label")
    .attr("text-anchor", "middle").attr("dy", "1.4em")
    .attr("font-family", "var(--mono)").attr("font-size", 9)
    .attr("fill", "var(--text-secondary)");

  // Legend
  const legend = document.getElementById("alloc-legend");
  legend.innerHTML = "";
  entries.forEach(([ticker, weight], i) => {
    const item = document.createElement("div");
    item.className = "alloc-item";
    item.innerHTML = `
      <div class="alloc-swatch" style="background:${SECTOR_COLORS[i % SECTOR_COLORS.length]}"></div>
      <span class="alloc-name">${names[ticker] || ticker}</span>
      <span class="alloc-weight">${Math.round(weight * 100)}%</span>
    `;
    legend.appendChild(item);
  });
}
