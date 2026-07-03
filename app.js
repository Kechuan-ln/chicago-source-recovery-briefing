
const DATA = window.BRIEFING_DATA;

const sourceState = { active: "taxi" };
const chartState = { active: "overall" };
const pairState = { active: "taxi_tnc" };
const archState = { active: "nyc" };

function fmt(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) return "NA";
  return Number(value).toFixed(digits);
}

function percent(value, digits = 1) {
  if (value === null || value === undefined) return "NA";
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function createSvg(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
  return el;
}

function svgText(svg, x, y, content, attrs = {}) {
  const t = createSvg("text", { x, y, ...attrs });
  t.textContent = content;
  svg.appendChild(t);
  return t;
}

/* ============ 白话翻译层：数据里的内部名词只在这里出现一次 ============ */

const PAIR_PLAIN = {
  "Taxi/TNC": "同类互借（出租车↔网约车）",
  "Taxi/Divvy": "跨方式（出租车↔单车）",
};

const DIRECTION_PLAIN = {
  "taxi → tnc": "用出租车 补 网约车",
  "tnc → taxi": "用网约车 补 出租车",
  "divvy → taxi": "用单车 补 出租车",
  "taxi → divvy": "用出租车 补 单车",
};

function plainChartLabel(item) {
  const label = item.label || "";
  if (chartState.active === "overall") return PAIR_PLAIN[item.sourcePair] || label;
  if (chartState.active === "direction") return DIRECTION_PLAIN[label] || label;
  if (chartState.active === "split") {
    return label.replace("高流量走廊被隐藏", "考题：补主干流向").replace("长距离走廊被隐藏", "考题：补长距离流向");
  }
  // budget: "Taxi/TNC 目标标签 0.1%" → "锚点 0.1%"
  const m = label.match(/([\d.]+%)$/);
  return m ? `锚点 ${m[1]}` : label;
}

const LADDER_PLAIN = {
  frozen_baseline: {
    label: "完全不借",
    sub: "只查惯常基线：这个区、星期几的这个钟点，平常多少人",
  },
  source_direct_concat: {
    label: "简单换算",
    sub: "单车流量乘一个系数当出租车流量——证明参考方式有用",
  },
  g113_teacher_first_neural_translator: {
    label: "聪明借用（我们的模型）",
    sub: "小神经网络判断：何时该信单车，何时守住惯常基线",
  },
};

const METRIC_PLAIN = {
  positive_cpc: "和真实流向的重合度（CPC）",
  positive_rmse: "流量数值误差（RMSE）",
  positive_nrmse: "流量误差·按规模折算（NRMSE）",
  js_divergence: "整体分布形状（JSD）",
  trip_length_l1: "出行距离构成（L1）",
  topk_ndcg: "最大流向的排序（NDCG）",
  topk_precision: "找主干流向：找得准",
  topk_recall: "找主干流向：找得全",
  normalized_srmse: "结构误差（SRMSE）",
  high_flow_log_mae: "主干流向的误差（log MAE）",
  positive_log_mae: "整体误差（log MAE）",
  heldout_corridor_log_mae: "从未见过的流向（log MAE）",
  no_harm_rate: "不帮倒忙率",
};

const MIX_PLAIN = {
  direct: "直接换算类",
  align: "分布对齐类",
  routed: "带裁判的借用",
  deep: "深度网络",
  hybrid: "锚点+借用混合",
  null: "陷阱选手",
};

const NULL_ROW_PLAIN = {
  "Taxi/TNC": "同类互借赛场",
  "Taxi/Divvy": "跨方式赛场",
};

/* ---------------- hero map ---------------- */

function setupTabs() {
  const tabs = document.querySelector("[data-map-tabs]");
  const sources = [
    ["taxi", "出租车流向"],
    ["tnc", "网约车流向"],
    ["divvy", "共享单车站点"],
  ];
  tabs.innerHTML = sources.map(([key, label]) => `<button data-source="${key}" class="${key === sourceState.active ? "active" : ""}">${label}</button>`).join("");
  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-source]");
    if (!button) return;
    sourceState.active = button.dataset.source;
    tabs.querySelectorAll("button").forEach((btn) => btn.classList.toggle("active", btn.dataset.source === sourceState.active));
    renderMap();
  });
}

const MAP_LABELS = ["Loop", "Near North Side", "Ohare"];

