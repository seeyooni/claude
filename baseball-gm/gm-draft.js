/**
 * KBO 단장 모드 (v1.0) — Step 3-1: 고교/대학 아마추어 신인 드래프트 시뮬레이션 모듈 (KBO_GM.Draft)
 * 의존 모듈:
 *   - Step 1-1: /public/gm-schema.js (Player, Team, GMGameContext)
 *   - Phase 2:  /public/gm-weekly-sim.js (calculateKBOStandings)
 * 실행 환경: Client-Side Standalone (window.KBO_GM.Draft) & Node/CommonJS 호환
 */

(function (root, factory) {
  const draftModule = factory(root.KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM));
  if (typeof globalThis !== "undefined") {
    globalThis.KBO_GM = Object.assign(globalThis.KBO_GM || {}, { Draft: draftModule });
  }
  if (typeof window !== "undefined") {
    window.KBO_GM = Object.assign(window.KBO_GM || {}, { Draft: draftModule });
  }
  if (typeof module === "object" && module.exports) {
    module.exports = draftModule;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function (KBO_GM) {
  "use strict";

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const TOTAL_ROUNDS = 10;
  // 1~3라운드는 단장이 직접 지명, 4라운드부터는 스카우트팀 위임 (단장 거부권 없음)
  const DELEGATE_FROM_ROUND = 4;

  // 라운드별 표준 계약금 테이블 (단위: 만원, 10,000 = 1억원)
  const ROUND_BONUS_TABLE = {
    1:  { min: 30000, max: 50000 }, // 1R: 3억 ~ 5억원
    2:  { min: 15000, max: 20000 }, // 2R: 1.5억 ~ 2억원
    3:  { min: 10000, max: 13000 }, // 3R: 1억 ~ 1.3억원
    4:  { min: 7500,  max: 9000  }, // 4R: 7,500만 ~ 9,000만원
    5:  { min: 6000,  max: 7000  }, // 5R: 6,000만 ~ 7,000만원
    6:  { min: 5000,  max: 5500  }, // 6R: 5,000만 ~ 5,500만원
    7:  { min: 4000,  max: 4500  }, // 7R: 4,000만 ~ 4,500만원
    8:  { min: 3500,  max: 4000  }, // 8R: 3,500만 ~ 4,000만원
    9:  { min: 3000,  max: 3500  }, // 9R: 3,000만 ~ 3,500만원
    10: { min: 3000,  max: 3000  }  // 10R: 3,000만원
  };

  // 구단별 적정 보유 목표 인원 (1군+2군+육성 합산 기준)
  const TARGET_POS_DEPTH = {
    SP: 12,
    RP: 16,
    CP: 3,
    C:  6,
    "1B": 4,
    "2B": 5,
    "3B": 4,
    SS: 5,
    LF: 4,
    CF: 5,
    RF: 4,
    DH: 2
  };

  /* ═══════════════════════════════════════════════════════════════════════
   * 1. 지명 순서(전년도/현재 순위 역순) 및 계약금 산출
   * ═══════════════════════════════════════════════════════════════════════ */
  /**
   * 전년도/현재 성적 역순(10위 -> 1위)으로 10개 구단 지명 순서 반환
   * - options.useLottery === true 설정 시 하위 3개 구단 확률 추첨(로터리) 지원
   */
  function getDraftOrder(context, options = {}) {
    if (!context || !Array.isArray(context.kboTeams)) return [];
    const rng = options.rng || Math.random;

    // 순위표가 이미 있으면 활용, 없으면 팀 승률/득실차 기준으로 계산
    const teamsWithStats = context.kboTeams.map((team, idx) => {
      const rec = team.record || { w: 0, l: 0, d: 0, rs: 0, ra: 0 };
      const dec = (rec.w || 0) + (rec.l || 0);
      const winPct = dec > 0 ? (rec.w || 0) / dec : 0.5;
      const runDiff = (rec.rs || 0) - (rec.ra || 0);
      return {
        teamId: team.id,
        teamName: team.name,
        winPct,
        w: rec.w || 0,
        runDiff,
        initialIdx: idx
      };
    });

    // 성적 역순 정렬 (승률 오름차순 -> 다승 오름차순 -> 득실차 오름차순)
    teamsWithStats.sort(
      (a, b) => a.winPct - b.winPct || a.w - b.w || a.runDiff - b.runDiff || b.initialIdx - a.initialIdx
    );

    const orderIds = teamsWithStats.map((x) => x.teamId);

    // [PART 4-5] 경쟁균형세 2회 이상 연속 초과 구단: 1라운드 지명 순위 9단계 하락 (options.round === 1 일 때만)
    const pickDrops = (context.luxuryTaxPenalties && context.luxuryTaxPenalties.pickDropByTeam) || {};
    if (options.round === 1 && Object.keys(pickDrops).length > 0) {
      Object.keys(pickDrops).forEach((penTeamId) => {
        const curIdx = orderIds.indexOf(penTeamId);
        if (curIdx !== -1 && curIdx < orderIds.length - 1) {
          orderIds.splice(curIdx, 1);
          const targetIdx = Math.min(orderIds.length, curIdx + (Number(pickDrops[penTeamId]) || 0));
          orderIds.splice(targetIdx, 0, penTeamId);
        }
      });
    }

    // 로터리 옵션 활성화 시 하위 3개 팀(1~3순위) 가중 추첨
    if (options.useLottery && orderIds.length >= 3) {
      const bottom3 = orderIds.slice(0, 3);
      const weights = [0.50, 0.33, 0.17];
      const lotteryOrder = [];
      while (bottom3.length > 0) {
        const totalW = weights.reduce((a, b) => a + b, 0);
        let r = rng() * totalW;
        let chosenIdx = 0;
        for (let i = 0; i < bottom3.length; i++) {
          r -= weights[i];
          if (r <= 0) {
            chosenIdx = i;
            break;
          }
        }
        lotteryOrder.push(bottom3.splice(chosenIdx, 1)[0]);
        weights.splice(chosenIdx, 1);
      }
      return [...lotteryOrder, ...orderIds.slice(3)];
    }

    return orderIds;
  }

  /**
   * 구단명에서 뒤의 마스코트 이름만 추출 (예: '대구 표범즈' -> '표범즈', '광주 고양이즈' -> '고양이즈')
   */
  const MASCOT_FALLBACK_MAP = {
    KIA: "고양이즈",
    SAM: "표범즈",
    LG:  "쌍둥이즈",
    DOO: "판다즈",
    KT:  "도깨비즈",
    SSG: "물범즈",
    LOT: "갈매기즈",
    HAN: "송골매즈",
    NC:  "도마뱀즈",
    KIW: "용사즈"
  };

  function getTeamShortName(context, teamId) {
    if (MASCOT_FALLBACK_MAP[teamId]) return MASCOT_FALLBACK_MAP[teamId];
    const team = context && context.getTeam ? context.getTeam(teamId) : null;
    if (team && team.name) {
      const parts = String(team.name).trim().split(/\s+/);
      return parts.length > 1 ? parts[parts.length - 1] : team.name;
    }
    return teamId;
  }

  /**
   * 특정 라운드·슬롯의 실제 지명권 행사 구단 조회 (지명권 트레이드 양도 반영)
   */
  function getPickOwnerTeamId(context, roundNumber, originalTeamId) {
    if (!context || !Array.isArray(context.tradedPicks)) return originalTeamId;
    const curYear = context.currentYear || 2025;
    const traded = context.tradedPicks.find(
      (tp) =>
        Number(tp.round) === Number(roundNumber) &&
        tp.originalTeamId === originalTeamId &&
        (!tp.year || Number(tp.year) === curYear)
    );
    return traded ? traded.currentOwnerTeamId : originalTeamId;
  }

  /**
   * 라운드 및 라운드 내 순번(1~10순위)에 따른 신인 계약금(만원 단위) 산출
   */
  function calculateSigningBonus(roundNumber, pickInRound, player = null) {
    const tier = ROUND_BONUS_TABLE[clamp(roundNumber, 1, 10)] || { min: 3000, max: 3000 };
    // pickInRound: 1(전체 1순위 쪽) -> max, 10(라운드 마지막 픽) -> min
    const ratio = clamp((10 - pickInRound) / 9, 0, 1);
    let bonus = tier.min + (tier.max - tier.min) * ratio;

    // 1라운드 초특급 유망주(잠재력 92 이상) 소폭 프리미엄
    if (roundNumber === 1 && player && (player.potential || 0) >= 92) {
      bonus += 2000;
    }
    return Math.round(bonus / 500) * 500;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 2. 구단별 포지션 약점(Need) 분석 및 AI 유망주 평가(BPA + Need + Fog of War)
   * ═══════════════════════════════════════════════════════════════════════ */
  /**
   * 특정 구단의 포지션별 뎁스·평균 능력치·고령화도를 분석하여 포지션별 보강 필요도(Need Score: 0~18) 산출
   */
  function analyzeTeamNeeds(team) {
    const allPlayers = team.getAllPlayers ? team.getAllPlayers() : [...(team.roster1G || []), ...(team.roster2G || []), ...(team.rosterDev || [])];
    const needs = {};

    Object.keys(TARGET_POS_DEPTH).forEach((pos) => {
      const targetCount = TARGET_POS_DEPTH[pos];
      const group = allPlayers.filter((p) => p.pos === pos);
      const count = group.length;

      // 상위 주전급(1~2명, 선발투수는 4명) 평균 능력치 및 연령 확인
      const topSliceCount = pos === "SP" ? 4 : pos === "RP" ? 4 : 2;
      const sorted = group.slice().sort((a, b) => b.getTrueOvr() - a.getTrueOvr());
      const topGroup = sorted.slice(0, topSliceCount);

      const avgTopOvr = topGroup.length
        ? topGroup.reduce((sum, p) => sum + p.getTrueOvr(), 0) / topGroup.length
        : 55;
      const avgTopAge = topGroup.length
        ? topGroup.reduce((sum, p) => sum + (p.age || 26), 0) / topGroup.length
        : 30;

      // 1) 머릿수 부족분 점수
      const depthShortage = Math.max(0, targetCount - count) * 2.2;
      // 2) 주전 능력치 열세 점수 (기준 74점 대비)
      const qualityGap = Math.max(0, 74 - avgTopOvr) * 0.65;
      // 3) 주전 고령화 점수 (평균 30세 초과 시 세대교체 필요)
      const agingUrgency = Math.max(0, avgTopAge - 30) * 1.1;

      needs[pos] = +clamp(depthShortage + qualityGap + agingUrgency, 0, 18).toFixed(2);
    });

    return needs;
  }

  /**
   * 특정 구단 관점에서 드래프트 후보 유망주 1명의 지명 매력도(Draft Value Score) 계산
   * - Fog of War(스카우팅 오차) 반영
   * - 라운드별 BPA(최고 유망주) vs 포지션 보강(Need) 가중치 차등 적용
   */
  function evaluateProspectForTeam(team, prospect, context, roundNumber = 1, teamNeeds = null, rng = Math.random) {
    const needs = teamNeeds || analyzeTeamNeeds(team);
    const isUserTeam = context && team.id === context.userTeamId;

    // 1. 스카우팅 오차(Fog of War)가 반영된 체감 현재 능력치(perceivedOvr) 및 체감 잠재력
    const se = prospect.scoutError || { ovrMin: 50, ovrMax: 65 };
    const scoutMidOvr = ((se.ovrMin || 50) + (se.ovrMax || 65)) / 2;

    let perceivedOvr = scoutMidOvr;
    let perceivedPot = prospect.potential || 75;

    if (!isUserTeam) {
      // AI 구단별 자체 스카우팅 시각차 (±3.5 오차)
      const aiNoise = (rng() * 2 - 1) * 3.5;
      perceivedOvr = scoutMidOvr + aiNoise;
      perceivedPot = (prospect.potential || 75) + aiNoise * 0.8;
    } else {
      // 유저 구단 추천 점수는 스카우트 품질(레벨·조사도·단장 직관)에 따른 추정 잠재력만 사용 (실제 잠재력은 알 수 없음)
      const setup = KBO_GM && KBO_GM.Setup;
      const pp = setup && typeof setup.getPerceivedPotential === "function" ? setup.getPerceivedPotential(context, prospect) : null;
      perceivedPot = pp ? pp.center : prospect.potential || 75;
    }

    // 2. 감독 스타일('육성' | '윈나우' | '데이터' | '균형') 반영
    const mgrStyle = (team.coachingStaff && team.coachingStaff.manager && team.coachingStaff.manager.style) || "균형";
    let ovrWeight = 0.52;
    let potWeight = 0.48;
    if (mgrStyle === "육성") {
      ovrWeight = 0.42;
      potWeight = 0.58;
    } else if (mgrStyle === "윈나우") {
      ovrWeight = 0.62;
      potWeight = 0.38;
    }

    // 고졸(HS) 유망주는 성장 기간 가산점, 대졸(UNIV)은 즉시전력감(4R 이후) 가산점
    const originBonus =
      prospect.origin === "HS"
        ? (roundNumber <= 4 ? 4.5 : 2.0)
        : (roundNumber >= 4 ? 3.0 : 1.0);

    // 전국대회 활약도(Phase 2 draftProjection 순위) 보너스
    const projRank = (prospect.draftProjection && prospect.draftProjection.rank) || 100;
    const tourneyMomentum = clamp((100 - projRank) * 0.06, 0, 6.0);

    const bpaScore = perceivedOvr * ovrWeight + perceivedPot * potWeight + originBonus + tourneyMomentum;

    // 3. 라운드별 포지션 보강(Need) 반영 비율: 1~2R은 BPA 중심(45%), 중하위 라운드는 포지션 구멍 보강(110%)
    const needMultiplier = roundNumber <= 2 ? 0.45 : roundNumber <= 5 ? 0.80 : 1.15;
    const posNeedScore = (needs[prospect.pos] || 0) * needMultiplier;

    const totalScore = +(bpaScore + posNeedScore).toFixed(2);

    return {
      playerId: prospect.id,
      name: prospect.name,
      pos: prospect.pos,
      origin: prospect.origin,
      age: prospect.age,
      ovrRange: `${se.ovrMin}~${se.ovrMax}`,
      perceivedOvr: Math.round(perceivedOvr),
      perceivedPot: Math.round(perceivedPot),
      bpaScore: +bpaScore.toFixed(2),
      posNeedScore: +posNeedScore.toFixed(2),
      totalScore,
      draftProjection: prospect.draftProjection || null
    };
  }

  /**
   * 특정 구단(특히 플레이어 구단) 차례에 지명 추천 유망주 Top N 리스트 반환
   */
  function getRecommendedPicks(context, teamId = null, count = 5, roundNumber = 1) {
    const targetTeamId = teamId || context.userTeamId;
    const team = context.getTeam ? context.getTeam(targetTeamId) : context.kboTeams.find((t) => t.id === targetTeamId);
    if (!team || !Array.isArray(context.draftPool)) return [];

    const needs = analyzeTeamNeeds(team);
    const evaluated = context.draftPool.map((p) => {
      const ev = evaluateProspectForTeam(team, p, context, roundNumber, needs, () => 0.5);
      return {
        ...ev,
        reason:
          ev.posNeedScore >= 6
            ? `팀 ${p.pos} 포지션 보강 1순위 + 스카우트 추정 OVR ${ev.ovrRange}`
            : `현 시점 최고 유망주(BPA) · 스카우트 추정 OVR ${ev.ovrRange}`,
        playerRef: p
      };
    });

    evaluated.sort((a, b) => b.totalScore - a.totalScore);
    return evaluated.slice(0, count).map(({ playerRef, ...rest }) => rest);
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 3. 단일 픽 지명 확정 및 계약/로스터 배정 (Draft Finalization)
   * ═══════════════════════════════════════════════════════════════════════ */
  function executeSinglePick(context, team, prospect, roundNumber, pickInRound, overallPick, selectionMethod = "AI") {
    // 1. 드래프트 풀에서 제거
    const idx = context.draftPool.findIndex((p) => p.id === prospect.id);
    if (idx !== -1) {
      context.draftPool.splice(idx, 1);
    }

    // 2. 계약금 산출 및 구단 예산 차감 (구단 최소 운영예산 100억~250억 밸런스 유지)
    const signingBonus = calculateSigningBonus(roundNumber, pickInRound, prospect);
    team.budget = clamp((team.budget || 1200000) - signingBonus, -3000000, 4000000);

    // 3. 선수 소속/계약 정보 갱신
    prospect.teamId = team.id;
    prospect.acquiredVia = { type: "DRAFT", date: context.currentDate || null, fromTeamId: prospect.formerTeamId || null }; // 시즌 회고 리포트용 영입 경로
    prospect.teamSinceYear = context.currentYear || 2025; // 소속 구단 연속 시즌 (프랜차이즈 예외)
    prospect.salary = 3000; // 신인 최저연봉 3,000만원
    prospect.contractYears = 1;
    prospect.faYears = 0;
    prospect.signingBonus = signingBonus;
    prospect.draftInfo = {
      year: context.currentYear || 2026,
      round: roundNumber,
      pickInRound,
      overallPick,
      // 단장이 직접 고른 지명만 DIRECT, 스카우트 추천·위임 자동 지명은 DELEGATED
      method: selectionMethod === "USER_MANUAL" ? "DIRECT" : selectionMethod === "AI" ? "AI" : "DELEGATED",
      teamId: team.id,
      teamName: team.name
    };

    // 4. 2군(roster2G) 또는 육성군(rosterDev) 자동 배정
    // 상위 라운드(1~3R) 지명자는 정식 2군('2GUN') 등록 (2군 30명 정원 초과 시 2군 최하위 선수를 육성군으로 전환)
    if (roundNumber <= 3) {
      if (team.roster2G.length >= 30) {
        const demoteTarget = team.roster2G
          .filter((p) => !p.draftInfo || p.draftInfo.year !== (context.currentYear || 2026))
          .sort((a, b) => a.getTrueOvr() - b.getTrueOvr())[0];
        if (demoteTarget) {
          team.roster2G = team.roster2G.filter((p) => p.id !== demoteTarget.id);
          demoteTarget.status = "YUKSEONG";
          team.rosterDev.push(demoteTarget);
        }
      }
      if (team.roster2G.length < 30) {
        prospect.status = "2GUN";
        team.roster2G.push(prospect);
      } else {
        prospect.status = "YUKSEONG";
        team.rosterDev.push(prospect);
      }
    } else {
      prospect.status = "YUKSEONG";
      team.rosterDev.push(prospect);
    }

    // 5. 플레이어 구단이 지명한 선수는 자구단 소속이 되었으므로 스카우팅 오차(Fog of War) 즉시 축소
    const isUserTeam = team.id === context.userTeamId;
    if (typeof prospect.updateScoutingReport === "function") {
      prospect.updateScoutingReport(context.scoutLevel || 1, isUserTeam);
    }

    return {
      overallPick,
      round: roundNumber,
      pickInRound,
      teamId: team.id,
      teamName: team.name,
      passed: false,
      selectionMethod,
      playerId: prospect.id,
      playerName: prospect.name,
      pos: prospect.pos,
      origin: prospect.origin,
      age: prospect.age,
      assignedStatus: prospect.status,
      signingBonus,
      scoutReport: {
        ovrMin: prospect.scoutError ? prospect.scoutError.ovrMin : prospect.getTrueOvr(),
        ovrMax: prospect.scoutError ? prospect.scoutError.ovrMax : prospect.getTrueOvr(),
        statRanges: prospect.scoutError ? prospect.scoutError.statRanges : {},
        trueOvr: isUserTeam ? prospect.getTrueOvr() : undefined,
        potential: isUserTeam ? prospect.potential : undefined
      }
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 4. [요청 1~3] 라운드별 시뮬레이션 (runDraftRound) & 전체 드래프트 (runFullDraft)
   * ═══════════════════════════════════════════════════════════════════════ */
  /**
   * 드래프트 세션 상태 초기화
   */
  function initDraftSession(context, options = {}) {
    const draftOrder = options.draftOrder || getDraftOrder(context, options);
    const round1Order = options.draftOrder || getDraftOrder(context, { ...options, round: 1 });
    context.draftState = {
      year: context.currentYear || 2026,
      draftOrder,
      round1Order,
      completedRounds: [],
      allPicks: [],
      isCompleted: false
    };
    return context.draftState;
  }

  /**
   * 특정 라운드(1~10R)의 10개 구단 지명을 일괄 진행
   * @param {GMGameContext} context
   * @param {number} roundNumber - 1 ~ 10
   * @param {string|Function|Object|null} userChoice
   *   - 문자열(playerId): 해당 유망주 수동 지명
   *   - "PASS" 또는 { pass: true }: 해당 라운드 지명권 포기
   *   - 함수 (ctx, team, round, pickInRound, recommendations) => playerId | "PASS": 동적 콜백
   *   - null / 생략: 스카우트 추천 1순위 유망주 자동 지명
   * @param {Object} options
   */
  function runDraftRound(context, roundNumber = 1, userChoice = null, options = {}) {
    if (!context || !Array.isArray(context.kboTeams)) {
      throw new Error("유효한 GMGameContext 인스턴스가 필요합니다.");
    }
    const rng = options.rng || Math.random;
    const round = clamp(roundNumber, 1, TOTAL_ROUNDS);

    if (!context.draftState || !Array.isArray(context.draftState.draftOrder)) {
      initDraftSession(context, options);
    }

    // 1라운드만 경쟁균형세 지명권 하락이 반영된 순서를 사용
    if (round === TOTAL_ROUNDS) context._lastDraftCompletedYear = context.currentYear || 2025;
    const draftOrder =
      round === 1 && Array.isArray(context.draftState.round1Order)
        ? context.draftState.round1Order
        : context.draftState.draftOrder;
    // 단장 차례에서 멈춰 있던 라운드면 그 지점부터 이어서 진행
    const pending = context.draftState.pending && context.draftState.pending.round === round ? context.draftState.pending : null;
    const roundPicks = pending ? pending.picks.slice() : [];
    if (pending) context.draftState.pending = null;

    for (let i = pending ? pending.index : 0; i < draftOrder.length; i++) {
      const slotOriginalTeamId = draftOrder[i];
      const teamId = getPickOwnerTeamId(context, round, slotOriginalTeamId);
      const team = context.getTeam ? context.getTeam(teamId) : context.kboTeams.find((t) => t.id === teamId);
      const pickInRound = i + 1;
      const overallPick = (round - 1) * draftOrder.length + pickInRound;
      const isTradedPick = teamId !== slotOriginalTeamId;

      if (!team || !context.draftPool.length) {
        roundPicks.push({
          overallPick,
          round,
          pickInRound,
          teamId,
          teamName: team ? team.name : teamId,
          passed: true,
          selectionMethod: "PASS",
          reason: "드래프트 풀 소진"
        });
        continue;
      }

      const isUserTeam = team.id === context.userTeamId;
      // 단장 직접 지명 라운드: 앞 순번 구단들의 지명이 끝난 뒤 단장 차례에서 멈춘다 (남은 선수를 보고 고를 수 있게)
      if (isUserTeam && options.stopBeforeUser && round < DELEGATE_FROM_ROUND && !(pending && pending.index === i)) {
        context.draftState.pending = { round, index: i, picks: roundPicks };
        return { round, paused: true, awaitingUser: true, picks: roundPicks, userPick: null, remainingPoolCount: context.draftPool.length };
      }
      let chosenProspect = null;
      let selectionMethod = isUserTeam ? "USER_AUTO" : "AI";
      let isPass = false;

      if (isUserTeam && round >= DELEGATE_FROM_ROUND) {
        // 스카우트팀 위임 지명: 스카우트팀의 추정치(스카우트 품질에 따른 Fog of War) 기준 최고 평가 유망주
        const recs = getRecommendedPicks(context, team.id, 1, round);
        const topRecId = recs[0] && recs[0].playerId;
        chosenProspect = context.draftPool.find((p) => p.id === topRecId) || context.draftPool[0];
        selectionMethod = "SCOUT_DELEGATED";
      } else if (isUserTeam) {
        const recs = getRecommendedPicks(context, team.id, 5, round);
        let resolvedChoice = userChoice;
        if (typeof userChoice === "function") {
          resolvedChoice = userChoice(context, team, round, pickInRound, recs);
        } else if (userChoice && typeof userChoice === "object" && !Array.isArray(userChoice)) {
          if (userChoice.pass) resolvedChoice = "PASS";
          else if (userChoice.playerId) resolvedChoice = userChoice.playerId;
          else if (userChoice[round]) resolvedChoice = userChoice[round];
        }

        if (resolvedChoice === "PASS" || (resolvedChoice && resolvedChoice.pass)) {
          isPass = true;
          selectionMethod = "USER_PASS";
        } else if (typeof resolvedChoice === "string") {
          chosenProspect = context.draftPool.find((p) => p.id === resolvedChoice) || null;
          if (chosenProspect) {
            selectionMethod = "USER_MANUAL";
          }
        }

        // 수동 지명 선수가 없거나 유효하지 않으면 추천 1순위 자동 지명
        if (!isPass && !chosenProspect) {
          const topRecId = recs[0] && recs[0].playerId;
          chosenProspect = context.draftPool.find((p) => p.id === topRecId) || context.draftPool[0];
          selectionMethod = "USER_AUTO";
        }
      } else {
        // AI 구단 지명: BPA + 포지션 약점(Need) + 스카우팅 오차(Fog of War) 종합 최고점 유망주 선택
        const needs = analyzeTeamNeeds(team);
        let bestScore = -Infinity;
        for (let pIdx = 0; pIdx < context.draftPool.length; pIdx++) {
          const cand = context.draftPool[pIdx];
          const ev = evaluateProspectForTeam(team, cand, context, round, needs, rng);
          if (ev.totalScore > bestScore) {
            bestScore = ev.totalScore;
            chosenProspect = cand;
          }
        }
      }

      if (isPass || !chosenProspect) {
        const passRecord = {
          overallPick,
          round,
          pickInRound,
          teamId: team.id,
          teamName: team.name,
          passed: true,
          selectionMethod,
          signingBonus: 0
        };
        roundPicks.push(passRecord);
        context.draftState.allPicks.push(passRecord);
      } else {
        const pickRecord = executeSinglePick(
          context,
          team,
          chosenProspect,
          round,
          pickInRound,
          overallPick,
          selectionMethod
        );
        roundPicks.push(pickRecord);
        context.draftState.allPicks.push(pickRecord);
      }
    }

    context.draftState.completedRounds.push(round);
    if (context.draftState.completedRounds.length >= TOTAL_ROUNDS) {
      context.draftState.isCompleted = true;
    }

    return {
      round,
      picks: roundPicks,
      userPick: roundPicks.find((p) => p.teamId === context.userTeamId) || null,
      remainingPoolCount: context.draftPool.length
    };
  }

  /**
   * 드래프트 종료 후 미지명 유망주 중 육성선수(신고선수, 계약금 0원 / 연봉 3,000만원) 추가 계약 헬퍼
   */
  function signUndraftedProspect(context, teamId, playerId) {
    const team = context.getTeam ? context.getTeam(teamId) : context.kboTeams.find((t) => t.id === teamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const idx = context.draftPool.findIndex((p) => p.id === playerId);
    if (idx === -1) return { ok: false, reason: "해당 유망주가 드래프트 풀에 없습니다." };

    const prospect = context.draftPool.splice(idx, 1)[0];
    prospect.teamId = team.id;
    prospect.acquiredVia = { type: "DRAFT", date: context.currentDate || null, fromTeamId: prospect.formerTeamId || null }; // 시즌 회고 리포트용 영입 경로
    prospect.teamSinceYear = context.currentYear || 2025; // 소속 구단 연속 시즌 (프랜차이즈 예외)
    prospect.status = "YUKSEONG";
    prospect.salary = 3000;
    prospect.contractYears = 1;
    prospect.faYears = 0;
    prospect.signingBonus = 0;
    prospect.draftInfo = {
      year: context.currentYear || 2026,
      round: "UNDRAFTED",
      pickInRound: null,
      overallPick: null,
      teamId: team.id,
      teamName: team.name
    };

    team.rosterDev.push(prospect);
    if (typeof prospect.updateScoutingReport === "function") {
      prospect.updateScoutingReport(context.scoutLevel || 1, team.id === context.userTeamId);
    }

    return { ok: true, player: prospect };
  }

  /**
   * 구단별 드래프트 결과 성적표(Grade: S / A / B / C) 및 요약 리포트 생성
   */
  function buildDraftSummaryReport(context) {
    const state = context.draftState || { year: context.currentYear, draftOrder: [], allPicks: [] };
    const allPicks = state.allPicks || [];

    const teamSummaries = {};
    context.kboTeams.forEach((team) => {
      const tPicks = allPicks.filter((p) => p.teamId === team.id && !p.passed);
      const totalBonus = tPicks.reduce((sum, p) => sum + (p.signingBonus || 0), 0);

      // 지명 선수들의 평균 잠재력/능력치로 드래프트 등급 산출
      let avgVal = 70;
      if (tPicks.length > 0) {
        const draftedPlayers = team.getAllPlayers().filter((plr) => tPicks.some((pk) => pk.playerId === plr.id));
        if (draftedPlayers.length > 0) {
          avgVal =
            draftedPlayers.reduce((sum, plr) => sum + plr.getTrueOvr() * 0.45 + (plr.potential || 75) * 0.55, 0) /
            draftedPlayers.length;
        }
      }
      const grade = avgVal >= 76 ? "S" : avgVal >= 72.5 ? "A" : avgVal >= 69 ? "B" : "C";

      teamSummaries[team.id] = {
        teamId: team.id,
        teamName: team.name,
        draftedCount: tPicks.length,
        passedCount: allPicks.filter((p) => p.teamId === team.id && p.passed).length,
        totalSigningBonus: totalBonus,
        remainingBudget: team.budget,
        grade,
        picks: tPicks
      };
    });

    const userTeamSummary = teamSummaries[context.userTeamId] || null;

    return {
      year: state.year,
      draftOrder: state.draftOrder,
      totalPicks: allPicks.filter((p) => !p.passed).length,
      allPicks,
      teamSummaries,
      userTeamSummary
    };
  }

  /**
   * 1~10라운드(총 100픽) 전체 신인 드래프트를 일괄 시뮬레이션
   * @param {GMGameContext} context
   * @param {Function|Object|null} userPickHandler
   *   - 라운드별 수동 지명 콜백 `(context, team, round, pickInRound, recommendations) => playerId | "PASS"`
   *   - 또는 라운드별 매핑 객체 `{ 1: "plr_xxx", 2: "plr_yyy", 10: "PASS" }`
   *   - 생략(null) 시 전 라운드 최적 유망주 자동 지명
   * @param {Object} options
   */
  /* ═══════════════════════════════════════════════════════════════════════
   * 청소년 국가대표 경기 단장 직관 (연 3회)
   * - 대표팀은 실제 최상위 유망주로 구성된다 → 직관한 선수는 잠재력 추정 오차가 크게 줄어든다 (viewedByGM)
   * - 행사일 ±10일 안에만 직관 가능, 한 해 4개 행사 중 3회까지
   * ═══════════════════════════════════════════════════════════════════════ */
  const YOUTH_VIEWING_LIMIT = 3;
  const YOUTH_VIEWING_WINDOW_DAYS = 10;
  const YOUTH_EVENTS = [
    { id: "UNIV_NT", mmdd: "06-14", name: "대학야구 국가대표 선발전", pick: (p) => p.origin === "UNIV", size: 12 },
    { id: "U18_TRIAL", mmdd: "07-19", name: "U-18 청소년 대표팀 평가전", pick: (p) => p.origin === "HS" && (p.gradeYear || 3) >= 3, size: 20 },
    { id: "U18_ASIA", mmdd: "08-30", name: "U-18 아시아 청소년 선수권", pick: (p) => p.origin === "HS" && (p.gradeYear || 3) >= 2, size: 20 },
    { id: "U16_CUP", mmdd: "10-25", name: "U-16 유소년 대표팀 대회", pick: (p) => p.origin === "HS" && (p.gradeYear || 3) <= 2, size: 15 }
  ];

  function dayDiff(a, b) {
    return Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
  }

  function ensureYouthViewingState(context) {
    const year = context.currentYear || 2025;
    if (!context.youthViewing || context.youthViewing.year !== year) {
      context.youthViewing = { year, attended: [], seenPlayerIds: [] };
    }
    return context.youthViewing;
  }

  /** 올해 청소년 대표 행사 목록과 상태 (UPCOMING / OPEN / ATTENDED / MISSED) */
  function getYouthViewingEvents(context) {
    if (!context) return [];
    const st = ensureYouthViewingState(context);
    const year = context.currentYear || 2025;
    const remaining = YOUTH_VIEWING_LIMIT - st.attended.length;
    return YOUTH_EVENTS.map((ev) => {
      const date = `${year}-${ev.mmdd}`;
      const diff = dayDiff(context.currentDate, date);
      let status = "UPCOMING";
      if (st.attended.includes(ev.id)) status = "ATTENDED";
      else if (diff > YOUTH_VIEWING_WINDOW_DAYS) status = "MISSED";
      else if (diff >= -YOUTH_VIEWING_WINDOW_DAYS) status = remaining > 0 ? "OPEN" : "LIMIT_REACHED";
      return { id: ev.id, name: ev.name, date, status, size: ev.size, remaining };
    });
  }

  function attendYouthEvent(context, eventId) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const ev = YOUTH_EVENTS.find((e) => e.id === eventId);
    if (!ev) return { ok: false, reason: "알 수 없는 행사입니다." };
    const status = (getYouthViewingEvents(context).find((e) => e.id === eventId) || {}).status;
    if (status !== "OPEN") {
      const msg = {
        ATTENDED: "이미 직관한 행사입니다.",
        MISSED: "행사가 이미 끝났습니다.",
        UPCOMING: `행사일 ${YOUTH_VIEWING_WINDOW_DAYS}일 전부터 직관할 수 있습니다.`,
        LIMIT_REACHED: `올해 직관 가능 횟수(${YOUTH_VIEWING_LIMIT}회)를 모두 사용했습니다.`
      };
      return { ok: false, reason: msg[status] || "지금은 직관할 수 없습니다." };
    }
    const st = ensureYouthViewingState(context);
    // 대표팀은 실제 기량(현재 OVR + 잠재력) 상위 선수로 선발된다
    const roster = (context.draftPool || [])
      .filter(ev.pick)
      .sort((a, b) => b.getTrueOvr() + (b.potential || 70) - (a.getTrueOvr() + (a.potential || 70)))
      .slice(0, ev.size);
    roster.forEach((p) => {
      p.viewedByGM = true;
      if (!st.seenPlayerIds.includes(p.id)) st.seenPlayerIds.push(p.id);
    });
    st.attended.push(ev.id);
    const setup = KBO_GM && KBO_GM.Setup;
    const seen = roster.map((p) => {
      const pp = setup && setup.getPerceivedPotential ? setup.getPerceivedPotential(context, p) : null;
      return { playerId: p.id, name: p.name, pos: p.pos, origin: p.origin, gradeYear: p.gradeYear, potentialLow: pp ? pp.low : null, potentialHigh: pp ? pp.high : null };
    });
    return {
      ok: true,
      event: { id: ev.id, name: ev.name },
      seen,
      remaining: YOUTH_VIEWING_LIMIT - st.attended.length,
      summary: `[단장 직관] ${ev.name} — 대표 선수 ${seen.length}명의 잠재력을 직접 확인했습니다. (올해 남은 직관 ${YOUTH_VIEWING_LIMIT - st.attended.length}회)`
    };
  }

  /**
   * 단장 직접 지명 라운드(1~3R)에서 앞 순번 구단들의 지명을 먼저 진행하고 단장 차례에서 멈춘다.
   * 반환: { round, picksBefore } — 이미 멈춰 있으면 그대로 반환
   */
  function prepareUserDraftTurn(context) {
    if (!context || !context.draftState) return null;
    const st = context.draftState;
    const nextRound = st.completedRounds.length + 1;
    if (nextRound >= DELEGATE_FROM_ROUND || nextRound > TOTAL_ROUNDS) return null;
    if (st.pending && st.pending.round === nextRound) return { round: nextRound, picksBefore: st.pending.picks };
    const res = runDraftRound(context, nextRound, null, { stopBeforeUser: true });
    return res && res.paused ? { round: nextRound, picksBefore: res.picks } : null;
  }

  /** 단장 직접 지명(1~3R)이 끝나면 남은 라운드를 스카우트팀이 일괄 위임 지명 */
  function runDelegatedRounds(context, options = {}) {
    if (!context || !context.draftState) return [];
    const results = [];
    while (context.draftState.completedRounds.length < TOTAL_ROUNDS) {
      const nextRound = context.draftState.completedRounds.length + 1;
      if (nextRound < DELEGATE_FROM_ROUND) break;
      results.push(runDraftRound(context, nextRound, null, options));
    }
    return results;
  }

  function runFullDraft(context, userPickHandler = null, options = {}) {
    initDraftSession(context, options);

    const roundResults = [];
    for (let r = 1; r <= TOTAL_ROUNDS; r++) {
      const roundRes = runDraftRound(context, r, userPickHandler, options);
      roundResults.push(roundRes);
    }

    const summary = buildDraftSummaryReport(context);
    return {
      ...summary,
      completedRounds: context.draftState ? context.draftState.completedRounds : roundResults.map((r) => r.round),
      roundResults
    };
  }

  return {
    TOTAL_ROUNDS,
    DELEGATE_FROM_ROUND,
    YOUTH_VIEWING_LIMIT,
    YOUTH_VIEWING_WINDOW_DAYS,
    getYouthViewingEvents,
    attendYouthEvent,
    ROUND_BONUS_TABLE,
    runDelegatedRounds,
    prepareUserDraftTurn,
    getDraftOrder,
    getTeamShortName,
    getPickOwnerTeamId,
    calculateSigningBonus,
    analyzeTeamNeeds,
    evaluateProspectForTeam,
    getRecommendedPicks,
    initDraftSession,
    runDraftRound,
    runFullDraft,
    signUndraftedProspect,
    buildDraftSummaryReport
  };
});
