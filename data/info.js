/*
 * CMU 3D — knowledge layer (window.CAMPUS_INFO)
 * ---------------------------------------------------------------------------------------------
 * Bilingual (Simplified Chinese first) descriptions for the info panel, search and guided tour.
 * Schema: ARCHITECTURE.md §"Info data". Loaded by a classic <script> tag (file:// safe) and also
 * requireable from node for tooling:  node -e "require('./data/info.js')".
 *
 *   buildings  keyed by CAMPUS_DATA building osmId (e.g. 'w27551077')
 *   landmarks  keyed by landmark key (fence, walkingToTheSky, scotty, stadium, randyPauschBridge, ...)
 *              — each also carries `position:[x,y,z]` (world metres) so UI/search can fly there
 *   areas      keyed by CAMPUS_DATA area name (exact OSM spelling)
 *   pois       keyed by CAMPUS_DATA poi name (exact OSM spelling)
 *   tour       guided-tour stops: target = look-at point, position = camera
 *
 * Optional InfoEntry fields beyond ARCHITECTURE.md: `aka` (string or array) holds only real alternative names /
 * abbreviations (UI shows "又称 …"); `formerly` a former name (UI: "原名 …"); `address` a street address in Chinese.
 * Former names and addresses are also woven into description/facts, so nothing is lost where the UI ignores them.
 *
 * A few keys are registered as NON-ENUMERABLE aliases at the bottom of this file (e.g. building-landmark
 * keys such as landmarks.hamerschlag → buildings['w27551077'], areas['Gesling Stadium'] → landmarks.stadium),
 * so direct lookups succeed while Object.keys()/for…in (search indexes) list every place exactly once.
 *
 * All prose written for this project from public sources (CMU Architecture Archives buildings database,
 * cmu.edu, Wikipedia, museum/park sites). Unofficial fan project — not affiliated with Carnegie Mellon.
 */
