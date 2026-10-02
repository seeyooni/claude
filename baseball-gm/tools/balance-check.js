#!/usr/bin/env node
/**
 * 밸런스 진단 — 실제 게임 엔진(gm-*.js)으로 여러 시즌을 돌려 리그 밸런스를 측정한다.
 * 측정 로직은 게임 내 "8시즌 밸런스 진단" 버튼과 같은 gm-balance.js(KBO_GM.Balance)를 사용한다.
 *
 *   node tools/balance-check.js [--seasons 8] [--runs 3] [--team KIA] [--difficulty NORMAL] [--json out.json]
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
  "gm-nonfa.js",
  "gm-retro.js",
  "gm-balance.js",
  "gm-frontoffice.js"
];

function parseArgs(argv) {
  const args = { seasons: 8, runs: 3, team: "KIA", difficulty: "NORMAL", json: null };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    if (key in args) args[key] = argv[++i];
  }
  return args;
}

const f = (v, d = 3) => (v == null || Number.isNaN(v) ? "-" : Number(v).toFixed(d));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, "..");
  MODULES.forEach((file) => vm.runInThisContext(fs.readFileSync(path.join(root, file), "utf8"), { filename: file }));
  const GM = globalThis.KBO_GM;

  const result = await GM.Balance.runBalanceCheck({ ...args, yieldEveryWeeks: 1e9 });
  const { summary, options } = result;

  console.log(
    `# 밸런스 진단 — ${options.seasons}시즌 × ${options.runs}회 (유저 ${options.team}, 난이도 ${options.difficulty}, ${(result.elapsedMs / 1000).toFixed(1)}초)\n`
  );
  console.log("| 시즌 | 승률 SD | 1위 | 10위 | 순위상관 | 유저 순위 | 최고 OVR | 85+ | 90+ | 95+ | 100 | 최고 능력치 | 적자 구단 | 여유 최소/최대(억) | 유저 여유 | 상무 |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  summary.rows.forEach((r) => {
    console.log(
      `| ${r.year} | ${f(r.sd)} | ${f(r.topPct)} | ${f(r.bottomPct)} | ${f(r.rankCorr, 2)} | ${r.userRanks.join("/")} | ${f(r.maxOvr, 1)} | ${f(r.ovr85, 1)} | ${f(r.ovr90, 1)} | ${f(r.ovr95, 1)} | ${f(r.ovr100, 1)} | ${f(r.maxStat, 1)} | ${f(r.deficitTeams, 1)} | ${f(r.minRoom, 1)}/${f(r.maxRoom, 1)} | ${f(r.userRoom, 1)} | ${f(r.military, 0)} |`
    );
  });
  const t = summary.totals;
  console.log(
    `\n(회당 평균) 외부 FA 이적 ${f(t.faExternalMoves, 1)} · 포스팅 제안 ${f(t.postingOffers, 1)} · 포스팅 진출 ${f(t.postings, 1)} · 경쟁균형세 제재(구단·연) ${f(t.luxuryTaxPenalties, 1)}`
  );
  console.log("참고: 실제 KBO 승률 SD ≈ 0.06~0.07, 1위 ≈ .600~.630, 10위 ≈ .380~.420");

  if (args.json) fs.writeFileSync(args.json, JSON.stringify(result, null, 2));
}

main();
