/**
 * KBO 단장 모드 (v1.0) — 비FA 다년계약 모듈 (KBO_GM.NonFA)
 * 참고: 「KBO 리그 비FA 다년계약 전수 조사 및 패턴 분석」(사용자 제공 자료) 의 설계 제언을 게임 규모에 맞게 반영
 *
 *   - 대상: 우리 구단 국내 선수 · KBO 3시즌 이상 · 만 21~35세 · 현재 다년계약 중이 아님 (FA 직전만이 아니라 조기 장기계약도 가능)
 *   - 계약금 없음 (원소속팀 비FA 다년계약은 규약상 계약금 불가). 2~11년, 보장 연봉 + 성과 옵션(시즌 WAR 2.0 이상이면 지급)
 *   - 연봉 구조: 균등(EVEN) · 앞쪽 몰아주기(FRONT) · 뒤쪽 몰아주기(BACK)
 *   - 선수 요구액 = FA 시장가 × FA까지 남은 기간 × 포지션 희소성 × 부상 이력 × 구단 여유 예산 × 단장 특성
 *   - 포스팅 허용 조항: 29세 이하 OVR 85+ 선수는 요구액 -8%. 조항이 없으면 계약 기간 중 포스팅 불가
 *   - 프랜차이즈 예외: 한 구단 7시즌 이상 선수 1명 지정 → 경쟁균형세 산정 시 연봉 50% 제외 (KBO판 버드 룰)
 *   - 리스크: 32세+ & 5년+ 계약은 매년 15% '에이징 커브 파동', 장기 부상 중 계약은 50% 재활 대성공 / 50% 부상 재발
 *   - AI 구단도 FA 1년 전 핵심 선수와 다년계약 → FA 시장 매물이 줄어든다
 *   - FA 연차는 초기화하지 않는다 (계약 종료 후 쌓인 연차로 FA 자격)
 */

