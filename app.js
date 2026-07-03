
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

/* ---------------- hero map ---------------- */

function setupTabs() {
  const tabs = document.querySelector("[data-map-tabs]");
  const sources = [
    ["taxi", "Taxi 流线"],
    ["tnc", "TNC 流线"],
    ["divvy", "Divvy 站点"],
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
  const svg = createSvg("svg", { viewBox: `0 0 ${map.width} ${map.height}`, role: "img", "aria-label": "Chicago community area map" });

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
        "data-tip": `${flow.originName} → ${flow.destinationName}<br>April 一周计数：${flow.count.toLocaleString()}`,
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
        "data-tip": `${station.name}<br>Station ID: ${station.id}`,
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
    const anchor = area.name === "Ohare" ? "start" : "start";
    const halo = createSvg("text", { x: area.cx + 8, y: area.cy - 6, class: "map-label halo", "text-anchor": anchor });
    halo.textContent = display;
    const label = createSvg("text", { x: area.cx + 8, y: area.cy - 6, class: "map-label", "text-anchor": anchor });
    label.textContent = display;
    labelLayer.appendChild(halo);
    labelLayer.appendChild(label);
  });
  svg.appendChild(labelLayer);

  container.appendChild(svg);
  attachMapTooltip(container);

  if (source.kind === "flows") {
    caption.innerHTML = `${source.label}：${source.summary}<br>本地 OD 行 ${source.rows.toLocaleString()} 条，总计 ${source.total.toLocaleString()} 次，地图显示 top ${source.flows.length} 条跨社区流向——市中心（Loop / Near North Side）与 O'Hare 机场是两个极点。`;
  } else {
    caption.innerHTML = `${source.label}：${source.summary}<br>April 站点 ${source.stationCount} 个，实验周映射事件约 ${Math.round(source.eventsInWeek).toLocaleString()} 次。<br><span class="subtle">${source.note}</span>`;
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
  const rowH = 84;
  const height = 60 + nyc.ladder.length * rowH + 36;
  const svg = createSvg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "NYC 三个台阶的 WAPE 对比" });
  const left = 270;
  const right = width - 130;
  const maxV = Math.max(...nyc.ladder.map((d) => d.rawWape));
  const scale = (v) => (v / maxV) * (right - left);
  const colors = ["#9d9487", "#c5972f", "#0c7c72"];

  svgText(svg, left, 30, "test raw WAPE（越低越好） · 16,384 行测试集", { fill: "#59645f", "font-size": 14 });

  nyc.ladder.forEach((row, i) => {
    const y = 56 + i * rowH;
    svgText(svg, pad, y + 22, row.label, { fill: "#17201c", "font-size": 16, "font-weight": 700 });
    svgText(svg, pad, y + 42, row.sub, { fill: "#59645f", "font-size": 12.5 });
    svg.appendChild(createSvg("rect", { x: left, y: y + 6, width: right - left, height: 30, fill: "#efeadf", rx: 4 }));
    const w = scale(row.rawWape);
    svg.appendChild(createSvg("rect", { x: left, y: y + 6, width: w, height: 30, fill: colors[i], rx: 4, class: "grow-bar" }));
    svgText(svg, left + w + 10, y + 27, fmt(row.rawWape, 3), { fill: "#17201c", "font-size": 17, "font-weight": 800 });
    if (i > 0) {
      const prev = nyc.ladder[i - 1].rawWape;
      const drop = ((prev - row.rawWape) / prev) * 100;
      svgText(svg, right + 14, y + 27, `↓${drop.toFixed(0)}%`, { fill: "#0c7c72", "font-size": 14, "font-weight": 700 });
    }
  });

  const total = ((nyc.ladder[0].rawWape - nyc.ladder[2].rawWape) / nyc.ladder[0].rawWape) * 100;
  svgText(svg, pad, height - 8, `总降幅 ${total.toFixed(1)}%：source 有用（台阶 1→2），而且模型比线性借用会用（台阶 2→3）。`, { fill: "#17201c", "font-size": 14, "font-weight": 700 });
  container.appendChild(svg);
}

