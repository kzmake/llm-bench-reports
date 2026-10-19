#!/usr/bin/env bun
// 各レポート(<日付>/<run>/index.html)に埋め込まれたデータを読み、ルートの index.html を生成する。
// 使い方: bun build-index.ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = import.meta.dir;

type Call = { t0: number; dur: number; out: number };
type Shot = { src: string; n: number; t: number; cap: string };
type Run = {
  date: string;
  id: string;
  href: string;
  time: string;
  label: string;
  hash: string;
  title: string;
  ok: boolean;
  status: string;
  model: string;
  lede: string;
  kpis: Record<string, string>;
  T: number;
  calls: Call[];
  phases: string[];
  shots: Shot[];
  anchor: string;
  work?: string;
};

// ---------- 小さなユーティリティ ----------

const esc = (s: unknown) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const text = (s: string) => decode(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (sec: number) => {
  const s = Math.ceil(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};
const parseClock = (s: string) => s.split(":").map(Number).reduce((a, v) => a * 60 + v, 0);
const compact = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);
const hm = (sec: number) => `${Math.floor(sec / 3600)}時間${pad(Math.floor((sec % 3600) / 60))}分`;
const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

// ---------- レポートの読み取り ----------

function readRun(date: string, id: string): Run | null {
  const dir = join(ROOT, date, id);
  const file = join(dir, "index.html");
  if (!existsSync(file)) return null;
  const html = readFileSync(file, "utf8");

  const dataText = html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)?.[1];
  if (!dataText) {
    console.warn(`skip ${date}/${id}: 埋め込みデータ(#data)が見つからない`);
    return null;
  }
  const data = JSON.parse(dataText);
  const T = Number(data.T);
  const calls: Call[] = (data.calls as any[]).map((c) => ({
    t0: Number(c.t0),
    dur: Number(c.dur),
    out: Number(c.out) || 0,
  }));
  const phases: string[] = (data.phases as any[]).map((p) => String(p.n));

  const header = html.match(/<header>([\s\S]*?)<\/header>/)?.[1] ?? "";
  const statusM = header.match(/<span class="status([^"]*)"[^>]*>([\s\S]*?)<\/span>/);
  const kpis: Record<string, string> = {};
  for (const m of html.matchAll(/class="l">([\s\S]*?)<\/div>\s*<div class="v[^"]*">([\s\S]*?)<\/div>/g)) {
    kpis[text(m[1])] = text(m[2]);
  }

  const shots: Shot[] = [];
  for (const m of html.matchAll(
    /<figure>\s*<img[^>]*src="(shots\/[^"]+)"[^>]*>\s*<figcaption>\s*#(\d+)\s*·\s*([\d:]+)\s*·\s*([^<]*?)\s*<\/figcaption>/g,
  )) {
    if (!existsSync(join(dir, m[1]))) continue;
    shots.push({ src: `${date}/${id}/${m[1]}`, n: Number(m[2]), t: Math.min(parseClock(m[3]), T), cap: `#${m[2]} · ${m[3]}` });
  }

  // スクショ群が属するセクション(マーカーのリンク先)。見つからなければページ先頭。
  const firstFig = html.indexOf("<figure");
  const sec = firstFig < 0 ? [] : [...html.slice(0, firstFig).matchAll(/<section id="([^"]+)"/g)];
  const anchor = sec.length ? `#${sec[sec.length - 1][1]}` : "";

  const workDir = join(dir, "work");
  const works = existsSync(workDir) ? readdirSync(workDir).filter((f) => f.endsWith(".html")).sort() : [];
  const work = works.includes("index.html") ? "index.html" : works[0];

  const idM = id.match(/^(\d{2})(\d{2})(\d{2})-\d+-(.+)-([0-9a-f]+)$/);
  return {
    date,
    id,
    href: `${date}/${id}/index.html`,
    time: idM ? `${idM[1]}:${idM[2]}` : "",
    label: idM?.[4] ?? "",
    hash: idM?.[5] ?? id,
    title: text(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? id),
    ok: statusM ? !/\bbad\b/.test(statusM[1]) : true,
    status: statusM ? text(statusM[2]) : "",
    model: text(header.match(/<dt>モデル<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/)?.[1] ?? ""),
    lede: text(header.match(/class="lede"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ""),
    kpis,
    T,
    calls,
    phases,
    shots,
    anchor,
    work: work ? `${date}/${id}/work/${work}` : undefined,
  };
}