function flowPath(flow) {
  // Perpendicular-offset control point: bow scales with distance, fixed side,
  // so overlapping corridors fan out instead of stacking on one arc.
  const dx = flow.x2 - flow.x1;
  const dy = flow.y2 - flow.y1;
  const dist = Math.hypot(dx, dy) || 1;
  const bow = Math.min(0.22 * dist, 46);
  const mx = (flow.x1 + flow.x2) / 2 - (dy / dist) * bow;
  const my = (flow.y1 + flow.y2) / 2 + (dx / dist) * bow;
  return `M${flow.x1},${flow.y1} Q${mx},${my} ${flow.x2},${flow.y2}`;
}

function renderMap() {
  const container = document.getElementById("hero-map");
  const caption = document.getElementById("map-caption");
  const map = DATA.map;
  const source = DATA.sources[sourceState.active];
  container.innerHTML = "";
  const svg = createSvg("svg", { viewBox: `0 0 ${map.width} ${map.height}`, role: "img", "aria-label": "芝加哥社区人流地图" });

  const areaLayer = createSvg("g", { class: "area-layer" });
  map.areas.forEach((area) => {
    areaLayer.appendChild(createSvg("path", { class: "area-path", d: area.d }));
  });
  svg.appendChild(areaLayer);

  if (source.kind === "flows") {
    const maxCount = Math.max(...source.flows.map((f) => f.count));
    const flowLayer = createSvg("g", { class: "flow-layer" });
    source.flows.forEach((flow) => {
      const share = Math.sqrt(flow.count / maxCount);
      const path = createSvg("path", {
        class: `flow-line ${sourceState.active}`,
        d: flowPath(flow),
        "stroke-width": (1.4 + share * 5.6).toFixed(2),
        opacity: (0.3 + share * 0.55).toFixed(2),
        "data-tip": `${flow.originName} → ${flow.destinationName}<br>4 月一周的出行次数：${flow.count.toLocaleString()}`,
      });
      path.addEventListener("mouseenter", () => flowLayer.classList.add("dimmed"));
      path.addEventListener("mouseleave", () => flowLayer.classList.remove("dimmed"));
      flowLayer.appendChild(path);
    });
    svg.appendChild(flowLayer);
  } else {
    const stationLayer = createSvg("g", { class: "station-layer" });
    source.stations.forEach((station) => {
      stationLayer.appendChild(createSvg("circle", {
        class: "station-dot",
        cx: station.x,
        cy: station.y,
        r: 3.1,
        opacity: 0.78,
        "data-tip": `${station.name}<br>站点编号：${station.id}`,
      }));
    });
    svg.appendChild(stationLayer);
  }

  const dotLayer = createSvg("g", { class: "centroid-layer" });
  map.areas.forEach((area) => {
    dotLayer.appendChild(createSvg("circle", { class: "centroid-dot", cx: area.cx, cy: area.cy, r: 1.5 }));
  });
  svg.appendChild(dotLayer);

  const labelLayer = createSvg("g", { class: "map-label-layer" });
  map.areas.filter((a) => MAP_LABELS.includes(a.name)).forEach((area) => {
    const display = area.name === "Ohare" ? "O'Hare 机场" : area.name;
    const halo = createSvg("text", { x: area.cx + 8, y: area.cy - 6, class: "map-label halo", "text-anchor": "start" });
    halo.textContent = display;
    const label = createSvg("text", { x: area.cx + 8, y: area.cy - 6, class: "map-label", "text-anchor": "start" });
    label.textContent = display;
    labelLayer.appendChild(halo);
    labelLayer.appendChild(label);
  });
  svg.appendChild(labelLayer);

  container.appendChild(svg);
  attachMapTooltip(container);

  if (sourceState.active === "taxi") {
    caption.innerHTML = `出租车：真实记录的 4 月一周流向，共 ${source.rows.toLocaleString()} 条"从哪到哪"、合计 ${source.total.toLocaleString()} 次出行。图中画出最大的 ${source.flows.length} 条——市中心和机场是两个极点。`;
  } else if (sourceState.active === "tnc") {
    caption.innerHTML = `网约车：同一周的真实流向，共 ${source.rows.toLocaleString()} 条记录、${source.total.toLocaleString()} 次出行，比出租车更密。在芝加哥赛场里，它和出租车互为"最像的邻居"。`;
  } else {
    caption.innerHTML = `共享单车：图中是 ${source.stationCount} 个真实站点的分布（实验周内约 ${Math.round(source.eventsInWeek).toLocaleString()} 次骑行）。<br><span class="subtle">它的完整流向表恰好没有同步到本机——这正是"目标方式"缺数据处境的真实写照。页面里它的成绩来自计算集群上已完成的汇总。</span>`;
  }
}

