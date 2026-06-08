/* main.js — data fetch, hero, macro snapshot, regime cards */

let GLOBAL_DATA = null;

const fmt = {
  currency: v => "$" + d3.format(",.0f")(v),
  pct:      v => (v >= 0 ? "+" : "") + d3.format(".1f")(v) + "%",
  num2:     v => d3.format(".2f")(v),
  num3:     v => d3.format(".3f")(v),
  num4:     v => d3.format(".4f")(v),
};

async function fetchData() {
  try {
    const res = await fetch("/api/data");
    if (res.status === 202) {
      // Still loading
      document.getElementById("loading-msg").textContent =
        "Pipeline is running for the first time… this takes ~60 seconds.";
      setTimeout(fetchData, 6000);
      return;
    }
    const data = await res.json();
    GLOBAL_DATA = data;
    initDashboard(data);
  } catch (e) {
    console.error("Fetch error:", e);
    document.getElementById("loading-msg").textContent = "Error loading data. Retrying…";
    setTimeout(fetchData, 5000);
  }
}

function initDashboard(data) {
  // Hide loading, show content
  document.getElementById("loading-overlay").classList.add("hidden");
  document.getElementById("main-content").classList.remove("hidden");

  // Status bar
  const through = new Date(data.data_through);
  document.getElementById("data-through-pill").textContent =
    "DATA THROUGH " + through.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
  const gen = new Date(data.generated_at);
  document.getElementById("refresh-pill").textContent =
    "REFRESHED " + gen.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  document.getElementById("status-dot").classList.add("live");

  // Hero
  const regimeColor = data.current_regime_color;
  document.getElementById("hero-regime-name").textContent = data.current_regime_label;
  document.getElementById("hero-regime-name").style.color = regimeColor;
  document.getElementById("hero-confidence").textContent = data.current_confidence + "%";

  // Macro snapshot
  const snap = data.macro_snapshot;
  document.getElementById("snap-vix").textContent   = fmt.num2(snap.vix);
  document.getElementById("snap-rsi").textContent   = fmt.num2(snap.rsi);
  document.getElementById("snap-yc2y").textContent  = (snap.yc_10y2y >= 0 ? "+" : "") + fmt.num3(snap.yc_10y2y);
  document.getElementById("snap-yc3m").textContent  = (snap.yc_10y3m >= 0 ? "+" : "") + fmt.num3(snap.yc_10y3m);
  document.getElementById("snap-sma").textContent   = fmt.num4(snap.sma_ratio);

  // Colour VIX and yield curve
  colourValue("snap-vix",  snap.vix,       v => v < 20 ? "green" : v < 30 ? "amber" : "red");
  colourValue("snap-rsi",  snap.rsi,       v => v > 50 ? "green" : "amber");
  colourValue("snap-yc2y", snap.yc_10y2y,  v => v >= 0 ? "green" : "red");
  colourValue("snap-yc3m", snap.yc_10y3m,  v => v >= 0 ? "green" : "red");

  // Hero banner background tint
  const hero = document.getElementById("regime-hero");
  hero.style.borderBottom = `2px solid ${regimeColor}`;

  // Regime cards
  buildRegimeCards(data);

  // Charts
  buildPortfolioChart(data);
  buildTimelineChart(data);
  buildHeatmap(data);
  buildAllocationDonut(data);
}

function colourValue(id, val, fn) {
  const el = document.getElementById(id);
  const cls = fn(val);
  const map = { green: "var(--green)", amber: "var(--amber)", red: "var(--red)" };
  el.style.color = map[cls] || "var(--text-primary)";
}

function buildRegimeCards(data) {
  const container = document.getElementById("regime-cards");
  container.innerHTML = "";
  const labels = data.regime_labels;
  const colors = data.regime_colors;
  const stats  = data.regime_stats;
  const current = data.current_regime;

  for (let i = 0; i < 5; i++) {
    const s = stats[i];
    const isActive = i === current;
    const card = document.createElement("div");
    card.className = "regime-card" + (isActive ? " active" : "");

    const dot = `<div class="rc-dot" style="background:${colors[i]}${isActive ? ';box-shadow:0 0 6px ' + colors[i] : ''}"></div>`;
    const meta = `VIX ${fmt.num2(s.median_vix)} · RSI ${fmt.num2(s.median_rsi)} · YC ${(s.median_yc_10y2y >= 0 ? "+" : "") + fmt.num3(s.median_yc_10y2y)}`;

    card.innerHTML = `
      ${dot}
      <div class="rc-body">
        <div class="rc-label${isActive ? " active" : ""}">${labels[i]}${isActive ? " ◀ NOW" : ""}</div>
        <div class="rc-meta">${meta}</div>
      </div>
      <div class="rc-right">
        <div class="rc-pct">${s.pct}%</div>
        <div class="rc-pct-label">OF DAYS</div>
      </div>
    `;
    container.appendChild(card);
  }
}

// Capital input handler
document.addEventListener("DOMContentLoaded", () => {
  fetchData();
  document.getElementById("capital-input").addEventListener("change", () => {
    if (GLOBAL_DATA) buildPortfolioChart(GLOBAL_DATA);
  });
});
