/**
 * KBO 단장 모드 (v1.0) — 밸런스 진단 모듈 (KBO_GM.Balance)
 * 실제 게임 엔진으로 새 리그를 만들어 여러 시즌을 돌리고 리그 밸런스를 측정한다.
 * 진행 중인 세이브(유저의 게임)는 건드리지 않는다. 유저 구단은 아무 조작도 하지 않는다(스토브리그는 마감일 자동 처리).
 *
 *   - 브라우저: 헤더의 "8시즌 밸런스 진단" 버튼 (진행률 표시, 주 단위로 쉬어 가며 비동기 실행)
 *   - Node: tools/balance-check.js
 *
 * 측정 항목: 승률 표준편차·1위/10위 승률·전년 대비 순위 상관, 재정(적자 구단·여유 예산),
 *            OVR 85/90/95/100+ 인원, 최고 능력치, 외부 FA 이적, 포스팅 제안, 경쟁균형세 제재, 상무 복무
 */

(function (root, factory) {
  const balanceModule = factory(root.KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM));
  if (typeof globalThis !== "undefined") {
    globalThis.KBO_GM = Object.assign(globalThis.KBO_GM || {}, { Balance: balanceModule });
  }
  if (typeof window !== "undefined") {
    window.KBO_GM = Object.assign(window.KBO_GM || {}, { Balance: balanceModule });
  }
  if (typeof module === "object" && module.exports) {
    module.exports = balanceModule;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function (KBO_GM) {
  "use strict";

  // 실제 KBO 기준선 (비교용)
  const KBO_REFERENCE = { sd: [0.06, 0.07], topPct: [0.6, 0.63], bottomPct: [0.38, 0.42] };

  const eok = (manwon) => Math.round(manwon / 1000) / 10;
  const isDomestic = (p) => !p.nationality || p.nationality === "KOR";
  const maxStat = (p) => Math.max(0, ...Object.values(p.st || {}).filter((v) => typeof v === "number"));
  const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

  function spearman(prev, cur) {
    const ids = Object.keys(prev).filter((id) => id in cur);
    const n = ids.length;
    if (n < 2) return null;
    const dsq = ids.reduce((s, id) => s + (prev[id] - cur[id]) ** 2, 0);
    return 1 - (6 * dsq) / (n * (n * n - 1));
  }

  function snapshotSeason(ctx) {
    const st = (ctx.standings || []).map((s) => ({ id: s.teamId, rank: s.rank, w: s.w, l: s.l }));
    const pcts = st.map((s) => s.w / Math.max(1, s.w + s.l));
    const sd = Math.sqrt(pcts.reduce((a, v) => a + (v - 0.5) ** 2, 0) / Math.max(1, pcts.length));
    const domestic = ctx.kboTeams.flatMap((t) => t.getAllPlayers()).filter(isDomestic);
    const ovrs = domestic.map((p) => p.getTrueOvr());
    const fin = ctx.kboTeams.map((t) => ({ id: t.id, room: eok(t.getAvailableBudget()) }));
    const user = st.find((s) => s.id === ctx.userTeamId) || {};
    return {
      year: ctx.currentYear,
      sd,
      topPct: Math.max(...pcts),
      bottomPct: Math.min(...pcts),
      ranks: Object.fromEntries(st.map((s) => [s.id, s.rank])),
      userRank: user.rank,
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
    };
  }

  /**
   * 1회 실행: 새 리그에서 seasons 시즌을 진행
   * @param {Object} opts { seasons, team, difficulty, onWeek(weekIdx, totalWeeks) }
   */
  async function runOnce(opts) {
    const GM = KBO_GM;
    const ctx = GM.Setup.createGameContextSync({ userTeamId: opts.team, difficulty: opts.difficulty, autoSave: false });
    const startYear = ctx.currentYear;
    const totalWeeks = opts.seasons * 53;
    const seasons = [];
    let faExternalMoves = 0;
    let postingOffers = 0;

    // 이 진단 컨텍스트의 외부 FA 이적만 집계 (진행 중인 유저 게임은 영향 없음)
    const origFA = GM.Offseason.runFAMarketSession;
    GM.Offseason.runFAMarketSession = function (c, ...rest) {
      const r = origFA.call(this, c, ...rest);
      if (c === ctx) {
        (r.signedContracts || []).forEach((x) => {
          if (x.formerTeamId && x.newTeamId && x.formerTeamId !== x.newTeamId) faExternalMoves += 1;
        });
      }
      return r;
    };

    try {
      let week = 0;
      let lastOctYear = null;
      let postingCountedYear = null;
      while (ctx.currentYear < startYear + opts.seasons && week < totalWeeks + 20) {
        GM.Setup.advanceDays(ctx, 7);
        week += 1;
        const mm = ctx.currentDate.slice(5, 7);
        if (mm === "11" && postingCountedYear !== ctx.currentYear) {
          postingCountedYear = ctx.currentYear;
          postingOffers += ctx.kboTeams.reduce((s, t) => s + GM.Extensions.getMLBPostingCandidates(ctx, t.id).length, 0);
        }
        if (mm === "10" && lastOctYear !== ctx.currentYear) {
          lastOctYear = ctx.currentYear;
          seasons.push(snapshotSeason(ctx));
        }
        if (opts.onWeek) await opts.onWeek(week, totalWeeks);
      }
    } finally {
      GM.Offseason.runFAMarketSession = origFA;
    }

    for (let i = 1; i < seasons.length; i++) seasons[i].rankCorr = spearman(seasons[i - 1].ranks, seasons[i].ranks);
    return {
      seasons,
      faExternalMoves,
      postingOffers,
      postings: (ctx.postingHistory || []).length,
      luxuryTaxPenalties: ctx.kboTeams.reduce((s, t) => s + (t.luxuryTaxHistory || []).filter((h) => h.isOverCap).length, 0)
    };
  }

  /** 여러 회 실행 후 시즌별 평균 요약 */
  function summarize(runs, seasons) {
    const rows = [];
    for (let s = 0; s < seasons; s++) {
      const list = runs.map((r) => r.seasons[s]).filter(Boolean);
      if (!list.length) continue;
      const avg = (k) => list.reduce((a, x) => a + (x[k] ?? 0), 0) / list.length;
      const corrList = list.map((x) => x.rankCorr).filter((v) => v != null);
      rows.push({
        seasonNo: s + 1,
        year: list[0].year,
        sd: avg("sd"),
        topPct: avg("topPct"),
        bottomPct: avg("bottomPct"),
        rankCorr: corrList.length ? corrList.reduce((a, v) => a + v, 0) / corrList.length : null,
        userRanks: list.map((x) => x.userRank),
        maxOvr: avg("maxOvr"),
        ovr85: avg("ovr85"),
        ovr90: avg("ovr90"),
        ovr95: avg("ovr95"),
        ovr100: avg("ovr100"),
        maxStat: avg("maxStat"),
        deficitTeams: avg("deficitTeams"),
        minRoom: avg("minRoom"),
        maxRoom: avg("maxRoom"),
        userRoom: avg("userRoom"),
        military: avg("military")
      });
    }
    const avgTotal = (k) => runs.reduce((a, r) => a + r[k], 0) / Math.max(1, runs.length);
    return {
      rows,
      totals: {
        faExternalMoves: avgTotal("faExternalMoves"),
        postingOffers: avgTotal("postingOffers"),
        postings: avgTotal("postings"),
        luxuryTaxPenalties: avgTotal("luxuryTaxPenalties")
      },
      reference: KBO_REFERENCE
    };
  }

  /**
   * 밸런스 진단 실행
   * @param {Object} options { seasons=8, runs=3, team='KIA', difficulty='NORMAL', onProgress(fraction, label), yieldEveryWeeks=4 }
   */
  async function runBalanceCheck(options = {}) {
    const opts = {
      seasons: Number(options.seasons) || 8,
      runs: Number(options.runs) || 3,
      team: options.team || "KIA",
      difficulty: options.difficulty || "NORMAL",
      yieldEveryWeeks: Number(options.yieldEveryWeeks) || 4
    };
    const startMs = Date.now();
    const runs = [];
    for (let r = 0; r < opts.runs; r++) {
      const result = await runOnce({
        ...opts,
        onWeek: async (week, totalWeeks) => {
          if (week % opts.yieldEveryWeeks !== 0) return;
          if (options.onProgress) {
            const fraction = (r + Math.min(1, week / totalWeeks)) / opts.runs;
            options.onProgress(fraction, `${r + 1}/${opts.runs}회차 · ${Math.min(opts.seasons, Math.ceil(week / 53))}/${opts.seasons}시즌`);
          }
          await nextTick();
        }
      });
      runs.push(result);
    }
    if (options.onProgress) options.onProgress(1, "완료");
    return { options: opts, elapsedMs: Date.now() - startMs, runs, summary: summarize(runs, opts.seasons) };
  }

  return {
    KBO_REFERENCE,
    runBalanceCheck,
    summarize
  };
});