function attachMapTooltip(container) {
  const tip = document.createElement("div");
  tip.className = "map-tooltip";
  tip.hidden = true;
  container.appendChild(tip);
  container.querySelectorAll("[data-tip]").forEach((el) => {
    el.addEventListener("mousemove", (event) => {
      tip.innerHTML = el.getAttribute("data-tip");
      tip.hidden = false;
      const rect = container.getBoundingClientRect();
      tip.style.left = `${event.clientX - rect.left}px`;
      tip.style.top = `${event.clientY - rect.top}px`;
    });
    el.addEventListener("mouseleave", () => {
      tip.hidden = true;
    });
  });
}

/* ---------------- NYC ladder ---------------- */

function renderNycLadder() {
  const nyc = DATA.nyc;
  const container = document.getElementById("nyc-ladder");
  container.innerHTML = "";
  const width = 880;
  const pad = 20;
  const rowH = 88;
  const height = 64 + nyc.ladder.length * rowH + 40;
  const svg = createSvg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "纽约实验三种做法的平均误差对比" });
  const left = 290;
  const right = width - 130;
  const maxV = Math.max(...nyc.ladder.map((d) => d.rawWape));
  const scale = (v) => (v / maxV) * (right - left);
  const colors = ["#9d9487", "#c5972f", "#0c7c72"];

  svgText(svg, left, 30, `平均误差率（越低越好） · ${nyc.testRows.toLocaleString()} 个考题`, { fill: "#59645f", "font-size": 14 });

  nyc.ladder.forEach((row, i) => {
    const plain = LADDER_PLAIN[row.model] || { label: row.label, sub: row.sub };
    const y = 60 + i * rowH;
    svgText(svg, pad, y + 20, plain.label, { fill: "#17201c", "font-size": 16, "font-weight": 700 });
    plain.sub.match(/.{1,22}/g).forEach((line, j) => {
      svgText(svg, pad, y + 40 + j * 15, line, { fill: "#59645f", "font-size": 12 });
    });
    svg.appendChild(createSvg("rect", { x: left, y: y + 6, width: right - left, height: 30, fill: "#efeadf", rx: 4 }));
    const w = scale(row.rawWape);
    svg.appendChild(createSvg("rect", { x: left, y: y + 6, width: w, height: 30, fill: colors[i], rx: 4, class: "grow-bar" }));
    svgText(svg, left + w + 10, y + 27, percent(row.rawWape, 1), { fill: "#17201c", "font-size": 17, "font-weight": 800 });
    if (i > 0) {
      const prev = nyc.ladder[i - 1].rawWape;
      const drop = ((prev - row.rawWape) / prev) * 100;
      svgText(svg, right + 14, y + 27, `再降${drop.toFixed(0)}%`, { fill: "#0c7c72", "font-size": 13.5, "font-weight": 700 });
    }
  });

  svgText(svg, pad, height - 10, "误差从 77.7% 降到 35.1%：借用有效（第 1→2 行），而且“会借”比“硬借”更值钱（第 2→3 行）。", { fill: "#17201c", "font-size": 14, "font-weight": 700 });
  container.appendChild(svg);
}

function renderNycChips() {
  const nyc = DATA.nyc;
  const g = nyc.ladder[2];
  const chips = [
    ["锚点数量", `${nyc.trainRows.toLocaleString()} / ${nyc.trainFull.toLocaleString()} 条（仅 ${nyc.labelPct}%）`],
    ["城市划分", `${nyc.zones} 个区 · 每 30 分钟一格`],
    ["模型输入", `每格 ${nyc.fit.featureDim} 个数字（单车流量、时间、地点、惯常偏差）`],
    ["模型大小", `一层 ${nyc.fit.hiddenDim} 个神经元的小网络，笔记本就能训练`],
    ["突发人流识别", `F1 ${fmt(g.hotspotF1, 2)}：十次高峰能抓到约八次`],
    ["涨跌方向判断", `相关度 ${fmt(g.signedCorr, 2)}：该升该降基本不看错`],
    ["最难时段的误差", `${percent(g.srcRequiredWape, 1)}（必须靠单车才能答对的时段）`],
    ["锚点覆盖", `只覆盖 ${percent(nyc.anchorFrac, 1)} 的区，其余区照样恢复`],
  ];
  document.getElementById("nyc-chips").innerHTML = chips.map(([k, v]) => `
    <div class="chip"><span class="chip-key">${k}</span><span class="chip-value">${v}</span></div>
  `).join("");
}

/* ---------------- architecture diagrams ---------------- */

