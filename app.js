'use strict';
const $ = (id) => document.getElementById(id);
const MM = 6, PAGE_W = 1260, PAGE_H = 1782;
const MIN_CELL = 10, MIN_MARGIN = 12;
/* 每行最多格数由「最小方格 + 最窄页边距」推出，改参数时无需再手工维护。 */
const MAX_COLUMNS = Math.floor((PAGE_W - MIN_MARGIN * MM * 2) / (MIN_CELL * MM));
const STORAGE_KEY = 'shujian-settings-v1';

const defaultStrokeRows = () => [{ id: 'heng', chars: '一二三' }, { id: 'shu', chars: '十干中' }, { id: 'pie', chars: '人天' }];
const defaults = {
  mode: 'hanzi', content: '春风化雨\n山水清音\n静心习字', sheetTitle: '一日一字 · 春和景明', titleSize: 40,
  titleFixed: true, showMeta: true, showPageNumber: true, grid: 'mi', cellSize: 15, rowGap: 5, margin: 20,
  font: 'kai', fontSize: 72, offset: 0, strokeSize: 100, strokeOffset: 0,
  pinyin: true, pinyinFirst: true, highlight: true,
  blankRow: false, blankCol: false, traceCount: 5, traceColor: '#b8c8bc', lineColor: '#91aa97',
  fontSource: 'common', rowPattern: null, strokeRows: defaultStrokeRows()
};
let state = { ...defaults };
try {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (stored && typeof stored === 'object') state = { ...defaults, ...stored };
} catch {}
if (!Array.isArray(state.strokeRows) || !state.strokeRows.length) state.strokeRows = defaultStrokeRows();
state.strokeRows = state.strokeRows
  .filter((row) => row && typeof row.id === 'string' && Strokes.byId(row.id))
  .map((row) => ({ id: row.id, chars: String(row.chars ?? '') }));

const modes = {
  hanzi: ['汉字字帖', '每个汉字独占一行'],
  words: ['词句字帖', '每行输入一个词语或短句'],
  paragraph: ['段落字帖', '保留段落，按顺序连续排版'],
  strokes: ['笔画字帖', '逐行练习基本笔画，字例可自定义']
};
if (!modes[state.mode]) state.mode = 'hanzi';
const samples = {
  spring: '云淡风轻近午天\n傍花随柳过前川\n时人不识余心乐\n将谓偷闲学少年',
  moon: '床前明月光\n疑是地上霜\n举头望明月\n低头思故乡',
  nature: '春风化雨\n山水清音\n静心习字',
  daily: '认真\n温暖\n善良\n勇敢\n好好生活'
};
const fonts = { kai: 'KaiTi, STKaiti, "MaShanZheng", serif', brush: 'MaShanZheng, KaiTi, serif', song: 'SimSun, "Songti SC", serif', sans: '"Microsoft YaHei", sans-serif' };
const palettes = { green: ['#b8c8bc', '#91aa97'], red: ['#dbb0ac', '#be8b86'], gray: ['#bfc2c6', '#969da4'], blue: ['#b9cedd', '#8daabd'] };
const PUNCTUATION = /^[，。、；：？！“”‘’（）《》〈〉【】…—·,.;:?!'"()\[\]]$/;
const HAN = /\p{Script=Han}/u;

const fields = Object.keys(defaults).filter((key) => {
  const element = $(key);
  return element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT');
});
const numeric = new Set(['cellSize', 'rowGap', 'margin', 'fontSize', 'offset', 'strokeSize', 'strokeOffset', 'traceCount', 'titleSize']);
/* 旧版本存下的数值可能落在新滑块范围之外，加载时按控件的 min/max 收敛一次。 */
fields.forEach((key) => {
  const element = $(key);
  if (!numeric.has(key) || element.type !== 'range') return;
  state[key] = Math.min(Number(element.max), Math.max(Number(element.min), Number(state[key]) || 0));
});
const paper = $('paper');
const paperWrap = $('paperWrap');

let pages = [], pageIndex = 0, zoom = 1, debounce, saveTimer, renderVersion = 0, toastTimer;
let cellTool = 'demo';
let brushFont = null;
const refreshIcons = () => window.lucide?.createIcons();

function toast(message) {
  $('toast').textContent = message; $('toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3500);
}

/* 毛笔字体按需加载：不选毛笔楷书就不会下载这个几百 KB 以外的字体文件。 */
function ensureBrushFont() {
  if (!brushFont) brushFont = document.fonts.load('28px MaShanZheng').catch(() => {});
  return brushFont;
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 200);
}
function flushSave() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); $('saveStatus').textContent = '已保存在此浏览器'; }
  catch { $('saveStatus').textContent = '浏览器存储不可用'; }
}

