(function () {
  "use strict";

  const { fmtCurrency, fmtCurrency2, fmtNumber, fmtPercent, getRange, inRange, setGreeting, setupSidebarNav, setupRangeFilter } =
    window.Common;

  const CHANNEL_LABELS = {
    "facebook|feed": "Facebook · Feed",
    "facebook|facebook_stories": "Facebook · Stories",
    "facebook|facebook_reels": "Facebook · Reels",
    "facebook|facebook_reels_overlay": "Facebook · Reels (overlay)",
    "facebook|facebook_profile_feed": "Facebook · Perfil",
    "facebook|facebook_notification": "Facebook · Notificação",
    "facebook|marketplace": "Facebook · Marketplace",
    "facebook|instream_video": "Facebook · Vídeo in-stream",
    "facebook|search": "Facebook · Busca",
    "instagram|feed": "Instagram · Feed",
    "instagram|instagram_stories": "Instagram · Stories",
    "instagram|instagram_reels": "Instagram · Reels",
    "instagram|instagram_explore": "Instagram · Explorar",
    "instagram|instagram_explore_grid_home": "Instagram · Explorar (grid)",
    "instagram|instagram_search": "Instagram · Busca",
    "instagram|instagram_lead_gen_multi_submit": "Instagram · Formulário instantâneo",
    "audience_network|an_classic": "Audience Network",
  };

  let adRows = [];
  let channelRows = [];
  let creatives = {};
  let oldestDate = null;
  let loadFailed = false;
  let state = { rangeMode: "30", customFrom: null, customTo: null };
  let channelSort = { key: "spend", dir: "desc" };
  let formSort = { key: "spend", dir: "desc" };

  async function loadCreativesData() {
    const res = await fetch("data/creatives.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load data/creatives.json (${res.status})`);
    return res.json();
  }

  function filteredAdRows() {
    const { from, to } = getRange(state);
    return adRows.filter((r) => inRange(r.date, from, to));
  }

  function filteredChannelRows() {
    const { from, to } = getRange(state);
    return channelRows.filter((r) => inRange(r.date, from, to));
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

  function renderKPIs(ads) {
    const spend = ads.reduce((s, r) => s + r.spend, 0);
    const leads = ads.reduce((s, r) => s + r.leads, 0);
    const impressions = ads.reduce((s, r) => s + r.impressions, 0);
    const clicks = ads.reduce((s, r) => s + r.clicks, 0);
    const cpl = leads > 0 ? spend / leads : null;
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const activeCreatives = new Set(ads.filter((r) => r.spend > 0).map((r) => r.ad_id)).size;

    document.getElementById("kpi-hero").innerHTML = `
      <div>
        <div class="label">Investimento total</div>
        <div class="value">${fmtCurrency(spend)}</div>
      </div>
    `;

    const secondary = [
      { label: "Leads", value: fmtNumber(leads) },
      { label: "Custo por lead", value: cpl == null ? "—" : fmtCurrency2(cpl) },
      { label: "CTR médio", value: fmtPercent(ctr) },
      { label: "Criativos ativos", value: fmtNumber(activeCreatives) },
    ];
    document.getElementById("kpi-secondary").innerHTML = secondary
      .map((t) => `<div class="stat-tile"><div class="label">${t.label}</div><div class="value">${t.value}</div></div>`)
      .join("");
  }

  function renderChannels(rows) {
    const map = new Map();
    for (const r of rows) {
      const key = `${r.platform}|${r.position}`;
      if (!map.has(key)) {
        map.set(key, { key, label: CHANNEL_LABELS[key] || key, spend: 0, impressions: 0, clicks: 0, leads: 0 });
      }
      const agg = map.get(key);
      agg.spend += r.spend;
      agg.impressions += r.impressions;
      agg.clicks += r.clicks;
      agg.leads += r.leads;
    }
    const agg = Array.from(map.values())
      .filter((r) => r.spend > 0)
      .map((r) => ({ ...r, cost_per_lead: r.leads > 0 ? r.spend / r.leads : null }));

    document.getElementById("channel-count").textContent = `${fmtNumber(agg.length)} canais`;
    document.getElementById("channel-tbody").innerHTML = sortRows(agg, channelSort)
      .map(
        (c) => `<tr>
          <td>${c.label}</td>
          <td class="num">${fmtCurrency(c.spend)}</td>
          <td class="num">${fmtNumber(c.impressions)}</td>
          <td class="num">${fmtNumber(c.clicks)}</td>
          <td class="num">${fmtNumber(c.leads)}</td>
          <td class="num">${c.cost_per_lead == null ? "—" : fmtCurrency2(c.cost_per_lead)}</td>
        </tr>`
      )
      .join("");
    document.querySelectorAll("#channel-table thead th").forEach((th) => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.sort === channelSort.key) th.classList.add(channelSort.dir === "asc" ? "sorted-asc" : "sorted-desc");
    });
  }

  function aggregateAds(rows) {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.ad_id)) {
        map.set(r.ad_id, {
          ad_id: r.ad_id,
          ad_name: r.ad_name,
          campaign: r.campaign,
          spend: 0,
          impressions: 0,
          clicks: 0,
          leads: 0,
        });
      }
      const agg = map.get(r.ad_id);
      agg.spend += r.spend;
      agg.impressions += r.impressions;
      agg.clicks += r.clicks;
      agg.leads += r.leads;
    }
    return Array.from(map.values())
      .filter((a) => a.spend > 0)
      .map((a) => ({
        ...a,
        ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0,
        cost_per_lead: a.leads > 0 ? a.spend / a.leads : null,
      }));
  }

  const PLACEHOLDER_ICON = `<div class="creative-thumb-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="m3 15 5-5 4 4 3-3 6 6"/><circle cx="8" cy="8.5" r="1.2" fill="currentColor" stroke="none"/></svg></div>`;

  function renderCreatives(rows) {
    const ads = aggregateAds(rows).sort((a, b) => b.spend - a.spend).slice(0, 18);
    document.getElementById("creative-count").textContent = `Top ${ads.length} por investimento no período`;
    document.getElementById("creative-grid").innerHTML = ads
      .map((a) => {
        const thumb = creatives[a.ad_id] && creatives[a.ad_id].thumbnail_url;
        return `<div class="creative-card">
          ${thumb ? `<img class="creative-thumb" src="${thumb}" alt="" loading="lazy" />` : PLACEHOLDER_ICON}
          <div class="creative-body">
            <div class="creative-name" title="${a.ad_name}">${a.ad_name || "—"}</div>
            <div class="creative-campaign" title="${a.campaign}">${a.campaign}</div>
            <div class="creative-stats">
              <div><span class="stat-value">${fmtCurrency(a.spend)}</span><span class="stat-label">investido</span></div>
              <div><span class="stat-value">${fmtNumber(a.leads)}</span><span class="stat-label">leads</span></div>
              <div><span class="stat-value">${a.cost_per_lead == null ? "—" : fmtCurrency2(a.cost_per_lead)}</span><span class="stat-label">custo/lead</span></div>
            </div>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderForms(rows) {
    const withForm = [];
    let untracked = { spend: 0, leads: 0 };
    for (const r of aggregateAds(rows)) {
      const info = creatives[r.ad_id];
      const formId = info && info.lead_gen_form_id;
      if (formId) {
        withForm.push({ formId, ad_name: r.ad_name, spend: r.spend, leads: r.leads });
      } else {
        untracked.spend += r.spend;
        untracked.leads += r.leads;
      }
    }

    const byForm = new Map();
    for (const r of withForm) {
      if (!byForm.has(r.formId)) byForm.set(r.formId, { formId: r.formId, adNames: new Set(), spend: 0, leads: 0 });
      const agg = byForm.get(r.formId);
      agg.adNames.add(r.ad_name);
      agg.spend += r.spend;
      agg.leads += r.leads;
    }

    const formRows = Array.from(byForm.values()).map((f) => ({
      label: Array.from(f.adNames).slice(0, 2).join(" · ") + (f.adNames.size > 2 ? ` +${f.adNames.size - 2}` : ""),
      spend: f.spend,
      leads: f.leads,
      cost_per_lead: f.leads > 0 ? f.spend / f.leads : null,
    }));
    if (untracked.spend > 0) {
      formRows.push({
        label: "Outros anúncios (sem detalhe de formulário)",
        spend: untracked.spend,
        leads: untracked.leads,
        cost_per_lead: untracked.leads > 0 ? untracked.spend / untracked.leads : null,
      });
    }

    document.getElementById("form-tbody").innerHTML = sortRows(formRows, formSort)
      .map(
        (f) => `<tr>
          <td>${f.label}</td>
          <td class="num">${fmtCurrency(f.spend)}</td>
          <td class="num">${fmtNumber(f.leads)}</td>
          <td class="num">${f.cost_per_lead == null ? "—" : fmtCurrency2(f.cost_per_lead)}</td>
        </tr>`
      )
      .join("");
    document.querySelectorAll("#form-table thead th").forEach((th) => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.sort === formSort.key) th.classList.add(formSort.dir === "asc" ? "sorted-asc" : "sorted-desc");
    });
  }

  function renderAll() {
    if (loadFailed) return;
    const ads = filteredAdRows();
    renderKPIs(ads);
    renderChannels(filteredChannelRows());
    renderCreatives(ads);
    renderForms(ads);
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
    setupSortableTable("channel-table", channelSort);
    setupSortableTable("form-table", formSort);

    try {
      const payload = await loadCreativesData();
      adRows = payload.ad_rows || [];
      channelRows = payload.channel_rows || [];
      creatives = payload.creatives || {};
      oldestDate = adRows.reduce((min, r) => (!min || r.date < min ? r.date : min), null);
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
        `<p class="muted">Não foi possível carregar os dados: ${err.message}</p>`;
      console.error(err);
    }
  }

  init();
})();
