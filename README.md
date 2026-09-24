# CMU 3D · 卡内基梅隆大学校园漫游

一个可以在浏览器里自由探索的 **卡内基梅隆大学（Carnegie Mellon University）匹兹堡主校区 3D 复刻**。
建筑轮廓、道路、步道、草坪和树木来自 OpenStreetMap 真实数据，地形来自真实高程（DEM），
哈默施拉格楼、贝克楼、美术学院、亨特图书馆、韦恩楼、盖茨中心、科翁大学中心（CUC）、泰珀广场、CIC、史密斯楼、INI、
彩绘围栏（The Fence）、学习大教堂等 40 余座地标参照实景照片逐个手工建模。

> 非官方爱好者作品，与卡内基梅隆大学无关。

## 打开方式

**直接双击 `index.html` 即可**（Chrome / Edge / Firefox 均可；需要支持 WebGL2 的显卡）。

也可以双击 **`start-preview.bat`**（自动启动本地服务器并打开浏览器，关闭窗口即停止），或在终端里起一个本地服务器：

```bash
node tools/serve.mjs
```

然后访问 http://localhost:5173 。

## 操作

| 模式 | 操作 |
|---|---|
| 俯瞰（1） | 左键拖动旋转 · 右键拖动平移 · 滚轮缩放 · 双击飞到该处 |
| 步行（2） | 点击画面锁定鼠标 · WASD / 方向键移动 · Shift 奔跑 · 空格跳跃 · Esc 退出 |
| 飞行（3） | WASD 移动 · E / Q 升降 · 拖动鼠标转向 · 滚轮调速度 |

快捷键：`/` 或 `F` 搜索 · `M` 小地图 · `T` 导览 · `L` 标签 · `N` 昼夜切换 · `H` 帮助 · `Esc` 关闭面板。
手机 / 平板：单指旋转、双指缩放；步行模式有虚拟摇杆。

点击任何建筑或地标可查看介绍（中英文名称、建成年代、建筑师、用途、趣闻），并可“飞过去”或“步行到这里”。
主要道路（福布斯大道、第五大道、克雷格街……）有中英文路名标注，路口有路牌；克雷格街等处的商店和餐馆有真实店名招牌。
左下角可以调节一天中的时间、开启延时摄影、切换春夏秋冬（秋季有红叶，冬季会下雪）。

URL 参数：`?q=low|medium|high`（画质）· `?hours=18.5`（时间）· `?season=winter` · `?tour`（加载后自动导览）·
`?cam=x,y,z&look=x,y,z`（指定视角，分享链接会自动生成）· `?debug`（显示帧率）· `?noui`（隐藏界面）。

## 目录

```
index.html            入口
css/styles.css        界面样式
dist/app.js           打包后的程序（npm run build 生成）
data/campus.js        校园数据（由 OSM + 高程生成）
data/info.js          中文介绍与导览脚本
data/curated/         人工校订的建筑高度 / 风格 / 颜色
src/                  源代码（three.js，ES 模块）
tools/                数据生成、截图测试、静态服务器
ARCHITECTURE.md       模块划分与接口约定
```

## 重新构建

```bash
npm install
npm run data     # 从 data/raw 的 OSM 与高程瓦片重新生成 data/campus.js
npm run build    # 打包 src → dist/app.js
```

## 数据来源与许可

- 地图数据 © OpenStreetMap 贡献者，遵循 ODbL 许可。
- 高程：AWS Terrain Tiles（Mapzen / USGS 3DEP 等）。
- 3D 引擎：three.js（MIT）。
- 所有纹理均在运行时用 Canvas 程序化绘制，没有使用任何照片或第三方模型。