function syncControls() {
  fields.forEach((key) => {
    const element = $(key);
    if (element.type === 'checkbox') element.checked = Boolean(state[key]);
    else element.value = key === 'font' && !fonts[state.font] ? 'kai' : state[key];
  });
  for (const name of ['mode', 'grid']) document.querySelectorAll(`[data-${name}]`).forEach((button) => {
    const active = button.dataset[name] === state[name];
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-palette]').forEach((button) => button.classList.toggle('active', palettes[button.dataset.palette][1] === state.lineColor));
  $('modeTitle').textContent = modes[state.mode][0]; $('inputHint').textContent = modes[state.mode][1];
  for (const [key, unit] of [['cellSize', ' mm'], ['rowGap', ' mm'], ['fontSize', '%'], ['offset', '%'], ['strokeSize', '%'], ['strokeOffset', '%'], ['traceCount', ' 个'], ['titleSize', ' px']]) $(key + 'Value').textContent = state[key] + unit;
  const strokes = state.mode === 'strokes';
  /* 笔画模式里字号/偏移控制的是「字例文字」，笔画本身另有大小与偏移，
     所以把原来的两个标签改名，避免两组滑块同名。 */
  $('fontSizeLabel').textContent = strokes ? '字例大小' : '字体大小';
  $('offsetLabel').textContent = strokes ? '字例偏移' : '上下偏移';
  $('strokeStyleRow').hidden = !strokes;
  $('charCount').textContent = strokes ? `${state.strokeRows.length} 行` : Array.from(state.content.replace(/\s/g, '')).length + ' 字';
  $('textContent').hidden = strokes; $('strokeContent').hidden = !strokes; $('sampleSection').hidden = strokes;
  document.querySelector('.page-banner').classList.toggle('slim', strokes);
  if (strokes) renderStrokeSummary();
  document.querySelectorAll('[data-font-source]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.fontSource === state.fontSource)));
  $('commonFonts').hidden = state.fontSource === 'local'; $('localFonts').hidden = state.fontSource !== 'local';
  if (state.font.startsWith('local:')) { $('font').selectedIndex = -1; $('localFont').value = state.font; }
  const fontName = LocalFonts.savedFonts.get(state.font)?.label || $('font').selectedOptions[0]?.textContent || '楷体';
  $('selectedFontName').textContent = fontName; $('selectedFontName').title = fontName;
  const hanzi = state.mode === 'hanzi';
  $('hanziRowSettings').hidden = !hanzi;
  $('highlightRow').hidden = strokes;
  $('blankColRow').hidden = hanzi || strokes;
  $('legacyTraceCount').hidden = hanzi;
  $('pinyinFirstRow').hidden = strokes;
  syncRowControls();
}

function update() {
  syncControls();
  persist();
  clearTimeout(debounce); debounce = setTimeout(render, 80);
}

/* 题签作为纸面上方的独立标题区：贴着页面顶端，与姓名行之间留足空隙，
   姓名行之下才是格子。开启「固定顶部留白」时，即使题签为空也照样占位，
   因此填写或清空标题都不会让下方格子跳动。 */
function headerLayout() {
  const size = state.titleSize || defaults.titleSize;
  const margin = state.margin * MM;
  const hasTitle = Boolean(String(state.sheetTitle || '').trim());
  const reserved = hasTitle || state.titleFixed;
  const inset = Math.min(margin * 0.42, 64);
  const titleY = inset + size * 0.52;
  const titleBottom = inset + size * 1.06;
  const metaY = reserved ? titleBottom + 46 : inset + 22;
  const bottom = state.showMeta ? metaY + 12 : (reserved ? titleBottom + 6 : inset + 6);
  return {
    size, hasTitle, reserved, titleY, metaY,
    /* 交给 getGeometry() 的额外留白：负值即「顶到页边距为止」。 */
    height: Math.max(0, bottom + 12 - margin)
  };
}

function getGeometry() {
  const margin = state.margin * MM, size = state.cellSize * MM;
  const pinyinHeight = state.pinyin ? size * 0.34 : 0, rowHeight = size + pinyinHeight, gap = state.rowGap * MM;
  const top = margin + headerLayout().height;
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
  const columns = getGeometry().columns, pattern = getRowPattern(Math.max(MAX_COLUMNS, state.rowPattern?.length || 0));
  const visible = pattern.slice(0, columns), current = visible.filter((entry) => entry === type).length;
  const target = Math.max(0, Math.min(Math.trunc(Number(value) || 0), current + visible.filter((entry) => entry === 'blank').length));
  let remaining = Math.abs(target - current);
  for (let index = target < current ? columns - 1 : 0; index >= 0 && index < columns && remaining; index += target < current ? -1 : 1) {
    if (pattern[index] === (target < current ? type : 'blank')) { pattern[index] = target < current ? 'blank' : type; remaining--; }
  }
  state.rowPattern = pattern; update();
}

/* ---------------- 笔画模式的对话框 ---------------- */

let draftRows = [];

function buildStrokeSearchIndex() {
  const pro = window.pinyinPro;
  for (const item of Strokes.all) {
    const letters = pro ? pro.pinyin(item.name, { toneType: 'none', type: 'array' }) : [];
    item.search = [item.name, letters.join(''), letters.map((letter) => letter[0] || '').join(''), item.group].join(' ').toLowerCase();
  }
}

/* 缩略图一律静态渲染：此前悬停会把上一个格子停在「写到一半」的状态，
   看起来像没画好，所以不再做动画，点选即添加。 */
function paintPreview(canvas, id, size, color) {
  const ratio = 2;
  canvas.width = size * ratio; canvas.height = size * ratio;
  canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  Strokes.paint(context, id, size, color, 0.9);
}

function iconButton(name, label, onClick) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'icon-button';
  button.title = label; button.setAttribute('aria-label', label);
  const icon = document.createElement('i'); icon.dataset.lucide = name;
  button.append(icon); button.addEventListener('click', onClick);
  return button;
}

function renderStrokeSummary() {
  const list = $('strokeSummary');
  if (!state.strokeRows.length) {
    const empty = document.createElement('li'); empty.className = 'stroke-summary-empty'; empty.textContent = '还没有笔画';
    list.replaceChildren(empty); return;
  }
  list.replaceChildren(...state.strokeRows.map((row) => {
    const item = document.createElement('li');
    const canvas = document.createElement('canvas'); paintPreview(canvas, row.id, 22, '#303c34');
    const name = document.createElement('b'); name.textContent = Strokes.byId(row.id)?.name || '';
    const chars = document.createElement('span'); chars.textContent = row.chars || '—';
    item.append(canvas, name, chars); return item;
  }));
}

function renderLibrary(query = '') {
  const keyword = query.trim().toLowerCase();
  const matched = Strokes.all.filter((item) => !keyword || item.search.includes(keyword));
  const library = $('strokeLibrary');
  library.replaceChildren();
  $('strokeSearchStatus').textContent = keyword
    ? `找到 ${matched.length} 个笔画`
    : `共 ${Strokes.all.length} 个笔画，按类别分组`;
  for (const group of Strokes.groups) {
    const items = group.items.filter((item) => matched.includes(item));
    if (!items.length) continue;
    const section = document.createElement('div'); section.className = 'stroke-group';
    const title = document.createElement('h4'); title.textContent = group.name;
    const grid = document.createElement('div'); grid.className = 'stroke-grid';
    for (const item of items) {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'stroke-chip'; chip.dataset.stroke = item.id;
      chip.title = `${item.name}｜字例：${item.chars}`;
      const canvas = document.createElement('canvas'); paintPreview(canvas, item.id, 34, '#303c34');
      const label = document.createElement('span'); label.textContent = item.name;
      chip.append(canvas, label);
      chip.addEventListener('click', () => addStrokeRow(item));
      grid.append(chip);
    }
    section.append(title, grid); library.append(section);
  }
}

function addStrokeRow(item) {
  draftRows.push({ id: item.id, chars: item.chars });
  renderDraft();
  const rows = $('strokeRows');
  rows.scrollTop = rows.scrollHeight;
}

function renderDraft() {
  const container = $('strokeRows');
  container.replaceChildren();
  $('strokeSelectedCount').textContent = draftRows.length ? `${draftRows.length} 行` : '';
  if (!draftRows.length) {
    const empty = document.createElement('p'); empty.className = 'empty-hint';
    empty.textContent = '还没有笔画，点击左侧笔画库添加';
    container.append(empty); return;
  }
  draftRows.forEach((row, index) => {
    const element = document.createElement('div'); element.className = 'stroke-row';
    const canvas = document.createElement('canvas'); canvas.className = 'stroke-row-preview';
    paintPreview(canvas, row.id, 26, '#303c34');
    const name = document.createElement('span'); name.className = 'stroke-row-name'; name.textContent = Strokes.byId(row.id)?.name || '未知';
    const input = document.createElement('input');
    input.className = 'stroke-row-chars'; input.type = 'text'; input.value = row.chars; input.maxLength = 40;
    input.placeholder = '字例，可留空'; input.setAttribute('aria-label', `${name.textContent} 的字例`);
    input.addEventListener('input', () => { draftRows[index].chars = input.value; });
    const copy = iconButton('copy', '复制本行（按住 Alt 复制 5 行）', (event) => {
      const count = event.altKey ? 5 : 1;
      draftRows.splice(index + 1, 0, ...Array.from({ length: count }, () => ({ ...draftRows[index] })));
      renderDraft();
    });
    const remove = iconButton('trash-2', '删除本行', () => { draftRows.splice(index, 1); renderDraft(); });
    element.append(canvas, name, input, copy, remove);
    container.append(element);
  });
  refreshIcons();
}

function openStrokeDialog() {
  draftRows = state.strokeRows.map((row) => ({ ...row }));
  $('strokeSearch').value = '';
  renderLibrary(''); renderDraft();
  if (typeof $('strokeDialog').showModal === 'function') $('strokeDialog').showModal();
  else $('strokeDialog').setAttribute('open', '');
}

function closeStrokeDialog() {
  if (typeof $('strokeDialog').close === 'function') $('strokeDialog').close();
  else $('strokeDialog').removeAttribute('open');
  $('editStrokes').focus({ preventScroll: true });
}

/* ---------------- 排版 ---------------- */

/* 按列数切行，并做「避头尾」：标点不落到行首，必要时把上一行末字带下来。 */
function chunkCells(cells, size) {
  const chunks = [];
  for (let start = 0; start < cells.length; start += size) chunks.push(cells.slice(start, start + size));
  for (let index = 1; index < chunks.length; index++) {
    if (chunks[index].length && PUNCTUATION.test(chunks[index][0].char) && chunks[index - 1].length > 1) chunks[index].unshift(chunks[index - 1].pop());
  }
  return chunks;
}

function makeRows(geometry) {
  const rows = [], stride = state.blankCol ? 2 : 1, capacity = Math.ceil(geometry.columns / stride);
  const putRow = (cells) => { rows.push(cells); if (state.blankRow) rows.push([]); };

  if (state.mode === 'strokes') {
    const width = geometry.columns;
    for (const entry of state.strokeRows) {
      if (!Strokes.byId(entry.id)) continue;
      const chars = Array.from(String(entry.chars || '').replace(/\s/g, ''));
      const readings = window.pinyinPro ? window.pinyinPro.pinyin(chars.join(''), { type: 'array' }) : [];
      const cells = [{ stroke: entry.id, dark: true }];
      for (let index = 0; index < state.traceCount; index++) cells.push({ stroke: entry.id, dark: false });
      chars.forEach((char, index) => cells.push({ char, reading: readings[index], dark: false }));
      for (let start = 0; start < cells.length; start += width) {
        putRow(cells.slice(start, start + width).map((cell, index) => ({ ...cell, column: index })));
      }
    }
    if (!rows.length) rows.push([]);
    return rows;
  }

  for (const line of state.content.split(/\r?\n/)) {
    const text = line.replace(/\s/g, ''), chars = Array.from(text);
    const readings = window.pinyinPro ? window.pinyinPro.pinyin(text, { type: 'array' }) : [];
    if (!chars.length) { if (state.mode === 'paragraph') putRow([]); continue; }
    if (state.mode === 'hanzi') {
      const pattern = getRowPattern(geometry.columns);
      chars.forEach((char, charIndex) => putRow(pattern.flatMap((type, column) => type === 'blank' ? [] : [{ char, reading: readings[charIndex], dark: type === 'demo', column }])));
    } else if (state.mode === 'words') {
      for (const chunk of chunkCells(chars.map((char, index) => ({ char, reading: readings[index] })), capacity)) {
        const cells = [];
        const repeats = Math.max(1, Math.floor(capacity / chunk.length));
        for (let repeat = 0; repeat < Math.min(repeats, state.traceCount + (state.highlight ? 1 : 0)); repeat++) chunk.forEach((cell, index) => cells.push({ ...cell, dark: state.highlight && repeat === 0, column: (repeat * chunk.length + index) * stride }));
        putRow(cells);
      }
    } else {
      let first = true;
      for (const chunk of chunkCells(chars.map((char, index) => ({ char, reading: readings[index] })), capacity)) {
        putRow(chunk.map((cell, index) => ({ ...cell, dark: state.highlight && first && index === 0, column: index * stride })));
        first = false;
      }
    }
  }
  if (!rows.length) rows.push([]);
  return rows;
}

/* 拼音默认只标在一行的示范格上；没有示范格时退到该行第一个汉字。 */
function markPinyin(rows) {
  if (!state.pinyin) return;
  for (const row of rows) {
    const cells = row.filter((cell) => cell.reading && HAN.test(cell.char || ''));
    if (!cells.length) continue;
    if (state.pinyinFirst) (cells.find((cell) => cell.dark) || cells[0]).pinyin = true;
    else cells.forEach((cell) => { cell.pinyin = true; });
  }
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
  if (cell.stroke) {
    context.save();
    context.translate(x, top + size * state.strokeOffset / 100);
    Strokes.paint(context, cell.stroke, size, cell.dark ? '#303c34' : state.traceColor, 0.9 * state.strokeSize / 100);
    context.restore();
    return;
  }
  const family = fonts[state.font] || fonts.kai;
  context.fillStyle = cell.dark ? '#303c34' : state.traceColor;
  context.textAlign = 'center'; context.textBaseline = 'middle';
  const punctuation = PUNCTUATION.test(cell.char);
  context.font = `${size * state.fontSize / 100 * (punctuation ? 0.92 : 1)}px ${family}`;
  if (punctuation) {
    /* 标点按规范写在格子左下角 */
    context.fillText(cell.char, x + size * 0.34, top + size * (0.68 + state.offset / 100));
  } else {
    context.fillText(cell.char, x + size / 2, top + size * (0.53 + state.offset / 100));
  }
  if (cell.pinyin) {
    context.font = `${Math.min(size * 0.19, 18)}px Arial, sans-serif`; context.fillStyle = cell.dark ? '#536b56' : state.traceColor;
    context.fillText(cell.reading, x + size / 2, y + geometry.pinyinHeight * 0.53, size * 0.95);
  }
}

function drawPage(canvas, rows, geometry, index, total, scale = 1) {
  canvas.width = PAGE_W * scale; canvas.height = PAGE_H * scale;
  const context = canvas.getContext('2d');
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, PAGE_W, PAGE_H);
  context.textAlign = 'center'; context.textBaseline = 'middle';
  const header = headerLayout();
  if (header.hasTitle) {
    context.fillStyle = '#435c49'; context.font = `${header.size}px ${fonts.kai}`; context.textAlign = 'left';
    context.fillText(state.sheetTitle, geometry.left, header.titleY, PAGE_W - geometry.left * 2);
  }
  if (state.showMeta) {
    const metaY = header.metaY;
    context.font = '15px "Microsoft YaHei", sans-serif'; context.fillStyle = '#9ba49b'; context.textAlign = 'left'; context.fillText('姓名：____________', geometry.left, metaY);
    context.textAlign = 'right'; context.fillText('日期：________________', PAGE_W - geometry.left, metaY);
    context.textAlign = 'center';
  }
  for (let rowIndex = 0; rowIndex < geometry.rows; rowIndex++) {
    const y = geometry.top + rowIndex * (geometry.rowHeight + geometry.gap);
    for (let column = 0; column < geometry.columns; column++) drawGrid(context, geometry.left + column * geometry.size, y, geometry);
    (rows[rowIndex] || []).forEach((cell) => drawCell(context, cell, geometry.left + cell.column * geometry.size, y, geometry));
  }
  if (state.showPageNumber) {
    context.font = '12px "Microsoft YaHei", sans-serif'; context.fillStyle = '#b4bdb2'; context.textAlign = 'center';
    context.fillText(`${index + 1} / ${total}`, PAGE_W / 2, PAGE_H - 38);
  }
}