function renderNycChips() {
  const nyc = DATA.nyc;
  const g = nyc.ladder[2];
  const chips = [
    ["目标标签", `${nyc.trainRows.toLocaleString()} / ${nyc.trainFull.toLocaleString()} 行（${nyc.labelPct}%）`],
    ["空间/时间粒度", `${nyc.zones} zones · ${nyc.interval}`],
    ["输入特征", `${nyc.fit.featureDim} 维（source 流量、时间、空间、先验残差）`],
    ["网络", `MLP 隐层 ${nyc.fit.hiddenDim} · dropout ${nyc.fit.dropout}`],
    ["热点检测 F1", fmt(g.hotspotF1, 3)],
    ["残差方向相关", fmt(g.signedCorr, 3)],
    ["事件窗口 WAPE", `${fmt(g.srcRequiredWape, 3)}（source-required）`],
    ["anchor 占比", `${percent(nyc.anchorFrac, 2)}（非 anchor 区照样恢复）`],
  ];
  document.getElementById("nyc-chips").innerHTML = chips.map(([k, v]) => `
    <div class="chip"><span class="chip-key">${k}</span><span class="chip-value">${v}</span></div>
  `).join("");
}

/* ---------------- architecture diagrams ---------------- */

const ARCH_NOTES = {
  nyc: `<p><strong>训练配置（来自 run JSON，非示意）：</strong>2,048 训练行 · lr 1e-3 · weight decay 1e-4 · grad clip 5 · best epoch 59。teacher = 直接 ridge 翻译器（val residual WAPE 0.544），学生 MLP 收敛到 0.366 —— 学生明确超过了教师。损失为加权残差回归，source-required 事件窗口加权采样。</p>`,
  chicago: `<p><strong>训练配置（来自 eval_stage23_gf_od_sparse_estimation.py）：</strong>SmoothL1 损失 · AdamW lr 3e-3 · weight decay 1e-4 · batch 4096。深度族共 5 类（base / graph / tgcn / geml / dneat）× 3 种输入（target / aux / target+aux）= 15 个深度方法，与 32 个非深度方法同场对比。IPF 投影保证输出非负且与观测边际一致。</p>`,
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
    ["train", "可训练"],
    ["frozen", "冻结 / 规则"],
    ["post", "约束后处理"],
  ];
  const fills = { input: "#fffdf8", train: "#d8efea", frozen: "#ece9e1", post: "#f6ecd4" };
  const strokes = { input: "#c4573f", train: "#0c7c72", frozen: "#9d9487", post: "#c5972f" };
  items.forEach(([kind, label], i) => {
    const lx = x + i * 128;
    svg.appendChild(createSvg("rect", { x: lx, y: y - 11, width: 16, height: 12, rx: 3, fill: fills[kind], stroke: strokes[kind], "stroke-width": 1.4 }));
    svgText(svg, lx + 22, y, label, { fill: "#59645f", "font-size": 12.5 });
  });
}

function renderArchNyc(container) {
  const width = 1160;
  const height = 540;
  const svg = createSvg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "NYC G113 teacher-first 神经翻译器结构" });
  archDefs(svg);

  svgText(svg, 24, 34, "G113 teacher-first 神经翻译器（NYC bike→taxi）", { fill: "#17201c", "font-size": 19, "font-weight": 800 });
  svgText(svg, 24, 56, "预测 = 冻结的目标先验 + 网络学到的“source 能解释的残差”", { fill: "#59645f", "font-size": 13.5 });

  const inputs = [
    { title: "Citi Bike 流量序列", sub: ["4 通道 · 当期与滞后", "30min 粒度"] },
    { title: "时间编码", sub: ["小时 / 星期", "周期特征"] },
    { title: "空间编码", sub: ["69 zones", "区域指示"] },
    { title: "先验残差 + anchor", sub: ["目标先验偏差", "anchor 图传播 1.57%"] },
  ];
  const inW = 200; const inH = 80; const inX = 24;
  inputs.forEach((b, i) => {
    const y = 84 + i * 92;
    archBlock(svg, inX, y, inW, inH, b.title, b.sub, "input");
    archArrow(svg, inX + inW, y + inH / 2, 300, 268);
  });

  archBlock(svg, 300, 230, 150, 76, ["特征向量", "x ∈ R⁹¹"], "拼接归一", "frozen");
  archArrow(svg, 450, 268, 496, 268);
  archBlock(svg, 496, 216, 190, 104, ["Dense 91→256", "ReLU"], ["Dropout 0.05"], "train");
  archArrow(svg, 686, 268, 730, 268);
  archBlock(svg, 730, 230, 160, 76, ["Dense 256→1"], ["残差输出 r̂"], "train");
  archArrow(svg, 890, 268, 950, 268);

  svg.appendChild(createSvg("circle", { cx: 972, cy: 268, r: 20, fill: "#fffdf8", stroke: "#17201c", "stroke-width": 1.6 }));
  svgText(svg, 972, 274, "⊕", { "text-anchor": "middle", fill: "#17201c", "font-size": 20, "font-weight": 700 });
  archArrow(svg, 992, 268, 1022, 268);
  archBlock(svg, 1022, 230, 118, 76, ["taxi 需求", "预测"], null, "out");

  archBlock(svg, 496, 356, 190, 64, ["Ridge 教师"], ["source 直接翻译", "val WAPE 0.544"], "frozen");
  archArrow(svg, 591, 356, 591, 324, true);
  svgText(svg, 700, 392, "teacher-first：教师先行，学生 MLP 超越（0.366）", { fill: "#59645f", "font-size": 12.5 });

  archBlock(svg, 24, 462, 340, 64, ["目标先验（冻结）"], ["zone × hour-of-week 经验均值，先训练后冻结"], "frozen");
  archArrow(svg, 364, 494, 966, 286);

  archLegend(svg, 620, height - 14);
  container.appendChild(svg);
}