const ARCH_NOTES = {
  nyc: `<p><strong>训练明细（来自实验记录文件，非示意）：</strong>只用 2,048 条锚点训练；训练时对"必须靠单车才能答对"的时段加权，逼网络学会借。"老师"是简单换算（验证集误差 54.4%），学生网络最终 36.6%——学生明确超过了老师，说明网络学到了换算学不到的东西。</p>`,
  chicago: `<p><strong>训练明细（来自评测代码）：</strong>损失函数对离群值稳健（SmoothL1），每批训练 4,096 条。这类深度选手共 5 个家族 × 3 种输入组合 = 15 个，与 32 个非深度方法同场竞技。"配平"步骤保证输出永远非负、且每区进出合计与实测分毫不差。</p>`,
};

function archBlock(svg, x, y, w, h, title, sub, kind) {
  const fills = { input: "#fffdf8", train: "#d8efea", frozen: "#ece9e1", post: "#f6ecd4", out: "#17201c" };
  const strokes = { input: "#c4573f", train: "#0c7c72", frozen: "#9d9487", post: "#c5972f", out: "#17201c" };
  svg.appendChild(createSvg("rect", { x, y, width: w, height: h, rx: 8, fill: fills[kind], stroke: strokes[kind], "stroke-width": 1.6 }));
  const titleColor = kind === "out" ? "#ffffff" : "#17201c";
  const subColor = kind === "out" ? "rgba(255,255,255,0.8)" : "#59645f";
  const lines = Array.isArray(title) ? title : [title];
  lines.forEach((line, i) => {
    svgText(svg, x + w / 2, y + 22 + i * 18, line, { "text-anchor": "middle", fill: titleColor, "font-size": 14.5, "font-weight": 700 });
  });
  if (sub) {
    const subLines = Array.isArray(sub) ? sub : [sub];
    subLines.forEach((line, i) => {
      svgText(svg, x + w / 2, y + 22 + lines.length * 18 + i * 16, line, { "text-anchor": "middle", fill: subColor, "font-size": 12 });
    });
  }
}

function archArrow(svg, x1, y1, x2, y2, dashed = false) {
  svg.appendChild(createSvg("path", {
    d: `M${x1},${y1} L${x2},${y2}`,
    stroke: "#8a8174",
    "stroke-width": 1.8,
    fill: "none",
    "marker-end": "url(#arch-arrow)",
    ...(dashed ? { "stroke-dasharray": "5 4" } : {}),
  }));
}

function archDefs(svg) {
  const defs = createSvg("defs");
  const marker = createSvg("marker", { id: "arch-arrow", markerWidth: 9, markerHeight: 9, refX: 7, refY: 3, orient: "auto" });
  marker.appendChild(createSvg("path", { d: "M0,0 L0,6 L8,3 z", fill: "#8a8174" }));
  defs.appendChild(marker);
  svg.appendChild(defs);
}

function archLegend(svg, x, y) {
  const items = [
    ["input", "输入数据"],
    ["train", "可训练（会学习）"],
    ["frozen", "查表 / 固定规则"],
    ["post", "安全约束"],
  ];
  const fills = { input: "#fffdf8", train: "#d8efea", frozen: "#ece9e1", post: "#f6ecd4" };
  const strokes = { input: "#c4573f", train: "#0c7c72", frozen: "#9d9487", post: "#c5972f" };
  items.forEach(([kind, label], i) => {
    const lx = x + i * 150;
    svg.appendChild(createSvg("rect", { x: lx, y: y - 11, width: 16, height: 12, rx: 3, fill: fills[kind], stroke: strokes[kind], "stroke-width": 1.4 }));
    svgText(svg, lx + 22, y, label, { fill: "#59645f", "font-size": 12.5 });
  });
}

