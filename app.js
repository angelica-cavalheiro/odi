/* Minimal client-side ODI map using plain SVG and CSV upload */
(function() {
  let COL_VOLUME = null;
  const COL_VOLUME_OPTIONS = [
    'Qual o volume de pedidos mensal da sua empresa?',
    'Qual o volume de envios mensal da sua empresa?'
  ];
  const COL_CANAL = 'Como a sua empresa realiza vendas atualmente??';
  const COL_TRANSPORTADORA = 'Transportadora principal';
  const IMPORT_PREFIX = 'Importância - ';
  const SAT_OK = 'Satisfação - ';
  const SAT_TYPO = 'Satistação - ';

  const areaSelect = document.getElementById('areaSelect');
  const periodSelect = document.getElementById('periodSelect');
  const datasetContextEl = document.getElementById('datasetContext');
  const volumeSelect = document.getElementById('volumeSelect');
  const volumeLabel = document.getElementById('volumeLabel');
  const canalSelect = document.getElementById('canalSelect');
  const transportadoraSelect = document.getElementById('transportadoraSelect');
  const outcomeSearch = document.getElementById('outcomeSearch');
  const resetBtn = document.getElementById('resetBtn');
  const exportBtn = document.getElementById('exportBtn');
  const chartDiv = document.getElementById('chart');
  const tableBody = document.querySelector('#resultsTable tbody');
  const statusCount = document.getElementById('statusCount');
  const statusNote = document.getElementById('statusNote');
  const loadingEl = document.getElementById('loading');
  const emptyEl = document.getElementById('empty');
  const table = document.getElementById('resultsTable');
  const activeFiltersEl = document.getElementById('activeFilters');
  const toastContainer = document.getElementById('toastContainer');

  let manifest = null;
  let currentDatasetId = null;
  let csvLoadGeneration = 0;
  let rawRows = [];
  let columns = [];
  let results = [];
  let sortKey = 'score';
  let sortDir = 'desc';

  // Utils
  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.from(document.querySelectorAll(sel)); }
  function normalizeSpaces(s) { return String(s).replace(/\s+/g, ' ').trim(); }
  function uniqueSorted(arr) { return Array.from(new Set(arr.filter(v => v != null && String(v).trim() !== '').map(String))).sort((a, b) => a.localeCompare(b)); }
  function toNumber(v) { 
    if (v == null) return NaN; 
    const s = String(v).trim(); 
    if (!s) return NaN; 
    const n = parseFloat(s.replace(',', '.')); 
    const result = isNaN(n) ? NaN : n;
    if (isNaN(result)) {
      console.log('⚠️ Valor não numérico:', v, '->', s);
    }
    return result;
  }
  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }
  // Sistema de Toast
  function showToast(message, type = 'info', duration = 4000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };
    
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-message">${escapeHtml(message)}</span>
      <button class="toast-close" aria-label="Fechar notificação">×</button>
    `;
    
    // Adicionar evento de fechar
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => removeToast(toast));
    
    // Adicionar ao container
    toastContainer.appendChild(toast);
    
    // Auto-remover após duração
    if (duration > 0) {
      setTimeout(() => removeToast(toast), duration);
    }
    
    return toast;
  }
  
  function removeToast(toast) {
    if (!toast || !toast.parentNode) return;
    
    toast.classList.add('removing');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }
  
  function notify(msg, type = 'info') { 
    if (msg) {
      showToast(msg, type);
    }
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function setBusy(b) { [areaSelect, periodSelect, volumeSelect, canalSelect, transportadoraSelect, outcomeSearch, resetBtn, exportBtn].forEach(el => { if (el) el.disabled = b; }); if (b) show(loadingEl); else hide(loadingEl); }

  function datasetsForArea(area) {
    return manifest.datasets.filter(d => d.area === area);
  }

  function populateAreaSelect() {
    const areas = [...new Set(manifest.datasets.map(d => d.area))];
    areaSelect.innerHTML = areas.map(a => {
      const label = manifest.datasets.find(d => d.area === a).areaLabel || a;
      return `<option value="${escapeHtml(a)}">${escapeHtml(label)}</option>`;
    }).join('');
  }

  function populatePeriodSelectForArea(area) {
    const list = datasetsForArea(area);
    periodSelect.innerHTML = list.map(d =>
      `<option value="${escapeHtml(d.id)}">${escapeHtml(d.periodLabel)}</option>`
    ).join('');
  }

  function renderDatasetContext() {
    if (!datasetContextEl || !manifest || !currentDatasetId) return;
    const ds = manifest.datasets.find(d => d.id === currentDatasetId);
    datasetContextEl.textContent = ds ? `${ds.areaLabel} · ${ds.periodLabel}` : '';
  }

  // CSV parsing
  function splitCSVLine(line) {
    const out = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // Field separator
        out.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    // Add the last field
    out.push(current.trim());
    return out;
  }
  function parseCSV(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n').filter(Boolean);
    if (!lines.length) return { header: [], rows: [] };
    const header = splitCSVLine(lines[0]);
    const rows = lines.slice(1).map(splitCSVLine).filter(r => r.length > 1);
    return { header, rows };
  }
  function csvToObjects(header, rows) {
    const normHeader = header.map(normalizeSpaces);
    return rows.map(r => {
      const obj = {};
      for (let i = 0; i < normHeader.length; i++) obj[normHeader[i]] = r[i];
      return obj;
    });
  }

  function ratingColumnKeysFromRowKeys(keys) {
    return keys.filter(k =>
      k.startsWith(IMPORT_PREFIX) ||
      k.startsWith(SAT_OK) ||
      k.startsWith(SAT_TYPO)
    );
  }

  /**
   * Drops respondents whose Importância / Satisfação ratings are all the same value (straight-lining).
   * Rating columns are detected by prefix only; metadata and qualitative fields are ignored.
   */
  function removeStraightLiners(data) {
    const total = data.length;
    if (total === 0) {
      console.log('Removed 0 straight-line respondents out of 0. Remaining: 0');
      return [];
    }
    const ratingKeys = ratingColumnKeysFromRowKeys(Object.keys(data[0]));
    if (ratingKeys.length < 2) {
      console.log(`Removed 0 straight-line respondents out of ${total}. Remaining: ${total}`);
      return data.slice();
    }
    const kept = data.filter(row => {
      const nums = ratingKeys.map(k => toNumber(row[k]));
      if (nums.some(n => Number.isNaN(n))) return true;
      return new Set(nums).size !== 1;
    });
    const n = total - kept.length;
    console.log(`Removed ${n} straight-line respondents out of ${total}. Remaining: ${total - n}`);
    return kept;
  }

  // Data logic
  function detectPairs(cols) {
    console.log('🔍 Detectando pares...');
    console.log('🔍 IMPORT_PREFIX:', IMPORT_PREFIX);
    console.log('🔍 SAT_OK:', SAT_OK);
    console.log('🔍 SAT_TYPO:', SAT_TYPO);
    
    const importanceCols = cols.filter(c => c.startsWith(IMPORT_PREFIX));
    console.log('🔍 Colunas de importância encontradas:', importanceCols.length);
    
    const pairs = [];
    for (const imp of importanceCols) {
      const label = imp.slice(IMPORT_PREFIX.length).trim();
      const candidates = [`${SAT_OK}${label}`, `${SAT_TYPO}${label}`];
      let sat = candidates.find(c => cols.includes(c));
      if (!sat) {
        sat = cols.find(c => (c.startsWith(SAT_OK) || c.startsWith(SAT_TYPO)) && c.split('-', 1)[1]?.trim() === label);
      }
      if (sat) {
        pairs.push({ label, imp, sat });
        console.log('✅ Par encontrado:', label);
      } else {
        console.log('❌ Par não encontrado para:', label);
      }
    }
    console.log('🔍 Total de pares encontrados:', pairs.length);
    return pairs;
  }

  function compute(pairs, rows, scaleMin) {
    console.log('📊 Computando resultados...');
    console.log('📊 Pares recebidos:', pairs.length);
    console.log('📊 Linhas recebidas:', rows.length);
    
    const recs = [];
    for (const { label, imp, sat } of pairs) {
      const impVals = rows.map(r => toNumber(r[imp])).filter(v => !Number.isNaN(v));
      const satVals = rows.map(r => toNumber(r[sat])).filter(v => !Number.isNaN(v));
      
      console.log(`📊 ${label}: impVals=${impVals.length}, satVals=${satVals.length}`);
      
      if (impVals.length === 0 || satVals.length === 0) continue;
      const I = impVals.reduce((a, b) => a + b, 0) / impVals.length;
      const S = satVals.reduce((a, b) => a + b, 0) / satVals.length;
      const gap = I - S; // gap de satisfação (importância média − satisfação média)
      const score = I + gap; // = 2*I − S
      const underservedBoundary = 2 * I - 10; // y = 2x - 10
      const seg = (S > I) ? 'OVER-SERVED' : (S < underservedBoundary ? 'UNDER-SERVED' : 'APPROPRIATELY-SERVED');
      recs.push({ outcome: label, importancia: I, satisfacao: S, gap, score, segment: seg });
    }
    recs.sort((a, b) => b.score - a.score);
    console.log('📊 Resultados computados:', recs.length);
    return recs;
  }

  function populateSelectFilter(selectEl, columnName, rows) {
    const wrap = selectEl && selectEl.closest('.filter');
    const hasCol = columns.includes(columnName);
    if (wrap) wrap.hidden = !hasCol;
    if (!selectEl || !hasCol) {
      if (selectEl) {
        selectEl.innerHTML = '<option value="__ALL__">Todos</option>';
        selectEl.value = '__ALL__';
      }
      return;
    }
    const values = ['__ALL__', ...uniqueSorted(rows.map(r => r[columnName]))];
    selectEl.innerHTML = values.map(v => `<option value="${escapeHtml(v)}">${v === '__ALL__' ? 'Todos' : escapeHtml(v)}</option>`).join('');
  }

  function detectVolumeColumn(cols) {
    if (!COL_VOLUME) {
      COL_VOLUME = COL_VOLUME_OPTIONS.find(opt => cols.includes(opt));
      if (COL_VOLUME && volumeLabel) {
        const isSending = COL_VOLUME.includes('envios');
        volumeLabel.textContent = isSending ? 'Volume de envios' : 'Volume de pedidos';
      }
    }
  }

  function adaptFiltersToDataset(cols) {
    const wrapTransportadora = transportadoraSelect && transportadoraSelect.closest('.filter');
    const hasTransportadora = cols.includes(COL_TRANSPORTADORA);
    if (wrapTransportadora) wrapTransportadora.hidden = !hasTransportadora;

    const wrapCanal = canalSelect && canalSelect.closest('.filter');
    const hasCanal = cols.includes(COL_CANAL);
    if (wrapCanal) wrapCanal.hidden = !hasCanal;
  }

  function populateFilters(rows) {
    detectVolumeColumn(columns);
    adaptFiltersToDataset(columns);
    populateSelectFilter(volumeSelect, COL_VOLUME, rows);
    populateSelectFilter(canalSelect, COL_CANAL, rows);
    populateSelectFilter(transportadoraSelect, COL_TRANSPORTADORA, rows);
    restoreFilterState();
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch])); }

  function applyFilters(rows) {
    const v = volumeSelect.value;
    const c = canalSelect.value;
    const t = transportadoraSelect && transportadoraSelect.value;
    let out = [...rows];
    if (v && v !== '__ALL__' && columns.includes(COL_VOLUME)) out = out.filter(r => String(r[COL_VOLUME]) === v);
    if (c && c !== '__ALL__' && columns.includes(COL_CANAL)) out = out.filter(r => String(r[COL_CANAL]) === c);
    if (t && t !== '__ALL__' && columns.includes(COL_TRANSPORTADORA)) out = out.filter(r => String(r[COL_TRANSPORTADORA]) === t);
    return out;
  }

  // UI rendering
  function renderStatus(filteredRows) {
    const n = filteredRows.length;
    statusCount.textContent = `${n} ${n === 1 ? 'resposta' : 'respostas'} filtradas`;
    statusNote.textContent = outcomeSearch.value ? 'Busca ativa' : '';
  }

  function renderActiveFilters() {
    const filters = [];
    
    // Volume filter
    if (volumeSelect.value && volumeSelect.value !== '__ALL__') {
      filters.push({
        type: 'volume',
        label: 'Volume',
        value: volumeSelect.value,
        remove: () => { volumeSelect.value = '__ALL__'; update(); }
      });
    }
    
    // Canal filter
    if (canalSelect.value && canalSelect.value !== '__ALL__') {
      filters.push({
        type: 'canal',
        label: 'Canal',
        value: canalSelect.value,
        remove: () => { canalSelect.value = '__ALL__'; update(); }
      });
    }

    // Transportadora filter
    if (transportadoraSelect && transportadoraSelect.value && transportadoraSelect.value !== '__ALL__') {
      filters.push({
        type: 'transportadora',
        label: 'Transportadora',
        value: transportadoraSelect.value,
        remove: () => { transportadoraSelect.value = '__ALL__'; update(); }
      });
    }
    
    // Search filter
    if (outcomeSearch.value && outcomeSearch.value.trim()) {
      filters.push({
        type: 'search',
        label: 'Busca',
        value: outcomeSearch.value.trim(),
        remove: () => { outcomeSearch.value = ''; update(); }
      });
    }
    
    // Render tags
    activeFiltersEl.innerHTML = filters.map(filter => `
      <div class="filter-tag" data-type="${filter.type}">
        <span>${filter.label}: ${escapeHtml(filter.value)}</span>
        <span class="tag-remove" onclick="${filter.remove}">×</span>
      </div>
    `).join('');
    
    // Add click handlers for remove buttons
    activeFiltersEl.querySelectorAll('.tag-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tag = e.target.closest('.filter-tag');
        const type = tag.dataset.type;
        
        if (type === 'volume') {
          volumeSelect.value = '__ALL__';
        } else if (type === 'canal') {
          canalSelect.value = '__ALL__';
        } else if (type === 'transportadora') {
          transportadoraSelect.value = '__ALL__';
        } else if (type === 'search') {
          outcomeSearch.value = '';
        }
        
        update();
      });
    });
  }
  function renderEmptyState(recs) { if (!recs.length) { show(emptyEl); } else hide(emptyEl); }

  function renderTable(recs) {
    const q = outcomeSearch.value.trim().toLowerCase();
    let data = q ? recs.filter(r => r.outcome.toLowerCase().includes(q)) : recs;
    data = sortData(data);
    tableBody.innerHTML = data.map(r => `
      <tr>
        <td>${escapeHtml(r.outcome)}</td>
        <td>${r.importancia.toFixed(2)}</td>
        <td>${r.satisfacao.toFixed(2)}</td>
        <td>${r.gap.toFixed(2)}</td>
        <td>${r.score.toFixed(2)}</td>
        <td>${r.segment}</td>
      </tr>
    `).join('');
  }

  function sortData(arr) {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...arr].sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }
  function setSort(th) {
    $all('#resultsTable thead th').forEach(h => h.setAttribute('aria-sort', 'none'));
    const key = th.getAttribute('data-key');
    if (sortKey === key) {
      sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
    th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
    renderTable(results);
  }

  function el(tag, attrs, text) {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, String(v)));
    if (text != null) n.appendChild(document.createTextNode(text));
    return n;
  }

  function renderChart(recs) {
    console.log('📊 Renderizando gráfico com', recs.length, 'pontos');
    const q = outcomeSearch.value.trim().toLowerCase();
    const data = q ? recs.filter(r => r.outcome.toLowerCase().includes(q)) : recs;
    console.log('📊 Dados para gráfico:', data.length);
    chartDiv.innerHTML = '';
    const w = chartDiv.clientWidth || 1000, h = chartDiv.clientHeight || 520;
    const m = { l: 60, r: 20, t: 20, b: 44 }, iw = w - m.l - m.r, ih = h - m.t - m.b;
    const xMin = 0, xMax = 10, yMin = 0, yMax = 10;
    const sx = v => m.l + (v - xMin) / (xMax - xMin) * iw;
    const sy = v => m.t + ih - (v - yMin) / (yMax - yMin) * ih;

    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'presentation' });

    // grid
    const grid = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    grid.setAttribute('class', 'grid');
    for (let t = xMin; t <= xMax; t += 1) {
      grid.appendChild(el('line', { x1: sx(t), y1: sy(yMin), x2: sx(t), y2: sy(yMax) }));
      grid.appendChild(el('line', { x1: sx(xMin), y1: sy(t), x2: sx(xMax), y2: sy(t) }));
    }
    svg.appendChild(grid);

    // axes
    svg.appendChild(el('line', { class: 'axis', x1: sx(xMin), y1: sy(yMin), x2: sx(xMax), y2: sy(yMin) }));
    for (let t = xMin; t <= xMax; t += 1) {
      svg.appendChild(el('line', { class: 'axis', x1: sx(t), y1: sy(yMin) - 4, x2: sx(t), y2: sy(yMin) + 4 }));
      svg.appendChild(el('text', { class: 'axis', x: sx(t), y: sy(yMin) + 20, 'text-anchor': 'middle' }, String(t)));
    }
    svg.appendChild(el('line', { class: 'axis', x1: sx(xMin), y1: sy(yMin), x2: sx(xMin), y2: sy(yMax) }));
    for (let t = yMin; t <= yMax; t += 1) {
      svg.appendChild(el('line', { class: 'axis', x1: sx(xMin) - 4, y1: sy(t), x2: sx(xMin) + 4, y2: sy(t) }));
      svg.appendChild(el('text', { class: 'axis', x: sx(xMin) - 10, y: sy(t) + 4, 'text-anchor': 'end' }, String(t)));
    }
    // diagonals (limitadas à área visível)
    // y = x
    const t0 = Math.max(xMin, yMin);
    svg.appendChild(el('line', { class: 'diag', x1: sx(t0), y1: sy(t0), x2: sx(xMax), y2: sy(xMax) }));
    // y = 2x - 10 (linha de under-served)
    const xStartUS = Math.max(xMin, (yMin + 10) / 2);
    const yStartUS = 2 * xStartUS - 10;
    const yEndUS = 2 * xMax - 10;
    svg.appendChild(el('line', { class: 'diag-1', x1: sx(xStartUS), y1: sy(yStartUS), x2: sx(xMax), y2: sy(yEndUS) }));

    // tooltip and keyboard support
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    chartDiv.appendChild(tip);
    function showTip(html, x, y) {
      const rect = chartDiv.getBoundingClientRect();
      tip.style.display = 'block';
      tip.innerHTML = html;
      tip.style.left = (x - rect.left + 12) + 'px';
      tip.style.top = (y - rect.top + 12) + 'px';
    }
    function hideTip() { tip.style.display = 'none'; }

    for (const r of data) {
      const cls = r.segment === 'OVER-SERVED' ? 'over' : (r.segment === 'UNDER-SERVED' ? 'under' : 'ok');
      const cx = sx(r.importancia), cy = sy(r.satisfacao);
      const dot = el('circle', { class: `dot ${cls}`, cx, cy, r: 6, tabindex: '0', role: 'button', 'aria-label': `${r.outcome}. I ${r.importancia.toFixed(2)}, S ${r.satisfacao.toFixed(2)}, Gap ${r.gap.toFixed(2)}, Score ${r.score.toFixed(2)}, ${r.segment}` });
      dot.addEventListener('mouseenter', ev => showTip(`<div class="tip-title">${escapeHtml(r.outcome)}</div><div class="tip-metrics">I: ${r.importancia.toFixed(2)} · S: ${r.satisfacao.toFixed(2)} · Gap: ${r.gap.toFixed(2)} · Score: ${r.score.toFixed(2)} · ${r.segment}</div>`, ev.clientX, ev.clientY));
      dot.addEventListener('mousemove', ev => showTip(tip.innerHTML, ev.clientX, ev.clientY));
      dot.addEventListener('mouseleave', hideTip);
      dot.addEventListener('focus', () => {
        statusNote.textContent = `${r.outcome}: I ${r.importancia.toFixed(2)}, S ${r.satisfacao.toFixed(2)}, Score ${r.score.toFixed(2)}. ${r.segment}`;
      });
      dot.addEventListener('blur', () => { statusNote.textContent = ''; });
      dot.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          const rect = chartDiv.getBoundingClientRect();
          showTip(`<div class="tip-title">${escapeHtml(r.outcome)}</div><div class="tip-metrics">I: ${r.importancia.toFixed(2)} · S: ${r.satisfacao.toFixed(2)} · Gap: ${r.gap.toFixed(2)} · Score: ${r.score.toFixed(2)} · ${r.segment}</div>`, rect.left + cx, rect.top + cy);
        }
        if (ev.key === 'Escape') { hideTip(); }
      });
      svg.appendChild(dot);
    }
    chartDiv.appendChild(svg);
  }

  function update() {
    console.log('🔄 Iniciando update...');
    console.log('📊 Colunas disponíveis:', columns.length);
    console.log('📊 Dados brutos:', rawRows.length);

    try {
      detectVolumeColumn(columns);
      const pairs = detectPairs(columns);
      const filtered = applyFilters(rawRows);
      console.log('🔍 Dados filtrados:', filtered.length);

      renderStatus(filtered);
      renderActiveFilters();
      results = compute(pairs, filtered, 0);
      console.log('📈 Resultados finais:', results.length);

      renderEmptyState(results);
      renderTable(results);
      renderChart(results);
      renderDatasetContext();
      saveFilterState();
      notify('', 'info');
    } catch (err) {
      console.error('Erro ao atualizar mapa/tabela:', err);
      notify('Erro ao atualizar gráfico ou tabela: ' + (err && err.message ? err.message : String(err)), 'error');
    }
  }

  function exportCSV() {
    const q = outcomeSearch.value.trim().toLowerCase();
    const data = q ? results.filter(r => r.outcome.toLowerCase().includes(q)) : results;
    if (!data.length) { notify('Nada para exportar com os filtros atuais.', 'error'); return; }
    const header = ['Outcome', 'Importância', 'Satisfação', 'Gap_satisfação', 'Score', 'Segment'];
    const rows = data.map(r => [r.outcome, r.importancia.toFixed(2), r.satisfacao.toFixed(2), r.gap.toFixed(2), r.score.toFixed(2), r.segment]);
    const csv = [header, ...rows].map(r => r.map(toCsvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const slug = (currentDatasetId || 'odi').replace(/[^\w-]+/g, '_');
    a.download = `odi_opportunity_scores_${slug}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function toCsvCell(v) { const s = String(v); return (s.includes('"') || s.includes(',') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s; }

  async function loadCsvForDataset(datasetId, opts) {
    const silent = opts && opts.silent;
    const ds = manifest.datasets.find(d => d.id === datasetId);
    if (!ds) return;
    const loadId = ++csvLoadGeneration;
    currentDatasetId = datasetId;
    setBusy(true);
    try {
      const res = await fetch(ds.file, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${ds.file} (${res.status})`);
      const csvText = await res.text();
      if (loadId !== csvLoadGeneration) return;
      const { header, rows } = parseCSV(csvText);
      if (!header.length) throw new Error('Cabeçalho não encontrado no CSV');
      columns = header.map(normalizeSpaces);
      rawRows = csvToObjects(header, rows).map(r => {
        const o = {};
        Object.keys(r).forEach(k => o[normalizeSpaces(k)] = r[k]);
        return o;
      });
      rawRows = removeStraightLiners(rawRows);
      if (loadId !== csvLoadGeneration) return;
      populateFilters(rawRows);
      update();
      if (!silent) notify('Conjunto de dados atualizado.', 'success');
    } catch (e) {
      console.error(e);
      notify('Erro ao carregar ' + (ds && ds.file ? ds.file : 'CSV') + ': ' + e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function boot() {
    const localWarn = document.getElementById('localFileWarning');
    if (window.location.protocol === 'file:') {
      if (localWarn) localWarn.hidden = false;
      notify('Use um servidor local (veja o aviso acima). Abra http://localhost:8080 após rodar python3 -m http.server.', 'error');
      setBusy(false);
      return;
    }
    if (localWarn) localWarn.hidden = true;

    setBusy(true);
    try {
      const res = await fetch('odi-manifest.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('odi-manifest.json não encontrado (' + res.status + ')');
      manifest = await res.json();
      if (!manifest.datasets || manifest.datasets.length === 0) throw new Error('Manifest sem datasets');
      populateAreaSelect();
      let initialId = manifest.datasets[0].id;
      try {
        const raw = localStorage.getItem('odi.filters');
        if (raw) {
          const f = JSON.parse(raw);
          if (f.datasetId && manifest.datasets.some(d => d.id === f.datasetId)) initialId = f.datasetId;
        }
      } catch (_) {}
      const ds0 = manifest.datasets.find(d => d.id === initialId);
      areaSelect.value = ds0.area;
      populatePeriodSelectForArea(ds0.area);
      periodSelect.value = initialId;
      await loadCsvForDataset(initialId, { silent: true });
    } catch (e) {
      console.error(e);
      notify('Erro ao iniciar aplicação: ' + e.message, 'error');
    } finally {
      setBusy(false);
    }
  }


  // Filter state persistence
  function saveFilterState() {
    try {
      localStorage.setItem('odi.filters', JSON.stringify({
        datasetId: currentDatasetId,
        v: volumeSelect.value,
        c: canalSelect.value,
        t: transportadoraSelect ? transportadoraSelect.value : '__ALL__',
        s: outcomeSearch.value
      }));
    } catch (_) {}
  }
  function restoreFilterState() {
    try {
      const raw = localStorage.getItem('odi.filters');
      if (!raw) return;
      const f = JSON.parse(raw);
      const volOk = f.v && [...volumeSelect.options].some(o => o.value === f.v);
      volumeSelect.value = volOk ? f.v : '__ALL__';
      const canalOk = f.c && [...canalSelect.options].some(o => o.value === f.c);
      canalSelect.value = canalOk ? f.c : '__ALL__';
      if (transportadoraSelect) {
        const transpOk = f.t && [...transportadoraSelect.options].some(o => o.value === f.t);
        transportadoraSelect.value = transpOk ? f.t : '__ALL__';
      }
      if (typeof f.s === 'string') outcomeSearch.value = f.s;
    } catch (_) {}
  }


  // Events
  // Debounce na busca para reduzir repaints
  const onInputDebounced = debounce(update, 120);
  // <select> nem sempre dispara "input" em Safari/WebKit; "change" é o evento fiável.
  [volumeSelect, canalSelect, transportadoraSelect].filter(Boolean).forEach(el => el.addEventListener('change', update));
  areaSelect.addEventListener('change', () => {
    const area = areaSelect.value;
    populatePeriodSelectForArea(area);
    const list = datasetsForArea(area);
    if (list.length) {
      periodSelect.value = list[0].id;
      loadCsvForDataset(list[0].id);
    }
  });
  periodSelect.addEventListener('change', () => {
    loadCsvForDataset(periodSelect.value);
  });
  outcomeSearch.addEventListener('input', onInputDebounced);
  resetBtn.addEventListener('click', () => {
    volumeSelect.value = '__ALL__';
    canalSelect.value = '__ALL__';
    if (transportadoraSelect) transportadoraSelect.value = '__ALL__';
    outcomeSearch.value = '';
    update();
  });
  exportBtn.addEventListener('click', exportCSV);
  $all('#resultsTable thead th').forEach(th => th.addEventListener('click', () => setSort(th)));

  boot();
})();
