'use strict';
const savedFonts = new Map();
const installedFonts = new Map();
let fontDatabase;

function positionFontPicker() {
  const panel = document.getElementById('fontPicker');
  if (!panel.matches(':popover-open')) return;
  const trigger = document.getElementById('fontPickerTrigger').getBoundingClientRect();
  const width = Math.min(300, window.innerWidth - 24);
  const above = trigger.top - 20, below = window.innerHeight - trigger.bottom - 20;
  const openAbove = above > below;
  panel.style.width = width + 'px';
  panel.style.maxHeight = Math.max(100, Math.min(560, openAbove ? above : below)) + 'px';
  panel.style.left = Math.max(12, Math.min(trigger.right - width, window.innerWidth - width - 12)) + 'px';
  panel.style.top = (openAbove ? Math.max(12, trigger.top - panel.offsetHeight - 8) : trigger.bottom + 8) + 'px';
}

function closeFontPicker() {
  const panel = document.getElementById('fontPicker');
  if (!panel.matches(':popover-open')) return;
  panel.hidePopover();
  document.getElementById('fontPickerTrigger').focus({ preventScroll: true });
}

document.getElementById('fontPicker').addEventListener('toggle', (event) => {
  document.getElementById('fontPickerTrigger').setAttribute('aria-expanded', String(event.newState === 'open'));
  if (event.newState === 'open') positionFontPicker();
});
new ResizeObserver(positionFontPicker).observe(document.getElementById('fontPicker'));
window.addEventListener('resize', positionFontPicker);
document.addEventListener('scroll', positionFontPicker, true);
document.getElementById('font').addEventListener('change', closeFontPicker);

function openFontDatabase() {
  if (!fontDatabase) fontDatabase = new Promise((resolve, reject) => {
    const request = indexedDB.open('shujian-fonts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('fonts', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return fontDatabase;
}

async function fontStorage(record) {
  const database = await openFontDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('fonts', record ? 'readwrite' : 'readonly');
    const store = transaction.objectStore('fonts');
    const request = record ? store.put(record) : store.getAll();
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function registerLocalFont(record) {
  if (savedFonts.has(record.id)) return;
  const family = 'ShujianLocal' + savedFonts.size;
  const face = new FontFace(family, record.data);
  await face.load();
  document.fonts.add(face);
  fonts[record.id] = `"${family}", ${fonts.kai}`;
  savedFonts.set(record.id, record);
}

function refreshLocalFonts() {
  const choices = new Map();
  installedFonts.forEach((font, id) => choices.set(id, font.fullName));
  savedFonts.forEach((font, id) => choices.set(id, font.label));
  const query = $('fontSearch').value.trim().normalize('NFKC').toLocaleLowerCase();
  const matches = [...choices].filter(([id, name]) => {
    const installed = installedFonts.get(id);
    return [name, installed?.family, installed?.postscriptName].filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase().includes(query);
  }).sort((first, second) => first[1].localeCompare(second[1], 'zh-CN'));
  const placeholder = new Option(matches.length ? '选择字体' : choices.size ? '没有匹配的字体' : '尚未载入字体', '');
  placeholder.disabled = true;
  const options = [placeholder];
  matches.forEach(([id, name]) => options.push(new Option(name, id)));
  $('localFont').replaceChildren(...options);
  $('localFont').value = matches.some(([id]) => id === state.font) ? state.font : '';
  $('fontMatches').textContent = query ? `找到 ${matches.length} / ${choices.size} 款字体` : `共 ${choices.size} 款字体`;
}

document.getElementById('fontSearch').addEventListener('input', refreshLocalFonts);

async function useLocalFont(record) {
  await registerLocalFont(record);
  let cached = true;
  try { await fontStorage(record); } catch { cached = false; }
  state.font = record.id; state.fontSource = 'local';
  refreshLocalFonts(); update();
  $('fontStatus').textContent = record.label + (cached ? ' · 已保存在本机' : ' · 本次可用，浏览器未允许缓存');
  closeFontPicker();
}

async function restoreLocalFonts() {
  if (!window.queryLocalFonts || !window.isSecureContext) {
    $('scanFonts').disabled = true;
    $('scanFonts').title = '读取已安装字体需要桌面 Chrome / Edge 和 HTTPS 或 localhost';
    $('fontStatus').textContent = '此浏览器可通过导入字体文件加载';
  }
  try {
    const records = await fontStorage();
    for (const record of records) {
      try { await registerLocalFont(record); } catch {}
    }
    refreshLocalFonts();
    if (savedFonts.has(state.font)) $('fontStatus').textContent = savedFonts.get(state.font).label + ' · 已从本机恢复';
  } catch {}
  if (state.font.startsWith('local:') && !fonts[state.font]) {
    state.font = 'kai';
    $('fontStatus').textContent = '上次的字体未能恢复，请重新选择或导入';
  }
  syncControls(); render();
}

document.getElementById('scanFonts').addEventListener('click', async () => {
  const button = document.getElementById('scanFonts'); button.disabled = true;
  try {
    const available = await window.queryLocalFonts();
    installedFonts.clear();
    available.forEach((font) => installedFonts.set('local:system:' + font.postscriptName, font));
    refreshLocalFonts();
    $('fontStatus').textContent = `已读取 ${available.length} 款本机字体`;
  } catch (error) {
    $('fontStatus').textContent = error.name === 'NotAllowedError' ? '未获得字体访问权限，可改为导入字体文件' : '未能读取本机字体，可改为导入字体文件';
  } finally { button.disabled = false; }
});

document.getElementById('localFont').addEventListener('change', async (event) => {
  const id = event.target.value;
  if (!id) return;
  event.target.disabled = true;
  try {
    if (savedFonts.has(id)) {
      state.font = id; update(); $('fontStatus').textContent = savedFonts.get(id).label + ' · 已载入';
      closeFontPicker();
    } else {
      const font = installedFonts.get(id);
      $('fontStatus').textContent = '正在载入 ' + font.fullName;
      const data = await (await font.blob()).arrayBuffer();
      await useLocalFont({ id, label: font.fullName, data });
    }
  } catch { $('fontStatus').textContent = '此字体无法载入，请选择其他字体或导入字体文件'; refreshLocalFonts(); }
  finally { event.target.disabled = false; }
});

document.getElementById('importFont').addEventListener('click', () => document.getElementById('fontFile').click());
document.getElementById('fontFile').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file) return;
  const button = $('importFont'); button.disabled = true;
  try {
    await localFontsReady;
    $('fontStatus').textContent = '正在载入 ' + file.name;
    await useLocalFont({ id: 'local:file:' + crypto.randomUUID(), label: file.name.replace(/\.(ttf|otf|woff2?)$/i, ''), data: await file.arrayBuffer() });
  } catch { $('fontStatus').textContent = '字体文件无法载入，请选择有效的 TTF、OTF、WOFF 或 WOFF2 文件'; }
  finally { button.disabled = false; event.target.value = ''; }
});
