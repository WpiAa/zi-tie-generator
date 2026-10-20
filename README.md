# 书间 · 字帖

清新古风的个人字帖工具，纯静态网页，可直接部署到 GitHub Pages，无需安装依赖或构建。

## 功能

- 汉字、词句、段落、笔画四种模式，自动分页。
- 米字格、田字格、回米格、方格；调整格子、行距、页边距和字体。
- 带声调拼音、首字加深、描红数量与颜色、插入空行和空列。
- 汉字模式独立设置每行示范字和描红字数量，并逐格指定示范、描红或留白；行布局自动保存，应用于所有汉字。
- 读取本机已安装字体，或导入 TTF、OTF、WOFF、WOFF2 字体文件；选过的本机字体缓存在浏览器中，刷新自动恢复。
- 自定义题签、姓名日期栏，自动保存本机设置。
- A4 全文打印或通过浏览器保存为 PDF；当前页导出 PNG。

## GitHub Pages

1. 将本目录文件推送到 GitHub 仓库。
2. 打开仓库 **Settings → Pages**。
3. 在 **Build and deployment** 中选择 **Deploy from a branch**，选择你的分支与 **/(root)**，保存。
4. 等待部署完成后访问 `https://你的用户名.github.io/仓库名/`。仓库名若为 `你的用户名.github.io`，访问域名根路径即可。

资源使用相对路径，兼容项目子路径。也可直接打开 `index.html` 使用；推荐通过静态服务器预览，例如 `python -m http.server 8080`。

## 资源与隐私

内容与设置仅保存在本机浏览器，不上传。笔画模式会向 jsDelivr 请求所用汉字的笔顺 JSON，成功后缓存到本机；首次加载需联网，未获取到的字回退到普通描红。拼音由上下文自动推断，多音字仍需自行核对。

- [pinyin-pro](https://github.com/zh-lx/pinyin-pro)：MIT，提供拼音。
- [Lucide](https://lucide.dev/)：ISC，提供图标。
- [Ma Shan Zheng](https://github.com/google/fonts/tree/main/ofl/mashanzheng)：SIL Open Font License 1.1，提供毛笔字体。
- [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data)：汉字笔顺数据源自 Make Me a Hanzi，依其 Arphic Public License 使用。

楷体优先使用系统 KaiTi / STKaiti，没有时使用随附毛笔字体。不同系统的宋体、黑体外观可能略有差异。打印选择 A4、100% 缩放并关闭浏览器页眉页脚；应用自带完整页边距。

读取已安装字体需要桌面 Chrome / Edge，通过 HTTPS（包括 GitHub Pages）或 localhost 访问，并在点击后允许浏览器的字体访问请求。不支持该接口或不授予权限时，仍可导入字体文件。字体文件仅保存在当前浏览器的 IndexedDB 中，不上传；清除站点数据会移除字体缓存。笔画分解字形取自笔顺数据，不随所选字体改变。

汉字模式的“每行字样”中，数量输入会保留另一类字的现有位置，并使用空白格增减数量；数量上限取决于当前行剩余格数。选择“示范 / 描红 / 留白”后点击带编号的格子，可精确修改该位置；编号与纸上从左到右的格子一一对应。调整方格大小或页边距后，超出当前列数的位置会暂时隐藏，恢复列数时仍保留。汉字模式的空列由逐格留白设置，其他模式保留原来的空列与描红选项。
