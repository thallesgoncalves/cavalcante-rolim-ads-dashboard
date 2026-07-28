# Dashboard de Campanhas — Cavalcante & Rolim

Dashboard estático de performance de Meta Ads (Facebook/Instagram) e do funil
de vendas do CV CRM, hospedado no GitHub Pages. Os dados são atualizados
automaticamente uma vez por dia via GitHub Actions.

## Como funciona

- `scripts/fetch_data.js` — busca os últimos 90 dias de dados de campanha
  (investimento, impressões, cliques, leads) direto da **Meta Marketing API**
  para as contas Cavalcante & Rolim - CA 01 e CA - Manta Design by
  Pininfarina, e grava em `data/campaigns.json`.
- `scripts/fetch_cvcrm.js` — busca todos os leads do **CV CRM**
  (`/api/v1/comercial/leads`, paginado), remove PII (nome, email, telefone,
  endereço) e grava um resumo (situação, origem, empreendimento, corretor,
  valor de negócio) em `data/cvcrm.json`.
- `scripts/fetch_creatives.js` — busca dados diários por anúncio (nível ad) e
  por canal/posicionamento (breakdowns `publisher_platform`/`platform_position`)
  na Meta Marketing API, mais thumbnail e formulário de lead dos criativos com
  maior investimento, e grava em `data/creatives.json`.
- `.github/workflows/update-data.yml` — roda os três scripts todo dia às 09:00
  (America/Maceio) e comita os JSONs atualizados. Pode também ser disparado
  manualmente na aba **Actions** do repositório.
- `index.html` / `app.js` — página **Dashboard**: KPIs e gráficos de Meta Ads,
  resumo do funil de vendas do CV CRM e ROI (com filtro de período próprio),
  tabela de campanhas.
- `funil-cv-crm.html` / `funil.js` — página **Funil CV CRM**: distribuição por
  situação, performance por corretor, leads por empreendimento, leads por
  origem.
- `canais-criativos.html` / `canais.js` — página **Canais & Criativos**:
  investimento/leads por canal e posicionamento, ranking de criativos (com
  thumbnail) e agrupamento por formulário de lead.
- `common.js` — funções e componentes compartilhados pelas três páginas
  (formatação, filtro de período — suporta múltiplos filtros independentes
  na mesma página —, gráfico de barras).
- `style.css` — estilos das três páginas. Sem build step, sem dependências
  externas além da fonte Lato (Google Fonts).

## Observações sobre os dados

- **CV CRM**: a classificação de "venda realizada" / "descartado" / "perdido"
  é feita por texto no campo `situacao`, que é configurável pelo cliente no
  painel — se o time renomear essas situações, ajuste `isWon`/`isLost` em
  `app.js` e `funil.js`.
- **ROI**: o `valor_negocio` do CV CRM nem sempre é preenchido pelo time de
  vendas nas vendas fechadas — o card de ROI mostra quantas vendas do período
  entraram na soma vs. quantas ficaram de fora por falta de valor registrado.
  A taxa de comissão (`ROI_COMMISSION_RATE` em `app.js`, hoje 5%) é um
  placeholder — ajuste para o percentual real da Cavalcante & Rolim.
- **Conta "CA 01"**: historicamente sem investimento ativo nos últimos 90 dias
  (campanhas pausadas) — o dashboard reflete isso corretamente com zeros, não
  é um bug de coleta.

## Rodar localmente

```bash
META_ACCESS_TOKEN=seu_token node scripts/fetch_data.js
CVCRM_DOMAIN=seu_dominio CVCRM_EMAIL=seu_email CVCRM_TOKEN=seu_token node scripts/fetch_cvcrm.js
META_ACCESS_TOKEN=seu_token node scripts/fetch_creatives.js
python3 -m http.server 8000
# abrir http://localhost:8000
```

`META_ACCESS_TOKEN` deve ser um token de **System User** do Business Manager
(Configurações do negócio → Usuários → Usuários do sistema) com a permissão
`ads_read` nas contas de anúncio, gerado com expiração "Nunca" — assim não
precisa ser renovado.

`CVCRM_TOKEN` é o token estático gerado no cadastro do usuário admin do CV CRM
(Usuários → seu usuário → "Token"), usado junto com `CVCRM_EMAIL` nos headers
`email`/`token` (esquema de autenticação legado v1 da API do CV CRM).

## Configuração no GitHub

1. Secrets **META_ACCESS_TOKEN**, **CVCRM_DOMAIN**, **CVCRM_EMAIL** e
   **CVCRM_TOKEN** em *Settings → Secrets and variables → Actions*.
2. GitHub Pages configurado para publicar a partir da branch `main` (`/root`).
