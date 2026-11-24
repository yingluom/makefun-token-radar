// Token Radar dashboard: renders window.RADAR (written beside this page by main.ts) with no network.
// Three views, chosen by the hash: #/ the ranked pre-token board, #/live the already-trading set,
// #/p/<slug> one protocol's detail — its figures, its model breakdown and its farm plan.
'use strict';

const R = window.RADAR;
const $ = (id) => document.getElementById(id);
const bySlug = new Map(R.rows.map((r) => [r.slug, r]));

/* ---------- formatting ---------- */
function money(v) {
  if (v === null || v === undefined) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return '$' + trim(v / 1e9) + 'B';
  if (a >= 1e6) return '$' + trim(v / 1e6) + 'M';
  if (a >= 1e3) return '$' + trim(v / 1e3) + 'K';
  return '$' + Math.round(v);
}
function trim(n) {
  return n.toFixed(2).replace(/\.?0+$/, '');
}
function fullMoney(v) {
  return '$' + Math.round(v).toLocaleString('en-US');
}
function pct(v) {
  if (v === null) return '<span class="chains">—</span>';
  const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : '';
  return `<span class="${cls}">${v > 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
}
function years(v) {
  return v === null ? '—' : v.toFixed(1) + ' yrs';
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function chainList(chains) {
  if (chains.length === 0) return '—';
  const head = chains.slice(0, 3).join(', ');
  return chains.length > 3 ? `${esc(head)} +${chains.length - 3}` : esc(head);
}

/* ---------- header and model panel ---------- */
function renderChrome() {
  const s = R.stats;
  $('statChips').innerHTML = [
    ['Snapshot', R.as_of],
    ['Protocols scanned', s.scanned],
    ['Pre-token ranked', s.ranked],
    ['Watchlist covered', s.watchlist + ' / ' + s.watchlist],
    ['Live tokens aside', s.live],
  ]
    .map(([k, v]) => `<span class="chip">${k} <b>${v}</b></span>`)
    .join('');
  $('modelPoints').innerHTML = R.model.points.map((p) => `<li>${esc(p)}</li>`).join('');
  $('modelHygiene').textContent = R.model.hygiene;
  $('multipleRows').innerHTML =
    R.model.multiples
      .map(
        (m) =>
          `<tr><td>${esc(m.category)}</td><td>${m.multiple.toFixed(3)}</td><td>${m.peers}</td>` +
          `<td>${m.fallback ? 'global median (few peers)' : 'category median'}</td></tr>`,
      )
      .join('') +
    `<tr><td>All categories</td><td>${R.model.global_multiple.toFixed(3)}</td><td>—</td><td>fallback median</td></tr>`;
  $('sourceLine').textContent = `Source: ${R.source}. Watchlist floor: ${fullMoney(R.floor_usd)} of TVL.`;
}

/* ---------- controls ---------- */
function fillFilters() {
  const chainCount = new Map();
  const cats = new Set();
  for (const r of R.rows) {
    for (const c of r.chains) chainCount.set(c, (chainCount.get(c) || 0) + 1);
    if (r.category !== null) cats.add(r.category);
  }
  const chains = [...chainCount.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  $('chainSel').innerHTML =
    '<option value="">All chains</option>' + chains.map(([c, n]) => `<option value="${esc(c)}">${esc(c)} (${n})</option>`).join('');
  $('catSel').innerHTML =
    '<option value="">All categories</option>' +
    [...cats].sort().map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

function visibleRows() {
  const q = $('q').value.trim().toLowerCase();
  const chain = $('chainSel').value;
  const cat = $('catSel').value;
  const min = Number($('minSel').value);
  const watchOnly = $('watchOnly').checked;
  const sort = $('sortSel').value;
  const out = R.rows.filter(
    (r) =>
      (q === '' || r.name.toLowerCase().includes(q) || r.slug.includes(q)) &&
      (chain === '' || r.chains.includes(chain)) &&
      (cat === '' || r.category === cat) &&
      r.implied_value_usd >= min &&
      (!watchOnly || r.watchlist),
  );
  const key = {
    implied: (r) => r.implied_value_usd,
    tvl: (r) => r.tvl_usd,
    growth: (r) => (r.change_7d === null ? -Infinity : r.change_7d),
    age: (r) => (r.tokenless_years === null ? -Infinity : r.tokenless_years),
  }[sort];
  out.sort((a, b) => key(b) - key(a) || a.rank - b.rank);
  return out;
}

function renderBoard() {
  const rows = visibleRows();
  $('rowCount').textContent = `${rows.length} of ${R.rows.length} protocols`;
  $('boardRows').innerHTML =
    rows.length === 0
      ? '<tr><td class="empty" colspan="9">No protocol matches these filters.</td></tr>'
      : rows
          .map(
            (r) => `<tr data-slug="${esc(r.slug)}">
        <td class="num rank">${r.rank}</td>
        <td><span class="pname">${esc(r.name)}</span>${r.watchlist ? '<span class="badge">WATCHLIST</span>' : ''}</td>
        <td class="cat">${esc(r.category ?? '—')}</td>
        <td class="chains">${chainList(r.chains)}</td>
        <td class="num">${money(r.tvl_usd)}</td>
        <td class="num">${pct(r.change_7d)}</td>
        <td class="num">${years(r.tokenless_years)}</td>
        <td class="num implied">${money(r.implied_value_usd)}</td>
        <td class="num">${(r.implied_value_usd / r.tvl_usd).toFixed(2)}x</td>
      </tr>`,
          )
          .join('');
  for (const tr of $('boardRows').querySelectorAll('tr[data-slug]')) {
    tr.addEventListener('click', () => {
      location.hash = '#/p/' + tr.dataset.slug;
    });
  }
}

/* ---------- live view ---------- */
function renderLive() {
  $('liveRows').innerHTML = R.live
    .map(
      (p, i) => `<tr>
      <td class="num rank">${i + 1}</td>
      <td><span class="pname">${esc(p.name)}</span></td>
      <td class="sym">${esc(p.symbol ?? '—')}</td>
      <td class="cat">${esc(p.category ?? '—')}</td>
      <td class="num">${money(p.tvl_usd)}</td>
      <td class="num">${money(p.mcap_usd)}</td>
      <td class="num">${pct(p.change_7d)}</td>
    </tr>`,
    )
    .join('');
}

/* ---------- detail view ---------- */
function renderDetail(slug) {
  const r = bySlug.get(slug);
  const el = $('detailView');
  if (r === undefined) {
    el.innerHTML = '<p><a class="back" href="#/">&larr; Back to the board</a></p><p>No protocol with that slug is on the board.</p>';
    return;
  }
  const stat = (label, value) => `<div><span>${label}</span><b>${value}</b></div>`;
  el.innerHTML = `
    <p><a class="back" href="#/">&larr; Back to the board</a></p>
    <div class="detail">
      <h2>${esc(r.name)}${r.watchlist ? '<span class="badge">WATCHLIST</span>' : ''}</h2>
      <p class="sub">Rank #${r.rank} of ${R.rows.length} pre-token protocols &middot; ${esc(r.category ?? 'Uncategorised')} &middot; records no token in the ${R.as_of} snapshot</p>
      <div class="statgrid">
        ${stat('TVL', fullMoney(r.tvl_usd))}
        ${stat('7d TVL change', r.change_7d === null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%')}
        ${stat('Tracked since', r.listed_at ?? '—')}
        ${stat('No token for', years(r.tokenless_years))}
        ${stat('Implied value', fullMoney(r.implied_value_usd))}
        ${stat('Value / TVL', (r.implied_value_usd / r.tvl_usd).toFixed(2) + 'x')}
      </div>
      <p class="chains">Chains: ${r.chains.length > 0 ? esc(r.chains.join(', ')) : '—'}</p>
      <h3>How the model values it</h3>
      <table class="breakdown">
        <tr><td>TVL</td><td>${fullMoney(r.tvl_usd)}</td><td></td></tr>
        <tr><td class="op">&times;</td><td>${r.category_multiple.toFixed(3)}</td><td>category multiple (${esc(r.category ?? 'all categories')} median market cap / TVL)</td></tr>
        <tr><td class="op">&times;</td><td>${r.momentum_factor.toFixed(2)}</td><td>momentum (7d change ${r.change_7d === null ? 'not reported' : r.change_7d.toFixed(1) + '%'})</td></tr>
        <tr><td class="op">&times;</td><td>${r.age_factor.toFixed(2)}</td><td>maturity (${years(r.tokenless_years)} with no token)</td></tr>
        <tr><td class="op">&times;</td><td>${r.chain_factor.toFixed(2)}</td><td>chain breadth (${r.chains.length} chain${r.chains.length === 1 ? '' : 's'})</td></tr>
        <tr class="total"><td>=</td><td><b>${fullMoney(r.implied_value_usd)}</b></td><td>implied value, rounded to the nearest $1,000</td></tr>
      </table>
      <h3>Farm plan</h3>
      <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    </div>`;
}

/* ---------- routing ---------- */
function route() {
  const hash = location.hash || '#/';
  const detail = hash.match(/^#\/p\/(.+)$/);
  const isLive = hash === '#/live';
  $('boardView').hidden = detail !== null || isLive;
  $('liveView').hidden = !isLive;
  $('detailView').hidden = detail === null;
  $('viewBoard').classList.toggle('on', !isLive);
  $('viewLive').classList.toggle('on', isLive);
  if (detail !== null) renderDetail(decodeURIComponent(detail[1]));
  window.scrollTo(0, 0);
}

$('viewBoard').addEventListener('click', () => (location.hash = '#/'));
$('viewLive').addEventListener('click', () => (location.hash = '#/live'));
for (const id of ['q', 'chainSel', 'catSel', 'minSel', 'sortSel', 'watchOnly']) {
  $(id).addEventListener('input', renderBoard);
  $(id).addEventListener('change', renderBoard);
}
window.addEventListener('hashchange', route);

renderChrome();
fillFilters();
renderBoard();
renderLive();
route();
