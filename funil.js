(function () {
  "use strict";

  const { fmtCurrency, fmtNumber, fmtPercent, getRange, inRange, setGreeting, setupSidebarNav, setupRangeFilter } =
    window.Common;

  const FUNNEL_COLORS = ["var(--funnel-1)", "var(--funnel-2)", "var(--funnel-3)", "var(--funnel-4)"];

  let allLeads = [];
  let oldestDate = null;
  let loadFailed = false;
  let state = { rangeMode: "30", customFrom: null, customTo: null };
  let sellerSort = { key: "total", dir: "desc" };
  let productSort = { key: "total", dir: "desc" };

  function isWon(lead) {
    return (lead.situacao || "").toLowerCase().includes("venda realizada");
  }
  function isLost(lead) {
    const s = (lead.situacao || "").toLowerCase();
    return s.includes("descartado") || s.includes("perdido");
  }

  async function loadCvcrmData() {
    const res = await fetch("data/cvcrm.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load data/cvcrm.json (${res.status})`);
    return res.json();
  }

  function filteredLeads() {
    const { from, to } = getRange(state);
    return allLeads.filter((l) => l.data_cad && inRange(l.data_cad, from, to));
  }

  function renderKPIs(leads) {
    const total = leads.length;
    const won = leads.filter(isWon);
    const withReservation = leads.filter((l) => (l.qtde_reservas_associadas || 0) > 0).length;
    const conversion = total > 0 ? (won.length / total) * 100 : 0;

    document.getElementById("kpi-hero").innerHTML = `
      <div>
        <div class="label">Leads no funil</div>
        <div class="value">${fmtNumber(total)}</div>
      </div>
    `;

    const secondary = [
      { label: "Com reserva associada", value: fmtNumber(withReservation) },
      { label: "Vendas realizadas", value: fmtNumber(won.length) },
      { label: "Taxa de conversão", value: fmtPercent(conversion) },
    ];
    document.getElementById("kpi-secondary").innerHTML = secondary
      .map((t) => `<div class="stat-tile"><div class="label">${t.label}</div><div class="value">${t.value}</div></div>`)
      .join("");
  }

  function renderStageFunnel(leads) {
    const counts = new Map();
    for (const l of leads) {
      const name = l.situacao || "Outros";
      counts.set(name, (counts.get(name) || 0) + 1);
    }

    const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    let colorIdx = 0;
    const segments = entries.map(([name, count]) => {
      let color;
      const lower = name.toLowerCase();
      if (lower.includes("venda realizada")) color = "var(--status-good)";
      else if (lower.includes("descartado") || lower.includes("perdido")) color = "var(--status-critical)";
      else {
        color = FUNNEL_COLORS[colorIdx % FUNNEL_COLORS.length];
        colorIdx += 1;
      }
      return { label: name, count, color };
    });

    const visible = segments.filter((s) => s.count > 0);
    const barTotal = Math.max(1, visible.reduce((s, r) => s + r.count, 0));

    document.getElementById("stage-seg-bar").innerHTML = visible
      .map((s) => `<div class="funnel-seg" style="flex-grow:${s.count}; background:${s.color}" title="${s.label}: ${s.count}"></div>`)
      .join("");

    document.getElementById("stage-legend").innerHTML = visible
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

  function groupBy(leads, keyFn) {
    const map = new Map();
    for (const l of leads) {
      const key = keyFn(l) || "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(l);
    }
    return map;
  }

  // Like groupBy, but a lead contributes to every key in its list value
  // (a lead can be tagged to more than one empreendimento).
  function groupByList(leads, listFn) {
    const map = new Map();
    for (const l of leads) {
      const keys = listFn(l);
      const list = keys && keys.length > 0 ? keys : ["—"];
      for (const key of list) {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(l);
      }
    }
    return map;
  }

  function sortRows(rows, sort) {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      let av = a[sort.key], bv = b[sort.key];
      if (av == null) av = -Infinity;
      if (bv == null) bv = -Infinity;
      if (typeof av === "string") return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }

  function renderSellerTable(leads) {
    const grouped = groupBy(leads, (l) => l.corretor);
    const rows = Array.from(grouped.entries()).map(([seller, group]) => {
      const won = group.filter(isWon).length;
      const open = group.filter((l) => !isWon(l) && !isLost(l)).length;
      return { seller, total: group.length, open, won, conversion: group.length > 0 ? (won / group.length) * 100 : 0 };
    });
    document.getElementById("seller-count").textContent = `${fmtNumber(rows.length)} corretor(es)`;
    document.getElementById("seller-tbody").innerHTML = sortRows(rows, sellerSort)
      .map(
        (r) => `<tr>
          <td>${r.seller}</td>
          <td class="num">${fmtNumber(r.total)}</td>
          <td class="num">${fmtNumber(r.open)}</td>
          <td class="num">${fmtNumber(r.won)}</td>
          <td class="num">${fmtPercent(r.conversion)}</td>
        </tr>`
      )
      .join("");
    document.querySelectorAll("#seller-table thead th").forEach((th) => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.sort === sellerSort.key) th.classList.add(sellerSort.dir === "asc" ? "sorted-asc" : "sorted-desc");
    });
  }

  function renderProductTable(leads) {
    const grouped = groupByList(leads, (l) => l.empreendimentos);
    const rows = Array.from(grouped.entries()).map(([product, group]) => {
      const wonLeads = group.filter(isWon);
      const sold = wonLeads.reduce((s, l) => s + (l.valor_negocio || 0), 0);
      return { product, total: group.length, won: wonLeads.length, sold };
    });
    document.getElementById("product-count").textContent = `${fmtNumber(rows.length)} empreendimento(s)`;
    document.getElementById("product-tbody").innerHTML = sortRows(rows, productSort)
      .map(
        (r) => `<tr>
          <td>${r.product}</td>
          <td class="num">${fmtNumber(r.total)}</td>
          <td class="num">${fmtNumber(r.won)}</td>
          <td class="num">${r.sold > 0 ? fmtCurrency(r.sold) : "—"}</td>
        </tr>`
      )
      .join("");
    document.querySelectorAll("#product-table thead th").forEach((th) => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.sort === productSort.key) th.classList.add(productSort.dir === "asc" ? "sorted-asc" : "sorted-desc");
    });
  }

  function renderSourceBars(leads) {
    const grouped = groupBy(leads, (l) => l.origem);
    const rows = Array.from(grouped.entries())
      .map(([source, group]) => ({ source, count: group.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    const max = Math.max(1, ...rows.map((r) => r.count));
    document.getElementById("source-bars").innerHTML = rows
      .map(
        (r) => `<div class="rank-row">
          <div class="rank-label">${r.source}</div>
          <div class="rank-track"><div class="rank-fill" style="width:${(r.count / max) * 100}%"></div></div>
          <div class="rank-value">${fmtNumber(r.count)}</div>
        </div>`
      )
      .join("");
  }

  function renderAll() {
    if (loadFailed) return;
    const leads = filteredLeads();
    renderKPIs(leads);
    renderStageFunnel(leads);
    renderSellerTable(leads);
    renderProductTable(leads);
    renderSourceBars(leads);
  }

  function setupSortableTable(tableId, sortState) {
    document.querySelectorAll(`#${tableId} thead th[data-sort]`).forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (sortState.key === key) {
          sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
        } else {
          sortState.key = key;
          sortState.dir = "desc";
        }
        renderAll();
      });
    });
  }

  async function init() {
    setGreeting();
    setupSidebarNav();
    setupSortableTable("seller-table", sellerSort);
    setupSortableTable("product-table", productSort);

    try {
      const payload = await loadCvcrmData();
      allLeads = payload.leads || [];
      oldestDate = allLeads.reduce(
        (min, l) => (l.data_cad && (!min || l.data_cad < min) ? l.data_cad.slice(0, 10) : min),
        null
      );
      setupRangeFilter(state, oldestDate, renderAll);

      const updatedAt = payload.generated_at ? new Date(payload.generated_at) : null;
      document.getElementById("updated-at").textContent = updatedAt
        ? `Atualizado em ${updatedAt.toLocaleString("pt-BR")}`
        : "";

      renderAll();
    } catch (err) {
      loadFailed = true;
      document.getElementById("kpi-hero").innerHTML = "";
      document.getElementById("kpi-secondary").innerHTML =
        `<p class="muted">Não foi possível carregar os dados do CRM: ${err.message}</p>`;
      console.error(err);
    }
  }

  init();
})();