function renderArchChicago(container) {
  const width = 1160;
  const height = 500;
  const svg = createSvg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Chicago G160 深度残差网络与路由结构" });
  archDefs(svg);

  svgText(svg, 24, 34, "G160 深度基线 ODResidualMLP + 可靠性路由（Chicago 47 方法基准中的深度分支）", { fill: "#17201c", "font-size": 19, "font-weight": 800 });
  svgText(svg, 24, 56, "网络只学 log 残差；非负与边际一致由 IPF 投影在结构上保证", { fill: "#59645f", "font-size": 13.5 });

  const embY = 84;
  const embs = [
    { title: "时间 id", sub: "Embedding 12 维" },
    { title: "起点区 id", sub: "Embedding 12 维" },
    { title: "终点区 id", sub: "Embedding 12 维" },
  ];
  embs.forEach((b, i) => {
    const y = embY + i * 74;
    archBlock(svg, 24, y, 176, 62, b.title, b.sub, "train");
    archArrow(svg, 200, y + 31, 262, 250);
  });
  archBlock(svg, 24, embY + 3 * 74, 176, 120, ["连续特征 F 维"], ["距离(3) · 目标走廊残差", "source gauge-free 残差", "图扩散 · 时间滞后", "边际上下文 / 边注意"], "input");
  archArrow(svg, 200, embY + 3 * 74 + 60, 262, 262);

  archBlock(svg, 262, 218, 140, 76, ["Concat", "36 + F 维"], null, "frozen");
  archArrow(svg, 402, 256, 440, 256);
  archBlock(svg, 440, 204, 168, 104, ["Dense → 96", "ReLU"], null, "train");
  archArrow(svg, 608, 256, 636, 256);
  archBlock(svg, 636, 204, 168, 104, ["Dense 96→96", "ReLU"], null, "train");
  archArrow(svg, 804, 256, 832, 256);
  archBlock(svg, 832, 218, 130, 76, ["Dense 96→1"], ["log 残差 r̂"], "train");
  archArrow(svg, 962, 256, 990, 256);
  archBlock(svg, 990, 196, 150, 66, ["clip r̂ ∈ [-5, 5]"], ["对角置零"], "post");
  archArrow(svg, 1065, 262, 1065, 288);
  archBlock(svg, 915, 288, 226, 62, ["kernel = prior · exp(r̂)"], null, "post");
  archArrow(svg, 1028, 350, 1028, 376);
  archBlock(svg, 862, 376, 278, 66, ["IPF / Sinkhorn 边际投影"], ["输出非负 · 与观测进出总量一致"], "post");

  archBlock(svg, 262, 376, 300, 66, ["先验 prior（冻结）"], ["目标边际独立积 / 稀疏标签校准"], "frozen");
  archArrow(svg, 562, 409, 915, 330);

  archBlock(svg, 616, 376, 216, 66, ["可靠性路由器"], ["验证集判定：借用 or 回退", "safe 变体带 no-harm 约束"], "train");
  archArrow(svg, 724, 376, 724, 322, true);
  svgText(svg, 730, 366, "逐格选择：source 不可信就回退 target-only", { fill: "#59645f", "font-size": 12 });

  archLegend(svg, 620, height - 14);
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
  const height = 400;
  const svg = createSvg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "跨源方法改进图" });
  const margin = { left: 92, right: 40, top: 48, bottom: 112 };
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
    svgText(svg, cx, height - 74, item.label, { "text-anchor": "middle", fill: "#17201c", "font-size": 13, "font-weight": 700 });
    svgText(svg, cx, height - 52, `${item.wins}/${item.cells} 胜出 · ${percent(item.winRate)}`, { "text-anchor": "middle", fill: "#59645f", "font-size": 12 });
  });

  svgText(svg, margin.left, 26, "跨源方法族相对 target-only 方法族的平均改进（正规化增益，95% CI）", { fill: "#17201c", "font-size": 17, "font-weight": 800 });
  svgText(svg, 18, 40, "越高越好", { fill: "#59645f", "font-size": 13 });
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
  const svg = createSvg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "按指标的跨源胜率" });
  const left = 168;
  const right = width - 76;
  const x = (v) => left + v * (right - left);

  svgText(svg, left, 24, "跨源方法族胜率（每指标 80 cells）", { fill: "#59645f", "font-size": 13 });

  [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
    svg.appendChild(createSvg("line", { x1: x(v), x2: x(v), y1: top - 6, y2: height - 26, stroke: v === 0.5 ? "#9d9487" : "#e6e0d3", "stroke-width": v === 0.5 ? 1.4 : 1, ...(v === 0.5 ? { "stroke-dasharray": "4 3" } : {}) }));
    svgText(svg, x(v), height - 10, `${v * 100}%`, { "text-anchor": "middle", fill: "#8a8174", "font-size": 11 });
  });

  items.forEach((item, i) => {
    const yy = top + i * rowH;
    const win = item.winRate >= 0.5;
    const isNoHarm = item.metric === "no_harm_rate";
    svgText(svg, left - 8, yy + 15, item.label, { "text-anchor": "end", fill: "#17201c", "font-size": 12.5, "font-weight": isNoHarm ? 700 : 500 });
    svg.appendChild(createSvg("rect", { x: left, y: yy + 4, width: right - left, height: 15, fill: "#f1ede3", rx: 3 }));
    svg.appendChild(createSvg("rect", { x: left, y: yy + 4, width: Math.max(2, (right - left) * item.winRate), height: 15, fill: win ? "#0c7c72" : "#c4573f", opacity: win ? 0.88 : 0.85, rx: 3, class: "grow-bar" }));
    svgText(svg, right + 8, yy + 16, percent(item.winRate, 1), { fill: win ? "#0c7c72" : "#c4573f", "font-size": 12.5, "font-weight": 700 });
  });

  svgText(svg, left, height - 10 + 0, "", {});
  container.appendChild(svg);
}

