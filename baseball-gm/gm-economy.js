/**
 * KBO 단장 모드 (v1.0) — 구단 재정 & 난이도 모듈 (KBO_GM.Economy)
 * 의존 모듈:
 *   - Step 1-1: gm-schema.js (Team.getAvailableBudget, GMGameContext)
 * 재정 모델 (단위: 만원, 10,000 = 1억원):
 *   - team.budget 은 '금년 운영 예산 봉투'이며, 연봉총액(payroll)이 이 봉투를 차지한다.
 *     여유 예산 = budget - payroll. 모든 재량 지출(FA 계약금·시설·현금 트레이드 등)은 여유 예산 안에서만 가능.
 *   - 새 시즌 예산 = 모기업 지원금(리그 평균 연봉 × 직전 순위 '역순' 배율) + 이월금(전 시즌 장부 마감 시점의 여유 예산, 상·하한 적용)
 *     - 스토브리그(장부 마감 이후)에 지출한 계약금·양도금 등 현금성 지출은 이월금에서 차감한다.
 *   - 정규시즌 매주: 자체 수입(입장·중계·상품) - 운영비(2군·육성군·프런트) 정산
 *   - 여유 예산이 마이너스(적자)인 상태로 주간 정산을 맞으면 유저 구단은 구단주 신임도가 깎인다.
 *   - 난이도(쉬움/보통/어려움)는 유저 구단에만 적용된다. AI 9개 구단은 항상 '보통' 규칙을 따른다.
 * 실행 환경: Client-Side Standalone (window.KBO_GM.Economy) & Node/CommonJS 호환
 */