(function (root, factory) {
  const nonFaModule = factory(root.KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM));
  if (typeof globalThis !== "undefined") {
    globalThis.KBO_GM = Object.assign(globalThis.KBO_GM || {}, { NonFA: nonFaModule });
  }
  if (typeof window !== "undefined") {
    window.KBO_GM = Object.assign(window.KBO_GM || {}, { NonFA: nonFaModule });
  }
  if (typeof module === "object" && module.exports) {
    module.exports = nonFaModule;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function (KBO_GM) {
  "use strict";

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round100 = (v) => Math.round(v / 100) * 100;
  const eok = (manwon) => `${(manwon / 10000).toFixed(1)}억`;

  const MIN_YEARS = 2;
  const MAX_YEARS = 11;
  const OPTION_WAR_THRESHOLD = 2.0;
  const STRUCTURES = {
    EVEN: { key: "EVEN", label: "균등 분배" },
    FRONT: { key: "FRONT", label: "앞쪽 몰아주기 (초반 고액 → 후반 감액)" },
    BACK: { key: "BACK", label: "뒤쪽 몰아주기 (초반 저액 → 후반 증액)" }
  };
  const FRANCHISE_MIN_SEASONS = 7;

  function gm() {
    return KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM) || {};
  }

  function upcomingSeasonYear(context) {
    // 1~3월(개막 전)에 체결하면 올 시즌부터, 그 외에는 다음 시즌부터 적용
    const month = Number(String(context.currentDate || "").slice(5, 7)) || 1;
    return month <= 3 ? context.currentYear : context.currentYear + 1;
  }

  function yearsToFA(player) {
    const req = player.origin === "UNIV" ? 7 : 8;
    return Math.max(0, req - (player.faYears || 0));
  }

  function hasActiveContract(player) {
    return Boolean(player.nonFAContract && player.nonFAContract.active);
  }

  function hasRecentMajorInjury(player) {
    return Boolean((player.injury && player.injury.active && player.injury.major) || player.majorInjuryYear);
  }

  /** 소속 구단 연속 시즌 (프랜차이즈 예외 판정용) */
  function teamTenure(context, player) {
    const since = Number(player.teamSinceYear);
    return Number.isFinite(since) ? Math.max(0, context.currentYear - since) : 0;
  }

  function isEligible(context, team, player) {
    if (!player || (player.nationality && player.nationality !== "KOR")) return { ok: false, reason: "국내 선수만 대상입니다." };
    if (hasActiveContract(player)) return { ok: false, reason: "이미 비FA 다년계약 중입니다." };
    if ((player.contractYears || 1) > 1) return { ok: false, reason: "다른 다년계약이 남아 있습니다." };
    if ((Number(player.kboSeasons) || 0) < 3) return { ok: false, reason: "KBO 3시즌 이상 선수만 대상입니다." };
    if (player.age < 21 || player.age > 35) return { ok: false, reason: "만 21~35세 선수만 대상입니다." };
    return { ok: true };
  }

  function desiredYears(player) {
    const a = player.age || 28;
    if (a <= 26) return 8;
    if (a <= 29) return 6;
    if (a <= 32) return 4;
    return 2;
  }

  /** 선수(에이전트) 요구 조건 산정 */
  function computeDemand(context, team, player) {
    const off = gm().Offseason;
    const prof = off && typeof off.evaluateFAPlayerMarketProfile === "function" ? off.evaluateFAPlayerMarketProfile(player, context) : null;
    const marketAAV = prof ? prof.demandTotal / Math.max(1, prof.demandYears || 1) : Math.max(20000, (player.salary || 10000) * 1.4);
    const ytf = yearsToFA(player);
    const leverage = ytf <= 1 ? 1.0 : ytf === 2 ? 0.9 : 0.8;
    const ovr = player.getTrueOvr();
    const power = (player.st && player.st.power) || 0;
    let posPremium = 1.0;
    let posNote = null;
    if (player.pos === "C") {
      posPremium = 1.15;
      posNote = "포수 희소성 +15%";
    } else if (player.pos === "3B" && power >= 80) {
      posPremium = 1.15;
      posNote = "거포 3루수 +15%";
    } else if (player.pos === "SP" && ovr >= 82) {
      posPremium = 1.18;
      posNote = "토종 에이스 선발 +18%";
    }
    const injured = hasRecentMajorInjury(player);
    const injuryMul = injured ? 0.9 : 1.0;
    const room = team.getAvailableBudget();
    const capMul = room > marketAAV * 2 ? 1.05 : 1.0;
    const traitMul = context.gmProfile && context.gmProfile.trait === "NEGOTIATOR" ? 0.95 : 1.0;
    const aav = round100(Math.max(5000, marketAAV * leverage * posPremium * injuryMul * capMul * traitMul));
    const notes = [];
    notes.push(ytf <= 1 ? "FA 직전 — 협상력 최대" : `FA까지 ${ytf}년 — 미래 리스크 회피로 ${Math.round((1 - leverage) * 100)}% 할인`);
    if (posNote) notes.push(posNote);
    if (injured) notes.push("최근 큰 부상 — 요구액 -10%, 옵션 비중 수용");
    if (capMul > 1) notes.push("구단 여유 예산을 보고 +5%");
    if (traitMul < 1) notes.push("협상의 달인 -5%");
    return {
      playerId: player.id,
      aav,
      desiredYears: desiredYears(player),
      maxOptionRatio: injured ? 0.4 : 0.15,
      yearsToFA: ytf,
      marketAAV: round100(marketAAV),
      postingClauseValued: player.age <= 29 && ovr >= 85,
      notes
    };
  }

  /** 제시 조건 평가 → 수락 여부와 필요한 연평균 */
  function evaluateOffer(context, team, player, offer = {}) {
    const demand = computeDemand(context, team, player);
    const years = clamp(Math.round(Number(offer.years) || demand.desiredYears), MIN_YEARS, MAX_YEARS);
    const aav = round100(Math.max(0, Number(offer.aav) || demand.aav));
    const optionRatio = clamp(Number(offer.optionRatio) || 0, 0, 0.5);
    const postingClause = Boolean(offer.postingClause);

    // 기간이 원하는 기간보다 길면 연평균을 깎아 줄 수 있고(최대 15%), 짧으면 더 요구한다
    let required = demand.aav;
    if (years > demand.desiredYears) required *= 1 - Math.min(0.15, 0.03 * (years - demand.desiredYears));
    else if (years < demand.desiredYears) required *= 1 + 0.04 * (demand.desiredYears - years);
    if (postingClause && demand.postingClauseValued) required *= 0.92;
    if (optionRatio > demand.maxOptionRatio) required *= 1 + (optionRatio - demand.maxOptionRatio);
    required = round100(required);

    // 옵션은 절반 가치로 인식 (달성 불확실)
    const effectiveAAV = round100(aav * (1 - optionRatio) + aav * optionRatio * 0.5);
    const accept = effectiveAAV >= required;
    return {
      accept,
      years,
      aav,
      optionRatio,
      postingClause,
      structure: STRUCTURES[offer.structure] ? offer.structure : "EVEN",
      requiredAAV: required,
      effectiveAAV,
      demand,
      message: accept
        ? `${player.name} 측이 ${years}년 연평균 ${eok(aav)} 조건을 수락할 의사를 밝혔습니다.`
        : `${player.name} 측: "${years}년이면 보장 기준 연평균 ${eok(required)}은 받아야 합니다." (현재 제시 실질 ${eok(effectiveAAV)})`
    };
  }

  /** 연도별 연봉표 (보장 연봉 + 옵션) */
  function buildSchedule(startYear, years, aav, optionRatio, structure) {
    const guaranteedTotal = aav * years * (1 - optionRatio);
    const optionPerYear = round100(aav * optionRatio);
    const weights = Array.from({ length: years }, (_, i) => {
      if (structure === "FRONT") return 1.3 - (0.6 * i) / Math.max(1, years - 1);
      if (structure === "BACK") return 0.7 + (0.6 * i) / Math.max(1, years - 1);
      return 1;
    });
    const wSum = weights.reduce((a, b) => a + b, 0);
    return weights.map((w, i) => ({
      year: startYear + i,
      salary: round100((guaranteedTotal * w) / wSum),
      option: optionPerYear
    }));
  }

  function previewSchedule(context, offer) {
    const years = clamp(Math.round(Number(offer.years) || 4), MIN_YEARS, MAX_YEARS);
    return buildSchedule(upcomingSeasonYear(context), years, round100(Number(offer.aav) || 0), clamp(Number(offer.optionRatio) || 0, 0, 0.5), offer.structure || "EVEN");
  }

  /** 계약 체결 (수락 조건이 아니면 거절) */
  function signContract(context, teamId, playerId, offer = {}, options = {}) {
    const g = gm();
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };
    const player = team.getAllPlayers().find((p) => p.id === playerId);
    if (!player) return { ok: false, reason: "선수를 찾을 수 없습니다." };
    const elig = isEligible(context, team, player);
    if (!elig.ok) return { ok: false, reason: elig.reason };

    const ev = evaluateOffer(context, team, player, offer);
    if (!ev.accept) return { ok: false, accepted: false, reason: ev.message, evaluation: ev };

    const startYear = upcomingSeasonYear(context);
    const schedule = buildSchedule(startYear, ev.years, ev.aav, ev.optionRatio, ev.structure);
    // 계약이 올 시즌부터면 첫해 연봉이 바로 반영되므로 인상분이 여유 예산 안에 들어와야 한다
    if (startYear === context.currentYear) {
      const raise = Math.max(0, schedule[0].salary - (player.salary || 0));
      if (team.getAvailableBudget() < raise) {
        return { ok: false, reason: `여유 예산(${eok(team.getAvailableBudget())})이 첫해 연봉 인상분(${eok(raise)})보다 부족합니다.` };
      }
      player.salary = schedule[0].salary;
    }

    player.nonFAContract = {
      active: true,
      signedDate: context.currentDate,
      signedAge: player.age,
      startYear,
      years: ev.years,
      aav: ev.aav,
      optionRatio: ev.optionRatio,
      structure: ev.structure,
      postingClause: ev.postingClause,
      schedule,
      totalGuaranteed: schedule.reduce((s, x) => s + x.salary, 0),
      totalOptions: schedule.reduce((s, x) => s + x.option, 0),
      rehabGamble: Boolean(player.injury && player.injury.active && player.injury.major),
      optionsPaid: 0
    };
    // 남은 계약 연수 (12월 1일 연봉 재계약 때마다 1씩 줄고, 2 → 1이 되는 해에 FA 공시)
    // 계약 마지막 시즌이 끝난 12월에 FA가 되도록: 다음 시즌 시작 계약은 기간+2, 올 시즌 시작은 기간+1
    player.contractYears = ev.years + (startYear > context.currentYear ? 2 : 1);
    player.isMultiYearExtended = true;

    const record = {
      year: context.currentYear,
      teamId: team.id,
      teamName: team.name,
      playerId: player.id,
      playerName: player.name,
      pos: player.pos,
      age: player.age,
      years: ev.years,
      annualSalary: ev.aav,
      signingBonus: 0,
      totalAmount: player.nonFAContract.totalGuaranteed + player.nonFAContract.totalOptions,
      totalGuaranteed: player.nonFAContract.totalGuaranteed,
      structure: ev.structure,
      postingClause: ev.postingClause,
      byAI: Boolean(options.byAI)
    };
    if (!Array.isArray(team.nonFAExtensions)) team.nonFAExtensions = [];
    team.nonFAExtensions.push(record);
    if (team.id === context.userTeamId) team.fanRatio = clamp((team.fanRatio || 55) + 4, 0, 100);

    const audit = g.Extensions && typeof g.Extensions.ensureAuditMetrics === "function" ? g.Extensions.ensureAuditMetrics(context) : null;
    if (audit) audit.nonFAMultiYearSignedCount = (audit.nonFAMultiYearSignedCount || 0) + 1;

    return {
      ok: true,
      accepted: true,
      contractRecord: record,
      summary: `[비FA 다년계약 체결] ${team.name} ${player.name}(${player.pos}, ${player.age}세) ${ev.years}년 총액 ${eok(record.totalAmount)} (보장 ${eok(record.totalGuaranteed)} · 옵션 ${eok(player.nonFAContract.totalOptions)} · ${STRUCTURES[ev.structure].label}${ev.postingClause ? " · 포스팅 허용" : ""}) — ${startYear}~${startYear + ev.years - 1}시즌`
    };
  }

  /** 대상자 목록 + 요구 조건 */
  function getCandidates(context, teamId) {
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return [];
    return team
      .getAllPlayers()
      .filter((p) => isEligible(context, team, p).ok)
      .sort((a, b) => b.getTrueOvr() - a.getTrueOvr())
      .slice(0, 12)
      .map((p) => {
        const d = computeDemand(context, team, p);
        return {
          playerId: p.id,
          name: p.name,
          pos: p.pos,
          age: p.age,
          trueOvr: p.getTrueOvr(),
          war: p.getWar(),
          currentSalary: p.salary,
          yearsToFA: d.yearsToFA,
          kboSeasons: Number(p.kboSeasons) || 0,
          demandAAV: d.aav,
          desiredYears: d.desiredYears,
          maxOptionRatio: d.maxOptionRatio,
          postingClauseValued: d.postingClauseValued,
          notes: d.notes,
          // 하위 호환 (기존 UI·감사 모듈)
          recommendedYears: d.desiredYears,
          recommendedAnnual: d.aav,
          recommendedBonus: 0,
          recommendedTotal: d.aav * d.desiredYears
        };
      });
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 시즌 전환 처리 (finalizeOffseasonAndStartSeason 에서 선수별 호출, 나이 +1 전)
   * - 지난 시즌 옵션 정산 (WAR 2.0 이상이면 지급)
   * - 새 시즌 연봉표 반영, 계약 종료 처리
   * - 리스크 이벤트 (에이징 커브 파동 / 재활 도박 결과)
   * ═══════════════════════════════════════════════════════════════════════ */
  function processSeasonTransition(context, team, player, completedYear, rng = Math.random) {
    const c = player.nonFAContract;
    if (!c || !c.active) return null;
    const events = [];

    const done = c.schedule.find((x) => x.year === completedYear);
    if (done && done.option > 0) {
      const war = typeof player.getWar === "function" ? player.getWar() : 0;
      if (war >= OPTION_WAR_THRESHOLD && team) {
        team.budget = clamp((team.budget || 0) - done.option, -3000000, 4000000);
        c.optionsPaid += done.option;
        events.push(`옵션 달성(WAR ${war.toFixed(1)}) ${eok(done.option)} 지급`);
      }
    }

    if (c.rehabGamble && completedYear >= c.startYear - 1) {
      c.rehabGamble = false;
      const keys = player.type === "pitcher" ? ["stuff", "velo", "control"] : ["contact", "power", "eye"];
      if (rng() < 0.5) {
        keys.slice(0, 2).forEach((k) => {
          player.st[k] = clamp((player.st[k] || 50) + 2, 20, 110);
        });
        events.push("재활 대성공 — 기량 완전 회복");
      } else {
        player.injury = { active: true, name: "부상 재발", part: "재발", label: "부상 재발", weeksLeft: 12, daysLeft: 84, major: true };
        player.majorInjuryYear = completedYear + 1;
        events.push("부상 재발 — 시즌 초반 12주 이탈");
      }
    }

    const nextYear = completedYear + 1;
    const next = c.schedule.find((x) => x.year === nextYear);
    if (next) {
      player.salary = next.salary;
      if (player.age + 1 >= 32 && c.years >= 5 && rng() < 0.15) {
        const keys = player.type === "pitcher" ? ["velo", "stuff"] : ["power", "contact"];
        keys.forEach((k) => {
          player.st[k] = clamp((player.st[k] || 50) - (3 + Math.floor(rng() * 3)), 20, 110);
        });
        events.push("에이징 커브 파동 — 주요 능력치 급락");
      }
    } else if (nextYear > c.startYear + c.years - 1) {
      c.active = false;
      events.push("비FA 다년계약 종료");
    }

    if (events.length && team) {
      if (!Array.isArray(context.nonFAEventLog)) context.nonFAEventLog = [];
      context.nonFAEventLog.unshift({ year: completedYear, teamId: team.id, playerId: player.id, playerName: player.name, events });
      if (context.nonFAEventLog.length > 60) context.nonFAEventLog.length = 60;
    }
    return events;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 프랜차이즈 예외 (KBO판 버드 룰)
   * ═══════════════════════════════════════════════════════════════════════ */
  function getFranchiseEligible(context, teamId) {
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return [];
    return team
      .getAllPlayers()
      .filter((p) => (!p.nationality || p.nationality === "KOR") && teamTenure(context, p) >= FRANCHISE_MIN_SEASONS)
      .sort((a, b) => (b.salary || 0) - (a.salary || 0))
      .map((p) => ({ playerId: p.id, name: p.name, pos: p.pos, salary: p.salary, tenure: teamTenure(context, p) }));
  }

  function setFranchisePlayer(context, teamId, playerId) {
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };
    if (!playerId) {
      team.franchisePlayerId = null;
      return { ok: true, summary: "프랜차이즈 예외 지정을 해제했습니다." };
    }
    const cand = getFranchiseEligible(context, team.id).find((c) => c.playerId === playerId);
    if (!cand) return { ok: false, reason: `한 구단에서 ${FRANCHISE_MIN_SEASONS}시즌 이상 뛴 국내 선수만 지정할 수 있습니다.` };
    team.franchisePlayerId = playerId;
    return { ok: true, summary: `${cand.name}을(를) 프랜차이즈 선수로 지정했습니다. 경쟁균형세 산정 시 연봉 50%가 제외됩니다.` };
  }

  /** 경쟁균형세 산정용 연봉 (프랜차이즈 예외 반영) */
  function capSalaryOf(context, team, player) {
    const sal = player.salary || 0;
    if (team && team.franchisePlayerId === player.id && teamTenure(context, player) >= FRANCHISE_MIN_SEASONS) return Math.round(sal * 0.5);
    return sal;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * AI 구단 비FA 다년계약 (12월 1일 FA 공시 직전): FA 1년 전 핵심 선수 선점 → FA 매물 감소
   * ═══════════════════════════════════════════════════════════════════════ */
  function runAIExtensions(context, rng = Math.random) {
    const signed = [];
    (context.kboTeams || []).forEach((team) => {
      if (team.id === context.userTeamId) return;
      const targets = team
        .getAllPlayers()
        .filter((p) => isEligible(context, team, p).ok && yearsToFA(p) <= 1 && p.getTrueOvr() >= 76)
        .sort((a, b) => b.getTrueOvr() - a.getTrueOvr())
        .slice(0, 1);
      targets.forEach((p) => {
        const d = computeDemand(context, team, p);
        if (team.getAvailableBudget() < d.aav - (p.salary || 0)) return;
        if (rng() >= 0.4) return;
        const res = signContract(context, team.id, p.id, { years: d.desiredYears, aav: d.aav, optionRatio: 0, structure: "EVEN" }, { byAI: true });
        if (res.ok) signed.push(res.summary);
      });
    });
    return signed;
  }

  return {
    MIN_YEARS,
    MAX_YEARS,
    STRUCTURES,
    OPTION_WAR_THRESHOLD,
    FRANCHISE_MIN_SEASONS,
    yearsToFA,
    hasActiveContract,
    teamTenure,
    isEligible,
    computeDemand,
    evaluateOffer,
    previewSchedule,
    signContract,
    getCandidates,
    processSeasonTransition,
    getFranchiseEligible,
    setFranchisePlayer,
    capSalaryOf,
    runAIExtensions
  };
});