function drawPages() {
  const geometry = getGeometry(), rows = makeRows(geometry);
  markPinyin(rows);
  pages = [];
  for (let start = 0; start < rows.length; start += geometry.rows) pages.push(rows.slice(start, start + geometry.rows));
  pageIndex = Math.min(pageIndex, pages.length - 1); drawPage(paper, pages[pageIndex], geometry, pageIndex, pages.length);
  paper.setAttribute('aria-label', `A4 字帖预览，第 ${pageIndex + 1} 页，共 ${pages.length} 页`);
  $('pageInfo').textContent = `${pageIndex + 1} / ${pages.length}`; $('prevPage').disabled = pageIndex === 0; $('nextPage').disabled = pageIndex === pages.length - 1;
  $('layoutInfo').textContent = `${geometry.columns} 列 × ${geometry.rows} 行`;
  fitPaper();
}

async function render() {
  const version = ++renderVersion;
  if (state.font === 'brush') await ensureBrushFont();
  if (version !== renderVersion) return;
  drawPages();
}

function fitPaper() {
  const viewport = $('paperViewport'), padding = parseFloat(getComputedStyle(viewport).paddingLeft) + parseFloat(getComputedStyle(viewport).paddingRight);
  paperWrap.style.width = Math.round(Math.max(100, viewport.clientWidth - padding) * zoom) + 'px';
  $('zoomValue').textContent = zoom === 1 ? '适应' : Math.round(zoom * 100) + '%';
}