(function (root, factory) {
  const economyModule = factory(root.KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM));
  if (typeof globalThis !== "undefined") {
    globalThis.KBO_GM = Object.assign(globalThis.KBO_GM || {}, { Economy: economyModule });
  }
  if (typeof window !== "undefined") {
    window.KBO_GM = Object.assign(window.KBO_GM || {}, { Economy: economyModule });
  }
  if (typeof module === "object" && module.exports) {
    module.exports = economyModule;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function (KBO_GM) {
  "use strict";

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round100 = (v) => Math.round(v / 100) * 100;

  /* ═══════════════════════════════════════════════════════════════════════
   * 1. 난이도 프리셋
   *    - subsidyAdj      : 모기업 지원금 가감 (만원)
   *    - initialBudgetAdj: 2025 부임 시 초기 예산 가감 (만원)
   *    - revenueMul      : 정규시즌 주간 자체 수입 배율
   *    - ownerProbAdj    : 구단주 증액 요청 승인 확률 가감 (%p)
   *    - deficitTrustPenalty: 적자 상태 주간 정산 시 구단주 신임도 감소폭
   *    - carryCap        : 흑자 이월 상한 (만원)
   * ═══════════════════════════════════════════════════════════════════════ */
  const DIFFICULTY_PRESETS = {
    EASY: {
      key: "EASY",
      label: "쉬움",
      desc: "모기업 지원 넉넉 · 적자에 관대 · 증액 요청 잘 통과",
      subsidyAdj: 150000,
      initialBudgetAdj: 100000,
      revenueMul: 1.25,
      ownerProbAdj: 15,
      deficitTrustPenalty: 0,
      carryCap: 400000
    },
    NORMAL: {
      key: "NORMAL",
      label: "보통",
      desc: "상위권 유지에 구단주 추가 지원이 필요한 수준",
      subsidyAdj: 0,
      initialBudgetAdj: 0,
      revenueMul: 1.0,
      ownerProbAdj: 0,
      deficitTrustPenalty: 1,
      carryCap: 200000
    },
    HARD: {
      key: "HARD",
      label: "어려움",
      desc: "지원금 삭감 · 수입 감소 · 적자 시 신임도 급락",
      subsidyAdj: -100000,
      initialBudgetAdj: -80000,
      revenueMul: 0.8,
      ownerProbAdj: -12,
      deficitTrustPenalty: 2,
      carryCap: 100000
    }
  };

  // 모기업 지원금 = 리그 평균 연봉총액 × 순위별 배율 (직전 정규시즌 역순 지급)
  //   1위 ×1.20 → 10위 ×1.65 (순위당 +0.05). 리그 연봉 수준이 오르면 지원금도 함께 오른다.
  const SUBSIDY_MULT_TOP = 1.2;
  const SUBSIDY_MULT_STEP = 0.05;
  const SUBSIDY_FLOOR = 600000; // 리그 평균 산출이 불가할 때의 하한 (60억)
  // 적자 이월 하한: -30억 (그 이상의 결손은 모기업이 보전)
  const MAX_DEFICIT_CARRY = -300000;
  // 주간 정산 (정규시즌): 수입 = 2,600 + 팬심×22 + 주간 승수×150, 운영비 = 3,300 (만원)
  const WEEKLY_REVENUE_BASE = 2600;
  const WEEKLY_REVENUE_PER_FAN = 22;
  const WEEKLY_REVENUE_PER_WIN = 150;
  const WEEKLY_OPERATING_COST = 3300;
  // 예산 수치 안전 범위 (적자 허용)
  const BUDGET_MIN = -3000000;
  const BUDGET_MAX = 4000000;

  function getDifficulty(context) {
    const key = (context && context.difficulty) || "NORMAL";
    return DIFFICULTY_PRESETS[key] || DIFFICULTY_PRESETS.NORMAL;
  }

  function presetForTeam(context, team) {
    if (context && team && team.id === context.userTeamId) return getDifficulty(context);
    return DIFFICULTY_PRESETS.NORMAL;
  }

  function availableBudget(team) {
    if (!team) return 0;
    return typeof team.getAvailableBudget === "function"
      ? team.getAvailableBudget()
      : (team.budget || 0) - (typeof team.getTotalPayroll === "function" ? team.getTotalPayroll() : 0);
  }

  /** 여유 예산(연봉총액 제외) 안에서 cost 만큼 지출 가능한지 */
  function canAfford(team, cost) {
    return availableBudget(team) - (Number(cost) || 0) >= 0;
  }

  function ensureFinance(team, year) {
    if (!team) return null;
    if (!team.finance || typeof team.finance !== "object" || team.finance.year !== year) {
      team.finance = {
        year,
        subsidy: 0,
        subsidyRank: null,
        carryover: 0,
        seasonRevenue: 0,
        seasonOperatingCost: 0,
        deficitWeeks: 0,
        booksClosed: false,
        closingAvailable: null,
        closingBudget: null
      };
    }
    return team.finance;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 2. 난이도 초기화 (새 단장 부임 시 1회)
   * ═══════════════════════════════════════════════════════════════════════ */
  function initDifficulty(context, difficultyKey) {
    if (!context) return null;
    const key = DIFFICULTY_PRESETS[difficultyKey] ? difficultyKey : "NORMAL";
    context.difficulty = key;
    const preset = DIFFICULTY_PRESETS[key];
    const userTeam = typeof context.getUserTeam === "function" ? context.getUserTeam() : null;
    if (userTeam && !context._difficultyBudgetApplied) {
      userTeam.budget = clamp(round100((userTeam.budget || 1200000) + preset.initialBudgetAdj), BUDGET_MIN, BUDGET_MAX);
      context._difficultyBudgetApplied = true;
    }
    // 부임 첫해(2025)는 2024 순위 역순 초기 배정 예산이 곧 모기업 지원금이다.
    (context.kboTeams || []).forEach((team) => {
      const fin = ensureFinance(team, context.currentYear || 2025);
      if (!fin.subsidy) {
        fin.subsidy = team.budget;
        fin.subsidyRank = team.rank2024 || null;
      }
    });
    return preset;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 3. 모기업 지원금 (직전 정규시즌 순위 역순)
   * ═══════════════════════════════════════════════════════════════════════ */
  function getLeagueAveragePayroll(context) {
    const teams = (context && context.kboTeams) || [];
    if (!teams.length) return SUBSIDY_FLOOR;
    const total = teams.reduce((s, t) => s + (typeof t.getTotalPayroll === "function" ? t.getTotalPayroll() : 0), 0);
    return Math.max(SUBSIDY_FLOOR / SUBSIDY_MULT_TOP, total / teams.length);
  }

  function computeSeasonSubsidy(context, team, prevRank) {
    const rank = clamp(Number(prevRank) || 5, 1, 10);
    const preset = presetForTeam(context, team);
    const mult = SUBSIDY_MULT_TOP + (rank - 1) * SUBSIDY_MULT_STEP;
    return round100(getLeagueAveragePayroll(context) * mult + preset.subsidyAdj);
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 4. 정규시즌 주간 재정 정산 (simulateKBOWeek 에서 구단별 호출)
   * ═══════════════════════════════════════════════════════════════════════ */
  function settleWeeklyFinance(context, team, weeklyDelta) {
    if (!context || !team) return null;
    const year = context.currentYear || 2025;
    const fin = ensureFinance(team, year);
    const preset = presetForTeam(context, team);
    const wins = (weeklyDelta && weeklyDelta.w) || 0;

    const revenue = Math.round(
      (WEEKLY_REVENUE_BASE + (team.fanRatio || 55) * WEEKLY_REVENUE_PER_FAN + wins * WEEKLY_REVENUE_PER_WIN) *
        preset.revenueMul
    );
    const cost = WEEKLY_OPERATING_COST;
    const net = revenue - cost;
    team.budget = clamp(Math.round((team.budget || 0) + net), BUDGET_MIN, BUDGET_MAX);
    fin.seasonRevenue += revenue;
    fin.seasonOperatingCost += cost;

    let trustPenalty = 0;
    if (availableBudget(team) < 0) {
      fin.deficitWeeks += 1;
      if (team.id === context.userTeamId && preset.deficitTrustPenalty > 0) {
        trustPenalty = preset.deficitTrustPenalty;
        team.ownerTrust = clamp((team.ownerTrust ?? 60) - trustPenalty, 0, 100);
      }
    }

    const audit = context._auditMetrics;
    if (audit) {
      audit.economyWeeklySettledCount = (audit.economyWeeklySettledCount || 0) + 1;
      if (trustPenalty > 0) audit.economyDeficitPenaltyCount = (audit.economyDeficitPenaltyCount || 0) + 1;
    }
    return { revenue, cost, net, trustPenalty };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 5. 시즌 장부 마감 (포스트시즌 종료 후 11월 초, 스토브리그 개장 전)
   *    - 이 시점의 여유 예산이 차기 시즌 이월금의 기준이 된다.
   * ═══════════════════════════════════════════════════════════════════════ */
  function closeSeasonBooks(context) {
    if (!context || !Array.isArray(context.kboTeams)) return null;
    const year = context.currentYear || 2025;
    const closed = [];
    context.kboTeams.forEach((team) => {
      const fin = ensureFinance(team, year);
      if (fin.booksClosed) return;
      fin.booksClosed = true;
      fin.closingAvailable = availableBudget(team);
      fin.closingBudget = team.budget;
      closed.push({ teamId: team.id, closingAvailable: fin.closingAvailable });
    });
    return { year, closed };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 6. 새 시즌 예산 책정 (setupOwnerExpectations 에서 구단별 호출)
   *    새 예산 = 모기업 지원금(역순) + 이월금
   *    이월금 = clamp(장부 마감 시 여유 예산, -30억, 난이도별 상한) - 마감 이후 현금성 지출
   * ═══════════════════════════════════════════════════════════════════════ */
  function computeNewSeasonBudget(context, team, prevRank) {
    const preset = presetForTeam(context, team);
    const prevYear = (context.currentYear || 2026) - 1;
    const prevFin = team.finance && team.finance.year === prevYear ? team.finance : null;

    let baseCarry;
    let stoveCashSpend = 0;
    if (prevFin && prevFin.booksClosed) {
      baseCarry = prevFin.closingAvailable;
      stoveCashSpend = (prevFin.closingBudget || 0) - (team.budget || 0);
    } else {
      baseCarry = availableBudget(team);
    }
    const carryover = round100(clamp(baseCarry, MAX_DEFICIT_CARRY, preset.carryCap) - stoveCashSpend);
    const subsidy = computeSeasonSubsidy(context, team, prevRank);
    const budget = clamp(round100(subsidy + carryover), BUDGET_MIN, BUDGET_MAX);

    const fin = ensureFinance(team, context.currentYear || prevYear + 1);
    fin.subsidy = subsidy;
    fin.subsidyRank = prevRank;
    fin.carryover = carryover;

    const audit = context._auditMetrics;
    if (audit) audit.economySubsidyIssuedCount = (audit.economySubsidyIssuedCount || 0) + 1;
    return { budget, subsidy, carryover, prevRank };
  }

  /** UI 표시용 재정 요약 */
  function getFinanceSummary(context, team) {
    const year = (context && context.currentYear) || 2025;
    const fin = ensureFinance(team, year);
    const preset = presetForTeam(context, team);
    return {
      year,
      difficulty: preset,
      budget: team.budget,
      payroll: typeof team.getTotalPayroll === "function" ? team.getTotalPayroll() : 0,
      available: availableBudget(team),
      subsidy: fin.subsidy,
      subsidyRank: fin.subsidyRank,
      carryover: fin.carryover,
      seasonRevenue: fin.seasonRevenue,
      seasonOperatingCost: fin.seasonOperatingCost,
      deficitWeeks: fin.deficitWeeks,
      subsidyTable: Array.from({ length: 10 }, (_, i) => ({
        rank: i + 1,
        subsidy: computeSeasonSubsidy(context, team, i + 1)
      }))
    };
  }

  return {
    DIFFICULTY_PRESETS,
    SUBSIDY_MULT_TOP,
    SUBSIDY_MULT_STEP,
    getLeagueAveragePayroll,
    MAX_DEFICIT_CARRY,
    BUDGET_MIN,
    BUDGET_MAX,
    getDifficulty,
    presetForTeam,
    availableBudget,
    canAfford,
    ensureFinance,
    initDifficulty,
    computeSeasonSubsidy,
    settleWeeklyFinance,
    closeSeasonBooks,
    computeNewSeasonBudget,
    getFinanceSummary
  };
});