/* ---------------- method mix ---------------- */

function renderMixChart() {
  const container = document.getElementById("mix-chart");
  container.innerHTML = "";
  const meta = DATA.results.methodMixMeta;
  const catColors = { direct: "#c5972f", align: "#9d9487", routed: "#0c7c72", deep: "#c4573f", hybrid: "#7c6f9b", null: "#d0c9ba" };
  const cats = ["direct", "align", "routed", "deep", "hybrid", "null"];
  const rows = [
    ["taxi_tnc", "Taxi ↔ TNC（同模态）"],
    ["taxi_divvy", "Taxi ↔ Divvy（跨方式）"],
  ];
  const width = 620;
  const height = 268;
  const svg = createSvg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "最佳跨源方法的类别构成" });
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
    svgText(svg, lx + 18, ly + 1, meta.catLabels[c], { fill: "#59645f", "font-size": 12 });
  });

  container.appendChild(svg);
}

/* ---------------- null chart ---------------- */

function renderNullChart() {
  const container = document.getElementById("null-chart");
  container.innerHTML = "";
  const items = DATA.results.nulls;
  const width = 840;
  const height = 190;
  const svg = createSvg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "负控被选中比例" });
  svgText(svg, 34, 34, "负控偶尔被选中：说明最终模型必须学会不盲目信 source", { fill: "#17201c", "font-size": 17, "font-weight": 800 });
  items.forEach((item, i) => {
    const y = 72 + i * 48;
    const frac = item.selected / item.cells;
    const w = 540 * frac / 0.1; // axis capped at 10%
    svgText(svg, 34, y + 18, item.label, { fill: "#17201c", "font-size": 15, "font-weight": 700 });
    svg.appendChild(createSvg("rect", { x: 150, y, width: 540, height: 28, fill: "#ece7db", rx: 4 }));
    svg.appendChild(createSvg("rect", { x: 150, y, width: Math.min(540, w), height: 28, fill: "#c5972f", rx: 4, class: "grow-bar" }));
    svgText(svg, 710, y + 19, `${item.selected}/${item.cells} cells（${(frac * 100).toFixed(1)}%）`, { fill: "#59645f", "font-size": 13 });
  });
  svgText(svg, 150, 172, "横轴截至 10%", { fill: "#8a8174", "font-size": 11 });
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