function renderArchNyc(container) {
  const width = 1160;
  const height = 540;
  const svg = createSvg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "纽约聪明借用模型的结构" });
  archDefs(svg);

  svgText(svg, 24, 34, "聪明借用模型（纽约：用共享单车补出租车）", { fill: "#17201c", "font-size": 19, "font-weight": 800 });
  svgText(svg, 24, 56, "预测 = 惯常基线（查表） + 网络学到的“单车能解释的偏差”", { fill: "#59645f", "font-size": 13.5 });

  const inputs = [
    { title: "共享单车流量", sub: ["当前时段与之前几段", "每 30 分钟一格"] },
    { title: "时间信息", sub: ["几点、星期几", "等周期特征"] },
    { title: "地点信息", sub: ["69 个区", "的编号"] },
    { title: "惯常偏差 + 锚点", sub: ["现在比平常多多少", "1.57% 区的实时读数"] },
  ];
  const inW = 200; const inH = 80; const inX = 24;
  inputs.forEach((b, i) => {
    const y = 84 + i * 92;
    archBlock(svg, inX, y, inW, inH, b.title, b.sub, "input");
    archArrow(svg, inX + inW, y + inH / 2, 300, 268);
  });

  archBlock(svg, 300, 230, 150, 76, ["拼成一行", "91 个数字"], null, "frozen");
  archArrow(svg, 450, 268, 496, 268);
  archBlock(svg, 496, 216, 190, 104, ["全连接层", "91 → 256"], ["256 个神经元", "训练时随机屏蔽 5% 防死记"], "train");
  archArrow(svg, 686, 268, 730, 268);
  archBlock(svg, 730, 230, 160, 76, ["全连接层", "256 → 1"], ["输出：对惯常的修正量"], "train");
  archArrow(svg, 890, 268, 950, 268);

  svg.appendChild(createSvg("circle", { cx: 972, cy: 268, r: 20, fill: "#fffdf8", stroke: "#17201c", "stroke-width": 1.6 }));
  svgText(svg, 972, 274, "⊕", { "text-anchor": "middle", fill: "#17201c", "font-size": 20, "font-weight": 700 });
  archArrow(svg, 992, 268, 1022, 268);
  archBlock(svg, 1022, 230, 118, 76, ["出租车需求", "预测"], null, "out");

  archBlock(svg, 496, 356, 190, 64, ["简单换算（老师）"], ["先给学生打底", "老师自己误差 54.4%"], "frozen");
  archArrow(svg, 591, 356, 591, 324, true);
  svgText(svg, 700, 392, "先训老师、再训学生；学生（36.6%）必须超过老师才算数", { fill: "#59645f", "font-size": 12.5 });

  archBlock(svg, 24, 462, 340, 64, ["惯常基线（查表，不训练）"], ["每个区 × 一周 168 个钟点的历史平均"], "frozen");
  archArrow(svg, 364, 494, 966, 286);

  archLegend(svg, 560, height - 14);
  container.appendChild(svg);
}

function renderArchChicago(container) {
  const width = 1160;
  const height = 500;
  const svg = createSvg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "芝加哥赛场深度选手的结构" });
  archDefs(svg);

  svgText(svg, 24, 34, "赛场上的深度选手（芝加哥 47 方法中的神经网络一支）", { fill: "#17201c", "font-size": 19, "font-weight": 800 });
  svgText(svg, 24, 56, "网络只学“每格流量该乘多少的修正”；不出负数、进出合计对得上，由“配平”在结构上保证", { fill: "#59645f", "font-size": 13.5 });

  const embY = 84;
  const embs = [
    { title: "时段编号", sub: "名片：12 个可学数字" },
    { title: "出发区编号", sub: "名片：12 个可学数字" },
    { title: "到达区编号", sub: "名片：12 个可学数字" },
  ];
  embs.forEach((b, i) => {
    const y = embY + i * 74;
    archBlock(svg, 24, y, 176, 62, b.title, b.sub, "train");
    archArrow(svg, 200, y + 31, 262, 250);
  });
  archBlock(svg, 24, embY + 3 * 74, 176, 120, ["已算好的线索"], ["两区距离 · 参考方式流量", "邻区扩散 · 历史滞后", "进出总量等"], "input");
  archArrow(svg, 200, embY + 3 * 74 + 60, 262, 262);

  archBlock(svg, 262, 218, 140, 76, ["拼成一行"], ["名片 + 线索"], "frozen");
  archArrow(svg, 402, 256, 440, 256);
  archBlock(svg, 440, 204, 168, 104, ["全连接层 → 96"], ["96 个神经元"], "train");
  archArrow(svg, 608, 256, 636, 256);
  archBlock(svg, 636, 204, 168, 104, ["全连接层 96→96"], ["再加工一遍"], "train");
  archArrow(svg, 804, 256, 832, 256);
  archBlock(svg, 832, 218, 130, 76, ["全连接 96→1"], ["输出修正量"], "train");
  archArrow(svg, 962, 256, 990, 256);
  archBlock(svg, 990, 196, 150, 66, ["安全限幅"], ["修正幅度封顶"], "post");
  archArrow(svg, 1065, 262, 1065, 288);
  archBlock(svg, 915, 288, 226, 62, ["惯常底稿 × 修正倍数"], null, "post");
  archArrow(svg, 1028, 350, 1028, 376);
  archBlock(svg, 862, 376, 278, 66, ["配平"], ["微调行列，让每区进出合计", "与实测一致；结果自动非负"], "post");

  archBlock(svg, 262, 376, 300, 66, ["惯常底稿（不训练）"], ["由进出总量 + 锚点搭出的粗版流向表"], "frozen");
  archArrow(svg, 562, 409, 915, 330);

  archBlock(svg, 616, 376, 216, 66, ["裁判"], ["先在验证数据上试用借用", "不灵就退回“不借”"], "train");
  archArrow(svg, 724, 376, 724, 322, true);
  svgText(svg, 730, 366, "逐格判断：参考方式不可信，就不借", { fill: "#59645f", "font-size": 12 });

  archLegend(svg, 560, height - 14);
  container.appendChild(svg);
}

