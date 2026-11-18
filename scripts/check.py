import json
import sys
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(tempfile.gettempdir())
URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080"


def run():
    checks = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1100}, device_scale_factor=1)
        errors, fonts = [], []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: fonts.append(request.url) if "MaShanZheng" in request.url else None)
        page.goto(URL)
        page.wait_for_function("document.querySelector('#paper').width === 1260")
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(300)
        assert not fonts, "首屏不应加载毛笔字体"

        # 字体选择器
        assert not page.locator("#fontPicker").is_visible()
        page.locator("#fontPickerTrigger").click()
        assert page.locator("#fontPicker").is_visible()
        page.locator("#font").select_option("brush")
        page.wait_for_function("document.fonts.check('30px MaShanZheng')", timeout=15000)
        assert not page.locator("#fontPicker").is_visible()
        assert page.locator("#selectedFontName").inner_text() == "毛笔楷书"
        assert fonts, "选择毛笔楷书后应加载字体"
        page.locator("#fontPickerTrigger").click()
        page.keyboard.press("Escape")
        assert not page.locator("#fontPicker").is_visible()
        page.locator("#fontPickerTrigger").click()
        page.locator("#modeTitle").click()
        assert not page.locator("#fontPicker").is_visible()
        checks.append("字体选择器 / 毛笔字体按需加载")

        # 基础排版与分页
        page.locator("#reset").click()
        page.wait_for_timeout(250)
        assert page.locator("#pageInfo").inner_text() == "1 / 2"
        page.locator("#nextPage").click()
        assert page.locator("#pageInfo").inner_text() == "2 / 2"
        assert page.evaluate("pages[0][0].filter(cell => cell.pinyin).length === 1"), "拼音默认只标示范格"
        page.locator("#pinyinFirst").uncheck()
        page.wait_for_timeout(200)
        assert page.evaluate("pages[0][0].filter(cell => cell.pinyin).length === 6")
        page.locator("#pinyinFirst").check()
        checks.append("分页 / 拼音只标示范格")

        # 顶部题词带 / 左上题签
        assert page.locator(".sample-strip [data-sample]").count() == 4
        page.locator('.sample-strip [data-sample="moon"]').click()
        page.wait_for_timeout(250)
        assert "床前明月光" in page.locator("#content").input_value()
        page.locator("#reset").click()
        page.wait_for_timeout(250)
        base_height = page.evaluate("headerLayout().height")
        page.locator("#titleSize").fill("64")
        page.wait_for_timeout(250)
        assert page.evaluate("headerLayout().height") > base_height + 20, "题签字号应撑开顶部留白"
        title_span = page.evaluate("""() => {
          const canvas = document.querySelector('#paper'), context = canvas.getContext('2d');
          const geometry = getGeometry(), header = headerLayout();
          const y = Math.round(header.titleY);
          const row = context.getImageData(0, y, canvas.width, 1).data;
          let first = -1, last = -1;
          for (let x = 0; x < canvas.width; x++) {
            const i = x * 4;
            if (row[i] < 200 && row[i + 1] < 200) { if (first < 0) first = x; last = x; }
          }
          return { first, last, left: geometry.left, width: canvas.width };
        }""")
        assert abs(title_span["first"] - title_span["left"]) < 24, "题签应左对齐到格子左缘"
        assert title_span["last"] < title_span["width"] * 0.82, "题签不应居中或溢出右侧"
        # 题签为空不应让格子上下跳动，且题签必须真正位于姓名行上方
        filled_top = page.evaluate("getGeometry().top")
        above = page.evaluate("headerLayout().titleY < headerLayout().metaY - 30")
        page.locator("#sheetTitle").fill("")
        page.wait_for_timeout(200)
        assert page.evaluate("getGeometry().top") == filled_top, "清空题签不应移动下方格子"
        assert above, "题签与姓名行之间需留出空隙"
        page.locator("#sheetTitle").fill("一日一字 · 春和景明")
        page.wait_for_timeout(200)
        assert page.evaluate("getGeometry().top") == filled_top, "填写题签不应移动下方格子"
        page.locator("#reset").click()
        page.wait_for_timeout(250)
        assert page.evaluate("state.titleSize") == 40
        checks.append("顶部题词带 / 上方题签 / 字号可变 / 题签留白固定")

        # 四种模式
        page.locator('[data-mode="words"]').click()
        page.wait_for_timeout(250)
        assert page.locator("#pageInfo").inner_text() == "1 / 1"
        page.locator('[data-mode="paragraph"]').click()
        page.locator("#content").fill("床前明月光，疑是地上霜。\n举头望明月，低头思故乡。")
        page.locator('[data-grid="hui"]').click()
        page.locator("#blankRow").check()
        page.wait_for_timeout(300)
        assert page.evaluate("makeRows(getGeometry()).every(row => !row.length || !/^[，。、；：]/.test(row[0].char))"), "标点不应落在行首"
        assert page.evaluate("makeRows(getGeometry()).filter(row => row.some(cell => cell.dark)).length === 2"), "段落模式只加深首字"
        page.reload()
        assert page.locator("#blankRow").is_checked()
        assert page.locator('[data-grid="hui"]').get_attribute("aria-pressed") == "true"
        checks.append("四种模式 / 标点避头尾 / 首字加深 / 设置持久化")

        # 导出与打印
        with page.expect_download() as download:
            page.locator("#download").click()
        assert download.value.suggested_filename.endswith(".png")
        page.evaluate("window.print = () => { window.printCalled = true; }")
        page.locator("#print").click()
        page.wait_for_function("window.printCalled === true")
        assert page.locator("#printPages img").count() > 0
        assert page.evaluate("document.querySelector('#printPages img').naturalWidth === 2520"), "打印应按 2 倍分辨率渲染"
        page.emulate_media(media="print")
        page.pdf(path=str(OUT / "shujian.pdf"), prefer_css_page_size=True)
        page.emulate_media(media="screen")
        checks.append("PNG 导出 / 2 倍打印")

        # 笔画字帖
        page.locator("#reset").click()
        page.wait_for_timeout(200)
        page.locator('[data-mode="strokes"]').click()
        page.wait_for_timeout(250)
        assert page.locator("#strokeSummary li").count() == 3
        assert page.evaluate("makeRows(getGeometry())[0].length === 1 + state.traceCount + 3"), "笔画行结构应为示范 + 描红 + 字例"
        assert page.evaluate("makeRows(getGeometry())[0][0].stroke === 'heng'")
        # 笔画与字例的大小/偏移互不影响
        assert page.locator("#strokeStyleRow").is_visible()
        assert page.locator("#fontSizeLabel").inner_text() == "字例大小"
        assert page.locator("#offsetLabel").inner_text() == "字例偏移"
        page.locator("#strokeSize").fill("60")
        page.locator("#strokeOffset").fill("8")
        page.wait_for_timeout(200)
        assert page.evaluate("state.strokeSize") == 60 and page.evaluate("state.strokeOffset") == 8
        assert page.evaluate("state.fontSize") == 72 and page.evaluate("state.offset") == 0, "笔画设置不应改动字例设置"
        page.locator("#strokeSize").fill("100")
        page.locator("#strokeOffset").fill("0")
        page.wait_for_timeout(150)
        page.locator("#editStrokes").click()
        assert page.locator("#strokeDialog").is_visible()
        assert page.locator("#strokeLibrary .stroke-chip").count() == 27
        # 27 个缩略图必须都真正画出墨迹（曾因悬停动画残留只剩一个点）
        blanks = page.evaluate("""() => [...document.querySelectorAll('#strokeLibrary .stroke-chip canvas')].filter((canvas) => {
          const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          let ink = 0;
          for (let i = 3; i < data.length; i += 4) if (data[i] > 20) ink++;
          const width = canvas.getBoundingClientRect().width;
          return ink < width * width * 0.08;
        }).map((canvas) => canvas.parentElement.textContent.trim())""")
        assert not blanks, f"笔画缩略图应完整渲染：{blanks}"
        # 缩略图是静态的：悬停不应改变像素
        before_pixel = page.evaluate("document.querySelector('#strokeLibrary [data-stroke=\"heng\"] canvas').toDataURL()")
        page.locator('#strokeLibrary [data-stroke="heng"]').hover()
        page.wait_for_timeout(320)
        after_pixel = page.evaluate("document.querySelector('#strokeLibrary [data-stroke=\"heng\"] canvas').toDataURL()")
        assert before_pixel == after_pixel, "笔画缩略图不应有动态效果"
        page.locator("#strokeSearch").fill("heng")
        page.wait_for_timeout(120)
        assert page.locator("#strokeLibrary .stroke-chip").count() == 9
        page.locator("#strokeSearch").fill("hz")
        page.wait_for_timeout(120)
        assert page.locator("#strokeLibrary .stroke-chip").count() == 5
        page.locator("#strokeSearch").fill("不存在的笔画")
        page.wait_for_timeout(120)
        assert page.locator("#strokeLibrary .stroke-chip").count() == 0
        page.locator("#strokeSearch").fill("")
        page.locator('#strokeLibrary [data-stroke="dian"]').click()
        assert page.locator("#strokeRows .stroke-row").count() == 4
        page.locator("#strokeRows .stroke-row").nth(3).locator('[title^="复制本行"]').click()
        assert page.locator("#strokeRows .stroke-row").count() == 5
        page.locator("#strokeRows .stroke-row").nth(0).locator('[title="删除本行"]').click()
        assert page.locator("#strokeRows .stroke-row").count() == 4
        page.locator("#strokeRows .stroke-row").nth(1).locator(".stroke-row-chars").fill("上下大小")
        assert page.evaluate("draftRows[1].chars === '上下大小'")
        page.locator("#cancelStrokes").click()
        assert not page.locator("#strokeDialog").is_visible()
        assert page.evaluate("state.strokeRows.length === 3"), "取消不应写入草稿"
        page.locator("#editStrokes").click()
        page.locator('#strokeRows .stroke-row').nth(1).locator(".stroke-row-chars").fill("上下大小")
        page.locator("#applyStrokes").click()
        page.wait_for_timeout(300)
        assert page.evaluate("state.strokeRows[1].chars") == "上下大小"
        page.reload()
        page.wait_for_function("document.querySelector('#paper').width === 1260")
        assert page.evaluate("state.mode") == "strokes"
        assert page.evaluate("state.strokeRows[1].chars") == "上下大小"
        page.screenshot(path=str(OUT / "shujian-strokes.png"), full_page=True)
        checks.append("笔画字帖 / 检索 / 增删改 / 复制 / 持久化")

        # 汉字模式逐格布局
        page.locator("#reset").click()
        page.wait_for_timeout(250)
        assert page.locator("#demoCount").input_value() == "1"
        assert page.locator("#rowTraceCount").input_value() == "5"
        page.locator("#demoCount").fill("3")
        page.locator("#demoCount").press("Tab")
        page.locator("#rowTraceCount").fill("2")
        page.locator("#rowTraceCount").press("Tab")
        page.locator('[data-cell-type="demo"]').click()
        page.locator('#rowCells [data-column="10"]').click()
        page.locator('[data-cell-type="blank"]').click()
        page.locator('#rowCells [data-column="0"]').click()
        page.locator('[data-cell-type="trace"]').click()
        page.locator('#rowCells [data-column="9"]').click()
        assert page.locator("#demoCount").input_value() == "3"
        assert page.locator("#rowTraceCount").input_value() == "3"
        assert page.evaluate("makeRows(getGeometry())[0].filter(cell => cell.dark).length === 3")
        assert page.evaluate("makeRows(getGeometry())[0].some(cell => cell.column === 10 && cell.dark)")
        assert page.evaluate("!makeRows(getGeometry())[0].some(cell => cell.column === 0)")
        page.locator("#cellSize").fill("25")
        assert page.locator("#rowCells button").count() == 6
        page.locator("#cellSize").fill("15")
        assert page.locator('#rowCells [data-column="10"]').get_attribute("data-type") == "demo"
        page.reload()
        assert page.locator('#rowCells [data-column="10"]').get_attribute("data-type") == "demo"
        checks.append("汉字模式每行字样与逐格编辑")

        # 字体导入与恢复
        page.locator("#reset").click()
        page.wait_for_timeout(200)
        page.locator("#fontPickerTrigger").click()
        page.locator('[data-font-source="local"]').click()
        page.locator("#fontFile").set_input_files(str(ROOT / "assets/fonts/MaShanZheng-Regular.woff2"))
        page.wait_for_function("state.font.startsWith('local:file:') && document.fonts.check('30px ShujianLocal0')")
        selected_font = page.evaluate("state.font")
        page.reload()
        page.wait_for_function("LocalFonts.savedFonts.size === 1 && fonts[state.font]")
        assert page.evaluate("state.font") == selected_font
        assert page.locator("#localFont").input_value() == selected_font
        page.locator("#fontPickerTrigger").click()
        page.locator("#fontSearch").fill("  mashanzheng  ")
        assert page.locator("#localFont option:not([disabled])").count() == 1
        page.locator("#fontSearch").fill("不存在的字体-xyz")
        assert page.locator("#localFont option:not([disabled])").count() == 0
        assert page.locator("#fontMatches").inner_text() == "找到 0 / 1 款字体"
        page.locator("#fontSearch").fill("")
        page.locator("#fontFile").set_input_files({"name": "broken.ttf", "mimeType": "font/ttf", "buffer": b"not a font"})
        page.wait_for_function("document.querySelector('#fontStatus').textContent.includes('字体文件无法载入')")
        assert page.evaluate("state.font") == selected_font
        checks.append("字体文件导入 / 恢复 / 搜索 / 非法文件回退")

        # 本机字体
        session = browser.new_browser_cdp_session()
        context_id = session.send("Target.getBrowserContexts")["browserContextIds"][0]
        session.send("Browser.setPermission", {"permission": {"name": "local-fonts"}, "setting": "granted", "origin": URL, "browserContextId": context_id})
        if not page.locator("#fontPicker").is_visible():
            page.locator("#fontPickerTrigger").click()
        page.locator("#scanFonts").click()
        page.wait_for_function("LocalFonts.installedFonts.size > 0")
        installed_id = page.evaluate("LocalFonts.installedFonts.keys().next().value")
        search_name = page.evaluate("LocalFonts.installedFonts.values().next().value.fullName.toUpperCase()")
        page.locator("#fontSearch").fill(search_name)
        assert page.locator("#localFont option:not([disabled])").count() > 0
        page.locator("#localFont").select_option(installed_id)
        page.wait_for_function("state.font.startsWith('local:system:') && LocalFonts.savedFonts.has(state.font)")
        page.wait_for_function("!document.querySelector('#fontPicker').matches(':popover-open')")
        page.reload()
        page.wait_for_function("LocalFonts.savedFonts.has(state.font)")
        assert page.evaluate("state.font") == installed_id
        checks.append("本机字体读取 / 恢复")

        # 响应式
        page.locator("#reset").click()
        page.wait_for_timeout(250)
        for width in [390, 768, 1024, 1440]:
            page.set_viewport_size({"width": width, "height": 900})
            page.wait_for_timeout(220)
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"overflow at {width}"
            page.locator("#fontPickerTrigger").click()
            page.wait_for_timeout(120)
            bounds = page.locator("#fontPicker").bounding_box()
            assert bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= width
            assert bounds["y"] >= 0 and bounds["y"] + bounds["height"] <= 900
            page.keyboard.press("Escape")
            assert page.evaluate("Array.from(document.querySelector('#paper').getContext('2d').getImageData(0,0,1260,1782).data).some((value,index) => index % 4 !== 3 && value < 150)")
            if width == 390:
                page.locator('[data-mode="strokes"]').click()
                page.locator("#editStrokes").click()
                page.wait_for_timeout(300)
                dialog = page.locator("#strokeDialog").bounding_box()
                assert dialog["x"] >= 0 and dialog["x"] + dialog["width"] <= width
                page.locator("#closeStrokeDialog").click()
                page.screenshot(path=str(OUT / "shujian-mobile.png"), full_page=True)
        page.screenshot(path=str(OUT / "shujian-desktop.png"), full_page=True)
        checks.append("响应式 390 / 768 / 1024 / 1440")

        assert not errors, errors
        browser.close()
    print(json.dumps({"result": "PASS", "checks": checks}, ensure_ascii=False))


run()
