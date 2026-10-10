# 项目官网

<!-- Legacy fragments remain entry points after the language split. -->
<a id="arcflow-project-website"></a>
<a id="build-and-check"></a>
<a id="content-and-assets"></a>
<a id="publication"></a>

[English](README.en.md)


<!-- topic:scope -->
中英文静态 GitHub Pages 网站，中文 `/ArcFlow/`，英文 `/ArcFlow/en/`。不包含审批后端、追踪脚本、外部字体、数据收集表单或运行时包依赖。

<!-- topic:build -->
## 构建与检查

开发检查使用 Python 3.9+、Node 22，构建本身只依赖 Python 标准库：

```sh
cd website
python3 scripts/build.py
python3 scripts/check.py
npm ci
npx playwright install --with-deps chromium
npm test
```

`dist/` 为可部署输出，CSS/JS 文件名含内容哈希，避免新旧缓存混用。测试服务器使用真实 `/ArcFlow/` 前缀；浏览器检查双语 320/390/768/1440px、标签与键盘、图片反复开关、语言前进后退、减弱动态、无 JS、图片加载、溢出、控制台及异常第三方请求。

<!-- topic:content -->
## 内容与素材

- 文案在 `content.json`，结构 `scripts/build.py`，样式 `style.css`，渐进增强 `app.js`。
- 展示功能与启动命令固定在 `666ff64b280157e44a86f07a15fcb42f859ec11a`，所有文档入口指向当前 main 的对应语言。PR #39/#40/#41/#42 已合并，不代表老标签 alpha.3 含这些能力。
- 文档导航统一进入分类索引、HTTP 参考与 OpenAPI；须在目标文档合并后再发布更新导航。
- `assets/provenance.json` 保留截图原路径、来源提交、CI 和 SHA-256。十张原图仅含合成数据，不证明当前 CI 或生产就绪。
- `assets/social-card.svg` 是已提交 1200×630 PNG 的可编辑原创矢量来源；修改后用 Inkscape 重建，不伪造产品界面。

<!-- topic:publication -->
## 发布边界

源码在 main，源码修改不等于发布。只将已构建验证的 dist 内容更新到独立 gh-pages 分支根目录。仓库源码、日志、依赖、私有数据和本地证据不得进入公开产物。发布需单独授权，不要求新增 Pages/身份令牌权限、付费服务或自定义域名。

历史初次建站时 Pages 关闭；那是旧检查点，不是当前状态。实际发布设置应实时确认。官方步骤见 [GitHub Pages 分支发布](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。
