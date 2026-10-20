'use strict';
const $ = (id) => document.getElementById(id);
const defaults = { mode: 'hanzi', content: '春风化雨\n山水清音\n静心习字', sheetTitle: '一日一字 · 春和景明', showMeta: true, grid: 'mi', cellSize: 15, rowGap: 5, margin: 20, font: 'kai', fontSize: 72, offset: 0, pinyin: true, highlight: true, blankRow: false, blankCol: false, traceCount: 5, traceColor: '#b8c8bc', lineColor: '#91aa97' };
Object.assign(defaults, { fontSource: 'common', rowPattern: null });
let state = { ...defaults };
try { const stored = JSON.parse(localStorage.getItem('shujian-settings-v1')); if (stored && typeof stored === 'object') state = { ...defaults, ...stored }; } catch {}
const modes = { hanzi: ['汉字字帖', '每个汉字独占一行'], words: ['词句字帖', '每行输入一个词语或短句'], paragraph: ['段落字帖', '保留段落，按顺序连续排版'], strokes: ['笔画字帖', '逐笔累加，练习汉字笔顺'] };
if (!modes[state.mode]) state.mode = 'hanzi';
const samples = { spring: '云淡风轻近午天\n傍花随柳过前川\n时人不识余心乐\n将谓偷闲学少年', moon: '床前明月光\n疑是地上霜\n举头望明月\n低头思故乡', nature: '春风化雨\n山水清音\n静心习字', daily: '认真\n温暖\n善良\n勇敢\n好好生活' };
const fonts = { kai: 'KaiTi, STKaiti, "MaShanZheng", serif', brush: 'MaShanZheng, KaiTi, serif', song: 'SimSun, "Songti SC", serif', sans: '"Microsoft YaHei", sans-serif' };
const palettes = { green: ['#b8c8bc', '#91aa97'], red: ['#dbb0ac', '#be8b86'], gray: ['#bfc2c6', '#969da4'], blue: ['#b9cedd', '#8daabd'] };
const fields = Object.keys(defaults).filter((key) => $(key));
const numeric = new Set(['cellSize', 'rowGap', 'margin', 'fontSize', 'offset', 'traceCount']);
const paper = $('paper');
const MM = 6, PAGE_W = 1260, PAGE_H = 1782;
let pages = [], pageIndex = 0, zoom = 1, debounce, renderVersion = 0, toastTimer;
let cellTool = 'demo';
const strokeCache = new Map();
function toast(message) {
  $('toast').textContent = message; $('toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3500);
}
function syncControls() {
  fields.forEach((key) => { const element = $(key); if (element.type === 'checkbox') element.checked = state[key]; else element.value = key === 'font' && !fonts[state.font] ? 'kai' : state[key]; });
  for (const name of ['mode', 'grid']) document.querySelectorAll(`[data-${name}]`).forEach((button) => { const active = button.dataset[name] === state[name]; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  document.querySelectorAll('[data-palette]').forEach((button) => button.classList.toggle('active', palettes[button.dataset.palette][1] === state.lineColor));
  $('modeTitle').textContent = modes[state.mode][0]; $('inputHint').textContent = modes[state.mode][1];
  for (const [key, unit] of [['cellSize', ' mm'], ['rowGap', ' mm'], ['fontSize', '%'], ['offset', '%'], ['traceCount', ' 个']]) $(key + 'Value').textContent = state[key] + unit;
  $('charCount').textContent = Array.from(state.content.replace(/\s/g, '')).length + ' 字';
  document.querySelectorAll('[data-font-source]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.fontSource === state.fontSource)));
  $('commonFonts').hidden = state.fontSource === 'local'; $('localFonts').hidden = state.fontSource !== 'local';
  if (state.font.startsWith('local:')) { $('font').selectedIndex = -1; $('localFont').value = state.font; }
  const fontName = savedFonts.get(state.font)?.label || $('font').selectedOptions[0]?.textContent || '楷体';
  $('selectedFontName').textContent = fontName; $('selectedFontName').title = fontName;
  const hanzi = state.mode === 'hanzi';
  $('hanziRowSettings').hidden = !hanzi;
  for (const id of ['highlightRow', 'blankColRow', 'legacyTraceCount']) $(id).hidden = hanzi;
  syncRowControls();
}
function update() {
  syncControls();
  try { localStorage.setItem('shujian-settings-v1', JSON.stringify(state)); $('saveStatus').textContent = '已保存在此浏览器'; } catch { $('saveStatus').textContent = '浏览器存储不可用'; }
  clearTimeout(debounce); debounce = setTimeout(render, 100);
}
function getGeometry() {
  const margin = state.margin * MM, size = state.cellSize * MM;
  const pinyinHeight = state.pinyin ? size * 0.34 : 0, rowHeight = size + pinyinHeight, gap = state.rowGap * MM;
  const top = margin + (state.sheetTitle || state.showMeta ? 92 : 0);
  const columns = Math.max(1, Math.floor((PAGE_W - margin * 2) / size));
  const rows = Math.max(1, Math.floor((PAGE_H - margin - top + gap) / (rowHeight + gap)));
  return { margin, size, pinyinHeight, rowHeight, gap, top, columns, rows, left: (PAGE_W - columns * size) / 2 };
}
function getRowPattern(columns) {
  const stride = state.blankCol ? 2 : 1;
  return Array.from({ length: columns }, (_, column) => {
    if (Array.isArray(state.rowPattern)) return ['demo', 'trace'].includes(state.rowPattern[column]) ? state.rowPattern[column] : 'blank';
    if (column % stride) return 'blank';
    const position = column / stride;
    return state.highlight && position === 0 ? 'demo' : position < state.traceCount + (state.highlight ? 1 : 0) ? 'trace' : 'blank';
  });
}
function syncRowControls() {
  const columns = getGeometry().columns, pattern = getRowPattern(columns);
  const demo = pattern.filter((type) => type === 'demo').length, trace = pattern.filter((type) => type === 'trace').length;
  $('demoCount').value = demo; $('demoCount').max = columns - trace;
  $('rowTraceCount').value = trace; $('rowTraceCount').max = columns - demo;
  $('rowSummary').textContent = `每行 ${columns} 格 · 留白 ${columns - demo - trace} 格`;
  document.querySelectorAll('[data-cell-type]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.cellType === cellTool)));
  $('rowCells').replaceChildren(...pattern.map((type, column) => {
    const name = { demo: '示范', trace: '描红', blank: '留白' }[type];
    const button = document.createElement('button');
    button.className = 'row-cell'; button.dataset.column = column; button.dataset.type = type;
    button.setAttribute('aria-label', `第 ${column + 1} 格：${name}`); button.title = `第 ${column + 1} 格：${name}`;
    const number = document.createElement('small'); number.textContent = column + 1;
    const label = document.createElement('span'); label.textContent = name;
    button.append(number, label); return button;
  }));
}
function setRowCount(type, value) {
  const columns = getGeometry().columns, pattern = getRowPattern(Math.max(18, state.rowPattern?.length || 0));
  const visible = pattern.slice(0, columns), current = visible.filter((entry) => entry === type).length;
  const target = Math.max(0, Math.min(Math.trunc(Number(value) || 0), current + visible.filter((entry) => entry === 'blank').length));
  let remaining = Math.abs(target - current);
  for (let index = target < current ? columns - 1 : 0; index >= 0 && index < columns && remaining; index += target < current ? -1 : 1) {
    if (pattern[index] === (target < current ? type : 'blank')) { pattern[index] = target < current ? 'blank' : type; remaining--; }
  }
  state.rowPattern = pattern; update();
}
function makeRows(geometry) {
  const rows = [], stride = state.blankCol ? 2 : 1, capacity = Math.ceil(geometry.columns / stride);
  const putRow = (cells) => { rows.push(cells); if (state.blankRow) rows.push([]); };
  for (const line of state.content.split(/\r?\n/)) {
    const text = line.replace(/\s/g, ''), chars = Array.from(text);
    const readings = window.pinyinPro ? window.pinyinPro.pinyin(text, { type: 'array' }) : [];
    if (!chars.length) { if (state.mode === 'paragraph') putRow([]); continue; }
    if (state.mode === 'hanzi') {
      const pattern = getRowPattern(geometry.columns);
      chars.forEach((char, charIndex) => putRow(pattern.flatMap((type, column) => type === 'blank' ? [] : [{ char, reading: readings[charIndex], dark: type === 'demo', column }])));
    } else if (state.mode === 'strokes') {
      chars.forEach((char, charIndex) => {
        if (state.mode === 'strokes' && strokeCache.get(char)?.strokes) {
          const strokes = strokeCache.get(char).strokes;
          const sequence = [{ char, reading: readings[charIndex], dark: true }, ...strokes.map((_, strokeIndex) => ({ char, strokeIndex, strokes }))];
          for (let start = 0; start < sequence.length; start += capacity) putRow(sequence.slice(start, start + capacity).map((cell, index) => ({ ...cell, column: index * stride })));
        } else putRow(Array.from({ length: Math.min(capacity, state.traceCount + (state.highlight ? 1 : 0)) }, (_, index) => ({ char, reading: readings[charIndex], dark: state.highlight && index === 0, column: index * stride })));
      });
    } else if (state.mode === 'words') {
      for (let start = 0; start < chars.length; start += capacity) {
        const chunk = chars.slice(start, start + capacity), cells = [];
        const repeats = Math.max(1, Math.floor(capacity / chunk.length));
        for (let repeat = 0; repeat < Math.min(repeats, state.traceCount + (state.highlight ? 1 : 0)); repeat++) chunk.forEach((char, index) => cells.push({ char, reading: readings[start + index], dark: state.highlight && repeat === 0, column: (repeat * chunk.length + index) * stride }));
        putRow(cells);
      }
    } else for (let start = 0; start < chars.length; start += capacity) putRow(chars.slice(start, start + capacity).map((char, index) => ({ char, reading: readings[start + index], dark: state.highlight, column: index * stride })));
  }
  if (!rows.length) rows.push([]);
  return rows;
}
async function loadStrokes(version) {
  const missing = [...new Set(Array.from(state.content).filter((char) => /\p{Script=Han}/u.test(char)))].filter((char) => !strokeCache.has(char));
  if (!missing.length) return;
  toast('正在载入笔顺数据…');
  let failed = 0;
  for (let start = 0; start < missing.length; start += 6) {
    await Promise.all(missing.slice(start, start + 6).map(async (char) => {
      try {
        const key = 'shujian-stroke-' + char;
        let data; try { data = JSON.parse(localStorage.getItem(key)); } catch {}
        if (!data?.strokes) {
          const response = await fetch('https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/' + encodeURIComponent(char) + '.json', { signal: AbortSignal.timeout(12000) });
          if (!response.ok) throw new Error('stroke unavailable');
          data = await response.json(); if (!Array.isArray(data.strokes)) throw new Error('invalid strokes');
          try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
        }
        strokeCache.set(char, data);
      } catch { strokeCache.set(char, null); failed++; }
    }));
    if (version !== renderVersion) return;
  }
  if (version === renderVersion) { drawPages(); toast(failed ? `${failed} 个字暂无笔顺数据，已显示为普通描红` : '笔顺已载入'); }
}
function drawGrid(context, x, y, geometry) {
  const size = geometry.size, py = geometry.pinyinHeight, top = y + py;
  context.lineWidth = 0.9; context.strokeStyle = state.lineColor; context.setLineDash([]); context.strokeRect(x, top, size, size);
  if (py) {
    context.strokeRect(x, y, size, py); context.globalAlpha = 0.4;
    for (const ratio of [1 / 3, 2 / 3]) { context.beginPath(); context.moveTo(x, y + py * ratio); context.lineTo(x + size, y + py * ratio); context.stroke(); }
    context.globalAlpha = 1;
  }
  context.globalAlpha = 0.55; context.setLineDash([2, 3]); context.beginPath();
  if (state.grid !== 'square') {
    context.moveTo(x + size / 2, top); context.lineTo(x + size / 2, top + size);
    context.moveTo(x, top + size / 2); context.lineTo(x + size, top + size / 2);
  }
  if (state.grid === 'mi' || state.grid === 'hui') {
    context.moveTo(x, top); context.lineTo(x + size, top + size);
    context.moveTo(x + size, top); context.lineTo(x, top + size);
  }
  context.stroke(); if (state.grid === 'hui') context.strokeRect(x + size / 4, top + size / 4, size / 2, size / 2);
  context.setLineDash([]); context.globalAlpha = 1;
}
function drawCell(context, cell, x, y, geometry) {
  const size = geometry.size, top = y + geometry.pinyinHeight;
  context.fillStyle = cell.dark ? '#303c34' : state.traceColor;
  if (cell.strokes) {
    context.save(); const scale = size * (state.fontSize / 100) / 1024;
    context.translate(x + size / 2 - 512 * scale, top + size / 2 + 388 * scale + size * state.offset / 100); context.scale(scale, -scale);
    cell.strokes.forEach((path, index) => { context.fillStyle = index === cell.strokeIndex ? '#344f40' : index < cell.strokeIndex ? state.traceColor : '#eef0ed'; context.fill(new Path2D(path)); });
    context.restore();
  } else {
    context.font = `${size * state.fontSize / 100}px ${fonts[state.font] || fonts.kai}`; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(cell.char, x + size / 2, top + size * (0.53 + state.offset / 100));
  }
  if (state.pinyin && cell.reading && /\p{Script=Han}/u.test(cell.char)) {
    context.font = `${Math.min(size * 0.19, 18)}px Arial, sans-serif`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = cell.dark ? '#536b56' : state.traceColor;
    context.fillText(cell.reading, x + size / 2, y + geometry.pinyinHeight * 0.53, size * 0.95);
  }
}
function drawPage(canvas, rows, geometry, index, total) {
  canvas.width = PAGE_W; canvas.height = PAGE_H;
  const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, PAGE_W, PAGE_H); context.textAlign = 'center'; context.textBaseline = 'middle';
  if (state.sheetTitle) { context.fillStyle = '#435c49'; context.font = `29px ${fonts.kai}`; context.fillText(state.sheetTitle, PAGE_W / 2, geometry.margin + 13, PAGE_W - geometry.margin * 2); }
  if (state.showMeta) {
    context.font = '15px "Microsoft YaHei", sans-serif'; context.fillStyle = '#9ba49b'; context.textAlign = 'left'; context.fillText('姓名：____________', geometry.left, geometry.top - 28);
    context.textAlign = 'right'; context.fillText('日期：________________', PAGE_W - geometry.left, geometry.top - 28);
  }
  for (let rowIndex = 0; rowIndex < geometry.rows; rowIndex++) {
    const y = geometry.top + rowIndex * (geometry.rowHeight + geometry.gap);
    for (let column = 0; column < geometry.columns; column++) drawGrid(context, geometry.left + column * geometry.size, y, geometry);
    (rows[rowIndex] || []).forEach((cell) => drawCell(context, cell, geometry.left + cell.column * geometry.size, y, geometry));
  }
  context.font = '12px "Microsoft YaHei", sans-serif'; context.fillStyle = '#b4bdb2'; context.textAlign = 'center'; context.fillText(`${index + 1} / ${total}`, PAGE_W / 2, PAGE_H - 38);
}
function drawPages() {
  const geometry = getGeometry(), rows = makeRows(geometry); pages = [];
  for (let start = 0; start < rows.length; start += geometry.rows) pages.push(rows.slice(start, start + geometry.rows));
  pageIndex = Math.min(pageIndex, pages.length - 1); drawPage(paper, pages[pageIndex], geometry, pageIndex, pages.length);
  $('pageInfo').textContent = `${pageIndex + 1} / ${pages.length}`; $('prevPage').disabled = pageIndex === 0; $('nextPage').disabled = pageIndex === pages.length - 1;
  $('layoutInfo').textContent = `${geometry.columns} 列 × ${geometry.rows} 行`; fitPaper();
}
async function render() { const version = ++renderVersion; drawPages(); if (state.mode === 'strokes') await loadStrokes(version); }
function fitPaper() {
  const viewport = $('paperViewport'), padding = parseFloat(getComputedStyle(viewport).paddingLeft) + parseFloat(getComputedStyle(viewport).paddingRight);
  $('paperWrap').style.width = Math.round(Math.max(100, viewport.clientWidth - padding) * zoom) + 'px'; $('zoomValue').textContent = zoom === 1 ? '适应' : Math.round(zoom * 100) + '%';
}
fields.forEach((key) => $(key).addEventListener('input', () => { const element = $(key); state[key] = element.type === 'checkbox' ? element.checked : numeric.has(key) ? Number(element.value) : element.value; pageIndex = 0; update(); }));
document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => { state.mode = button.dataset.mode; pageIndex = 0; update(); }));
document.querySelectorAll('[data-grid]').forEach((button) => button.addEventListener('click', () => { state.grid = button.dataset.grid; update(); }));
document.querySelectorAll('[data-sample]').forEach((button) => button.addEventListener('click', () => { state.content = samples[button.dataset.sample]; pageIndex = 0; update(); }));
document.querySelectorAll('[data-palette]').forEach((button) => button.addEventListener('click', () => { [state.traceColor, state.lineColor] = palettes[button.dataset.palette]; update(); }));
document.querySelectorAll('[data-font-source]').forEach((button) => button.addEventListener('click', () => {
  state.fontSource = button.dataset.fontSource;
  update();
}));
document.querySelectorAll('[data-cell-type]').forEach((button) => button.addEventListener('click', () => { cellTool = button.dataset.cellType; syncRowControls(); }));
$('rowCells').addEventListener('click', (event) => {
  const button = event.target.closest('[data-column]'); if (!button) return;
  state.rowPattern = getRowPattern(Math.max(18, state.rowPattern?.length || 0));
  state.rowPattern[Number(button.dataset.column)] = cellTool; update();
  $('rowCells').querySelector(`[data-column="${button.dataset.column}"]`).focus({ preventScroll: true });
});
$('demoCount').addEventListener('change', (event) => setRowCount('demo', event.target.value));
$('rowTraceCount').addEventListener('change', (event) => setRowCount('trace', event.target.value));
$('resetRow').addEventListener('click', () => { state.rowPattern = Array.from({ length: 18 }, (_, column) => column === 0 ? 'demo' : column < 6 ? 'trace' : 'blank'); update(); });
$('clear').addEventListener('click', () => { state.content = ''; pageIndex = 0; update(); $('content').focus(); });
$('reset').addEventListener('click', () => { state = { ...defaults }; pageIndex = 0; zoom = 1; update(); toast('已恢复默认字帖'); });
$('prevPage').addEventListener('click', () => { if (pageIndex > 0) { pageIndex--; drawPages(); } });
$('nextPage').addEventListener('click', () => { if (pageIndex < pages.length - 1) { pageIndex++; drawPages(); } });
$('zoomOut').addEventListener('click', () => { zoom = Math.max(0.5, Math.round((zoom - 0.1) * 10) / 10); fitPaper(); });
$('zoomIn').addEventListener('click', () => { zoom = Math.min(2, Math.round((zoom + 0.1) * 10) / 10); fitPaper(); });
$('fit').addEventListener('click', () => { zoom = 1; fitPaper(); });
$('download').addEventListener('click', async () => {
  await localFontsReady; await document.fonts.ready; await render(); const link = document.createElement('a');
  link.download = `${(state.sheetTitle || '书间字帖').replace(/[\\/:*?"<>|]/g, '')}-${pageIndex + 1}.png`; link.href = paper.toDataURL('image/png'); link.click(); toast(`已保存第 ${pageIndex + 1} 页图片`);
});
$('print').addEventListener('click', async () => {
  await localFontsReady; await document.fonts.ready; await render(); const container = $('printPages'); container.replaceChildren(); const geometry = getGeometry();
  pages.forEach((rows, index) => { const canvas = document.createElement('canvas'); drawPage(canvas, rows, geometry, index, pages.length); const image = new Image(); image.src = canvas.toDataURL(); container.append(image); });
  await Promise.all(Array.from(container.children, (image) => image.decode())); window.print();
});
new ResizeObserver(fitPaper).observe($('paperViewport'));
const localFontsReady = restoreLocalFonts();
syncControls(); window.lucide?.createIcons(); document.fonts.load('28px MaShanZheng').then(() => render()).catch(() => toast('毛笔字体未加载，已使用系统字体')); render();
