import json
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1100}, device_scale_factor=1)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:8080")
    page.wait_for_function("document.querySelector('#paper').width === 1260")
    page.evaluate("document.fonts.ready")
    assert not page.locator("#fontPicker").is_visible()
    page.locator("#fontPickerTrigger").click()
    assert page.locator("#fontPicker").is_visible()
    page.locator("#font").select_option("brush")
    assert not page.locator("#fontPicker").is_visible()
    assert page.locator("#selectedFontName").inner_text() == "毛笔楷书"
    page.locator("#fontPickerTrigger").click()
    page.keyboard.press("Escape")
    assert not page.locator("#fontPicker").is_visible()
    page.locator("#fontPickerTrigger").click()
    page.locator("#modeTitle").click()
    assert not page.locator("#fontPicker").is_visible()
    page.locator("#reset").click()
    page.wait_for_timeout(250)
    page.screenshot(path=str(Path(tempfile.gettempdir()) / "shujian-desktop.png"), full_page=True)
    assert page.locator("#pageInfo").inner_text() == "1 / 2"
    page.locator("#nextPage").click()
    assert page.locator("#pageInfo").inner_text() == "2 / 2"
    page.locator('[data-mode="words"]').click()
    page.wait_for_timeout(250)
    assert page.locator("#pageInfo").inner_text() == "1 / 1"
    page.locator('[data-mode="paragraph"]').click()
    page.locator("#content").fill("床前明月光，疑是地上霜。\n举头望明月，低头思故乡。")
    page.locator('[data-grid="hui"]').click()
    page.locator("#blankRow").check()
    page.wait_for_timeout(250)
    page.reload()
    assert page.locator("#blankRow").is_checked()
    assert page.locator('[data-grid="hui"]').get_attribute("aria-pressed") == "true"
    with page.expect_download() as download:
        page.locator("#download").click()
    assert download.value.suggested_filename.endswith(".png")
    page.evaluate("window.print = () => { window.printCalled = true; }")
    page.locator("#print").click()
    page.wait_for_function("window.printCalled === true")
    assert page.locator("#printPages img").count() > 0
    page.emulate_media(media="print")
    page.pdf(path=str(Path(tempfile.gettempdir()) / "shujian.pdf"), prefer_css_page_size=True)
    page.emulate_media(media="screen")
    page.locator("#content").fill("一二")
    page.locator('[data-mode="strokes"]').click()
    page.wait_for_function("strokeCache.get('二')?.strokes?.length === 2", timeout=30000)
    page.wait_for_timeout(300)
    assert page.evaluate("makeRows(getGeometry()).some(row => row.some(cell => cell.strokes))")
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
    assert page.evaluate("makeRows(getGeometry())[0].some(cell => cell.column === 9 && !cell.dark)")
    assert page.evaluate("!makeRows(getGeometry())[0].some(cell => cell.column === 0)")
    page.locator("#cellSize").fill("25")
    assert page.locator("#rowCells button").count() == 6
    page.locator("#cellSize").fill("15")
    assert page.locator('#rowCells [data-column="10"]').get_attribute("data-type") == "demo"
    page.reload()
    assert page.locator('#rowCells [data-column="10"]').get_attribute("data-type") == "demo"
    page.locator("#fontPickerTrigger").click()
    page.locator('[data-font-source="local"]').click()
    page.locator("#fontFile").set_input_files(str(Path(__file__).resolve().parents[1] / "assets/fonts/MaShanZheng-Regular.ttf"))
    page.wait_for_function("state.font.startsWith('local:file:') && document.fonts.check('30px ShujianLocal0')")
    selected_font = page.evaluate("state.font")
    page.reload()
    page.wait_for_function("savedFonts.size === 1 && fonts[state.font]")
    assert page.evaluate("state.font") == selected_font
    assert page.locator("#localFont").input_value() == selected_font
    page.locator("#fontPickerTrigger").click()
    page.locator("#fontSearch").fill("  mashanzheng  ")
    assert page.locator("#localFont option:not([disabled])").count() == 1
    assert page.locator("#localFont").input_value() == selected_font
    page.locator("#fontSearch").fill("不存在的字体-xyz")
    assert page.locator("#localFont option:not([disabled])").count() == 0
    assert page.locator("#fontMatches").inner_text() == "找到 0 / 1 款字体"
    assert page.evaluate("state.font") == selected_font
    page.locator("#fontSearch").fill("")
    assert page.locator("#localFont").input_value() == selected_font
    with page.expect_download() as custom_download:
        page.locator("#download").click()
    assert custom_download.value.suggested_filename.endswith(".png")
    page.locator("#fontFile").set_input_files({"name": "broken.ttf", "mimeType": "font/ttf", "buffer": b"not a font"})
    page.wait_for_function("document.querySelector('#fontStatus').textContent.includes('字体文件无法载入')")
    assert page.evaluate("state.font") == selected_font
    session = browser.new_browser_cdp_session()
    context_id = session.send("Target.getBrowserContexts")["browserContextIds"][0]
    session.send("Browser.setPermission", {"permission": {"name": "local-fonts"}, "setting": "granted", "origin": "http://127.0.0.1:8080", "browserContextId": context_id})
    page.locator("#fontPickerTrigger").click()
    page.locator("#scanFonts").click()
    page.wait_for_function("installedFonts.size > 0")
    installed_id = page.evaluate("installedFonts.keys().next().value")
    search_name = page.evaluate("installedFonts.values().next().value.fullName.toUpperCase()")
    page.locator("#fontSearch").fill(search_name)
    assert page.locator("#localFont option:not([disabled])").count() > 0
    page.locator("#localFont").select_option(installed_id)
    page.wait_for_function("state.font.startsWith('local:system:') && savedFonts.has(state.font)")
    assert not page.locator("#fontPicker").is_visible()
    page.reload()
    page.wait_for_function("savedFonts.has(state.font)")
    assert page.evaluate("state.font") == installed_id
    page.locator("#reset").click()
    page.wait_for_timeout(250)
    for width in [390, 768, 1024, 1440]:
        page.set_viewport_size({"width": width, "height": 900})
        page.wait_for_timeout(200)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"overflow at {width}"
        page.locator("#fontPickerTrigger").click()
        page.wait_for_timeout(100)
        bounds = page.locator("#fontPicker").bounding_box()
        assert bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= width
        assert bounds["y"] >= 0 and bounds["y"] + bounds["height"] <= 900
        page.keyboard.press("Escape")
        assert page.evaluate("Array.from(document.querySelector('#paper').getContext('2d').getImageData(0,0,1260,1782).data).some((value,index) => index % 4 !== 3 && value < 150)")
        if width == 390:
            page.screenshot(path=str(Path(tempfile.gettempdir()) / "shujian-mobile.png"), full_page=True)
    assert not errors, errors
    browser.close()
    print(json.dumps({"result": "PASS", "checks": ["four modes", "pagination", "persistence", "PNG", "print/PDF", "stroke data", "row counts and individual positions", "row resize and restore", "font file import/export/restore", "font search/case/empty results/selection retention", "invalid font fallback", "installed font access and restore", "canvas pixels", "responsive 390/768/1024/1440", "no JS errors"]}))
