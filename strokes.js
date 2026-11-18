'use strict';
/* 笔画字库的渲染层。字形数据在 stroke-glyphs.js（由 scripts/build-strokes.py 生成），
   本文件只负责把 1024 em 方框里的轮廓画进任意尺寸的方格。
   直接填充真实字形轮廓，因此起笔、收笔、折角、出锋都是字库原样；
   长短比例按 em 原比例保留，只按包围盒居中，再用每笔的 gain 微调大小。 */
(function () {
  const BOX = 1024;
  const glyphs = window.STROKE_GLYPHS || [];
  const shapes = new Map();

  function buildGroups() {
    const order = [], map = new Map();
    for (const glyph of glyphs) {
      if (!map.has(glyph.group)) {
        const group = { name: glyph.group, items: [] };
        map.set(glyph.group, group); order.push(group);
      }
      map.get(glyph.group).items.push(glyph);
    }
    return { order, index: new Map(glyphs.map((glyph) => [glyph.id, glyph])) };
  }

  const { order: groups, index } = buildGroups();
  const all = groups.flatMap((group) => group.items);

  function byId(id) { return index.get(id) || null; }

  /* 一次构造 Path2D 并缓存，反复绘制同一个笔画不再解析字符串。 */
  function build(id) {
    if (shapes.has(id)) return shapes.get(id);
    const glyph = byId(id);
    if (!glyph) return null;
    const shape = { glyph, outline: new Path2D(glyph.d) };
    shapes.set(id, shape);
    return shape;
  }

  /* 把上下文变换到该笔画的居中坐标系（y 轴向上翻转到 Canvas 的 y 轴向下）。
     scale 是「笔画占方格边长的比例」，gain 是该笔的形状微调系数。 */
  function paint(context, id, size, color, scale = 0.9) {
    const shape = build(id);
    if (!shape) return;
    const k = (size * scale / BOX) * shape.glyph.gain;
    context.save();
    context.translate(size / 2, size / 2);
    context.scale(k, -k);
    context.translate(-shape.glyph.cx, -shape.glyph.cy);
    context.fillStyle = color;
    context.fill(shape.outline);
    context.restore();
  }

  window.Strokes = { groups, all, byId, paint, BOX };
})();
