// Pulls daily campaign-level insights directly from the Meta Marketing API
// (Graph API) for the Cavalcante & Rolim ad accounts and writes them to
// data/campaigns.json for the dashboard.
//
// Requires Node 18+ (built-in fetch) and env var META_ACCESS_TOKEN
// (a non-expiring System User token with the ads_read permission).

const fs = require("fs");
const path = require("path");

const TOKEN = process.env.META_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("Missing META_ACCESS_TOKEN environment variable.");
  process.exit(1);
}

const API_VERSION = "v21.0";
const DAYS_BACK = 90;

const AD_ACCOUNTS = [
  { id: "1765245617422908", name: "Cavalcante & Rolim - CA 01" },
  { id: "1582280703323698", name: "CA - Manta Design by Pininfarina" },
];

const FIELDS = "campaign_name,spend,impressions,clicks,ctr,cpc,actions,date_start";

// Meta reports the same on-Facebook lead form submission under both
// "onsite_conversion.lead_grouped" and the generic "lead" action type —
// summing both double-counts every lead. Use lead_grouped when present
// (native Lead Ads / Instant Forms) and fall back to "lead" for campaigns
// that only report the generic type (e.g. website/pixel-based leads).
function leadsFromActions(actions) {
  if (!Array.isArray(actions)) return 0;
  const byType = new Map(actions.map((a) => [a.action_type, Number(a.value || 0)]));
  if (byType.has("onsite_conversion.lead_grouped")) return byType.get("onsite_conversion.lead_grouped");
  return byType.get("lead") || 0;
}

function dateRange(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { since: fmt(from), until: fmt(to) };
}

async function fetchAllPages(url) {
  const rows = [];
  let next = url;
  while (next) {
    const res = await fetch(next);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Meta API request failed: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
    }
    const body = await res.json();
    rows.push(...(body.data || []));
    next = body.paging && body.paging.next ? body.paging.next : null;
  }
  return rows;
}

async function fetchAccount(account, since, until) {
  const params = new URLSearchParams({
    level: "campaign",
    fields: FIELDS,
    time_range: JSON.stringify({ since, until }),
    time_increment: "1",
    limit: "500",
    access_token: TOKEN,
  });
  const url = `https://graph.facebook.com/${API_VERSION}/act_${account.id}/insights?${params.toString()}`;
  const rows = await fetchAllPages(url);

  return rows.map((r) => {
    const spend = Number(r.spend || 0);
    const leads = leadsFromActions(r.actions);
    return {
      date: r.date_start,
      account: account.name,
      campaign: r.campaign_name || "",
      adset: "",
      spend,
      impressions: Number(r.impressions || 0),
      clicks: Number(r.clicks || 0),
      ctr: Number(r.ctr || 0),
      cpc: Number(r.cpc || 0),
      leads,
      cost_per_lead: leads > 0 ? spend / leads : null,
    };
  });
}

async function main() {
  const { since, until } = dateRange(DAYS_BACK);
  const rows = [];
  for (const account of AD_ACCOUNTS) {
    const accountRows = await fetchAccount(account, since, until);
    rows.push(...accountRows);
    console.log(`Fetched ${accountRows.length} rows for ${account.name}`);
  }

  const outPath = path.join(__dirname, "..", "data", "campaigns.json");
  const payload = {
    generated_at: new Date().toISOString(),
    source: "meta-marketing-api",
    days_back: DAYS_BACK,
    rows,
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${rows.length} rows to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
