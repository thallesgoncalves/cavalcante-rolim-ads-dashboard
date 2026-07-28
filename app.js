(function () {
  "use strict";

  const { fmtCurrency, fmtCurrency2, fmtNumber, fmtPercent, toDateOnly, getRange, inRange, previousRange, hasFullPreviousWindow, trendBadge, renderBarChart, setGreeting, setupSidebarNav, setupRangeFilter } =
    window.Common;

  // Estimated commission rate used for the ROI card below — CV CRM's
  // valor_negocio isn't always filled in for closed deals (only 3 of the 10
  // "Venda Realizada" leads had a value at the time this was built), so the
  // sold total, and therefore the ROI, is a floor, not the real number.
  // Adjust ROI_COMMISSION_RATE once the client confirms their actual rate.
  const ROI_COMMISSION_RATE = 0.05;

  let allRows = [];
  let oldestDate = null;
  let cvcrmLeads = [];
  let cvcrmOldestDate = null;
  let cvcrmLoadFailed = false;
  let state = {
    rangeMode: "30",
    customFrom: null,
    customTo: null,
    account: "all",
    search: "",
    sortKey: "spend",
    sortDir: "desc",
  };
  // Independent date range for the CRM funnel + ROI cards, decoupled from
  // the ads filter above — lets you compare a different lead/deal window.
  let crmState = { rangeMode: "30", customFrom: null, customTo: null };

  const FUNNEL_COLORS = ["var(--funnel-1)", "var(--funnel-2)", "var(--funnel-3)", "var(--funnel-4)"];

  function isWon(lead) {
    return (lead.situacao || "").toLowerCase().includes("venda realizada");
  }
  function isLost(lead) {
    const s = (lead.situacao || "").toLowerCase();
    return s.includes("descartado") || s.includes("perdido");
  }

  async function loadData() {
    const res = await fetch("data/campaigns.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load data/campaigns.json (${res.status})`);
    return res.json();
  }

  async function loadCvcrmData() {
    const res = await fetch("data/cvcrm.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load data/cvcrm.json (${res.status})`);
    return res.json();
  }

  function rowsForRange(from, to) {
    return allRows.filter((r) => {
      if (!inRange(r.date, from, to)) return false;
      if (state.account !== "all" && r.account !== state.account) return false;
      return true;
    });
  }

  function filteredRows() {
    const { from, to } = getRange(state);
    return rowsForRange(from, to);
  }

  function summarize(rows) {
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    const impressions = rows.reduce((s, r) => s + r.impressions, 0);
    const clicks = rows.reduce((s, r) => s + r.clicks, 0);
    const leads = rows.reduce((s, r) => s + r.leads, 0);
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpl = leads > 0 ? spend / leads : null;
    return { spend, impressions, clicks, leads, ctr, cpl };
  }

  function renderKPIs(rows) {
    const cur = summarize(rows);
    let prev = null;
    if (hasFullPreviousWindow(state, oldestDate)) {
      const { from, to } = previousRange(state);
      prev = summarize(rowsForRange(from, to));
    }

    document.getElementById("kpi-hero").innerHTML = `
      <div>
        <div class="label">Investimento total</div>
        <div class="value">${fmtCurrency(cur.spend)}</div>
      </div>
      ${prev ? trendBadge(cur.spend, prev.spend) : ""}
    `;

    const secondary = [
      { label: "Leads", value: fmtNumber(cur.leads), trend: prev ? trendBadge(cur.leads, prev.leads) : "" },
      { label: "Custo por lead", value: cur.cpl == null ? "—" : fmtCurrency2(cur.cpl), trend: prev ? trendBadge(cur.cpl, prev.cpl) : "" },
      { label: "Cliques", value: fmtNumber(cur.clicks), trend: prev ? trendBadge(cur.clicks, prev.clicks) : "" },
      { label: "CTR", value: fmtPercent(cur.ctr), trend: prev ? trendBadge(cur.ctr, prev.ctr) : "" },
      { label: "Impressões", value: fmtNumber(cur.impressions), trend: prev ? trendBadge(cur.impressions, prev.impressions) : "" },
    ];

    document.getElementById("kpi-secondary").innerHTML = secondary
      .map(
        (t) => `<div class="stat-tile">
          <div class="label">${t.label}</div>
          <div class="value">${t.value}</div>
          ${t.trend}
        </div>`
      )
      .join("");
  }

  function dailySeries(rows, key) {
    const byDate = new Map();
    for (const r of rows) {
      byDate.set(r.date, (byDate.get(r.date) || 0) + r[key]);
    }
    return Array.from(byDate.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, value]) => ({ date, value }));
  }

  function campaignAggregates(rows) {
    const key = (r) => `${r.account}${r.campaign}`;
    const map = new Map();
    for (const r of rows) {
      const k = key(r);
      if (!map.has(k)) {
        map.set(k, { account: r.account, campaign: r.campaign, spend: 0, impressions: 0, clicks: 0, leads: 0 });
      }
      const agg = map.get(k);
      agg.spend += r.spend;
      agg.impressions += r.impressions;
      agg.clicks += r.clicks;
      agg.leads += r.leads;
    }
    return Array.from(map.values()).map((agg) => ({
      ...agg,
      ctr: agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0,
      cost_per_lead: agg.leads > 0 ? agg.spend / agg.leads : null,
    }));
  }

  function sortRows(rows) {
    const { sortKey, sortDir } = state;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (av == null) av = -Infinity;
      if (bv == null) bv = -Infinity;
      if (typeof av === "string") return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }

  function renderTable(rows) {
    let aggregates = campaignAggregates(rows);
    if (state.search.trim()) {
      const q = state.search.trim().toLowerCase();
      aggregates = aggregates.filter((c) => c.campaign.toLowerCase().includes(q) || c.account.toLowerCase().includes(q));
    }
    const sorted = sortRows(aggregates);
    document.getElementById("table-count").textContent = `${sorted.length} campanhas`;
    const tbody = document.getElementById("campaign-tbody");
    tbody.innerHTML = sorted
      .map(
        (c) => `
      <tr>
        <td><span class="account-badge">${c.account}</span></td>
        <td>${c.campaign}</td>
        <td class="num">${fmtCurrency(c.spend)}</td>
        <td class="num">${fmtNumber(c.impressions)}</td>
        <td class="num">${fmtNumber(c.clicks)}</td>
        <td class="num">${fmtPercent(c.ctr)}</td>
        <td class="num">${fmtNumber(c.leads)}</td>
        <td class="num">${c.cost_per_lead == null ? "—" : fmtCurrency2(c.cost_per_lead)}</td>
      </tr>`
      )
      .join("");

    document.querySelectorAll("#campaign-table thead th").forEach((th) => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.sort === state.sortKey) {
        th.classList.add(state.sortDir === "asc" ? "sorted-asc" : "sorted-desc");
      }
    });
  }

  function filteredCvcrmLeads() {
    const { from, to } = getRange(crmState);
    return cvcrmLeads.filter((l) => l.data_cad && inRange(l.data_cad, from, to));
  }

  function renderFunnel() {
    if (cvcrmLoadFailed) return;
    const leads = filteredCvcrmLeads();
    const total = leads.length;
    const won = leads.filter(isWon).length;
    const lost = leads.filter(isLost).length;
    const open = total - won - lost;
    const conversion = total > 0 ? (won / total) * 100 : 0;

    document.getElementById("funnel-kpis").innerHTML = [
      { label: "Leads no CRM", value: fmtNumber(total) },
      { label: "Em andamento", value: fmtNumber(open) },
      { label: "Vendas realizadas", value: fmtNumber(won) },
      { label: "Taxa de conversão", value: fmtPercent(conversion) },
    ]
      .map((t) => `<div class="stat-tile"><div class="label">${t.label}</div><div class="value">${t.value}</div></div>`)
      .join("");

    // Situação is a client-configurable stage name in CV CRM, so rather than
    // hardcoding a fixed taxonomy, bucket by whatever distinct values show up
    // — the two outcomes we DO know how to spot (won/lost) get fixed colors.
    const counts = new Map();
    for (const l of leads) {
      const name = l.situacao || "Outros";
      counts.set(name, (counts.get(name) || 0) + 1);
    }

    const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    let colorIdx = 0;
    const segments = entries.map(([name, count]) => {
      let color;
      if (name.toLowerCase().includes("venda realizada")) color = "var(--status-good)";
      else if (name.toLowerCase().includes("descartado") || name.toLowerCase().includes("perdido")) color = "var(--status-critical)";
      else {
        color = FUNNEL_COLORS[colorIdx % FUNNEL_COLORS.length];
        colorIdx += 1;
      }
      return { label: name, count, color };
    });

    const visible = segments.filter((s) => s.count > 0);
    const barTotal = Math.max(1, visible.reduce((s, r) => s + r.count, 0));

    document.getElementById("funnel-seg-bar").innerHTML = visible
      .map((s) => `<div class="funnel-seg" style="flex-grow:${s.count}; background:${s.color}" title="${s.label}: ${s.count}"></div>`)
      .join("");

    document.getElementById("funnel-legend").innerHTML = visible
      .map((s) => {
        const pct = (s.count / barTotal) * 100;
        return `<div class="funnel-legend-item">
          <span class="funnel-swatch" style="background:${s.color}"></span>
          <div class="funnel-legend-text">
            <div class="funnel-legend-label">${s.label}</div>
            <div class="funnel-legend-value">${fmtNumber(s.count)}</div>
            <div class="funnel-legend-pct">${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do total</div>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderROI() {
    if (cvcrmLoadFailed) return;
    const { from, to } = getRange(crmState);
    const spend = rowsForRange(from, to).reduce((s, r) => s + r.spend, 0);
    const wonLeads = filteredCvcrmLeads().filter(isWon);
    const withValue = wonLeads.filter((l) => l.valor_negocio != null && l.valor_negocio > 0);
    const totalSold = withValue.reduce((s, l) => s + l.valor_negocio, 0);
    const commission = totalSold * ROI_COMMISSION_RATE;
    const roi = spend > 0 && withValue.length > 0 ? ((commission - spend) / spend) * 100 : null;
    const roiText = roi == null ? "—" : `${roi >= 0 ? "+" : ""}${roi.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;

    const caveatEl = document.getElementById("roi-caveat");
    if (caveatEl) {
      caveatEl.textContent =
        wonLeads.length > withValue.length
          ? `${wonLeads.length - withValue.length} de ${wonLeads.length} venda(s) no período sem valor de negócio registrado no CV CRM — não entram na soma abaixo.`
          : "";
    }

    const tiles = [
      { label: "Investimento em anúncios", value: fmtCurrency(spend) },
      {
        label: "Valor total vendido",
        value: fmtCurrency(totalSold),
        sub: `${fmtNumber(withValue.length)} de ${fmtNumber(wonLeads.length)} venda(s) com valor registrado`,
      },
      { label: `Comissão estimada (${(ROI_COMMISSION_RATE * 100).toLocaleString("pt-BR")}%)`, value: fmtCurrency(commission) },
      { label: "ROI", value: roiText, highlight: true },
    ];

    document.getElementById("roi-grid").innerHTML = tiles
      .map(
        (t) => `<div class="roi-tile ${t.highlight ? "roi-highlight" : ""}">
          <div class="label">${t.label}</div>
          <div class="value">${t.value}</div>
          ${t.sub ? `<div class="roi-sub">${t.sub}</div>` : ""}
        </div>`
      )
      .join("");
  }

  function renderAdsSection() {
    const rows = filteredRows();
    renderKPIs(rows);
    renderBarChart("chart-spend", dailySeries(rows, "spend"), "var(--series-spend)", fmtCurrency);
    renderBarChart("chart-leads", dailySeries(rows, "leads"), "var(--series-leads)", fmtNumber);
    renderTable(rows);
  }

  function renderCrmSection() {
    renderFunnel();
    renderROI();
  }

  function renderAll() {
    renderAdsSection();
    renderCrmSection();
  }

  function setupFilters(accounts) {
    setupRangeFilter(state, oldestDate, renderAdsSection);
    setupRangeFilter(crmState, cvcrmOldestDate, renderCrmSection, {
      rangeFilter: "#crm-range-filter",
      customRange: "#crm-custom-range",
      dateFrom: "#crm-date-from",
      dateTo: "#crm-date-to",
      applyBtn: "#crm-apply-custom-range",
    });

    const select = document.getElementById("account-filter");
    for (const acc of accounts) {
      const opt = document.createElement("option");
      opt.value = acc;
      opt.textContent = acc;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => {
      state.account = select.value;
      renderAll();
    });

    const search = document.getElementById("campaign-search");
    search.addEventListener("input", () => {
      state.search = search.value;
      renderTable(filteredRows());
    });

    document.querySelectorAll("#campaign-table thead th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
          state.sortKey = key;
          state.sortDir = "desc";
        }
        renderTable(filteredRows());
      });
    });
  }

  async function init() {
    setGreeting();
    setupSidebarNav();
    try {
      const payload = await loadData();
      allRows = payload.rows || [];
      oldestDate = allRows.reduce((min, r) => (!min || r.date < min ? r.date : min), null);
      const accounts = Array.from(new Set(allRows.map((r) => r.account))).sort();

      const updatedAt = payload.generated_at ? new Date(payload.generated_at) : null;
      document.getElementById("updated-at").textContent = updatedAt
        ? `Atualizado em ${updatedAt.toLocaleString("pt-BR")}`
        : "";

      try {
        const cvcrmPayload = await loadCvcrmData();
        cvcrmLeads = cvcrmPayload.leads || [];
        cvcrmOldestDate = cvcrmLeads.reduce(
          (min, l) => (l.data_cad && (!min || l.data_cad < min) ? l.data_cad.slice(0, 10) : min),
          null
        );
        const cvcrmUpdatedAt = cvcrmPayload.generated_at ? new Date(cvcrmPayload.generated_at) : null;
        document.getElementById("funnel-updated").textContent = cvcrmUpdatedAt
          ? `Atualizado em ${cvcrmUpdatedAt.toLocaleString("pt-BR")}`
          : "";
      } catch (cvcrmErr) {
        cvcrmLeads = [];
        cvcrmLoadFailed = true;
        const msg = `<p class="muted">Não foi possível carregar os dados do CRM: ${cvcrmErr.message}</p>`;
        document.getElementById("funnel-kpis").innerHTML = "";
        document.getElementById("funnel-seg-bar").innerHTML = "";
        document.getElementById("funnel-legend").innerHTML = msg;
        document.getElementById("roi-grid").innerHTML = msg;
        console.error(cvcrmErr);
      }

      setupFilters(accounts);
      renderAll();
    } catch (err) {
      document.getElementById("kpi-hero").innerHTML = "";
      document.getElementById("kpi-secondary").innerHTML =
        `<p class="muted">Não foi possível carregar os dados: ${err.message}</p>`;
      console.error(err);
    }
  }

  init();
})();