function buildPrintImages() {
  const container = $('printPages'); container.replaceChildren();
  const geometry = getGeometry();
  /* 页数多时降低倍数，避免同时驻留过多位图。 */
  const scale = pages.length <= 8 ? 2 : 1.5;
  pages.forEach((rows, index) => {
    const canvas = document.createElement('canvas');
    drawPage(canvas, rows, geometry, index, pages.length, scale);
    const image = new Image();
    image.src = canvas.toDataURL();
    image.alt = `第 ${index + 1} 页`;
    container.append(image);
  });
  return container;
}

/* ---------------- 事件 ---------------- */

fields.forEach((key) => $(key).addEventListener('input', () => {
  const element = $(key);
  state[key] = element.type === 'checkbox' ? element.checked : numeric.has(key) ? Number(element.value) : element.value;
  if (key === 'content') pageIndex = 0;
  update();
}));
document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => { state.mode = button.dataset.mode; pageIndex = 0; update(); }));
document.querySelectorAll('[data-grid]').forEach((button) => button.addEventListener('click', () => { state.grid = button.dataset.grid; update(); }));
document.querySelectorAll('[data-sample]').forEach((button) => button.addEventListener('click', () => { state.content = samples[button.dataset.sample]; pageIndex = 0; update(); toast(`已载入「${button.textContent.trim()}」`); }));
document.querySelectorAll('[data-palette]').forEach((button) => button.addEventListener('click', () => { [state.traceColor, state.lineColor] = palettes[button.dataset.palette]; update(); }));
document.querySelectorAll('[data-font-source]').forEach((button) => button.addEventListener('click', () => { state.fontSource = button.dataset.fontSource; update(); }));
document.querySelectorAll('[data-cell-type]').forEach((button) => button.addEventListener('click', () => { cellTool = button.dataset.cellType; syncRowControls(); }));
$('rowCells').addEventListener('click', (event) => {
  const button = event.target.closest('[data-column]'); if (!button) return;
  state.rowPattern = getRowPattern(Math.max(MAX_COLUMNS, state.rowPattern?.length || 0));
  state.rowPattern[Number(button.dataset.column)] = cellTool; update();
  $('rowCells').querySelector(`[data-column="${button.dataset.column}"]`).focus({ preventScroll: true });
});
$('demoCount').addEventListener('change', (event) => setRowCount('demo', event.target.value));
$('rowTraceCount').addEventListener('change', (event) => setRowCount('trace', event.target.value));
$('resetRow').addEventListener('click', () => { state.rowPattern = Array.from({ length: MAX_COLUMNS }, (_, column) => column === 0 ? 'demo' : column < 6 ? 'trace' : 'blank'); update(); });
$('clear').addEventListener('click', () => { state.content = ''; pageIndex = 0; update(); $('content').focus(); });
$('clearStrokes').addEventListener('click', () => { state.strokeRows = []; pageIndex = 0; update(); toast('已清空笔画'); });
$('editStrokes').addEventListener('click', openStrokeDialog);
$('reset').addEventListener('click', () => { state = { ...defaults, strokeRows: defaultStrokeRows(), rowPattern: null }; pageIndex = 0; zoom = 1; update(); toast('已恢复默认字帖'); });
$('prevPage').addEventListener('click', () => { if (pageIndex > 0) { pageIndex--; drawPages(); } });
$('nextPage').addEventListener('click', () => { if (pageIndex < pages.length - 1) { pageIndex++; drawPages(); } });
$('zoomOut').addEventListener('click', () => { zoom = Math.max(0.5, Math.round((zoom - 0.1) * 10) / 10); fitPaper(); });
$('zoomIn').addEventListener('click', () => { zoom = Math.min(2, Math.round((zoom + 0.1) * 10) / 10); fitPaper(); });
$('fit').addEventListener('click', () => { zoom = 1; fitPaper(); });

