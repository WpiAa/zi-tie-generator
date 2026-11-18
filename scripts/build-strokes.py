#!/usr/bin/env python3
"""生成 stroke-glyphs.js —— 27 个基本笔画的真实字形数据。

数据来源：hanzi-writer-data（npm），上游为 makemeahanzi，字形取自文鼎（Arphic）
公开授权字体，见 assets/licenses/ARPHICPL.TXT。

每个笔画并不来自"笔画图库"（makemeahanzi 没有这种数据），而是从含有该笔画的
汉字中按笔序索引取出：例如 横折 = 口 的第 2 笔。脚本只做三件事：
  1) 下载/缓存宿主字 JSON
  2) 采样 path 求包围盒，算出中心点（渲染时按 em 原比例居中，不缩放）
  3) 输出 { id, name, chars, group, d, cx, cy, gain }

用法：
    python scripts/build-strokes.py            # 使用缓存，缺失则下载
    python scripts/build-strokes.py --refresh  # 强制重新下载
"""

import json
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / ".stroke-cache"
OUT = ROOT / "stroke-glyphs.js"
CDN = "https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/"

# id, 名称, 字例, 分组, 宿主字, 笔序索引(0 起), gain
STROKES = [
    ("heng", "横", "一二三上下", "基本笔画", "一", 0, 1.0),
    ("duanheng", "短横", "二工土士", "基本笔画", "二", 0, 1.15),
    ("shu", "竖", "十干王中", "基本笔画", "丨", 0, 1.0),
    ("xuanzhenshu", "悬针竖", "年半丰平", "基本笔画", "十", 1, 1.0),
    ("pie", "撇", "人天大白", "基本笔画", "丿", 0, 1.1),
    ("duanpie", "短撇", "千白向禾", "基本笔画", "千", 0, 1.15),
    ("na", "捺", "人大木天", "基本笔画", "人", 1, 1.3),
    ("dian", "点", "小心主六", "基本笔画", "丶", 0, 1.7),
    ("ti", "提", "打地江冰", "基本笔画", "打", 2, 1.45),
    ("hengzhe", "横折", "口日田目", "折画", "口", 1, 1.3),
    ("shuzhe", "竖折", "山出画断", "折画", "山", 1, 1.2),
    ("piezhe", "撇折", "云去台么", "折画", "云", 2, 1.3),
    ("hengpie", "横撇", "又夕名多", "折画", "又", 0, 1.15),
    ("shuwan", "竖弯", "四西匹洒", "折画", "四", 3, 1.8),
    ("hengzhezhepie", "横折折撇", "及建延", "折画", "及", 1, 1.1),
    ("piedian", "撇点", "女好妈如", "折画", "女", 0, 1.0),
    ("shugou", "竖钩", "小水手寸", "钩画", "亅", 0, 1.0),
    ("wangou", "弯钩", "子手了承", "钩画", "犭", 1, 1.1),
    ("xiegou", "斜钩", "戈我找成", "钩画", "戈", 1, 1.0),
    ("wogou", "卧钩", "心必思志", "钩画", "心", 1, 1.3),
    ("henggou", "横钩", "宝写军买", "钩画", "写", 1, 1.25),
    ("shuti", "竖提", "良长衣农", "钩画", "长", 2, 1.02),
    ("shuwangou", "竖弯钩", "儿元见也", "钩画", "乚", 0, 1.05),
    ("hengzhegou", "横折钩", "月用习同", "钩画", "月", 1, 1.0),
    ("hengzhewangou", "横折弯钩", "九几凡飞", "钩画", "乙", 0, 1.05),
    ("shuzhezhnegou", "竖折折钩", "马与鸟写", "钩画", "马", 1, 1.1),
    ("hengzheti", "横折提", "话计认识", "钩画", "说", 1, 1.5),
]


def download(url):
    """优先 urllib；部分环境 SSL 不可用时退回 curl，网络抖动重试三次。"""
    last = None
    for _ in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                return json.load(response)
        except Exception as error:
            last = error
        try:
            output = subprocess.run(
                ["curl", "-sL", "--max-time", "40", "--retry", "2", url],
                capture_output=True, check=True,
            ).stdout
            return json.loads(output.decode("utf-8"))
        except Exception as error:
            last = error
    raise SystemExit(f"下载失败 {url}\n{last}")