function renderArch() {
  const container = document.getElementById("arch-visual");
  container.innerHTML = "";
  if (archState.active === "nyc") renderArchNyc(container);
  else renderArchChicago(container);
  document.getElementById("arch-notes").innerHTML = ARCH_NOTES[archState.active];
}

function setupArchTabs() {
  const tabs = document.querySelector("[data-arch-tabs]");
  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-arch]");
    if (!button) return;
    archState.active = button.dataset.arch;
    tabs.querySelectorAll("button").forEach((btn) => btn.classList.toggle("active", btn === button));
    renderArch();
  });
  renderArch();
}

/* ---------------- family gain chart ---------------- */

function setupCharts() {
  const tabs = document.querySelector("[data-chart-tabs]");
  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-chart]");
    if (!button) return;
    chartState.active = button.dataset.chart;
    tabs.querySelectorAll("button").forEach((btn) => btn.classList.toggle("active", btn === button));
    renderChart();
  });
  renderChart();
  renderNullChart();
}

function chartItems() {
  if (chartState.active === "overall") return DATA.results.overall;
  if (chartState.active === "direction") return DATA.results.direction;
  if (chartState.active === "split") return DATA.results.split;
  return DATA.results.budget;
}

function renderChart() {
  const items = chartItems();
  const container = document.getElementById("result-chart");
  container.innerHTML = "";
  const width = Math.max(860, items.length * 120 + 220);
  const height = 420;
  const svg = createSvg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "借用阵营相对不借阵营的平均改进" });
  const margin = { left: 92, right: 40, top: 72, bottom: 118 };
  const values = items.flatMap((d) => [d.meanGain, d.ciLow, d.ciHigh]).filter((d) => d !== null && d !== undefined);
  const min = Math.min(0, ...values);
  const max = Math.max(0.05, ...values);
  const y = (v) => margin.top + (max - v) / (max - min || 1) * (height - margin.top - margin.bottom);
  const xStep = (width - margin.left - margin.right) / items.length;
  const barW = Math.min(54, xStep * 0.58);

  for (let tick = 0; tick <= 4; tick += 1) {
    const value = min + (max - min) * tick / 4;
    const yy = y(value);
    svg.appendChild(createSvg("line", { x1: margin.left, x2: width - margin.right, y1: yy, y2: yy, stroke: "#e1dbcf", "stroke-width": 1 }));
    svgText(svg, margin.left - 14, yy + 5, fmt(value, 2), { "text-anchor": "end", fill: "#59645f", "font-size": 13 });
  }

  const zeroY = y(0);
  svg.appendChild(createSvg("line", { x1: margin.left, x2: width - margin.right, y1: zeroY, y2: zeroY, stroke: "#17201c", "stroke-width": 1.3 }));

  items.forEach((item, i) => {
    const cx = margin.left + xStep * i + xStep / 2;
    const barTop = y(Math.max(0, item.meanGain));
    const color = item.sourcePair === "Taxi/TNC" ? "#0c7c72" : "#c4573f";
    svg.appendChild(createSvg("rect", {
      x: cx - barW / 2,
      y: Math.min(barTop, zeroY),
      width: barW,
      height: Math.max(2, Math.abs(zeroY - barTop)),
      fill: color,
      opacity: 0.9,
      rx: 3,
      class: "grow-bar",
    }));
    if (item.ciLow !== null && item.ciHigh !== null) {
      svg.appendChild(createSvg("line", { x1: cx, x2: cx, y1: y(item.ciLow), y2: y(item.ciHigh), stroke: "#17201c", "stroke-width": 1.6 }));
      svg.appendChild(createSvg("line", { x1: cx - 10, x2: cx + 10, y1: y(item.ciLow), y2: y(item.ciLow), stroke: "#17201c", "stroke-width": 1.6 }));
      svg.appendChild(createSvg("line", { x1: cx - 10, x2: cx + 10, y1: y(item.ciHigh), y2: y(item.ciHigh), stroke: "#17201c", "stroke-width": 1.6 }));
    }
    svgText(svg, cx, Math.min(barTop, zeroY) - 10, fmt(item.meanGain, 3), { "text-anchor": "middle", fill: "#17201c", "font-size": 13, "font-weight": 700 });
    svgText(svg, cx, height - 74, plainChartLabel(item), { "text-anchor": "middle", fill: "#17201c", "font-size": 13, "font-weight": 700 });
    svgText(svg, cx, height - 52, `赢 ${item.wins}/${item.cells} 个考题 · ${percent(item.winRate)}`, { "text-anchor": "middle", fill: "#59645f", "font-size": 12 });
  });

  svgText(svg, margin.left, 26, "借用阵营比不借阵营好多少（平均改进，竖线是 95% 置信区间）", { fill: "#17201c", "font-size": 17, "font-weight": 800 });
  svgText(svg, 18, 44, "越高越好", { fill: "#59645f", "font-size": 13 });
  // color legend
  svg.appendChild(createSvg("rect", { x: margin.left, y: 40, width: 13, height: 13, rx: 3, fill: "#0c7c72" }));
  svgText(svg, margin.left + 19, 51, "同类互借（出租车↔网约车）", { fill: "#59645f", "font-size": 12.5 });
  svg.appendChild(createSvg("rect", { x: margin.left + 220, y: 40, width: 13, height: 13, rx: 3, fill: "#c4573f" }));
  svgText(svg, margin.left + 239, 51, "跨方式（出租车↔单车）", { fill: "#59645f", "font-size": 12.5 });
  container.appendChild(svg);
}

