/**
 * KBO 단장 모드 (v1.0) — 시즌 회고 리포트 모듈 (KBO_GM.Retro)
 * "이번 시즌 단장의 결정이 승수에 얼마나 영향을 줬나"를 WAR(대체선수 대비 승리기여, 1 WAR ≈ 1승)로 정리한다.
 *
 *   - 기준점: 직전 시즌 종료(11월 4일) 시점 로스터 스냅샷 (첫해는 2025년 1월 1일 부임 시점)
 *   - 영입 효과: 스냅샷 이후 합류한 선수의 이번 시즌 WAR (영입 경로별: FA·트레이드·외국인·드래프트·2차 드래프트 등)
 *   - 이탈 손실: 스냅샷에 있었지만 떠난 선수가 이번 시즌 다른 팀에서 기록한 WAR (MLB 진출·방출은 직전 시즌 WAR로 추정)
 *   - 결정 순효과 = 영입 WAR - 이탈 WAR
 *   - 성장: 잔류 선수의 OVR 변화 (육성·노쇠화)
 *   - 운: 득실점 기반 기대 승수(피타고리안) 대비 실제 승수 차이
 *
 * 의존: gm-schema.js (Player.getWar / getTrueOvr), gm-economy.js (재정 요약, 선택)
 */

(function (root, factory) {
  const retroModule = factory(root.KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM));
  if (typeof globalThis !== "undefined") {
    globalThis.KBO_GM = Object.assign(globalThis.KBO_GM || {}, { Retro: retroModule });
  }
  if (typeof window !== "undefined") {
    window.KBO_GM = Object.assign(window.KBO_GM || {}, { Retro: retroModule });
  }
  if (typeof module === "object" && module.exports) {
    module.exports = retroModule;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function (KBO_GM) {
  "use strict";

  const MAX_STORED_REPORTS = 20;
  const ROUTE_LABEL = {
    FA: "FA 영입",
    FA_COMPENSATION: "FA 보상선수",
    TRADE: "트레이드",
    FOREIGN: "외국인 선수",
    DRAFT: "신인 드래프트",
    SECONDARY_DRAFT: "2차 드래프트",
    OTHER: "기타 합류"
  };

  const r1 = (v) => Math.round((Number(v) || 0) * 10) / 10;

  function teamPlayers(team) {
    return [
      ...team.getAllPlayers(),
      ...(team.militaryList || []),
      ...(team.foreignRehabList || [])
    ];
  }

  function warOf(p) {
    return typeof p.getWar === "function" ? Number(p.getWar()) || 0 : 0;
  }

  /** 기준 로스터 스냅샷 저장 (다음 리포트의 비교 기준) */
  function takeRosterSnapshot(context) {
    if (!context || typeof context.getUserTeam !== "function") return null;
    const team = context.getUserTeam();
    if (!team) return null;
    const players = {};
    teamPlayers(team).forEach((p) => {
      players[p.id] = { name: p.name, pos: p.pos, age: p.age, ovr: p.getTrueOvr(), war: r1(warOf(p)) };
    });
    context.retroSnapshot = {
      year: context.currentYear,
      date: context.currentDate,
      teamId: team.id,
      players
    };
    return context.retroSnapshot;
  }

  function findPlayerAnywhere(context, playerId) {
    for (const t of context.kboTeams || []) {
      const p = teamPlayers(t).find((x) => x.id === playerId);
      if (p) return { player: p, team: t };
    }
    return null;
  }

  /** 시즌 회고 리포트 생성 (11월 4일 자동 호출, 리포트 생성 후 다음 시즌 기준 스냅샷을 새로 찍는다) */
  function buildSeasonRetrospective(context) {
    if (!context || typeof context.getUserTeam !== "function") return null;
    const team = context.getUserTeam();
    const snap = context.retroSnapshot;
    if (!team || !snap || snap.teamId !== team.id) return null;
    const year = context.currentYear;

    // 1) 팀 성적과 운
    const rec = team.record || { w: 0, l: 0, d: 0, rs: 0, ra: 0 };
    const games = (rec.w || 0) + (rec.l || 0) + (rec.d || 0);
    const rs = rec.rs || 0;
    const ra = rec.ra || 0;
    const pythPct = rs + ra > 0 ? Math.pow(rs, 1.83) / (Math.pow(rs, 1.83) + Math.pow(ra, 1.83)) : 0.5;
    const expectedWins = r1(pythPct * ((rec.w || 0) + (rec.l || 0)));
    const luckWins = r1((rec.w || 0) - expectedWins);
    const standingRow = (context.standings || []).find((s) => s.teamId === team.id) || {};
    const goal = team.ownerExpectation || null;

    // 2) 영입 / 이탈 / 잔류 분류
    const current = teamPlayers(team);
    const currentIds = new Set(current.map((p) => p.id));
    const acquired = current
      .filter((p) => !snap.players[p.id])
      .map((p) => {
        const via = (p.acquiredVia && p.acquiredVia.type) || "OTHER";
        return { id: p.id, name: p.name, pos: p.pos, age: p.age, ovr: p.getTrueOvr(), war: r1(warOf(p)), route: via, routeLabel: ROUTE_LABEL[via] || ROUTE_LABEL.OTHER };
      })
      .sort((a, b) => b.war - a.war);

    const postedIds = new Set((context.postingHistory || []).map((h) => h.playerId));
    const departed = Object.keys(snap.players)
      .filter((id) => !currentIds.has(id))
      .map((id) => {
        const before = snap.players[id];
        const found = findPlayerAnywhere(context, id);
        if (found) {
          return { id, name: before.name, pos: before.pos, war: r1(warOf(found.player)), destination: found.team.name, estimated: false };
        }
        // KBO 밖으로 떠난 선수(MLB 진출·방출·은퇴)는 이번 시즌 기록이 없으므로 직전 시즌 WAR로 손실을 추정
        return {
          id,
          name: before.name,
          pos: before.pos,
          war: r1(Math.max(0, before.war || 0)),
          destination: postedIds.has(id) ? "MLB 진출" : "방출·은퇴",
          estimated: true
        };
      })
      .sort((a, b) => b.war - a.war);

    const returning = current
      .filter((p) => snap.players[p.id])
      .map((p) => ({ id: p.id, name: p.name, pos: p.pos, age: p.age, ovrBefore: snap.players[p.id].ovr, ovrNow: p.getTrueOvr(), war: r1(warOf(p)) }))
      .map((x) => ({ ...x, ovrDelta: x.ovrNow - x.ovrBefore }));

    // 3) 경로별 합계 및 순효과
    const byRoute = {};
    acquired.forEach((a) => {
      if (!byRoute[a.route]) byRoute[a.route] = { route: a.route, label: a.routeLabel, count: 0, war: 0 };
      byRoute[a.route].count += 1;
      byRoute[a.route].war = r1(byRoute[a.route].war + a.war);
    });
    const acquiredWar = r1(acquired.reduce((s, a) => s + a.war, 0));
    const departedWar = r1(departed.reduce((s, d) => s + d.war, 0));
    const netDecisionWins = r1(acquiredWar - departedWar);
    const returningWar = r1(returning.reduce((s, x) => s + x.war, 0));
    const growth = returning.slice().sort((a, b) => b.ovrDelta - a.ovrDelta);

    // 4) 재정
    const fin =
      KBO_GM && KBO_GM.Economy && typeof KBO_GM.Economy.getFinanceSummary === "function"
        ? KBO_GM.Economy.getFinanceSummary(context, team)
        : null;

    // 5) 한 줄 요약
    const headline = [
      `${year} 시즌 ${rec.w}승 ${rec.l}패 ${rec.d || 0}무 (${standingRow.rank || "-"}위)`,
      `결정 순효과 ${netDecisionWins >= 0 ? "+" : ""}${netDecisionWins}승 (영입 +${acquiredWar} / 이탈 -${departedWar})`,
      `운 ${luckWins >= 0 ? "+" : ""}${luckWins}승 (득실점 기대 ${expectedWins}승)`
    ].join(" · ");

    const report = {
      year,
      generatedDate: context.currentDate,
      teamId: team.id,
      teamName: team.name,
      headline,
      record: { w: rec.w || 0, l: rec.l || 0, d: rec.d || 0, rs, ra, games },
      rank: standingRow.rank || null,
      goal: goal ? { title: goal.goalTitle, targetRank: goal.targetRank, achieved: standingRow.rank ? standingRow.rank <= goal.targetRank : null } : null,
      expectedWins,
      luckWins,
      acquiredWar,
      departedWar,
      netDecisionWins,
      returningWar,
      byRoute: Object.values(byRoute).sort((a, b) => b.war - a.war),
      acquired: acquired.slice(0, 12),
      departed: departed.slice(0, 12),
      topGrowth: growth.filter((x) => x.ovrDelta > 0).slice(0, 5),
      topDecline: growth.filter((x) => x.ovrDelta < 0).slice(-5).reverse(),
      finance: fin
        ? { subsidy: fin.subsidy, carryover: fin.carryover, revenue: fin.seasonRevenue, payroll: fin.payroll, available: fin.available, deficitWeeks: fin.deficitWeeks }
        : null,
      baseline: { year: snap.year, date: snap.date }
    };

    if (!Array.isArray(context.seasonRetros)) context.seasonRetros = [];
    context.seasonRetros = context.seasonRetros.filter((r) => r.year !== year);
    context.seasonRetros.unshift(report);
    if (context.seasonRetros.length > MAX_STORED_REPORTS) context.seasonRetros.length = MAX_STORED_REPORTS;

    takeRosterSnapshot(context);
    return report;
  }

  return {
    ROUTE_LABEL,
    takeRosterSnapshot,
    buildSeasonRetrospective
  };
});
