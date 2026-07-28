// Pulls leads from the CV CRM API and writes a summarized, PII-stripped
// version to data/cvcrm.json for the dashboard's sales funnel section.
//
// Requires Node 18+ (built-in fetch) and env vars CVCRM_DOMAIN, CVCRM_EMAIL,
// CVCRM_TOKEN. Auth is the legacy v1 scheme: "email" + "token" headers
// (not Authorization: Bearer) tied to a static token generated in the CV CRM
// admin user registry (Usuários → seu usuário → "Token").

const fs = require("fs");
const path = require("path");

const DOMAIN = process.env.CVCRM_DOMAIN;
const EMAIL = process.env.CVCRM_EMAIL;
const TOKEN = process.env.CVCRM_TOKEN;

for (const [name, value] of Object.entries({ CVCRM_DOMAIN: DOMAIN, CVCRM_EMAIL: EMAIL, CVCRM_TOKEN: TOKEN })) {
  if (!value) {
    console.error(`Missing ${name} environment variable.`);
    process.exit(1);
  }
}

const BASE_URL = `https://${DOMAIN}.cvcrm.com.br/api/v1`;
// The API ignores the requested page size and always returns 30 records per
// call — pagination advances purely via offset.
const PAGE_SIZE = 30;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(offset, attempt = 1) {
  const url = `${BASE_URL}/comercial/leads?offset=${offset}`;
  const res = await fetch(url, {
    headers: { email: EMAIL, token: TOKEN, "Content-Type": "application/json" },
  });

  if (res.status === 429 && attempt <= 5) {
    console.log(`Rate limited at offset ${offset}, retrying in ${attempt * 5}s (attempt ${attempt})`);
    await sleep(attempt * 5000);
    return fetchPage(offset, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CV CRM request failed: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
  }
  return res.json();
}

// valor_negocio comes back Brazilian-formatted ("377.550,00"): dot=thousands,
// comma=decimal.
function parseMoneyValue(value) {
  if (value == null || value === "") return null;
  const num = Number(String(value).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

// Strip customer PII (nome, email, telefone, documento, endereço, renda,
// links de acesso ao painel) — keep only what the dashboard needs to build
// funnel/source/project breakdowns.
function normalizeLead(lead) {
  return {
    id: lead.idlead,
    situacao_id: lead.situacao && lead.situacao.id,
    situacao: lead.situacao && lead.situacao.nome && lead.situacao.nome.trim(),
    origem: lead.origem || null,
    midia_principal: lead.midia_principal || null,
    corretor: lead.corretor && lead.corretor.nome,
    empreendimentos: Array.isArray(lead.empreendimento)
      ? lead.empreendimento.map((e) => e.nome && e.nome.trim()).filter(Boolean)
      : [],
    score: lead.score != null ? Number(lead.score) : null,
    valor_negocio: parseMoneyValue(lead.valor_negocio),
    possibilidade_venda: lead.possibilidade_venda,
    data_cad: lead.data_cad,
    data_vencimento: lead.data_vencimento,
    ultima_data_conversao: lead.ultima_data_conversao,
    qtde_simulacoes_associadas: lead.qtde_simulacoes_associadas || 0,
    qtde_reservas_associadas: lead.qtde_reservas_associadas || 0,
  };
}

async function main() {
  const leads = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const body = await fetchPage(offset);
    total = Number(body.total || 0);
    for (const lead of body.leads || []) leads.push(normalizeLead(lead));
    console.log(`Fetched offset ${offset}/${total}`);
    offset += PAGE_SIZE;
    if (offset < total) await sleep(300);
  }

  const outPath = path.join(__dirname, "..", "data", "cvcrm.json");
  const payload = {
    generated_at: new Date().toISOString(),
    source: "cv-crm",
    total_leads: leads.length,
    leads,
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${leads.length} leads to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