/* ---------------- per-metric win rates ---------------- */

function setupPairTabs() {
  const tabs = document.querySelector("[data-pair-tabs]");
  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-pair]");
    if (!button) return;
    pairState.active = button.dataset.pair;
    tabs.querySelectorAll("button").forEach((btn) => btn.classList.toggle("active", btn === button));
    renderMetricChart();
  });
  renderMetricChart();
}

function renderMetricChart() {
  const items = DATA.results.metricWins[pairState.active];
  const container = document.getElementById("metric-chart");
  container.innerHTML = "";
  const width = 620;
  const rowH = 30;
  const top = 44;
  const height = top + items.length * rowH + 30;
  const svg = createSvg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "按判分标准看借用阵营的赢面" });
  const left = 218;
  const right = width - 76;
  const x = (v) => left + v * (right - left);

  svgText(svg, left, 24, "借用阵营的赢面（每行 80 个考题）", { fill: "#59645f", "font-size": 13 });

  [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
    svg.appendChild(createSvg("line", { x1: x(v), x2: x(v), y1: top - 6, y2: height - 26, stroke: v === 0.5 ? "#9d9487" : "#e6e0d3", "stroke-width": v === 0.5 ? 1.4 : 1, ...(v === 0.5 ? { "stroke-dasharray": "4 3" } : {}) }));
    svgText(svg, x(v), height - 10, `${v * 100}%`, { "text-anchor": "middle", fill: "#8a8174", "font-size": 11 });
  });

  items.forEach((item, i) => {
    const yy = top + i * rowH;
    const win = item.winRate >= 0.5;
    const label = METRIC_PLAIN[item.metric] || item.label;
    svgText(svg, left - 8, yy + 15, label, { "text-anchor": "end", fill: "#17201c", "font-size": 12.5, "font-weight": item.metric === "no_harm_rate" ? 700 : 500 });
    svg.appendChild(createSvg("rect", { x: left, y: yy + 4, width: right - left, height: 15, fill: "#f1ede3", rx: 3 }));
    svg.appendChild(createSvg("rect", { x: left, y: yy + 4, width: Math.max(2, (right - left) * item.winRate), height: 15, fill: win ? "#0c7c72" : "#c4573f", opacity: win ? 0.88 : 0.85, rx: 3, class: "grow-bar" }));
    svgText(svg, right + 8, yy + 16, percent(item.winRate, 1), { fill: win ? "#0c7c72" : "#c4573f", "font-size": 12.5, "font-weight": 700 });
  });

  container.appendChild(svg);
}

/* ---------------- method mix ---------------- */

