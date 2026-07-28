// Shared helpers used by app.js (Dashboard), funil.js (Funil CV CRM) and
// canais.js (Canais & Criativos).
window.Common = (function () {
  "use strict";

  const fmtCurrency = (v) =>
    (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const fmtCurrency2 = (v) =>
    (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
  const fmtNumber = (v) => (v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  const fmtPercent = (v) => `${(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

  function today0() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function addDays(date, delta) {
    const d = new Date(date);
    d.setDate(d.getDate() + delta);
    return d;
  }

  function toDateOnly(dateStr) {
    return new Date(dateStr.slice(0, 10) + "T00:00:00");
  }

  function dayCount(from, to) {
    return Math.round((to - from) / 86400000) + 1;
  }

  function getRange(state) {
    const to = today0();
    switch (state.rangeMode) {
      case "7":
        return { from: addDays(to, -6), to };
      case "30":
        return { from: addDays(to, -29), to };
      case "90":
        return { from: addDays(to, -89), to };
      case "month":
        return { from: new Date(to.getFullYear(), to.getMonth(), 1), to };
      case "custom":
        return {
          from: state.customFrom || addDays(to, -29),
          to: state.customTo || to,
        };
      default:
        return { from: addDays(to, -29), to };
    }
  }

  function inRange(dateStr, from, to) {
    const d = toDateOnly(dateStr);
    return d >= from && d <= to;
  }

  function previousRange(state) {
    const { from, to } = getRange(state);
    const duration = dayCount(from, to);
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(duration - 1));
    return { from: prevFrom, to: prevTo };
  }

  function hasFullPreviousWindow(state, oldestDate) {
    if (!oldestDate) return false;
    const { from: prevFrom } = previousRange(state);
    return toDateOnly(oldestDate) <= prevFrom;
  }

  function trendBadge(current, previous) {
    if (previous == null || previous === 0 || current == null) return "";
    const delta = ((current - previous) / previous) * 100;
    const dir = delta >= 0 ? "up" : "down";
    const arrow = delta >= 0 ? "↑" : "↓";
    return `<div class="trend ${dir}">${arrow} ${Math.abs(delta).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% vs período anterior</div>`;
  }

  function renderBarChart(containerId, series, color, formatter) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    if (series.length === 0) {
      container.innerHTML = '<p class="muted">Sem dados no período.</p>';
      return;
    }

    const width = 520,
      height = 220;
    const padL = 8,
      padR = 8,
      padT = 12,
      padB = 24;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const maxV = Math.max(1, ...series.map((d) => d.value));
    const n = series.length;
    const gap = 2;
    const barW = Math.max(1.5, plotW / n - gap);
    const x = (i) => padL + i * (plotW / n);
    const barH = (v) => (v / maxV) * plotH;

    const gridLines = [0, 0.5, 1]
      .map((frac) => {
        const gy = padT + plotH * frac;
        return `<line class="chart-grid" x1="${padL}" y1="${gy}" x2="${width - padR}" y2="${gy}" />`;
      })
      .join("");

    const bars = series
      .map((d, i) => {
        const h = Math.max(1, barH(d.value));
        const bx = x(i);
        const by = padT + plotH - h;
        return `<rect class="chart-bar" data-i="${i}" x="${bx}" y="${by}" width="${barW}" height="${h}" rx="3" fill="${color}" />`;
      })
      .join("");

    const step = Math.max(1, Math.ceil(n / 6));
    const labels = series
      .map((d, i) => (i % step === 0 || i === n - 1 ? { i, date: d.date } : null))
      .filter(Boolean)
      .map(({ i, date }) => {
        const short = date.slice(5).replace("-", "/");
        return `<text class="chart-axis-label" x="${x(i) + barW / 2}" y="${height - 6}" text-anchor="middle">${short}</text>`;
      })
      .join("");

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Série diária">
        ${gridLines}
        <line class="chart-baseline" x1="${padL}" y1="${padT + plotH}" x2="${width - padR}" y2="${padT + plotH}" />
        <g id="${containerId}-bars">${bars}</g>
        ${labels}
      </svg>
      <div class="chart-tooltip" id="${containerId}-tooltip"></div>
    `;

    const svg = container.querySelector("svg");
    const tooltip = document.getElementById(`${containerId}-tooltip`);
    const barEls = Array.from(document.querySelectorAll(`#${containerId}-bars .chart-bar`));

    function showAt(idx, clientX, clientY) {
      const d = series[idx];
      tooltip.innerHTML = `<div class="t-date">${d.date}</div><div class="t-value">${formatter(d.value)}</div>`;
      const rect = container.getBoundingClientRect();
      tooltip.style.left = `${clientX - rect.left}px`;
      tooltip.style.top = `${clientY - rect.top - 12}px`;
      tooltip.classList.add("visible");
    }
    function hide() {
      tooltip.classList.remove("visible");
    }

    barEls.forEach((bar, i) => {
      bar.addEventListener("mousemove", (evt) => showAt(i, evt.clientX, evt.clientY));
      bar.addEventListener("mouseleave", hide);
      bar.addEventListener(
        "touchstart",
        (evt) => {
          const t = evt.touches[0];
          showAt(i, t.clientX, t.clientY);
        },
        { passive: true }
      );
    });
    svg.addEventListener("mouseleave", hide);
  }

  function setGreeting() {
    const el = document.getElementById("greeting-text");
    if (!el) return;
    const hour = new Date().getHours();
    el.textContent = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  }

  function setupSidebarNav() {
    const buttons = Array.from(document.querySelectorAll(".sidebar-nav button[data-scroll]"));
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const target = document.querySelector(btn.dataset.scroll);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  // Wires a #range-filter pill group + #custom-range date inputs to a
  // { rangeMode, customFrom, customTo } state object, calling onChange()
  // whenever the selected range changes. Pass `ids` to target a second
  // (or third) independent filter widget on the same page — defaults match
  // the original single-filter markup.
  function setupRangeFilter(state, oldestDate, onChange, ids) {
    const {
      rangeFilter = "#range-filter",
      customRange = "#custom-range",
      dateFrom = "#date-from",
      dateTo = "#date-to",
      applyBtn = "#apply-custom-range",
    } = ids || {};

    const customRangeBox = document.querySelector(customRange);
    const dateFromInput = document.querySelector(dateFrom);
    const dateToInput = document.querySelector(dateTo);

    if (oldestDate) dateFromInput.min = dateToInput.min = oldestDate;
    const todayStr = today0().toISOString().slice(0, 10);
    dateFromInput.max = dateToInput.max = todayStr;

    document.querySelectorAll(`${rangeFilter} button`).forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(`${rangeFilter} button`).forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.rangeMode = btn.dataset.range;

        if (state.rangeMode === "custom") {
          customRangeBox.hidden = false;
          if (!dateFromInput.value) {
            const { from, to } = getRange(state);
            dateFromInput.value = from.toISOString().slice(0, 10);
            dateToInput.value = to.toISOString().slice(0, 10);
          }
        } else {
          customRangeBox.hidden = true;
        }
        onChange();
      });
    });

    document.querySelector(applyBtn).addEventListener("click", () => {
      if (!dateFromInput.value || !dateToInput.value) return;
      const from = toDateOnly(dateFromInput.value);
      const to = toDateOnly(dateToInput.value);
      if (from > to) return;
      state.customFrom = from;
      state.customTo = to;
      onChange();
    });
  }

  return {
    fmtCurrency,
    fmtCurrency2,
    fmtNumber,
    fmtPercent,
    today0,
    addDays,
    toDateOnly,
    dayCount,
    getRange,
    inRange,
    previousRange,
    hasFullPreviousWindow,
    trendBadge,
    renderBarChart,
    setGreeting,
    setupSidebarNav,
    setupRangeFilter,
  };
})();
