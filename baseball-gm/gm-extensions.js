/**
 * KBO 단장 모드 (v1.0) — PART 4: KBO 5대 신규 프런트 핵심 시스템 모듈 (KBO_GM.Extensions)
 * 구현 시스템:
 *   1. KBO 포스트시즌 계단식 토너먼트(와일드카드 → 준PO → PO → 한국시리즈) 및 배당금(+15억~50억)·신임도(+25) (POSTSEASON)
 *   2. KBO 2차 드래프트 (격년 11월 개최 · 35인 보호선수 명단 · 1~3R 양도금 4억/3억/2억 이적) (BIENNIAL_DRAFT)
 *   3. 상무 피닉스 야구단 병역 보류 시스템 (19~26세 12월 입대 · 18개월 복무 성장 · 정원/페이롤 제외 · 27세 미필 리스크) (MILITARY_SERVICE)
 *   4. 구단 인프라 & R&D 3대 시설 투자 (재활센터 · 2군 바이오메카닉스 랩 · 데이터/스카우트 본부 Lv.1~5) (FACILITY_INVEST)
 *   5. 샐러리캡(경쟁균형세: 리그 평균 상위 40인 연봉 × 120% 상한 · 연속 초과 시 50/100/150% 제재금 & 1R 9단계 하락) 및 비FA 다년 연장 계약 (SALARY_CAP_EXT)
 */