const runs: Run[] = [];
for (const date of readdirSync(ROOT).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse()) {
  for (const id of readdirSync(join(ROOT, date)).sort().reverse()) {
    const r = readRun(date, id);
    if (r) runs.push(r);
  }
}
if (!runs.length) throw new Error("レポートが見つからない");
const noModel = runs.filter((r) => !r.model);
if (noModel.length) throw new Error(`モデル名が読めないレポート: ${noModel.map((r) => r.href).join(", ")}`);

// ---------- モデル ----------

// 色は順位ではなくモデルに付く。最初に実行した順にスロットを割り当てるので、
// あとから別のモデルが増えても既存のモデルの色は変わらない。3 つを超えた分は無彩色にする。
const MODEL_SLOTS = 3;
const modelOrder = [...new Set([...runs].reverse().map((r) => r.model))];
const slot = (m: string) => (modelOrder.indexOf(m) < MODEL_SLOTS ? `m${modelOrder.indexOf(m) + 1}` : "m0");
const modelCount = (m: string) => runs.filter((r) => r.model === m).length;
// <title> にはモデル名が入る。カードの見出しにはバッジが別にあるので外す。
const shortTitle = (r: Run) => r.title.replace(r.model, "").replace(/\s+/g, " ").trim() || r.title;

// ---------- 共通の時間軸 ----------

const maxT = Math.max(...runs.map((r) => r.T));
const step = [300, 600, 900, 1200, 1800, 3600].find((s) => Math.ceil(maxT / s) <= 9) ?? 3600;
const axisMax = Math.ceil(maxT / step) * step;
const pct = (t: number) => `${((t / axisMax) * 100).toFixed(3)}%`;
const ticks = Array.from({ length: axisMax / step + 1 }, (_, i) => i * step);

const kv = (r: Run, k: string) => r.kpis[k] ?? "";
const dur = (r: Run) => kv(r, "所要時間") || clock(r.T);
const runName = (r: Run) => `${r.date.slice(5).replace("-", "/")} ${r.time}`;

// ---------- 比較タイムライン ----------

function rowHtml(r: Run) {
  const rects = r.calls
    .map((c) => {
      const x = Math.min((c.t0 / r.T) * 1000, 1000);
      const w = Math.max((c.dur / r.T) * 1000, 1.4);
      return `<rect x="${x.toFixed(2)}" width="${w.toFixed(2)}" height="14"/>`;
    })
    .join("");
  const tip = {
    title: `${r.date} ${r.time} · ${r.label} ${r.hash}`,
    model: r.model,
    slot: slot(r.model),
    rows: [
      ["所要時間", dur(r)],
      ["API 呼び出し", kv(r, "API 呼び出し")],
      ["出力トークン", kv(r, "出力トークン")],
      ["最大コンテキスト", kv(r, "最大コンテキスト")],
      ["キャッシュ命中", kv(r, "キャッシュ命中")],
      ["推論が占める時間", kv(r, "推論が占める時間")],
      ["スクリーンショット", `${r.shots.length} 枚`],
    ].filter(([, v]) => v),
  };
  const marks = r.shots
    .map((s) => {
      const d = { src: s.src, cap: `${runName(r)} · ${s.cap}` };
      return `<a class="mk" href="${esc(r.href + r.anchor)}" style="left:${pct(s.t)}" data-shot="${esc(JSON.stringify(d))}" aria-label="スクリーンショット ${esc(s.cap)} を含むレポートを開く"></a>`;
    })
    .join("");
  return `<div class="row ${slot(r.model)}" data-tip="${esc(JSON.stringify(tip))}">
  <a class="rl" href="${esc(r.href)}"><i class="dot"></i>${esc(runName(r))}</a>
  <div class="plot">
    <a class="track" href="${esc(r.href)}" tabindex="-1" aria-hidden="true" style="width:${pct(r.T)}"><svg viewBox="0 0 1000 14" preserveAspectRatio="none">${rects}</svg></a>
    <span class="dur" style="left:calc(${pct(r.T)} + 8px)">${esc(dur(r))}</span>${marks}
  </div>
</div>`;
}