function renderMixChart() {
  const container = document.getElementById("mix-chart");
  container.innerHTML = "";
  const catColors = { direct: "#c5972f", align: "#9d9487", routed: "#0c7c72", deep: "#c4573f", hybrid: "#7c6f9b", null: "#d0c9ba" };
  const cats = ["direct", "align", "routed", "deep", "hybrid", "null"];
  const rows = [
    ["taxi_tnc", "同类互借（出租车↔网约车）：简单方法就够"],
    ["taxi_divvy", "跨方式（出租车↔单车）：深度网络 + 裁判扛起六成"],
  ];
  const width = 620;
  const height = 268;
  const svg = createSvg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "替借用阵营出战获胜的方法类别构成" });
  const left = 24;
  const barW = width - left - 24;

  rows.forEach(([key, label], r) => {
    const mix = DATA.results.methodMix[key];
    const total = cats.reduce((s, c) => s + mix[c], 0);
    const y = 44 + r * 84;
    svgText(svg, left, y - 8, label, { fill: "#17201c", "font-size": 14, "font-weight": 700 });
    let acc = 0;
    cats.forEach((c) => {
      const w = (mix[c] / total) * barW;
      if (w <= 0) return;
      svg.appendChild(createSvg("rect", { x: left + acc, y, width: Math.max(1, w - 1.5), height: 34, fill: catColors[c], rx: 3, class: "grow-bar" }));
      if (w > 46) {
        svgText(svg, left + acc + w / 2, y + 22, `${Math.round((mix[c] / total) * 100)}%`, { "text-anchor": "middle", fill: c === "null" ? "#59645f" : "#fff", "font-size": 12.5, "font-weight": 700 });
      }
      acc += w;
    });
  });

  const perRow = 3;
  const colW = (width - left * 2) / perRow;
  cats.forEach((c, i) => {
    const lx = left + (i % perRow) * colW;
    const ly = height - 46 + Math.floor(i / perRow) * 24;
    svg.appendChild(createSvg("rect", { x: lx, y: ly - 10, width: 13, height: 13, rx: 3, fill: catColors[c] }));
    svgText(svg, lx + 18, ly + 1, MIX_PLAIN[c], { fill: "#59645f", "font-size": 12 });
  });

  container.appendChild(svg);
}

/* ---------------- null chart ---------------- */

function renderNullChart() {
  const container = document.getElementById("null-chart");
  container.innerHTML = "";
  const items = DATA.results.nulls;
  const width = 840;
  const height = 214;
  const svg = createSvg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "陷阱选手被误选的比例" });
  svgText(svg, 34, 32, "陷阱选手偶尔得逞：裁判还不完美的直接证据", { fill: "#17201c", "font-size": 17, "font-weight": 800 });
  svgText(svg, 34, 54, "陷阱选手 = 拿被打乱的参考数据参赛的方法，理论上不该赢；它每被选中一次，都是裁判的失误。", { fill: "#59645f", "font-size": 13 });
  items.forEach((item, i) => {
    const y = 84 + i * 48;
    const frac = item.selected / item.cells;
    const w = 500 * frac / 0.1; // axis capped at 10%
    svgText(svg, 34, y + 18, NULL_ROW_PLAIN[item.label] || item.label, { fill: "#17201c", "font-size": 14.5, "font-weight": 700 });
    svg.appendChild(createSvg("rect", { x: 190, y, width: 500, height: 28, fill: "#ece7db", rx: 4 }));
    svg.appendChild(createSvg("rect", { x: 190, y, width: Math.min(500, w), height: 28, fill: "#c5972f", rx: 4, class: "grow-bar" }));
    svgText(svg, 706, y + 19, `${item.selected}/${item.cells} 次（${(frac * 100).toFixed(1)}%）`, { fill: "#59645f", "font-size": 13 });
  });
  svgText(svg, 190, height - 8, "横轴截至 10%", { fill: "#8a8174", "font-size": 11 });
  container.appendChild(svg);
}

/* ---------------- evidence ---------------- */

function setupEvidence() {
  const button = document.getElementById("toggle-evidence");
  const list = document.getElementById("evidence-list");
  list.innerHTML = DATA.evidence.map((item) => `
    <article class="evidence-item">
      <h3>${item.id} · ${item.claim}</h3>
      <p>${item.summary}</p>
      <div class="evidence-files">${item.files.map((file) => `<span>${file}</span>`).join("")}</div>
    </article>
  `).join("");
  button.addEventListener("click", () => {
    list.hidden = !list.hidden;
    button.textContent = list.hidden ? "展开证据表" : "收起证据表";
  });
}

/* ---------------- scroll reveal ---------------- */

function setupReveal() {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const targets = document.querySelectorAll(".reveal");
  if (reduced || !("IntersectionObserver" in window)) {
    targets.forEach((el) => el.classList.add("visible"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  targets.forEach((el) => io.observe(el));
}

setupTabs();
renderMap();
renderNycLadder();
renderNycChips();
setupArchTabs();
setupCharts();
setupPairTabs();
renderMixChart();
setupEvidence();
setupReveal();
