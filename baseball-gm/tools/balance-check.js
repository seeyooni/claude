#!/usr/bin/env node
/**
 * 밸런스 진단 — 실제 게임 엔진(gm-*.js)으로 여러 시즌을 돌려 리그 밸런스를 측정한다.
 *
 *   node tools/balance-check.js [--seasons 8] [--runs 3] [--team KIA] [--difficulty NORMAL] [--json out.json]
 *
 * 유저 구단은 아무 조작도 하지 않는다(모든 스토브리그 업무는 마감일 자동 처리).
 * 측정 항목:
 *   - 전력 평준화: 시즌별 승률 표준편차, 1위·10위 승률, 전년 대비 순위 상관(스피어만)
 *   - 재정: 시즌 종료(10월) 시점 구단별 예산·연봉총액·여유 예산, 적자 구단 수, 경쟁균형세 제재
 *   - 선수: 리그 최고 OVR, OVR 85/90/95/100 이상 인원, 최고 단일 능력치
 *   - 이동: 외부 FA 이적 건수, MLB 포스팅 제안·진출, 상무 복무 인원
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const MODULES = [
  "gm-schema.js",
  "gm-match-sim.js",
  "gm-weekly-sim.js",
  "gm-storage.js",
  "gm-draft.js",
  "gm-offseason.js",
  "gm-spring-camp.js",
  "gm-extensions.js",
  "gm-setup.js",
  "gm-economy.js",
  "gm-retro.js"
];

function parseArgs(argv) {
  const args = { seasons: 8, runs: 3, team: "KIA", difficulty: "NORMAL", json: null };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    if (key in args) args[key] = argv[++i];
  }
  args.seasons = Number(args.seasons) || 8;
  args.runs = Number(args.runs) || 3;
  return args;
}

function loadEngine() {
  const root = path.resolve(__dirname, "..");
  MODULES.forEach((f) => vm.runInThisContext(fs.readFileSync(path.join(root, f), "utf8"), { filename: f }));
  return globalThis.KBO_GM;
}

const eok = (manwon) => Math.round(manwon / 1000) / 10;
const isDomestic = (p) => !p.nationality || p.nationality === "KOR";
const maxStat = (p) => Math.max(0, ...Object.values(p.st || {}).filter((v) => typeof v === "number"));

function spearman(prev, cur) {
  const ids = Object.keys(prev).filter((id) => id in cur);
  const n = ids.length;
  if (n < 2) return null;
  const dsq = ids.reduce((s, id) => s + (prev[id] - cur[id]) ** 2, 0);
  return 1 - (6 * dsq) / (n * (n * n - 1));
}

function runOnce(GM, args) {
  const ctx = GM.Setup.createGameContextSync({ userTeamId: args.team, difficulty: args.difficulty, autoSave: false });
  const startYear = ctx.currentYear;
  const seasons = [];
  let faExternalMoves = 0;
  let postingOffers = 0;

  // 외부 FA 이적 집계
  const origFA = GM.Offseason.runFAMarketSession;
  GM.Offseason.runFAMarketSession = function (...a) {
    const r = origFA.apply(this, a);
    (r.signedContracts || []).forEach((c) => {
      if (c.formerTeamId && c.newTeamId && c.formerTeamId !== c.newTeamId) faExternalMoves += 1;
    });
    return r;
  };

  let guard = 0;
  let lastOctYear = null;
  let postingCountedYear = null;
  while (ctx.currentYear < startYear + args.seasons && guard++ < args.seasons * 60) {
    GM.Setup.advanceDays(ctx, 7);
    const mm = ctx.currentDate.slice(5, 7);

    // 포스팅 기간 중 제안 수 (해마다 1회 집계)
    if (mm === "11" && postingCountedYear !== ctx.currentYear) {
      postingCountedYear = ctx.currentYear;
      postingOffers += ctx.kboTeams.reduce((s, t) => s + GM.Extensions.getMLBPostingCandidates(ctx, t.id).length, 0);
    }

    // 정규시즌 종료 직후(10월 첫 주) 스냅샷
    if (mm === "10" && lastOctYear !== ctx.currentYear) {
      lastOctYear = ctx.currentYear;
      const st = (ctx.standings || []).map((s) => ({ id: s.teamId, rank: s.rank, w: s.w, l: s.l }));
      const pcts = st.map((s) => s.w / Math.max(1, s.w + s.l));
      const sd = Math.sqrt(pcts.reduce((a, v) => a + (v - 0.5) ** 2, 0) / Math.max(1, pcts.length));
      const domestic = ctx.kboTeams.flatMap((t) => t.getAllPlayers()).filter(isDomestic);
      const ovrs = domestic.map((p) => p.getTrueOvr());
      const fin = ctx.kboTeams.map((t) => ({
        id: t.id,
        budget: eok(t.budget),
        payroll: eok(t.getTotalPayroll()),
        room: eok(t.getAvailableBudget())
      }));
      const user = st.find((s) => s.id === ctx.userTeamId) || {};
      seasons.push({
        year: ctx.currentYear,
        sd,
        topPct: Math.max(...pcts),
        bottomPct: Math.min(...pcts),
        ranks: Object.fromEntries(st.map((s) => [s.id, s.rank])),
        userRank: user.rank,
        userRecord: `${user.w}-${user.l}`,
        maxOvr: Math.max(...ovrs),
        ovr85: ovrs.filter((v) => v >= 85).length,
        ovr90: ovrs.filter((v) => v >= 90).length,
        ovr95: ovrs.filter((v) => v >= 95).length,
        ovr100: ovrs.filter((v) => v >= 100).length,
        maxStat: Math.max(...domestic.map(maxStat)),
        deficitTeams: fin.filter((f) => f.room < 0).length,
        minRoom: Math.min(...fin.map((f) => f.room)),
        maxRoom: Math.max(...fin.map((f) => f.room)),
        userRoom: (fin.find((f) => f.id === ctx.userTeamId) || {}).room,
        military: ctx.kboTeams.reduce((s, t) => s + (t.militaryList || []).length, 0)
      });
    }
  }
  GM.Offseason.runFAMarketSession = origFA;

  for (let i = 1; i < seasons.length; i++) seasons[i].rankCorr = spearman(seasons[i - 1].ranks, seasons[i].ranks);
  return {
    seasons,
    faExternalMoves,
    postingOffers,
    postings: (ctx.postingHistory || []).length,
    luxuryTaxPenalties: ctx.kboTeams.reduce((s, t) => s + (t.luxuryTaxHistory || []).filter((h) => h.isOverCap).length, 0)
  };
}

function fmt(v, d = 3) {
  return v == null || Number.isNaN(v) ? "-" : typeof v === "number" ? v.toFixed(d) : String(v);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const GM = loadEngine();
  const t0 = Date.now();
  const runs = [];
  for (let r = 0; r < args.runs; r++) runs.push(runOnce(GM, args));

  console.log(`# 밸런스 진단 — ${args.seasons}시즌 × ${args.runs}회 (유저 ${args.team}, 난이도 ${args.difficulty}, ${((Date.now() - t0) / 1000).toFixed(1)}초)\n`);
  console.log("| 시즌 | 승률 SD | 1위 | 10위 | 순위상관 | 유저 순위 | 최고 OVR | 85+ | 90+ | 95+ | 100 | 최고 능력치 | 적자 구단 | 여유 최소/최대(억) | 유저 여유 | 상무 |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (let s = 0; s < args.seasons; s++) {
    const rows = runs.map((r) => r.seasons[s]).filter(Boolean);
    if (!rows.length) continue;
    const avg = (k) => rows.reduce((a, x) => a + (x[k] ?? 0), 0) / rows.length;
    const list = (k) => rows.map((x) => x[k]).join("/");
    console.log(
      `| ${rows[0].year} | ${fmt(avg("sd"))} | ${fmt(avg("topPct"))} | ${fmt(avg("bottomPct"))} | ${rows[0].rankCorr == null ? "-" : fmt(avg("rankCorr"), 2)} | ${list("userRank")} | ${list("maxOvr")} | ${list("ovr85")} | ${list("ovr90")} | ${list("ovr95")} | ${list("ovr100")} | ${list("maxStat")} | ${list("deficitTeams")} | ${fmt(avg("minRoom"), 1)}/${fmt(avg("maxRoom"), 1)} | ${list("userRoom")} | ${fmt(avg("military"), 0)} |`
    );
  }
  const tot = (k) => runs.map((r) => r[k]).join("/");
  console.log(`\n외부 FA 이적: ${tot("faExternalMoves")} · 포스팅 제안: ${tot("postingOffers")} · 포스팅 진출: ${tot("postings")} · 경쟁균형세 제재(구단·연): ${tot("luxuryTaxPenalties")}`);
  console.log("참고: 실제 KBO 승률 SD ≈ 0.06~0.07, 1위 ≈ .600~.630, 10위 ≈ .380~.420");

  if (args.json) fs.writeFileSync(args.json, JSON.stringify({ args, runs }, null, 2));
}

main();