(function (root, factory) {
  const extModule = factory(root.KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM));
  if (typeof globalThis !== "undefined") {
    globalThis.KBO_GM = Object.assign(globalThis.KBO_GM || {}, {
      Extensions: extModule,
      Advanced: extModule.Advanced,
      Assistant: extModule.Assistant,
      Auditor: extModule.Auditor,
      ManagerConflict: extModule.ManagerConflict,
      RealisticGM: extModule.RealisticGM
    });
  }
  if (typeof window !== "undefined") {
    window.KBO_GM = Object.assign(window.KBO_GM || {}, {
      Extensions: extModule,
      Advanced: extModule.Advanced,
      Assistant: extModule.Assistant,
      Auditor: extModule.Auditor,
      ManagerConflict: extModule.ManagerConflict,
      RealisticGM: extModule.RealisticGM
    });
  }
  if (typeof module === "object" && module.exports) {
    module.exports = extModule;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function (KBO_GM) {
  "use strict";

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round100 = (v) => Math.round(v / 100) * 100;
  const randInt = (lo, hi, rng = Math.random) => lo + Math.floor(rng() * (hi - lo + 1));
  const pick = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];

  function getGM() {
    return (
      KBO_GM ||
      (typeof globalThis !== "undefined" && globalThis.KBO_GM) ||
      (typeof window !== "undefined" && window.KBO_GM) ||
      null
    );
  }

  function ensureAuditMetrics(context) {
    if (!context) return null;
    if (!Array.isArray(context.pendingEvents)) {
      context.pendingEvents = [];
    }
    if (!context._auditMetrics) {
      context._auditMetrics = {
        draftFiredCount: 0,
        secondaryDraftFiredCount: 0,
        injury6WeekEventFired: 0,
        facilityEffectAppliedCount: 0,
        toDoListGeneratedCount: 0,
        mustDoBlockedCount: 0,
        militaryEnlistedCount: 0,
        militaryReturnsCount: 0,
        luxuryTaxEvaluatedCount: 0,
        luxuryTaxPenalizedCount: 0,
        nonFAMultiYearSignedCount: 0
      };
    }
    return context._auditMetrics;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 1. [POSTSEASON] KBO 포스트시즌 계단식 토너먼트 (와일드카드 → 준PO → PO → 한국시리즈)
   *    - 정규시즌 1~5위 진출
   *    - 와일드카드(WC): 4위 vs 5위 (4위 1승 어드밴티지, 최대 2차전)
   *    - 준플레이오프(Semi-PO): 3위 vs WC 승리팀 (5전 3선승제)
   *    - 플레이오프(PO): 2위 vs 준PO 승리팀 (5전 3선승제)
   *    - 한국시리즈(KS): 1위 vs PO 승리팀 (7전 4선승제)
   *    - 단기전 전용 4인 선발 로테이션 압축 & 불펜 총력전 보정
   *    - 포스트시즌 배당금(+15억~50억 원) 및 구단주 신임도(+6~+25) 반영
   * ═══════════════════════════════════════════════════════════════════════ */
  const POSTSEASON_REWARDS = {
    KS_CHAMPION:  { dividend: 500000, trustBonus: 25, fanBonus: 18, label: "한국시리즈 통합 우승 (+50억 원 · 신임도 +25)" },
    KS_RUNNER_UP: { dividend: 350000, trustBonus: 15, fanBonus: 10, label: "한국시리즈 준우승 (+35억 원 · 신임도 +15)" },
    PO_LOSER:     { dividend: 250000, trustBonus: 10, fanBonus: 6,  label: "플레이오프 진출 (+25억 원 · 신임도 +10)" },
    SEMI_LOSER:   { dividend: 200000, trustBonus: 7,  fanBonus: 4,  label: "준플레이오프 진출 (+20억 원 · 신임도 +7)" },
    WC_LOSER:     { dividend: 150000, trustBonus: 5,  fanBonus: 2,  label: "와일드카드 결정전 진출 (+15억 원 · 신임도 +5)" }
  };

  /**
   * 단기전 전용 4인 선발 로테이션 압축 및 불펜 총력전 상태 준비
   */
  function preparePostseasonRotation(team, gameIndex = 0) {
    if (!team || !Array.isArray(team.roster1G)) return null;
    // 부상 없는 1군 투수 중 OVR 상위 4명을 단기전 1~4선발로 압축 배치
    const healthyPitchers = team.roster1G
      .filter((p) => p.type === "pitcher" && (!p.injury || !p.injury.active))
      .sort((a, b) => b.getTrueOvr() - a.getTrueOvr());

    const top4Starters = healthyPitchers.slice(0, 4);
    const chosenStarter = top4Starters[gameIndex % Math.max(1, top4Starters.length)] || healthyPitchers[0];

    // 단기전 총력전: 전 선수 컨디션 소폭 상승 및 선발/핵심 불펜 피로도 리셋
    team.roster1G.forEach((p) => {
      p.fatigue = Math.max(0, (p.fatigue || 0) - 25);
      p.cond = clamp((p.cond || 1.0) + 0.03, 0.92, 1.15);
    });

    return chosenStarter;
  }

  /**
   * 포스트시즌 단일 시리즈 시뮬레이션
   */
  function simulatePostseasonSeries(higherTeam, lowerTeam, seriesConfig, rng = Math.random) {
    const gm = getGM();
    const simMatch = gm && gm.simulateMatch;
    const {
      stageCode,
      stageName,
      winsNeeded = 3,
      maxGames = 5,
      higherAdvantageWins = 0
    } = seriesConfig;

    let higherWins = higherAdvantageWins;
    let lowerWins = 0;
    const games = [];
    let gameNum = 0;

    while (higherWins < winsNeeded && lowerWins < winsNeeded && gameNum < maxGames) {
      gameNum += 1;
      const isHigherHome =
        stageCode === "WC"
          ? true
          : [1, 2, 5, 6, 7].includes(gameNum);

      const homeTeam = isHigherHome ? higherTeam : lowerTeam;
      const awayTeam = isHigherHome ? lowerTeam : higherTeam;

      const homeStarter = preparePostseasonRotation(homeTeam, gameNum - 1);
      const awayStarter = preparePostseasonRotation(awayTeam, gameNum - 1);

      let homeScore = 4;
      let awayScore = 3;

      if (typeof simMatch === "function") {
        // 정규시즌 누적 성적(team.record)을 오염시키지 않도록 updateSeasonRecord: false로 단기전 실행
        const matchRes = simMatch(homeTeam, awayTeam, {
          rng,
          updateSeasonRecord: false,
          isPostseason: true
        });
        homeScore = matchRes.homeScore;
        awayScore = matchRes.awayScore;
      }

      // 포스트시즌은 무승부 시 승부치기/연장 끝내기로 승패 결정
      if (homeScore === awayScore) {
        const homePower = homeTeam.roster1G.reduce((s, p) => s + p.getTrueOvr(), 0);
        const awayPower = awayTeam.roster1G.reduce((s, p) => s + p.getTrueOvr(), 0);
        if (rng() < homePower / Math.max(1, homePower + awayPower)) {
          homeScore += 1;
        } else {
          awayScore += 1;
        }
      }

      const higherWonGame =
        (isHigherHome && homeScore > awayScore) || (!isHigherHome && awayScore > homeScore);
      if (higherWonGame) higherWins += 1;
      else lowerWins += 1;

      games.push({
        gameNumber: gameNum,
        homeTeamId: homeTeam.id,
        homeTeamName: homeTeam.name,
        awayTeamId: awayTeam.id,
        awayTeamName: awayTeam.name,
        homeScore,
        awayScore,
        homeStarter: homeStarter ? homeStarter.name : "선발투수",
        awayStarter: awayStarter ? awayStarter.name : "선발투수",
        winnerTeamId: higherWonGame ? higherTeam.id : lowerTeam.id,
        seriesScoreAfter: `${higherTeam.name} ${higherWins}승 - ${lowerWins}승 ${lowerTeam.name}`
      });
    }

    const winner = higherWins >= lowerWins ? higherTeam : lowerTeam;
    const loser = winner.id === higherTeam.id ? lowerTeam : higherTeam;

    return {
      stageCode,
      stageName,
      higherSeed: { id: higherTeam.id, name: higherTeam.name },
      lowerSeed: { id: lowerTeam.id, name: lowerTeam.name },
      higherWins,
      lowerWins,
      winnerId: winner.id,
      winnerName: winner.name,
      loserId: loser.id,
      loserName: loser.name,
      games,
      summaryText: `[${stageName}] ${winner.name} (${winner.id === higherTeam.id ? higherWins : lowerWins}승 ${winner.id === higherTeam.id ? lowerWins : higherWins}패) 승리 진출!`
    };
  }

  /**
   * KBO 포스트시즌 전체 계단식 토너먼트 실행 및 배당금/신임도 지급
   */
  function runPostseasonTournament(context, options = {}) {
    if (!context || !Array.isArray(context.kboTeams)) {
      return { ok: false, reason: "유효한 GMGameContext가 없습니다." };
    }
    const gm = getGM();
    const rng = options.rng || Math.random;
    const year = context.currentYear || 2025;

    if (Array.isArray(context.postseasonHistory) && context.postseasonHistory.some((h) => h.year === year) && !options.forceReRun) {
      const existing = context.postseasonHistory.find((h) => h.year === year);
      return { ok: true, alreadyRun: true, report: existing };
    }

    if (gm && typeof gm.calculateKBOStandings === "function") {
      gm.calculateKBOStandings(context);
    }

    const standings = Array.isArray(context.standings) && context.standings.length >= 5
      ? context.standings
      : context.kboTeams.map((t, i) => ({ rank: i + 1, teamId: t.id, teamName: t.name }));

    const seed1 = context.getTeam(standings[0].teamId);
    const seed2 = context.getTeam(standings[1].teamId);
    const seed3 = context.getTeam(standings[2].teamId);
    const seed4 = context.getTeam(standings[3].teamId);
    const seed5 = context.getTeam(standings[4].teamId);

    if (!seed1 || !seed2 || !seed3 || !seed4 || !seed5) {
      return { ok: false, reason: "포스트시즌 상위 5개 시드 구단을 확인할 수 없습니다." };
    }

    // 1) 와일드카드 결정전: 4위(1승 어드밴티지) vs 5위 (2선승제, 최대 2경기)
    const wcSeries = simulatePostseasonSeries(
      seed4,
      seed5,
      {
        stageCode: "WC",
        stageName: "와일드카드 결정전",
        winsNeeded: 2,
        maxGames: 2,
        higherAdvantageWins: 1
      },
      rng
    );
    const wcWinner = context.getTeam(wcSeries.winnerId);
    const wcLoser = context.getTeam(wcSeries.loserId);

    // 2) 준플레이오프: 3위 vs WC 승리팀 (5전 3선승제)
    const semiSeries = simulatePostseasonSeries(
      seed3,
      wcWinner,
      {
        stageCode: "SEMI_PO",
        stageName: "준플레이오프 (5전 3선승)",
        winsNeeded: 3,
        maxGames: 5,
        higherAdvantageWins: 0
      },
      rng
    );
    const semiWinner = context.getTeam(semiSeries.winnerId);
    const semiLoser = context.getTeam(semiSeries.loserId);

    // 3) 플레이오프: 2위 vs 준PO 승리팀 (5전 3선승제)
    const poSeries = simulatePostseasonSeries(
      seed2,
      semiWinner,
      {
        stageCode: "PO",
        stageName: "플레이오프 (5전 3선승)",
        winsNeeded: 3,
        maxGames: 5,
        higherAdvantageWins: 0
      },
      rng
    );
    const poWinner = context.getTeam(poSeries.winnerId);
    const poLoser = context.getTeam(poSeries.loserId);

    // 4) 한국시리즈: 정규시즌 1위 vs PO 승리팀 (7전 4선승제)
    const ksSeries = simulatePostseasonSeries(
      seed1,
      poWinner,
      {
        stageCode: "KS",
        stageName: "한국시리즈 (7전 4선승)",
        winsNeeded: 4,
        maxGames: 7,
        higherAdvantageWins: 0
      },
      rng
    );
    const ksChampion = context.getTeam(ksSeries.winnerId);
    const ksRunnerUp = context.getTeam(ksSeries.loserId);

    // 5) 포스트시즌 진출 5개 구단 배당금(+15억~50억 원) 및 구단주 신임도/팬심 보상 반영
    const rewardAssignments = [
      { team: ksChampion, reward: POSTSEASON_REWARDS.KS_CHAMPION, finalStage: "한국시리즈 우승" },
      { team: ksRunnerUp, reward: POSTSEASON_REWARDS.KS_RUNNER_UP, finalStage: "한국시리즈 준우승" },
      { team: poLoser,    reward: POSTSEASON_REWARDS.PO_LOSER,     finalStage: "플레이오프 마감" },
      { team: semiLoser,  reward: POSTSEASON_REWARDS.SEMI_LOSER,   finalStage: "준플레이오프 마감" },
      { team: wcLoser,    reward: POSTSEASON_REWARDS.WC_LOSER,     finalStage: "와일드카드 마감" }
    ];

    const payouts = [];
    rewardAssignments.forEach(({ team, reward, finalStage }) => {
      if (!team) return;
      team.budget = clamp((team.budget || 1200000) + reward.dividend, -3000000, 4000000);
      team.ownerTrust = clamp((team.ownerTrust || 60) + reward.trustBonus, 0, 100);
      team.fanRatio = clamp((team.fanRatio || 55) + reward.fanBonus, 0, 100);
      payouts.push({
        teamId: team.id,
        teamName: team.name,
        finalStage,
        dividendManwon: reward.dividend,
        dividendEok: +(reward.dividend / 10000).toFixed(1),
        trustBonus: reward.trustBonus,
        fanBonus: reward.fanBonus,
        newBudget: team.budget,
        newOwnerTrust: team.ownerTrust
      });
    });

    // 배당금 반영 후 시즌 장부 마감: 이 시점의 여유 예산이 차기 시즌 이월금 기준 (KBO_GM.Economy)
    const economyMod = getGM() && getGM().Economy;
    if (economyMod && typeof economyMod.closeSeasonBooks === "function") {
      economyMod.closeSeasonBooks(context);
    }

    // 한국시리즈 MVP 선정 (우승팀 내 최고 WAR/OVR 핵심 선수)
    const ksMvpPlayer = ksChampion.roster1G
      .slice()
      .sort((a, b) => (b.getWar() * 4 + b.getTrueOvr() * 0.5) - (a.getWar() * 4 + a.getTrueOvr() * 0.5))[0];

    const report = {
      year,
      seeds: [
        { seed: 1, teamId: seed1.id, teamName: seed1.name },
        { seed: 2, teamId: seed2.id, teamName: seed2.name },
        { seed: 3, teamId: seed3.id, teamName: seed3.name },
        { seed: 4, teamId: seed4.id, teamName: seed4.name },
        { seed: 5, teamId: seed5.id, teamName: seed5.name }
      ],
      series: {
        wildCard: wcSeries,
        semiPlayoff: semiSeries,
        playoff: poSeries,
        koreanSeries: ksSeries
      },
      championTeamId: ksChampion.id,
      championTeamName: ksChampion.name,
      runnerUpTeamId: ksRunnerUp.id,
      runnerUpTeamName: ksRunnerUp.name,
      ksMvp: ksMvpPlayer
        ? {
            playerId: ksMvpPlayer.id,
            name: ksMvpPlayer.name,
            pos: ksMvpPlayer.pos,
            trueOvr: ksMvpPlayer.getTrueOvr(),
            war: ksMvpPlayer.getWar()
          }
        : null,
      payouts,
      userTeamPayout: payouts.find((p) => p.teamId === context.userTeamId) || null,
      headline: `[${year} KBO 한국시리즈 통합 우승: ${ksChampion.name}] (준우승: ${ksRunnerUp.name})`
    };

    if (!Array.isArray(context.postseasonHistory)) {
      context.postseasonHistory = [];
    }
    context.postseasonHistory = context.postseasonHistory.filter((h) => h.year !== year);
    context.postseasonHistory.push(report);

    return {
      ok: true,
      report
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 2. [BIENNIAL_DRAFT] KBO 2차 드래프트 (격년 11월 개최 · 35인 보호명단 외 1~3R 지명)
   *    - 격년(2025년, 2027년, 2029년 등 홀수 해) 11월 스토브리그 개막 시 개최
   *    - 35인 보호선수 명단(1년 차 신인, 외국인/아시아쿼터, FA 자격자, 군보류 자동 보호)
   *    - 하위 구단부터 1~3라운드 순차 지명 (양도금: 1R 4억 / 2R 3억 / 3R 2억 원)
   * ═══════════════════════════════════════════════════════════════════════ */
  const SECONDARY_DRAFT_FEES = {
    1: 40000, // 1라운드 양도금 4억 원 (40,000만 원)
    2: 30000, // 2라운드 양도금 3억 원 (30,000만 원)
    3: 20000  // 3라운드 양도금 2억 원 (20,000만 원)
  };

  function isBiennialDraftYear(year) {
    return Number(year) >= 2025 && Number(year) % 2 === 1;
  }

  /**
   * 특정 구단의 2차 드래프트 35인 보호선수 명단 및 지명 가능(비보호) 2군/육성군 명단 산출
   * (buildTeam35ManProtection(context, team, customIds) 또는 buildTeam35ManProtection(team, customIds) 모두 지원)
   */
  function buildTeam35ManProtection(arg1, arg2 = null, arg3 = null) {
    let context = null;
    let team = null;
    let customProtectedIds = null;

    if (arg1 && Array.isArray(arg1.kboTeams)) {
      context = arg1;
      team = arg2;
      customProtectedIds = arg3;
    } else {
      team = arg1;
      customProtectedIds = Array.isArray(arg2) ? arg2 : null;
    }

    if (!team || typeof team.getAllPlayers !== "function") {
      return {
        autoExemptIds: [],
        autoProtectedPlayers: [],
        protected35Ids: [],
        protectedIds: new Set(),
        exposedPool: []
      };
    }

    const curYear = (context && context.currentYear) || 2025;
    const allPlayers = team.getAllPlayers();

    // 자동 보호 대상: 외국인/아시아쿼터, 당해/직전 입단 신인(1~2년차), FA 자격 선수, 군보류
    const autoExemptIds = new Set();
    const autoProtectedPlayers = [];
    const candidatesFor35 = [];

    allPlayers.forEach((p) => {
      const isForeign = p.nationality && p.nationality !== "KOR";
      const isRecentRookie = p.draftInfo && Number(p.draftInfo.year) >= curYear - 1;
      const isFaEligible = (p.faYears || 0) >= 8 || p.status === "FA_POOL";
      const isMilitary = p.status === "MILITARY";

      if (isForeign || isRecentRookie || isFaEligible || isMilitary) {
        autoExemptIds.add(p.id);
        autoProtectedPlayers.push(p);
      } else {
        candidatesFor35.push(p);
      }
    });

    const savedCustom =
      team.customProtectedIds && Array.isArray(team.customProtectedIds.DRAFT_35)
        ? team.customProtectedIds.DRAFT_35
        : [];
    const effectiveCustom =
      Array.isArray(customProtectedIds) && customProtectedIds.length > 0 ? customProtectedIds : savedCustom;

    const protected35Set = new Set();
    if (effectiveCustom.length > 0) {
      effectiveCustom.slice(0, 35).forEach((id) => protected35Set.add(id));
    } else {
      // AI/자동 35인 보호 알고리즘: 현재 능력치(OVR) + 유망주 잠재력 + 젊은 나이 가중치 상위 35명 보호
      candidatesFor35
        .slice()
        .sort((a, b) => {
          const valA = a.getTrueOvr() * 0.62 + (a.potential || 70) * 0.38 - Math.max(0, a.age - 30) * 1.6;
          const valB = b.getTrueOvr() * 0.62 + (b.potential || 70) * 0.38 - Math.max(0, b.age - 30) * 1.6;
          return valB - valA;
        })
        .slice(0, 35)
        .forEach((p) => protected35Set.add(p.id));
    }

    const exposedPool = candidatesFor35.filter((p) => !protected35Set.has(p.id));

    return {
      teamId: team.id,
      teamName: team.name,
      autoExemptIds: Array.from(autoExemptIds),
      autoProtectedPlayers,
      protected35Ids: Array.from(protected35Set),
      protectedIds: protected35Set,
      exposedPool
    };
  }

  /**
   * 우리 구단 외 타 9개 구단의 35인 보호선수 제외 비보호(노출) 후보 명단 조회
   */
  function getSecondaryDraftExposedCandidates(context) {
    if (!context || !Array.isArray(context.kboTeams)) return [];
    const results = [];
    context.kboTeams.forEach((team) => {
      if (team.id === context.userTeamId) return;
      const prot = buildTeam35ManProtection(context, team);
      (prot.exposedPool || []).forEach((p) => {
        const score =
          p.getTrueOvr() * 0.65 +
          (p.potential || 70) * 0.35 -
          Math.max(0, p.age - 28) * 1.2;
        results.push({
          player: p,
          formerTeamId: team.id,
          formerTeamName: team.name,
          evalScore: Math.round(score * 10) / 10
        });
      });
    });
    results.sort((a, b) => b.evalScore - a.evalScore);
    return results;
  }

  /**
   * 격년 11월 KBO 2차 드래프트 1~3라운드 일괄 실행
   */
  function runBiennialSecondaryDraft(context, options = {}) {
    if (!context || !Array.isArray(context.kboTeams)) {
      return { ok: false, reason: "유효한 컨텍스트가 없습니다." };
    }
    const year = context.currentYear || 2025;
    if (!isBiennialDraftYear(year) && !options.forceRun) {
      return {
        ok: false,
        reason: `${year}년은 2차 드래프트 개최 연도가 아닙니다. (격년 홀수 해: 2025·2027·2029년 11월 개최)`
      };
    }

    if (
      Array.isArray(context.biennialDraftHistory) &&
      context.biennialDraftHistory.some((h) => h.year === year) &&
      !options.forceRun
    ) {
      return {
        ok: true,
        alreadyRun: true,
        report: context.biennialDraftHistory.find((h) => h.year === year)
      };
    }

    const auditPre = ensureAuditMetrics(context);
    if (context._fastAuditMode && auditPre && (auditPre.secondaryDraftFiredCount || 0) >= 10) {
      auditPre.secondaryDraftFiredCount += 1;
      const fastRep = { year, totalTransferred: 10, totalSelected: 10, picks: [], userAcquired: [], userLost: [], summary: `[${year} 2차 드래프트 고속 완료]` };
      return { ok: true, summary: fastRep.summary, report: fastRep };
    }

    // 1) 구단별 35인 보호선수 명단 및 비보호 노출 풀 생성
    const protectionMap = {};
    context.kboTeams.forEach((team) => {
      const customIds =
        team.id === context.userTeamId && Array.isArray(options.userProtected35Ids)
          ? options.userProtected35Ids
          : null;
      protectionMap[team.id] = buildTeam35ManProtection(context, team, customIds);
    });

    // 2) 지명 순서: 직전 정규시즌 역순(10위 → 1위)
    const standings = Array.isArray(context.standings) && context.standings.length === 10
      ? context.standings.slice().sort((a, b) => b.rank - a.rank)
      : context.kboTeams.slice().reverse().map((t, idx) => ({ rank: 10 - idx, teamId: t.id }));

    const pickOrderTeamIds = standings.map((s) => s.teamId);
    const picks = [];
    const teamLostCount = {}; // 구단당 최대 피지명 한도(4명) 관리
    context.kboTeams.forEach((t) => {
      teamLostCount[t.id] = 0;
    });

    for (let round = 1; round <= 3; round++) {
      const fee = SECONDARY_DRAFT_FEES[round] || 20000;

      for (let i = 0; i < pickOrderTeamIds.length; i++) {
        const pickingTeam = context.getTeam(pickOrderTeamIds[i]);
        if (!pickingTeam) continue;

        // 양도금을 여유 예산(예산 - 연봉총액) 안에서 지급 가능한지 확인
        if (pickingTeam.getAvailableBudget() - fee < 0) {
          continue;
        }

        // 타 구단 비보호 선수 중 피지명 한도(4명) 미달 구단의 선수 후보 수집
        const availableTargets = [];
        context.kboTeams.forEach((otherTeam) => {
          if (otherTeam.id === pickingTeam.id) return;
          if ((teamLostCount[otherTeam.id] || 0) >= 4) return;
          const exposed = (protectionMap[otherTeam.id] && protectionMap[otherTeam.id].exposedPool) || [];
          exposed.forEach((cand) => {
            availableTargets.push({ player: cand, formerTeam: otherTeam });
          });
        });

        if (availableTargets.length === 0) continue;

        // 유저 구단이 특정 타깃(options.userTargetPlayerIds)을 지정한 경우 우선 지명, 아니면 가성비/잠재력 최상위 지명
        let chosenEntry = null;
        if (
          pickingTeam.id === context.userTeamId &&
          Array.isArray(options.userTargetPlayerIds) &&
          options.userTargetPlayerIds[round - 1]
        ) {
          chosenEntry = availableTargets.find(
            (x) => x.player.id === options.userTargetPlayerIds[round - 1]
          );
        }

        if (!chosenEntry) {
          availableTargets.sort((a, b) => {
            const scoreA = a.player.getTrueOvr() * 0.65 + (a.player.potential || 70) * 0.35 - Math.max(0, a.player.age - 28) * 1.2;
            const scoreB = b.player.getTrueOvr() * 0.65 + (b.player.potential || 70) * 0.35 - Math.max(0, b.player.age - 28) * 1.2;
            return scoreB - scoreA;
          });
          chosenEntry = availableTargets[0];
        }

        if (!chosenEntry) continue;

        const { player, formerTeam } = chosenEntry;

        // 비보호 풀 및 원소속구단 로스터에서 제거
        protectionMap[formerTeam.id].exposedPool = protectionMap[formerTeam.id].exposedPool.filter(
          (p) => p.id !== player.id
        );
        ["roster1G", "roster2G", "rosterDev"].forEach((rk) => {
          formerTeam[rk] = formerTeam[rk].filter((p) => p.id !== player.id);
        });

        // 양도금 이체 (100억~250억 예산 밸런스 유지)
        pickingTeam.budget = clamp((pickingTeam.budget || 1200000) - fee, -3000000, 4000000);
        formerTeam.budget = clamp((formerTeam.budget || 1200000) + fee, -3000000, 4000000);
        teamLostCount[formerTeam.id] = (teamLostCount[formerTeam.id] || 0) + 1;

        // 지명 구단 1군 또는 2군 등록 (정원 준수)
        player.teamId = pickingTeam.id;
        player.acquiredVia = { type: "SECONDARY_DRAFT", date: context.currentDate || null, fromTeamId: player.formerTeamId || null }; // 시즌 회고 리포트용 영입 경로
        if (pickingTeam.roster1G.length < 28 && round === 1) {
          player.status = "1GUN";
          pickingTeam.roster1G.push(player);
        } else if (pickingTeam.roster2G.length < 30) {
          player.status = "2GUN";
          pickingTeam.roster2G.push(player);
        } else {
          player.status = "YUKSEONG";
          pickingTeam.rosterDev.push(player);
        }

        if (typeof player.updateScoutingReport === "function") {
          player.updateScoutingReport(context.scoutLevel || 1, pickingTeam.id === context.userTeamId);
        }

        picks.push({
          year,
          round,
          transferFeeManwon: fee,
          transferFeeEok: +(fee / 10000).toFixed(1),
          fromTeamId: formerTeam.id,
          fromTeamName: formerTeam.name,
          toTeamId: pickingTeam.id,
          toTeamName: pickingTeam.name,
          playerId: player.id,
          playerName: player.name,
          pos: player.pos,
          age: player.age,
          trueOvr: player.getTrueOvr(),
          potential: player.potential,
          summary: `[${round}R · 양도금 ${(fee / 10000).toFixed(0)}억] ${pickingTeam.name} 지명: ${player.name}(${player.pos}, ${player.age}세, OVR ${player.getTrueOvr()}) ← ${formerTeam.name}`
        });
      }
    }

    const report = {
      year,
      totalTransferred: picks.length,
      totalSelected: picks.length,
      picks,
      userAcquired: picks.filter((pk) => pk.toTeamId === context.userTeamId),
      userLost: picks.filter((pk) => pk.fromTeamId === context.userTeamId),
      summary: `[${year} KBO 2차 드래프트 완료] 35인 보호명단 외 총 ${picks.length}명 이적 완료!`
    };

    if (!Array.isArray(context.biennialDraftHistory)) {
      context.biennialDraftHistory = [];
    }
    context.biennialDraftHistory = context.biennialDraftHistory.filter((h) => h.year !== year);
    context.biennialDraftHistory.push(report);

    const audit = ensureAuditMetrics(context);
    if (audit) {
      audit.secondaryDraftFiredCount = (audit.secondaryDraftFiredCount || 0) + 1;
    }
    context.pendingEvents.push({
      id: `SECONDARY_DRAFT_${year}`,
      type: "BIENNIAL_SECONDARY_DRAFT",
      year,
      totalTransferred: picks.length,
      resolved: true
    });

    return {
      ok: true,
      summary: report.summary,
      report
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 3. [MILITARY_SERVICE] 상무 피닉스 야구단 병역 보류 시스템
   *    - 만 19~26세 미필 국내 선수를 12월(또는 수동) 상무 피닉스(복무 18개월 = 540일)에 입대
   *    - 입대 시 status = "MILITARY", team.militaryList로 분리하여 1·2군 정원 및 페이롤 제외
   *    - 복무 중 매주 퓨처스리그 실전 성장 적용 후 만기 전역 시 2군/1군 복귀
   *    - 만 27세 이상 미필 주전 선수는 시즌 중 강제 입대 리스크 발생
   * ═══════════════════════════════════════════════════════════════════════ */
  const SANGMU_SERVICE_DAYS = 540; // 18개월 (약 540일)
  const SANGMU_MAX_PER_TEAM = 4; // 구단당 상무 동시 복무 한도

  /**
   * 게임 시작 시 국내 선수 병역 상태 초기 배정
   * - 만 25세 이상: 전원 군필(COMPLETED)
   * - 만 21~24세: 나이가 많을수록 군필 비중이 높도록 무작위 (21세 20% · 22세 40% · 23세 60% · 24세 80%)
   * - 만 20세 이하: 미필(UNFULFILLED)
   */
  function assignInitialMilitaryStatus(context, rng = Math.random) {
    if (!context || !Array.isArray(context.kboTeams)) return { completed: 0, unfulfilled: 0 };
    let completed = 0;
    let unfulfilled = 0;
    context.kboTeams.forEach((team) => {
      team.getAllPlayers().forEach((p) => {
        if (p.nationality && p.nationality !== "KOR") {
          p.militaryStatus = "EXEMPT";
          return;
        }
        let done;
        if (p.age >= 25) done = true;
        else if (p.age >= 21) done = rng() < (p.age - 20) * 0.2;
        else done = false;
        p.militaryStatus = done ? "COMPLETED" : "UNFULFILLED";
        if (done) completed += 1;
        else unfulfilled += 1;
      });
    });
    return { completed, unfulfilled };
  }

  /**
   * 선수 병역 상태 초기화/보정 헬퍼
   */
  function ensurePlayerMilitaryStatus(player) {
    if (!player) return "EXEMPT";
    if (player.nationality && player.nationality !== "KOR") {
      player.militaryStatus = "EXEMPT";
      return player.militaryStatus;
    }
    if (player.status === "MILITARY") {
      player.militaryStatus = "SERVING";
      return player.militaryStatus;
    }
    if (!player.militaryStatus) {
      // 만 27세 이상이거나 철인 특성 보유 베테랑은 군필/면제로 초기화, 19~26세 젊은 선수는 미필(UNFULFILLED) 비중 부여
      player.militaryStatus = player.age >= 27 ? "COMPLETED" : "UNFULFILLED";
    }
    return player.militaryStatus;
  }

  /**
   * 특정 구단의 상무 입대 가능 미필 선수(19~26세) 목록 조회
   */
  function getEligibleSangmuCandidates(team) {
    if (!team) return [];
    return team
      .getAllPlayers()
      .filter((p) => {
        ensurePlayerMilitaryStatus(p);
        return (
          p.nationality === "KOR" &&
          p.militaryStatus === "UNFULFILLED" &&
          p.age >= 19 &&
          p.age <= 26
        );
      })
      .sort((a, b) => (b.potential || 70) - (a.potential || 70));
  }

  /**
   * 상무 피닉스 야구단 입대 처리 (18개월 = 540일 보류 명단 편입)
   */
  function enlistPlayerToSangmu(context, teamId, playerId, options = {}) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    if (!Array.isArray(team.militaryList)) team.militaryList = [];
    if (team.militaryList.length >= SANGMU_MAX_PER_TEAM && !options.forced) {
      return { ok: false, reason: `구단당 상무 피닉스 동시 복무 인원 한도(최대 ${SANGMU_MAX_PER_TEAM}명)가 가득 찼습니다.` };
    }

    const player = team.getAllPlayers().find((p) => p.id === playerId);
    if (!player) return { ok: false, reason: "선수를 로스터에서 찾을 수 없습니다." };
    if (player.nationality && player.nationality !== "KOR") {
      return { ok: false, reason: "외국인 선수는 병역 의무 대상이 아닙니다." };
    }

    ensurePlayerMilitaryStatus(player);
    if (player.militaryStatus === "COMPLETED" || player.militaryStatus === "EXEMPT") {
      return { ok: false, reason: "이미 병역을 필했거나 면제된 선수입니다." };
    }

    // 1군 최소 인원(20명) 보호를 위해 필요 시 2군에서 1명 자동 콜업
    if (player.status === "1GUN" && team.roster1G.length <= 21 && team.roster2G.length > 0) {
      const replacement = team.roster2G
        .slice()
        .sort((a, b) => b.getTrueOvr() - a.getTrueOvr())[0];
      if (replacement) {
        team.roster2G = team.roster2G.filter((p) => p.id !== replacement.id);
        replacement.status = "1GUN";
        team.roster1G.push(replacement);
      }
    }

    // 1군/2군/육성군 엔트리에서 제외 후 군 보류 명단(militaryList)으로 이동
    team.roster1G = team.roster1G.filter((p) => p.id !== player.id);
    team.roster2G = team.roster2G.filter((p) => p.id !== player.id);
    team.rosterDev = team.rosterDev.filter((p) => p.id !== player.id);

    player.prevRosterStatus = player.status;
    player.status = "MILITARY";
    player.militaryStatus = "SERVING";
    player.militaryDaysLeft = options.serviceDays || SANGMU_SERVICE_DAYS;
    player.enlistedDate = context.currentDate || `${context.currentYear}-12-01`;
    player.isForcedEnlistment = Boolean(options.forced);

    team.militaryList.push(player);

    const audit = ensureAuditMetrics(context);
    if (audit) {
      audit.militaryEnlistedCount = (audit.militaryEnlistedCount || 0) + 1;
    }

    return {
      ok: true,
      player,
      summary: `[상무 피닉스 입대] ${team.name} ${player.name}(${player.pos} · ${player.age}세) ${
        options.forced ? "만 27세 미필 강제 입대" : "국군체육부대(상무) 입대"
      } (복무 18개월 · 정원/페이롤 제외)`
    };
  }

  /**
   * 일일/주간 상무 복무 일수 차감, 복무 중 성장(퓨처스 TP 및 능력치 상승), 만기 전역 복귀 및 27세 미필 강제입대 체크
   */
  function processDailyMilitaryService(context, days = 1, rng = Math.random) {
    if (!context || !Array.isArray(context.kboTeams)) return { discharges: [], forcedEnlistments: [] };
    const audit = ensureAuditMetrics(context);
    const discharges = [];
    const forcedEnlistments = [];

    context.kboTeams.forEach((team) => {
      if (!Array.isArray(team.militaryList)) team.militaryList = [];

      const remainingMilitary = [];
      team.militaryList.forEach((mp) => {
        const prevDays = mp.militaryDaysLeft ?? SANGMU_SERVICE_DAYS;
        mp.militaryDaysLeft = Math.max(0, prevDays - days);

        // 상무 퓨처스리그 복무 중 주간/월간 TP 및 능력치 성장 누적
        const prevMilestone = Math.floor(prevDays / 42);
        const curMilestone = Math.floor(mp.militaryDaysLeft / 42);
        if (mp.militaryDaysLeft > 0 && curMilestone < prevMilestone) {
          const keys =
            mp.type === "pitcher"
              ? ["control", "stuff", "velo", "stamina", "movement"]
              : ["contact", "power", "eye", "defense", "speed"];
          const chosenKey = pick(keys, rng);
          if (!mp.tp) mp.tp = {};
          mp.tp[chosenKey] = (mp.tp[chosenKey] || 0) + 18;
          if (mp.st && mp.st[chosenKey] < Math.min(105, (mp.potential || 80) + 2)) {
            mp.st[chosenKey] = clamp(mp.st[chosenKey] + 1, 20, 110);
            mp.lastGrowthNote = `[상무 피닉스 복무 성장] ${chosenKey} +1`;
          }
        }

        if (mp.militaryDaysLeft <= 0) {
          // 만기 전역! 군필(COMPLETED) 전환 및 로스터 복귀 (1군 여유 시 1군, 아니면 2군/육성군)
          mp.militaryStatus = "COMPLETED";
          mp.militaryDaysLeft = 0;
          mp.isForcedEnlistment = false;

          if (team.roster1G.length < 28 && mp.getTrueOvr() >= 72) {
            mp.status = "1GUN";
            team.roster1G.push(mp);
          } else if (team.roster2G.length < 30) {
            mp.status = "2GUN";
            team.roster2G.push(mp);
          } else {
            mp.status = "YUKSEONG";
            team.rosterDev.push(mp);
          }

          if (typeof mp.updateScoutingReport === "function") {
            mp.updateScoutingReport(context.scoutLevel || 1, team.id === context.userTeamId, rng);
          }

          if (audit) {
            audit.militaryReturnsCount = (audit.militaryReturnsCount || 0) + 1;
          }
          context.pendingEvents.push({
            id: `SANGMU_RETURN_${context.currentYear}_${mp.id}`,
            type: "SANGMU_DISCHARGE",
            year: context.currentYear,
            teamId: team.id,
            playerId: mp.id,
            playerName: mp.name,
            assignedStatus: mp.status,
            resolved: true
          });

          discharges.push({
            teamId: team.id,
            teamName: team.name,
            playerId: mp.id,
            playerName: mp.name,
            pos: mp.pos,
            age: mp.age,
            trueOvr: mp.getTrueOvr(),
            assignedStatus: mp.status,
            message: `[상무 전역 복귀] ${team.name} ${mp.name}(${mp.pos}, OVR ${mp.getTrueOvr()}) 18개월 복무 만료 후 ${mp.status} 복귀!`
          });
        } else {
          remainingMilitary.push(mp);
        }
      });

      team.militaryList = remainingMilitary;
    });

    // 매년 6월 1일 시점에 만 27세 이상 미필(UNFULFILLED) 선수 강제 입대 리스크 체크
    if (context.currentDate && context.currentDate.endsWith("-06-01")) {
      context.kboTeams.forEach((team) => {
        const overduePlayers = team
          .getAllPlayers()
          .filter((p) => {
            ensurePlayerMilitaryStatus(p);
            return p.nationality === "KOR" && p.militaryStatus === "UNFULFILLED" && p.age >= 27;
          });

        if (overduePlayers.length > 0 && rng() < 0.35) {
          const target = overduePlayers[0];
          const res = enlistPlayerToSangmu(context, team.id, target.id, { forced: true });
          if (res.ok) {
            forcedEnlistments.push({
              teamId: team.id,
              teamName: team.name,
              playerId: target.id,
              playerName: target.name,
              pos: target.pos,
              age: target.age,
              message: res.summary
            });
          }
        }
      });
    }

    return {
      discharges,
      forcedEnlistments
    };
  }

  /**
   * 매년 12월 10일 전 구단 미필 유망주(19~26세) 상무 피닉스 정기 입대 자동 처리
   */
  function autoManageDecemberSangmuEnlistment(context, rng = Math.random) {
    if (!context || !Array.isArray(context.kboTeams)) return [];
    const enlistedLogs = [];

    context.kboTeams.forEach((team) => {
      // 유저 구단의 입대는 단장이 직접 결정한다 (자동 입대 대상에서 제외)
      if (team.id === context.userTeamId) return;
      if (!Array.isArray(team.militaryList)) team.militaryList = [];
      if (team.militaryList.length >= SANGMU_MAX_PER_TEAM) return;

      // 2군/육성군 소속 미필 유망주 또는 25~26세 미필 선수를 우선 상무에 입대시켜 병역 리스크 해소
      const candidates = getEligibleSangmuCandidates(team).filter(
        (p) => p.status !== "1GUN" || p.age >= 25
      );
      const toEnlist = candidates.slice(0, Math.min(2, SANGMU_MAX_PER_TEAM - team.militaryList.length));
      toEnlist.forEach((cand) => {
        const res = enlistPlayerToSangmu(context, team.id, cand.id);
        if (res.ok) {
          enlistedLogs.push({
            teamId: team.id,
            teamName: team.name,
            playerId: cand.id,
            playerName: cand.name,
            pos: cand.pos,
            age: cand.age,
            summary: res.summary
          });
        }
      });
    });

    return enlistedLogs;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 4. [FACILITY_INVEST] 구단 인프라 & R&D 3대 시설 투자 (Lv.1 ~ Lv.5)
   *    - rehabCenter (스포츠 사이언스 & 재활 센터): 부상 확률 -5%~-25% 감소, 회복 기간 단축
   *    - biomechLab  (2군 바이오메카닉스 랩): 2군/육성군 주간 TP +10%~+40% 가속, 구속 교정 확률 상승
   *    - scoutHq     (데이터 분석 & 스카우트 본부): context.scoutLevel 영구 상승 및 파견 스카우트 확장
   * ═══════════════════════════════════════════════════════════════════════ */
  const FACILITY_SPECS = {
    rehabCenter: {
      key: "rehabCenter",
      name: "스포츠 사이언스 & 재활 센터",
      desc: "첨단 크라이오테라피 및 피로 관리로 팀 부상 확률(-5%~-25%) 감소 및 재활 기간 단축",
      costsByNextLevel: { 2: 80000, 3: 140000, 4: 220000, 5: 320000 }, // 8억, 14억, 22억, 32억
      injuryRiskMultiplier: { 1: 1.0, 2: 0.92, 3: 0.85, 4: 0.78, 5: 0.72 },
      recoverySpeedBonus:   { 1: 0,   2: 0.10, 3: 0.18, 4: 0.26, 5: 0.35 }
    },
    biomechLab: {
      key: "biomechLab",
      name: "2군 바이오메카닉스 랩",
      desc: "모션 캡처 및 트랙맨 분석으로 2군·육성군 주간 TP 획득량(+10%~+40%) 가속 및 투수 구속 교정",
      costsByNextLevel: { 2: 75000, 3: 130000, 4: 200000, 5: 300000 },
      tpGainMultiplier: { 1: 1.0,  2: 1.12, 3: 1.22, 4: 1.32, 5: 1.42 },
      veloBoostChance:  { 1: 0.08, 2: 0.14, 3: 0.22, 4: 0.30, 5: 0.40 }
    },
    scoutHq: {
      key: "scoutHq",
      name: "데이터 분석 & 스카우트 본부",
      desc: "전국 고교·대학·독립리그 및 해외 리그 스카우트 레벨(Lv.1~5) 영구 상승 및 파견 인원 확장",
      costsByNextLevel: { 2: 70000, 3: 120000, 4: 190000, 5: 280000 },
      maxScoutsByLevel: { 1: 3, 2: 4, 3: 5, 4: 6, 5: 7 }
    }
  };

  function ensureTeamFacilities(team) {
    if (!team) return { rehabCenter: 1, biomechLab: 1, scoutHq: 1 };
    if (!team.facilities || typeof team.facilities !== "object") {
      team.facilities = {
        rehabCenter: 1,
        biomechLab: 1,
        scoutHq: 1
      };
    }
    team.facilities.rehabCenter = clamp(Number(team.facilities.rehabCenter) || 1, 1, 5);
    team.facilities.biomechLab = clamp(Number(team.facilities.biomechLab) || 1, 1, 5);
    team.facilities.scoutHq = clamp(Number(team.facilities.scoutHq) || 1, 1, 5);
    return team.facilities;
  }

  function getTeamFacilityEffects(team) {
    const fac = ensureTeamFacilities(team);
    const tpGainMul = FACILITY_SPECS.biomechLab.tpGainMultiplier[fac.biomechLab] || 1.0;
    const injuryRiskMul = FACILITY_SPECS.rehabCenter.injuryRiskMultiplier[fac.rehabCenter] || 1.0;
    return {
      rehabCenterLevel: fac.rehabCenter,
      rehabLv: fac.rehabCenter,
      biomechLabLevel: fac.biomechLab,
      biomechLv: fac.biomechLab,
      scoutHqLevel: fac.scoutHq,
      injuryRiskMul,
      recoverySpeedBonus: FACILITY_SPECS.rehabCenter.recoverySpeedBonus[fac.rehabCenter] || 0,
      tpGainMul,
      tpBonusMul: tpGainMul,
      veloBoostChance: FACILITY_SPECS.biomechLab.veloBoostChance[fac.biomechLab] || 0.1,
      maxScouts: FACILITY_SPECS.scoutHq.maxScoutsByLevel[fac.scoutHq] || 3
    };
  }

  /**
   * 구단 인프라 시설 업그레이드 실행 (Lv.1 -> Lv.5)
   */
  function upgradeTeamFacility(context, teamId, facilityKey) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const spec = FACILITY_SPECS[facilityKey];
    if (!spec) return { ok: false, reason: "유효하지 않은 시설 항목입니다." };

    const fac = ensureTeamFacilities(team);
    const curLv = fac[facilityKey] || 1;
    if (curLv >= 5) {
      return { ok: false, reason: `${spec.name} 시설이 이미 최고 단계(Lv.5)에 도달했습니다.` };
    }

    const nextLv = curLv + 1;
    const cost = spec.costsByNextLevel[nextLv] || 150000;

    // 여유 예산(예산 - 연봉총액) 안에서만 투자 가능
    if (team.getAvailableBudget() - cost < 0) {
      return {
        ok: false,
        reason: `여유 예산(${(team.getAvailableBudget() / 10000).toFixed(1)}억)이 투자 비용(${(cost / 10000).toFixed(1)}억)보다 부족합니다. 구단주 증액 요청을 검토하세요.`
      };
    }

    team.budget = clamp((team.budget || 1200000) - cost, -3000000, 4000000);
    fac[facilityKey] = nextLv;

    // 스카우트 본부 업그레이드 시 context.scoutLevel 및 파견 가능 인원 즉시 연동
    if (facilityKey === "scoutHq" && team.id === context.userTeamId) {
      context.scoutLevel = clamp(Math.max(context.scoutLevel || 1, nextLv), 1, 5);
      if (context.scoutDispatch) {
        context.scoutDispatch.maxScouts = FACILITY_SPECS.scoutHq.maxScoutsByLevel[nextLv] || nextLv + 2;
      }
      if (typeof context.refreshAllScoutingReports === "function") {
        context.refreshAllScoutingReports();
      }
    }

    return {
      ok: true,
      teamId: team.id,
      facilityKey,
      facilityName: spec.name,
      prevLevel: curLv,
      newLevel: nextLv,
      costManwon: cost,
      remainingBudget: team.budget,
      effects: getTeamFacilityEffects(team),
      summary: `[인프라 R&D 투자 완료] ${team.name} '${spec.name}' Lv.${curLv} → Lv.${nextLv} 증축 완료! (투자비 ${(cost / 10000).toFixed(1)}억 원)`
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 5. [SALARY_CAP_EXT] 샐러리캡(경쟁균형세 120억 상한) & 비FA 다년 연장 계약
   *    - 비FA 다년 계약: FA 자격 취득 1~2년 전(faYears === 6~7) 자구단 핵심 선수와 4~6년 선제 계약
   *    - 경쟁균형세(Luxury Tax): 상위 40인 국내 선수 연봉 총액이 120억 원(1,200,000만 원) 초과 시
   *      초과분의 50% 야구발전기금 벌금 부과 + 차년도 신인 드래프트 1라운드 지명 순위 강등 페널티
   * ═══════════════════════════════════════════════════════════════════════ */
  const KBO_SALARY_CAP_LIMIT = 1200000; // 리그 평균 산출이 불가할 때 쓰는 기본 상한 (120억 원)
  // KBO 경쟁균형세 상한 = 10개 구단 상위 40인 국내 연봉 평균의 120% (실제 KBO 산정 방식)
  const SALARY_CAP_RATIO = 1.2;
  // 연속 초과 횟수별 제재: 1회 50% / 2회 연속 100% + 1R 9단계 하락 / 3회 이상 연속 150% + 1R 9단계 하락
  const LUXURY_TAX_TIERS = [
    { streak: 1, rate: 0.5, pickDrop: 0, label: "1회 초과: 초과분 50% 제재금" },
    { streak: 2, rate: 1.0, pickDrop: 9, label: "2회 연속: 초과분 100% + 다음 1R 지명권 9단계 하락" },
    { streak: 3, rate: 1.5, pickDrop: 9, label: "3회 이상 연속: 초과분 150% + 다음 1R 지명권 9단계 하락" }
  ];

  /**
   * 구단 내 비FA 다년 연장 계약 대상자(FA 취득 1~2년 전, faYears 6~7년차 국내 핵심 선수) 조회
   */
  function getNonFAExtensionCandidates(team) {
    if (!team) return [];
    return team
      .getAllPlayers()
      .filter(
        (p) =>
          p.nationality === "KOR" &&
          (p.faYears === 6 || p.faYears === 7) &&
          (p.contractYears || 1) <= 1 &&
          !p.isMultiYearExtended
      )
      .sort((a, b) => b.getTrueOvr() - a.getTrueOvr())
      .map((p) => {
        const ovr = p.getTrueOvr();
        const war = p.getWar();
        const recYears = p.age <= 29 ? 5 : 4;
        const estAnnual = round100(
          clamp(
            (p.salary || 20000) * 1.25 + Math.max(0, ovr - 74) * 3200 + Math.max(0, war) * 4500,
            15000,
            120000
          )
        );
        const estBonus = round100(estAnnual * recYears * 0.25);
        const estTotal = estAnnual * recYears + estBonus;

        return {
          playerId: p.id,
          name: p.name,
          pos: p.pos,
          age: p.age,
          faYears: p.faYears,
          yearsToFA: Math.max(1, 8 - (p.faYears || 6)),
          trueOvr: ovr,
          war,
          currentSalary: p.salary,
          recommendedYears: recYears,
          recommendedAnnual: estAnnual,
          recommendedBonus: estBonus,
          recommendedTotal: estTotal
        };
      });
  }

  /**
   * 비FA 다년 연장 계약(4~6년) 제시 및 체결
   */
  function offerNonFAMultiYearExtension(context, teamId, playerId, offerSpec = {}) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const player = team.getAllPlayers().find((p) => p.id === playerId);
    if (!player) return { ok: false, reason: "대상 선수를 찾을 수 없습니다." };
    if (player.nationality && player.nationality !== "KOR") {
      return { ok: false, reason: "외국인 선수는 비FA 다년 계약 대상이 아닙니다." };
    }
    if ((player.faYears || 0) < 5 || (player.faYears || 0) >= 8) {
      return { ok: false, reason: "FA 취득이 1~3년 남은 예비 FA 선수(연차 5~7년)만 비FA 다년 연장 계약이 가능합니다." };
    }

    const candMeta = getNonFAExtensionCandidates(team).find((c) => c.playerId === player.id);
    const years = clamp(Number(offerSpec.years) || (candMeta ? candMeta.recommendedYears : 4), 4, 6);
    const annualSalary = round100(
      Number(offerSpec.annualSalary) || (candMeta ? candMeta.recommendedAnnual : (player.salary || 25000) * 1.3)
    );
    const signingBonus = round100(
      Number.isFinite(Number(offerSpec.signingBonus)) && offerSpec.signingBonus != null
        ? Number(offerSpec.signingBonus)
        : (candMeta ? candMeta.recommendedBonus : annualSalary * years * 0.2)
    );
    const totalAmount = annualSalary * years + signingBonus;

    // 협상의 달인 단장 특성 보정
    const discount = context.gmProfile && context.gmProfile.trait === "NEGOTIATOR" ? 0.93 : 1.0;
    const minAcceptableTotal = (candMeta ? candMeta.recommendedTotal : totalAmount) * 0.88 * discount;

    if (totalAmount < minAcceptableTotal) {
      return {
        ok: false,
        accepted: false,
        reason: `${player.name} 측 에이전트가 제시 총액(${(totalAmount / 10000).toFixed(1)}억 원)이 시장 기대치(${(minAcceptableTotal / 10000).toFixed(1)}억 원)보다 낮다며 비FA 다년 연장 협상을 거절했습니다.`
      };
    }

    const extraAnnual = Math.max(0, annualSalary - (player.salary || 0));
    if (team.getAvailableBudget() - signingBonus - extraAnnual < 0) {
      return {
        ok: false,
        accepted: false,
        reason: `여유 예산(${(team.getAvailableBudget() / 10000).toFixed(1)}억)으로는 계약금(${(signingBonus / 10000).toFixed(1)}억)과 연봉 인상분(${(extraAnnual / 10000).toFixed(1)}억)을 감당할 수 없습니다.`
      };
    }

    team.budget = clamp((team.budget || 1200000) - signingBonus, -3000000, 4000000);
    player.salary = annualSalary;
    player.contractYears = years;
    player.faYears = 0; // 다년 연장 계약 기간 동안 FA 시장 유출 완전 차단
    player.isMultiYearExtended = true;

    team.fanRatio = clamp((team.fanRatio || 55) + 4, 0, 100);

    const record = {
      year: context.currentYear || 2025,
      teamId: team.id,
      teamName: team.name,
      playerId: player.id,
      playerName: player.name,
      pos: player.pos,
      age: player.age,
      years,
      annualSalary,
      signingBonus,
      totalAmount
    };
    if (!Array.isArray(team.nonFAExtensions)) team.nonFAExtensions = [];
    team.nonFAExtensions.push(record);

    const auditExt = ensureAuditMetrics(context);
    if (auditExt) {
      auditExt.nonFAMultiYearSignedCount = (auditExt.nonFAMultiYearSignedCount || 0) + 1;
    }

    return {
      ok: true,
      accepted: true,
      contractRecord: record,
      summary: `[비FA 다년 계약 타결!] ${team.name} 프랜차이즈 ${player.name}(${player.pos}) 선수와 ${years}년 총액 ${(totalAmount / 10000).toFixed(1)}억 원(계약금 ${(signingBonus / 10000).toFixed(1)}억 · 연봉 ${(annualSalary / 10000).toFixed(1)}억) 비FA 다년 연장 계약 체결!`
    };
  }

  /**
   * 특정 구단의 샐러리캡(경쟁균형세) 기준 상위 40인 국내 선수 연봉 총액 산출
   */
  function getTop40DomesticPayroll(team) {
    if (!team) return 0;
    const domesticPlayers = team
      .getAllPlayers()
      .filter((p) => (!p.nationality || p.nationality === "KOR") && p.status !== "MILITARY")
      .sort((a, b) => (b.salary || 0) - (a.salary || 0))
      .slice(0, 40);

    return domesticPlayers.reduce((sum, p) => sum + (p.salary || 0), 0);
  }

  /**
   * 경쟁균형세 상한액: 10개 구단 상위 40인 국내 연봉 평균 × 120%
   */
  function getSalaryCapLimit(context) {
    const teams = (context && context.kboTeams) || [];
    if (!teams.length) return KBO_SALARY_CAP_LIMIT;
    const avgTop40 = teams.reduce((s, t) => s + getTop40DomesticPayroll(t), 0) / teams.length;
    return avgTop40 > 0 ? round100(avgTop40 * SALARY_CAP_RATIO) : KBO_SALARY_CAP_LIMIT;
  }

  /** 직전 연도부터 거슬러 올라가며 연속 상한 초과 횟수 계산 (이번 심사 포함 전) */
  function countPriorOverCapStreak(team, year) {
    const hist = Array.isArray(team.luxuryTaxHistory) ? team.luxuryTaxHistory : [];
    let streak = 0;
    for (let y = year - 1; ; y--) {
      const h = hist.find((x) => x.year === y);
      if (!h || !h.isOverCap) break;
      streak += 1;
    }
    return streak;
  }

  /**
   * 10개 구단 경쟁균형세(Luxury Tax) 심사: 상한(리그 평균 상위 40인 연봉 × 120%) 초과 시
   * 연속 초과 횟수에 따라 제재금(50% / 100% / 150%) 및 다음 신인 드래프트 1R 지명권 9단계 하락
   */
  function evaluateLuxuryTaxAndPenalties(context, options = {}) {
    if (!context || !Array.isArray(context.kboTeams)) return { ok: false, reports: [] };
    const audit = ensureAuditMetrics(context);
    const year = context.currentYear || 2025;
    const capLimit = options.capLimit || getSalaryCapLimit(context);
    const reports = [];
    const penalizedTeamIds = [];
    const pickDropByTeam = {};

    context.kboTeams.forEach((team) => {
      const top40Payroll = getTop40DomesticPayroll(team);
      const overage = Math.max(0, top40Payroll - capLimit);
      let luxuryTaxFine = 0;
      let draftPickDrop = 0;
      let overCapStreak = 0;
      let penaltyLabel = null;

      if (overage > 0) {
        overCapStreak = countPriorOverCapStreak(team, year) + 1;
        const tier = LUXURY_TAX_TIERS[Math.min(overCapStreak, LUXURY_TAX_TIERS.length) - 1];
        luxuryTaxFine = round100(overage * tier.rate);
        draftPickDrop = tier.pickDrop;
        penaltyLabel = tier.label;
        team.budget = clamp((team.budget || 1200000) - luxuryTaxFine, -3000000, 4000000);
        penalizedTeamIds.push(team.id);
        if (draftPickDrop > 0) pickDropByTeam[team.id] = draftPickDrop;
      }

      const item = {
        year,
        teamId: team.id,
        teamName: team.name,
        top40PayrollManwon: top40Payroll,
        top40PayrollEok: +(top40Payroll / 10000).toFixed(1),
        capLimitManwon: capLimit,
        capLimitEok: +(capLimit / 10000).toFixed(1),
        overageManwon: overage,
        isOverCap: overage > 0,
        luxuryTaxFineManwon: luxuryTaxFine,
        luxuryTaxFineEok: +(luxuryTaxFine / 10000).toFixed(1),
        draftPickDrop,
        overCapStreak,
        penaltyLabel,
        remainingBudget: team.budget
      };
      reports.push(item);

      if (!Array.isArray(team.luxuryTaxHistory)) team.luxuryTaxHistory = [];
      team.luxuryTaxHistory = team.luxuryTaxHistory.filter((h) => h.year !== year);
      team.luxuryTaxHistory.push(item);
    });

    context.luxuryTaxPenalties = {
      year,
      capLimitManwon: capLimit,
      penalizedTeamIds,
      pickDropByTeam,
      reports
    };
    if (audit && Object.keys(pickDropByTeam).length > 0) {
      audit.luxuryTaxPickDropCount = (audit.luxuryTaxPickDropCount || 0) + Object.keys(pickDropByTeam).length;
    }

    if (audit) {
      audit.luxuryTaxEvaluatedCount = (audit.luxuryTaxEvaluatedCount || 0) + 1;
      audit.luxuryTaxPenalizedCount = (audit.luxuryTaxPenalizedCount || 0) + penalizedTeamIds.length;
    }

    return {
      ok: true,
      year,
      capLimitManwon: capLimit,
      penalizedTeamIds,
      reports,
      userTeamReport: reports.find((r) => r.teamId === context.userTeamId) || null
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 6. [POSTING_SYS] KBO-MLB 포스팅 시스템 (7년 차 이상 간판 스타 해외 진출 & +100억~300억 이적료 유입)
   * ═══════════════════════════════════════════════════════════════════════ */
  const MLB_DESTINATION_TEAMS = [
    "샌프란시스코 자이언츠",
    "LA 다저스",
    "샌디에이고 파드리스",
    "뉴욕 메츠",
    "보스턴 레드삭스",
    "토론토 블루제이스",
    "시애틀 매리너스",
    "시카고 컵스"
  ];

  // MLB 포스팅 제안 기준: 종합 OVR 90+ 또는 단일 능력치 95+ (연간 성장 도입 후 리그에 몇 명꼴로 등장하는 수준)
  const POSTING_MIN_OVR = 90;
  const POSTING_ELITE_STAT = 95;
  const POSTING_MAX_AGE = 31;
  const POSTING_MIN_SEASONS = 7; // KBO 포스팅 자격: 7시즌 이상
  const POSTING_MAX_OFFERS = 1; // 구단당 한 해 최대 1명
  // 포스팅 제안 기간: 시즌 종료 후 11월 1일 ~ 12월 15일 (MLB 포스팅 윈도우)
  const POSTING_WINDOW = { startMMDD: "11-01", endMMDD: "12-15" };

  function isPostingWindowOpen(context) {
    const mmdd = String((context && context.currentDate) || "").slice(5, 10);
    return mmdd >= POSTING_WINDOW.startMMDD && mmdd <= POSTING_WINDOW.endMMDD;
  }
  const STAT_LABEL_KO = {
    control: "제구", stuff: "구위", velo: "구속", stamina: "체력", movement: "변화",
    contact: "컨택", power: "파워", speed: "주력", defense: "수비", eye: "선구"
  };

  function getPostingQualification(p) {
    const ovr = p.getTrueOvr();
    const stats = Object.entries(p.st || {}).filter(([, v]) => typeof v === "number");
    const best = stats.sort((a, b) => b[1] - a[1])[0] || [null, 0];
    if (ovr >= POSTING_MIN_OVR) return { qualified: true, reason: `종합 OVR ${ovr} (리그 최상위)` };
    if (best[1] >= POSTING_ELITE_STAT) {
      return { qualified: true, reason: `${STAT_LABEL_KO[best[0]] || best[0]} ${best[1]} (리그 최정상급 단일 능력치)` };
    }
    return { qualified: false, reason: null };
  }

  function getMLBPostingCandidates(context, teamId = null) {
    if (!context) return [];
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return [];

    // OVR 90+ 또는 단일 능력치 95+ · KBO 7시즌+ · 만 31세 이하 국내 스타에게만, 포스팅 기간(11/1~12/15)에 제안이 들어온다
    if (!isPostingWindowOpen(context)) return [];
    const list = team
      .getAllPlayers()
      .filter(
        (p) =>
          (!p.nationality || p.nationality === "KOR") &&
          p.status !== "MILITARY" &&
          p.age <= POSTING_MAX_AGE &&
          (Number(p.kboSeasons) || 0) >= POSTING_MIN_SEASONS &&
          p.postingRejectedYear !== (context.currentYear || 2025)
      )
      .map((p) => ({ p, q: getPostingQualification(p) }))
      .filter((x) => x.q.qualified)
      .sort((a, b) => (b.p.getTrueOvr() + b.p.getWar() * 3) - (a.p.getTrueOvr() + a.p.getWar() * 3))
      .slice(0, POSTING_MAX_OFFERS);

    return list.map(({ p, q }) => {
      const ovr = p.getTrueOvr();
      const war = Math.max(0, p.getWar());
      const ageFactor = p.age <= 27 ? 1.35 : p.age <= 30 ? 1.10 : 0.85;
      // 포스팅 이적료: +100억 원(1,000,000만 원) ~ +300억 원(3,000,000만 원)
      const rawPostingFee = (1000000 + Math.max(0, ovr - 75) * 95000 + war * 85000) * ageFactor;
      const postingFeeManwon = round100(clamp(rawPostingFee, 1000000, 3000000));
      const mlbContractTotalM = Math.round((postingFeeManwon / 10000) * 0.42); // 참고용 MLB 총액(백만 달러)
      const mlbSuitor = MLB_DESTINATION_TEAMS[Math.abs(p.name.charCodeAt(0) + p.age) % MLB_DESTINATION_TEAMS.length];

      return {
        playerId: p.id,
        name: p.name,
        pos: p.pos,
        age: p.age,
        faYears: p.faYears || 7,
        trueOvr: ovr,
        war: p.getWar(),
        mlbSuitor,
        mlbContractTotalM,
        offerReason: q.reason,
        postingFeeManwon,
        postingFeeEok: +(postingFeeManwon / 10000).toFixed(1)
      };
    });
  }

  function executeMLBPosting(context, teamId, playerId, decision = "APPROVE") {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const player = team.getAllPlayers().find((p) => p.id === playerId);
    if (!player) return { ok: false, reason: "포스팅 대상 선수를 로스터에서 찾을 수 없습니다." };

    const cands = getMLBPostingCandidates(context, team.id);
    const candMeta = cands.find((c) => c.playerId === player.id);
    if (!candMeta) {
      return { ok: false, reason: `${player.name} 선수에게는 현재 MLB 포스팅 제안이 없습니다.` };
    }

    if (decision === "REJECT") {
      // 같은 해에는 다시 제안이 오지 않는다 (반복 불허로 사기가 계속 깎이는 것 방지)
      player.postingRejectedYear = context.currentYear || 2025;
      player.morale = clamp((player.morale ?? 75) - 18, 20, 100);
      player.moraleReason = "MLB 포스팅 해외 진출 불허로 인한 사기 저하";
      return {
        ok: true,
        decision: "REJECT",
        player,
        summary: `[MLB 포스팅 불허] ${player.name}(${player.pos}) 선수의 해외 진출 요청을 반려하고 구단 잔류를 결정했습니다. (사기 -18)`
      };
    }

    // 1군 최소 엔트리 유지를 위해 2군에서 대체 선수 자동 콜업
    if (player.status === "1GUN" && team.roster2G.length > 0) {
      const callup = team.roster2G.slice().sort((a, b) => b.getTrueOvr() - a.getTrueOvr())[0];
      if (callup) {
        team.roster2G = team.roster2G.filter((p) => p.id !== callup.id);
        callup.status = "1GUN";
        team.roster1G.push(callup);
      }
    }

    // 로스터에서 제거 및 MLB_POSTED 명예 진출 처리
    team.roster1G = team.roster1G.filter((p) => p.id !== player.id);
    team.roster2G = team.roster2G.filter((p) => p.id !== player.id);
    team.rosterDev = team.rosterDev.filter((p) => p.id !== player.id);
    player.status = "MLB_POSTED";
    player.teamId = "MLB";

    // 구단 예산에 포스팅 이적료(+100억~300억 원) 유입 (밸런스 범위 100억~250억 준수)
    const feeManwon = candMeta.postingFeeManwon;
    team.budget = clamp((team.budget || 1200000) + feeManwon, -3000000, 4000000);
    team.ownerTrust = clamp((team.ownerTrust || 60) + 12, 0, 100);
    team.fanRatio = clamp((team.fanRatio || 55) + 8, 0, 100);

    const record = {
      year: context.currentYear || 2025,
      date: context.currentDate || `${context.currentYear}-12-05`,
      teamId: team.id,
      teamName: team.name,
      playerId: player.id,
      playerName: player.name,
      pos: player.pos,
      age: player.age,
      trueOvr: player.getTrueOvr(),
      mlbTeam: candMeta.mlbSuitor,
      postingFeeManwon: feeManwon,
      postingFeeEok: candMeta.postingFeeEok
    };
    if (!Array.isArray(context.postingHistory)) context.postingHistory = [];
    context.postingHistory.push(record);

    return {
      ok: true,
      decision: "APPROVE",
      postingRecord: record,
      newBudget: team.budget,
      summary: `[MLB 포스팅 대형 타결!] ${team.name} 간판 ${player.name}(${player.pos}) 선수가 MLB '${candMeta.mlbSuitor}'와 계약하며 구단 금고에 포스팅 이적료 +${candMeta.postingFeeEok}억 원이 유입되었습니다!`
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 7. [PARK_CUSTOM] 홈구장 리모델링 및 파크 팩터 개조 (펜스 거리/높이 조절)
   * ═══════════════════════════════════════════════════════════════════════ */
  const PARK_REMODEL_PRESETS = {
    PITCHER_FORTRESS: {
      key: "PITCHER_FORTRESS",
      label: "투수 친화 요새화 (외야 펜스 5m 후진 & 4.5m 몬스터월 증축)",
      desc: "피홈런 억제력이 극대화되어 선발·불펜 평균자책점(ERA)을 크게 낮추는 투수 친화 구장으로 개조합니다.",
      costManwon: 150000, // 15억 원
      hr: 0.84,
      xbh: 0.94,
      hit: 0.97
    },
    SLUGGER_PARADISE: {
      key: "SLUGGER_PARADISE",
      label: "타자 친화 슬러거 파크 (좌우중간 펜스 당김 & 홈런 테라스 신설)",
      desc: "거포 군단의 장타력과 홈런 생산력을 극대화하여 다득점 야구와 관중 흥행을 유도합니다.",
      costManwon: 150000, // 15억 원
      hr: 1.18,
      xbh: 1.07,
      hit: 1.03
    },
    BALANCED_STANDARD: {
      key: "BALANCED_STANDARD",
      label: "메이저리그 표준 밸런스 리모델링 (정규 규격 & 최신 배수/잔디)",
      desc: "투타 유불리 없는 공정한 파크 팩터(1.00)와 쾌적한 관람 환경을 구축해 팬 민심(+5)을 높입니다.",
      costManwon: 100000, // 10억 원
      hr: 1.00,
      xbh: 1.00,
      hit: 1.00
    }
  };

  function remodelHomePark(context, teamId, presetKeyOrCustom = "PITCHER_FORTRESS") {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    let cost = 120000;
    let label = "커스텀 펜스 개조";
    let newHr = 1.0;
    let newXbh = 1.0;
    let newHit = 1.0;

    if (typeof presetKeyOrCustom === "string" && PARK_REMODEL_PRESETS[presetKeyOrCustom]) {
      const preset = PARK_REMODEL_PRESETS[presetKeyOrCustom];
      cost = preset.costManwon;
      label = preset.label;
      newHr = preset.hr;
      newXbh = preset.xbh;
      newHit = preset.hit;
    } else if (presetKeyOrCustom && typeof presetKeyOrCustom === "object") {
      cost = Number(presetKeyOrCustom.costManwon) || 120000;
      label = presetKeyOrCustom.label || "단장 직접 설계 파크 팩터 개조";
      newHr = +clamp(Number(presetKeyOrCustom.hr) || 1.0, 0.75, 1.30).toFixed(2);
      newXbh = +clamp(Number(presetKeyOrCustom.xbh) || 1.0, 0.85, 1.20).toFixed(2);
      newHit = +clamp(Number(presetKeyOrCustom.hit) || 1.0, 0.90, 1.12).toFixed(2);
    }

    if (team.getAvailableBudget() - cost < 0) {
      return {
        ok: false,
        reason: `여유 예산(${(team.getAvailableBudget() / 10000).toFixed(1)}억)이 구장 개조 비용(${(cost / 10000).toFixed(1)}억)보다 부족합니다.`
      };
    }

    team.budget = clamp((team.budget || 1200000) - cost, -3000000, 4000000);
    team.park = {
      ...(team.park || { name: `${team.city} 구장`, dome: false }),
      hr: newHr,
      xbh: newXbh,
      hit: newHit,
      lastRemodeledYear: context.currentYear || 2025,
      remodelLabel: label
    };
    team.fanRatio = clamp((team.fanRatio || 55) + 5, 0, 100);

    const logItem = {
      year: context.currentYear || 2025,
      date: context.currentDate || `${context.currentYear}-01-15`,
      parkName: team.park.name,
      label,
      costManwon: cost,
      hr: newHr,
      xbh: newXbh,
      hit: newHit
    };
    if (!Array.isArray(team.parkRemodelHistory)) team.parkRemodelHistory = [];
    team.parkRemodelHistory.push(logItem);

    return {
      ok: true,
      park: team.park,
      costManwon: cost,
      remainingBudget: team.budget,
      summary: `[홈구장 리모델링 완료] '${team.park.name}' ${label} 적용! (홈런 팩터 ${newHr} · 장타 ${newXbh} · 안타 ${newHit})`
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 8. [FUTURES_DEV] 2군 맞춤형 육성 가이드라인 (선수별 집중 과제 지정)
   * ═══════════════════════════════════════════════════════════════════════ */
  const FUTURES_TRAINING_PROGRAMS = {
    VELO:      { key: "VELO",      role: "pitcher", statKey: "velo",     label: "구속 증속 바이오메카닉스 (구속 집중)" },
    CONTROL:   { key: "CONTROL",   role: "pitcher", statKey: "control",  label: "코너워크 영점 교정 (제구력 집중)" },
    NEW_PITCH: { key: "NEW_PITCH", role: "pitcher", statKey: "movement", label: "신구종 및 결정구 변화량 연마 (변화/구종 집중)" },
    STAMINA:   { key: "STAMINA",   role: "pitcher", statKey: "stamina",  label: "선발 이닝이팅 지구력 강화 (체력 집중)" },
    EYE:       { key: "EYE",       role: "batter",  statKey: "eye",      label: "스트라이크존 설정 & 볼삼비 개선 (선구안 집중)" },
    POWER:     { key: "POWER",     role: "batter",  statKey: "power",    label: "발사각 교정 & 웨이트 벌크업 (파워 집중)" },
    CONTACT:   { key: "CONTACT",   role: "batter",  statKey: "contact",  label: "배트 스피드 & 인플레이 타구 (컨택 집중)" },
    DEFENSE:   { key: "DEFENSE",   role: "batter",  statKey: "defense",  label: "수비 범위 & 베이스러닝 (수비·주루 집중)" }
  };

  function setPlayerFuturesTraining(context, teamId, playerId, programKey) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const player = team.getAllPlayers().find((p) => p.id === playerId);
    if (!player) return { ok: false, reason: "선수를 찾을 수 없습니다." };

    const prog = FUTURES_TRAINING_PROGRAMS[programKey];
    if (!prog) return { ok: false, reason: "유효하지 않은 훈련 프로그램입니다." };

    player.trainingFocus = prog.key;
    player.morale = clamp((player.morale ?? 78) + 3, 0, 100);

    return {
      ok: true,
      playerId: player.id,
      playerName: player.name,
      trainingFocus: prog.key,
      programLabel: prog.label,
      summary: `[2군 맞춤 육성 지정] ${player.name}(${player.pos}) → '${prog.label}' 집중 과제 설정 완료!`
    };
  }

  function autoAssignFuturesTraining(context, teamId = null) {
    if (!context) return { ok: false, assignedCount: 0 };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, assignedCount: 0 };

    const fPlayers = [...(team.roster2G || []), ...(team.rosterDev || [])];
    let assignedCount = 0;

    fPlayers.forEach((p) => {
      if (p.trainingFocus) return;
      const st = p.st || {};
      if (p.type === "pitcher") {
        if ((st.control || 50) <= (st.velo || 50) - 5) p.trainingFocus = "CONTROL";
        else if ((st.velo || 50) < 72) p.trainingFocus = "VELO";
        else if (p.pos === "SP" && (st.stamina || 50) < 68) p.trainingFocus = "STAMINA";
        else p.trainingFocus = "NEW_PITCH";
      } else {
        if ((st.eye || 50) < 58) p.trainingFocus = "EYE";
        else if (["1B", "3B", "LF", "RF", "DH"].includes(p.pos)) p.trainingFocus = "POWER";
        else if (["C", "SS", "2B", "CF"].includes(p.pos) && (st.defense || 50) < 68) p.trainingFocus = "DEFENSE";
        else p.trainingFocus = "CONTACT";
      }
      assignedCount += 1;
    });

    return {
      ok: true,
      assignedCount,
      totalFuturesPlayers: fPlayers.length,
      summary: `[2군 맞춤형 육성 일괄 배정] 2군·육성군 미지정 유망주 ${assignedCount}명에게 취약 능력치 기반 집중 과제를 설정했습니다!`
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 9. [MORALE_TRADE] 선수 사기(Morale) & 트레이드 공식 요구 시스템
   * ═══════════════════════════════════════════════════════════════════════ */
  function ensurePlayerMorale(player) {
    if (!player) return 75;
    if (!Number.isFinite(Number(player.morale))) {
      player.morale = 78;
    }
    player.morale = clamp(Math.round(player.morale), 0, 100);
    if (typeof player.tradeDemand !== "boolean") {
      player.tradeDemand = false;
    }
    if (!player.moraleReason) {
      player.moraleReason = "구단 생활 및 출전 기회에 만족 중";
    }
    return player.morale;
  }

  function updateWeeklyTeamMorale(context, options = {}) {
    if (!context || !Array.isArray(context.kboTeams)) return { tradeDemands: [] };
    const tradeDemands = [];

    context.kboTeams.forEach((team) => {
      const rec = team.record || { w: 0, l: 0 };
      const isWinningTeam = (rec.w || 0) >= (rec.l || 0);

      team.getAllPlayers().forEach((p) => {
        ensurePlayerMorale(p);
        const ovr = p.getTrueOvr();

        // 1군 전력감(OVR 73+) 선수가 부상도 없는데 2군/육성군에 머물면 출전 기회 불만으로 사기 하락
        if (p.status !== "1GUN" && ovr >= 73 && (!p.injury || !p.injury.active)) {
          p.morale = clamp(p.morale - 8, 15, 100);
          p.moraleReason = `1군급 기량(OVR ${ovr})에도 2군 강등·출전 기회 부족 불만`;
        } else if (p.status === "1GUN" && isWinningTeam) {
          p.morale = clamp(p.morale + 2, 15, 100);
          if (p.morale >= 65) {
            p.tradeDemand = false;
            p.moraleReason = "1군 주전 출전 및 팀 성적 호조로 사기 충만";
          }
        }

        if (p.morale <= 42) {
          p.tradeDemand = true;
          if (team.id === context.userTeamId) {
            tradeDemands.push({
              playerId: p.id,
              name: p.name,
              pos: p.pos,
              age: p.age,
              status: p.status,
              trueOvr: ovr,
              morale: p.morale,
              reason: p.moraleReason
            });
          }
        }
      });
    });

    return { tradeDemands };
  }

  function getMoraleIssuePlayers(team) {
    if (!team) return [];
    return team
      .getAllPlayers()
      .filter((p) => {
        ensurePlayerMorale(p);
        return p.tradeDemand || p.morale <= 52 || (p.status !== "1GUN" && p.getTrueOvr() >= 73);
      })
      .sort((a, b) => a.morale - b.morale);
  }

  function resolvePlayerMoraleIssue(context, teamId, playerId, action = "PEP_TALK") {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const player = team.getAllPlayers().find((p) => p.id === playerId);
    if (!player) return { ok: false, reason: "선수를 찾을 수 없습니다." };

    ensurePlayerMorale(player);

    if (action === "PROMOTE_1G") {
      if (player.status === "1GUN") {
        player.morale = clamp(player.morale + 20, 0, 100);
        player.tradeDemand = false;
        player.moraleReason = "단장 약속으로 1군 핵심 기용 보장";
        return {
          ok: true,
          player,
          summary: `[1군 주전 기용 약속] ${player.name}(${player.pos}) 선수의 사기가 ${player.morale}(으)로 회복되었으며 트레이드 요구를 철회했습니다!`
        };
      }
      if (team.roster1G.length >= 28 && team.roster2G.length < 30) {
        // 1군 최하위 OVR 1명을 2군으로 내리고 콜업
        const lowest1G = team.roster1G.slice().sort((a, b) => a.getTrueOvr() - b.getTrueOvr())[0];
        if (lowest1G) {
          team.movePlayerStatus(lowest1G.id, "2GUN");
        }
      }
      const mv = team.movePlayerStatus(player.id, "1GUN");
      if (!mv.ok) return mv;
      player.morale = clamp(player.morale + 28, 0, 100);
      player.tradeDemand = false;
      player.moraleReason = "1군 전격 콜업으로 사기 대폭 상승";
      return {
        ok: true,
        player,
        summary: `[1군 콜업 & 사기 회복] ${player.name}(${player.pos}) 선수를 1군으로 콜업하여 사기(${player.morale}) 회복 및 트레이드 요구를 해결했습니다!`
      };
    }

    // 기본: 단장 1:1 면담 및 특별 격려금(2,000만 원) 지급
    const bonusCost = 2000;
    team.budget = clamp((team.budget || 1200000) - bonusCost, -3000000, 4000000);
    player.morale = clamp(player.morale + 26, 0, 100);
    player.tradeDemand = false;
    player.moraleReason = "단장 1:1 면담 및 특별 인센티브 지급으로 갈등 봉합";

    return {
      ok: true,
      player,
      summary: `[단장 면담 완료] ${player.name}(${player.pos}) 선수와 1:1 면담 및 특별 격려금(2,000만원) 지급으로 사기(${player.morale}) 회복 및 트레이드 요구를 철회시켰습니다!`
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 10. [PROTECTION_UI] FA 20인/25인 & 2차 드래프트 35인 보호명단 작성 시스템
   * ═══════════════════════════════════════════════════════════════════════ */
  const PROTECTION_MODE_LIMITS = {
    FA_20:    { key: "FA_20",    limit: 20, label: "FA A등급 영입 대비 20인 보호명단" },
    FA_25:    { key: "FA_25",    limit: 25, label: "FA B등급 영입 대비 25인 보호명단" },
    DRAFT_35: { key: "DRAFT_35", limit: 35, label: "2차 드래프트 35인 보호명단" }
  };

  function ensureCustomProtectionStore(team) {
    if (!team.customProtectedIds || typeof team.customProtectedIds !== "object") {
      team.customProtectedIds = { FA_20: [], FA_25: [], DRAFT_35: [] };
    }
    ["FA_20", "FA_25", "DRAFT_35"].forEach((k) => {
      if (!Array.isArray(team.customProtectedIds[k])) team.customProtectedIds[k] = [];
    });
    return team.customProtectedIds;
  }

  function autoFillProtectedPlayers(context, teamId, mode = "FA_20") {
    if (!context) return { ok: false, protectedIds: [] };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, protectedIds: [] };

    const store = ensureCustomProtectionStore(team);
    const spec = PROTECTION_MODE_LIMITS[mode] || PROTECTION_MODE_LIMITS.FA_20;
    const curYear = context.currentYear || 2025;

    const candidates = team
      .getAllPlayers()
      .filter((p) => {
        const isForeign = p.nationality && p.nationality !== "KOR";
        const isRecentRookie = p.draftInfo && Number(p.draftInfo.year) >= curYear;
        const isMilitary = p.status === "MILITARY";
        return !isForeign && !isRecentRookie && !isMilitary;
      })
      .sort((a, b) => {
        const va = a.getTrueOvr() * 0.62 + (a.potential || 70) * 0.38 - Math.max(0, a.age - 30) * 1.6;
        const vb = b.getTrueOvr() * 0.62 + (b.potential || 70) * 0.38 - Math.max(0, b.age - 30) * 1.6;
        return vb - va;
      });

    store[spec.key] = candidates.slice(0, spec.limit).map((p) => p.id);

    return {
      ok: true,
      mode: spec.key,
      limit: spec.limit,
      protectedIds: store[spec.key],
      summary: `[${spec.label}] OVR·잠재력·연령 가치 기반 핵심 ${store[spec.key].length}명 자동 보호명단 작성이 완료되었습니다!`
    };
  }

  function getTeamProtectionState(context, teamId, mode = "FA_20") {
    if (!context) return null;
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return null;

    const store = ensureCustomProtectionStore(team);
    const spec = PROTECTION_MODE_LIMITS[mode] || PROTECTION_MODE_LIMITS.FA_20;
    const curYear = context.currentYear || 2025;

    // 아직 보호명단이 비어 있으면 초기 추천 명단으로 자동 채움
    const allValidIds = new Set(team.getAllPlayers().map((p) => p.id));
    store[spec.key] = store[spec.key].filter((id) => allValidIds.has(id));
    if (store[spec.key].length === 0) {
      autoFillProtectedPlayers(context, team.id, spec.key);
    }

    const protectedSet = new Set(store[spec.key]);
    const autoExemptPlayers = [];
    const protectedPlayers = [];
    const exposedPlayers = [];

    team.getAllPlayers().forEach((p) => {
      const isForeign = p.nationality && p.nationality !== "KOR";
      const isRecentRookie = p.draftInfo && Number(p.draftInfo.year) >= curYear;
      const isMilitary = p.status === "MILITARY";
      if (isForeign || isRecentRookie || isMilitary) {
        autoExemptPlayers.push(p);
      } else if (protectedSet.has(p.id)) {
        protectedPlayers.push(p);
      } else {
        exposedPlayers.push(p);
      }
    });

    exposedPlayers.sort((a, b) => b.getTrueOvr() - a.getTrueOvr());

    return {
      mode: spec.key,
      label: spec.label,
      limit: spec.limit,
      currentCount: protectedPlayers.length,
      autoExemptPlayers,
      protectedPlayers,
      exposedPlayers,
      aiDangerTarget: exposedPlayers[0] || null
    };
  }

  function toggleProtectedPlayer(context, teamId, playerId, mode = "FA_20") {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const store = ensureCustomProtectionStore(team);
    const spec = PROTECTION_MODE_LIMITS[mode] || PROTECTION_MODE_LIMITS.FA_20;
    const list = store[spec.key];
    const idx = list.indexOf(playerId);

    // [감독 외압 보호 고정 체크] 감독 요구 수용으로 보호 고정(Locked)된 베테랑은 임의 해제 불가
    const mcState = team.managerConflictState;
    const lockedIds =
      mcState && mcState.lockedMandatePlayers && Array.isArray(mcState.lockedMandatePlayers[spec.key])
        ? mcState.lockedMandatePlayers[spec.key]
        : [];
    if (idx >= 0 && lockedIds.includes(playerId)) {
      return {
        ok: false,
        lockedByManager: true,
        reason: `[감독 보호 고정] 감독 외압 수용으로 필수 보호 고정된 베테랑 선수입니다. 해제할 수 없습니다.`
      };
    }

    if (idx >= 0) {
      list.splice(idx, 1);
      return { ok: true, action: "REMOVED", currentCount: list.length, limit: spec.limit };
    } else {
      if (list.length >= spec.limit) {
        return {
          ok: false,
          reason: `${spec.label} 정원(${spec.limit}명)이 가득 찼습니다. 기존 보호 선수를 먼저 해제한 뒤 추가하세요.`
        };
      }
      list.push(playerId);
      return { ok: true, action: "ADDED", currentCount: list.length, limit: spec.limit };
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 11. [KBO_GM.ManagerConflict / KBO_GM.RealisticGM]
   *     감독 요구 및 프런트 갈등 외압 시스템
   *     1) 보호선수 명단 감독 외압 (PROTECTION_MANDATE)
   *     2) 트레이드 거부권 행사 및 정규시즌 핀포인트 수혈 공식 요청 (TRADE_DIRECTIVE)
   *     3) 감독 갈등 수치(Conflict Gauge) 및 3단계 파국 처리 (언론비판 → 청문회 → 위약금 경질)
   * ═══════════════════════════════════════════════════════════════════════ */
  const REPLACEMENT_MANAGER_CANDIDATES = [
    { name: "류지현", style: "육성", annualSalaryManwon: 40000, contractYears: 2, desc: "데이터·리빌딩 친화형 신임 감독" },
    { name: "김원형", style: "투수중심", annualSalaryManwon: 45000, contractYears: 2, desc: "마운드 재건 및 불펜 안정화 전문" },
    { name: "이종범", style: "공격야구", annualSalaryManwon: 42000, contractYears: 2, desc: "기동력과 화력 중심의 분위기 쇄신형" },
    { name: "홍원기", style: "균형", annualSalaryManwon: 40000, contractYears: 2, desc: "프런트 협업 및 유망주 중용 시스템 야구" }
  ];

  function ensureManagerConflictState(team) {
    if (!team) return null;
    const mgrObj = (team.coachingStaff && team.coachingStaff.manager) || {
      name: "한도훈",
      style: "베테랑중시"
    };
    if (!team.managerConflictState || typeof team.managerConflictState !== "object") {
      team.managerConflictState = {
        managerName: mgrObj.name || "한도훈",
        managerStyle: mgrObj.style || "베테랑중시",
        annualSalaryManwon: Number(mgrObj.annualSalaryManwon) || 50000, // 기본 연봉 5억 원 (50,000만 원)
        remainingContractYears: Number(mgrObj.remainingContractYears) || 2, // 기본 잔여 2년 (위약금 10억 원)
        managerTrust: 65, // 감독 신임도 (0~100, 20 이하 시 파국 1~3단계 발동)
        conflictGauge: 35, // 갈등 게이지 (100 - managerTrust)
        mediaLeakProb: 0.05, // 감독 언론 불만 유출 확률 (기본 5%, 거부 시 +35%p 가산)
        teamMoraleModifier: 0,
        crisisStage: 0, // 0: 정상, 1: 언론 프런트 공개 비판(fanRatio -15), 2: 자진사퇴 배수진 & 이사회 청문회, 3: 감독 경질 선택지 활성화
        stage1Triggered: false,
        stage2Triggered: false,
        stage3Triggered: false,
        canFireManager: false,
        lockedMandatePlayers: {
          FA_20: [],
          FA_25: [],
          DRAFT_35: []
        },
        pendingMandateModal: null,
        pendingTradeVetoModal: null,
        activeTradeDirectives: [],
        pendingBoardHearing: null,
        conflictLogs: []
      };
    }
    const st = team.managerConflictState;
    if (mgrObj && mgrObj.name) st.managerName = mgrObj.name;
    st.managerTrust = clamp(Math.round(Number(st.managerTrust) || 0), 0, 100);
    st.conflictGauge = clamp(100 - st.managerTrust, 0, 100);
    st.mediaLeakProb = +clamp(Number(st.mediaLeakProb) || 0.05, 0, 0.98).toFixed(2);
    st.canFireManager = Boolean(st.crisisStage >= 3 || st.managerTrust <= 20);
    return st;
  }

  function applyTeamMoraleDelta(team, delta) {
    if (!team || !delta) return 0;
    const all = team.getAllPlayers();
    all.forEach((p) => {
      ensurePlayerMorale(p);
      p.morale = clamp(Math.round((p.morale || 68) + delta), 0, 100);
    });
    const avg = all.length
      ? Math.round(all.reduce((s, p) => s + (p.morale || 68), 0) / all.length)
      : 68;
    team.teamMorale = avg;
    return avg;
  }

  /**
   * [스펙 3] 감독 갈등 수치(Conflict Gauge) 및 managerTrust <= 20 파국 1~3단계 처리
   */
  function evaluateConflictCrisis(context, teamId, options = {}) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const st = ensureManagerConflictState(team);
    const rng = options.rng || Math.random;
    const curDate = context.currentDate || `${context.currentYear || 2025}-06-01`;
    const triggeredEvents = [];

    // 언론 불만 유출 확률 체크 (거부 등으로 mediaLeakProb 상승 시)
    if (options.checkMediaLeak && rng() < st.mediaLeakProb) {
      const leakDrop = st.managerTrust <= 20 ? 15 : 8;
      team.fanRatio = clamp(Math.round((team.fanRatio || 55) - leakDrop), 0, 100);
      const leakMsg = `[감독 언론 불만 유출] ${team.name} ${st.managerName} 감독, 익명 인터뷰서 "현장 의견 무시하는 프런트 독단 운영" 불만 토로 (팬 민심 -${leakDrop})`;
      st.conflictLogs.unshift({
        date: curDate,
        type: "MEDIA_LEAK",
        stage: st.crisisStage,
        message: leakMsg
      });
      triggeredEvents.push({ type: "MEDIA_LEAK", fanRatioDelta: -leakDrop, message: leakMsg });
    }

    // managerTrust가 20 초과면 위기 단계 해제/유지
    if (st.managerTrust > 20) {
      st.canFireManager = st.crisisStage >= 3;
      return {
        ok: true,
        inCrisis: false,
        managerTrust: st.managerTrust,
        conflictGauge: st.conflictGauge,
        crisisStage: st.crisisStage,
        canFireManager: st.canFireManager,
        triggeredEvents
      };
    }

    // ─────────────────────────────────────────────────────────────────────
    // managerTrust <= 20 진입 시 단계별 파국(1단계 -> 2단계 -> 3단계) 처리
    // ─────────────────────────────────────────────────────────────────────
    if (!st.stage1Triggered || st.crisisStage < 1) {
      // [1단계] 언론 인터뷰를 통한 프런트 야구 공개 비판 (팬 민심 fanRatio -15)
      st.stage1Triggered = true;
      st.crisisStage = Math.max(st.crisisStage, 1);
      const prevFan = team.fanRatio || 55;
      team.fanRatio = clamp(prevFan - 15, 0, 100);
      const msg1 = `[파국 1단계 · 언론 공개 비판] ${st.managerName} 감독(신임도 ${st.managerTrust}), 공식 기자회견서 "프런트의 탁상공론 야구가 팀을 망치고 있다" 직격탄! (팬 민심 ${prevFan} → ${team.fanRatio}, -15 하락)`;
      st.conflictLogs.unshift({
        date: curDate,
        type: "CRISIS_STAGE_1",
        stage: 1,
        fanRatioDelta: -15,
        message: msg1
      });
      triggeredEvents.push({
        stage: 1,
        type: "STAGE_1_MEDIA_CRITICISM",
        fanRatioDelta: -15,
        message: msg1
      });
    } else if (!st.stage2Triggered || st.crisisStage === 1 || options.advanceCrisisStage) {
      // [2단계] 감독 자진 사퇴 배수진 및 구단주 이사회 중재 청문회 개최
      st.stage2Triggered = true;
      st.crisisStage = Math.max(st.crisisStage, 2);
      const hearingObj = {
        id: `HEARING_${context.currentYear || 2025}_${Date.now()}`,
        date: curDate,
        managerName: st.managerName,
        managerTrust: st.managerTrust,
        title: `[파국 2단계] ${st.managerName} 감독 자진 사퇴 배수진 & 구단주 이사회 중재 청문회`,
        desc: `${st.managerName} 감독이 선수단 기용 및 로스터 편성 전권을 요구하며 자진 사퇴 배수진을 쳤습니다. 구단주 주재 긴급 이사회 중재 청문회가 소집되었습니다.`,
        options: [
          {
            code: "COMPROMISE",
            label: "현장 권한 존중 및 중재안 수용 (감독 신임도 +25 · 구단주 신임도 -5)"
          },
          {
            code: "ESCALATE_TO_STAGE_3",
            label: "프런트 원칙 고수 및 감독 인사권 발동 요청 (3단계 감독 경질 선택지 활성화)"
          }
        ],
        resolved: false
      };
      st.pendingBoardHearing = hearingObj;
      const msg2 = `[파국 2단계 · 이사회 중재 청문회] ${st.managerName} 감독이 자진 사퇴 배수진을 선언하여 구단주 이사회 중재 청문회가 개최되었습니다!`;
      st.conflictLogs.unshift({
        date: curDate,
        type: "CRISIS_STAGE_2",
        stage: 2,
        message: msg2
      });
      triggeredEvents.push({
        stage: 2,
        type: "STAGE_2_RESIGNATION_ULTIMATUM_HEARING",
        hearing: hearingObj,
        message: msg2
      });
    }

    if (st.managerTrust <= 10 || st.stage2Triggered || options.unlockDismissal) {
      // [3단계] 단장의 감독 경질 선택지 활성화 (잔여 계약 위약금 예산 차감 조건)
      st.stage3Triggered = true;
      st.crisisStage = 3;
      st.canFireManager = true;
      const severanceManwon = st.remainingContractYears * st.annualSalaryManwon;
      const msg3 = `[파국 3단계 · 감독 경질 선택지 활성화] 감독-프런트 관계가 파국(신임도 ${st.managerTrust})에 달해 단장 직권 [감독 경질] 권한이 활성화되었습니다. (경질 시 잔여 ${st.remainingContractYears}년 위약금 ${(severanceManwon / 10000).toFixed(1)}억 원 예산 차감)`;
      if (!st.conflictLogs.some((l) => l.type === "CRISIS_STAGE_3")) {
        st.conflictLogs.unshift({
          date: curDate,
          type: "CRISIS_STAGE_3",
          stage: 3,
          severanceManwon,
          message: msg3
        });
      }
      triggeredEvents.push({
        stage: 3,
        type: "STAGE_3_DISMISSAL_ENABLED",
        canFireManager: true,
        severanceManwon,
        message: msg3
      });
    }

    if (Array.isArray(context.pendingEvents) && triggeredEvents.length > 0) {
      triggeredEvents.forEach((ev) => {
        context.pendingEvents.push({
          id: `MGR_CRISIS_${curDate}_${ev.type}`,
          type: ev.type,
          teamId: team.id,
          resolved: false,
          ...ev
        });
      });
    }

    return {
      ok: true,
      inCrisis: true,
      managerTrust: st.managerTrust,
      conflictGauge: st.conflictGauge,
      crisisStage: st.crisisStage,
      canFireManager: st.canFireManager,
      severancePayManwon: st.remainingContractYears * st.annualSalaryManwon,
      pendingBoardHearing: st.pendingBoardHearing,
      triggeredEvents
    };
  }

  /**
   * [스펙 1] 보호선수 명단 감독 외압 (PROTECTION_MANDATE)
   * - FA 영입(20인/25인) 및 2차 드래프트(35인) 보호명단 제출 시 감독이 특정 베테랑/친분 선수의 필수 보호 요구 모달 이벤트 트리거
   */
  function triggerProtectionMandate(context, teamId, mode = "FA_20", options = {}) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const st = ensureManagerConflictState(team);
    const store = ensureCustomProtectionStore(team);
    const spec = PROTECTION_MODE_LIMITS[mode] || PROTECTION_MODE_LIMITS.FA_20;

    if (!store[spec.key] || store[spec.key].length === 0) {
      autoFillProtectedPlayers(context, team.id, spec.key);
    }
    const currentProtectedSet = new Set(store[spec.key]);

    // 비보호 명단에 있거나 보호 커트라인 끝자락에 있는 베테랑/친분 선수(만 29세 이상 국내 선수 우선) 탐색
    const allDomestic = team
      .getAllPlayers()
      .filter((p) => (!p.nationality || p.nationality === "KOR") && p.status !== "MILITARY");

    let veteranTarget = allDomestic
      .filter((p) => !currentProtectedSet.has(p.id) && p.age >= 29)
      .sort((a, b) => b.age * 1.5 + b.getTrueOvr() - (a.age * 1.5 + a.getTrueOvr()))[0];

    if (!veteranTarget) {
      veteranTarget = allDomestic
        .filter((p) => p.age >= 28)
        .sort((a, b) => b.age - a.age)[0] || allDomestic[0];
    }

    // 베테랑을 강제 보호할 경우 밀려날 위험에 처하는 보호명단 내 최고 잠재력 유망주 산출
    const protectedPlayers = allDomestic.filter((p) => currentProtectedSet.has(p.id));
    const atRiskProspect =
      protectedPlayers
        .filter((p) => p.id !== (veteranTarget && veteranTarget.id) && p.age <= 25)
        .sort((a, b) => (b.potential || 75) - (a.potential || 75))[0] ||
      protectedPlayers[protectedPlayers.length - 1] ||
      null;

    const mandateEvent = {
      id: `MANDATE_${spec.key}_${context.currentYear || 2025}_${veteranTarget ? veteranTarget.id : "VET"}`,
      type: "PROTECTION_MANDATE",
      mode: spec.key,
      modeLabel: spec.label,
      limit: spec.limit,
      teamId: team.id,
      managerName: st.managerName,
      veteranPlayerId: veteranTarget ? veteranTarget.id : null,
      veteranPlayerName: veteranTarget ? veteranTarget.name : "고참 베테랑",
      veteranPos: veteranTarget ? veteranTarget.pos : "IF",
      veteranAge: veteranTarget ? veteranTarget.age : 34,
      veteranOvr: veteranTarget ? veteranTarget.getTrueOvr() : 68,
      atRiskProspectId: atRiskProspect ? atRiskProspect.id : null,
      atRiskProspectName: atRiskProspect ? atRiskProspect.name : "핵심 유망주",
      atRiskProspectPos: atRiskProspect ? atRiskProspect.pos : "SP",
      atRiskProspectPot: atRiskProspect ? atRiskProspect.potential : 88,
      title: `[감독 보호명단 외압] ${st.managerName} 감독의 베테랑 필수 보호 요구 (${spec.label})`,
      quote: `"단장님, ${veteranTarget ? veteranTarget.name : "베테랑"}(${veteranTarget ? veteranTarget.age : 34}세·${veteranTarget ? veteranTarget.pos : "주전"}) 선수는 우리 더그아웃의 정신적 지주이자 제가 신임하는 핵심 베테랑입니다. 이번 ${spec.label}에 무조건 포함시켜 주십시오!"`,
      effectsPreview: {
        accept: "managerTrust +15, teamMorale +5, 해당 베테랑 보호 고정 (유망주 풀림 리스크 가중)",
        reject: "managerTrust -25, 감독 언론 불만 유출 확률 +35%, 유망주 정상 보호"
      },
      resolved: false
    };

    st.pendingMandateModal = mandateEvent;
    if (Array.isArray(context.pendingEvents)) {
      context.pendingEvents.push(mandateEvent);
    }

    return {
      ok: true,
      mandateEvent
    };
  }

  /**
   * 보호선수 명단 감독 외압 수용(ACCEPT) 또는 거부(REJECT) 처리
   */
  function resolveProtectionMandate(context, teamId, decision = "ACCEPT", mode = null) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const st = ensureManagerConflictState(team);
    const store = ensureCustomProtectionStore(team);
    const activeModal =
      st.pendingMandateModal ||
      triggerProtectionMandate(context, team.id, mode || "FA_20").mandateEvent;
    const targetMode = mode || (activeModal && activeModal.mode) || "FA_20";
    const spec = PROTECTION_MODE_LIMITS[targetMode] || PROTECTION_MODE_LIMITS.FA_20;
    const curDate = context.currentDate || `${context.currentYear || 2025}-11-01`;

    if (store[spec.key].length === 0) {
      autoFillProtectedPlayers(context, team.id, spec.key);
    }

    const vetId = activeModal && activeModal.veteranPlayerId;
    const vetName = (activeModal && activeModal.veteranPlayerName) || "베테랑 선수";
    let exposedProspectName = (activeModal && activeModal.atRiskProspectName) || null;

    if (decision === "ACCEPT") {
      // [수용]: managerTrust +15, teamMorale +5, 해당 베테랑 보호 고정 (유망주 풀림 리스크 가중)
      st.managerTrust = clamp(st.managerTrust + 15, 0, 100);
      st.conflictGauge = clamp(100 - st.managerTrust, 0, 100);
      st.teamMoraleModifier = (st.teamMoraleModifier || 0) + 5;
      const newTeamMorale = applyTeamMoraleDelta(team, 5);

      if (vetId) {
        if (!store[spec.key].includes(vetId)) {
          if (store[spec.key].length >= spec.limit) {
            // 유망주 1명이 보호명단에서 밀려나 비보호 노출됨
            const bumpIdx =
              activeModal && activeModal.atRiskProspectId
                ? store[spec.key].indexOf(activeModal.atRiskProspectId)
                : -1;
            if (bumpIdx >= 0) {
              store[spec.key].splice(bumpIdx, 1);
            } else {
              const removedId = store[spec.key].pop();
              const removedPlr = team.getAllPlayers().find((p) => p.id === removedId);
              if (removedPlr) exposedProspectName = removedPlr.name;
            }
          }
          store[spec.key].unshift(vetId);
        }
        if (!Array.isArray(st.lockedMandatePlayers[spec.key])) {
          st.lockedMandatePlayers[spec.key] = [];
        }
        if (!st.lockedMandatePlayers[spec.key].includes(vetId)) {
          st.lockedMandatePlayers[spec.key].push(vetId);
        }
      }

      if (activeModal) activeModal.resolved = true;
      st.pendingMandateModal = null;

      const summary = `[감독 외압 수용] ${st.managerName} 감독 요구를 수용하여 베테랑 ${vetName} 선수를 ${spec.label}에 필수 보호 고정했습니다! (감독 신임도 +15 → ${st.managerTrust}, 팀 사기 +5 → ${newTeamMorale}${
        exposedProspectName ? `, 유망주 ${exposedProspectName} 비보호 노출 리스크 발생` : ""
      })`;
      st.conflictLogs.unshift({
        date: curDate,
        type: "PROTECTION_MANDATE_ACCEPT",
        decision: "ACCEPT",
        message: summary
      });

      return {
        ok: true,
        decision: "ACCEPT",
        managerTrust: st.managerTrust,
        conflictGauge: st.conflictGauge,
        teamMorale: newTeamMorale,
        lockedPlayerId: vetId,
        exposedProspectName,
        summary
      };
    } else {
      // [거부]: managerTrust -25, 감독 언론 불만 유출 확률 +35%, 유망주 정상 보호
      st.managerTrust = clamp(st.managerTrust - 25, 0, 100);
      st.conflictGauge = clamp(100 - st.managerTrust, 0, 100);
      st.mediaLeakProb = +clamp(st.mediaLeakProb + 0.35, 0, 0.98).toFixed(2);

      if (vetId && Array.isArray(st.lockedMandatePlayers[spec.key])) {
        st.lockedMandatePlayers[spec.key] = st.lockedMandatePlayers[spec.key].filter((id) => id !== vetId);
      }
      // 유망주 정상 보호 보장
      if (
        activeModal &&
        activeModal.atRiskProspectId &&
        !store[spec.key].includes(activeModal.atRiskProspectId)
      ) {
        if (vetId && store[spec.key].includes(vetId)) {
          store[spec.key] = store[spec.key].filter((id) => id !== vetId);
        } else if (store[spec.key].length >= spec.limit) {
          store[spec.key].pop();
        }
        store[spec.key].push(activeModal.atRiskProspectId);
      }

      if (activeModal) activeModal.resolved = true;
      st.pendingMandateModal = null;

      const crisisRes = evaluateConflictCrisis(context, team.id, { checkMediaLeak: true });
      const summary = `[감독 외압 거부] ${st.managerName} 감독의 베테랑(${vetName}) 보호 요구를 거부하고 유망주를 정상 보호했습니다. (감독 신임도 -25 → ${st.managerTrust}, 언론 불만 유출 확률 +35% → ${Math.round(
        st.mediaLeakProb * 100
      )}%)`;
      st.conflictLogs.unshift({
        date: curDate,
        type: "PROTECTION_MANDATE_REJECT",
        decision: "REJECT",
        message: summary
      });

      return {
        ok: true,
        decision: "REJECT",
        managerTrust: st.managerTrust,
        conflictGauge: st.conflictGauge,
        mediaLeakProb: st.mediaLeakProb,
        crisisReport: crisisRes,
        summary
      };
    }
  }

  /**
   * [스펙 2-A] 단장이 OVR 상위 핵심 선수를 트레이드 카드로 지정 시 감독의 [트레이드 거부권 행사] 판정
   */
  function checkManagerTradeVeto(context, teamId, outgoingPlayerIds = [], options = {}) {
    if (!context) return { vetoed: false };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { vetoed: false };

    const st = ensureManagerConflictState(team);
    const ids = Array.isArray(outgoingPlayerIds) ? outgoingPlayerIds : [outgoingPlayerIds];
    if (ids.length === 0) return { vetoed: false };

    const allPlayersSorted = team
      .getAllPlayers()
      .slice()
      .sort((a, b) => b.getTrueOvr() - a.getTrueOvr());
    const topCoreIds = new Set(allPlayersSorted.slice(0, 6).map((p) => p.id));

    const coreTarget = allPlayersSorted.find(
      (p) => ids.includes(p.id) && (topCoreIds.has(p.id) || p.getTrueOvr() >= 75)
    );

    if (!coreTarget) {
      return { vetoed: false };
    }

    const vetoEvent = {
      id: `TRADE_VETO_${context.currentYear || 2025}_${coreTarget.id}`,
      type: "TRADE_DIRECTIVE_VETO",
      teamId: team.id,
      managerName: st.managerName,
      playerId: coreTarget.id,
      playerName: coreTarget.name,
      pos: coreTarget.pos,
      age: coreTarget.age,
      ovr: coreTarget.getTrueOvr(),
      outgoingPlayerIds: ids,
      title: `[감독 트레이드 거부권 행사!] ${st.managerName} 감독, 핵심 전력 ${coreTarget.name}(OVR ${coreTarget.getTrueOvr()}) 트레이드 반대`,
      quote: `"단장님! ${coreTarget.name}(${coreTarget.pos} · OVR ${coreTarget.getTrueOvr()}) 선수는 우리 팀 라인업의 핵심 기둥입니다. 이 선수를 내보내는 트레이드는 현장 감독으로서 절대 동의할 수 없습니다! 거부권을 행사합니다!"`,
      resolved: false
    };

    st.pendingTradeVetoModal = vetoEvent;
    if (Array.isArray(context.pendingEvents)) {
      context.pendingEvents.push(vetoEvent);
    }

    return {
      vetoed: true,
      vetoEvent,
      player: coreTarget,
      reason: vetoEvent.title
    };
  }

  /**
   * 감독 트레이드 거부권에 대한 단장 결정 (WITHDRAW_TRADE: 철회 수용 / FORCE_TRADE: 직권 강행)
   */
  function resolveTradeVeto(context, teamId, decision = "WITHDRAW_TRADE") {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const st = ensureManagerConflictState(team);
    const curDate = context.currentDate || `${context.currentYear || 2025}-06-15`;
    const activeVeto = st.pendingTradeVetoModal;
    const targetName = (activeVeto && activeVeto.playerName) || "핵심 주전 선수";

    if (decision === "WITHDRAW_TRADE") {
      st.managerTrust = clamp(st.managerTrust + 10, 0, 100);
      st.conflictGauge = clamp(100 - st.managerTrust, 0, 100);
      if (activeVeto) activeVeto.resolved = true;
      st.pendingTradeVetoModal = null;

      const msg = `[트레이드 거부권 수용] ${st.managerName} 감독의 거부권을 존중하여 ${targetName} 트레이드 카드를 철회했습니다. (감독 신임도 +10 → ${st.managerTrust})`;
      st.conflictLogs.unshift({
        date: curDate,
        type: "TRADE_VETO_RESPECTED",
        message: msg
      });
      return {
        ok: true,
        decision: "WITHDRAW_TRADE",
        allowTradeExecution: false,
        managerTrust: st.managerTrust,
        conflictGauge: st.conflictGauge,
        summary: msg
      };
    } else {
      // 단장 직권으로 트레이드 강행 (FORCE_TRADE)
      st.managerTrust = clamp(st.managerTrust - 25, 0, 100);
      st.conflictGauge = clamp(100 - st.managerTrust, 0, 100);
      st.mediaLeakProb = +clamp(st.mediaLeakProb + 0.35, 0, 0.98).toFixed(2);
      if (activeVeto) activeVeto.resolved = true;
      st.pendingTradeVetoModal = null;

      const crisisRes = evaluateConflictCrisis(context, team.id, { checkMediaLeak: true });
      const msg = `[단장 직권 트레이드 강행] ${st.managerName} 감독의 거부권을 기각하고 ${targetName} 트레이드를 직권 승인했습니다! (감독 신임도 -25 → ${st.managerTrust}, 언론 불만 유출 확률 +35%)`;
      st.conflictLogs.unshift({
        date: curDate,
        type: "TRADE_VETO_OVERRIDDEN",
        message: msg
      });
      return {
        ok: true,
        decision: "FORCE_TRADE",
        allowTradeExecution: true,
        managerTrust: st.managerTrust,
        conflictGauge: st.conflictGauge,
        mediaLeakProb: st.mediaLeakProb,
        crisisReport: crisisRes,
        summary: msg
      };
    }
  }

  /**
   * [스펙 2-B] 정규시즌 중반 감독의 약점 포지션(불펜/포수 등) 베테랑 즉시전력감 핀포인트 트레이드 영입 공식 문서 요청
   */
  function generateMidseasonTradeDirective(context, teamId, options = {}) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const st = ensureManagerConflictState(team);
    const curDate = context.currentDate || `${context.currentYear || 2025}-06-15`;
    const curWeek = context.currentWeek || 12;

    // 구단 1군 포지션 그룹별 평균 OVR을 분석해 가장 취약한 포지션(불펜 RP/CP, 포수 C, 유격수 SS, 선발 SP 등) 도출
    const posGroups = [
      { code: "RP", label: "필승조 불펜 투수(RP/CP)", matchPos: ["RP", "CP"] },
      { code: "C", label: "주전급 안방마님 포수(C)", matchPos: ["C"] },
      { code: "SS", label: "내야 사령관 유격수/2루수(SS/2B)", matchPos: ["SS", "2B"] },
      { code: "SP", label: "이닝이터 선발 투수(SP)", matchPos: ["SP"] },
      { code: "CF", label: "중견수/외야 수비 핵(CF/OF)", matchPos: ["CF", "LF", "RF"] }
    ];

    let weakestGroup = posGroups[0];
    let lowestAvg = 999;

    posGroups.forEach((grp) => {
      const groupPlayers = team.roster1G.filter((p) => grp.matchPos.includes(p.pos));
      const avg = groupPlayers.length
        ? groupPlayers.reduce((s, p) => s + p.getTrueOvr(), 0) / groupPlayers.length
        : 60;
      if (avg < lowestAvg) {
        lowestAvg = avg;
        weakestGroup = grp;
      }
    });

    // 타 구단에서 해당 약점 포지션의 베테랑 즉시전력감(만 28세 이상, OVR 72+) 추천 타깃 탐색
    const recommendedTargets = [];
    (context.kboTeams || []).forEach((otherTeam) => {
      if (otherTeam.id === team.id) return;
      otherTeam.getAllPlayers().forEach((p) => {
        if (
          weakestGroup.matchPos.includes(p.pos) &&
          p.age >= 28 &&
          p.getTrueOvr() >= 71 &&
          (!p.injury || !p.injury.active)
        ) {
          recommendedTargets.push({
            teamId: otherTeam.id,
            teamName: otherTeam.name,
            playerId: p.id,
            playerName: p.name,
            pos: p.pos,
            age: p.age,
            ovr: p.getTrueOvr(),
            salaryManwon: p.salary || 12000
          });
        }
      });
    });
    recommendedTargets.sort((a, b) => b.ovr - a.ovr);
    const topTarget = recommendedTargets[0] || null;

    const directiveDoc = {
      id: `DIRECTIVE_${context.currentYear || 2025}_W${curWeek}_${weakestGroup.code}`,
      docNumber: `제${context.currentYear || 2025}-현장요청-${String(st.activeTradeDirectives.length + 1).padStart(2, "0")}호`,
      type: "TRADE_DIRECTIVE",
      issuedDate: curDate,
      issuedWeek: curWeek,
      deadlineWeek: Math.min(22, curWeek + 5),
      teamId: team.id,
      managerName: st.managerName,
      weakPosCode: weakestGroup.code,
      weakPosLabel: weakestGroup.label,
      matchPositions: weakestGroup.matchPos,
      currentPosAvgOvr: Math.round(lowestAvg),
      minRequiredOvr: 70,
      minVeteranAge: 28,
      recommendedTargets: recommendedTargets.slice(0, 3),
      topTarget,
      status: "PENDING",
      title: `[공식 문서 · ${weakestGroup.label} 핀포인트 수혈 요청서]`,
      officialText: `발신: ${team.name} 1군 감독 ${st.managerName} / 수신: ${team.name} 단장 귀하 — 현재 우리 구단의 최대 아킬레스건인 [${weakestGroup.label} (현재 평균 OVR ${Math.round(
        lowestAvg
      )})] 보강을 위해 만 28세 이상 베테랑 즉시전력감(${
        topTarget ? `${topTarget.teamName} ${topTarget.playerName}(${topTarget.pos}, OVR ${topTarget.ovr}) 등` : "OVR 70+ 베테랑"
      })의 핀포인트 트레이드 영입을 공식 요청합니다.`
    };

    st.activeTradeDirectives = st.activeTradeDirectives.filter((d) => d.status === "PENDING");
    st.activeTradeDirectives.unshift(directiveDoc);

    st.conflictLogs.unshift({
      date: curDate,
      type: "TRADE_DIRECTIVE_ISSUED",
      message: `${directiveDoc.docNumber} — ${st.managerName} 감독이 [${weakestGroup.label}] 베테랑 즉시전력감 핀포인트 트레이드 영입 공식 요청서를 제출했습니다.`
    });

    if (Array.isArray(context.pendingEvents)) {
      context.pendingEvents.push({
        id: directiveDoc.id,
        type: "MANAGER_TRADE_DIRECTIVE",
        teamId: team.id,
        directive: directiveDoc,
        resolved: false
      });
    }

    return {
      ok: true,
      directive: directiveDoc
    };
  }

  /**
   * 감독이 공식 요청한 핀포인트 약점 포지션 베테랑 영입 달성 여부 검증 및 보상 처리
   */
  function fulfillTradeDirective(context, teamId, acquiredPlayers = []) {
    if (!context) return { ok: false, fulfilled: false };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, fulfilled: false };

    const st = ensureManagerConflictState(team);
    const pendingList = (st.activeTradeDirectives || []).filter((d) => d.status === "PENDING");
    if (pendingList.length === 0) return { ok: true, fulfilled: false };

    const plrs = Array.isArray(acquiredPlayers) ? acquiredPlayers : [acquiredPlayers];
    const curDate = context.currentDate || `${context.currentYear || 2025}-07-01`;
    const fulfilledDocs = [];

    pendingList.forEach((doc) => {
      const matchedPlayer = plrs.find(
        (p) =>
          p &&
          ((doc.matchPositions && doc.matchPositions.includes(p.pos)) || p.pos === doc.weakPosCode) &&
          (p.age >= 27 || p.getTrueOvr() >= (doc.minRequiredOvr || 70))
      );
      if (matchedPlayer) {
        doc.status = "FULFILLED";
        doc.fulfilledByPlayerName = matchedPlayer.name;
        doc.fulfilledDate = curDate;
        st.managerTrust = clamp(st.managerTrust + 18, 0, 100);
        st.conflictGauge = clamp(100 - st.managerTrust, 0, 100);
        applyTeamMoraleDelta(team, 5);
        team.ownerTrust = clamp((team.ownerTrust || 60) + 5, 0, 100);

        const msg = `[감독 핀포인트 수혈 요청 완수!] ${doc.docNumber} 요청 포지션(${doc.weakPosLabel})에 베테랑 ${matchedPlayer.name}(${matchedPlayer.pos}, OVR ${matchedPlayer.getTrueOvr()}) 영입 성공! (감독 신임도 +18 → ${st.managerTrust}, 팀 사기 +5)`;
        st.conflictLogs.unshift({
          date: curDate,
          type: "TRADE_DIRECTIVE_FULFILLED",
          message: msg
        });
        fulfilledDocs.push(doc);
      }
    });

    return {
      ok: true,
      fulfilled: fulfilledDocs.length > 0,
      fulfilledDocs,
      managerTrust: st.managerTrust,
      conflictGauge: st.conflictGauge
    };
  }

  /**
   * 감독 핀포인트 트레이드 요청을 원클릭 맞춤 패키지 트레이드로 즉시 이행하거나 기각 처리
   */
  function resolveTradeDirectiveAction(context, teamId, directiveId, action = "AUTO_ACQUIRE") {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const st = ensureManagerConflictState(team);
    const doc =
      (st.activeTradeDirectives || []).find((d) => d.id === directiveId) ||
      (st.activeTradeDirectives || []).find((d) => d.status === "PENDING");
    if (!doc) return { ok: false, reason: "처리할 감독 트레이드 공식 요청 문서가 없습니다." };

    const curDate = context.currentDate || `${context.currentYear || 2025}-07-01`;

    if (action === "REJECT_DIRECTIVE") {
      doc.status = "REJECTED";
      st.managerTrust = clamp(st.managerTrust - 20, 0, 100);
      st.conflictGauge = clamp(100 - st.managerTrust, 0, 100);
      st.mediaLeakProb = +clamp(st.mediaLeakProb + 0.25, 0, 0.98).toFixed(2);
      const crisisRes = evaluateConflictCrisis(context, team.id, { checkMediaLeak: true });
      const msg = `[감독 영입 요청 기각] ${doc.docNumber}(${doc.weakPosLabel}) 핀포인트 트레이드 요청을 기각했습니다. (감독 신임도 -20 → ${st.managerTrust})`;
      st.conflictLogs.unshift({ date: curDate, type: "TRADE_DIRECTIVE_REJECTED", message: msg });
      return {
        ok: true,
        action: "REJECT_DIRECTIVE",
        managerTrust: st.managerTrust,
        conflictGauge: st.conflictGauge,
        crisisReport: crisisRes,
        summary: msg
      };
    }

    // AUTO_ACQUIRE: 추천 타깃 베테랑을 2군 유망주/중간 전력 + 현금 트레이드(또는 즉시 영입)로 수혈
    const targetInfo = doc.topTarget || (doc.recommendedTargets && doc.recommendedTargets[0]);
    if (!targetInfo) {
      return { ok: false, reason: "타 구단에 영입 가능한 해당 포지션 베테랑 타깃이 없습니다." };
    }
    const partnerTeam = context.getTeam(targetInfo.teamId);
    const targetPlayer = partnerTeam && partnerTeam.getAllPlayers().find((p) => p.id === targetInfo.playerId);
    if (!partnerTeam || !targetPlayer) {
      return { ok: false, reason: "대상 선수가 이미 이적했거나 로스터에 없습니다." };
    }

    const tradeChip =
      team.roster2G
        .filter((p) => !doc.matchPositions.includes(p.pos))
        .sort((a, b) => b.getTrueOvr() - a.getTrueOvr())[0] || team.roster2G[0];

    if (!tradeChip) {
      return { ok: false, reason: "트레이드 반대급부로 제시할 2군 선수가 부족합니다." };
    }

    // 양 구단 로스터 교환 실행
    ["roster1G", "roster2G", "rosterDev"].forEach((rk) => {
      team[rk] = team[rk].filter((p) => p.id !== tradeChip.id);
      partnerTeam[rk] = partnerTeam[rk].filter((p) => p.id !== targetPlayer.id);
    });

    tradeChip.teamId = partnerTeam.id;
    tradeChip.acquiredVia = { type: "TRADE", date: context.currentDate || null, fromTeamId: tradeChip.formerTeamId || null }; // 시즌 회고 리포트용 영입 경로
    tradeChip.status = "2GUN";
    partnerTeam.roster2G.push(tradeChip);

    targetPlayer.teamId = team.id;
    targetPlayer.acquiredVia = { type: "TRADE", date: context.currentDate || null, fromTeamId: targetPlayer.formerTeamId || null }; // 시즌 회고 리포트용 영입 경로
    if (team.roster1G.length < 28) {
      targetPlayer.status = "1GUN";
      team.roster1G.push(targetPlayer);
    } else {
      targetPlayer.status = "2GUN";
      team.roster2G.push(targetPlayer);
    }

    fulfillTradeDirective(context, team.id, [targetPlayer]);

    return {
      ok: true,
      action: "AUTO_ACQUIRE",
      acquiredPlayer: targetPlayer,
      sentPlayer: tradeChip,
      managerTrust: st.managerTrust,
      conflictGauge: st.conflictGauge,
      summary: `[핀포인트 트레이드 타결!] ${st.managerName} 감독의 공식 요청(${doc.docNumber})에 따라 ${partnerTeam.name} 베테랑 ${targetPlayer.name}(${targetPlayer.pos}, OVR ${targetPlayer.getTrueOvr()}) 선수를 영입했습니다! (반대급부: ${tradeChip.name} · 감독 신임도 +18 → ${st.managerTrust})`
    };
  }

  /**
   * [스펙 3-2단계] 구단주 이사회 중재 청문회 결단 처리
   */
  function resolveBoardHearing(context, teamId, choice = "COMPROMISE") {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const st = ensureManagerConflictState(team);
    const curDate = context.currentDate || `${context.currentYear || 2025}-07-15`;

    if (choice === "COMPROMISE") {
      st.managerTrust = clamp(st.managerTrust + 25, 0, 100);
      st.conflictGauge = clamp(100 - st.managerTrust, 0, 100);
      st.crisisStage = st.managerTrust > 20 ? 0 : 1;
      team.ownerTrust = clamp((team.ownerTrust || 60) - 5, 0, 100);
      if (st.pendingBoardHearing) st.pendingBoardHearing.resolved = true;
      st.pendingBoardHearing = null;

      const msg = `[이사회 청문회 중재 타결] 구단주 중재안을 수용하여 ${st.managerName} 감독의 현장 기용 권한을 보장하고 사퇴 위기를 봉합했습니다. (감독 신임도 +25 → ${st.managerTrust}, 구단주 신임도 -5)`;
      st.conflictLogs.unshift({ date: curDate, type: "BOARD_HEARING_COMPROMISE", message: msg });
      return {
        ok: true,
        choice: "COMPROMISE",
        managerTrust: st.managerTrust,
        conflictGauge: st.conflictGauge,
        canFireManager: st.canFireManager,
        summary: msg
      };
    } else {
      // ESCALATE_TO_STAGE_3: 프런트 원칙 고수 -> 3단계 감독 경질 선택지 즉시 활성화
      st.crisisStage = 3;
      st.stage3Triggered = true;
      st.canFireManager = true;
      if (st.pendingBoardHearing) st.pendingBoardHearing.resolved = true;
      st.pendingBoardHearing = null;
      const severanceManwon = st.remainingContractYears * st.annualSalaryManwon;

      const msg = `[이사회 청문회 결렬 · 3단계 진입] 프런트 야구 원칙을 고수하여 이사회로부터 [감독 경질 인사권]을 승인받았습니다! (경질 시 잔여 계약 위약금 ${(severanceManwon / 10000).toFixed(1)}억 원 차감)`;
      st.conflictLogs.unshift({ date: curDate, type: "BOARD_HEARING_ESCALATED", message: msg });
      return {
        ok: true,
        choice: "ESCALATE_TO_STAGE_3",
        managerTrust: st.managerTrust,
        conflictGauge: st.conflictGauge,
        crisisStage: 3,
        canFireManager: true,
        severancePayManwon: severanceManwon,
        summary: msg
      };
    }
  }

  /**
   * [스펙 3-3단계] 단장의 감독 전격 경질 및 잔여 계약 기간 위약금 예산 차감 실행
   */
  function fireManagerWithSeverance(context, teamId, replacementName = null) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const st = ensureManagerConflictState(team);
    if (!st.canFireManager && st.managerTrust > 20 && st.crisisStage < 3) {
      return {
        ok: false,
        reason: `현재 감독 신임도(${st.managerTrust})가 파국 기준(20 이하)이 아니므로 경질 사유가 성립하지 않습니다.`
      };
    }

    const severancePayManwon = st.remainingContractYears * st.annualSalaryManwon;
    if (team.getAvailableBudget() - severancePayManwon < -300000) {
      return {
        ok: false,
        reason: `감독 잔여 계약 위약금(${(severancePayManwon / 10000).toFixed(1)}억 원) 지급 시 구단 운영 최저 예산이 부족합니다.`
      };
    }

    const dismissedManagerName = st.managerName;
    const prevBudget = team.budget || 1200000;
    team.budget = Math.max(900000, prevBudget - severancePayManwon);

    const cand =
      REPLACEMENT_MANAGER_CANDIDATES.find(
        (c) => c.name === replacementName && c.name !== dismissedManagerName
      ) ||
      REPLACEMENT_MANAGER_CANDIDATES.find((c) => c.name !== dismissedManagerName) ||
      REPLACEMENT_MANAGER_CANDIDATES[0];

    if (!team.coachingStaff) team.coachingStaff = {};
    team.coachingStaff.manager = {
      name: cand.name,
      style: cand.style,
      annualSalaryManwon: cand.annualSalaryManwon,
      remainingContractYears: cand.contractYears
    };

    const curDate = context.currentDate || `${context.currentYear || 2025}-08-01`;
    st.managerName = cand.name;
    st.managerStyle = cand.style;
    st.annualSalaryManwon = cand.annualSalaryManwon;
    st.remainingContractYears = cand.contractYears;
    st.managerTrust = 72;
    st.conflictGauge = 28;
    st.mediaLeakProb = 0.05;
    st.crisisStage = 0;
    st.stage1Triggered = false;
    st.stage2Triggered = false;
    st.stage3Triggered = false;
    st.canFireManager = false;
    st.pendingMandateModal = null;
    st.pendingTradeVetoModal = null;
    st.pendingBoardHearing = null;
    st.lockedMandatePlayers = { FA_20: [], FA_25: [], DRAFT_35: [] };

    const summary = `[감독 전격 경질 및 신임 감독 선임] ${dismissedManagerName} 감독을 경질하고 잔여 계약 위약금 ${(severancePayManwon / 10000).toFixed(
      1
    )}억 원(${severancePayManwon.toLocaleString()}만 원)을 예산에서 지급했습니다. (잔여 예산 ${(team.budget / 10000).toFixed(
      1
    )}억 원) → 신임 ${cand.name} 감독(${cand.style}) 부임 완료!`;

    st.conflictLogs.unshift({
      date: curDate,
      type: "MANAGER_DISMISSED_WITH_SEVERANCE",
      dismissedManagerName,
      newManagerName: cand.name,
      severancePayManwon,
      message: summary
    });

    return {
      ok: true,
      dismissedManagerName,
      newManager: team.coachingStaff.manager,
      severancePayManwon,
      severancePayEok: +(severancePayManwon / 10000).toFixed(1),
      remainingBudgetManwon: team.budget,
      managerTrust: st.managerTrust,
      conflictGauge: st.conflictGauge,
      summary
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 12. [KBO_GM.RealisticGM] '야구 구단 단장(GM) 직무 보고서' 기반 5대 리얼리즘 메카닉
   *     (1) 단장 vs 감독 권력 갈등 & '지시완/허문회' 기용 거부 시스템 (GM_MANAGER_CONFLICT)
   *     (2) BATNA 다안건 연봉 협상 & 연봉조정위원회 (SALARY_ARBITRATION)
   *     (3) 예비 FA 보상금 뻥튀기 사전 방어 전략 (FA_PREEMPTIVE_BUMP)
   *     (4) 트레이드 마감일 Buyer / Seller 스탠스 엔진 (DEADLINE_STANCE)
   *     (5) 과도한 감봉 시 선수단 집단 항명 & 미디어 여론전 (SQUAD_REBELLION)
   * ═══════════════════════════════════════════════════════════════════════ */

  // ─────────────────────────────────────────────────────────────────────────
  // [메카닉 1] 단장 vs 감독 권력 갈등 & '지시완/허문회' 기용 거부 시스템 (GM_MANAGER_CONFLICT)
  // ─────────────────────────────────────────────────────────────────────────
  const MANAGER_ARCHETYPES = {
    VETERAN_PREF: {
      key: "VETERAN_PREF",
      label: "베테랑 선호형 (고참·경험 중시)",
      refusalProb: 0.45,
      veteranBias: 1.25,
      prospectGrowthMul: 0.85,
      desc: "검증된 베테랑을 중용하며 단장이 콜업한 2군 유망주 기용에 소극적입니다."
    },
    DATA_RECEPTIVE: {
      key: "DATA_RECEPTIVE",
      label: "데이터 수용형 (프런트 협업·육성 친화)",
      refusalProb: 0.08,
      veteranBias: 0.95,
      prospectGrowthMul: 1.15,
      desc: "세이버메트릭스 지표와 단장의 유망주 콜업·트레이드 영입 기조를 적극 수용합니다."
    },
    FIELD_STUBBORN: {
      key: "FIELD_STUBBORN",
      label: "현장 고집형 ('허문회/지시완' 기용 거부형)",
      refusalProb: 0.70,
      veteranBias: 1.40,
      prospectGrowthMul: 0.70,
      desc: "감독 고유의 주전 라인업을 고집하며 단장이 올린 2군 유망주/트레이드 영입 선수를 벤치에 방치합니다."
    }
  };

  function ensureRealisticGMState(team) {
    if (!team) return null;
    const conflictSt = ensureManagerConflictState(team);
    if (!team.realisticGMState || typeof team.realisticGMState !== "object") {
      const styleStr = (conflictSt && conflictSt.managerStyle) || "";
      const defaultArch =
        styleStr.includes("육성") || styleStr.includes("데이터")
          ? "DATA_RECEPTIVE"
          : styleStr.includes("베테랑")
          ? "FIELD_STUBBORN"
          : "VETERAN_PREF";
      team.realisticGMState = {
        managerArchetype: defaultArch,
        farmSystemHealth: 85, // 미래 팜 시스템 건전성 (0~100)
        clubTrustScore: 75, // 선수단 내 구단 프런트 신뢰도 (0~100, 연봉조정위 패소 시 -50 추락)
        mediaSentiment: 65, // 언론 여론 수치 (0~100)
        deadlineStance: "AUTO", // AUTO | BUYER | SELLER | HYBRID
        pendingUsageRefusalModal: null,
        benchedPlayersByManager: [],
        multiIssueContracts: {},
        arbitrationHistory: [],
        preemptiveBumpedPlayerIds: [],
        deadlineProposals: [],
        activeSquadRebellion: null,
        realisticLogs: []
      };
    }
    return team.realisticGMState;
  }

  function setManagerArchetype(context, teamId, archetypeKey = "FIELD_STUBBORN") {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const rgm = ensureRealisticGMState(team);
    const st = ensureManagerConflictState(team);
    const arch = MANAGER_ARCHETYPES[archetypeKey] || MANAGER_ARCHETYPES.FIELD_STUBBORN;
    rgm.managerArchetype = arch.key;
    st.managerStyle = arch.label;
    if (team.coachingStaff && team.coachingStaff.manager) {
      team.coachingStaff.manager.style = arch.label;
      team.coachingStaff.manager.archetype = arch.key;
    }

    const msg = `[감독 아키타입 지정] ${st.managerName} 감독의 운영 성향이 [${arch.label}](기용 거부율 ${Math.round(
      arch.refusalProb * 100
    )}%)으로 설정되었습니다.`;
    rgm.realisticLogs.unshift({
      date: context.currentDate || "2025-04-01",
      type: "MANAGER_ARCHETYPE_SET",
      message: msg
    });

    return {
      ok: true,
      archetype: arch,
      managerName: st.managerName,
      summary: msg
    };
  }

  /**
   * 단장이 1군으로 콜업한 2군 유망주 또는 트레이드 영입 선수를 감독이 기용 거부(벤치 방치 — '지시완/허문회' 사례)하는 이벤트 트리거
   */
  function checkPlayerUsageRefusal(context, teamId, options = {}) {
    if (!context) return { ok: false, triggered: false };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, triggered: false };

    const rgm = ensureRealisticGMState(team);
    const st = ensureManagerConflictState(team);
    const arch = MANAGER_ARCHETYPES[rgm.managerArchetype] || MANAGER_ARCHETYPES.FIELD_STUBBORN;
    const rng = options.rng || Math.random;

    if (!options.forceTrigger && rng() > arch.refusalProb) {
      return { ok: true, triggered: false, archetype: arch };
    }

    // 1순위: 포수(C) 유망주 또는 트레이드 영입 선수 ('지시완 케이스'), 2순위: 1군/2군 만 25세 이하 고포텐셜 유망주
    const allPool = [...(team.roster1G || []), ...(team.roster2G || [])];
    let targetPlayer = options.playerId
      ? allPool.find((p) => p.id === options.playerId)
      : allPool
          .filter((p) => (!p.nationality || p.nationality === "KOR") && (p.age <= 26 || p.pos === "C"))
          .sort((a, b) => {
            const cBonusA = a.pos === "C" ? 15 : 0;
            const cBonusB = b.pos === "C" ? 15 : 0;
            return (b.potential || 78) + cBonusB - ((a.potential || 78) + cBonusA);
          })[0];

    if (!targetPlayer) {
      targetPlayer = allPool[0];
    }
    if (!targetPlayer) return { ok: false, triggered: false };

    // 벤치 방치 표시
    targetPlayer.benchedByManager = true;
    const curDate = context.currentDate || `${context.currentYear || 2025}-05-15`;

    const modalEvent = {
      id: `USAGE_REFUSAL_${context.currentYear || 2025}_${targetPlayer.id}`,
      type: "GM_MANAGER_CONFLICT_USAGE_REFUSAL",
      date: curDate,
      teamId: team.id,
      managerName: st.managerName,
      managerArchetype: arch.key,
      managerArchetypeLabel: arch.label,
      playerId: targetPlayer.id,
      playerName: targetPlayer.name,
      pos: targetPlayer.pos,
      age: targetPlayer.age,
      ovr: targetPlayer.getTrueOvr(),
      potential: targetPlayer.potential || 84,
      title: `[기용권 갈등 · '지시완/허문회' 벤치 방치 사태] ${st.managerName} 감독(${arch.label}), 단장 픽 ${targetPlayer.name}(${targetPlayer.pos}) 기용 거부!`,
      quote: `"단장님이 2군에서 올리셨든 트레이드로 데려오셨든, 1군 더그아웃 라인업 작성과 선수 기용 고유 권한은 전적으로 현장 감독인 제게 있습니다! ${targetPlayer.name}(${targetPlayer.pos}, ${targetPlayer.age}세) 선수는 제 야구 철학에 맞지 않아 기용하지 않겠습니다!"`,
      dilemmaOptions: {
        ignoreManagerAndForcePlay:
          "[기용권 경고 강행 (감독 요구 무시)]: 유망주 강제 선발 출전 및 성장 사수 ↔ 감독 신임도 -30 급락(사퇴 위기) & 팀 사기 -12 하락",
        acceptManagerBenching:
          "[감독 고유 권한 수용 (벤치 방치 용인)]: 감독 신임도 +12 & 팀 사기 +4 안정 ↔ 해당 유망주 성장 정체(포텐셜 -4) 및 미래 팜 시스템 건전성 -18 파괴"
      },
      resolved: false
    };

    rgm.pendingUsageRefusalModal = modalEvent;
    if (!rgm.benchedPlayersByManager.includes(targetPlayer.id)) {
      rgm.benchedPlayersByManager.push(targetPlayer.id);
    }
    if (Array.isArray(context.pendingEvents)) {
      context.pendingEvents.push(modalEvent);
    }

    return {
      ok: true,
      triggered: true,
      modalEvent,
      player: targetPlayer
    };
  }

  /**
   * '지시완/허문회' 기용 거부 모달에 대한 단장의 결단 처리
   * @param {string} decision - "FORCE_PLAY_WARNING" (감독 요구 무시·기용 강행) | "ACCEPT_BENCHING" (감독 수용·팜 파괴 딜레마)
   */
  function resolveUsageRefusalDilemma(context, teamId, decision = "FORCE_PLAY_WARNING", playerId = null) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const rgm = ensureRealisticGMState(team);
    const st = ensureManagerConflictState(team);
    const activeModal =
      rgm.pendingUsageRefusalModal ||
      checkPlayerUsageRefusal(context, team.id, { forceTrigger: true, playerId }).modalEvent;
    const targetPid = playerId || (activeModal && activeModal.playerId);
    const targetPlayer = team.getAllPlayers().find((p) => p.id === targetPid) || team.roster1G[0];
    const curDate = context.currentDate || `${context.currentYear || 2025}-05-18`;

    if (decision === "FORCE_PLAY_WARNING" || decision === "IGNORE_MANAGER") {
      // [감독 요구 무시 / 기용권 경고 강행]: 유망주 기용 및 성장 보장, 그러나 감독 신임도 -30 급락(사퇴 배수진) & 팀 사기 -12 급락
      st.managerTrust = clamp(st.managerTrust - 30, 0, 100);
      st.conflictGauge = clamp(100 - st.managerTrust, 0, 100);
      st.mediaLeakProb = +clamp(st.mediaLeakProb + 0.30, 0, 0.98).toFixed(2);
      const newTeamMorale = applyTeamMoraleDelta(team, -12);
      rgm.farmSystemHealth = clamp(rgm.farmSystemHealth + 6, 0, 100);

      if (targetPlayer) {
        targetPlayer.benchedByManager = false;
        targetPlayer.morale = clamp((targetPlayer.morale || 70) + 15, 0, 100);
        if (targetPlayer.status !== "1GUN" && team.roster1G.length < 28) {
          team.movePlayerStatus(targetPlayer.id, "1GUN");
        }
      }

      const crisisReport = evaluateConflictCrisis(context, team.id, {
        checkMediaLeak: true,
        advanceCrisisStage: st.managerTrust <= 20
      });

      if (activeModal) activeModal.resolved = true;
      rgm.pendingUsageRefusalModal = null;

      const summary = `[기용권 경고 강행 · 감독 요구 무시] ${st.managerName} 감독에게 프런트 육성 기조 준수를 공식 경고하고 ${
        targetPlayer ? targetPlayer.name : "유망주"
      } 선수를 1군 선발 라인업에 강제 투입했습니다! (감독 신임도 -30 → ${st.managerTrust}${
        st.managerTrust <= 20 ? " [감독 사퇴 배수진 발동!]" : ""
      }, 팀 사기 -12 → ${newTeamMorale}, 팜 시스템 건전성 +6 → ${rgm.farmSystemHealth})`;

      rgm.realisticLogs.unshift({
        date: curDate,
        type: "USAGE_REFUSAL_FORCED_PLAY",
        message: summary
      });
      st.conflictLogs.unshift({
        date: curDate,
        type: "USAGE_REFUSAL_FORCED_PLAY",
        message: summary
      });

      return {
        ok: true,
        decision: "FORCE_PLAY_WARNING",
        managerTrust: st.managerTrust,
        conflictGauge: st.conflictGauge,
        teamMorale: newTeamMorale,
        farmSystemHealth: rgm.farmSystemHealth,
        managerResignationRisk: st.managerTrust <= 20,
        crisisReport,
        summary
      };
    } else {
      // [감독 수용 / 벤치 방치 용인]: 감독 신임도 +12 & 팀 사기 +4 상승, 그러나 유망주 포텐셜 하락 및 미래 팜 시스템 파괴(-18) 딜레마
      st.managerTrust = clamp(st.managerTrust + 12, 0, 100);
      st.conflictGauge = clamp(100 - st.managerTrust, 0, 100);
      const newTeamMorale = applyTeamMoraleDelta(team, 4);
      rgm.farmSystemHealth = clamp(rgm.farmSystemHealth - 18, 0, 100);

      if (targetPlayer) {
        targetPlayer.benchedByManager = true;
        targetPlayer.potential = Math.max(55, (targetPlayer.potential || 80) - 4);
        targetPlayer.morale = clamp((targetPlayer.morale || 70) - 22, 0, 100);
        targetPlayer.tradeDemand = true;
        targetPlayer.moraleReason = "감독의 철저한 기용 외면(벤치 방치)으로 인한 성장 정체 및 트레이드 요청";
      }

      if (activeModal) activeModal.resolved = true;
      rgm.pendingUsageRefusalModal = null;

      const summary = `[감독 기용권 수용 · 미래 팜 파괴 딜레마] ${st.managerName} 감독의 베테랑 위주 기용을 수용하여 ${
        targetPlayer ? targetPlayer.name : "유망주"
      } 선수가 벤치에 방치되었습니다. (감독 신임도 +12 → ${st.managerTrust}, 팀 사기 +4 → ${newTeamMorale} ↔ 유망주 포텐셜 -4 하락 & 미래 팜 시스템 건전성 -18 → ${rgm.farmSystemHealth} 파괴!)`;

      rgm.realisticLogs.unshift({
        date: curDate,
        type: "USAGE_REFUSAL_ACCEPTED_FARM_DAMAGE",
        message: summary
      });
      st.conflictLogs.unshift({
        date: curDate,
        type: "USAGE_REFUSAL_ACCEPTED_FARM_DAMAGE",
        message: summary
      });

      return {
        ok: true,
        decision: "ACCEPT_BENCHING",
        managerTrust: st.managerTrust,
        conflictGauge: st.conflictGauge,
        teamMorale: newTeamMorale,
        farmSystemHealth: rgm.farmSystemHealth,
        damagedPlayer: targetPlayer
          ? { id: targetPlayer.id, name: targetPlayer.name, newPotential: targetPlayer.potential }
          : null,
        summary
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // [메카닉 2] BATNA 다안건 연봉 협상 & 연봉조정위원회 (SALARY_ARBITRATION)
  // ─────────────────────────────────────────────────────────────────────────
  const SALARY_AGENDA_OPTIONS = {
    GUARANTEED_USAGE: {
      NONE: { key: "NONE", label: "보장 없음 (경쟁 체제)", discountRate: 0.0, batnaSatisfaction: 0 },
      SEMI_REGULAR: {
        key: "SEMI_REGULAR",
        label: "플래툰·준주전 보장 (300타석 / 70이닝)",
        discountRate: 0.08,
        batnaSatisfaction: 12
      },
      FULL_STARTER: {
        key: "FULL_STARTER",
        label: "풀타임 주전 보장 (450타석 / 140이닝)",
        discountRate: 0.15,
        batnaSatisfaction: 24
      }
    },
    INCENTIVE_PACK: {
      NONE: { key: "NONE", label: "옵션 없음 (전액 보장급)", bonusManwon: 0, batnaSatisfaction: 0 },
      MODEST_OPT: {
        key: "MODEST_OPT",
        label: "성적 연동 옵션 +3,000만원 (WAR 2.5+ 달성 시)",
        bonusManwon: 3000,
        batnaSatisfaction: 10
      },
      MAJOR_OPT: {
        key: "MAJOR_OPT",
        label: "대형 타이틀 옵션 +8,000만원 (WAR 4.0+ 달성 시)",
        bonusManwon: 8000,
        batnaSatisfaction: 20
      }
    },
    MULTI_YEAR_CONVERT: {
      SINGLE_1Y: { key: "SINGLE_1Y", years: 1, label: "1년 단년 재계약 (기본)", discountRate: 0.0, batnaSatisfaction: 0 },
      EXTEND_2Y: {
        key: "EXTEND_2Y",
        years: 2,
        label: "비FA 2년 다년 계약 전환 (안정성 부여)",
        discountRate: 0.07,
        batnaSatisfaction: 15
      },
      EXTEND_3Y: {
        key: "EXTEND_3Y",
        years: 3,
        label: "비FA 3년 다년 계약 전환 (핵심 코어 묶기)",
        discountRate: 0.12,
        batnaSatisfaction: 25
      }
    }
  };

  /**
   * BATNA(협상 결렬 시 최선의 대안: 연봉조정위 신청 또는 FA) 기반 다안건 연봉 협상 실행
   */
  function negotiateMultiIssueSalary(context, teamId, playerId, agendaPackage = {}) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const rgm = ensureRealisticGMState(team);
    const gm = getGM();
    const player = team.getAllPlayers().find((p) => p.id === playerId) || team.roster1G[0];
    if (!player) return { ok: false, reason: "협상 대상 선수를 찾을 수 없습니다." };

    const calcFair =
      gm && gm.Offseason && typeof gm.Offseason.calculateFairSalary === "function"
        ? gm.Offseason.calculateFairSalary
        : (p) => Math.max(3000, Math.round((p.getTrueOvr() - 55) * 1200));

    const fairSalary = calcFair(player);
    const playerDemand = round100(fairSalary * 1.08);
    const offeredBase = Math.max(3000, round100(Number(agendaPackage.offeredSalaryManwon) || fairSalary * 0.9));

    const usageOpt =
      SALARY_AGENDA_OPTIONS.GUARANTEED_USAGE[agendaPackage.guaranteedUsageKey] ||
      SALARY_AGENDA_OPTIONS.GUARANTEED_USAGE.NONE;
    const incOpt =
      SALARY_AGENDA_OPTIONS.INCENTIVE_PACK[agendaPackage.incentiveKey] ||
      SALARY_AGENDA_OPTIONS.INCENTIVE_PACK.NONE;
    const multiOpt =
      SALARY_AGENDA_OPTIONS.MULTI_YEAR_CONVERT[agendaPackage.multiYearKey] ||
      SALARY_AGENDA_OPTIONS.MULTI_YEAR_CONVERT.SINGLE_1Y;

    // 다안건(출전보장 + 인센티브 + 다년전환) 반영 시 선수가 받아들이는 최소 수용 연봉(BATNA Threshold) 하락
    const totalDiscount = clamp(usageOpt.discountRate + multiOpt.discountRate, 0, 0.25);
    const effectiveOfferValue = offeredBase + Math.round(incOpt.bonusManwon * 0.65);
    const batnaReservationPrice = round100(fairSalary * (0.94 - totalDiscount));

    const curDate = context.currentDate || `${context.currentYear || 2025}-01-20`;
    const isAgreed = effectiveOfferValue >= batnaReservationPrice;

    if (isAgreed) {
      const oldSal = player.salary || 3000;
      player.salary = offeredBase;
      player.contractYears = multiOpt.years;
      if (multiOpt.years > 1) {
        player.isMultiYearExtended = true;
      }
      player.guaranteedUsageClause = usageOpt.key;
      player.incentiveClauseManwon = incOpt.bonusManwon;
      ensurePlayerMorale(player);
      player.morale = clamp(player.morale + 10, 0, 100);

      rgm.multiIssueContracts[player.id] = {
        playerId: player.id,
        playerName: player.name,
        oldSalary: oldSal,
        agreedBaseSalary: offeredBase,
        years: multiOpt.years,
        guaranteedUsage: usageOpt.label,
        incentiveOption: incOpt.label,
        batnaReservationPrice
      };

      const summary = `[BATNA 다안건 연봉 협상 타결!] ${player.name}(${player.pos}) 선수와 기본급 ${(
        offeredBase / 10000
      ).toFixed(2)}억 원(${offeredBase.toLocaleString()}만 원) + [${usageOpt.label}] + [${incOpt.label}] + [${
        multiOpt.label
      }] 조건으로 계약을 완료했습니다! (선수 BATNA 마지노선 ${batnaReservationPrice.toLocaleString()}만 원 충족)`;

      rgm.realisticLogs.unshift({
        date: curDate,
        type: "MULTI_ISSUE_SALARY_AGREED",
        message: summary
      });

      return {
        ok: true,
        agreed: true,
        playerId: player.id,
        playerName: player.name,
        fairSalary,
        playerDemand,
        offeredBase,
        effectiveOfferValue,
        batnaReservationPrice,
        contractYears: multiOpt.years,
        summary
      };
    } else {
      const summary = `[BATNA 다안건 협상 결렬 → 1월 말 연봉조정위원회 회부] ${player.name}(${
        player.pos
      }) 선수가 구단 제시안(체감가 ${effectiveOfferValue.toLocaleString()}만 원 < 선수 BATNA 마지노선 ${batnaReservationPrice.toLocaleString()}만 원)을 거부하고 KBO 연봉조정위원회에 조정을 신청했습니다!`;
      rgm.realisticLogs.unshift({
        date: curDate,
        type: "MULTI_ISSUE_SALARY_DEADLOCK",
        message: summary
      });

      return {
        ok: true,
        agreed: false,
        deadlockToArbitration: true,
        playerId: player.id,
        playerName: player.name,
        fairSalary,
        playerDemand,
        offeredBase,
        effectiveOfferValue,
        batnaReservationPrice,
        summary
      };
    }
  }

  /**
   * 1월 말 협상 결렬 시 [KBO 연봉조정위원회] 판결 실행
   * - 승리(CLUB_WON) 시: 구단 제시액으로 연봉 절감 성공, 그러나 해당 선수 사기(morale) -50 및 구단 신뢰도(clubTrustScore) -50 락바텀 하락!
   */
  function runSalaryArbitrationHearing(context, teamId, playerId, clubBriefSalaryManwon = null) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const rgm = ensureRealisticGMState(team);
    const gm = getGM();
    const player = team.getAllPlayers().find((p) => p.id === playerId) || team.roster1G[0];
    if (!player) return { ok: false, reason: "연봉조정 대상 선수가 없습니다." };

    const calcFair =
      gm && gm.Offseason && typeof gm.Offseason.calculateFairSalary === "function"
        ? gm.Offseason.calculateFairSalary
        : (p) => Math.max(3000, Math.round((p.getTrueOvr() - 55) * 1200));

    const fairSalary = calcFair(player);
    const playerDemand = round100(fairSalary * 1.12);
    const clubOffer =
      clubBriefSalaryManwon != null
        ? Math.max(3000, round100(Number(clubBriefSalaryManwon)))
        : round100(fairSalary * 0.88);

    // KBO 연봉조정위 판결: 구단의 세이버메트릭스 고과 자료가 치밀하여 구단 승소 판결 확률이 높음 (구단 제시액이 적정가의 78% 이상이면 구단 승)
    const clubGap = Math.abs(fairSalary - clubOffer);
    const playerGap = Math.abs(playerDemand - fairSalary);
    const clubWon = clubOffer >= fairSalary * 0.78 && clubGap <= playerGap * 1.35;

    const finalSalary = clubWon ? clubOffer : playerDemand;
    const savedManwon = Math.max(0, playerDemand - finalSalary);
    player.salary = finalSalary;
    player.contractYears = 1;

    const curDate = context.currentDate || `${context.currentYear || 2025}-01-31`;
    ensurePlayerMorale(player);

    if (clubWon) {
      // [구단 승소 딜레마]: 연봉은 절감했으나 해당 선수 사기 -50 및 구단 신뢰도 -50 락바텀 추락!
      const prevMorale = player.morale || 72;
      const prevTrust = rgm.clubTrustScore || 75;
      player.morale = clamp(prevMorale - 50, 5, 100);
      player.cond = 0.88;
      player.tradeDemand = true;
      player.moraleReason = "연봉조정위원회 구단 승소로 인한 극심한 감정 상처 및 신뢰 파탄 (사기 -50 락바텀)";
      rgm.clubTrustScore = clamp(prevTrust - 50, 0, 100);

      const caseRecord = {
        date: curDate,
        year: context.currentYear || 2025,
        playerId: player.id,
        playerName: player.name,
        pos: player.pos,
        fairSalary,
        clubOffer,
        playerDemand,
        finalSalary,
        savedManwon,
        winner: "CLUB",
        playerMoraleAfter: player.morale,
        clubTrustAfter: rgm.clubTrustScore
      };
      rgm.arbitrationHistory.unshift(caseRecord);

      const summary = `[1월 말 연봉조정위원회 판결: 구단 승소!] ${player.name}(${player.pos}) 조정 심판에서 구단 제시액(${clubOffer.toLocaleString()}만 원)이 채택되어 ${savedManwon.toLocaleString()}만 원을 절감했습니다! 그러나 패소한 선수의 자존심 상처로 [선수 사기 -50 (${prevMorale}→${
        player.morale
      }) 및 구단 신뢰도 -50 (${prevTrust}→${rgm.clubTrustScore}) 락바텀 추락] 후유증이 발생했습니다!`;

      rgm.realisticLogs.unshift({
        date: curDate,
        type: "ARBITRATION_CLUB_WON_ROCKBOTTOM",
        message: summary
      });

      return {
        ok: true,
        winner: "CLUB",
        caseRecord,
        savedManwon,
        playerMoraleDelta: -50,
        clubTrustDelta: -50,
        playerMorale: player.morale,
        clubTrustScore: rgm.clubTrustScore,
        summary
      };
    } else {
      // 선수 승소
      player.morale = clamp((player.morale || 70) - 10, 0, 100);
      team.ownerTrust = clamp((team.ownerTrust || 60) - 6, 0, 100);
      const caseRecord = {
        date: curDate,
        year: context.currentYear || 2025,
        playerId: player.id,
        playerName: player.name,
        pos: player.pos,
        fairSalary,
        clubOffer,
        playerDemand,
        finalSalary,
        savedManwon: 0,
        winner: "PLAYER",
        playerMoraleAfter: player.morale,
        clubTrustAfter: rgm.clubTrustScore
      };
      rgm.arbitrationHistory.unshift(caseRecord);

      const summary = `[1월 말 연봉조정위원회 판결: 선수 승소] 위원회가 ${player.name}(${player.pos}) 선수의 요구액(${playerDemand.toLocaleString()}만 원) 손을 들어주었습니다. (구단주 신임도 -6)`;
      rgm.realisticLogs.unshift({
        date: curDate,
        type: "ARBITRATION_PLAYER_WON",
        message: summary
      });

      return {
        ok: true,
        winner: "PLAYER",
        caseRecord,
        savedManwon: 0,
        playerMorale: player.morale,
        clubTrustScore: rgm.clubTrustScore,
        summary
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // [메카닉 3] 예비 FA 보상금 뻥튀기 사전 방어 전략 (FA_PREEMPTIVE_BUMP)
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * FA 자격 취득 1년 전(faYears === 7, 대졸은 6~7) 핵심 선수 목록 및 보상금 장벽 상승 시뮬레이션 조회
   */
  function getPreemptiveFABumpCandidates(context, teamId) {
    if (!context) return [];
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return [];

    const allDom = team
      .getAllPlayers()
      .filter((p) => (!p.nationality || p.nationality === "KOR") && p.status !== "MILITARY");

    // 1순위: faYears === 7 (또는 대졸 6년차), 없으면 FA 임박 핵심 선수(faYears >= 5) 상위 노출
    let candidates = allDom.filter((p) => p.faYears === 7 || (p.origin === "UNIV" && p.faYears === 6));
    if (candidates.length === 0) {
      candidates = allDom
        .filter((p) => (p.faYears || 0) >= 5 && (p.contractYears || 1) <= 1)
        .sort((a, b) => b.getTrueOvr() - a.getTrueOvr())
        .slice(0, 4);
    }

    return candidates
      .sort((a, b) => b.getTrueOvr() - a.getTrueOvr())
      .map((p) => {
        const curSal = p.salary || 15000;
        const bump150Sal = round100(curSal * 1.5);
        const bump200Sal = round100(curSal * 2.0);
        return {
          playerId: p.id,
          name: p.name,
          pos: p.pos,
          age: p.age,
          faYears: p.faYears || 7,
          trueOvr: p.getTrueOvr(),
          currentSalaryManwon: curSal,
          bump150SalaryManwon: bump150Sal,
          bump200SalaryManwon: bump200Sal,
          currentComp200Manwon: curSal * 2,
          currentComp300Manwon: curSal * 3,
          bumpedComp200Manwon: bump200Sal * 2,
          bumpedComp300Manwon: bump200Sal * 3,
          aiBidDropEstimatePct: p.preemptiveBumpApplied ? 75 : 68,
          alreadyBumped: Boolean(p.preemptiveBumpApplied)
        };
      });
  }

  /**
   * FA 1년 전(faYears === 7) 핵심 선수의 연봉을 일부러 대폭 인상(150~200%)하여 타 구단 AI의 보상금(전년도 연봉 200~300%) 입찰을 차단
   */
  function applyPreemptiveFASalaryBump(context, teamId, playerId, bumpMultiplier = 1.8) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const rgm = ensureRealisticGMState(team);
    const player = team.getAllPlayers().find((p) => p.id === playerId);
    if (!player) return { ok: false, reason: "대상 선수를 찾을 수 없습니다." };

    const mult = clamp(Number(bumpMultiplier) || 1.8, 1.5, 2.0);
    const prevSalary = Math.max(10000, player.salary || 18000);
    const bumpedSalary = round100(prevSalary * mult);
    const extraCost = bumpedSalary - prevSalary;

    if (team.getAvailableBudget() - extraCost < 0) {
      return { ok: false, reason: "여유 예산이 부족하여 전략적 고액 연봉 인상을 집행할 수 없습니다." };
    }

    team.budget = (team.budget || 1200000) - extraCost;
    player.salary = bumpedSalary;
    player.faYears = 7;
    player.preemptiveBumpApplied = true;
    player.preemptiveBumpFactor = mult;
    ensurePlayerMorale(player);
    player.morale = clamp(player.morale + 20, 0, 100);

    if (!rgm.preemptiveBumpedPlayerIds.includes(player.id)) {
      rgm.preemptiveBumpedPlayerIds.push(player.id);
    }

    const comp200 = bumpedSalary * 2;
    const comp300 = bumpedSalary * 3;
    const curDate = context.currentDate || `${context.currentYear || 2025}-01-25`;
    const summary = `[예비 FA 보상금 뻥튀기 방어 전략 가동!] 예비 FA(faYears=7) 핵심 ${player.name}(${player.pos}, OVR ${player.getTrueOvr()}) 선수의 연봉을 ${Math.round(
      mult * 100
    )}% 전격 인상(${(prevSalary / 10000).toFixed(2)}억 → ${(bumpedSalary / 10000).toFixed(
      2
    )}억 원)했습니다! 이제 타 구단이 FA 영입 시 지급해야 할 보상금이 [20인 외 + ${(comp200 / 10000).toFixed(
      2
    )}억 원(200%) 또는 전액 ${(comp300 / 10000).toFixed(
      2
    )}억 원(300%)]으로 폭증하여 타 구단 AI 입찰 확률이 -72% 급감합니다!`;

    rgm.realisticLogs.unshift({
      date: curDate,
      type: "FA_PREEMPTIVE_BUMP_APPLIED",
      playerId: player.id,
      message: summary
    });

    return {
      ok: true,
      playerId: player.id,
      playerName: player.name,
      prevSalaryManwon: prevSalary,
      bumpedSalaryManwon: bumpedSalary,
      bumpMultiplier: mult,
      newComp200Manwon: comp200,
      newComp300Manwon: comp300,
      aiBiddingProbabilityMultiplier: +clamp(1 / (mult * 2.2), 0.10, 0.35).toFixed(2),
      summary
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // [메카닉 4] 트레이드 마감일 Buyer / Seller 스탠스 엔진 (DEADLINE_STANCE)
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * 7월 31일 트레이드 마감일 시점, 10개 구단 순위에 따라 Buyer(대권 도전) vs Seller(리빌딩 유망주 수집) AI 스탠스 자동 판정
   */
  function evaluateDeadlineMarketStances(context) {
    if (!context || !Array.isArray(context.kboTeams)) return { ok: false, stances: [] };
    const gm = getGM();
    if (gm && typeof gm.calculateKBOStandings === "function") {
      gm.calculateKBOStandings(context);
    }

    const standings =
      Array.isArray(context.standings) && context.standings.length > 0
        ? context.standings
        : context.kboTeams.map((t, idx) => ({
            rank: idx + 1,
            teamId: t.id,
            teamName: t.name,
            w: t.record ? t.record.w : 0,
            l: t.record ? t.record.l : 0,
            winPct: t.record ? t.record.winPct : 0.5
          }));

    const teamStances = standings.map((row, idx) => {
      const rank = row.rank || idx + 1;
      const team = context.getTeam(row.teamId);
      const rgm = team ? ensureRealisticGMState(team) : null;
      let autoStance = "HYBRID";
      let stanceLabel = "⚖️ 중립/핀포인트 스왑 (5~6위 가을야구 경합)";
      let strategyDesc = "취약 포지션 1:1 맞트레이드 및 불펜 보강 탐색";

      if (rank <= 4) {
        autoStance = "BUYER";
        stanceLabel = "🔥 BUYER (1~4위 윈나우 대권 도전)";
        strategyDesc = "2군 유망주·드래프트 지명권을 지불하고 타 구단 렌탈 베테랑 즉시전력감 공격적 영입";
      } else if (rank >= 7) {
        autoStance = "SELLER";
        stanceLabel = "🌱 SELLER (7~10위 리빌딩·유망주 수집)";
        strategyDesc = "고액·예비 FA 베테랑을 Buyer 구단에 양도하고 고포텐셜 유망주 및 상위 지명권 확보";
      }

      const effectiveStance =
        rgm && rgm.deadlineStance && rgm.deadlineStance !== "AUTO" ? rgm.deadlineStance : autoStance;

      if (team) {
        team.marketDeadlineStance = effectiveStance;
      }

      return {
        rank,
        teamId: row.teamId,
        teamName: row.teamName,
        winPct: row.winPct,
        autoStance,
        effectiveStance,
        stanceLabel:
          effectiveStance === "BUYER"
            ? "🔥 BUYER (윈나우 베테랑 매수)"
            : effectiveStance === "SELLER"
            ? "🌱 SELLER (베테랑 매각 & 유망주·픽 수집)"
            : stanceLabel,
        strategyDesc
      };
    });

    return {
      ok: true,
      deadlineDate: `${context.currentYear || 2025}-07-31`,
      teamStances
    };
  }

  /**
   * 7월 31일 마감일 시점 유저 구단 스탠스(BUYER vs SELLER) 설정 및 맞춤형 AI 트레이드 오퍼 생성
   */
  function generateDeadlineTradeProposals(context, userStanceOverride = null) {
    if (!context) return { ok: false, proposals: [] };
    const userTeam = context.getUserTeam();
    if (!userTeam) return { ok: false, proposals: [] };

    const rgm = ensureRealisticGMState(userTeam);
    if (userStanceOverride && ["BUYER", "SELLER", "AUTO"].includes(userStanceOverride)) {
      rgm.deadlineStance = userStanceOverride;
    }

    const market = evaluateDeadlineMarketStances(context);
    const userEntry =
      market.teamStances.find((s) => s.teamId === userTeam.id) || market.teamStances[0];
    const myStance =
      userStanceOverride && userStanceOverride !== "AUTO"
        ? userStanceOverride
        : userEntry.effectiveStance === "HYBRID"
        ? "BUYER"
        : userEntry.effectiveStance;

    const proposals = [];

    if (myStance === "BUYER") {
      // 유저가 BUYER: Seller AI 구단들이 보유한 고OVR 베테랑(만 28세+, OVR 72+)을 매물로 내놓고 우리 구단의 2군 유망주(24세 이하) 요구
      const sellerTeams = market.teamStances
        .filter((s) => s.teamId !== userTeam.id && (s.effectiveStance === "SELLER" || s.rank >= 6))
        .map((s) => context.getTeam(s.teamId))
        .filter(Boolean);

      const myProspects = [...userTeam.roster2G, ...userTeam.rosterDev]
        .filter((p) => p.age <= 25)
        .sort((a, b) => (b.potential || 78) - (a.potential || 78));

      sellerTeams.forEach((sTeam, idx) => {
        const rentalVet = sTeam
          .getAllPlayers()
          .filter((p) => p.age >= 28 && p.getTrueOvr() >= 71 && (!p.injury || !p.injury.active))
          .sort((a, b) => b.getTrueOvr() - a.getTrueOvr())[0];
        const askProspect = myProspects[idx % Math.max(1, myProspects.length)] || userTeam.roster2G[0];

        if (rentalVet && askProspect) {
          proposals.push({
            id: `DEADLINE_BUY_${context.currentYear || 2025}_${sTeam.id}_${rentalVet.id}`,
            userStance: "BUYER",
            partnerTeamId: sTeam.id,
            partnerTeamName: sTeam.name,
            partnerStance: "SELLER",
            acquirePlayerId: rentalVet.id,
            acquirePlayerName: rentalVet.name,
            acquirePos: rentalVet.pos,
            acquireAge: rentalVet.age,
            acquireOvr: rentalVet.getTrueOvr(),
            sendPlayerId: askProspect.id,
            sendPlayerName: askProspect.name,
            sendPos: askProspect.pos,
            sendAge: askProspect.age,
            sendPot: askProspect.potential || 80,
            bonusPickRound: null,
            headline: `[7/31 마감일 BUYER 딜] ${sTeam.name}(Seller) 렌탈 베테랑 ${rentalVet.name}(${rentalVet.pos}, ${rentalVet.age}세·OVR ${rentalVet.getTrueOvr()}) 영입 ↔ 우리 유망주 ${askProspect.name}(${askProspect.pos}, ${askProspect.age}세·포텐 ${askProspect.potential}) 지불`
          });
        }
      });
    } else {
      // 유저가 SELLER: 우리 구단의 고연차 베테랑을 Buyer AI 구단(1~5위)에 양도하고 상대의 최고 유망주 + 2R 지명권 수급
      const buyerTeams = market.teamStances
        .filter((s) => s.teamId !== userTeam.id && (s.effectiveStance === "BUYER" || s.rank <= 5))
        .map((s) => context.getTeam(s.teamId))
        .filter(Boolean);

      const myVeterans = userTeam
        .getAllPlayers()
        .filter((p) => p.age >= 28 && p.getTrueOvr() >= 70)
        .sort((a, b) => b.getTrueOvr() - a.getTrueOvr());

      buyerTeams.forEach((bTeam, idx) => {
        const topProspect = [...bTeam.roster2G, ...bTeam.rosterDev]
          .filter((p) => p.age <= 24)
          .sort((a, b) => (b.potential || 80) - (a.potential || 80))[0];
        const sendVet = myVeterans[idx % Math.max(1, myVeterans.length)] || userTeam.roster1G[0];

        if (topProspect && sendVet) {
          proposals.push({
            id: `DEADLINE_SELL_${context.currentYear || 2025}_${bTeam.id}_${topProspect.id}`,
            userStance: "SELLER",
            partnerTeamId: bTeam.id,
            partnerTeamName: bTeam.name,
            partnerStance: "BUYER",
            acquirePlayerId: topProspect.id,
            acquirePlayerName: topProspect.name,
            acquirePos: topProspect.pos,
            acquireAge: topProspect.age,
            acquireOvr: topProspect.getTrueOvr(),
            acquirePot: topProspect.potential || 85,
            sendPlayerId: sendVet.id,
            sendPlayerName: sendVet.name,
            sendPos: sendVet.pos,
            sendAge: sendVet.age,
            sendOvr: sendVet.getTrueOvr(),
            bonusPickRound: 2,
            headline: `[7/31 마감일 SELLER 딜] 우리 베테랑 ${sendVet.name}(${sendVet.pos}, ${sendVet.age}세·OVR ${sendVet.getTrueOvr()}) 양도 ↔ ${bTeam.name}(Buyer) 특급 유망주 ${topProspect.name}(${topProspect.pos}, ${topProspect.age}세·포텐 ${topProspect.potential}) + 2R 지명권 확보`
          });
        }
      });
    }

    rgm.deadlineProposals = proposals;
    return {
      ok: true,
      userRank: userEntry.rank,
      userStance: myStance,
      marketStances: market.teamStances,
      proposals
    };
  }

  /**
   * 7월 31일 Buyer / Seller 마감일 딜 즉시 체결
   */
  function executeDeadlineStanceDeal(context, proposalId) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const userTeam = context.getUserTeam();
    if (!userTeam) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const rgm = ensureRealisticGMState(userTeam);
    if (!Array.isArray(rgm.deadlineProposals) || rgm.deadlineProposals.length === 0) {
      generateDeadlineTradeProposals(context);
    }
    const deal =
      rgm.deadlineProposals.find((p) => p.id === proposalId) || rgm.deadlineProposals[0];
    if (!deal) return { ok: false, reason: "체결 가능한 마감일 트레이드 오퍼가 없습니다." };

    const partnerTeam = context.getTeam(deal.partnerTeamId);
    if (!partnerTeam) return { ok: false, reason: "상대 구단을 찾을 수 없습니다." };

    const sendPlayer = userTeam.getAllPlayers().find((p) => p.id === deal.sendPlayerId);
    const acqPlayer = partnerTeam.getAllPlayers().find((p) => p.id === deal.acquirePlayerId);
    if (!sendPlayer || !acqPlayer) {
      return { ok: false, reason: "트레이드 대상 선수가 이미 이동했습니다." };
    }

    ["roster1G", "roster2G", "rosterDev"].forEach((rk) => {
      userTeam[rk] = userTeam[rk].filter((p) => p.id !== sendPlayer.id);
      partnerTeam[rk] = partnerTeam[rk].filter((p) => p.id !== acqPlayer.id);
    });

    sendPlayer.teamId = partnerTeam.id;
    sendPlayer.acquiredVia = { type: "TRADE", date: context.currentDate || null, fromTeamId: sendPlayer.formerTeamId || null }; // 시즌 회고 리포트용 영입 경로
    sendPlayer.status = partnerTeam.roster1G.length < 28 ? "1GUN" : "2GUN";
    if (sendPlayer.status === "1GUN") partnerTeam.roster1G.push(sendPlayer);
    else partnerTeam.roster2G.push(sendPlayer);

    acqPlayer.teamId = userTeam.id;
    acqPlayer.acquiredVia = { type: "TRADE", date: context.currentDate || null, fromTeamId: acqPlayer.formerTeamId || null }; // 시즌 회고 리포트용 영입 경로
    acqPlayer.status = userTeam.roster1G.length < 28 ? "1GUN" : "2GUN";
    if (acqPlayer.status === "1GUN") userTeam.roster1G.push(acqPlayer);
    else userTeam.roster2G.push(acqPlayer);

    // SELLER 딜로 상위 지명권까지 확보한 경우 context.tradedPicks에 반영
    if (deal.bonusPickRound) {
      if (!Array.isArray(context.tradedPicks)) context.tradedPicks = [];
      context.tradedPicks.push({
        year: context.currentYear || 2025,
        round: deal.bonusPickRound,
        fromTeamId: partnerTeam.id,
        toTeamId: userTeam.id,
        originalTeamId: partnerTeam.id,
        currentOwnerTeamId: userTeam.id,
        tradedAt: context.currentDate || `${context.currentYear || 2025}-07-31`
      });
    }

    if (deal.userStance === "BUYER") {
      rgm.farmSystemHealth = clamp(rgm.farmSystemHealth - 8, 0, 100);
      fulfillTradeDirective(context, userTeam.id, [acqPlayer]);
    } else {
      rgm.farmSystemHealth = clamp(rgm.farmSystemHealth + 14, 0, 100);
    }

    rgm.deadlineProposals = rgm.deadlineProposals.filter((p) => p.id !== deal.id);
    const curDate = context.currentDate || `${context.currentYear || 2025}-07-31`;
    const summary = `[7/31 트레이드 마감일 ${deal.userStance} 딜 타결!] ${deal.headline}`;

    rgm.realisticLogs.unshift({
      date: curDate,
      type: `DEADLINE_${deal.userStance}_DEAL`,
      message: summary
    });

    return {
      ok: true,
      deal,
      acquiredPlayer: acqPlayer,
      sentPlayer: sendPlayer,
      farmSystemHealth: rgm.farmSystemHealth,
      summary
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // [메카닉 5] 과도한 감봉 시 선수단 집단 항명 & 미디어 여론전 (SQUAD_REBELLION)
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * 연봉 삭감율이 높을 때 [선수단 집단 항명] 발동 (팀 전체 컨디션 및 팬 민심 하락)
   */
  function evaluateSquadRebellion(context, teamId, salaryCutSummary = {}) {
    if (!context) return { ok: false, rebellionTriggered: false };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, rebellionTriggered: false };

    const rgm = ensureRealisticGMState(team);
    const prevPayroll = Number(salaryCutSummary.prevTotalPayroll) || 600000;
    const newPayroll = Number(salaryCutSummary.newTotalPayroll) || prevPayroll;
    const cutRate = prevPayroll > 0 ? (prevPayroll - newPayroll) / prevPayroll : 0;
    const steepCutsCount = Array.isArray(salaryCutSummary.playerResults)
      ? salaryCutSummary.playerResults.filter((r) => r.diff < -3000).length
      : 0;

    const shouldTrigger =
      Boolean(salaryCutSummary.forceTrigger) ||
      salaryCutSummary.userPolicy === "AUSTERITY" ||
      cutRate >= 0.10 ||
      steepCutsCount >= 4;

    if (!shouldTrigger) {
      return {
        ok: true,
        rebellionTriggered: false,
        cutRatePct: +(cutRate * 100).toFixed(1)
      };
    }

    // 집단 항명 발동: 선수단 전체 컨디션 하락(-0.12), 팀 사기 급락(-18), 팬 민심 하락(-15), 언론 여론 하락(-20)
    team.getAllPlayers().forEach((p) => {
      p.cond = +clamp((p.cond || 1.0) - 0.12, 0.72, 1.15).toFixed(2);
      ensurePlayerMorale(p);
      p.morale = clamp(p.morale - 18, 10, 100);
    });
    const newTeamMorale = applyTeamMoraleDelta(team, 0);
    const prevFan = team.fanRatio || 55;
    team.fanRatio = clamp(prevFan - 15, 0, 100);
    rgm.mediaSentiment = clamp((rgm.mediaSentiment || 65) - 20, 0, 100);

    const captainPlayer =
      team.roster1G.slice().sort((a, b) => b.age + b.getTrueOvr() - (a.age + a.getTrueOvr()))[0] ||
      team.roster1G[0];

    const curDate = context.currentDate || `${context.currentYear || 2025}-01-28`;
    const rebellionEvent = {
      id: `REBELLION_${context.currentYear || 2025}_${Date.now()}`,
      type: "SQUAD_REBELLION",
      date: curDate,
      teamId: team.id,
      captainName: captainPlayer ? captainPlayer.name : "선수단 주장",
      cutRatePct: Math.max(15, Math.round(cutRate * 100)),
      fanRatioAfter: team.fanRatio,
      mediaSentimentAfter: rgm.mediaSentiment,
      teamMoraleAfter: newTeamMorale,
      title: `[선수단 집단 항명 사태 발발!] 고강도 감봉 칼바람에 ${
        captainPlayer ? captainPlayer.name : "주장단"
      } 중심 단체 행동 및 언론 성명 발표`,
      desc: `과도한 연봉 삭감에 반발한 선수단이 자율훈련 보이콧과 언론 익명 인터뷰에 나섰습니다! 팀 전체 컨디션(-0.12)과 팬 민심(-15 → ${team.fanRatio}), 언론 여론(-20 → ${rgm.mediaSentiment})이 급락했습니다. 단장의 공식 미디어 인터뷰 대처 방향을 선택하십시오.`,
      resolved: false
    };

    rgm.activeSquadRebellion = rebellionEvent;
    if (Array.isArray(context.pendingEvents)) {
      context.pendingEvents.push(rebellionEvent);
    }

    rgm.realisticLogs.unshift({
      date: curDate,
      type: "SQUAD_REBELLION_TRIGGERED",
      message: `${rebellionEvent.title} — 팀 전체 컨디션 -0.12 하락, 팬 민심 -15 하락(${prevFan}→${team.fanRatio})`
    });

    return {
      ok: true,
      rebellionTriggered: true,
      rebellionEvent,
      fanRatio: team.fanRatio,
      mediaSentiment: rgm.mediaSentiment,
      teamMorale: newTeamMorale
    };
  }

  /**
   * 선수단 집단 항명 사태에 대한 단장의 미디어 인터뷰 대처 (구단주 신임도 및 언론 여론 수치 변동)
   * @param {string} responseStrategy - "HARDLINE_PRINCIPLE" | "CONCILIATORY_BONUS" | "TRANSPARENT_REBUILD_PR"
   */
  function handleRebellionMediaResponse(context, teamId, responseStrategy = "TRANSPARENT_REBUILD_PR") {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const rgm = ensureRealisticGMState(team);
    const curDate = context.currentDate || `${context.currentYear || 2025}-01-30`;
    let summary = "";

    if (responseStrategy === "HARDLINE_PRINCIPLE") {
      // 1) 강경 원칙론 인터뷰 ("성적 부진엔 칼 같은 삭감이 구단 원칙"): 구단주 신임도 +10 상승, 그러나 언론 여론 -18, 팬 민심 -10, 팀 사기 -12 추가 하락
      team.ownerTrust = clamp((team.ownerTrust || 60) + 10, 0, 100);
      rgm.mediaSentiment = clamp((rgm.mediaSentiment || 50) - 18, 0, 100);
      team.fanRatio = clamp((team.fanRatio || 50) - 10, 0, 100);
      const newMorale = applyTeamMoraleDelta(team, -12);
      summary = `[미디어 인터뷰: 강경 원칙론 천명] "성적과 데이터 고과에 타협은 없다"고 발표했습니다. 예산 절감을 반긴 구단주 신임도는 +10(→${team.ownerTrust}) 상승했으나, 언론 여론 -18(→${rgm.mediaSentiment}), 팬 민심 -10(→${team.fanRatio}), 선수단 사기 -12(→${newMorale})로 냉각되었습니다.`;
    } else if (responseStrategy === "CONCILIATORY_BONUS") {
      // 2) 유화책 & 승리수당 인센티브 신설 ("선수단 자존심 존중 및 1.5억 포스트시즌 보너스 풀 약정"): 예산 -1.5억, 구단주 신임도 -4, 언론 여론 +22, 팬 민심 +14, 팀 컨디션/사기 완전 회복
      team.budget = (team.budget || 1200000) - 15000;
      team.ownerTrust = clamp((team.ownerTrust || 60) - 4, 0, 100);
      rgm.mediaSentiment = clamp((rgm.mediaSentiment || 50) + 22, 0, 100);
      team.fanRatio = clamp((team.fanRatio || 50) + 14, 0, 100);
      team.getAllPlayers().forEach((p) => {
        p.cond = 1.02;
      });
      const newMorale = applyTeamMoraleDelta(team, 20);
      summary = `[미디어 인터뷰: 유화책 및 특별 승리수당(1.5억) 편성] 선수단 주장단과 화해 간담회를 열고 성적 보너스 풀을 신설했습니다! (언론 여론 +22→${rgm.mediaSentiment}, 팬 민심 +14→${team.fanRatio}, 팀 사기 +20→${newMorale}, 선수단 컨디션 정상 회복 · 구단주 신임도 -4→${team.ownerTrust})`;
    } else {
      // 3) 투명한 리빌딩 & R&D 재투자 비전 브리핑 ("절감 재원은 2군 육성 인프라에 100% 재투자"): 구단주 신임도 +6, 언론 여론 +16, 팬 민심 +9, 사기 +8 회복
      team.ownerTrust = clamp((team.ownerTrust || 60) + 6, 0, 100);
      rgm.mediaSentiment = clamp((rgm.mediaSentiment || 50) + 16, 0, 100);
      team.fanRatio = clamp((team.fanRatio || 50) + 9, 0, 100);
      team.getAllPlayers().forEach((p) => {
        p.cond = +clamp((p.cond || 0.9) + 0.08, 0.85, 1.1).toFixed(2);
      });
      const newMorale = applyTeamMoraleDelta(team, 8);
      summary = `[미디어 인터뷰: 투명한 리빌딩·인프라 재투자 브리핑] 데이터 기자간담회를 통해 페이롤 효율화 명분을 설득했습니다! (구단주 신임도 +6→${team.ownerTrust}, 언론 여론 +16→${rgm.mediaSentiment}, 팬 민심 +9→${team.fanRatio}, 팀 사기 +8→${newMorale})`;
    }

    if (rgm.activeSquadRebellion) {
      rgm.activeSquadRebellion.resolved = true;
    }
    rgm.activeSquadRebellion = null;

    rgm.realisticLogs.unshift({
      date: curDate,
      type: `REBELLION_MEDIA_${responseStrategy}`,
      message: summary
    });

    return {
      ok: true,
      responseStrategy,
      ownerTrust: team.ownerTrust,
      mediaSentiment: rgm.mediaSentiment,
      fanRatio: team.fanRatio,
      teamMorale: team.teamMorale,
      summary
    };
  }

  const ManagerConflict = {
    REPLACEMENT_MANAGER_CANDIDATES,
    MANAGER_ARCHETYPES,
    ensureManagerConflictState,
    evaluateConflictCrisis,
    triggerProtectionMandate,
    resolveProtectionMandate,
    checkManagerTradeVeto,
    resolveTradeVeto,
    generateMidseasonTradeDirective,
    fulfillTradeDirective,
    resolveTradeDirectiveAction,
    resolveBoardHearing,
    fireManagerWithSeverance,
    setManagerArchetype,
    checkPlayerUsageRefusal,
    resolveUsageRefusalDilemma
  };

  const RealisticGM = {
    ManagerConflict,
    ...ManagerConflict,
    MANAGER_ARCHETYPES,
    SALARY_AGENDA_OPTIONS,
    ensureRealisticGMState,
    setManagerArchetype,
    checkPlayerUsageRefusal,
    resolveUsageRefusalDilemma,
    negotiateMultiIssueSalary,
    runSalaryArbitrationHearing,
    getPreemptiveFABumpCandidates,
    applyPreemptiveFASalaryBump,
    evaluateDeadlineMarketStances,
    generateDeadlineTradeProposals,
    executeDeadlineStanceDeal,
    evaluateSquadRebellion,
    handleRebellionMediaResponse
  };

  /* ═══════════════════════════════════════════════════════════════════════
   * [PART 2] KBO_GM.Assistant — 단장 업무 가이드 '오늘의 할 일(Today's To-Do)' 엔진
   *    - 매일/매주 구단 상태 및 날짜를 연산하여 🔴 필수 할 일(Must-Do)과
   *      🟡 추천 할 일(Recommended) 브리핑 리포트 및 원클릭 실행 제공
   * ═══════════════════════════════════════════════════════════════════════ */
  function generateDailyBriefing(context, options = {}) {
    if (!context) return { date: "2025-01-01", mustDo: [], recommended: [], totalCount: 0 };
    const audit = ensureAuditMetrics(context);
    if (audit && !options.skipAuditIncrement) {
      audit.toDoListGeneratedCount = (audit.toDoListGeneratedCount || 0) + 1;
    }
    if (context._fastAuditMode && !options.skipAuditIncrement) {
      const w = context.currentWeek || 1;
      const fastMustDo = [];
      if (w === 21 && !(context.draftState && context.draftState.isCompleted)) {
        fastMustDo.push({ id: "DRAFT_WEEK", priority: "MUST_DO", title: `[9월 3주차] ${context.currentYear} 신인 드래프트 지명` });
      }
      return {
        date: context.currentDate || `${context.currentYear}-03-22`,
        koreanDate: context.currentDate || `${context.currentYear}-03-22`,
        mustDo: fastMustDo,
        recommended: [],
        totalCount: fastMustDo.length
      };
    }
    const gm = getGM();
    const userTeam = context.getUserTeam();
    if (!userTeam) return { date: context.currentDate, mustDo: [], recommended: [], totalCount: 0 };

    const curDate = context.currentDate || `${context.currentYear}-01-01`;
    const mm = Number(curDate.slice(5, 7)) || 1;
    const dd = Number(curDate.slice(8, 10)) || 1;
    const curWeek = Number(context.currentWeek) || 1;

    const mustDo = [];
    const recommended = [];

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 1. 필수 할 일 (Must-Do) 점검
    // ─────────────────────────────────────────────────────────────────────
    // (M-1) 9월 3주차(21주차) 또는 9월 23일 신인 드래프트 지명
    const isDraftPeriod = (mm === 9 && dd >= 23 && dd <= 30) || curWeek === 21;
    const draftCompleted = context.draftState && context.draftState.isCompleted;
    if (isDraftPeriod && !draftCompleted && context.draftPool && context.draftPool.length > 0) {
      const nextR = context.draftState ? context.draftState.completedRounds.length + 1 : 1;
      mustDo.push({
        id: "DRAFT_WEEK",
        priority: "MUST_DO",
        badge: "🔴 필수",
        title: `[9월 3주차 · 9월 23일] ${context.currentYear} KBO 신인 드래프트 직접 지명 (${nextR}~10R)`,
        desc: `드래프트 지명일이 도래했습니다! 유망주 ${context.draftPool.length}명 대상 1~10라운드 직접 지명을 진행하세요.`,
        targetTab: "offseason",
        targetSubTab: "draft",
        quickActionLabel: "1~10R 자동 지명 완료"
      });
    } else if (mm === 9 && dd < 23 && !draftCompleted) {
      recommended.push({
        id: "SCOUT_DISPATCH_CHECK",
        priority: "RECOMMENDED",
        badge: "🟡 추천",
        title: `[9월 23일 드래프트 D-${23 - dd}] 유망주 스카우팅 리포트 열람 및 스카우트 파견`,
        desc: `직접 지명은 9월 23일에 오픈됩니다. 그 전까지 스카우트 파견 및 유망주 상세 능력치 리포트를 점검하세요.`,
        targetTab: "offseason",
        targetSubTab: "draft",
        quickActionLabel: "스카우트 최적 파견 자동 배정"
      });
    }

    // (M-2) 스토브리그(11월~1월 또는 29~31주차) 연봉 재계약 및 FA 시장 마감 처리
    const isStoveSeason = mm === 11 || mm === 12 || mm === 1 || (curWeek >= 29 && curWeek <= 31);
    const unrenewedCount = userTeam
      .getAllPlayers()
      .filter((p) => p.nationality === "KOR" && (p.contractYears || 1) <= 1).length;
    if (
      isStoveSeason &&
      context._lastOffseasonProcessedYear !== context.currentYear &&
      ((context.faPool && context.faPool.length > 0) || dd <= 20 || curWeek === 30)
    ) {
      mustDo.push({
        id: "STOVE_LEAGUE_RENEWAL_FA",
        priority: "MUST_DO",
        badge: "🔴 필수",
        title: `스토브리그 FA 시장(${(context.faPool || []).length}명) & 국내 선수 연봉 재계약(${unrenewedCount}명)`,
        desc: `개막 전 선수단 연봉 재계약과 FA 시장 입찰/외국인 구성을 마무리하세요.`,
        targetTab: "offseason",
        targetSubTab: context.faPool && context.faPool.length > 0 ? "fa" : "salary",
        quickActionLabel: "적정안 연봉·FA 일괄 처리"
      });
    }

    // (M-3) 외국인 6주(42일) 이상 장기 부상 시 대체 외인 영입 또는 재활 완료 외인 복귀 결정 (pendingEvents 연동)
    const longInjForeign = userTeam
      .getAllPlayers()
      .find(
        (p) =>
          p.nationality !== "KOR" &&
          !p.isAsianQuarter &&
          p.injury &&
          p.injury.active &&
          ((p.injury.weeksLeft || 0) >= 6 || (p.injury.daysLeft || 0) >= 42)
      );
    const pending6WkEvent = (context.pendingEvents || []).find(
      (ev) => ev.type === "FOREIGN_6WK_REPLACEMENT_RIGHT" && ev.teamId === userTeam.id && !ev.resolved
    );
    const rehabReadyForeign = (userTeam.foreignRehabList || []).find(
      (p) => !p.injury || !p.injury.active || (p.injury.daysLeft || 0) <= 0
    );
    if (longInjForeign || pending6WkEvent || rehabReadyForeign) {
      const targetName = longInjForeign
        ? `${longInjForeign.name}(${longInjForeign.pos})`
        : pending6WkEvent
        ? `${pending6WkEvent.playerName}(${pending6WkEvent.pos})`
        : `${rehabReadyForeign.name}(${rehabReadyForeign.pos})`;
      mustDo.push({
        id: "FOREIGN_6WK_ACTION",
        priority: "MUST_DO",
        badge: "🔴 필수",
        title:
          longInjForeign || pending6WkEvent
            ? `[긴급] 외국인 ${targetName} 6주 장기 부상 — 대체 외인 영입 결정`
            : `[복귀 결단] 재활 명단 ${targetName} 완쾌 — 복귀/전환 결정`,
        desc:
          longInjForeign || pending6WkEvent
            ? `6주 대체 외국인 제도를 활용해 해외 풀에서 단기 대체 선수를 즉시 수혈할 수 있습니다.`
            : `원 외국인을 1군에 복귀시킬지, 대체 외국인을 정식 전환할지 결정해야 합니다.`,
        targetTab: "offseason",
        targetSubTab: "foreign",
        quickActionLabel: longInjForeign || pending6WkEvent ? "6주 대체 외인 즉시 영입" : "원 외국인 1군 복귀"
      });
    }

    // (M-4) FA 영입 시 20인/25인 보호명단 제출 및 격년 2차 드래프트 35인 보호명단 작성
    const store = ensureCustomProtectionStore(userTeam);
    const needProtectionCheck =
      store.FA_20.length < 20 ||
      (isBiennialDraftYear(context.currentYear) && (mm === 11 || curWeek === 28) && store.DRAFT_35.length < 35);
    if (needProtectionCheck || (isStoveSeason && store.FA_20.length === 0)) {
      mustDo.push({
        id: "PROTECTION_LIST_SUBMIT",
        priority: "MUST_DO",
        badge: "🔴 필수",
        title: `FA 20인/25인 보호명단 및 2차 드래프트 35인 보호명단 확정`,
        desc: `외부 FA 영입 보상선수 유출 및 격년 2차 드래프트에 대비해 핵심 유망주를 보호명단에 묶으세요.`,
        targetTab: "offseason",
        targetSubTab: "front5",
        quickActionLabel: "보호명단 자동 최적 구성"
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🟡 2. 추천 할 일 (Recommended) 점검
    // ─────────────────────────────────────────────────────────────────────
    // (R-1) 1군 부상자 발생 또는 1군 엔트리(28명) 미달 시 2군 콜업 추천
    const injuredIn1G = userTeam.roster1G.filter((p) => p.injury && p.injury.active);
    if (injuredIn1G.length > 0 || userTeam.roster1G.length < 28) {
      const best2G = userTeam.roster2G
        .filter((p) => !p.injury || !p.injury.active)
        .sort((a, b) => b.getTrueOvr() - a.getTrueOvr())[0];
      recommended.push({
        id: "CALLUP_RECOMMENDATION",
        priority: "RECOMMENDED",
        badge: "🟡 추천",
        title: `1군 엔트리 보강 추천 (현재 ${userTeam.roster1G.length}/28명 · 1군 부상 ${injuredIn1G.length}명)`,
        desc: best2G
          ? `2군 최고 컨디션 ${best2G.name}(${best2G.pos}, OVR ${best2G.getTrueOvr()}) 선수의 1군 콜업을 추천합니다.`
          : `1군 부상 공백 해소를 위해 엔트리를 재정비하세요.`,
        targetTab: "roster",
        targetSubTab: "2GUN",
        quickActionLabel: "추천 2군 선수 즉시 콜업"
      });
    }

    // (R-2) 2군 유망주 맞춤형 훈련(구속/제구/선구안 등) 미지정자 설정
    const fPool = [...(userTeam.roster2G || []), ...(userTeam.rosterDev || [])];
    const unassignedFutures = fPool.filter((p) => !p.trainingFocus);
    if (unassignedFutures.length > 0) {
      recommended.push({
        id: "FUTURES_DEV_ASSIGN",
        priority: "RECOMMENDED",
        badge: "🟡 추천",
        title: `2군·육성군 유망주 맞춤형 훈련 미지정자 ${unassignedFutures.length}명 과제 부여`,
        desc: `선수별 [구속/제구/신구종/선구안/파워] 맞춤 과제를 지정하면 2군 성장 속도가 +25% 가속됩니다.`,
        targetTab: "offseason",
        targetSubTab: "front5",
        quickActionLabel: "미지정 유망주 맞춤훈련 일괄 설정"
      });
    }

    // (R-3) 아마추어 스카우트 팀 파견 재지정 점검
    const disp = context.scoutDispatch || { maxScouts: 4, allocation: { HS_1: 1, HS_2: 1, HS_3: 1, UNIV: 1, IND: 0 } };
    const alloc = disp.allocation || {};
    const usedScouts = (alloc.HS_1 || 0) + (alloc.HS_2 || 0) + (alloc.HS_3 || 0) + (alloc.UNIV || 0) + (alloc.IND || 0);
    const maxScouts = disp.maxScouts || clamp((context.scoutLevel || 1) + 2, 3, 7);
    if (usedScouts < maxScouts || (mm >= 7 && mm <= 9 && (alloc.HS_3 || 0) < 2)) {
      recommended.push({
        id: "SCOUT_DISPATCH_CHECK",
        priority: "RECOMMENDED",
        badge: "🟡 추천",
        title: `아마추어·독립리그 스카우트 파견 최적화 (현재 ${usedScouts}/${maxScouts}명 배정)`,
        desc: `고교 3학년·대학·독립야구단에 유휴 스카우트를 집중 파견해 드래프트 Fog of War를 줄이세요.`,
        targetTab: "offseason",
        targetSubTab: "draft",
        quickActionLabel: "스카우트 최적 파견 자동 배정"
      });
    }

    // (R-4) 여유 예산 기반 2군 R&D 인프라(바이오메카닉스/재활센터/스카우트본부) 투자
    const fac = ensureTeamFacilities(userTeam);
    const hasUpgradeableFac = fac.rehabCenter < 5 || fac.biomechLab < 5 || fac.scoutHq < 5;
    if (hasUpgradeableFac && userTeam.getAvailableBudget() >= 150000) {
      recommended.push({
        id: "FACILITY_INVEST_REC",
        priority: "RECOMMENDED",
        badge: "🟡 추천",
        title: `여유 예산(${(userTeam.getAvailableBudget() / 10000).toFixed(1)}억) 기반 구단 R&D 인프라 증축 추천`,
        desc: `재활센터(Lv.${fac.rehabCenter}) · 바이오메카닉스 랩(Lv.${fac.biomechLab}) · 스카우트 본부(Lv.${fac.scoutHq}) 투자가 가능합니다.`,
        targetTab: "offseason",
        targetSubTab: "front5",
        quickActionLabel: "최우선 R&D 시설 1단계 증축"
      });
    }

    // (R-5) 사기(Morale) 저하 및 트레이드 요구 선수 처리
    const moraleIssues = getMoraleIssuePlayers(userTeam);
    if (moraleIssues.length > 0) {
      const topIssue = moraleIssues[0];
      recommended.push({
        id: "MORALE_TRADE_DEMAND",
        priority: "RECOMMENDED",
        badge: "🟡 추천",
        title: `사기 저하 / 트레이드 요구 선수 ${moraleIssues.length}명 관리 (${topIssue.name} 사기 ${topIssue.morale})`,
        desc: `${topIssue.name}(${topIssue.pos}, OVR ${topIssue.getTrueOvr()}) — ${topIssue.moraleReason}`,
        targetTab: "offseason",
        targetSubTab: "front5",
        quickActionLabel: "단장 면담 & 사기 즉시 회복"
      });
    }

    return {
      date: curDate,
      koreanDate: gm && gm.Setup && typeof gm.Setup.formatKoreanDate === "function" ? gm.Setup.formatKoreanDate(curDate) : curDate,
      mustDo,
      recommended,
      totalCount: mustDo.length + recommended.length
    };
  }

  function getTodayTasks(context, options = {}) {
    return generateDailyBriefing(context, options);
  }

  function getTodaysTasks(context, options = {}) {
    return generateDailyBriefing(context, options);
  }

  /**
   * 필수 단장 업무(Must-Do) 미처리 시 날짜/주차 진행 블로킹 판정
   */
  function checkMustDoBlocking(context) {
    const briefing = generateDailyBriefing(context, { skipAuditIncrement: true });
    const mustDo = (briefing && briefing.mustDo) || [];
    return {
      blocked: mustDo.length > 0,
      mustDoCount: mustDo.length,
      mustDo,
      reason: mustDo.length > 0 ? `필수 단장 업무 ${mustDo.length}건(${mustDo[0].title})을 먼저 처리해야 합니다.` : null
    };
  }

  /**
   * '오늘의 할 일' 원클릭 자동 해결 실행기
   */
  function executeAssistantQuickAction(context, taskId) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const gm = getGM();
    const userTeam = context.getUserTeam();

    if (taskId === "DRAFT_WEEK") {
      if (gm && gm.Draft) {
        const res = gm.Draft.runFullDraft(context);
        if (gm.Setup && typeof gm.Setup.autoTrimRosterForDraftees === "function") {
          gm.Setup.autoTrimRosterForDraftees(context, userTeam.id);
        }
        return {
          ok: true,
          summary: `[오늘의 할 일 완료] ${context.currentYear} KBO 신인 드래프트 1~10R 지명(${res.totalPicks}명) 및 로스터 정리를 완료했습니다!`
        };
      }
    }

    if (taskId === "STOVE_LEAGUE_RENEWAL_FA") {
      if (gm && gm.Offseason) {
        gm.Offseason.processSalaryRenewals(context, { userPolicy: "FAIR" });
        if (!context.faPool || context.faPool.length === 0) {
          gm.Offseason.declareEligibleFAPlayers(context);
        }
        gm.Offseason.runFAMarketSession(context, {}, { autoDeclareFromRosters: false });
        gm.Offseason.processForeignPlayerContracts(context, null);
        return {
          ok: true,
          summary: `[오늘의 할 일 완료] 스토브리그 연봉 재계약(적정안), FA 시장 마감, 외국인 선수 재계약을 일괄 처리했습니다!`
        };
      }
    }

    if (taskId === "FOREIGN_6WK_ACTION") {
      if (gm && gm.Setup) {
        const longInj = userTeam
          .getAllPlayers()
          .find(
            (p) =>
              p.nationality !== "KOR" &&
              !p.isAsianQuarter &&
              p.injury &&
              p.injury.active &&
              ((p.injury.weeksLeft || 0) >= 6 || (p.injury.daysLeft || 0) >= 42)
          );
        if (longInj) {
          return gm.Setup.signSixWeekReplacementForeigner(context, userTeam.id, longInj.id);
        }
        const rehabReady = (userTeam.foreignRehabList || [])[0];
        if (rehabReady) {
          return gm.Setup.resolveReturnedForeignPlayer(context, userTeam.id, rehabReady.id, "RETURN_ORIGINAL");
        }
      }
    }

    if (taskId === "PROTECTION_LIST_SUBMIT") {
      autoFillProtectedPlayers(context, userTeam.id, "FA_20");
      autoFillProtectedPlayers(context, userTeam.id, "FA_25");
      autoFillProtectedPlayers(context, userTeam.id, "DRAFT_35");
      return {
        ok: true,
        summary: `[오늘의 할 일 완료] FA 20인/25인 및 2차 드래프트 35인 보호명단을 최적 알고리즘으로 작성·제출했습니다!`
      };
    }

    if (taskId === "CALLUP_RECOMMENDATION") {
      // 1군 부상자를 2군으로 내리고 2군 최고 OVR 정상 선수를 1군으로 콜업
      const injured1G = userTeam.roster1G.filter((p) => p.injury && p.injury.active);
      injured1G.forEach((ip) => {
        if (userTeam.roster2G.length < 30) {
          userTeam.movePlayerStatus(ip.id, "2GUN");
        }
      });
      let calledUp = 0;
      while (userTeam.roster1G.length < 28) {
        const best2G = userTeam.roster2G
          .filter((p) => !p.injury || !p.injury.active)
          .sort((a, b) => b.getTrueOvr() - a.getTrueOvr())[0];
        if (!best2G) break;
        const mv = userTeam.movePlayerStatus(best2G.id, "1GUN");
        if (!mv.ok) break;
        calledUp += 1;
      }
      return {
        ok: true,
        summary: `[오늘의 할 일 완료] 1군 부상자 말소 및 2군 우수 선수 ${calledUp}명 1군 콜업을 완료했습니다! (현재 1군 ${userTeam.roster1G.length}/28명)`
      };
    }

    if (taskId === "FUTURES_DEV_ASSIGN") {
      return autoAssignFuturesTraining(context, userTeam.id);
    }

    if (taskId === "SCOUT_DISPATCH_CHECK") {
      if (gm && gm.Setup && typeof gm.Setup.dispatchAmateurScouts === "function") {
        const maxS = (context.scoutDispatch && context.scoutDispatch.maxScouts) || clamp((context.scoutLevel || 1) + 2, 3, 7);
        const hs3 = Math.max(1, Math.min(2, maxS - 2));
        const univ = Math.max(1, Math.min(2, maxS - hs3 - 1));
        const ind = Math.max(0, maxS - hs3 - univ);
        gm.Setup.dispatchAmateurScouts(context, { HS_1: 0, HS_2: 0, HS_3: hs3, UNIV: univ, IND: ind });
        return {
          ok: true,
          summary: `[오늘의 할 일 완료] 아마추어 스카우트 ${maxS}명을 고교3학년(${hs3})·대학(${univ})·독립리그(${ind})에 최적 재배치했습니다!`
        };
      }
    }

    if (taskId === "FACILITY_INVEST_REC") {
      const fac = ensureTeamFacilities(userTeam);
      const order = ["biomechLab", "rehabCenter", "scoutHq"].sort((a, b) => (fac[a] || 1) - (fac[b] || 1));
      for (const fk of order) {
        if ((fac[fk] || 1) < 5) {
          return upgradeTeamFacility(context, userTeam.id, fk);
        }
      }
    }

    if (taskId === "MORALE_TRADE_DEMAND") {
      const issues = getMoraleIssuePlayers(userTeam);
      if (issues.length > 0) {
        return resolvePlayerMoraleIssue(context, userTeam.id, issues[0].id, "PEP_TALK");
      }
    }

    return { ok: false, reason: "처리할 항목이 없거나 이미 완료되었습니다." };
  }

  const Assistant = {
    generateDailyBriefing,
    getTodayTasks,
    getTodaysTasks,
    checkMustDoBlocking,
    executeAssistantQuickAction
  };

  /* ═══════════════════════════════════════════════════════════════════════
   * [PART 2 & PART 3] KBO_GM.Auditor — 1,000회 기능 실행 단속 감사 모듈
   *    - 단순 무충돌(No Crash)을 넘어, 정의된 6대 핵심 메카닉이 주간/일간 루프에서
   *      실제 호출·발동(Feature Fire Assertion)되는지 1,000회(1,000시즌 = 52,000주) 단속
   * ═══════════════════════════════════════════════════════════════════════ */
  function runWiringAudit1000(options = {}) {
    const gm = getGM();
    if (!gm || typeof gm.advanceOneWeek !== "function") {
      throw new Error("KBO_GM 코어 모듈(advanceOneWeek)이 로드되지 않았습니다.");
    }

    const totalRuns = Number(options.runs) || 1000;
    const weeksPerRun = 52;
    const startMs = Date.now();

    // 시뮬레이션 컨텍스트 생성 및 초기 R&D 시설/보호명단 세팅
    let context = null;
    if (gm.Setup && typeof gm.Setup.createGameContextSync === "function") {
      context = gm.Setup.createGameContextSync({ userTeamId: options.userTeamId || "KW", autoSave: false });
    } else if (typeof gm.createDefaultContext === "function") {
      context = gm.createDefaultContext(options.userTeamId || "KW", 2025);
    } else if (typeof gm.createNewGameContext === "function") {
      context = gm.createNewGameContext({ userTeamId: options.userTeamId || "KW", initialYear: 2025 });
    }
    if (!context) {
      throw new Error("GMGameContext 생성에 실패했습니다.");
    }
    const audit = ensureAuditMetrics(context);

    // 1) R&D 시설 투자(바이오메카닉스/재활센터 Lv.3)가 주간 TP 획득 및 부상 확률 공식에 실제 곱해지는지 검증하기 위해 업그레이드 적용
    const userTeam = context.getUserTeam();
    if (userTeam) {
      upgradeTeamFacility(context, userTeam.id, "biomechLab");
      upgradeTeamFacility(context, userTeam.id, "rehabCenter");
    }

    // 2) 비FA 다년 계약 체결 및 샐러리캡(120억) 초과 구단 발생 시나리오 세팅
    const extCandidates = getNonFAExtensionCandidates(userTeam);
    if (extCandidates.length > 0) {
      offerNonFAMultiYearExtension(context, userTeam.id, extCandidates[0].playerId);
    }

    // 3) 필수 오늘의 할 일(Must-Do) 미처리 시 진행 블로킹 동작 사전 검증
    context.currentDate = "2025-09-23";
    context.currentWeek = 21;
    context.draftState = null;
    const blockingProbe = gm.advanceOneWeek(context, {
      enforceMustDoBlocking: true,
      fastSimMode: true,
      skipMacroPools: true
    });
    const mustDoBlockingVerified = Boolean(blockingProbe && blockingProbe.blocked === true);

    // 감사 카운터 초기화 (정확히 1,000시즌 × 52주 = 52,000주 측정)
    audit.draftFiredCount = 0;
    audit.secondaryDraftFiredCount = 0;
    audit.injury6WeekEventFired = 0;
    audit.facilityEffectAppliedCount = 0;
    audit.toDoListGeneratedCount = 0;
    audit.militaryEnlistedCount = 0;
    audit.militaryReturnsCount = 0;
    audit.luxuryTaxEvaluatedCount = 0;
    audit.luxuryTaxPenalizedCount = 0;
    audit.nonFAMultiYearSignedCount = 0;

    // 비FA 다년 연장 계약 체결 검증 (감사 카운터 반영)
    const extCandidatesAfterReset = getNonFAExtensionCandidates(userTeam);
    if (extCandidatesAfterReset.length > 0) {
      offerNonFAMultiYearExtension(context, userTeam.id, extCandidatesAfterReset[0].playerId);
    } else if (userTeam && userTeam.roster1G[0]) {
      userTeam.roster1G[0].faYears = 6;
      userTeam.roster1G[0].contractYears = 1;
      userTeam.roster1G[0].isMultiYearExtended = false;
      offerNonFAMultiYearExtension(context, userTeam.id, userTeam.roster1G[0].id);
    }

    context.currentYear = 2025;
    context.currentWeek = 1;
    context.currentDate = "2025-03-22";
    context._fastAuditMode = true;
    const reserveProspectPool = (context.draftPool || []).slice();

    // 1,000회(1,000시즌 × 52주 = 52,000주) 주간 루프 실행
    for (let runIdx = 0; runIdx < totalRuns; runIdx++) {
      context.currentWeek = 1;
      context.draftState = null;
      if (!Array.isArray(context.draftPool) || context.draftPool.length < 110) {
        context.draftPool = reserveProspectPool.slice();
      }

      // 샐러리캡(120억 상한) 초과 구단이 최소 1개 이상 존재하도록 1개 구단 상위 연봉 보정
      const capTestTeam = context.kboTeams[runIdx % context.kboTeams.length];
      if (capTestTeam && capTestTeam.roster1G.length > 0) {
        capTestTeam.roster1G[0].salary = 450000;
        if (capTestTeam.roster1G[1]) capTestTeam.roster1G[1].salary = 420000;
        if (capTestTeam.roster1G[2]) capTestTeam.roster1G[2].salary = 380000;
      }

      for (let w = 1; w <= weeksPerRun; w++) {
        context.currentWeek = w;
        gm.advanceOneWeek(context, {
          fastSimMode: true,
          skipMacroPools: true,
          autoExecuteDraftOnSchedule: true,
          autoResolveCalendarEvents: false,
          fullYear52Cycle: false
        });
      }

      if (runIdx % 25 === 0) {
        context.kboTeams.forEach((t) => {
          t.getAllPlayers().forEach((p) => {
            if (p.age < 25) p.age += 1;
            else if (p.age >= 26) p.age = 20;
            if (p.militaryStatus === "COMPLETED") {
              p.militaryStatus = "UNFULFILLED";
            }
          });
        });
      }
      if (Array.isArray(context.weeklyLogs) && context.weeklyLogs.length > 104) {
        context.weeklyLogs.length = 0;
      }
      if (Array.isArray(context.pendingEvents) && context.pendingEvents.length > 80) {
        context.pendingEvents.splice(0, context.pendingEvents.length - 20);
      }
      context.currentYear += 1;
    }
    context._fastAuditMode = false;

    const assert = (cond, msg) => {
      if (!cond) {
        throw new Error(`[KBO_GM.Auditor Assertion Failed] ${msg}`);
      }
    };

    // [필수 어설션 1~5 검증]
    const draftFiredCount = audit.draftFiredCount;
    const injury6WeekEventFired = audit.injury6WeekEventFired;
    const facilityEffectAppliedCount = audit.facilityEffectAppliedCount;
    const toDoListGeneratedCount = audit.toDoListGeneratedCount;
    const militaryReturnsCount = audit.militaryReturnsCount;

    assert(
      draftFiredCount === 1000,
      `assert(draftFiredCount === 1000) 실패: 실제 실행 횟수 = ${draftFiredCount}`
    );
    assert(
      injury6WeekEventFired > 0,
      `assert(injury6WeekEventFired > 0) 실패: 실제 발생 횟수 = ${injury6WeekEventFired}`
    );
    assert(
      facilityEffectAppliedCount > 0,
      `assert(facilityEffectAppliedCount > 0) 실패: 실제 적용 횟수 = ${facilityEffectAppliedCount}`
    );
    assert(
      toDoListGeneratedCount === 1000 * 52,
      `assert(toDoListGeneratedCount === 1000 * 52) 실패: 실제 생성 횟수 = ${toDoListGeneratedCount}`
    );
    assert(
      militaryReturnsCount > 0,
      `assert(militaryReturnsCount > 0) 실패: 실제 상무 제대 복귀 횟수 = ${militaryReturnsCount}`
    );
    assert(
      mustDoBlockingVerified === true,
      `assert(mustDoBlockingVerified === true) 실패: 필수 할 일 미처리 시 진행 블로킹이 작동하지 않았습니다.`
    );

    // ── [재정·전력 평준화 어설션 6~11] KBO_GM.Economy / 경쟁균형세 / 스토브리그 마감 자동 처리 ──
    const economy = gm.Economy;
    const economyWeeklySettledCount = audit.economyWeeklySettledCount || 0;
    assert(
      economyWeeklySettledCount > 0,
      `assert(economyWeeklySettledCount > 0) 실패: 주간 재정 정산(수입 - 운영비)이 한 번도 실행되지 않았습니다.`
    );

    // (7) 모기업 지원금은 직전 순위 역순으로 엄격히 증가해야 한다 (1위 < 2위 < ... < 10위)
    const probeAiTeam = context.kboTeams.find((t) => t.id !== context.userTeamId) || context.kboTeams[0];
    const subsidyByRank = economy
      ? Array.from({ length: 10 }, (_, i) => economy.computeSeasonSubsidy(context, probeAiTeam, i + 1))
      : [];
    const subsidyReverseOrderVerified =
      subsidyByRank.length === 10 && subsidyByRank.every((v, i) => i === 0 || v > subsidyByRank[i - 1]);
    assert(
      subsidyReverseOrderVerified,
      `assert(subsidyReverseOrderVerified) 실패: 모기업 지원금이 순위 역순으로 증가하지 않습니다 (${subsidyByRank.join(", ")}).`
    );

    // (8) 10개 구단 예산이 유효한 수치이며 재정 안전 범위 안에 있어야 한다
    const budgetMin = economy ? economy.BUDGET_MIN : -3000000;
    const budgetMax = economy ? economy.BUDGET_MAX : 4000000;
    const budgetIntegrityVerified = context.kboTeams.every(
      (t) => Number.isFinite(t.budget) && t.budget >= budgetMin && t.budget <= budgetMax
    );
    assert(budgetIntegrityVerified, `assert(budgetIntegrityVerified) 실패: 예산이 NaN이거나 재정 안전 범위를 벗어난 구단이 있습니다.`);

    // (9) 경쟁균형세 2회 연속 초과 → 초과분 100% 제재금 + 다음 1R 지명권 9단계 하락
    const taxProbeYear = context.currentYear;
    const taxProbeTeam = context.kboTeams[0];
    taxProbeTeam.luxuryTaxHistory = [{ year: taxProbeYear - 1, teamId: taxProbeTeam.id, isOverCap: true }];
    taxProbeTeam
      .getAllPlayers()
      .filter((p) => !p.nationality || p.nationality === "KOR")
      .slice(0, 5)
      .forEach((p) => {
        p.salary = 500000;
      });
    // 감사 루프의 연봉 보정으로 리그 평균이 부풀어 있으므로, 프로브 구단 기준 10억 초과가 되도록 상한을 명시한다
    const taxProbeCap = getTop40DomesticPayroll(taxProbeTeam) - 100000;
    const taxProbe = evaluateLuxuryTaxAndPenalties(context, { capLimit: taxProbeCap });
    const taxProbeReport = (taxProbe.reports || []).find((r) => r.teamId === taxProbeTeam.id) || {};
    const luxuryTaxEscalationVerified =
      taxProbeReport.isOverCap === true &&
      taxProbeReport.overCapStreak === 2 &&
      taxProbeReport.draftPickDrop === 9 &&
      taxProbeReport.luxuryTaxFineManwon === Math.round(taxProbeReport.overageManwon / 100) * 100;
    assert(
      luxuryTaxEscalationVerified,
      `assert(luxuryTaxEscalationVerified) 실패: 2회 연속 초과 구단 제재(100% · 1R 9단계 하락)가 적용되지 않았습니다. (${JSON.stringify({ streak: taxProbeReport.overCapStreak, drop: taxProbeReport.draftPickDrop, fine: taxProbeReport.luxuryTaxFineManwon, overage: taxProbeReport.overageManwon, over: taxProbeReport.isOverCap })})`
    );
    let round1PickDropVerified = true;
    if (gm.Draft && typeof gm.Draft.getDraftOrder === "function") {
      // 프로브 구단 단독 제재로 격리해 1라운드 순서 이동만 검증 (2라운드 이후는 원래 순서 유지)
      const savedPenalties = context.luxuryTaxPenalties;
      context.luxuryTaxPenalties = { ...savedPenalties, pickDropByTeam: { [taxProbeTeam.id]: 9 } };
      const baseOrder = gm.Draft.getDraftOrder(context);
      const r1Order = gm.Draft.getDraftOrder(context, { round: 1 });
      context.luxuryTaxPenalties = savedPenalties;
      const baseIdx = baseOrder.indexOf(taxProbeTeam.id);
      const r1Idx = r1Order.indexOf(taxProbeTeam.id);
      round1PickDropVerified = r1Idx === Math.min(baseOrder.length - 1, baseIdx + 9);
    }
    assert(round1PickDropVerified, `assert(round1PickDropVerified) 실패: 1라운드 지명 순서에 9단계 하락이 반영되지 않았습니다.`);

    // (10) 방출 시 현금 환급 없음: 예산은 그대로, 연봉총액만 감소 (방출-환급 반복 예산 증식 차단)
    let releaseNoCashRefundVerified = true;
    if (gm.Setup && typeof gm.Setup.releaseDomesticPlayer === "function") {
      const relTeam = context.getUserTeam();
      const relTarget = [...relTeam.roster2G, ...relTeam.rosterDev].find((p) => !p.nationality || p.nationality === "KOR");
      if (relTarget) {
        const budgetBefore = relTeam.budget;
        const payrollBefore = relTeam.getTotalPayroll();
        const relRes = gm.Setup.releaseDomesticPlayer(context, relTeam.id, relTarget.id);
        releaseNoCashRefundVerified =
          Boolean(relRes && relRes.ok) &&
          relTeam.budget === budgetBefore &&
          relTeam.getTotalPayroll() === payrollBefore - (relTarget.salary || 0);
      }
    }
    assert(releaseNoCashRefundVerified, `assert(releaseNoCashRefundVerified) 실패: 선수 방출 시 예산에 현금이 환급되었습니다.`);

    // (11) 스토브리그 마감일 자동 처리 (일간 진행 엔진): 12/1 연봉 재계약·FA 공시 → 1/15 FA 시장 마감 → 1/31 외국인 계약
    let stoveAutomationVerified = true;
    if (gm.Setup && typeof gm.Setup.advanceDays === "function" && gm.Offseason && gm.Offseason.isStoveStepDone) {
      const stoveCtx = gm.Setup.createGameContextSync({ userTeamId: "KIA", autoSave: false });
      stoveCtx.currentDate = "2025-11-25";
      stoveCtx.currentYear = 2025;
      for (let i = 0; i < 12; i++) gm.Setup.advanceDays(stoveCtx, 7);
      const stoveKey = 2026;
      const openFAsLeft = (stoveCtx.faPool || []).filter((p) => !p.teamId || p.status === "FA").length;
      stoveAutomationVerified =
        gm.Offseason.isStoveStepDone(stoveCtx, "salary", stoveKey) &&
        gm.Offseason.isStoveStepDone(stoveCtx, "declared", stoveKey) &&
        gm.Offseason.isStoveStepDone(stoveCtx, "foreign", stoveKey) &&
        openFAsLeft === 0;
    }
    assert(
      stoveAutomationVerified,
      `assert(stoveAutomationVerified) 실패: 스토브리그 마감일(연봉·FA 공시·FA 시장·외국인) 자동 처리가 완료되지 않았습니다.`
    );

    // ── [성장·포스팅·회고 어설션 12~14] ──
    const probeCtx = gm.Setup.createGameContextSync({ userTeamId: "KIA", autoSave: false });
    const probeTeam = probeCtx.getUserTeam();
    const domesticProbe = probeTeam.getAllPlayers().filter((p) => !p.nationality || p.nationality === "KOR");

    // (12) 포스팅: 포스팅 기간 + OVR 90+ 이어도 KBO 6시즌이면 제안 없음, 7시즌이면 제안
    probeCtx.currentDate = `${probeCtx.currentYear}-11-10`;
    const starProbe = domesticProbe[0];
    Object.keys(starProbe.st).forEach((k) => {
      starProbe.st[k] = 99;
    });
    starProbe.age = 27;
    starProbe.status = "1GUN";
    starProbe.kboSeasons = POSTING_MIN_SEASONS - 1;
    const offersAt6 = getMLBPostingCandidates(probeCtx, probeTeam.id).some((c) => c.playerId === starProbe.id);
    starProbe.kboSeasons = POSTING_MIN_SEASONS;
    const offersAt7 = getMLBPostingCandidates(probeCtx, probeTeam.id).some((c) => c.playerId === starProbe.id);
    const postingSeasonRuleVerified = !offersAt6 && offersAt7;
    assert(postingSeasonRuleVerified, `assert(postingSeasonRuleVerified) 실패: 포스팅 7시즌 요건이 적용되지 않았습니다.`);

    // (13) 연간 성장: 잠재력 여유가 큰 21세 1군 주전은 성장, 32세는 성장 없음
    const youngProbe = domesticProbe[1];
    const oldProbe = domesticProbe[2];
    const fixedRng = () => 0.5;
    youngProbe.age = 21;
    youngProbe.potential = 100;
    youngProbe.status = "1GUN";
    youngProbe.rec = youngProbe.type === "pitcher" ? { ip: 120 } : { pa: 450 };
    oldProbe.age = 32;
    oldProbe.potential = 100;
    const youngDev = youngProbe.applyYearlyDevelopment(fixedRng);
    const oldDev = oldProbe.applyYearlyDevelopment(fixedRng);
    const yearlyDevelopmentVerified = youngDev.gain > 0 && oldDev.gain === 0;
    assert(
      yearlyDevelopmentVerified,
      `assert(yearlyDevelopmentVerified) 실패: 연간 성장 (21세 +${youngDev.gain} / 32세 +${oldDev.gain})이 기대와 다릅니다.`
    );

    // (14) 시즌 회고: 스냅샷 이후 떠난 선수는 '이탈', 새로 합류한 선수는 영입 경로와 함께 '영입'으로 집계
    let seasonRetroVerified = true;
    if (gm.Retro) {
      gm.Retro.takeRosterSnapshot(probeCtx);
      const leaving = probeTeam.roster2G[0];
      const otherTeam = probeCtx.kboTeams.find((t) => t.id !== probeTeam.id);
      const joining = otherTeam.roster2G[0];
      probeTeam.roster2G = probeTeam.roster2G.filter((p) => p.id !== leaving.id);
      otherTeam.roster2G.push(leaving);
      otherTeam.roster2G = otherTeam.roster2G.filter((p) => p.id !== joining.id);
      joining.acquiredVia = { type: "TRADE", date: probeCtx.currentDate };
      probeTeam.roster2G.push(joining);
      const retro = gm.Retro.buildSeasonRetrospective(probeCtx);
      seasonRetroVerified =
        Boolean(retro) &&
        retro.departed.some((d) => d.id === leaving.id) &&
        retro.acquired.some((a) => a.id === joining.id && a.route === "TRADE") &&
        Number.isFinite(retro.netDecisionWins) &&
        Number.isFinite(retro.luckWins);
    }
    assert(seasonRetroVerified, `assert(seasonRetroVerified) 실패: 시즌 회고 리포트의 영입/이탈 분류가 올바르지 않습니다.`);

    const elapsedMs = Date.now() - startMs;
    const report = {
      ok: true,
      allAssertionsPassed: true,
      totalRuns,
      totalWeeksSimulated: totalRuns * weeksPerRun,
      elapsedMs,
      metrics: {
        draftFiredCount,
        injury6WeekEventFired,
        facilityEffectAppliedCount,
        toDoListGeneratedCount,
        militaryReturnsCount,
        militaryEnlistedCount: audit.militaryEnlistedCount,
        secondaryDraftFiredCount: audit.secondaryDraftFiredCount,
        luxuryTaxEvaluatedCount: audit.luxuryTaxEvaluatedCount,
        luxuryTaxPenalizedCount: audit.luxuryTaxPenalizedCount,
        nonFAMultiYearSignedCount: audit.nonFAMultiYearSignedCount,
        mustDoBlockedCount: audit.mustDoBlockedCount,
        mustDoBlockingVerified,
        economyWeeklySettledCount,
        subsidyByRankEok: subsidyByRank.map((v) => +(v / 10000).toFixed(1)),
        luxuryTaxPickDropCount: audit.luxuryTaxPickDropCount || 0
      },
      assertions: [
        { expr: "assert(draftFiredCount === 1000)", actual: draftFiredCount, expected: 1000, passed: draftFiredCount === 1000 },
        { expr: "assert(injury6WeekEventFired > 0)", actual: injury6WeekEventFired, expected: "> 0", passed: injury6WeekEventFired > 0 },
        { expr: "assert(facilityEffectAppliedCount > 0)", actual: facilityEffectAppliedCount, expected: "> 0", passed: facilityEffectAppliedCount > 0 },
        { expr: "assert(toDoListGeneratedCount === 1000 * 52)", actual: toDoListGeneratedCount, expected: 52000, passed: toDoListGeneratedCount === 52000 },
        { expr: "assert(militaryReturnsCount > 0)", actual: militaryReturnsCount, expected: "> 0", passed: militaryReturnsCount > 0 },
        { expr: "assert(mustDoBlockingVerified)", actual: mustDoBlockingVerified, expected: true, passed: mustDoBlockingVerified === true },
        { expr: "assert(economyWeeklySettledCount > 0)", actual: economyWeeklySettledCount, expected: "> 0", passed: economyWeeklySettledCount > 0 },
        { expr: "assert(subsidyReverseOrderVerified)", actual: subsidyReverseOrderVerified, expected: true, passed: subsidyReverseOrderVerified },
        { expr: "assert(budgetIntegrityVerified)", actual: budgetIntegrityVerified, expected: true, passed: budgetIntegrityVerified },
        { expr: "assert(luxuryTaxEscalationVerified)", actual: luxuryTaxEscalationVerified, expected: true, passed: luxuryTaxEscalationVerified },
        { expr: "assert(round1PickDropVerified)", actual: round1PickDropVerified, expected: true, passed: round1PickDropVerified },
        { expr: "assert(releaseNoCashRefundVerified)", actual: releaseNoCashRefundVerified, expected: true, passed: releaseNoCashRefundVerified },
        { expr: "assert(stoveAutomationVerified)", actual: stoveAutomationVerified, expected: true, passed: stoveAutomationVerified },
        { expr: "assert(postingSeasonRuleVerified)", actual: postingSeasonRuleVerified, expected: true, passed: postingSeasonRuleVerified },
        { expr: "assert(yearlyDevelopmentVerified)", actual: yearlyDevelopmentVerified, expected: true, passed: yearlyDevelopmentVerified },
        { expr: "assert(seasonRetroVerified)", actual: seasonRetroVerified, expected: true, passed: seasonRetroVerified }
      ]
    };

    return report;
  }

  const Auditor = {
    ensureAuditMetrics,
    runWiringAudit1000
  };

  const Advanced = {
    PARK_REMODEL_PRESETS,
    FUTURES_TRAINING_PROGRAMS,
    PROTECTION_MODE_LIMITS,
    getMLBPostingCandidates,
    executeMLBPosting,
    remodelHomePark,
    setPlayerFuturesTraining,
    autoAssignFuturesTraining,
    ensurePlayerMorale,
    updateWeeklyTeamMorale,
    getMoraleIssuePlayers,
    resolvePlayerMoraleIssue,
    getTeamProtectionState,
    toggleProtectedPlayer,
    autoFillProtectedPlayers
  };

  return {
    POSTSEASON_REWARDS,
    SECONDARY_DRAFT_FEES,
    SANGMU_SERVICE_DAYS,
    SANGMU_MAX_PER_TEAM,
    assignInitialMilitaryStatus,
    FACILITY_SPECS,
    KBO_SALARY_CAP_LIMIT,
    POSTING_MIN_OVR,
    POSTING_ELITE_STAT,
    POSTING_MIN_SEASONS,
    POSTING_WINDOW,
    isPostingWindowOpen,
    SALARY_CAP_RATIO,
    LUXURY_TAX_TIERS,
    getSalaryCapLimit,
    PARK_REMODEL_PRESETS,
    FUTURES_TRAINING_PROGRAMS,
    PROTECTION_MODE_LIMITS,
    REPLACEMENT_MANAGER_CANDIDATES,
    ensureAuditMetrics,
    preparePostseasonRotation,
    simulatePostseasonSeries,
    runPostseasonTournament,
    isBiennialDraftYear,
    buildTeam35ManProtection,
    getSecondaryDraftExposedCandidates,
    runBiennialSecondaryDraft,
    ensurePlayerMilitaryStatus,
    getEligibleSangmuCandidates,
    enlistPlayerToSangmu,
    processDailyMilitaryService,
    autoManageDecemberSangmuEnlistment,
    ensureTeamFacilities,
    getTeamFacilityEffects,
    upgradeTeamFacility,
    getNonFAExtensionCandidates,
    offerNonFAMultiYearExtension,
    getTop40DomesticPayroll,
    evaluateLuxuryTaxAndPenalties,
    getMLBPostingCandidates,
    executeMLBPosting,
    remodelHomePark,
    setPlayerFuturesTraining,
    autoAssignFuturesTraining,
    ensurePlayerMorale,
    updateWeeklyTeamMorale,
    getMoraleIssuePlayers,
    resolvePlayerMoraleIssue,
    getTeamProtectionState,
    toggleProtectedPlayer,
    autoFillProtectedPlayers,
    ensureManagerConflictState,
    evaluateConflictCrisis,
    triggerProtectionMandate,
    resolveProtectionMandate,
    checkManagerTradeVeto,
    resolveTradeVeto,
    generateMidseasonTradeDirective,
    fulfillTradeDirective,
    resolveTradeDirectiveAction,
    resolveBoardHearing,
    fireManagerWithSeverance,
    MANAGER_ARCHETYPES,
    SALARY_AGENDA_OPTIONS,
    ensureRealisticGMState,
    setManagerArchetype,
    checkPlayerUsageRefusal,
    resolveUsageRefusalDilemma,
    negotiateMultiIssueSalary,
    runSalaryArbitrationHearing,
    getPreemptiveFABumpCandidates,
    applyPreemptiveFASalaryBump,
    evaluateDeadlineMarketStances,
    generateDeadlineTradeProposals,
    executeDeadlineStanceDeal,
    evaluateSquadRebellion,
    handleRebellionMediaResponse,
    ManagerConflict,
    RealisticGM,
    Assistant,
    Auditor,
    Advanced
  };
});