const chartHtml = `<div class="chart card" role="group" aria-label="実行ごとの API 呼び出しタイムライン(全実行で共通の時間軸)">
<div class="legend" aria-label="モデル">
${modelOrder
  .map((m) => `  <span class="${slot(m)}"><i class="sw-m"></i>${esc(m)}<small>${modelCount(m)} 実行</small></span>`)
  .join("\n")}
</div>
<div class="legend">
  <span><i class="sw-call"></i>API 呼び出し中</span>
  <span><i class="sw-span"></i>それ以外(ツール実行など)</span>
  <span><i class="sw-dot"></i>スクリーンショットの撮影</span>
</div>
<div class="axis"><span class="unit">経過(分)</span><div class="plot">${ticks
  .map((t) => `<span class="tick" style="left:${pct(t)}">${t / 60}</span>`)
  .join("")}</div></div>
<div class="rows">
<div class="grid" aria-hidden="true">${ticks.map((t) => `<i style="left:${pct(t)}"></i>`).join("")}</div>
${runs.map(rowHtml).join("\n")}
</div>
<details class="tbl"><summary>表で見る</summary><div class="scroll"><table>
<thead><tr><th>実行</th><th>モデル</th><th class="r">所要時間</th><th class="r">呼び出し</th><th class="r">出力トークン</th><th class="r">最大コンテキスト</th><th class="r">キャッシュ命中</th><th class="r">推論の割合</th><th class="r">スクショ</th></tr></thead>
<tbody>${runs
  .map(
    (r) =>
      `<tr><td><a href="${esc(r.href)}">${esc(runName(r))}</a> <span class="mono dim">${esc(r.hash)}</span></td><td class="mono"><span class="lbl ${slot(r.model)}"><i class="dot"></i>${esc(r.model)}</span></td><td class="r num">${esc(dur(r))}</td><td class="r num">${esc(kv(r, "API 呼び出し"))}</td><td class="r num">${esc(kv(r, "出力トークン"))}</td><td class="r num">${esc(kv(r, "最大コンテキスト"))}</td><td class="r num">${esc(kv(r, "キャッシュ命中"))}</td><td class="r num">${esc(kv(r, "推論が占める時間"))}</td><td class="r num">${r.shots.length}</td></tr>`,
  )
  .join("")}</tbody></table></div></details>
</div>`;

// ---------- 全体の KPI ----------

const totalT = runs.reduce((a, r) => a + r.T, 0);
const totalCalls = runs.reduce((a, r) => a + r.calls.length, 0);
const totalOut = runs.reduce((a, r) => a + r.calls.reduce((b, c) => b + c.out, 0), 0);
const dates = [...new Set(runs.map((r) => r.date))];
const kpiHtml = `<div class="kpis">
<div class="kpi"><div class="l">実行</div><div class="v">${runs.length}</div><div class="d">${esc(dates[dates.length - 1])} 〜 ${esc(dates[0])}</div></div>
<div class="kpi"><div class="l">合計の所要時間</div><div class="v">${hm(totalT)}</div><div class="d">最短 ${esc(clock(Math.min(...runs.map((r) => r.T))))} / 最長 ${esc(clock(maxT))}</div></div>
<div class="kpi"><div class="l">API 呼び出し</div><div class="v">${totalCalls.toLocaleString("en-US")}</div><div class="d">1 実行あたり平均 ${Math.round(totalCalls / runs.length)}</div></div>
<div class="kpi"><div class="l">出力トークン</div><div class="v">${compact(totalOut)}</div><div class="d">全実行の合計</div></div>
</div>`;