def fetch(char, refresh=False):
    path = CACHE / f"{char}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    data = download(CDN + urllib.parse.quote(char) + ".json")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def parse(path):
    """把 SVG path 拆成子路径点列（曲线按固定步数加密），用于求包围盒。"""
    tokens, number = [], ""
    for char in path:
        if char.isdigit() or char in "-.":
            number += char
        else:
            if number:
                tokens.append(float(number))
                number = ""
            if char.isalpha():
                tokens.append(char)
    if number:
        tokens.append(float(number))

    subpaths, current, start, i, command = [], [], None, 0, None
    while i < len(tokens):
        token = tokens[i]
        if isinstance(token, str):
            command = token
            i += 1
            if command in "Zz":
                if current:
                    subpaths.append(current)
                current, start = [], start or (0, 0)
            continue
        if command in "Mm":
            x, y = tokens[i], tokens[i + 1]
            i += 2
            if current:
                subpaths.append(current)
            current = [(x, y)]
            start = (x, y)
            command = "L" if command == "M" else "l"
        elif command in "Ll":
            x, y = tokens[i], tokens[i + 1]
            i += 2
            current.append((x, y))
        elif command in "Qq":
            cx, cy, x, y = tokens[i:i + 4]
            i += 4
            x0, y0 = current[-1]
            for step in range(1, 17):
                t = step / 16
                u = 1 - t
                current.append((u * u * x0 + 2 * u * t * cx + t * t * x,
                                u * u * y0 + 2 * u * t * cy + t * t * y))
        elif command in "Cc":
            c1x, c1y, c2x, c2y, x, y = tokens[i:i + 6]
            i += 6
            x0, y0 = current[-1]
            for step in range(1, 25):
                t = step / 24
                u = 1 - t
                current.append((
                    u ** 3 * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t ** 3 * x,
                    u ** 3 * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t ** 3 * y,
                ))
        else:
            i += 1
    if current:
        subpaths.append(current)
    return subpaths


def bbox(path):
    points = [point for sub in parse(path) for point in sub]
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def round_half(value):
    return round(value * 2) / 2


def main():
    refresh = "--refresh" in sys.argv
    cache, groups = {}, {}
    rows = []
    for sid, name, chars, group, host, index, gain in STROKES:
        if host not in cache:
            cache[host] = fetch(host, refresh)
        data = cache[host]
        strokes = data["strokes"]
        if index >= len(strokes):
            raise SystemExit(f"{name}: {host} 只有 {len(strokes)} 笔，取不到第 {index + 1} 笔")
        d = strokes[index]
        x0, y0, x1, y1 = bbox(d)
        rows.append({
            "id": sid, "name": name, "chars": chars, "group": group,
            "d": d,
            "cx": round_half((x0 + x1) / 2), "cy": round_half((y0 + y1) / 2),
            "gain": gain,
        })
        groups.setdefault(group, len(groups))

    lines = [
        "'use strict';",
        "/* 由 scripts/build-strokes.py 生成，请勿手改。",
        "   字形数据来自 makemeahanzi（上游字体：文鼎 Arphic，Arphic Public License），",
        "   经 hanzi-writer-data 分发；许可全文见 assets/licenses/ARPHICPL.TXT。",
        "   d 为笔画的闭合轮廓（1024 em 方框，y 轴向上，原点在基线中心），",
        "   cx/cy 为该笔包围盒中心，渲染时按 em 原比例居中。 */",
        "(function () {",
        "  window.STROKE_GLYPHS = [",
    ]
    for row in rows:
        lines.append("    {")
        lines.append(f"      id: {json.dumps(row['id'])},")
        lines.append(f"      name: {json.dumps(row['name'], ensure_ascii=False)},")
        lines.append(f"      chars: {json.dumps(row['chars'], ensure_ascii=False)},")
        lines.append(f"      group: {json.dumps(row['group'], ensure_ascii=False)},")
        lines.append(f"      d: {json.dumps(row['d'])},")
        lines.append(f"      cx: {row['cx']}, cy: {row['cy']}, gain: {row['gain']}")
        lines.append("    },")
    lines.append("  ];")
    lines.append("})();")
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")

    size = OUT.stat().st_size
    print(f"已生成 {OUT.name}：{len(rows)} 个笔画，{size / 1024:.1f} KB")
    print("宿主字：", " ".join(f"{name}←{host}[{index + 1}]" for _, name, _, _, host, index, _ in STROKES))


if __name__ == "__main__":
    main()
