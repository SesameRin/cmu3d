# CMU 3D

卡内基梅隆大学（Carnegie Mellon University）匹兹堡校区的交互式三维复刻，基于 three.js，在浏览器中运行。

**在线访问：<https://sesamerin.github.io/cmu3d/>**

> 非官方爱好者项目，与卡内基梅隆大学无关。

## 功能

- **真实地理数据**：建筑轮廓、道路、步道、绿地与树木取自 OpenStreetMap，地形取自真实高程数据。
- **地标建模**：参照实景照片手工建模 40 余座建筑与地标，包括 Hamerschlag Hall、Hunt Library、Wean Hall、Gates-Hillman Center、Cohon University Center、Tepper Quad 与 The Fence 等。
- **三种浏览模式**：俯瞰、第一人称步行（含碰撞检测与地形跟随）、自由飞行。
- **导航与信息**：建筑介绍面板、搜索、小地图、15 站导览，以及中英文路名标注与路口路牌。
- **动态环境**：基于真实太阳轨迹的昼夜变化，支持四季与天气切换及夜间照明。
- **自适应画质**：提供低 / 中 / 高三档，按设备性能自动选择，并支持移动端触控。

## 运行

| 方式 | 说明 |
|---|---|
| 直接打开 | 双击 `index.html`，无需服务器 |
| 本地服务器 | 执行 `npm run serve` 或双击 `start-preview.bat`，然后访问 <http://localhost:5173> |

需使用支持 WebGL 2 的现代浏览器（Chrome、Edge、Firefox 或 Safari）。

## 操作

| 模式 | 操作 |
|---|---|
| 俯瞰 `1` | 左键拖动旋转，右键拖动平移，滚轮缩放，双击飞往该处 |
| 步行 `2` | 点击画面锁定鼠标；`WASD` / 方向键移动，`Shift` 奔跑，`Space` 跳跃，`Esc` 退出 |
| 飞行 `3` | `WASD` 移动，`E` / `Q` 升降，拖动鼠标转向，滚轮调整速度 |

快捷键：`/` 或 `F` 搜索 · `M` 小地图 · `T` 导览 · `L` 标签 · `N` 昼夜切换 · `H` 帮助 · `Esc` 关闭面板。
移动端：单指旋转，双指缩放；步行模式使用虚拟摇杆。

## URL 参数

| 参数 | 说明 |
|---|---|
| `q=low\|medium\|high` | 画质等级 |
| `hours=18.5` | 一天中的时间（0–24） |
| `season=spring\|summer\|autumn\|winter` | 季节 |
| `weather=clear\|partly\|cloudy\|overcast\|snow` | 天气 |
| `tour` | 加载完成后自动开始导览 |
| `cam=x,y,z&look=x,y,z[&mode=walk\|fly]` | 指定视角（分享链接自动生成） |
| `debug` / `noui` | 显示性能信息 / 隐藏界面 |

## 开发

```bash
npm install
npm run data    # 由 data/raw 中的 OSM 数据与高程瓦片生成 data/campus.js
npm run build   # 打包 src/ 至 dist/app.js
npm run dev     # 监听源码并自动重新打包
```

模块划分、坐标系与接口约定见 [ARCHITECTURE.md](ARCHITECTURE.md)。

```
index.html        页面入口
css/              界面样式
dist/app.js       构建产物
data/campus.js    生成的校园数据
data/info.js      中文介绍与导览内容
data/curated/     人工校订的建筑属性
src/              源代码（core · world · landmarks · controls · ui）
tools/            数据生成、截图测试与本地服务器
```

## 数据来源与致谢

- 地图数据 © [OpenStreetMap](https://www.openstreetmap.org/copyright) 贡献者，采用 ODbL 许可。
- 高程数据：[AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)（Mapzen，含 USGS 3DEP 等来源）。
- 渲染引擎：[three.js](https://threejs.org/)（MIT 许可）。
- 全部纹理均在运行时程序化生成，未使用照片或第三方模型。