$('download').addEventListener('click', async () => {
  await LocalFonts.ready; await document.fonts.ready; await render();
  const canvas = document.createElement('canvas');
  const geometry = getGeometry();
  drawPage(canvas, pages[pageIndex], geometry, pageIndex, pages.length, 2);
  const link = document.createElement('a');
  link.download = `${(state.sheetTitle || '书间字帖').replace(/[\\/:*?"<>|\s]/g, '')}-${pageIndex + 1}.png`;
  link.href = canvas.toDataURL('image/png'); link.click();
  toast(`已保存第 ${pageIndex + 1} 页图片`);
});

$('print').addEventListener('click', async () => {
  await LocalFonts.ready; await document.fonts.ready; await render();
  const container = buildPrintImages();
  await Promise.all(Array.from(container.children, (image) => image.decode().catch(() => {})));
  window.print();
});

$('strokeSearch').addEventListener('input', (event) => renderLibrary(event.target.value));
$('closeStrokeDialog').addEventListener('click', closeStrokeDialog);
$('cancelStrokes').addEventListener('click', closeStrokeDialog);
$('applyStrokes').addEventListener('click', () => {
  state.strokeRows = draftRows.filter((row) => Strokes.byId(row.id)).map((row) => ({ id: row.id, chars: row.chars }));
  pageIndex = 0; update(); closeStrokeDialog();
});
$('strokeDialog').addEventListener('click', (event) => { if (event.target === $('strokeDialog')) closeStrokeDialog(); });

new ResizeObserver(fitPaper).observe($('paperViewport'));
window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });

buildStrokeSearchIndex();
syncControls(); refreshIcons();
LocalFonts.ready = LocalFonts.init({ getState: () => state, fonts, update, refresh: syncControls });
LocalFonts.ready.then(() => { syncControls(); render(); });
render();