// ---------- 日付ごとのカード ----------

function sample<T>(xs: T[], max: number): T[] {
  if (xs.length <= max) return xs;
  const idx = new Set(Array.from({ length: max }, (_, i) => Math.round((i * (xs.length - 1)) / (max - 1))));
  return [...idx].map((i) => xs[i]);
}

function cardHtml(r: Run) {
  const last = r.shots[r.shots.length - 1];
  const name = shortTitle(r);
  const chip = `<span class="mchip ${slot(r.model)}"><i class="dot"></i><span>${esc(r.model)}</span></span>`;
  const cover = last
    ? `<a class="cover" href="${esc(r.href)}" aria-label="${esc(name)}(${esc(r.model)})のレポートを開く"><img src="${esc(last.src)}" alt="${esc(name)} のスクリーンショット" loading="lazy" decoding="async"><span class="badge">${esc(last.cap)}</span>${chip}</a>`
    : `<a class="cover noshot" href="${esc(r.href)}" aria-label="${esc(name)}(${esc(r.model)})のレポートを開く"><span>スクリーンショットなし</span>${chip}</a>`;
  const thumbs =
    r.shots.length > 1
      ? `<div class="strip" role="group" aria-label="スクリーンショットを時系列で切り替え">${sample(r.shots, 6)
          .map(
            (s) =>
              `<button class="th" type="button" data-src="${esc(s.src)}" data-cap="${esc(s.cap)}" aria-pressed="${s === last}" aria-label="スクリーンショット ${esc(s.cap)} を表示"><img src="${esc(s.src)}" alt="" loading="lazy" decoding="async"></button>`,
          )
          .join("")}</div>`
      : "";
  const stat = (k: string, label = k) => (kv(r, k) ? `<div><dt>${esc(label)}</dt><dd>${esc(kv(r, k))}</dd></div>` : "");
  const status = r.status ? `<span class="status${r.ok ? "" : " bad"}"><i></i>${esc(r.status)}</span>` : "";
  return `<article class="run">
${cover}${thumbs}
<div class="body">
  <div class="eyebrow">${esc(r.time)} · ${esc(r.label)} · ${esc(r.hash)}</div>
  <h4><a href="${esc(r.href)}">${esc(name)}</a></h4>
  <dl class="stats">${stat("所要時間")}${stat("API 呼び出し", "呼び出し")}${stat("出力トークン", "出力 tok")}${stat("最大コンテキスト", "最大 ctx")}${stat("キャッシュ命中", "キャッシュ")}</dl>
  <p class="lede">${esc(r.lede)}</p>
  <div class="links"><a href="${esc(r.href)}">レポート →</a>${r.work ? `<a href="${esc(r.work)}">成果物 ↗</a>` : ""}${status}</div>
</div>
</article>`;
}

const daysHtml = dates
  .map((d) => {
    const rs = runs.filter((r) => r.date === d);
    const wd = WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()];
    return `<section class="day"><h3>${esc(d)}(${wd}) <small>${rs.length} 件</small></h3><div class="cards">${rs.map(cardHtml).join("\n")}</div></section>`;
  })
  .join("\n");

// ---------- ページ ----------