(function (root) {
  'use strict';

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // Meta
  // ────────────────────────────────────────────────────────────────────────────────────────────
  var meta = {
    title: "卡内基梅隆大学 · 3D 校园",
    titleEn: "Carnegie Mellon University in 3D",
    subtitle: "匹兹堡主校区 · Pittsburgh Campus",
    intro: "1900 年，钢铁大王安德鲁·卡内基（Andrew Carnegie）捐资创办卡内基技术学校，为匹兹堡工人家庭的子弟提供实用教育；1912 年它升格为可授予学位的卡内基理工学院（Carnegie Tech）。1967 年，学校与梅隆家族创立的梅隆工业研究所合并，成为今天的卡内基梅隆大学（CMU）。校园由建筑师亨利·霍恩博斯特尔（Henry Hornbostel）以布扎（Beaux-Arts）风格规划，黄砖、拱窗与灰绿色低坡屋顶（最初铺的是 Ludowici 绿陶瓦）延续至今；东南紧邻申利公园，西望匹兹堡大学的学习大教堂。",
    motto: "My heart is in the work.（我的心在工作之中——安德鲁·卡内基）",
    founded: "1900 年（卡内基技术学校）；1967 年与梅隆研究所合并为卡内基梅隆大学",
    facts: [
      "校训出自创始人安德鲁·卡内基：“My heart is in the work”。",
      "设有 7 个学院：工学院、美术学院、迪特里希人文与社会科学学院、海因茨学院、梅隆理学院、计算机科学学院、泰珀商学院。",
      "匹兹堡主校区约 157 英亩（约 64 公顷），另有卡塔尔、硅谷等校区。",
      "吉祥物是苏格兰梗犬 Scotty（2007 年正式确立），校队名叫 Tartans（格子呢）——向卡内基的苏格兰出身致敬。",
      "计算机科学系成立于 1965 年，1988 年组建为美国最早的计算机学院之一；师生与校友中有十余位图灵奖得主。",
      "1982 年，计算机系的斯科特·法尔曼在系内电子公告板上首次提议用 :-) 标注玩笑，被公认为网络表情符号的起源。",
      "著名校友包括波普艺术家安迪·沃霍尔（1949 届）、数学家约翰·纳什（1948 届）、宇航员朱迪丝·雷斯尼克（1970 届）。",
      "身着苏格兰短裙的 Kiltie 乐队创建于 1908 年；卡内基梅隆也是美国少数开设风笛演奏学位的大学之一。",
      "每年四月的春季嘉年华（Spring Carnival）有两大看点：学生搭建的 Midway 主题展台，以及始于 1920 年的 Buggy 无动力车接力赛。"
    ],
    credits: "文字为本项目依据公开资料（CMU 建筑档案馆、cmu.edu、维基百科、各博物馆及公园官网）自行编写；非官方爱好者作品，与卡内基梅隆大学无关。"
  };

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // Buildings — keyed by osmId
  // ────────────────────────────────────────────────────────────────────────────────────────────
  var buildings = {

    // ── The historic core: Hornbostel's Mall ────────────────────────────────────────────────
    "w27551077": {
      nameZh: "哈默施拉格楼", nameEn: "Hamerschlag Hall",
      formerly: "Machinery Hall（机械馆）",
      built: "1906–1912（上部楼层 1915–1916 年加建）",
      architect: "Palmer & Hornbostel（亨利·霍恩博斯特尔）",
      style: "布扎（Beaux-Arts）古典风格，黄砖与石材装饰",
      function: "电气与计算机工程系（ECE）",
      departments: ["电气与计算机工程系（ECE）"],
      description: "哈默施拉格楼矗立在中央大草坪西端的崖顶，是卡内基梅隆最具象征意义的建筑。它原名机械馆（Machinery Hall），是为全校供应蒸汽与电力的动力站和机械工坊，圆形塔楼与塔顶的烟囱从很远处就能认出，被视为校园天际线上的“皇冠”。1960 年代，大楼改以首任校长阿瑟·哈默施拉格（Arthur A. Hamerschlag）命名，如今是电气与计算机工程系的大本营。",
      facts: [
        "从中央大草坪看它并不高大：中央是带三角山花的巨大仪式拱门，两翼只有一排高大的拱窗；朝交汇谷（Junction Hollow）的一面却顺着崖壁向下跌落好几层，从谷底或申利桥上仰望，高墙与塔楼格外雄伟。",
        "锅炉房是校园最早投入使用的设施之一——没有它，其他教学楼就没有暖气和电。大楼起初只建到比校园地面高一层，好让锅炉尽早运转，上部楼层到 1915–1916 年才加建完成。",
        "楼基处设有纪念校友、“挑战者号”宇航员朱迪丝·雷斯尼克的铭牌。"
      ],
      tags: ["历史建筑", "工学院", "地标", "Hornbostel", "ECE"]
    },

    "w27549961": {
      nameZh: "波特楼", nameEn: "Porter Hall",
      formerly: "Industries Hall（工业馆）",
      built: "1905–1906；1915 年加建塔楼与工坊，此后多次扩建",
      architect: "Palmer & Hornbostel",
      style: "布扎（Beaux-Arts）古典风格",
      function: "工学院与人文社科学院的多个系",
      departments: ["土木与环境工程系", "社会与决策科学系"],
      description: "波特楼原名工业馆（Industries Hall），是应用工业学校（School of Applied Industries）的校舍，也是卡内基技术学校最早投入使用的教学楼之一，与东侧的贝克楼首尾相连，沿着 Frew 街一字排开。楼内长长的坡道式走廊当年是为了方便把沉重的机器运进实验室和车间。如今这里容纳土木与环境工程系、社会与决策科学系等单位。",
      facts: [
        "从中央大草坪看它只有两三层，但因地势落差，朝 Frew 街和申利公园一侧要高得多。",
        "中国桥梁专家茅以升的铜像就立在波特楼与贝克楼之间。"
      ],
      tags: ["历史建筑", "工学院", "人文社科", "Hornbostel"]
    },

    "w27590907": {
      nameZh: "贝克楼", nameEn: "Baker Hall",
      formerly: "Central Building / Administration Hall（行政楼）",
      built: "1914–1919 分期建成；1983 年增建 Adamson 翼，1999–2000 年再扩建",
      architect: "Palmer & Hornbostel / 霍恩博斯特尔与校园建筑局",
      style: "布扎（Beaux-Arts）古典风格",
      function: "迪特里希人文与社会科学学院（Dietrich College）院部及多个系",
      departments: ["迪特里希学院院部", "英语系", "历史系", "哲学系", "心理学系", "统计与数据科学系"],
      description: "贝克楼早年叫中央楼（Central Building）和行政楼（Administration Hall），后以第二任校长托马斯·贝克（Thomas S. Baker）命名，是迪特里希人文与社会科学学院的核心。一条贯穿全楼、微微倾斜的长走廊是它的招牌，也衍生出校园里最有名的传说：霍恩博斯特尔特意把地面做成斜坡，万一学校办不下去，大楼还能改造成依靠重力传送的工厂流水线。",
      facts: [
        "楼的正面朝向中央大草坪，贯通的走廊长得几乎一眼望不到头。",
        "楼外立有 2006 年落成的茅以升铜像，纪念学校历史上第一位博士。"
      ],
      tags: ["历史建筑", "人文社科", "Hornbostel", "Dietrich"]
    },

    "w27574545": {
      nameZh: "多尔蒂楼", nameEn: "Doherty Hall",
      formerly: "Engineering Hall（工程馆）",
      built: "1907–1909；1949–1950、1964、2001–2008 年多次扩建",
      architect: "Palmer & Hornbostel",
      style: "布扎（Beaux-Arts）古典风格",
      function: "化学与化学工程教学实验室、大型阶梯教室",
      departments: ["化学工程系", "化学系（教学实验室）"],
      description: "多尔蒂楼原名工程馆（Engineering Hall），是霍恩博斯特尔规划中的元老建筑之一，后以第三任校长罗伯特·多尔蒂（Robert E. Doherty）命名。大楼几经扩建，如今拥有化学与化学工程的教学实验室，以及几间全校最大的阶梯教室，许多本科基础大课都在这里上。",
      facts: [
        "位于中央大草坪北侧，东望卡特草坪与涂鸦栅栏。",
        "楼旁草坪上有英国艺术家加里·休姆（Gary Hume）的彩色铜雕《雪人》。"
      ],
      tags: ["历史建筑", "工学院", "科学", "Hornbostel"]
    },

    "w27591225": {
      nameZh: "美术学院大楼", nameEn: "College of Fine Arts",
      aka: "CFA",
      formerly: "School of Applied Design（应用设计学校）",
      built: "1912–1916",
      architect: "亨利·霍恩博斯特尔（Henry Hornbostel）",
      style: "布扎（Beaux-Arts）古典风格，石灰石雕刻立面",
      function: "美术学院院部；艺术、音乐等学院的教学与演出空间",
      departments: ["美术学院院部", "艺术学院", "音乐学院"],
      description: "美术学院大楼是霍恩博斯特尔献给母校巴黎美术学院的一部“建筑教科书”：正立面的五个石雕壁龛分别展示希腊、罗马、中世纪、文艺复兴以及世界各地（中国、埃及、印度、伊斯兰、高棉、玛雅等）的建筑装饰。美术学院统辖建筑、艺术、设计、戏剧、音乐五个学院，是美国最早的综合艺术院校之一。波普艺术大师安迪·沃霍尔 1949 年就从这里的绘画设计专业毕业。",
      facts: [
        "罗马壁龛里藏着霍恩博斯特尔本人扮作酒神巴克斯的头像。",
        "部分壁龛当年并未完工，1980–1990 年代才由建筑学院教师主持设计、补刻完成。",
        "大楼落成时属于应用设计学校（School of Applied Design），也就是今天美术学院的前身。",
        "楼内有克雷斯吉剧场（Kresge Theatre）与大厅（Great Hall）。"
      ],
      tags: ["历史建筑", "艺术", "地标", "Hornbostel", "CFA"]
    },

    "w27574204": {
      nameZh: "亨特图书馆", nameEn: "Hunt Library",
      aka: "Roy A. Hunt Library",
      built: "1957–1961",
      architect: "Lawrie & Green",
      style: "现代主义，铝材与玻璃幕墙",
      function: "大学主图书馆；亨特植物学文献研究所",
      departments: ["大学图书馆", "亨特植物学文献研究所"],
      description: "亨特图书馆 1961 年启用，由罗伊·亨特（Roy A. Hunt）夫妇捐建。亨特家族与美国铝业公司（Alcoa）渊源深厚——罗伊的父亲阿尔弗雷德·亨特正是美国铝业的创始人之一——因此整座建筑以铝材和玻璃包裹，立面上每隔约 1.2 米一道竖向铝翅，在老校园的黄砖建筑群中显得格外摩登。顶层的亨特植物学文献研究所收藏了大量珍贵的植物学书籍与图谱。",
      facts: [
        "一层有咖啡馆 De Fer Coffee & Tea，是学生复习时的“补给站”。",
        "南侧的和平花园（Peace Garden）与图书馆同年建成。"
      ],
      tags: ["图书馆", "现代建筑", "地标", "学习"]
    },

    "w27591314": {
      nameZh: "玛格丽特·莫里森·卡内基楼", nameEn: "Margaret Morrison Carnegie Hall",
      aka: "MMCH",
      built: "1905–1907；1913 年西翼，1961–1962 年及 1990 年代扩建",
      architect: "Palmer & Hornbostel",
      style: "布扎（Beaux-Arts）古典风格，半圆形柱廊门厅",
      function: "建筑学院、设计学院",
      departments: ["建筑学院", "设计学院"],
      description: "这座楼最初是玛格丽特·莫里森·卡内基女子学院——以安德鲁·卡内基母亲的名字命名，为匹兹堡女性提供职业教育，直到 1973 年才并入大学各学院。最醒目的是半圆形柱廊围合的门厅，檐口刻着颂扬女性使命的铭文。如今建筑学院与设计学院在此办公。",
      facts: [
        "屋顶加建了研究建筑节能与舒适度的“智能工作场所”（Intelligent Workplace）实验室。",
        "春季嘉年华的 Buggy 赛道就从楼旁的 Tech 街与 Margaret Morrison 街路口起步。"
      ],
      tags: ["历史建筑", "艺术", "建筑学", "设计", "Hornbostel", "MMCH"]
    },

    // ── West campus: engineering & computer science ────────────────────────────────────────
    "w27551364": {
      nameZh: "韦恩楼", nameEn: "Wean Hall",
      formerly: "Science Hall（科学馆）",
      built: "1968–1971",
      architect: "Deeter Ritchey Sippel",
      style: "粗野主义（Brutalism），清水混凝土",
      function: "数学、物理等理科院系与大量教室",
      departments: ["数学科学系", "物理系", "索雷尔斯工程与科学图书馆"],
      description: "这座 1971 年落成的混凝土大楼是校园里最典型的粗野主义建筑，原名科学馆（Science Hall），后以捐赠人雷蒙德·韦恩（Raymond J. Wean）命名。它当年集中了大学计算中心、工程与科学图书馆和计算机科学系，也留下了不少早期计算机趣闻：1982 年，研究生们把楼里的可乐贩卖机接入网络，远程查询有没有冰镇可乐——它常被称为最早的“物联网”设备之一。",
      facts: [
        "楼内的索雷尔斯图书馆（Sorrells Library）是理工科图书馆。",
        "网络表情 :-) 也诞生于 1982 年的卡内基梅隆计算机系。",
        "大楼建在坡地上：朝中央大草坪一侧显得较矮，朝交汇谷一侧则高得多。"
      ],
      tags: ["理学院", "计算机", "粗野主义", "Mellon College of Science"]
    },

    "w27551590": {
      nameZh: "纽厄尔-西蒙楼", nameEn: "Newell-Simon Hall",
      aka: "NSH",
      built: "1998–2000 改建（原建筑分别建于 1915 年与 1934 年）",
      architect: "Williams Trebilcock Whitehead（改建）",
      style: "砖砌学院风格",
      function: "机器人研究所、人机交互研究所",
      departments: ["机器人研究所（RI）", "人机交互研究所（HCII）"],
      description: "纽厄尔-西蒙楼 2000 年启用，以人工智能先驱艾伦·纽厄尔（Allen Newell）和赫伯特·西蒙（Herbert A. Simon）命名——二人 1975 年共同获得图灵奖，西蒙还在 1978 年获得诺贝尔经济学奖。大楼由美国矿务局留下的动力站和实验楼改建而成，如今是机器人研究所和人机交互研究所的重要基地。",
      facts: [
        "机器人研究所创建于 1979 年，是美国高校中最早的机器人研究机构之一。",
        "2007 年，CMU 的 Tartan Racing 团队凭无人车“Boss”赢得 DARPA 城市挑战赛。"
      ],
      tags: ["计算机", "机器人", "SCS", "Robotics Institute", "HCII"]
    },

    "w27623372": {
      nameZh: "盖茨-希尔曼中心", nameEn: "Gates and Hillman Centers",
      aka: "GHC",
      built: "2005–2009（2009 年 8 月启用）",
      architect: "Mack Scogin Merrill Elam Architects；景观 Michael Van Valkenburgh Associates",
      style: "当代建筑，折线形体量顺山势跌落",
      function: "计算机科学学院（SCS）主楼",
      departments: ["计算机科学学院", "计算机科学系"],
      description: "盖茨中心与希尔曼未来技术中心 2009 年启用，是计算机科学学院的大本营：约 2 万平方米的楼里有 300 多间办公室、30 多个实验室和一座 250 座的礼堂。大楼由比尔及梅琳达·盖茨基金会（2000 万美元）和希尔曼基金会（1000 万美元）领衔捐建，折线形体量顺着陡坡层层跌落，并以兰迪·波许纪念桥与珀内尔艺术中心相连。",
      facts: [
        "获 LEED 金级认证。",
        "两栋楼围合出一片户外“冬季花园”（Kraus Winter Garden），种有数百棵树。",
        "卡内基梅隆 1965 年成立计算机科学系，1988 年组建计算机科学学院。"
      ],
      tags: ["计算机", "SCS", "地标", "现代建筑"]
    },

    "w27590641": {
      nameZh: "罗伯茨工程楼", nameEn: "Roberts Engineering Hall",
      aka: "George A. Roberts Engineering Hall",
      formerly: "电子材料技术楼",
      built: "1993–1997（1997 年 5 月落成）",
      architect: "Payette Associates",
      style: "现代砖砌建筑",
      function: "工学院科研实验楼",
      description: "罗伯茨工程楼“挂”在哈默施拉格楼高大基座与交汇谷铁路之间的陡坡上，是工学院的科研实验楼，以乔治·罗伯茨（George A. Roberts）命名。从申利公园一侧望去，它与哈默施拉格楼、斯科特楼层层叠叠，构成了校园西缘的“工程悬崖”。",
      tags: ["工学院", "科研"]
    },

    "r13441031": {
      nameZh: "斯科特楼", nameEn: "Scott Hall",
      aka: "Sherman and Joyce Bowie Scott Hall",
      built: "2012–2016",
      architect: "Office 52 / Stantec",
      style: "当代玻璃幕墙建筑",
      function: "生物医学工程系、斯科特能源创新研究所、纳米技术实验室",
      departments: ["生物医学工程系", "威尔顿·斯科特能源创新研究所", "Bertucci 纳米技术实验室"],
      description: "斯科特楼 2016 年启用，嵌在哈默施拉格楼、罗伯茨楼和韦恩楼之间，顺着交汇谷的边坡而建。楼内有生物医学工程系、斯科特能源创新研究所以及洁净室级别的 Bertucci 纳米技术实验室，是工学院面向能源、健康与纳米技术的交叉研究中心。",
      facts: ["楼内陈列着校友乔伊丝·鲍伊·斯科特（Joyce Bowie Scott）的拼贴艺术作品。"],
      tags: ["工学院", "科研", "现代建筑"]
    },

    "w1001941217": {
      nameZh: "ANSYS 楼", nameEn: "ANSYS Hall",
      built: "2016–2019（2019 年启用）",
      architect: "Bohlin Cywinski Jackson",
      style: "当代建筑，大面积玻璃与金属",
      function: "工学院创客空间与教室",
      description: "ANSYS 楼 2019 年启用，以匹兹堡本地的工程仿真软件公司 ANSYS 命名，是工学院的创客空间：学生可以在这里用 3D 打印机、激光切割机等各类工具，把课堂上的设计变成实物。它位于中央大草坪西端、哈默施拉格楼旁。",
      facts: ["获 LEED 金级认证。"],
      tags: ["工学院", "创客空间", "现代建筑"]
    },

    "w27550292": {
      nameZh: "斯凯夫楼", nameEn: "Scaife Hall",
      aka: "Alan Magee Scaife Hall of Engineering",
      built: "2024（新楼）；原斯凯夫楼建于 1962 年",
      architect: "KieranTimberlake（新楼）",
      style: "当代建筑，云母质感铝板外墙",
      function: "机械工程系",
      departments: ["机械工程系"],
      description: "新斯凯夫楼 2024 年落成，取代 1962 年的旧楼，成为机械工程系的新家。它位于老校园西南角，一边是申利公园，一边是陡坡；建筑师把实验室埋入地下以借助土壤恒温节能，上部体量悬浮在绿化庭院之上。外墙的云母质感铝板会随光线在暖香槟色与冷灰色之间变化，呼应老校园的黄砖色调。",
      facts: ["获 LEED 金级认证。", "室内外融入了艺术家杰西卡·斯托克霍尔德（Jessica Stockholder）的色彩装置《Making Way》。"],
      tags: ["工学院", "现代建筑"]
    },

    "w27590940": {
      nameZh: "设施管理服务楼", nameEn: "Facilities Management Services Building",
      function: "校园设施运维与后勤",
      description: "设施管理服务楼位于交汇谷一侧的坡地上，是负责全校建筑维护、能源供应、清洁与校园运行的后勤部门所在地。",
      tags: ["行政", "后勤"]
    },

    // ── Forbes Avenue frontage & north-west campus ─────────────────────────────────────────
    "w27574406": {
      nameZh: "珀内尔艺术中心", nameEn: "Purnell Center for the Arts",
      built: "1990 年代末建成",
      architect: "DDF Associates（Michael Dennis & Associates 等）",
      style: "现代砖砌建筑",
      function: "戏剧学院",
      departments: ["戏剧学院（School of Drama）"],
      description: "珀内尔艺术中心是戏剧学院的家，楼内有菲利普·乔斯基剧院（Philip Chosky Theater）等多个剧场、排练厅和舞美车间。卡内基梅隆戏剧学院创立于 1914 年，是美国第一个授予戏剧学位的院校，培养出众多百老汇与影视演员。立面上的青铜雕塑《幕布》（Carol Kumata，2000）宛如被风掀起的舞台帷幕。",
      facts: ["通过兰迪·波许纪念桥与盖茨中心相连，象征艺术与计算机的结合。"],
      tags: ["艺术", "戏剧", "CFA"]
    },

    "w27574704": {
      nameZh: "华纳楼", nameEn: "Warner Hall",
      built: "1966",
      architect: "Charles Luckman Associates",
      style: "现代主义",
      function: "大学行政楼",
      departments: ["校长办公室", "本科招生办公室", "学生注册与财务服务（The HUB）"],
      description: "面朝福布斯大道的华纳楼是大学的行政中枢，以第四任校长约翰·华纳（John C. Warner）命名，校长办公室和本科招生办公室都设在这里。楼前草坪上就是约 30 米高的《走向天空》雕塑。",
      facts: ["楼内收藏有日裔美国木作大师中岛乔治（George Nakashima）的约 60 件家具。"],
      tags: ["行政", "招生"]
    },

    "w27574718": {
      nameZh: "赛尔特楼", nameEn: "Cyert Hall",
      built: "1982–1983",
      architect: "Deeter Ritchey Sippel",
      style: "现代砖砌建筑",
      function: "校园计算与信息技术相关部门",
      description: "赛尔特楼以第六任校长理查德·赛尔特（Richard M. Cyert）命名，落成时是大学计算中心和信息技术中心（ITC）的所在地。ITC 与 IBM 合作的 Andrew 项目为全校搭建了分布式计算环境，诞生了影响深远的 Andrew 文件系统（AFS）——直到今天，CMU 学生的校园账号仍叫“Andrew ID”。",
      tags: ["行政", "计算机", "历史"]
    },

    "w27591096": {
      nameZh: "汉堡楼（海因茨学院）", nameEn: "Hamburg Hall",
      built: "1915；2014–2016 年扩建",
      architect: "亨利·霍恩博斯特尔；扩建 GBBN Architects",
      style: "新古典风格",
      function: "海因茨信息系统与公共政策学院",
      departments: ["海因茨学院（Heinz College）"],
      description: "汉堡楼原是霍恩博斯特尔 1915 年为美国矿务局设计的办公楼，矿务局在这片园区研究矿山安全与燃料技术长达数十年。1980 年代卡内基梅隆买下这片“西北校区”，如今这里是海因茨信息系统与公共政策学院的所在地；2016 年完成的扩建让老楼重焕新生。",
      tags: ["海因茨学院", "公共政策", "历史建筑", "Hornbostel"]
    },

    "w27591104": {
      nameZh: "史密斯楼", nameEn: "Smith Hall",
      formerly: "美国矿务局 B 楼",
      built: "约 1939 年",
      architect: "Lawrence Wolfe",
      function: "机器人研究所实验室",
      description: "史密斯楼原是美国矿务局园区的实验楼之一，1980 年代随整片地块并入卡内基梅隆。如今它主要供机器人研究所使用，自动驾驶汽车研究中心等实验室就设在楼内。",
      tags: ["计算机", "机器人", "SCS"]
    },

    "w27591069": {
      nameZh: "协同创新中心", nameEn: "Collaborative Innovation Center",
      aka: ["CIC", "Robert Mehrabian Collaborative Innovation Center"],
      built: "2002–2005",
      architect: "Davis Gannon Gardner Pope",
      style: "当代玻璃与砖石建筑",
      function: "产学研合作大楼",
      departments: ["CyLab 安全与隐私研究所", "信息网络研究所（INI）", "CERT 协调中心", "CREATE Lab"],
      description: "协同创新中心 2005 年落成，以第七任校长罗伯特·梅拉比安（Robert Mehrabian）命名，专门让大学实验室和企业研发团队在同一屋檐下工作。CyLab、CERT 协调中心、CREATE Lab 等都在这里，苹果、英特尔和迪士尼研究院也曾在楼内设立研发办公室。",
      tags: ["科研", "网络安全", "产学研"]
    },

    "w946491335": {
      nameZh: "TCS 楼", nameEn: "TCS Hall",
      aka: "Tata Consultancy Services Hall",
      built: "2018–2020（2020 年启用）",
      architect: "Bohlin Cywinski Jackson",
      style: "当代建筑",
      function: "计算机学院软件研究所等",
      departments: ["软件研究所（ISR）", "计算金融硕士项目（MSCF）", "企业合作中心"],
      description: "TCS 楼由印度塔塔咨询服务公司（TCS）捐资 3500 万美元兴建，2020 年启用，是福布斯大道西段通往校园的新门户。约 8400 平方米的楼内有计算机学院软件研究所、计算金融项目、企业合作中心，以及一个两层高的学生“门廊”。",
      facts: ["获 LEED 金级认证。"],
      tags: ["计算机", "SCS", "现代建筑"]
    },

    "w583510520": {
      nameZh: "泰珀商学院（泰珀广场）", nameEn: "Tepper School of Business",
      aka: "Tepper Building / David A. Tepper Quadrangle",
      built: "2015–2018（2018 年启用）",
      architect: "Moore Ruble Yudell（与 Renaissance 3 Architects 合作）",
      style: "当代建筑，通高玻璃中庭",
      function: "泰珀商学院；全校共享的访客中心、礼堂与健身中心",
      departments: ["泰珀商学院", "Coulter 访客中心与本科招生", "Simmons 礼堂（600 座）", "创业中心"],
      description: "泰珀大楼是福布斯大道北侧泰珀广场的核心，2018 年启用，以校友大卫·泰珀（David A. Tepper）的巨额捐赠为核心兴建，约 2.9 万平方米。除商学院外，这里还有 600 座的 Simmons 礼堂、Coulter 访客中心、健身中心和咖啡馆，许多访客的校园之旅正是从这里开始。商学院前身是 1949 年创立的工业管理研究生院（GSIA），现代管理科学与行为决策研究的重要发源地之一。",
      facts: [
        "楼板采用 BubbleDeck 空心技术：混凝土中嵌入再生塑料球，重量减轻约 35%。",
        "雨水回收等设计使饮用水消耗降低一半以上。"
      ],
      tags: ["商学院", "Tepper", "访客中心", "现代建筑"]
    },

    // ── East campus: student life ──────────────────────────────────────────────────────────
    "w27574394": {
      nameZh: "科翁大学中心", nameEn: "Cohon University Center",
      aka: ["CUC", "Jared L. Cohon University Center"],
      formerly: "University Center（大学中心）",
      built: "1989–1996；2014–2016 年扩建",
      architect: "UDA Architects / Michael Dennis & Associates；扩建 Cannon Design",
      style: "后现代砖砌建筑",
      function: "学生活动中心",
      departments: ["McConomy 礼堂", "Rangos 舞厅", "Wiegand 体育馆与游泳池", "Schatz 餐厅", "校园书店", "Wright-Rogal 小礼拜堂"],
      description: "科翁中心是全校的“客厅”：餐厅、书店、健身房、游泳池、体育馆、舞厅和礼堂都在这里。它 1996 年以“大学中心”（University Center）之名落成，取代了老 Skibo 学生活动楼，2014 年以第八任校长贾里德·科翁（Jared L. Cohon）的名字重新命名。2007 年 9 月，兰迪·波许教授正是在楼内的 McConomy 礼堂讲授了感动全球的《最后一课》。",
      facts: [
        "南侧的 Merson 庭院里有 2021 年安放的吉祥物 Scotty 铜像。",
        "入口处悬挂着玻璃艺术家戴尔·奇胡利（Dale Chihuly）的吊灯，致敬科翁校长。"
      ],
      tags: ["学生生活", "餐饮", "体育", "地标"]
    },

    "w1000419332": {
      nameZh: "Tartans 餐饮亭", nameEn: "Tartans Pavilion",
      architect: "Springboard Design",
      style: "单层玻璃亭",
      function: "校园餐厅",
      description: "这座单层玻璃餐饮亭俯瞰盖斯林体育场，七扇玻璃车库门可以整面打开，让室内外连成一片。亭内有烧木柴的砖炉，供应披萨等餐食，是看球、聊天的好去处。",
      tags: ["餐饮", "学生生活"]
    },

    "w27574237": {
      nameZh: "东校区停车楼", nameEn: "East Campus Garage",
      built: "1987–1990",
      architect: "Michael Dennis, Jeffrey Clark & Associates / TAMS",
      function: "停车",
      description: "东校区停车楼与盖斯林体育场、雷斯尼克宿舍、西翼宿舍同属 1980 年代末的“东校区”工程，就建在体育场北侧的坡地上，是驾车来访者最常用的停车场所。",
      tags: ["交通", "停车"]
    },

    "w1039908831": {
      nameZh: "海马克健康运动中心", nameEn: "Highmark Center for Health, Wellness and Athletics",
      built: "2021–2024（2024 年秋启用）",
      architect: "Bohlin Cywinski Jackson",
      style: "当代建筑与历史体育馆结合",
      function: "校医院、心理咨询、校队与全民健身、宗教与灵性生活中心",
      departments: ["大学健康服务中心", "心理咨询服务（CaPS）", "校队主场馆与训练中心", "宗教与灵性生活中心"],
      description: "海马克中心位于 Frew 街与 Tech 街路口，把霍恩博斯特尔设计的 1923 年 Skibo 体育馆与大规模新建部分融为一体（总面积约 1.5 万平方米），于 2024 年秋启用。这里集中了校医院、心理咨询、篮球和排球主场馆、带跑道的室内草坪训练馆以及宗教与灵性生活中心，体现“身心健康一体化”的理念。项目总投资 1.05 亿美元，其中 3500 万美元来自海马克公司（Highmark）的资助。",
      facts: ["中庭悬挂着艺术家瓜达卢佩·马拉维利亚（Guadalupe Maravilla）用六张抛光铝吊床组成的动态雕塑。"],
      tags: ["体育", "健康", "学生生活", "Hornbostel"]
    },

    "w1002857138": {
      nameZh: "艺术楼", nameEn: "Hall of the Arts",
      formerly: "GSIA 大楼（工业管理研究生院）",
      built: "1952；2021 年翻新",
      architect: "Marlier & Johnstone；翻新 GBBN Architects",
      function: "美术学院多个系的教室、工作室与琴房",
      description: "艺术楼建于 1952 年，是工业管理研究生院（GSIA，今泰珀商学院前身）的第一座专属大楼，赫伯特·西蒙等学者曾在这里工作。商学院迁往泰珀广场后，大楼于 2021 年彻底翻新并更名，如今有明亮的艺术工作室、教室和 13 间按乐器定制声学的琴房。",
      facts: ["入口处仍保留着罗伯特·莱珀（Robert Lepper）1951 年创作的大理石浮雕。", "与波斯纳楼的联合翻新获 LEED 金级认证。"],
      tags: ["艺术", "CFA", "历史"]
    },

    "w27591241": {
      nameZh: "波斯纳楼", nameEn: "Posner Hall",
      built: "1990–1993；1999–2000 年扩建；2021 年翻新",
      architect: "Kallmann McKinnell & Wood；翻新 GBBN Architects",
      function: "人文与美术院系、学生学业支持中心、行政办公",
      description: "波斯纳楼原是泰珀商学院（GSIA）的扩建教学楼。2018 年商学院迁入福布斯大道北侧的泰珀广场后，它与相邻的艺术楼一起在 2021 年完成翻新，成为多个人文与美术院系以及学生学业成功中心的新家。",
      facts: ["它与美术学院大楼之间的屋顶花园就是 Kraus Campo。"],
      tags: ["艺术", "人文社科", "行政"]
    },

    // ── Residence halls ────────────────────────────────────────────────────────────────────
    "w27591352": {
      nameZh: "雷斯尼克宿舍", nameEn: "Resnik House",
      built: "1987–1990",
      architect: "Michael Dennis, Jeffrey Clark & Associates / TAMS",
      function: "本科生宿舍、校园餐饮",
      description: "雷斯尼克宿舍纪念 1970 年毕业于本校电气工程专业的宇航员朱迪丝·雷斯尼克（Judith A. Resnik）——她是第二位进入太空的美国女性，1986 年在“挑战者号”航天飞机事故中遇难。宿舍与旁边的 Tartans 餐饮亭一带汇集了多家校园餐厅，面向盖斯林体育场。",
      tags: ["宿舍", "学生生活", "餐饮"]
    },

    "w27591351": {
      nameZh: "西翼宿舍", nameEn: "West Wing",
      built: "1987–1990",
      architect: "Michael Dennis, Jeffrey Clark & Associates / TAMS",
      function: "本科生宿舍（以新生为主）",
      description: "西翼宿舍与雷斯尼克宿舍同为 1980 年代末“东校区”规划的一部分，位于 MMCH 与盖斯林体育场之间，主要安置本科新生。",
      tags: ["宿舍", "学生生活"]
    },

    "w27591346": {
      nameZh: "唐纳宿舍", nameEn: "Donner House",
      built: "1952–1954",
      architect: "Mitchell & Ritchey",
      style: "战后现代主义",
      function: "本科生宿舍",
      description: "唐纳宿舍是一座战后现代风格的学生宿舍。门前向下倾斜的大草坡被学生们戏称为“唐纳沟”（Donner Ditch），天气好时满是晒太阳、扔飞盘的人。",
      tags: ["宿舍", "学生生活"]
    },

    "w27591450": {
      nameZh: "博斯宿舍", nameEn: "Boss House",
      built: "1915",
      architect: "霍恩博斯特尔与校园建筑局",
      style: "学院风格砖砌住宅",
      function: "本科生宿舍",
      description: "博斯宿舍与相邻的麦吉尔宿舍建于 1915 年，是校园最早的一批学生宿舍，坐落在东南角被学生称为“山上”（the Hill）的坡地上，与亨德森、斯科贝尔、韦尔奇、哈默施拉格宿舍组成一个小社区。",
      tags: ["宿舍", "历史建筑", "the Hill"]
    },

    "w27591456": {
      nameZh: "麦吉尔宿舍", nameEn: "McGill House",
      built: "1915",
      architect: "霍恩博斯特尔与校园建筑局",
      style: "学院风格砖砌住宅",
      function: "本科生宿舍",
      description: "麦吉尔宿舍与博斯宿舍同年建成，是“山上”宿舍群里最早的两栋之一，砖墙坡顶、尺度亲切，保留着一百多年前的学院风情。",
      tags: ["宿舍", "历史建筑", "the Hill"]
    },

    "w27591466": {
      nameZh: "哈默施拉格宿舍", nameEn: "Hamerschlag House",
      built: "1959–1960",
      architect: "Celli-Flynn",
      function: "本科生宿舍",
      description: "哈默施拉格宿舍是“山上”宿舍群中较年轻的一栋，与哈默施拉格楼一样纪念首任校长阿瑟·哈默施拉格。它位于校园东南角的坡顶，可以俯瞰东校区。",
      tags: ["宿舍", "the Hill"]
    },

    "w27591482": {
      nameZh: "斯科贝尔宿舍", nameEn: "Scobell House",
      built: "1918",
      architect: "霍恩博斯特尔与校园建筑局",
      function: "本科生宿舍",
      description: "斯科贝尔宿舍与韦尔奇宿舍同建于 1918 年，属于校园东南角的“山上”宿舍群，是一栋小巧的砖砌学生公寓楼。",
      tags: ["宿舍", "历史建筑", "the Hill"]
    },

    "w27591484": {
      nameZh: "韦尔奇宿舍", nameEn: "Welch House",
      built: "1918",
      architect: "霍恩博斯特尔与校园建筑局",
      function: "本科生宿舍",
      description: "韦尔奇宿舍建于 1918 年，是“山上”宿舍群的一员，与斯科贝尔宿舍比邻而立。",
      tags: ["宿舍", "历史建筑", "the Hill"]
    },

    "w27591488": {
      nameZh: "亨德森宿舍", nameEn: "Henderson House",
      built: "1916；2004 年翻新",
      architect: "霍恩博斯特尔与校园建筑局",
      function: "本科生宿舍（约 60 人）",
      description: "亨德森宿舍建于 1916 年，2004 年完成绿色改造后，成为全美第一座获得 LEED 认证的翻新学生宿舍，可住约 60 名学生。",
      tags: ["宿舍", "历史建筑", "绿色建筑", "the Hill"]
    },

    "w27591497": {
      nameZh: "精神之家", nameEn: "Spirit House",
      formerly: "Canterbury House（坎特伯雷之家）",
      function: "学生住宅",
      description: "校园东侧 Margaret Morrison 街上的一栋小型学生住宅，旧称坎特伯雷之家，1948 年曾改建。",
      tags: ["宿舍"]
    },

    "w27591503": {
      nameZh: "伍德劳恩公寓", nameEn: "Woodlawn Apartments",
      function: "学生公寓",
      description: "卡内基梅隆在校园东缘的学生公寓，房间带厨房，适合高年级学生独立生活。",
      tags: ["宿舍", "公寓"]
    },

    "w27591583": {
      nameZh: "罗斯劳恩联排屋", nameEn: "Roselawn Houses",
      function: "学生住宅",
      description: "罗斯劳恩台地（Roselawn Terrace）上一排独立小住宅，由大学作为学生住宅使用，环境安静，像一个校园里的小街区。",
      tags: ["宿舍"]
    },

    "w27591602": {
      nameZh: "科技之家", nameEn: "Tech House",
      function: "学生住宅",
      description: "位于罗斯劳恩台地的学生住宅。“Tech House”这个名字让人想起学校的旧称 Carnegie Tech；早年另有一座同名老宅（1895 年建）已于 1990 年拆除。",
      tags: ["宿舍"]
    },

    "w27591621": {
      nameZh: "德尔塔·陶·德尔塔之家", nameEn: "Delta Tau Delta House",
      function: "兄弟会会所",
      description: "校园东侧的兄弟会（Delta Tau Delta）会所。卡内基梅隆的兄弟会与姐妹会是春季嘉年华 Buggy 赛和 Midway 展台的主力。",
      tags: ["学生生活", "兄弟会"]
    },

    "w27591646": {
      nameZh: "残障资源中心", nameEn: "Disability Resources",
      function: "学生支持服务",
      description: "为残障学生提供无障碍支持、学业便利与咨询服务的办公地点。",
      tags: ["学生服务"]
    },

    "w27591681": {
      nameZh: "玛格丽特·莫里森公寓", nameEn: "Margaret Morrison Apartments",
      built: "1977–1981",
      architect: "Damianos and Pedone",
      function: "学生公寓与姐妹会住宅",
      description: "1970 年代末建成的“玛格丽特·莫里森广场”项目，包括学生公寓和姐妹会住宅，沿 Margaret Morrison 街排开。",
      tags: ["宿舍", "公寓"]
    },

    "w544174675": {
      nameZh: "莫尔伍德花园宿舍", nameEn: "Morewood Gardens",
      built: "1920 年代末（原为豪华公寓）；1946 年并入学校",
      style: "英式公寓建筑",
      function: "本科新生宿舍",
      description: "莫尔伍德花园原是 1920 年代末为匹兹堡富裕阶层建造的七层英式豪华公寓，1946 年被学校以一百多万美元买下改作宿舍。它位于福布斯大道与莫尔伍德大道路口，如今是规模最大的新生宿舍之一，楼内还有创客空间和学生活动场所。",
      tags: ["宿舍", "历史建筑"]
    },

    "w1002531075": {
      nameZh: "莫尔伍德 E 塔宿舍", nameEn: "Morewood E-Tower",
      built: "1961–1962",
      architect: "Alfred D. Reid Associates",
      function: "本科生宿舍",
      description: "E 塔是莫尔伍德花园 1960 年代初的加建部分，与主楼相连，学生可共享莫尔伍德的各项设施。",
      tags: ["宿舍"]
    },

    "w27591700": {
      nameZh: "史蒂弗宿舍", nameEn: "Stever House",
      built: "2000–2003",
      architect: "Bohlin Cywinski Jackson",
      function: "本科新生宿舍",
      description: "史蒂弗宿舍 2003 年落成，是全美第一座获得 LEED 认证的新建大学宿舍。它以第五任校长盖福德·史蒂弗（H. Guyford Stever）命名，他后来出任美国国家科学基金会主任。",
      tags: ["宿舍", "绿色建筑"]
    },

    "w27591703": {
      nameZh: "马奇宿舍（A 楼）", nameEn: "Mudge House",
      built: "1922（宅邸）；1958–1959、1965–1966 年加建 B、C 楼",
      architect: "Henry D. Gilchrist（原宅）",
      style: "英式庄园风格石砌建筑",
      function: "本科新生宿舍",
      description: "马奇宿舍的核心是工业家埃德蒙·马奇 1922 年建造的石砌宅邸，1950 年代末由马奇家族送给学校，随后加建了 B、C 两翼。三栋楼围合出的内庭院（Mudge Courtyard）安静优雅。",
      tags: ["宿舍", "历史建筑"]
    },

    "w27591702": {
      nameZh: "马奇宿舍（C 楼）", nameEn: "Mudge House C",
      built: "1958–1966 年间加建",
      function: "本科新生宿舍",
      description: "马奇宿舍的加建翼楼之一，与原宅邸（A 楼）和 B 楼共同围合出马奇庭院。",
      tags: ["宿舍"]
    },

    "w27591706": {
      nameZh: "马奇宿舍（B 楼）", nameEn: "Mudge House B",
      built: "1958–1966 年间加建",
      function: "本科新生宿舍",
      description: "马奇宿舍的加建翼楼之一，风格与原宅邸协调，共用内庭院。",
      tags: ["宿舍"]
    },

    "w1203786280": {
      nameZh: "福布斯-比勒公寓", nameEn: "Forbes Beeler Apartments",
      built: "2023 年前后启用",
      architect: "Goody Clancy",
      function: "本科生公寓（约 266 人）",
      description: "位于福布斯大道与比勒街路口的新建学生公寓，可住约 266 名本科生，是大学扩充校内住宿计划的一部分。",
      facts: ["楼内陈列艺术家阿曼达·罗斯-霍（Amanda Ross-Ho）的作品《无题（The Fence）》——一段从著名涂鸦栅栏上取下的“油漆岩芯”。"],
      tags: ["宿舍", "公寓", "现代建筑"]
    },

    "w1007453778": {
      nameZh: "第五-克莱德宿舍", nameEn: "Fifth and Clyde Residence Hall",
      built: "2021 年启用",
      function: "本科生宿舍（约 264 人）",
      description: "位于第五大道与克莱德街路口的新宿舍，2021 年启用，可住约 264 名学生，与周边的“第五大道社区公共空间”一起构成了一个新的学生生活圈。",
      facts: ["门前有雕塑家撒迪厄斯·莫斯利（Thaddeus Mosley）的青铜雕塑《倒立的舞者》（2022）。"],
      tags: ["宿舍", "现代建筑"]
    },

    "w152567349": {
      nameZh: "费尔法克斯公寓", nameEn: "Fairfax Apartments",
      built: "1926–1927",
      architect: "Philip Morrison Jullien",
      style: "詹姆斯一世复兴式（Jacobethan Revival）",
      floors: 9,
      function: "学生公寓",
      description: "这座九层的詹姆斯一世复兴式公寓楼位于第五大道，约 2000 年被卡内基梅隆买下改作学生公寓，2021 年列入美国国家史迹名录。",
      tags: ["宿舍", "公寓", "历史建筑"]
    },

    "w739910512": {
      nameZh: "第五大道公寓", nameEn: "Residence on Fifth",
      function: "学生公寓",
      description: "卡内基梅隆位于第五大道 4700 号的学生公寓，步行即可到达校园北侧的泰珀广场。",
      tags: ["宿舍", "公寓"]
    },

    "w545283450": {
      nameZh: "第五-内维尔公寓", nameEn: "Fifth Neville Apartments",
      function: "学生公寓",
      description: "第五大道与内维尔街路口的学生公寓。门前那组亮橙色的钢块雕塑是克拉克·温特（Clark Winter）1969 年的极简主义作品。",
      tags: ["宿舍", "公寓"]
    },

    "w545283419": {
      nameZh: "内维尔公寓", nameEn: "Neville Apartments",
      function: "学生公寓",
      description: "卡内基梅隆在内维尔街的学生公寓，属于第五大道沿线的校外住宿片区。",
      tags: ["宿舍", "公寓"]
    },

    "w545283472": {
      nameZh: "克莱德之家", nameEn: "Clyde House",
      function: "学生公寓",
      description: "克莱德街上的学生公寓，与海兰公寓相邻。",
      tags: ["宿舍", "公寓"]
    },

    "w545283486": {
      nameZh: "海兰公寓", nameEn: "Highland Apartments",
      aka: "The Highlands",
      function: "学生公寓",
      description: "卡内基梅隆在克莱德街的学生公寓（The Highlands），提供带厨房的套间。",
      tags: ["宿舍", "公寓"]
    },

    "w44157438": {
      nameZh: "雪莉公寓", nameEn: "Shirley Apartments",
      function: "学生公寓",
      description: "位于北迪思里奇街的学生公寓，靠近第五大道与匹兹堡大学一带。",
      tags: ["宿舍", "公寓"]
    },

    // ── Research & administration off the main quad ────────────────────────────────────────
    "w25795368": {
      nameZh: "梅隆研究所", nameEn: "Mellon Institute",
      aka: "Mellon Institute of Industrial Research",
      built: "1931–1937",
      architect: "Janssen & Cocken（本诺·詹森 Benno Janssen）",
      style: "新古典主义，四周环绕 62 根整块石灰岩爱奥尼柱",
      function: "梅隆理学院院部；生物科学系、化学系实验室",
      departments: ["梅隆理学院院部", "生物科学系", "化学系"],
      description: "梅隆工业研究所由安德鲁·梅隆和理查德·梅隆兄弟于 1913 年创办，1937 年迁入第五大道上这座神殿般的大楼：环绕四周的 62 根爱奥尼柱每根都由整块石灰岩制成，落成时是世界上最大的整石柱。1967 年，研究所与卡内基理工学院合并，“卡内基梅隆大学”由此得名；如今这里是梅隆理学院院部和生物、化学两系的实验室。",
      facts: [
        "研究所历史上产出约 1600 项专利，有机硅研究直接催生了道康宁公司。",
        "2013 年被美国化学会列为“国家化学历史地标”。"
      ],
      tags: ["理学院", "历史建筑", "地标", "Mellon"]
    },

    "w44150733": {
      nameZh: "软件工程研究所", nameEn: "Software Engineering Institute",
      aka: "SEI",
      built: "1984–1987",
      architect: "Bohlin Powell Larkin Cywinski 与 Burt Hill Kosar Rittelmann",
      function: "美国国防部资助的联邦研究与发展中心（FFRDC）",
      description: "软件工程研究所 1984 年成立，是由美国国防部资助、卡内基梅隆运营的联邦研究与发展中心，专注软件工程与网络安全。1988 年“莫里斯蠕虫”事件后，这里成立了世界上第一个计算机应急响应小组——CERT 协调中心。",
      tags: ["科研", "网络安全", "软件工程"]
    },

    "w29094259": {
      nameZh: "大学技术开发中心", nameEn: "University Technology Development Center",
      aka: "UTDC",
      function: "科研与技术开发用房",
      description: "位于 Henry 街 4516 号的大学科研楼，为技术开发项目与衍生初创团队提供实验和办公空间。",
      tags: ["科研", "产学研"]
    },

    "w44156184": {
      nameZh: "信息网络研究所", nameEn: "Information Networking Institute",
      aka: "INI",
      address: "Henry 街 4616 号",
      function: "信息网络与网络安全研究生教育",
      description: "信息网络研究所 1989 年创立，是美国第一个专门从事信息网络教育与研究的机构，开设网络、网络安全等方向的研究生项目。Henry 街 4616 号是它在大学地图上的楼宇之一。",
      tags: ["工学院", "网络安全", "研究生"]
    },

    "w44157444": {
      nameZh: "技术转移与创业中心", nameEn: "Center for Technology Transfer and Enterprise Creation",
      aka: "CTTEC",
      address: "福布斯大道 4615 号",
      function: "专利授权与衍生创业",
      description: "位于福布斯大道 4615 号，是负责把校内研究成果转化为专利授权和初创公司的部门。卡内基梅隆每年孵化出大量科技初创企业，许多都从这里起步。",
      tags: ["行政", "创业", "产学研"]
    },

    "w44157443": {
      nameZh: "克雷格南街 407 号（卡内基梅隆大学）", nameEn: "407 South Craig Street",
      built: "1978 年改建，1985 年起由大学使用",
      architect: "Damianos and Pedone（改建）",
      function: "大学办公用房",
      description: "南克雷格街上的一栋大学办公楼。1978 年改建后曾作为“匹兹堡艺术计划”（Pittsburgh Plan for Art）画廊和大学美术馆，1985 年起由卡内基梅隆使用。南克雷格街一带餐馆、咖啡馆林立，是师生常去的生活街区。",
      tags: ["行政", "克雷格街"]
    },

    "w34262288": {
      nameZh: "克雷格南街 300 号（卡内基梅隆大学）", nameEn: "300 South Craig Street",
      built: "2005 年由大学购入",
      function: "大学办公与科研用房；校园警察局",
      description: "南克雷格街 300 号 2005 年成为卡内基梅隆的物业，楼内有科研与行政单位，卡内基梅隆大学警察局也设在这里。",
      tags: ["行政", "克雷格街", "安全"]
    },

    "w121054817": {
      nameZh: "克雷格南街 400 号（卡内基梅隆大学）", nameEn: "BAO (CMU)",
      function: "大学办公用房",
      description: "卡内基梅隆在南克雷格街的一处办公用房。",
      tags: ["行政", "克雷格街"]
    },

    "w44157441": {
      nameZh: "惠特菲尔德楼", nameEn: "Whitfield Hall",
      built: "1931",
      architect: "Lamont Button",
      function: "大学办公用房",
      description: "北克雷格街上的一座 1931 年建筑，原为名叫 College Club 的俱乐部会所，后被卡内基梅隆购入作办公用途。",
      tags: ["行政", "历史建筑"]
    },

    "w545283494": {
      nameZh: "4721 第五大道（校园设计与设施发展部）", nameEn: "Campus Design and Facility Development",
      address: "第五大道 4721 号",
      built: "1918；近年翻新",
      function: "大学行政办公",
      description: "第五大道 4721 号是一座建于 1918 年的历史建筑，经大学翻新后获 LEED 金级认证，用作大学传播与市场等部门的办公楼。",
      tags: ["行政", "历史建筑", "绿色建筑"]
    },

    "w27630034": {
      nameZh: "校友之家", nameEn: "Alumni House",
      address: "福布斯大道 5017 号",
      function: "校友关系",
      description: "福布斯大道北侧、门牌 5017 号的一栋小楼，是大学校友关系部门的所在地。",
      tags: ["行政", "校友"]
    },

    "w27643509": {
      nameZh: "布拉默楼", nameEn: "Bramer House",
      address: "莫尔伍德大道 1045 号",
      function: "大学服务用房",
      description: "莫尔伍德大道 1045 号的一栋大学服务用房，位于马奇宿舍与校园之间的住宅街区。",
      tags: ["行政"]
    },

    "w44150736": {
      nameZh: "兰德大楼", nameEn: "Rand Building",
      address: "第五大道 4570 号",
      function: "办公楼（卡内基梅隆使用部分空间）",
      description: "第五大道 4570 号的办公楼，列于卡内基梅隆的楼宇清单中，大学的部分研究与行政单位在此办公。",
      tags: ["行政"]
    },

    // ── Neighbours: Pitt, Carnegie Institute, Schenley Park & Oakland ──────────────────────
    "w30678664": {
      nameZh: "学习大教堂", nameEn: "Cathedral of Learning",
      built: "1926–1937（1937 年正式落成）",
      architect: "查尔斯·克劳德（Charles Klauder）",
      style: "晚期哥特复兴，带装饰艺术元素",
      floors: 42,
      function: "匹兹堡大学教学楼",
      description: "这座 42 层、约 163 米高的哥特式“摩天楼”是匹兹堡大学的主楼，也是西半球最高的教育建筑。一层的大厅（Commons Room）高达四层，拱顶全靠石材自身支撑；楼内 31 间“民族教室”按各国传统风格装修，其中也包括一间中国教室。从卡内基梅隆校园的许多角落都能望见它。",
      facts: ["钢结构外包印第安纳石灰石，1926 年动工，1931 年开始上课。", "列入美国国家史迹名录。"],
      tags: ["匹兹堡大学", "邻近机构", "地标", "哥特复兴"]
    },

    "w30678681": {
      nameZh: "亨氏纪念教堂", nameEn: "Heinz Memorial Chapel",
      built: "1933–1938",
      architect: "查尔斯·克劳德（Charles Klauder）",
      style: "法国哥特复兴",
      function: "匹兹堡大学的跨宗派教堂",
      description: "亨氏纪念教堂由番茄酱大王亨利·约翰·亨氏（H. J. Heinz）为纪念母亲而发起，由他的子女续捐完成，1938 年落成。教堂两侧高约 22 米的彩色玻璃窗位列世界最高之列，全教堂 23 扇花窗约含 25 万块玻璃；这里也是深受欢迎的婚礼场所。",
      tags: ["匹兹堡大学", "邻近机构", "宗教建筑", "哥特复兴"]
    },

    "w31899524": {
      nameZh: "匹兹堡卡内基图书馆（总馆）", nameEn: "Carnegie Library of Pittsburgh – Main (Oakland)",
      built: "1895；1907 年大规模扩建",
      architect: "Longfellow, Alden & Harlow",
      style: "布扎（Beaux-Arts）文艺复兴风格",
      function: "公共图书馆总馆",
      description: "卡内基捐建的这座图书馆 1895 年开放，与音乐厅、自然历史博物馆和艺术博物馆同处一座庞大的“卡内基学院”建筑群中，象征着卡内基让普通人也能自由获取知识的理想。卡内基一生在世界各地捐建了两千多座公共图书馆，匹兹堡是他财富起步的地方。",
      tags: ["邻近机构", "图书馆", "卡内基", "历史建筑"]
    },

    "w154257484": {
      nameZh: "卡内基音乐厅", nameEn: "Carnegie Music Hall",
      built: "1895",
      architect: "Longfellow, Alden & Harlow",
      style: "布扎（Beaux-Arts）风格",
      function: "音乐厅",
      description: "卡内基学院建筑群中的音乐厅，1895 年与图书馆同时启用，以华丽的门厅闻名。门前的草坪上站着真实大小的梁龙雕塑 Dippy。",
      tags: ["邻近机构", "音乐", "卡内基"]
    },

    "w154257481": {
      nameZh: "卡内基自然历史博物馆", nameEn: "Carnegie Museum of Natural History",
      built: "1895 年开馆，此后多次扩建",
      function: "自然历史博物馆",
      description: "卡内基自然历史博物馆以恐龙收藏闻名世界：卡内基资助的考察队 1899 年在怀俄明州发现的梁龙被命名为 Diplodocus carnegii（昵称 Dippy），其复制骨架曾被送往伦敦、巴黎等多国博物馆；馆内还收藏有霸王龙的正模标本。全馆藏品超过两千万件。",
      tags: ["邻近机构", "博物馆", "恐龙", "卡内基"]
    },

    "w31899525": {
      nameZh: "卡内基艺术博物馆", nameEn: "Carnegie Museum of Art",
      built: "1895 年创立；斯凯夫画廊 1974 年增建",
      function: "艺术博物馆",
      description: "卡内基希望收藏“明天的古典大师”，因此这里常被视为美国最早关注当代艺术的博物馆之一。始于 1896 年的“卡内基国际展”（Carnegie International）是北美历史最悠久的当代艺术国际大展之一；馆内还有仿照帕特农神庙内部的雕塑大厅和海因茨建筑中心。",
      facts: ["门前广场有肯尼斯·斯内尔森的张拉整体雕塑《森林魔鬼》和乔治·里奇的动态雕塑《两条细线》。"],
      tags: ["邻近机构", "博物馆", "艺术", "卡内基"]
    },

    "w810149910": {
      nameZh: "弗里克美术楼", nameEn: "Frick Fine Arts Building",
      built: "1962–1965",
      architect: "Burton Kenneth Johnstone",
      style: "新文艺复兴风格，仿罗马朱利亚别墅（Villa Giulia）",
      function: "匹兹堡大学艺术史与建筑史系、工作室艺术系、美术图书馆",
      description: "这座白色石灰石的意大利文艺复兴式建筑由亨利·克莱·弗里克之女海伦·克莱·弗里克出资兴建，1965 年落成，是匹兹堡大学艺术史与建筑史系的家。围绕中庭的回廊陈列着尼古拉斯·洛霍夫临摹的意大利文艺复兴壁画复制品，楼内还有大学美术馆和藏书逾九万册的美术图书馆。",
      tags: ["匹兹堡大学", "邻近机构", "艺术"]
    },

    "w154905396": {
      nameZh: "信息科学大楼", nameEn: "Information Sciences Building",
      style: "粗野主义",
      function: "匹兹堡大学计算与信息学院",
      description: "匹兹堡大学计算与信息学院所在的混凝土大楼，位于北贝勒菲尔德大道。",
      tags: ["匹兹堡大学", "邻近机构"]
    },

    "r2785563": {
      nameZh: "菲普斯温室植物园", nameEn: "Phipps Conservatory and Botanical Gardens",
      built: "1893 年开放；2003–2006 年扩建访客中心与热带森林温室",
      architect: "Lord & Burnham",
      style: "维多利亚式玻璃温室",
      function: "温室植物园",
      description: "菲普斯温室由钢铁巨头亨利·菲普斯（Henry Phipps，卡内基的合伙人）捐赠给匹兹堡，1893 年开放，是美国最精美的维多利亚式玻璃温室之一。如今它有十几个室内展厅和大片户外花园，棕榈厅里还悬挂着戴尔·奇胡利的玻璃艺术作品。",
      facts: ["访客中心的新维多利亚式玻璃穹顶是 2000 年代扩建的一部分。", "列入美国国家史迹名录。"],
      tags: ["申利公园", "邻近机构", "植物园", "地标"]
    },

    "r18260908": {
      nameZh: "菲普斯温室植物园（新温室）", nameEn: "Phipps Conservatory – Production & Tropical Greenhouses",
      function: "温室与苗圃",
      description: "菲普斯温室的新建部分，包括热带森林温室和植物生产温室——后者是全球第一座获得 LEED 铂金级认证的温室。",
      tags: ["申利公园", "邻近机构", "绿色建筑"]
    },

    "w392348779": {
      nameZh: "可持续景观中心", nameEn: "Center for Sustainable Landscapes",
      built: "2012 年 12 月启用",
      function: "菲普斯温室的教育、科研与办公楼",
      description: "菲普斯温室的可持续景观中心 2012 年启用，自行发电、自行处理雨水与污水，获得 LEED 铂金级认证并通过“生态建筑挑战”（Living Building Challenge），被誉为世界上最环保的建筑之一。",
      tags: ["申利公园", "邻近机构", "绿色建筑"]
    },

    "w305687963": {
      nameZh: "申利公园咖啡馆及游客中心", nameEn: "Schenley Park Café and Visitor Center",
      function: "公园游客服务",
      description: "申利公园入口附近的小咖啡馆和游客中心，可以在这里拿地图、歇歇脚，再出发去逛步道和菲普斯温室。",
      tags: ["申利公园", "餐饮"]
    },

    "w302715370": {
      nameZh: "贝勒菲尔德锅炉厂", nameEn: "Bellefield Boiler Plant",
      built: "1907",
      architect: "Longfellow, Alden & Harlow",
      function: "奥克兰区集中供热",
      description: "这座 1907 年建成的锅炉厂藏在交汇谷里，由匹兹堡大学、卡内基梅隆、UPMC、卡内基博物馆等机构共同拥有，为整个奥克兰文化区输送暖气蒸汽。2009 年停烧燃煤、改用天然气；因作家迈克尔·夏邦的小说《匹兹堡之谜》而得名“云工厂”。",
      tags: ["邻近机构", "工业遗产", "能源"]
    },

    "w158307506": {
      nameZh: "罗德夫·沙洛姆会堂", nameEn: "Rodef Shalom Congregation",
      built: "1907",
      architect: "Palmer & Hornbostel（亨利·霍恩博斯特尔）",
      style: "布扎风格，奶油色砖与釉面陶砖",
      function: "犹太教会堂",
      description: "这座犹太教会堂与卡内基梅隆出自同一位建筑师——霍恩博斯特尔。它的奶油色砖墙和釉面陶砖与校园一脉相承，中央穹顶采用瓜斯塔维诺（Guastavino）瓦拱技术，不用钢材即可跨越约 28 米。会堂旁的圣经植物园种有一百多种《圣经》中提到的植物。",
      tags: ["邻近机构", "宗教建筑", "Hornbostel", "历史建筑"]
    },

    "w104431158": {
      nameZh: "圣保罗主教座堂", nameEn: "Saint Paul Cathedral",
      built: "1906",
      architect: "Egan & Prindeville",
      style: "哥特复兴，参照德国科隆大教堂",
      function: "匹兹堡天主教教区主教座堂",
      description: "这座 1906 年落成的哥特复兴式大教堂是匹兹堡天主教教区的主教座堂，双塔尖高约 75 米，设计灵感来自科隆大教堂。教堂的冯·贝克拉特管风琴以音色著称，旁边的石窟里供奉着“克雷格街圣母”像。",
      tags: ["邻近机构", "宗教建筑", "哥特复兴"]
    },

    "w544174671": {
      nameZh: "中央天主教高中", nameEn: "Central Catholic High School",
      function: "天主教男子高中",
      description: "由天主教喇沙会（基督学校修士会）主办的男子高中，校园在第五大道旁，距卡内基梅隆的泰珀广场不远。",
      facts: ["校园里立有喇沙会创始人圣若翰·喇沙（St. John Baptist de La Salle）的雕像。"],
      tags: ["邻近机构", "中学"]
    },

    "w544174673": {
      nameZh: "WQED 电视台", nameEn: "WQED",
      function: "公共广播电视台",
      description: "WQED 1954 年开播，是美国第一家由社区资助的教育电视台。家喻户晓的儿童节目《罗杰斯先生的邻居》（Mister Rogers' Neighborhood）就在这里的演播室制作了三十多年。卡内基梅隆也在这栋楼中使用部分空间。",
      tags: ["邻近机构", "媒体", "电视"]
    },

    "w104431166": {
      nameZh: "匹兹堡华人教会", nameEn: "Pittsburgh Chinese Church",
      function: "教会",
      description: "位于北迪思里奇街的华人教会，是奥克兰一带华人社区的聚会场所之一。",
      tags: ["邻近机构", "宗教建筑"]
    }
  };

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // Landmarks (non-building or multi-part places). `position` = world metres [x, y, z].
  // ────────────────────────────────────────────────────────────────────────────────────────────
  var landmarks = {
    fence: {
      nameZh: "涂鸦栅栏", nameEn: "The Fence",
      built: "1923；1993 年重建为钢筋混凝土栅栏",
      function: "学生社团的“广告牌”",
      description: "涂鸦栅栏（The Fence）立在卡特草坪南端，是卡内基梅隆最有名的传统。原本的木栅栏在 1923 年建成，据说学校曾打算拆除，一个兄弟会趁夜把派对广告刷了上去，结果办成了史上最热闹的派对，从此涂刷栅栏成了传统。按照规矩，只能在午夜到日出之间用手刷涂刷，不许用喷漆或滚筒，也不能刮掉旧漆；为防被别的社团抢先覆盖，涂刷的社团常整夜派人守在栅栏旁。",
      facts: [
        "吉尼斯世界纪录曾称它为“世界上被涂刷次数最多的物体”，油漆一度厚达约 15 厘米。",
        "1993 年，原木栅栏终于被层层油漆压垮，学校随即用钢筋混凝土重建，传统延续至今。"
      ],
      tags: ["传统", "学生生活", "地标"],
      position: [-37, 53, 84]
    },

    walkingToTheSky: {
      nameZh: "走向天空", nameEn: "Walking to the Sky",
      built: "2006 年 5 月安装（2009 年更换杆体）",
      architect: "乔纳森·博罗夫斯基（Jonathan Borofsky，1964 届校友）",
      style: "公共雕塑：不锈钢长杆与人物群像",
      description: "一根约 30 米高、重达 7 吨的不锈钢长杆斜插天际，一群真人大小的人物——小女孩、职业女性、年轻人……正沿着它向上行走，地面上还有三个人仰头望着他们。这件作品由校友乔纳森·博罗夫斯基创作，校董吉尔·甘斯曼·克劳斯夫妇捐赠，2006 年立在华纳楼前、面朝福布斯大道，寓意想象、抱负与蜕变。",
      facts: [
        "落成之初因选址和审美颇有争议，如今已是从福布斯大道望向校园时最醒目的标志。",
        "2016 年 5 月至 11 月，杆上的人物曾被整体取下维修翻新。"
      ],
      tags: ["公共艺术", "地标", "雕塑"],
      position: [9, 48.2, -127]
    },

    scotty: {
      nameZh: "Scotty 铜像", nameEn: "Scotty Statue",
      built: "2021 年 11 月安放，2022 年 4 月揭幕庆典",
      architect: "雷蒙德·卡斯基（Raymond Kaskey，1967 届校友）",
      description: "苏格兰梗犬 Scotty 是卡内基梅隆的吉祥物（2007 年正式确立），向安德鲁·卡内基的苏格兰出身致敬。这尊青铜像安放在科翁中心南侧的 Merson 庭院，由校友雕塑家雷·卡斯基创作、校友凯西·萨贝克·达克斯夫妇捐赠。花岗岩基座兼作长凳，Scotty 的尾巴还被设计成方便攀爬的“把手”，大家可以爬上去与它合影。",
      tags: ["公共艺术", "吉祥物", "学生生活"],
      position: [65, 49.7, -16]
    },

    stadium: {
      nameZh: "盖斯林体育场", nameEn: "Gesling Stadium",
      aka: "Richard M. Lackner Field at Gesling Stadium",
      built: "1987–1990（1990 年启用）",
      architect: "Michael Dennis, Jeffrey Clark & Associates / TAMS",
      function: "橄榄球与田径主场",
      description: "盖斯林体育场 1990 年启用，可容纳约 3900 名观众，是卡内基梅隆 Tartans 橄榄球队与田径队的主场，也是匹兹堡市内最大的、专为大学橄榄球修建的球场。场内的比赛场地以长期执教的橄榄球主教练里奇·拉克纳（Rich Lackner）命名，看台背后便是科翁中心和东校区宿舍。",
      facts: ["比赛日，身着苏格兰短裙的 Kiltie 乐队会在看台上为球队助威。", "人造草坪也用于英式橄榄球、魁地奇等俱乐部与校内比赛。"],
      tags: ["体育", "学生生活", "地标"],
      position: [226, 47.3, -24]
    },

    randyPauschBridge: {
      nameZh: "兰迪·波许纪念桥", nameEn: "Randy Pausch Memorial Footbridge",
      built: "2009 年 10 月 30 日落成",
      architect: "Mack Scogin Merrill Elam Architects；灯光 C & C Lighting",
      description: "这座步行桥连接计算机学院的盖茨中心与戏剧学院的珀内尔艺术中心，纪念计算机教授兰迪·波许（Randy Pausch）——他毕生致力于连接艺术与计算机科学，2007 年，身患胰腺癌的他发表《最后一课》，感动了无数人，次年去世。桥栏的双层铝板上镂刻着企鹅图案，来自他讲过的“第一只企鹅奖”故事；夜晚约 7000 盏 LED 灯会上演灯光秀。",
      facts: ["2009 年落成时，由波许的妻子和三个孩子剪彩。"],
      tags: ["纪念", "地标", "计算机", "艺术"],
      position: [-100, 45, -25]
    },

    krausCampo: {
      nameZh: "Kraus Campo 花园", nameEn: "Kraus Campo",
      built: "2002–2004",
      architect: "艺术家梅尔·博赫纳（Mel Bochner，1962 届校友）与景观设计师迈克尔·范·沃肯伯格（Michael Van Valkenburgh）",
      description: "Kraus Campo 是位于波斯纳中心屋顶、美术学院与波斯纳楼之间的艺术花园：中央是一座 7.6 × 18 米、形如“曲线板”（French curve）的瓷砖平台，白底上嵌着黑色数字序列，并刻有哲学家维特根斯坦的名言；亮橙色小径在黄杨、杜鹃和小檗丛中蜿蜒。博赫纳希望它像古希腊的集市（agora）一样，成为不同学科的人偶遇、交谈的“思想市场”。",
      tags: ["公共艺术", "花园", "艺术"],
      position: [43, 56.9, 175]
    },

    dippy: {
      nameZh: "梁龙 Dippy 雕塑", nameEn: "Dippy",
      built: "1999 年 7 月落成",
      description: "卡内基博物馆门前这只真实大小的梁龙雕塑长约 26 米、高约 7 米，纪念 1899 年卡内基资助的考察队在怀俄明州发现梁龙化石整整一百周年。这种恐龙因此被命名为 Diplodocus carnegii，原骨架就在身后的自然历史博物馆里。匹兹堡人常给 Dippy 围上本地球队的围巾，它早已是奥克兰的吉祥物。",
      tags: ["公共艺术", "恐龙", "卡内基", "地标"],
      position: [-721, 32.2, -61]
    },

    buggy: {
      nameZh: "Buggy 赛道", nameEn: "Buggy (Sweepstakes) Course",
      aka: "Sweepstakes",
      built: "始于 1920 年",
      description: "Buggy 是春季嘉年华最刺激的比赛：学生组织打造碳纤维流线型的无动力小车，把体型娇小的驾驶员“塞”进去，由五名推手接力，先推上 Tech 街和申利大道的坡道（第一、二坡），再任其沿申利大道自由滑行，在急转弯“滑槽”（the chute）处急转右拐冲上 Frew 街，完成第三到第五坡后抵达终点，全程约 1.35 公里，滑行时速可达约 55 公里。",
      facts: ["预赛和决赛分别在嘉年华的周五、周六上午进行，申利大道两旁挤满观众。", "赛道起点在 MMCH 旁的 Tech 街与 Margaret Morrison 街路口，终点在 Tech 街与 Frew 街路口。"],
      tags: ["传统", "春季嘉年华", "体育"],
      position: [-435, 37, 240]
    },

    carnival: {
      nameZh: "春季嘉年华 Midway", nameEn: "Spring Carnival Midway",
      description: "每年四月的春季嘉年华是卡内基梅隆最盛大的节日，学校会放一个四天的长周末。美术学院旁的停车场会变成 Midway：学生社团按当年主题搭起两层楼高的巨型展台，里面设有游戏，评比日间与夜间效果、主题契合度和可玩性；旁边还有游乐设施和小吃摊。",
      facts: ["嘉年华与 Buggy 赛都可追溯到 1920 年。"],
      tags: ["传统", "春季嘉年华", "学生生活"],
      position: [40, 50.2, 114]
    },

    kiltieBand: {
      nameZh: "Kiltie 乐队", nameEn: "The Kiltie Band",
      built: "1908 年创建",
      description: "Kiltie 乐队 1908 年由七名学生创建，队员身着苏格兰格子短裙演出，以纪念安德鲁·卡内基的苏格兰血统；如今已发展到上百人，常在橄榄球赛、嘉年华和校园庆典上亮相。",
      tags: ["传统", "音乐", "学生生活"],
      position: [226, 47.3, -24]
    }
  };

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // Areas — keyed by CAMPUS_DATA area name (exact OSM spelling)
  // ────────────────────────────────────────────────────────────────────────────────────────────
  var areas = {
    "The Cut": {
      nameZh: "卡特草坪", nameEn: "The Cut",
      description: "卡特草坪（The Cut）是纵贯校园中部的大草坪，从中央大草坪东端一直向北延伸到福布斯大道。这里原本是一道峡谷，建校时用平整山丘（为修建美术学院大楼）挖出的土方填平而成，因此得名。草坪南端立着著名的涂鸦栅栏，平日里有人读书、野餐，活动季则搭满帐篷。",
      tags: ["草坪", "学生生活"]
    },

    "The Mall": {
      nameZh: "中央大草坪", nameEn: "The Mall",
      aka: "Hornbostel Mall",
      formerly: "荣誉庭院（Court of Honor）",
      built: "1904 年起按霍恩博斯特尔规划逐步成形",
      architect: "亨利·霍恩博斯特尔",
      description: "中央大草坪（The Mall）是霍恩博斯特尔规划的校园主轴线，他最初称之为“荣誉庭院”：西端是哈默施拉格楼，东端是美术学院大楼，北侧为多尔蒂楼和韦恩楼，南侧为贝克楼与波特楼。一百多年来，后来的建筑师几乎都忠实地延续了这一布局。",
      tags: ["草坪", "历史", "Hornbostel"]
    },

    "CFA Lawn": {
      nameZh: "美术学院草坪", nameEn: "CFA Lawn",
      description: "美术学院大楼正前方的草坪，位于中央大草坪与卡特草坪的交汇处，是毕业季拍照和户外课的热门地点。",
      tags: ["草坪"]
    },

    "Tepper Quad": {
      nameZh: "泰珀广场草坪", nameEn: "Tepper Quad",
      aka: "David A. Tepper Quadrangle",
      built: "2018",
      description: "福布斯大道北侧的泰珀广场是校园向北扩展的新中心，泰珀大楼等新建筑环绕着这片草坪。广场的建成让福布斯大道两侧的校园真正连成一体。",
      tags: ["草坪", "商学院"]
    },

    "Merson Courtyard": {
      nameZh: "Merson 庭院", nameEn: "Merson Courtyard",
      description: "科翁大学中心南侧、面朝校园中心的石铺庭院，常用于集会和社团摆摊；吉祥物 Scotty 的铜像就安放在这里，校园参观团也常在此结束行程。",
      tags: ["广场", "学生生活"]
    },

    "Peace Garden": {
      nameZh: "和平花园", nameEn: "Peace Garden",
      built: "1961",
      architect: "Griswold, Winters and Swain",
      formerly: "Fine Arts Garden（美术花园）",
      description: "位于亨特图书馆与美术学院之间的小花园，原名美术花园（Fine Arts Garden），1961 年与亨特图书馆同期建成，是在图书馆读累了出来透口气的好地方。",
      tags: ["花园"]
    },

    "Kraus Winter Garden": {
      nameZh: "克劳斯冬季花园", nameEn: "Kraus Winter Garden",
      architect: "Michael Van Valkenburgh Associates",
      description: "盖茨中心与希尔曼中心围合出的户外“冬季花园”，顺着原有地形布置步道、长椅、成片树丛和雨水花园，由设计 Kraus Campo 的同一位景观设计师完成。",
      tags: ["花园", "计算机"]
    },

    "Mudge Courtyard": {
      nameZh: "马奇庭院", nameEn: "Mudge Courtyard",
      description: "马奇宿舍的原宅邸与两座加建翼楼围合出的内庭院，草坪与石墙营造出英式庄园般的安静氛围。",
      tags: ["宿舍", "庭院"]
    },

    "Donner Ditch": {
      nameZh: "唐纳沟草坡", nameEn: "Donner Ditch",
      description: "唐纳宿舍门前向下倾斜的草坡，被学生们戏称为“唐纳沟”。天气好时，这里满是晒太阳、扔飞盘的学生。",
      tags: ["草坪", "学生生活"]
    },

    "Schenley Park": {
      nameZh: "申利公园", nameEn: "Schenley Park",
      built: "1889",
      description: "申利公园紧邻卡内基梅隆东南，面积约 456 英亩（约 185 公顷），是匹兹堡第二大市立公园。1889 年，玛丽·申利捐出 300 英亩土地，市政府又购入 120 英亩；时任公共工程主管爱德华·比格洛为抢在开发商之前拿下这片地，专门派律师远赴伦敦。园内有菲普斯温室、弗拉格斯塔夫山（夏夜露天电影）、黑豹谷湖、高尔夫球场与椭圆运动场，也是 Buggy 比赛和校越野队的主场。",
      tags: ["公园", "自然", "邻近"]
    },

    "Bob O'Connor Golf Course": {
      nameZh: "鲍勃·奥康纳高尔夫球场", nameEn: "Bob O'Connor Golf Course",
      description: "申利公园内的公共高尔夫球场，以 2006 年在任内去世的匹兹堡市长鲍勃·奥康纳命名，起伏的球道就在校园东南方的山坡上。",
      tags: ["公园", "体育"]
    },

    "Schenley Plaza": {
      nameZh: "申利广场", nameEn: "Schenley Plaza",
      description: "学习大教堂与卡内基图书馆之间的城市广场，曾经是停车场，2006 年恢复为通往申利公园的“大门”：中央是大草坪，四周有旋转木马、餐饮亭和花园，是奥克兰学生最爱的户外客厅。",
      tags: ["公园", "广场", "邻近"]
    },

    "Mary Schenley Memorial Fountain": {
      nameZh: "玛丽·申利纪念喷泉", nameEn: "Mary Schenley Memorial Fountain",
      aka: "A Song to Nature（自然之歌）",
      built: "1918",
      architect: "雕塑家维克多·戴维·布伦纳（Victor David Brenner）",
      description: "位于申利广场南端、申利公园入口处的纪念喷泉，纪念捐地建园的玛丽·申利。青铜群像题为《自然之歌》（A Song to Nature），以牧神潘与吟唱的少女为主题。",
      tags: ["纪念", "公共艺术", "邻近"]
    },

    "Westinghouse Pond": {
      nameZh: "威斯汀豪斯池塘与纪念碑", nameEn: "Westinghouse Pond & Memorial",
      built: "池塘 1896；纪念碑 1930",
      architect: "亨利·霍恩博斯特尔与埃里克·费舍尔·伍德（建筑）；丹尼尔·切斯特·弗伦奇（雕塑）",
      description: "申利公园深处的睡莲池旁立着乔治·威斯汀豪斯纪念碑，1930 年在他生日那天揭幕，建筑部分同样出自卡内基梅隆的设计师霍恩博斯特尔，雕塑则由林肯纪念堂坐像的作者丹尼尔·切斯特·弗伦奇完成：一名少年凝视着讲述这位发明家一生的浮雕。",
      tags: ["公园", "纪念", "Hornbostel"]
    },

    "Panther Hollow Bridge": {
      nameZh: "黑豹谷桥", nameEn: "Panther Hollow Bridge",
      built: "1895–1896",
      description: "申利公园里横跨黑豹谷的拱桥，桥头四角蹲着意大利裔雕塑家朱塞佩·莫雷蒂 1897 年创作的四只青铜黑豹，像哨兵一样守望山谷。",
      tags: ["公园", "桥梁", "历史"]
    },

    "Schenley Bridge": {
      nameZh: "申利桥", nameEn: "Schenley Bridge",
      description: "连接申利广场与申利公园、横跨交汇谷（Junction Hollow）的桥梁；站在桥上可以同时望见卡内基梅隆的哈默施拉格楼和山谷里的锅炉厂。",
      tags: ["桥梁", "邻近"]
    },

    "Phipps Conservatory": {
      nameZh: "菲普斯温室花园", nameEn: "Phipps Conservatory Gardens",
      description: "菲普斯温室周围的户外花园，与维多利亚式玻璃温室一起构成申利公园西北角最美的一处景点。",
      tags: ["花园", "申利公园"]
    },

    "Cathedral Lawn": {
      nameZh: "学习大教堂草坪", nameEn: "Cathedral Lawn",
      description: "环绕匹兹堡大学学习大教堂的草坪，是 Pitt 学生晒太阳、办活动的核心场所，也是仰拍这座哥特式高楼的最佳位置。",
      tags: ["草坪", "匹兹堡大学"]
    },

    "Mazeroski Field": {
      nameZh: "马泽罗斯基球场", nameEn: "Mazeroski Field",
      description: "这座小型棒球场位于昔日福布斯球场（Forbes Field，匹兹堡海盗队 1909–1970 年的主场）旧址一带，以 1960 年世界大赛第七场打出“再见全垒打”的海盗队名将比尔·马泽罗斯基命名，附近仍保留着一段老球场的外野墙。",
      tags: ["体育", "历史", "邻近"]
    },

    "Rodef Shalom Biblical Botanical Garden": {
      nameZh: "罗德夫·沙洛姆圣经植物园", nameEn: "Rodef Shalom Biblical Botanical Garden",
      built: "1987",
      description: "罗德夫·沙洛姆会堂旁约三分之一英亩的小植物园，种植一百多种《圣经》中提到的植物，并用小溪、瀑布和水池象征约旦河、加利利湖与死海，是北美同类花园中规模最大的之一，每年夏季免费开放。",
      tags: ["花园", "邻近"]
    },

    "Scaife Woods": {
      nameZh: "斯凯夫林地", nameEn: "Scaife Woods",
      description: "斯凯夫楼西侧顺坡而下的一小片林地，连接老校园与交汇谷、申利公园的绿地。",
      tags: ["自然"]
    }
  };

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // POIs — keyed by CAMPUS_DATA poi name (exact OSM spelling)
  // ────────────────────────────────────────────────────────────────────────────────────────────
  var pois = {
    "Dr. Mao Yisheng Statue": {
      nameZh: "茅以升像", nameEn: "Statue of Dr. Mao Yisheng",
      built: "2006 年 4 月 18 日揭幕",
      architect: "雕塑家孙路（Sun Lu）等",
      description: "这尊青铜像纪念中国现代桥梁工程奠基人茅以升：他 1917 年来到卡内基理工学院攻读土木工程博士，1919 年以 23 岁之龄成为学校历史上第一位博士。回国后他主持修建了钱塘江大桥——中国人自己设计建造的第一座公路铁路两用桥。铜像立在贝克楼与波特楼之间、面朝中央大草坪，是学校公共艺术委员会主持安装的第一件作品，揭幕仪式上，他的女儿和孙辈也专程出席。",
      tags: ["公共艺术", "纪念", "中国", "校友"]
    },

    "Snowmen": {
      nameZh: "《雪人》", nameEn: "Snowmen",
      architect: "加里·休姆（Gary Hume）",
      description: "英国艺术家加里·休姆“雪人”系列中的一件，以简洁的圆形体块和明快色彩（青铜上釉彩）表现雪人，2004 年由米尔顿与希拉·法恩夫妇捐赠，立在多尔蒂楼旁。下雪天，它偶尔会被“戴上”一顶真正的雪帽。",
      tags: ["公共艺术", "雕塑"]
    },

    "La Prima Espresso": {
      nameZh: "La Prima 咖啡", nameEn: "La Prima Espresso",
      description: "源自匹兹堡 Strip 区的老牌意式咖啡馆在校园里的分店，韦恩楼和盖茨中心各有一家，是理工科学生熬夜赶作业的“续命站”。",
      tags: ["餐饮", "咖啡"]
    },

    "Sorrells Library": {
      nameZh: "索雷尔斯图书馆", nameEn: "Sorrells Library",
      description: "位于韦恩楼内的工程与科学图书馆，收藏理工科书刊，也有大量安静的自习座位。",
      tags: ["图书馆", "学习"]
    },

    "De Fer Coffee & Tea": {
      nameZh: "De Fer 咖啡", nameEn: "De Fer Coffee & Tea",
      description: "亨特图书馆一层的咖啡馆，本地烘焙品牌，边喝咖啡边复习是很多学生的日常。",
      tags: ["餐饮", "咖啡"]
    },

    "Schatz Dining Room": {
      nameZh: "Schatz 餐厅", nameEn: "Schatz Dining Room",
      description: "科翁大学中心里的自助餐厅，也常用于举办正式晚宴和校园活动。",
      tags: ["餐饮", "学生生活"]
    },

    "Carnegie Mellon Police Station": {
      nameZh: "卡内基梅隆大学警察局", nameEn: "Carnegie Mellon University Police",
      description: "位于南克雷格街 300 号的大学警察局，24 小时负责校园安全，也提供夜间护送等服务。",
      tags: ["安全", "学生服务"]
    },

    "Hillel Jewish University Center": {
      nameZh: "希勒尔犹太大学中心", nameEn: "Hillel Jewish University Center",
      description: "服务匹兹堡各高校犹太学生的活动中心，位于福布斯大道与克雷格街一带。",
      tags: ["学生生活", "邻近"]
    },

    "Inverted Dancer": {
      nameZh: "《倒立的舞者》", nameEn: "Inverted Dancer",
      architect: "撒迪厄斯·莫斯利（Thaddeus Mosley）",
      built: "2022",
      description: "匹兹堡本土雕塑家撒迪厄斯·莫斯利创作的约 2.6 米高青铜雕塑，灵感来自爵士乐，仿佛挣脱了重力的舞者，立在第五-克莱德宿舍前。",
      tags: ["公共艺术", "雕塑"]
    },

    "The Love of Two Oranges": {
      nameZh: "《两只橙子之恋》", nameEn: "For the Love of Two Oranges",
      architect: "克拉克·温特（Clark Winter）",
      built: "1969",
      description: "四块鲜橙色钢块组成的极简主义雕塑，属于卡内基梅隆的公共艺术收藏，现立于第五-内维尔公寓旁。",
      tags: ["公共艺术", "雕塑"]
    },

    "Forest Devil": {
      nameZh: "《森林魔鬼》", nameEn: "Forest Devil",
      architect: "肯尼斯·斯内尔森（Kenneth Snelson）",
      built: "1977",
      description: "卡内基艺术博物馆门前的张拉整体（tensegrity）雕塑：抛光钢管彼此不接触，仅靠航空钢索的拉力悬浮成形，由匹兹堡本地钢铁企业协助制造。",
      tags: ["公共艺术", "雕塑", "卡内基"]
    },

    "Two Slender Lines": {
      nameZh: "《两条细线》", nameEn: "Two Slender Lines",
      architect: "乔治·里奇（George Rickey）",
      built: "1981",
      description: "动态雕塑大师乔治·里奇的不锈钢作品，两根细长的钢针随风缓缓摆动，属于卡内基艺术博物馆的户外收藏。",
      tags: ["公共艺术", "雕塑", "卡内基"]
    },

    "Nicholas Lochoff Cloister": {
      nameZh: "洛霍夫回廊", nameEn: "Nicholas Lochoff Cloister",
      description: "弗里克美术楼中庭四周的回廊，陈列俄国画家尼古拉斯·洛霍夫临摹的意大利文艺复兴名作复制品（1911 年受托绘制），让人仿佛置身佛罗伦萨的修道院。",
      tags: ["艺术", "匹兹堡大学"]
    },

    "University Art Gallery": {
      nameZh: "匹兹堡大学美术馆", nameEn: "University Art Gallery (Pitt)",
      description: "位于弗里克美术楼内的匹兹堡大学美术馆，免费对公众开放。",
      tags: ["艺术", "博物馆", "匹兹堡大学"]
    },

    "Statue of Christopher Columbus": {
      nameZh: "哥伦布像", nameEn: "Statue of Christopher Columbus",
      architect: "弗兰克·维托（Frank Vittor）",
      description: "申利公园内、菲普斯温室附近的哥伦布雕像，由匹兹堡雕塑家弗兰克·维托创作。",
      tags: ["纪念", "申利公园"]
    },

    "Edward Manning Bigelow": {
      nameZh: "爱德华·比格洛纪念像", nameEn: "Edward Manning Bigelow Monument",
      built: "1895",
      architect: "朱塞佩·莫雷蒂（Giuseppe Moretti）",
      description: "纪念“匹兹堡公园之父”爱德华·曼宁·比格洛的纪念像，立在申利大道中央。比格洛主持创建了申利公园；Buggy 比赛中，这座纪念像正位于自由滑行段的终点、急转弯“滑槽”之前。",
      tags: ["纪念", "申利公园", "Buggy"]
    },

    "The Hiker - Spanish American War Memorial": {
      nameZh: "“远足者”美西战争纪念像", nameEn: "The Hiker – Spanish–American War Memorial",
      description: "申利广场附近纪念美西战争老兵的青铜雕像，一名手持步枪的士兵正在行军，同题作品在全美各地都有复制。",
      tags: ["纪念", "邻近"]
    },

    "St. John Baptist de La Salle Statue": {
      nameZh: "圣若翰·喇沙像", nameEn: "St. John Baptist de La Salle Statue",
      description: "中央天主教高中校园内的雕像，纪念基督学校修士会（喇沙会）创始人、17 世纪法国教育家圣若翰·喇沙。",
      tags: ["纪念", "邻近"]
    },

    "Our Lady of Craig Street": {
      nameZh: "克雷格街圣母", nameEn: "Our Lady of Craig Street",
      description: "圣保罗主教座堂旁石窟里的圣母像，面向北克雷格街。",
      tags: ["宗教", "邻近"]
    },

    "Westinghouse Shelter": {
      nameZh: "威斯汀豪斯凉亭", nameEn: "Westinghouse Shelter",
      description: "申利公园威斯汀豪斯池塘附近的休息凉亭，是野餐和散步途中歇脚的地方。",
      tags: ["公园"]
    }
  };

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // Guided tour — target = look-at point, position = camera (world metres; y above base elevation).
  // Framings computed from CAMPUS_DATA centroids / terrain and checked in renders for occlusion. `target` is the
  // centre of what the stop talks about: while touring, the UI shifts the projection so the target sits in the middle
  // of the screen area above the narration card (src/ui/framing.js), so do not aim below the subject to dodge the card.
  // ────────────────────────────────────────────────────────────────────────────────────────────
  var tour = [
    {
      key: "overview",
      title: "序章：钢城里的学术高地", titleEn: "Prologue: Carnegie Mellon at a Glance",
      text: "欢迎来到卡内基梅隆大学匹兹堡主校区。1900 年，钢铁大王安德鲁·卡内基捐资创办了一所技术学校，建筑师霍恩博斯特尔为它规划了这片黄砖绿瓦的布扎风格校园。眼前这条东西向的长草坪就是中央大草坪（The Mall），远处那座高耸的哥特式塔楼则是邻居匹兹堡大学的学习大教堂。接下来，我们从北面的福布斯大道出发，走遍整座校园。",
      target: [-150, 116, 100], position: [91, 172, 165], duration: 16
    },
    {
      key: "tepperQuad",
      title: "泰珀广场：福布斯大道上的新门户", titleEn: "Tepper Quad: The New Front Door",
      text: "福布斯大道北侧的泰珀广场 2018 年落成，标志着校园向北跨过福布斯大道的大规模扩展。玻璃中庭的泰珀大楼里有商学院、600 座的 Simmons 礼堂和 Coulter 访客中心，许多访客的校园之旅正是从这里开始。商学院的前身 GSIA 是现代管理科学与决策研究的重要发源地，诺贝尔奖得主赫伯特·西蒙就曾在那里任教。",
      target: [-170, 51, -230], position: [2, 117, -150], duration: 15
    },
    {
      key: "walkingToTheSky",
      title: "《走向天空》与华纳楼", titleEn: "Walking to the Sky & Warner Hall",
      text: "穿过福布斯大道，一根约 30 米高的不锈钢长杆斜插天际，一群真人大小的人物正沿杆向上行走，地面上还有人仰头张望——这是校友乔纳森·博罗夫斯基 2006 年的作品《走向天空》。雕塑西侧的华纳楼是大学的行政中枢，校长办公室和本科招生办公室都在楼里。",
      target: [13.5, 64, -127], position: [40, 81, -173], duration: 14
    },
    {
      key: "cutFence",
      title: "卡特草坪与涂鸦栅栏", titleEn: "The Cut & The Fence",
      text: "这片开阔的草坪叫卡特草坪（The Cut），原本是一道峡谷，建校时用平整山丘挖出的土方填平而成。草坪南端那道不起眼的栅栏就是大名鼎鼎的涂鸦栅栏（The Fence）：按照传统，学生社团只能在午夜到日出之间用手刷涂刷它来宣传活动，油漆一度厚达约 15 厘米，被吉尼斯纪录称为“世界上被涂刷次数最多的物体”。1993 年原木栅栏被油漆压垮，如今的钢筋混凝土栅栏延续着这一传统。",
      target: [-37, 58, 84], position: [1, 82, -19], duration: 17
    },
    {
      key: "cohonScotty",
      title: "科翁中心与吉祥物 Scotty", titleEn: "Cohon Center & Scotty",
      text: "科翁大学中心是全校的“客厅”，餐厅、书店、体育馆、游泳池和舞厅都在这里。2007 年 9 月，身患癌症的计算机教授兰迪·波许在楼内的 McConomy 礼堂讲授了《最后一课》，感动了全世界无数人。眼前南侧 Merson 庭院里、守在玻璃中庭门口的青铜苏格兰梗犬就是校园吉祥物 Scotty，由校友雕塑家雷·卡斯基创作，2021 年安放于此。",
      target: [64.8, 50.9, -16.1], position: [57.5, 54.6, -3], duration: 16
    },
    {
      key: "gatesPausch",
      title: "盖茨中心与兰迪·波许纪念桥", titleEn: "Gates Center & the Pausch Bridge",
      text: "2009 年启用的盖茨-希尔曼中心是计算机科学学院的大本营，折线形的楼体顺着山坡层层跌落。连接它与戏剧学院珀内尔中心的，是兰迪·波许纪念桥——波许毕生致力于连接艺术与计算机，桥栏上镂刻着他故事里的企鹅，夜晚由约 7000 盏 LED 点亮。附近的韦恩楼与纽厄尔-西蒙楼同样星光熠熠：网络表情 :-)、最早接入网络的可乐贩卖机和赢得 DARPA 城市挑战赛的无人车，都出自这里的计算机与机器人团队。",
      target: [-108, 50, -38], position: [-100, 100, 35], duration: 18
    },
    {
      key: "mall",
      title: "中央大草坪：霍恩博斯特尔的荣誉庭院", titleEn: "The Mall: Hornbostel's Court of Honor",
      text: "从校园西端向东望去，这条长长的草坪就是中央大草坪（The Mall），霍恩博斯特尔最初称之为“荣誉庭院”。左手边是韦恩楼和多尔蒂楼，右手边是波特楼与贝克楼，尽头是美术学院大楼；一百多年来，后来的建筑师几乎都忠实地延续了这条轴线。天气晴好时，草坪上满是读书、晒太阳的学生。",
      target: [-80, 61, 120], position: [-329, 130, 98], duration: 15
    },
    {
      key: "hamerschlag",
      title: "哈默施拉格楼：校园之冠", titleEn: "Hamerschlag Hall: The Crown of Campus",
      text: "中央大草坪西端崖顶上的哈默施拉格楼，是卡内基梅隆的象征。它 1906 年动工、分期建成，原名机械馆（Machinery Hall），最初是全校的动力站与机械工坊，圆形塔楼和塔顶烟囱让它从远处一眼可辨，如今是电气与计算机工程系的家。楼的背后是陡峭的交汇谷，谷底铁路与申利公园近在咫尺。",
      target: [-314, 54, 71], position: [-165, 106, 84], duration: 15
    },
    {
      key: "bakerPorter",
      title: "贝克楼、波特楼与茅以升像", titleEn: "Baker & Porter Halls, and Mao Yisheng",
      text: "中央大草坪南侧这排黄砖长楼是最早的校舍之一，1905 年起陆续建成，如今是人文与社会科学学院和土木工程系的所在。贝克楼那条贯穿全楼的倾斜长走廊流传着一个传说：万一学校办不下去，大楼还能改成靠重力运转的工厂。两楼之间立着中国桥梁专家茅以升的铜像——他 1919 年在这里获得学校历史上第一个博士学位，后来主持修建了钱塘江大桥。",
      target: [-225, 58, 150], position: [-110, 97, 108], duration: 18
    },
    {
      key: "huntCfa",
      title: "亨特图书馆与美术学院", titleEn: "Hunt Library & the College of Fine Arts",
      text: "这座铝材与玻璃包裹的方盒子是 1961 年启用的亨特图书馆，捐赠者亨特家族与美国铝业公司渊源深厚。旁边的美术学院大楼是霍恩博斯特尔的得意之作：正立面的石雕壁龛依次展示希腊、罗马、中世纪、文艺复兴和世界各地的建筑装饰，本身就是一部建筑史教科书。波普艺术大师安迪·沃霍尔 1949 年就从这里毕业。",
      target: [-30, 65, 185], position: [-151, 86, 115], duration: 17
    },
    {
      key: "mmchKraus",
      title: "MMCH、Kraus Campo 与春季嘉年华", titleEn: "Margaret Morrison, Kraus Campo & Spring Carnival",
      text: "带半圆形柱廊的玛格丽特·莫里森·卡内基楼原是一所女子学院，以卡内基母亲的名字命名，如今是建筑学院和设计学院的家。美术学院与波斯纳楼之间的屋顶花园 Kraus Campo，是艺术家梅尔·博赫纳与景观师范·沃肯伯格合作的“思想市场”。每年四月的春季嘉年华，美术学院旁的停车场会变成 Midway，学生社团在这里搭起两层楼高的主题游戏展台。",
      target: [80, 49.2, 118], position: [180, 125.5, 260], duration: 17
    },
    {
      key: "buggy",
      title: "Buggy 赛道与申利公园", titleEn: "The Buggy Course & Schenley Park",
      text: "从菲普斯温室上空望向校园。眼前这片大草坡是弗拉格斯塔夫山（Flagstaff Hill），每年嘉年华始于 1920 年的 Buggy 接力赛就绕着它进行：推手们先把流线型的无动力小车推上 Tech 街和申利大道的坡顶，小车再沿申利大道一路自由滑行，时速可达约 55 公里；到左前方坡底的急转弯“滑槽”右转冲上 Frew 街，再经坡顶的波特楼、贝克楼接力推到终点。约 456 英亩的申利公园则始于 1889 年玛丽·申利的捐地。",
      target: [-350, 41.5, 215], position: [-470, 104.4, 450], duration: 18
    },
    {
      key: "stadiumEast",
      title: "盖斯林体育场与东校区", titleEn: "Gesling Stadium & East Campus",
      text: "1990 年启用的盖斯林体育场是 Tartans 橄榄球与田径队的主场，比赛日身着苏格兰短裙的 Kiltie 乐队会在看台上助威。周围的雷斯尼克、西翼和唐纳宿舍住着大批新生，唐纳宿舍门前的草坡被昵称为“唐纳沟”；再往东南，坡上的博斯、麦吉尔等“山上”宿舍早在 1915 年就已建成。",
      target: [240, 59, 40], position: [151, 142, -150], duration: 16
    },
    {
      key: "mellonInstitute",
      title: "梅隆研究所：名字的另一半", titleEn: "Mellon Institute: The Other Half of the Name",
      text: "沿第五大道向西，这座被 62 根整块石灰岩爱奥尼柱环绕的神殿式建筑，就是 1937 年落成的梅隆研究所。这里原是安德鲁·梅隆和理查德·梅隆兄弟创办的梅隆工业研究所，1967 年它与卡内基理工学院合并，才有了“卡内基梅隆”这个名字。如今这里是梅隆理学院院部以及生物、化学两系的实验室。",
      target: [-683, 51, -360], position: [-833, 128, -415], duration: 16
    },
    {
      key: "oaklandFinale",
      title: "终章：奥克兰文化区", titleEn: "Finale: Oakland's Cultural Heart",
      text: "旅程的终点是卡内基梅隆的西邻——匹兹堡奥克兰文化区。163 米高的学习大教堂是西半球最高的教育建筑，旁边是彩窗高约 22 米的亨氏纪念教堂；卡内基博物馆门前那只真实大小的梁龙 Dippy，纪念的正是卡内基资助发现的恐龙化石。钢铁、慈善与知识在这里交汇——欢迎继续自由探索！",
      target: [-730, 107.9, -110], position: [-480, 148.1, -240], duration: 18
    }
  ];

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // Non-enumerable aliases: lookups by alternative keys resolve to the canonical entry, while
  // Object.keys()/for…in still list each place exactly once (keeps search results de-duplicated).
  // ────────────────────────────────────────────────────────────────────────────────────────────
  function alias(obj, key, target) {
    if (!target || Object.prototype.hasOwnProperty.call(obj, key)) return;
    Object.defineProperty(obj, key, { value: target, enumerable: false, configurable: true, writable: true });
  }

  // Building-based landmark modules (src/landmarks/*.js) → their building entries
  var landmarkBuildings = {
    hamerschlag: "w27551077", bakerPorter: "w27590907", baker: "w27590907", porter: "w27549961",
    cfa: "w27591225", mmch: "w27591314", hunt: "w27574204", gates: "w27623372", cohon: "w27574394",
    tepper: "w583510520", mellonInstitute: "w25795368", cathedralOfLearning: "w30678664",
    heinzChapel: "w30678681", phipps: "r2785563", carnegieMuseum: "w154257481",
    carnegieMuseumOfNaturalHistory: "w154257481", carnegieMuseumOfArt: "w31899525",
    carnegieLibrary: "w31899524", carnegieMusicHall: "w154257484", wean: "w27551364",
    doherty: "w27574545", warner: "w27574704", purnell: "w27574406", newellSimon: "w27551590",
    scottHall: "r13441031", highmark: "w1039908831"
  };
  for (var k in landmarkBuildings) alias(landmarks, k, buildings[landmarkBuildings[k]]);

  // Other alternative keys
  alias(buildings, "w220799870", landmarks.stadium);            // Gesling Stadium stands (OSM building)
  alias(buildings, "w27591588", buildings["w27591583"]);  // Roselawn Houses (3 OSM footprints)
  alias(buildings, "w27591593", buildings["w27591583"]);
  alias(areas, "Gesling Stadium", landmarks.stadium);
  alias(areas, "Kraus Campo", landmarks.krausCampo);
  alias(pois, "Walking to the Sky", landmarks.walkingToTheSky);
  alias(pois, "Scotty Statue", landmarks.scotty);
  alias(pois, "Dippy", landmarks.dippy);
  alias(landmarks, "gesling", landmarks.stadium);
  alias(landmarks, "geslingStadium", landmarks.stadium);
  alias(landmarks, "pauschBridge", landmarks.randyPauschBridge);
  alias(landmarks, "theFence", landmarks.fence);
  alias(landmarks, "springCarnival", landmarks.carnival);
  alias(landmarks, "midway", landmarks.carnival);
  alias(landmarks, "sweepstakes", landmarks.buggy);
  alias(landmarks, "maoYisheng", pois["Dr. Mao Yisheng Statue"]);
  alias(landmarks, "snowmen", pois["Snowmen"]);

  root.CAMPUS_INFO = {
    meta: meta,
    buildings: buildings,
    landmarks: landmarks,
    areas: areas,
    pois: pois,
    tour: tour
  };
})(typeof window !== 'undefined' ? window : globalThis);