const CSS = `
:root{
  --font:"Hiragino Sans","Noto Sans JP",system-ui,-apple-system,"Yu Gothic",sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,monospace;
  --bg:#f6f6f3;--surface:#fcfcfb;--ink:#14130f;--ink-2:#4a4944;--ink-3:#6b6a64;
  --line:rgba(20,19,15,.12);--grid:#e1e0d9;--axis:#c3c2b7;--wash:rgba(20,19,15,.045);
  --s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--good:#0ca30c;--crit:#d03b3b;--viewer:#101322;--lw:112px;--rw:52px;color-scheme:light;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --bg:#0d0d0c;--surface:#1a1a19;--ink:#f4f3ee;--ink-2:#c3c2b7;--ink-3:#a3a299;
    --line:rgba(255,255,255,.12);--grid:#2c2c2a;--axis:#383835;--wash:rgba(255,255,255,.05);
    --s1:#3987e5;--s2:#d95926;--s3:#199e70;color-scheme:dark;
  }
}
:root[data-theme="dark"]{
  --bg:#0d0d0c;--surface:#1a1a19;--ink:#f4f3ee;--ink-2:#c3c2b7;--ink-3:#a3a299;
  --line:rgba(255,255,255,.12);--grid:#2c2c2a;--axis:#383835;--wash:rgba(255,255,255,.05);
  --s1:#3987e5;--s2:#d95926;--s3:#199e70;color-scheme:dark;
}
/* モデルの色(順序はモデルの初出順。build-index.ts の slot を参照) */
.m1{--mc:var(--s1)}.m2{--mc:var(--s2)}.m3{--mc:var(--s3)}.m0{--mc:var(--ink-3)}
.dot{display:block;flex:none;width:8px;height:8px;border-radius:50%;background:var(--mc)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.75 var(--font);padding-inline:16px;-webkit-text-size-adjust:100%}
main{max-width:1040px;margin-inline:auto;padding-block:40px 72px}
a{color:var(--ink);text-underline-offset:3px;text-decoration-color:var(--axis)}
a:hover{text-decoration-color:var(--ink)}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
h1,h2,h3,h4,p,dl,dd{margin:0}
h1{font-size:clamp(26px,4.4vw,36px);line-height:1.3;font-weight:700;letter-spacing:.01em;margin-top:10px}
h2{font-size:18px;line-height:1.4;font-weight:700}
.mono{font-family:var(--mono)}.num{font-variant-numeric:tabular-nums}.dim{color:var(--ink-3)}
.eyebrow{font:500 11.5px/1.6 var(--mono);letter-spacing:.03em;color:var(--ink-3);overflow-wrap:anywhere}
.lede-top{max-width:68ch;color:var(--ink-2);margin-top:14px;font-size:15px}
section{margin-top:52px}
section>h2{padding-top:26px;border-top:1px solid var(--line)}
.sec-lede{color:var(--ink-2);max-width:74ch;margin-top:8px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:8px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:8px;overflow:hidden;margin-top:30px}
.kpi{background:var(--surface);padding:14px 16px 12px;min-width:0}
.kpi .l{font-size:12px;color:var(--ink-2)}
.kpi .v{font-size:28px;line-height:1.25;font-weight:700;margin-top:2px;letter-spacing:-.005em}
.kpi .d{font-size:12px;color:var(--ink-3);line-height:1.55;margin-top:2px}
@media (max-width:760px){.kpis{grid-template-columns:repeat(2,1fr)}}
/* 比較タイムライン */
.chart{margin-top:18px;padding:16px 18px 12px}
.legend{display:flex;flex-wrap:wrap;gap:4px 20px;font-size:12px;color:var(--ink-2)}
.legend+.legend{margin-top:4px}
.legend span{display:inline-flex;align-items:center;gap:7px}
.legend small{font:400 11.5px/1 var(--mono);color:var(--ink-3);margin-left:1px}
.legend i{display:block;flex:none}
.sw-m{width:14px;height:8px;border-radius:2px;background:var(--mc)}
.sw-call{width:14px;height:8px;border-radius:2px;background:var(--ink-3)}
.sw-span{width:14px;height:8px;border-radius:2px;background:color-mix(in srgb,var(--ink-3) 24%,transparent)}
.sw-dot{width:9px;height:9px;border-radius:50%;background:var(--ink)}
.axis,.row{display:grid;grid-template-columns:var(--lw) 1fr;align-items:center}
.axis{margin-top:10px}
.axis .unit{font:11px/22px var(--mono);color:var(--ink-3)}
.plot{position:relative;margin-right:var(--rw);height:100%}
.axis .plot{height:22px}
.tick{position:absolute;top:0;transform:translateX(-50%);font:11px/22px var(--mono);color:var(--ink-3)}
.rows{position:relative;border-top:1px solid var(--axis)}
.grid{position:absolute;top:0;bottom:0;left:var(--lw);right:var(--rw);pointer-events:none}
.grid i{position:absolute;top:0;bottom:0;width:1px;background:var(--grid)}
.row{position:relative;height:36px}
.rl{position:relative;display:flex;align-items:center;gap:7px;font:500 12px/1.2 var(--mono);color:var(--ink-2);text-decoration:none;white-space:nowrap}
.rl:hover{color:var(--ink);text-decoration:underline}
.track{position:absolute;left:0;top:50%;height:14px;transform:translateY(-50%);display:block;overflow:hidden;border-radius:0 4px 4px 0;background:color-mix(in srgb,var(--mc) 24%,transparent)}
.track svg{display:block;width:100%;height:100%}
.track rect{fill:var(--mc)}
.row:hover .track,.row:focus-within .track{box-shadow:0 0 0 1px var(--ink-3)}
.dur{position:absolute;top:50%;transform:translateY(-50%);font:500 12px/1 var(--mono);color:var(--ink);white-space:nowrap}
.mk{position:absolute;top:50%;width:24px;height:24px;transform:translate(-50%,-50%);display:grid;place-items:center;border-radius:50%}
.mk::before{content:"";width:9px;height:9px;border-radius:50%;background:var(--ink);box-shadow:0 0 0 2px var(--surface);transition:transform .12s}
.mk:hover::before,.mk:focus-visible::before{transform:scale(1.4)}
.tbl{margin-top:12px;border-top:1px solid var(--line);padding-top:8px}
summary{cursor:pointer;font-size:13px;color:var(--ink-2);padding:4px 0}
.scroll{overflow-x:auto;margin-top:6px}
table{width:100%;min-width:640px;border-collapse:collapse;font-size:13px}
th{font-weight:500;font-size:12px;color:var(--ink-3);text-align:left;padding:0 14px 8px 0;border-bottom:1px solid var(--axis);white-space:nowrap}
td{padding:8px 14px 8px 0;border-bottom:1px solid var(--line);white-space:nowrap}
.lbl{display:inline-flex;align-items:center;gap:7px}
th.r,td.r{text-align:right}
td:last-child,th:last-child{padding-right:0}
.tip{position:fixed;z-index:10;left:0;top:0;pointer-events:none;max-width:260px;padding:9px 11px;border-radius:8px;background:var(--surface);border:1px solid var(--line);box-shadow:0 6px 20px rgba(20,19,15,.18);font-size:12px;line-height:1.55}
.tip[hidden]{display:none}
.tip .tt{font:500 11.5px/1.5 var(--mono);color:var(--ink-3);margin-bottom:4px}
.tip .tm{display:flex;align-items:baseline;gap:7px;font:500 11.5px/1.5 var(--mono);color:var(--ink);overflow-wrap:anywhere;margin-bottom:5px}
.tip .tm .dot{align-self:center}
.tip .tr{display:flex;gap:8px;align-items:baseline}
.tip .tr b{font-weight:700;font-variant-numeric:tabular-nums;color:var(--ink);min-width:7ch}
.tip .tr span{color:var(--ink-2)}
.tip img{display:block;width:240px;max-width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:4px;background:var(--viewer);margin-bottom:6px}
@media (max-width:640px){:root{--lw:100px;--rw:46px}.rl{font-size:11px}.chart{padding-inline:12px}}
/* カード */
.days{display:grid;gap:36px;margin-top:22px}
.day{margin-top:0}
.day h3{font-size:15px;line-height:1.5}
.day h3 small{font:400 12px var(--mono);color:var(--ink-3);margin-left:6px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:16px;margin-top:12px}
.run{display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);border-radius:8px;overflow:hidden}
.cover{position:relative;display:block;aspect-ratio:16/10;background:var(--viewer);overflow:hidden}
.cover img{display:block;width:100%;height:100%;object-fit:cover}
.badge{position:absolute;left:8px;bottom:8px;font:500 11px/1 var(--mono);padding:5px 8px;border-radius:999px;background:rgba(16,19,34,.78);color:#f4ead8;border:1px solid rgba(244,234,216,.25)}
.mchip{position:absolute;left:8px;top:8px;z-index:1;display:inline-flex;align-items:center;gap:6px;max-width:calc(100% - 16px);font:500 11px/1.3 var(--mono);padding:5px 9px 5px 8px;border-radius:999px;background:var(--surface);color:var(--ink);border:1px solid var(--line);box-shadow:0 1px 4px rgba(0,0,0,.2);overflow-wrap:anywhere}
.noshot{display:grid;place-items:center;background:var(--wash);color:var(--ink-3);font-size:12.5px;text-decoration:none}
.strip{display:flex;gap:6px;padding:8px 10px 0}
.th{flex:0 0 calc((100% - 30px)/6);min-width:0;aspect-ratio:16/10;padding:0;border:0;border-radius:4px;overflow:hidden;background:var(--viewer);cursor:pointer;opacity:.6;transition:opacity .12s}
.th:hover,.th[aria-pressed="true"]{opacity:1}
.th[aria-pressed="true"]{outline:2px solid var(--ink);outline-offset:1px}
.th img{display:block;width:100%;height:100%;object-fit:cover}
.body{display:flex;flex-direction:column;gap:8px;padding:12px 14px 14px;flex:1}
.body h4{font-size:15px;line-height:1.4}
.body h4 a{text-decoration:none}
.body h4 a:hover{text-decoration:underline}
.stats{display:flex;flex-wrap:wrap;gap:4px 16px}
.stats dt{font-size:11px;color:var(--ink-3);line-height:1.5}
.stats dd{font:500 12.5px/1.5 var(--mono);font-variant-numeric:tabular-nums}
.body .lede{font-size:12.5px;line-height:1.7;color:var(--ink-2);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.links{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin-top:auto;padding-top:4px;font-size:13px}
.status{display:inline-flex;align-items:center;gap:6px;margin-left:auto;font:500 11.5px/1 var(--mono);padding:5px 9px 5px 8px;border:1px solid var(--line);border-radius:999px;color:var(--ink-2)}
.status i{width:8px;height:8px;border-radius:50%;background:var(--good);display:block}
.status.bad i{background:var(--crit)}
footer{margin-top:56px;padding-top:18px;border-top:1px solid var(--line);font-size:12px;color:var(--ink-3)}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

const JS = `
(() => {
  const tip = document.getElementById("tip");
  const chart = document.querySelector(".chart");
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  let cur = null;
  const hide = () => { cur = null; tip.hidden = true; };
  const target = (n) => n.closest && (n.closest("[data-shot]") || n.closest(".row[data-tip]"));
  const build = (t) => {
    tip.replaceChildren();
    if (t.dataset.shot) {
      const s = JSON.parse(t.dataset.shot);
      const img = el("img"); img.src = s.src; img.alt = "";
      tip.append(img, el("div", "tt", s.cap));
    } else {
      const d = JSON.parse(t.dataset.tip);
      tip.append(el("div", "tt", d.title));
      const tm = el("div", "tm " + d.slot); tm.append(el("i", "dot"), el("span", null, d.model)); tip.append(tm);
      for (const [k, v] of d.rows) { const r = el("div", "tr"); r.append(el("b", null, v), el("span", null, k)); tip.append(r); }
    }
  };
  const place = (x, y) => {
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let l = x + 14, t = y + 14;
    if (l + w > innerWidth - 8) l = x - w - 14;
    if (t + h > innerHeight - 8) t = y - h - 14;
    tip.style.left = Math.max(8, l) + "px"; tip.style.top = Math.max(8, t) + "px";
  };
  chart.addEventListener("pointerover", (e) => {
    const t = target(e.target);
    if (!t) return hide();
    if (t !== cur) { cur = t; build(t); tip.hidden = false; }
    place(e.clientX, e.clientY);
  });
  chart.addEventListener("pointermove", (e) => { if (cur) place(e.clientX, e.clientY); });
  chart.addEventListener("pointerleave", hide);
  chart.addEventListener("focusin", (e) => {
    const t = target(e.target); if (!t) return;
    cur = t; build(t); tip.hidden = false;
    const r = e.target.getBoundingClientRect(); place(r.left + r.width / 2, r.bottom);
  });
  chart.addEventListener("focusout", hide);
  addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });

  const pick = (b) => {
    const card = b.closest(".run");
    card.querySelector(".cover img").src = b.dataset.src;
    card.querySelector(".badge").textContent = b.dataset.cap;
    card.querySelectorAll(".th").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  };
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest(".th"); if (b) pick(b); });
  document.addEventListener("pointerover", (e) => { if (e.pointerType !== "mouse") return; const b = e.target.closest && e.target.closest(".th"); if (b) pick(b); });
})();
`;

const page = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>llm-bench reports</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%232a78d6'/%3E%3Cpath d='M7 11h12M7 17h18M7 23h9' stroke='white' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E">
<meta name="description" content="llm-bench の実行レポート一覧。API 呼び出しのタイムライン、スクリーンショット、成果物を実行ごとにまとめています。">
<style>${CSS}</style>
</head>
<body>
<main>
<header>
  <div class="eyebrow">kzmake / llm-bench-reports</div>
  <h1>llm-bench レポート</h1>
  <p class="lede-top">llm-bench の実行ごとのレポート一覧です。API 呼び出しのタイムライン、スクリーンショット、成果物を 1 回の実行単位でまとめています。</p>
  ${kpiHtml}
</header>

<section id="timeline">
  <h2>実行のタイムライン</h2>
  <p class="sec-lede">横軸は実行開始からの経過時間で、全実行で共通です。色は実行したモデルを表し、濃い区間が API 呼び出し中、その間の空白がツール実行などの待ち時間で、薄い帯は実行全体の長さを表します。丸印にポインタを重ねるとその時点のスクリーンショットが表示され、行をクリックするとレポートを開きます。</p>
  ${chartHtml}
</section>

<section id="reports">
  <h2>レポート</h2>
  <p class="sec-lede">新しい順です。カード左上のバッジが、実行したモデルです。サムネイルにポインタを重ねる(タップする)と、実行中のスクリーンショットを時系列で見られます。</p>
  <div class="days">
${daysHtml}
  </div>
</section>

<footer>${runs.length} 件のレポート · <code class="mono">bun build-index.ts</code> で生成</footer>
</main>
<div id="tip" class="tip" role="tooltip" hidden></div>
<script>${JS}</script>
</body>
</html>
`;

writeFileSync(join(ROOT, "index.html"), page);
console.log(`index.html を生成: ${runs.length} 件 / 軸 0〜${axisMax / 60} 分 (目盛り ${step / 60} 分)`);
for (const r of runs) {
  console.log(
    `  ${r.date} ${r.time} ${r.hash}  ${slot(r.model)}  ${r.model}  T=${clock(r.T).padStart(7)}  calls=${String(r.calls.length).padStart(3)}  shots=${String(r.shots.length).padStart(2)}  work=${r.work ? "✓" : "-"}  ${r.ok ? "ok" : "BAD"}`,
  );
}
