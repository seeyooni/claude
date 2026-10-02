/**
 * KBO 단장 모드 (v1.0) — Step 3-2: FA 시장, 연봉 재계약, 외국인 선수 계약 모듈 (KBO_GM.Offseason)
 * 의존 모듈:
 *   - Step 1-1: /public/gm-schema.js (Player, Team, GMGameContext)
 *   - Step 3-1: /public/gm-draft.js (analyzeTeamNeeds 참조 지원)
 * 실행 환경: Client-Side Standalone (window.KBO_GM.Offseason) & Node/CommonJS 호환
 */

(function (root, factory) {
  const offseasonModule = factory(root.KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM));
  if (typeof globalThis !== "undefined") {
    globalThis.KBO_GM = Object.assign(globalThis.KBO_GM || {}, { Offseason: offseasonModule });
  }
  if (typeof window !== "undefined") {
    window.KBO_GM = Object.assign(window.KBO_GM || {}, { Offseason: offseasonModule });
  }
  if (typeof module === "object" && module.exports) {
    module.exports = offseasonModule;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function (KBO_GM) {
  "use strict";

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round100 = (v) => Math.round(v / 100) * 100;
  const MIN_SALARY = 3000; // KBO 최저연봉 3,000만원

  // KBO FA 등급별 보상 규정 테이블
  const FA_GRADE_RULES = {
    A: {
      grade: "A",
      protectedCount: 20,      // 20인 보호선수 외 1명 지명
      cashMultiplierWithComp: 2.0, // 보상선수 지명 시 전년도 연봉 200%
      cashOnlyMultiplier: 3.0,     // 금전 보상만 선택 시 전년도 연봉 300%
      desc: "20인 보호선수 외 1명 + 전년도 연봉 200% (또는 연봉 300%)"
    },
    B: {
      grade: "B",
      protectedCount: 25,      // 25인 보호선수 외 1명 지명
      cashMultiplierWithComp: 1.0, // 보상선수 지명 시 전년도 연봉 100%
      cashOnlyMultiplier: 2.0,     // 금전 보상만 선택 시 전년도 연봉 200%
      desc: "25인 보호선수 외 1명 + 전년도 연봉 100% (또는 연봉 200%)"
    },
    C: {
      grade: "C",
      protectedCount: 999,     // 보상선수 없음
      cashMultiplierWithComp: 1.5,
      cashOnlyMultiplier: 1.5,     // 전년도 연봉 150% (보상선수 없음)
      desc: "보상선수 없음 · 전년도 연봉 150%"
    }
  };

  /* ═══════════════════════════════════════════════════════════════════════
   * 1. [요청 1] 기존 선수단 연봉 재계약 & 연봉 조정 위원회 (processSalaryRenewals)
   * ═══════════════════════════════════════════════════════════════════════ */

  /**
   * 선수의 당해 시즌 WAR, 출전 경기 수, 나이, 기존 연봉을 바탕으로 적정 희망 연봉(만원) 산출
   */
  function calculateFairSalary(player) {
    const prevSalary = player.salary || MIN_SALARY;
    const rec = player.rec || {};
    const war = typeof player.getWar === "function" ? player.getWar(rec) : 0;
    const ovr = typeof player.getTrueOvr === "function" ? player.getTrueOvr() : 65;
    const g = rec.g || 0;

    // 육성선수 및 2군 미출전 유망주는 최저연봉~소폭 인상 수준
    if (player.status === "YUKSEONG") {
      return MIN_SALARY;
    }
    if (g < 10 && player.status === "2GUN") {
      if (prevSalary <= 4500) {
        return clamp(round100(prevSalary + (ovr >= 65 ? 300 : 0)), MIN_SALARY, 6000);
      }
      // 고액 연봉자가 1군 출전이 전무하면 최대 25% 삭감 수용
      return Math.max(MIN_SALARY, round100(prevSalary * 0.78));
    }

    // 1군 활약 기반 시장 가치 (1 WAR 당 약 7,200만원 + 기본 1군 풀타임 5,000만원)
    const playingTimeFactor = clamp(g / 100, 0.15, 1.15);
    const warBasedValue = Math.max(MIN_SALARY, 3500 + playingTimeFactor * 3500 + Math.max(-0.5, war) * 7200);

    // 누적 타이틀급 스탯 보너스 (타자 20홈런/3할, 투수 10승/20세이브 등)
    let statBonus = 0;
    if (player.type === "pitcher") {
      if ((rec.w || 0) >= 10) statBonus += (rec.w - 9) * 1500;
      if ((rec.sv || 0) >= 20) statBonus += (rec.sv - 18) * 900;
      if ((rec.hld || 0) >= 15) statBonus += (rec.hld - 14) * 500;
    } else {
      if ((rec.hr || 0) >= 20) statBonus += (rec.hr - 18) * 1200;
      if ((rec.rbi || 0) >= 80) statBonus += (rec.rbi - 75) * 250;
    }

    const rawTarget = warBasedValue + statBonus;

    // 기존 연봉 관성 반영 (성적이 좋아도 급격한 점프 완화, 성적이 부진하면 15~30% 삭감선 형성)
    let blended;
    if (rawTarget >= prevSalary) {
      blended = prevSalary * 0.42 + rawTarget * 0.58;
    } else {
      // 부진 시 에이징 커브 구간(33세 이상)은 삭감 폭이 더 큼
      const cutResistance = player.age >= 33 ? 0.45 : 0.60;
      blended = Math.max(prevSalary * 0.68, prevSalary * cutResistance + rawTarget * (1 - cutResistance));
    }

    return clamp(round100(blended), MIN_SALARY, 250000);
  }

  /**
   * 전 구단(또는 지정 구단) 연봉 재계약 및 연봉 조정 위원회 일괄 처리
   * @param {GMGameContext} context
   * @param {Object} options
   *   - userOffers: { [playerId]: offeredSalary } (유저 구단 수동 연봉 제시액 맵)
   *   - userPolicy: 'GENEROUS'(후한 협상) | 'FAIR'(적정 협상) | 'AUSTERITY'(긴축 삭감)
   *   - advanceServiceTime: true (기본값, FA 연차 +1 및 다년계약 잔여연수 -1 처리)
   */
  function processSalaryRenewals(context, options = {}) {
    if (!context || !Array.isArray(context.kboTeams)) {
      throw new Error("유효한 GMGameContext 인스턴스가 필요합니다.");
    }
    const rng = options.rng || Math.random;
    const userOffers = options.userOffers || {};
    const userPolicy = options.userPolicy || "FAIR";
    const advanceServiceTime = options.advanceServiceTime !== false;

    const arbitrationCases = [];
    const holdoutEvents = [];
    const teamRenewalSummaries = {};

    context.kboTeams.forEach((team) => {
      const isUserTeam = team.id === context.userTeamId;
      const allPlayers = team.getAllPlayers();

      let prevTotalPayroll = 0;
      let newTotalPayroll = 0;
      let renewedCount = 0;
      let multiYearLockedCount = 0;
      const playerResults = [];

      allPlayers.forEach((p) => {
        prevTotalPayroll += p.salary || MIN_SALARY;

        // 외국인 선수는 processForeignPlayerContracts에서 별도 처리하므로 스킵
        if (p.nationality && p.nationality !== "KOR") {
          newTotalPayroll += p.salary || MIN_SALARY;
          return;
        }

        // 1) FA 연차(faYears) 누적 (1군 20경기 이상 또는 1군 소속 시 +1시즌)
        if (advanceServiceTime) {
          const gPlayed = (p.rec && p.rec.g) || 0;
          if (p.status === "1GUN" || gPlayed >= 20) {
            p.faYears = (p.faYears || 0) + 1;
          }
        }

        // 2) 다년 계약(FA 잔여 계약 등) 중인 선수는 계약 연수만 1년 차감하고 연봉 동결
        if ((p.contractYears || 1) > 1) {
          if (advanceServiceTime) {
            p.contractYears -= 1;
          }
          multiYearLockedCount += 1;
          newTotalPayroll += p.salary || MIN_SALARY;
          return;
        }

        // 3) FA 자격 취득 대상자는 연봉 재계약 대신 FA 시장 단계에서 처리
        const reqFaYears = p.origin === "UNIV" ? 7 : 8;
        if ((p.faYears || 0) >= reqFaYears) {
          newTotalPayroll += p.salary || MIN_SALARY;
          return;
        }

        // 4) 일반 단년 계약 대상자 적정 연봉 산출 및 구단 제시액 결정
        // 단장 특성 'NEGOTIATOR'(협상의 달인) 보유 시 유저 구단 선수 요구액 5% 절감 보정
        const oldSalary = p.salary || MIN_SALARY;
        const rawFairSalary = calculateFairSalary(p);
        const negDiscount =
          isUserTeam &&
          ((context.gmProfile && context.gmProfile.trait === "NEGOTIATOR") || context.negotiationDiscount > 0)
            ? context.negotiationDiscount || 0.05
            : 0;
        const fairSalary =
          negDiscount > 0 ? Math.max(MIN_SALARY, round100(rawFairSalary * (1 - negDiscount))) : rawFairSalary;

        let clubOffer = fairSalary;
        if (isUserTeam && userOffers[p.id] != null) {
          clubOffer = Math.max(MIN_SALARY, round100(Number(userOffers[p.id])));
        } else if (isUserTeam) {
          if (userPolicy === "GENEROUS") clubOffer = round100(fairSalary * 1.06);
          else if (userPolicy === "AUSTERITY") clubOffer = Math.max(MIN_SALARY, round100(fairSalary * 0.80));
        } else {
          // AI 구단은 예산 여유에 따라 적정가의 94% ~ 103% 제시
          const budgetRatio = team.budget > 1400000 ? 1.01 : 0.96;
          clubOffer = Math.max(MIN_SALARY, round100(fairSalary * budgetRatio));
        }

        const offerRatio = clubOffer / Math.max(1, fairSalary);
        let finalSalary = clubOffer;
        let statusNote = "원만 타결";

        // 과도한 삭감 제시 시 (적정 요구액의 84% 미만 제시): 불만 폭증 & 연봉 조정 위원회 회부 또는 캠프 불참
        if (offerRatio < 0.84 && fairSalary >= 5000) {
          const playerDemand = round100(fairSalary * 1.05);
          p.discontent = clamp((p.discontent || 0) + Math.round((1 - offerRatio) * 100), 0, 100);

          // 연봉 조정 신청 확률 (고연차/주전일수록 높음)
          if (p.faYears >= 3 && rng() < 0.65) {
            // 위원회 심사: 적정가(fairSalary)에 더 가까운 쪽의 손을 들어줌
            const clubGap = Math.abs(fairSalary - clubOffer);
            const playerGap = Math.abs(playerDemand - fairSalary);
            const playerWon = playerGap <= clubGap || offerRatio < 0.75;

            finalSalary = playerWon ? playerDemand : clubOffer;
            statusNote = playerWon ? "연봉조정 선수 승" : "연봉조정 구단 승";

            arbitrationCases.push({
              teamId: team.id,
              teamName: team.name,
              playerId: p.id,
              playerName: p.name,
              pos: p.pos,
              oldSalary,
              fairSalary,
              clubOffer,
              playerDemand,
              finalSalary,
              winner: playerWon ? "PLAYER" : "CLUB"
            });

            if (!playerWon) {
              // 구단이 이겼더라도 선수 사기 저하 및 스프링캠프 지각 합류(피로도/컨디션 페널티)
              p.cond = 0.92;
              p.fatigue = clamp((p.fatigue || 0) + 18, 0, 100);
            }
          } else {
            // 연봉조정 미신청 시 스프링캠프 불참(Holdout) 이벤트 발생
            finalSalary = round100((clubOffer + fairSalary) / 2);
            statusNote = "협상 난항(스프링캠프 지각 합류)";
            p.cond = 0.90;
            p.fatigue = clamp((p.fatigue || 0) + 22, 0, 100);

            holdoutEvents.push({
              teamId: team.id,
              teamName: team.name,
              playerId: p.id,
              playerName: p.name,
              pos: p.pos,
              oldSalary,
              clubOffer,
              settledSalary: finalSalary,
              effect: "스프링캠프 불참으로 시즌 초반 컨디션 저하(0.90) 및 피로도(+22)"
            });
          }
        }

        p.salary = Math.max(MIN_SALARY, finalSalary);
        p.contractYears = 1;
        renewedCount += 1;
        newTotalPayroll += p.salary;

        playerResults.push({
          playerId: p.id,
          name: p.name,
          pos: p.pos,
          war: typeof p.getWar === "function" ? p.getWar() : 0,
          oldSalary,
          newSalary: p.salary,
          diff: p.salary - oldSalary,
          statusNote
        });
      });

      // 과도한 연봉 삭감으로 분쟁이 많으면 팬 민심 소폭 하락 및 선수단 집단 항명(SQUAD_REBELLION) 판정
      if (isUserTeam && holdoutEvents.filter((h) => h.teamId === team.id).length >= 3) {
        team.fanRatio = clamp(team.fanRatio - 4, 0, 100);
      }

      let squadRebellionReport = null;
      const gmRoot =
        KBO_GM ||
        (typeof globalThis !== "undefined" && globalThis.KBO_GM) ||
        (typeof window !== "undefined" && window.KBO_GM);
      if (
        isUserTeam &&
        gmRoot &&
        gmRoot.RealisticGM &&
        typeof gmRoot.RealisticGM.evaluateSquadRebellion === "function"
      ) {
        squadRebellionReport = gmRoot.RealisticGM.evaluateSquadRebellion(context, team.id, {
          prevTotalPayroll,
          newTotalPayroll,
          playerResults,
          userPolicy
        });
      }

      teamRenewalSummaries[team.id] = {
        teamId: team.id,
        teamName: team.name,
        renewedCount,
        multiYearLockedCount,
        prevTotalPayroll,
        newTotalPayroll,
        payrollDelta: newTotalPayroll - prevTotalPayroll,
        topRaises: playerResults.slice().sort((a, b) => b.diff - a.diff).slice(0, 5),
        topCuts: playerResults.slice().sort((a, b) => a.diff - b.diff).slice(0, 5),
        squadRebellionReport
      };
    });

    return {
      year: context.currentYear,
      teamRenewalSummaries,
      userTeamRenewal: teamRenewalSummaries[context.userTeamId] || null,
      arbitrationCases,
      holdoutEvents
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 2. [KBO_GM.FA] KBO FA 계약 전수조사 연구 보고서 기반 정량 산정 & 로지스틱 협상 모듈
   * ───────────────────────────────────────────────────────────────────────
   * - PART 1. FA 등급 판정 및 보상 리스크 산정 (KBO_GM.FA.determineGrade)
   * - PART 2. FA 선수의 요구 가치 산정 방정식 (KBO_GM.FA.calculateTargetValuation)
   * - PART 3. 계약금(Down Payment) 및 보장/옵션 분할 알고리즘 (KBO_GM.FA.breakdownContract)
   * - PART 4. AI 선수의 오퍼 수용 확률 로지스틱 모델 (KBO_GM.FA.evaluateOfferAcceptance)
   * ═══════════════════════════════════════════════════════════════════════ */

  const WAR_UNIT_VALUE_MANWON = 85000; // KBO 시장 1 WAR당 가치 = 8억 5,000만 원 (85,000만 원)

  const GRADE_PREMIUM_FACTORS = {
    A: 1.20, // A등급: 1.20 (프리미엄, 30억~150억 캡)
    B: 0.70, // B등급: 0.70 (B등급 할인, 10억~60억 캡)
    C: 0.30  // C등급: 0.30 (C등급 대폭 할인, 2억~15억 하드 캡)
  };

  /**
   * 선수의 최근 3개년 평균 연봉 산출 (만원 단위)
   */
  function get3YearAverageSalaryManwon(player) {
    if (!player) return 10000;
    if (Array.isArray(player.salaryHistory3Yr) && player.salaryHistory3Yr.length >= 3) {
      const s = player.salaryHistory3Yr.slice(0, 3).map((x) => Number(x) || 10000);
      return round100((s[0] + s[1] + s[2]) / 3);
    }
    const s1 = Number(player.salary_t1 || player.salary) || 12000;
    const s2 = Number(player.salary_t2) || round100(s1 * 0.92);
    const s3 = Number(player.salary_t3) || round100(s1 * 0.85);
    return round100((s1 + s2 + s3) / 3);
  }

  /**
   * 유망주/후보 선수 1인의 OVR/Potential 기반 재정 환산 가치(만원) 산출
   * (영입 구단 팜 내 21위 또는 26위 보상선수 유출 페널티 가치 계산용)
   */
  function convertProspectToManwonValue(player) {
    if (!player) return 35000;
    const ovr = typeof player.getTrueOvr === "function" ? player.getTrueOvr() : Number(player.ovr) || 68;
    const pot = Number(player.potential) || ovr + 5;
    const age = Number(player.age) || 24;
    const compositeScore = ovr * 0.55 + pot * 0.45 + Math.max(0, 27 - age) * 1.35;
    // OVR/Potential 환산액 (만원 단위): 예) 21위급 유망주(점수 ~76) → 약 6.5억~11억 원, 26위급 후보(점수 ~71) → 약 3.5억~6억 원
    const estimatedValue = Math.max(15000, round100((compositeScore - 58) * 4200));
    return estimatedValue;
  }

  /**
   * 외부 영입 시 보상선수 + 보상금 합산 페널티 가치(Penalty_comp, 만원 단위) 연산
   * - A등급: 원소속 구단 보상금(200%) + 영입 구단 팜 내 21위 유망주 가치(OVR/Potential 환산액)
   * - B등급: 원소속 구단 보상금(100%) + 영입 구단 팜 내 26위 후보 자원 가치
   * - C등급: 원소속 구단 보상금(150%) 단독
   */
  function calculateCompensationPenalty(player, faGrade = "B", signingTeamOrContext = null) {
    const prevSalary = Number(player && (player.salary || (player.faProfile && player.faProfile.prevSalary))) || 20000;
    const grade = ["A", "B", "C"].includes(faGrade) ? faGrade : "B";

    let signingTeam = null;
    if (signingTeamOrContext) {
      if (typeof signingTeamOrContext.getAllPlayers === "function" || Array.isArray(signingTeamOrContext.roster1G)) {
        signingTeam = signingTeamOrContext;
      } else if (typeof signingTeamOrContext.getUserTeam === "function") {
        signingTeam = signingTeamOrContext.getUserTeam();
      }
    }

    // 원소속 구단 재계약(잔류)인 경우 보상 페널티 0
    if (signingTeam && player && player.formerTeamId && signingTeam.id === player.formerTeamId) {
      return {
        faGrade: grade,
        isRetention: true,
        prevSalaryManwon: prevSalary,
        cashMultiplier: 0,
        cashCompensationManwon: 0,
        targetRosterRank: null,
        exposedProspect: null,
        prospectValueManwon: 0,
        totalPenaltyManwon: 0
      };
    }

    let rankedRoster = [];
    if (signingTeam) {
      const pool = (
        typeof signingTeam.getAllPlayers === "function"
          ? signingTeam.getAllPlayers()
          : [...(signingTeam.roster1G || []), ...(signingTeam.roster2G || [])]
      ).filter((p) => !p.nationality || p.nationality === "KOR");

      rankedRoster = pool.slice().sort((a, b) => {
        const ovrA = typeof a.getTrueOvr === "function" ? a.getTrueOvr() : a.ovr || 68;
        const ovrB = typeof b.getTrueOvr === "function" ? b.getTrueOvr() : b.ovr || 68;
        const scoreA = ovrA * 0.60 + (a.potential || 72) * 0.40 - Math.max(0, (a.age || 26) - 30) * 1.5;
        const scoreB = ovrB * 0.60 + (b.potential || 72) * 0.40 - Math.max(0, (b.age || 26) - 30) * 1.5;
        return scoreB - scoreA;
      });
    }

    if (grade === "A") {
      const cashComp = round100(prevSalary * 2.0); // 전년도 연봉 200%
      const rank21Player = rankedRoster[20] || rankedRoster[rankedRoster.length - 1] || null;
      const prospectVal = rank21Player ? convertProspectToManwonValue(rank21Player) : 75000; // 21위 유망주 기본 환산가 7.5억
      return {
        faGrade: "A",
        isRetention: false,
        prevSalaryManwon: prevSalary,
        cashMultiplier: 2.0,
        cashCompensationManwon: cashComp,
        targetRosterRank: 21,
        exposedProspect: rank21Player
          ? {
              playerId: rank21Player.id,
              name: rank21Player.name,
              pos: rank21Player.pos,
              age: rank21Player.age,
              ovr: typeof rank21Player.getTrueOvr === "function" ? rank21Player.getTrueOvr() : rank21Player.ovr || 72,
              potential: rank21Player.potential || 80
            }
          : { name: "팜 내 21위 유망주", pos: "P/IF", age: 22, ovr: 72, potential: 82 },
        prospectValueManwon: prospectVal,
        totalPenaltyManwon: cashComp + prospectVal
      };
    }

    if (grade === "B") {
      const cashComp = round100(prevSalary * 1.0); // 전년도 연봉 100%
      const rank26Player = rankedRoster[25] || rankedRoster[rankedRoster.length - 1] || null;
      const prospectVal = rank26Player ? convertProspectToManwonValue(rank26Player) : 42000; // 26위 후보 자원 기본 환산가 4.2억
      return {
        faGrade: "B",
        isRetention: false,
        prevSalaryManwon: prevSalary,
        cashMultiplier: 1.0,
        cashCompensationManwon: cashComp,
        targetRosterRank: 26,
        exposedProspect: rank26Player
          ? {
              playerId: rank26Player.id,
              name: rank26Player.name,
              pos: rank26Player.pos,
              age: rank26Player.age,
              ovr: typeof rank26Player.getTrueOvr === "function" ? rank26Player.getTrueOvr() : rank26Player.ovr || 69,
              potential: rank26Player.potential || 76
            }
          : { name: "팜 내 26위 후보 자원", pos: "RP/OF", age: 25, ovr: 69, potential: 75 },
        prospectValueManwon: prospectVal,
        totalPenaltyManwon: cashComp + prospectVal
      };
    }

    // C등급: 보상선수 없음 + 원소속 구단 보상금(150%) 단독
    const cashCompC = round100(prevSalary * 1.5);
    return {
      faGrade: "C",
      isRetention: false,
      prevSalaryManwon: prevSalary,
      cashMultiplier: 1.5,
      cashCompensationManwon: cashCompC,
      targetRosterRank: null,
      exposedProspect: null,
      prospectValueManwon: 0,
      totalPenaltyManwon: cashCompC
    };
  }

  /**
   * [PART 1] FA 등급 판정 및 보상 리스크 산정 (KBO_GM.FA.determineGrade)
   * 1. 3개년 평균 연봉 및 리그/구단 순위에 따라 A, B, C 등급을 정밀 판정:
   *    - A등급: 최초 취득(faCount === 1) AND 구단 1~3위 AND 리그 1~30위. (보상: 20인 외 1명 + 연봉 200%)
   *    - B등급: 최초 취득(구단 4~10위 AND 리그 31~60위) OR 재취득(직전 A/B등급). (보상: 25인 외 1명 + 연봉 100%)
   *    - C등급: 구단 11위 이하 OR 리그 61위 이하 OR 만 35세 이상 신규 OR 3회차 이상. (보상: 보상선수 없음 + 연봉 150%)
   * 2. 외부 영입 시 보상선수 페널티 가치(Penalty_comp) 연산 포함
   */
  function determineGrade(player, contextOrOptions = {}) {
    if (!player) {
      throw new Error("FA 등급 판정을 위해 유효한 player 객체가 필요합니다.");
    }

    const opts = contextOrOptions || {};
    const isContext = Array.isArray(opts.kboTeams);
    const context = isContext ? opts : opts.context || null;

    const age = Number(player.age) || 29;
    const avgSalary3Yr = Number(opts.avgSalary3Yr) || get3YearAverageSalaryManwon(player);
    const faCount = Math.max(1, Number(opts.faCount || player.faCount || (age >= 34 ? 2 : 1)));
    const prevGrade = String(opts.prevGrade || player.prevFaGrade || "B").toUpperCase();

    // 구단 내 연봉 순위(clubSalaryRank) 및 리그 전체 연봉 순위(leagueSalaryRank) 계산
    let clubSalaryRank = opts.clubSalaryRank != null ? Number(opts.clubSalaryRank) : null;
    let leagueSalaryRank = opts.leagueSalaryRank != null ? Number(opts.leagueSalaryRank) : null;

    if ((clubSalaryRank == null || leagueSalaryRank == null) && context && Array.isArray(context.kboTeams)) {
      const homeTeamId = player.formerTeamId || player.teamId || context.userTeamId;
      const homeTeam = context.kboTeams.find((t) => t.id === homeTeamId);

      if (clubSalaryRank == null && homeTeam) {
        const clubDomestics = [
          ...(homeTeam.roster1G || []),
          ...(homeTeam.roster2G || []),
          player
        ]
          .filter((p, idx, arr) => (!p.nationality || p.nationality === "KOR") && arr.findIndex((x) => x.id === p.id) === idx)
          .sort((a, b) => get3YearAverageSalaryManwon(b) - get3YearAverageSalaryManwon(a));
        const cIdx = clubDomestics.findIndex((p) => p.id === player.id);
        clubSalaryRank = cIdx >= 0 ? cIdx + 1 : 6;
      }

      if (leagueSalaryRank == null) {
        const leagueDomestics = [];
        context.kboTeams.forEach((t) => {
          [...(t.roster1G || []), ...(t.roster2G || [])].forEach((p) => {
            if (!p.nationality || p.nationality === "KOR") leagueDomestics.push(p);
          });
        });
        if (!leagueDomestics.some((p) => p.id === player.id)) {
          leagueDomestics.push(player);
        }
        leagueDomestics.sort((a, b) => get3YearAverageSalaryManwon(b) - get3YearAverageSalaryManwon(a));
        const lIdx = leagueDomestics.findIndex((p) => p.id === player.id);
        leagueSalaryRank = lIdx >= 0 ? lIdx + 1 : 35;
      }
    }

    // context 없이 단독 호출된 경우 3년 평균 연봉 및 OVR 기반으로 구단/리그 연봉 순위 정밀 추정
    if (clubSalaryRank == null || leagueSalaryRank == null) {
      const ovr = typeof player.getTrueOvr === "function" ? player.getTrueOvr() : Number(player.ovr) || 74;
      if (avgSalary3Yr >= 42000 || ovr >= 81) {
        if (clubSalaryRank == null) clubSalaryRank = 2;
        if (leagueSalaryRank == null) leagueSalaryRank = 15;
      } else if (avgSalary3Yr >= 18000 || ovr >= 73) {
        if (clubSalaryRank == null) clubSalaryRank = 6;
        if (leagueSalaryRank == null) leagueSalaryRank = 42;
      } else {
        if (clubSalaryRank == null) clubSalaryRank = 13;
        if (leagueSalaryRank == null) leagueSalaryRank = 72;
      }
    }

    let grade = "B";
    let gradeReason = "";

    // 1) C등급 우선 판정 조건: 구단 11위 이하 OR 리그 61위 이하 OR 만 35세 이상 신규 OR 3회차 이상 (또는 재취득 직전 C등급)
    if (faCount >= 3) {
      grade = "C";
      gradeReason = `FA ${faCount}회차 이상 다회 취득자 (자동 C등급)`;
    } else if (faCount === 1 && age >= 35) {
      grade = "C";
      gradeReason = `만 35세 이상(${age}세) 신규 FA 자격 취득자 (자동 C등급)`;
    } else if (clubSalaryRank >= 11 || leagueSalaryRank >= 61) {
      grade = "C";
      gradeReason = `3개년 평균연봉 구단 ${clubSalaryRank}위(11위 이하) / 리그 ${leagueSalaryRank}위(61위 이하) → C등급`;
    } else if (faCount === 2 && prevGrade === "C") {
      grade = "C";
      gradeReason = `재취득(2회차)이나 직전 FA C등급 해당자 → C등급 유지`;
    } else if (faCount === 2 && (prevGrade === "A" || prevGrade === "B")) {
      // 2) 재취득(직전 A/B등급) → B등급
      grade = "B";
      gradeReason = `FA 재취득(2회차, 직전 ${prevGrade}등급) → B등급`;
    } else if (faCount === 1 && clubSalaryRank <= 3 && leagueSalaryRank <= 30) {
      // 3) 최초 취득 AND 구단 1~3위 AND 리그 1~30위 → A등급
      grade = "A";
      gradeReason = `최초 FA 취득 & 3개년 평균연봉 구단 ${clubSalaryRank}위(1~3위)·리그 ${leagueSalaryRank}위(1~30위) → A등급`;
    } else {
      // 4) 최초 취득 (구단 4~10위 AND 리그 31~60위 등) → B등급
      grade = "B";
      gradeReason = `최초 FA 취득 & 3개년 평균연봉 구단 ${clubSalaryRank}위(4~10위권)·리그 ${leagueSalaryRank}위(31~60위권) → B등급`;
    }

    const signingTeamRef = opts.signingTeam || context || null;
    const penaltyComp = calculateCompensationPenalty(player, grade, signingTeamRef);

    return {
      grade,
      faGrade: grade,
      faCount,
      prevGrade,
      age,
      avgSalary3YrManwon: avgSalary3Yr,
      clubSalaryRank,
      leagueSalaryRank,
      rule: FA_GRADE_RULES[grade],
      gradeReason,
      Penalty_comp: penaltyComp.totalPenaltyManwon,
      compensationPenalty: penaltyComp
    };
  }

  /**
   * FA 요구 가치 산정 (C등급 70억 버그 수정판)
   * 단위: 만원 (100억 = 1,000,000만 원)
   */
  function calculateTargetValuation(player, gradeOrOptions = null, context = null) {
    if (!player) {
      throw new Error("유효한 player 객체가 필요합니다.");
    }

    const opts = typeof gradeOrOptions === "object" && gradeOrOptions !== null ? gradeOrOptions : {};
    const resolvedGrade =
      typeof gradeOrOptions === "string"
        ? gradeOrOptions.toUpperCase()
        : opts.grade
        ? String(opts.grade).toUpperCase()
        : determineGrade(player, context || opts).grade;

    const faGrade = ["A", "B", "C"].includes(resolvedGrade) ? resolvedGrade : "C";

    const recs = player.career || [];
    const lastRec = recs.length > 0 ? recs[recs.length - 1] : null;
    const prevRec1 = recs.length > 1 ? recs[recs.length - 2] : null;
    const prevRec2 = recs.length > 2 ? recs[recs.length - 3] : null;

    const fallbackWar =
      typeof player.getWar === "function" && player.getWar() > 0
        ? player.getWar()
        : Number(player.war) > 0
        ? Number(player.war)
        : 1.0;

    const t1 =
      opts.WAR_t1 != null
        ? Number(opts.WAR_t1)
        : lastRec && lastRec.war != null
        ? Number(lastRec.war)
        : Array.isArray(player.warHistory) && player.warHistory[0] != null
        ? Number(player.warHistory[0])
        : fallbackWar;
    const t2 =
      opts.WAR_t2 != null
        ? Number(opts.WAR_t2)
        : prevRec1 && prevRec1.war != null
        ? Number(prevRec1.war)
        : Array.isArray(player.warHistory) && player.warHistory[1] != null
        ? Number(player.warHistory[1])
        : t1;
    const t3 =
      opts.WAR_t3 != null
        ? Number(opts.WAR_t3)
        : prevRec2 && prevRec2.war != null
        ? Number(prevRec2.war)
        : Array.isArray(player.warHistory) && player.warHistory[2] != null
        ? Number(player.warHistory[2])
        : t2;

    // 1. 최근 3년 가중 WAR
    const war3yr = Math.max(0.1, t1 * 0.5 + t2 * 0.3 + t3 * 0.2);

    // 2. 연령 감가상각 (만 31세 초과 시 연당 7% 감가)
    const age = Number(player.age) || 32;
    const ageDiscount = age > 31 ? Math.max(0.35, 1.0 - (age - 31) * 0.07) : 1.0;

    // 3. 등급별 계약 기간, 계수, 하드 캡(Hard Cap) 설정
    let years = 4;
    let pGrade = 1.0;
    let minTotal = 30000;   // 3억
    let maxTotal = 1500000; // 150억

    if (faGrade === "A") {
      years = age <= 30 ? 6 : age <= 33 ? 5 : 4;
      pGrade = 1.20; // 프리미엄
      minTotal = 300000;  // 30억
      maxTotal = 1500000; // 150억
    } else if (faGrade === "B") {
      years = age <= 32 ? 4 : age <= 34 ? 3 : 2;
      pGrade = 0.70; // B등급 할인
      minTotal = 100000; // 10억
      maxTotal = 600000; // 60억 캡
    } else {
      // C등급
      years = age >= 36 ? 1 : 2; // C등급은 최대 2년 (베테랑 1~2년)
      pGrade = 0.30; // C등급 대폭 할인
      minTotal = 20000;  // 2억
      maxTotal = 150000; // ★ C등급 상한선: 15억 원 (150,000만 원)
    }

    if (opts.years != null) {
      years = clamp(Math.round(Number(opts.years)), 1, faGrade === "C" ? 2 : 6);
    }

    // 4. 총액 계산 (1 WAR당 기본 8.5억 기준)
    const rawAnnual = war3yr * 85000 * ageDiscount * pGrade;
    let totalValuation = Math.round(rawAnnual * years);

    // 5. 등급별 하드 캡(Hard Cap) 강제 적용
    totalValuation = Math.max(minTotal, Math.min(maxTotal, totalValuation));
    const annualAverage = Math.round(totalValuation / years);

    return {
      grade: faGrade,
      years: years,
      totalValuation: totalValuation, // 만원 단위
      annualAverage: annualAverage,
      // 기존 엔진/UI 호환 필드
      age,
      WAR_t1: +t1.toFixed(2),
      WAR_t2: +t2.toFixed(2),
      WAR_t3: +t3.toFixed(2),
      WAR_3yr: +war3yr.toFixed(3),
      warUnitValueManwon: 85000,
      D_age: +ageDiscount.toFixed(4),
      P_grade: pGrade,
      annualRequiredManwon: annualAverage,
      V_req: totalValuation,
      targetTotalManwon: totalValuation
    };
  }

  /**
   * FA 계약 구조 분할 (계약금, 연봉, 옵션)
   * - breakdownContract(targetValuationObj, faGrade) 및 breakdownContract(totalManwon, faGrade, years) 모두 지원
   */
  function breakdownContract(targetValuationOrTotal, faGrade = "B", yearsArg = null) {
    let total = 80000;
    let years = 2;
    let resolvedGrade = faGrade;

    if (typeof targetValuationOrTotal === "object" && targetValuationOrTotal !== null) {
      total = Number(
        targetValuationOrTotal.totalValuation != null
          ? targetValuationOrTotal.totalValuation
          : targetValuationOrTotal.V_req != null
          ? targetValuationOrTotal.V_req
          : targetValuationOrTotal.total != null
          ? targetValuationOrTotal.total
          : 80000
      );
      years = Number(targetValuationOrTotal.years || yearsArg || 2);
      if (!faGrade && targetValuationOrTotal.grade) {
        resolvedGrade = targetValuationOrTotal.grade;
      }
    } else {
      total = Number(targetValuationOrTotal) || 80000;
      const gUpper = String(faGrade || "B").toUpperCase();
      years = Number(yearsArg) || (gUpper === "A" ? 4 : gUpper === "B" ? 3 : 2);
    }

    const grade = ["A", "B", "C"].includes(String(resolvedGrade).toUpperCase())
      ? String(resolvedGrade).toUpperCase()
      : "C";
    years = Math.max(1, Math.round(years));
    total = Math.max(MIN_SALARY * years, Math.round(total));

    let guaranteeRatio = 0.90; // 순수 보장 비율
    let dpRatioOfGuarantee = 0.45; // 보장액 중 계약금 비율
    let optionClauseDesc = "";

    if (grade === "A") {
      guaranteeRatio = 0.90; // 보장 90%, 옵션 10%
      dpRatioOfGuarantee = 0.45; // 계약금 45%
      optionClauseDesc = "출장 경기 수(125G+)·규정타석/이닝 및 한국시리즈 우승 옵션";
    } else if (grade === "B") {
      guaranteeRatio = 0.75; // 보장 75%, 옵션 25%
      dpRatioOfGuarantee = 0.35; // 계약금 35%
      optionClauseDesc = "타석/이닝 수 달성, 퀄리티스타트(QS), 홀드/세이브 달성 옵션";
    } else {
      // C등급
      guaranteeRatio = 0.50; // ★ C등급은 보장 50%, 옵션 50%
      dpRatioOfGuarantee = 0.25; // 계약금 25%
      optionClauseDesc = "1군 등록일수(100일+) 및 출전 경기 수 연동 옵션 (보장 50% / 옵션 50%)";
    }

    const guaranteeTotal = Math.round(total * guaranteeRatio);
    const optionTotal = total - guaranteeTotal;

    // 계약금 (Down Payment)
    const downPayment = Math.round(guaranteeTotal * dpRatioOfGuarantee);
    // 잔여 보장액 -> 연분할 연봉
    const totalBaseSalary = guaranteeTotal - downPayment;
    const annualBaseSalary = Math.round(totalBaseSalary / years);
    const annualOption = Math.round(optionTotal / years);

    return {
      grade,
      years: years,
      total: total,                       // 총액 (예: C등급 8억 = 80,000만)
      downPayment: downPayment,           // 계약금 (예: 1억)
      annualBaseSalary: annualBaseSalary, // 연봉 (예: 1.5억)
      annualOption: annualOption,         // 연 옵션 (예: 2억)
      guaranteeTotal: guaranteeTotal,     // 보장 총액
      optionTotal: optionTotal,           // 옵션 총액
      // 기존 엔진/UI 완벽 호환 별칭
      totalManwon: total,
      guaranteedRatio: guaranteeRatio,
      optionRatio: +(1 - guaranteeRatio).toFixed(2),
      downPaymentShareOfGuaranteed: dpRatioOfGuarantee,
      guaranteedTotalManwon: guaranteeTotal,
      downPaymentManwon: downPayment,
      baseSalaryTotalManwon: totalBaseSalary,
      annualBaseSalaryManwon: annualBaseSalary,
      incentivesManwon: optionTotal,
      annualIncentiveManwon: annualOption,
      optionClauseDesc,
      Y: years,
      DP: downPayment,
      BS: totalBaseSalary,
      Opt: optionTotal
    };
  }

  /**
   * [PART 4] AI 선수의 오퍼 수용 확률 로지스틱 모델 (KBO_GM.FA.evaluateOfferAcceptance)
   * 1. 선수의 제안 효용 평가 (U_offer):
   *    - U_offer = (DP * 1.15) + BS + (Opt * alpha_player) + (Y * Year_Bonus)
   *    - 계약금(DP)은 일시금 프리미엄 가중치 1.15배 적용.
   *    - alpha_player = Math.max(0.25, 0.8 - (age - 30) * 0.04)
   * 2. 목표 효용 (U_target) 대비 충족률에 따른 로지스틱 수용 확률:
   *    - ratio = U_offer / U_target
   *    - P(Accept) = 1 / (1 + Math.exp(-12 * (ratio - 0.95)))
   *    - ratio >= 1.05 이면 수용 확률 95% 이상 (즉시 계약 성사)
   *    - ratio < 0.85 이면 수용 확률 5% 이하 (즉시 거절)
   */
  function evaluateOfferAcceptance(player, offer = {}, targetRef = null, options = {}) {
    if (!player) {
      throw new Error("오퍼 수용 확률 계산을 위해 유효한 player 객체가 필요합니다.");
    }

    const age = Number(player.age) || 30;
    const rng = options.rng || Math.random;

    // 1. alpha_player (선수의 인센티브 옵션 가치 평가 계수): 나이가 많을수록 옵션 가치를 낮게 평가
    // 수식: alpha = 0.8 - (나이 - 30) * 0.04 (최소 0.25, 최대 0.95)
    const rawAlpha = 0.8 - (age - 30) * 0.04;
    const alpha_player = +clamp(rawAlpha, 0.25, 0.95).toFixed(4);

    // 2. 선수의 목표 가치(Target Valuation) 및 목표 분할(Target Breakdown) 산출
    const gradeInfo =
      targetRef && targetRef.grade
        ? { grade: targetRef.grade }
        : player.faProfile && player.faProfile.faGrade
        ? { grade: player.faProfile.faGrade }
        : determineGrade(player, options.context || options);

    const valuation =
      targetRef && targetRef.V_req != null
        ? targetRef
        : calculateTargetValuation(player, gradeInfo.grade, options.context || null);

    const targetBreakdown =
      targetRef && targetRef.DP != null && targetRef.BS != null
        ? targetRef
        : breakdownContract(valuation.V_req, valuation.grade, valuation.years, {
            competitionLevel: options.competitionLevel != null ? options.competitionLevel : 0.5
          });

    // Year_Bonus (계약 기간 1년당 안정성 효용 보너스: 기준 연간 요구액의 5%)
    const Year_Bonus =
      options.yearBonusManwon != null
        ? Number(options.yearBonusManwon)
        : round100((valuation.annualRequiredManwon || 30000) * 0.05);

    // 3. 목표 효용 (U_target) 계산
    const targetY = Number(targetBreakdown.Y || targetBreakdown.years || valuation.years || 4);
    const targetDP = Number(targetBreakdown.DP != null ? targetBreakdown.DP : targetBreakdown.downPaymentManwon || 0);
    const targetBS = Number(
      targetBreakdown.BS != null ? targetBreakdown.BS : targetBreakdown.baseSalaryTotalManwon || 0
    );
    const targetOpt = Number(
      targetBreakdown.Opt != null ? targetBreakdown.Opt : targetBreakdown.incentivesManwon || 0
    );

    const U_target = Math.max(
      10000,
      Math.round(targetDP * 1.15 + targetBS + targetOpt * alpha_player + targetY * Year_Bonus)
    );

    // 4. 구단 제안 조건 (Y, DP, BS, Opt) 파싱 및 제안 효용 (U_offer) 계산
    const offerY = clamp(Math.round(Number(offer.Y || offer.years || targetY)), 1, 6);
    let offerDP = Number(
      offer.DP != null
        ? offer.DP
        : offer.downPaymentManwon != null
        ? offer.downPaymentManwon
        : offer.signingBonus != null
        ? offer.signingBonus
        : 0
    );
    let offerBS = Number(
      offer.BS != null
        ? offer.BS
        : offer.baseSalaryTotalManwon != null
        ? offer.baseSalaryTotalManwon
        : offer.annualSalary != null
        ? Number(offer.annualSalary) * offerY
        : 0
    );
    let offerOpt = Number(
      offer.Opt != null
        ? offer.Opt
        : offer.incentivesManwon != null
        ? offer.incentivesManwon
        : offer.optionsManwon != null
        ? offer.optionsManwon
        : 0
    );

    // 총액(totalAmount)만 넘어온 경우 해당 등급 표준 비율로 DP/BS/Opt 자동 분해
    if (offerDP === 0 && offerBS === 0 && offer.totalAmount != null) {
      const autoSplit = breakdownContract(Number(offer.totalAmount), valuation.grade, offerY);
      offerDP = autoSplit.DP;
      offerBS = autoSplit.BS;
      offerOpt = autoSplit.Opt;
    }

    const homeTeamBonus = options.isHomeTeam ? (options.isPriorityPhase ? 1.07 : 1.03) : 1.0;
    const negotiatorBonus = options.hasNegotiatorTrait ? 1.05 : 1.0;

    const rawUOffer = offerDP * 1.15 + offerBS + offerOpt * alpha_player + offerY * Year_Bonus;
    const U_offer = Math.round(rawUOffer * homeTeamBonus * negotiatorBonus);

    // 5. 충족률(ratio) 및 로지스틱 수용 확률 P(Accept) 산출
    const ratio = +(U_offer / U_target).toFixed(4);
    const logisticProb = 1 / (1 + Math.exp(-12 * (ratio - 0.95)));

    let probability = +logisticProb.toFixed(4);
    let status = "NEGOTIABLE";
    let accepted = false;
    let playerComment = "";

    if (ratio >= 1.05) {
      // ratio >= 1.05 이면 수용 확률 95% 이상 (즉시 계약 성사)
      probability = +Math.max(0.95, logisticProb).toFixed(4);
      status = "INSTANT_ACCEPT";
      accepted = true;
      playerComment = `"구단이 계약금(${(offerDP / 10000).toFixed(1)}억)과 보장 조건에서 최고의 예우를 해주셨습니다. 망설임 없이 도장을 찍겠습니다!"`;
    } else if (ratio < 0.85) {
      // ratio < 0.85 이면 수용 확률 5% 이하 (즉시 거절)
      probability = +Math.min(0.05, logisticProb).toFixed(4);
      status = "INSTANT_REJECT";
      accepted = false;
      playerComment = `"제 시장 가치(요구 총액 ${(valuation.V_req / 10000).toFixed(1)}억 원)에 비해 보장 금액과 계약금이 턱없이 부족합니다. 이 조건으로는 협상 테이블에 앉을 수 없습니다."`;
    } else {
      // 0.85 <= ratio < 1.05: 로지스틱 확률 P(Accept) 판정
      accepted = rng() < probability;
      status = accepted ? "LOGISTIC_ACCEPTED" : "LOGISTIC_REJECTED";
      playerComment = accepted
        ? `"세부 옵션과 계약금 비중에서 고민이 있었지만, 구단의 진정성을 믿고 계약을 수락하겠습니다!"`
        : `"조건이 제 기준치(충족률 ${(ratio * 100).toFixed(1)}%)에 약간 못 미칩니다. 계약금(일시금)이나 보장 연봉을 조금만 더 높여주십시오."`;
    }

    return {
      grade: valuation.grade,
      age,
      alpha_player,
      Year_Bonus,
      offer: {
        Y: offerY,
        DP: offerDP,
        BS: offerBS,
        Opt: offerOpt,
        annualBaseSalaryManwon: round100(offerBS / offerY),
        totalOfferManwon: offerDP + offerBS + offerOpt
      },
      target: {
        Y: targetY,
        DP: targetDP,
        BS: targetBS,
        Opt: targetOpt,
        V_req: valuation.V_req
      },
      U_offer,
      U_target,
      ratio,
      probability,
      probabilityPct: +(probability * 100).toFixed(1),
      status,
      accepted,
      playerComment
    };
  }

  const FA_MODULE = {
    WAR_UNIT_VALUE_MANWON,
    GRADE_PREMIUM_FACTORS,
    FA_GRADE_RULES,
    get3YearAverageSalaryManwon,
    convertProspectToManwonValue,
    calculateCompensationPenalty,
    determineGrade,
    calculateTargetValuation,
    breakdownContract,
    evaluateOfferAcceptance
  };

  if (KBO_GM) {
    KBO_GM.FA = Object.assign(KBO_GM.FA || {}, FA_MODULE);
  }

  /**
   * FA 자격 선수의 등급(A / B / C) 및 시장 요구 계약 조건(연수, 계약금, 보장연봉, 옵션, 총액) 통합 산정
   */
  function evaluateFAPlayerMarketProfile(player, context = null) {
    const prevSalary = player.salary || 10000;
    const gradeInfo = determineGrade(player, context || {});
    const faGrade = gradeInfo.grade;
    const valuation = calculateTargetValuation(player, faGrade, context);
    const breakdown = breakdownContract(valuation.V_req, faGrade, valuation.years, {
      competitionLevel: faGrade === "A" ? 0.65 : faGrade === "B" ? 0.50 : 0.35
    });

    const demandYears = breakdown.years;
    const demandSigningBonus = breakdown.downPaymentManwon;
    const demandBaseSalaryTotal = breakdown.baseSalaryTotalManwon;
    const demandAnnual = breakdown.annualBaseSalaryManwon;
    const demandOption = breakdown.incentivesManwon;
    const demandTotal = breakdown.totalManwon;

    return {
      faGrade,
      gradeReason: gradeInfo.gradeReason,
      clubSalaryRank: gradeInfo.clubSalaryRank,
      leagueSalaryRank: gradeInfo.leagueSalaryRank,
      avgSalary3YrManwon: gradeInfo.avgSalary3YrManwon,
      Penalty_comp: gradeInfo.Penalty_comp,
      compensationPenalty: gradeInfo.compensationPenalty,
      WAR_3yr: valuation.WAR_3yr,
      D_age: valuation.D_age,
      P_grade: valuation.P_grade,
      annualRequiredManwon: valuation.annualRequiredManwon,
      rule: FA_GRADE_RULES[faGrade],
      prevSalary,
      demandYears,
      demandAnnual,
      demandSigningBonus,
      demandBaseSalaryTotal,
      demandOption,
      demandTotal,
      breakdown
    };
  }

  /**
   * 10개 구단에서 당해 FA 권리 행사 선수(구단별 최대 2~3명, 리그 전체 약 20~28명) 추출 및 공시
   */
  function declareEligibleFAPlayers(context, options = {}) {
    const maxPerTeam = options.maxFAsPerTeam || 3;
    const newlyDeclared = [];

    context.kboTeams.forEach((team) => {
      const candidates = [];
      team.roster1G.forEach((p) => {
        const reqYears = p.origin === "UNIV" ? 7 : 8;
        if (p.nationality === "KOR" && (p.contractYears || 1) <= 1 && (p.faYears || 0) >= reqYears) {
          candidates.push(p);
        }
      });
      team.roster2G.forEach((p) => {
        const reqYears = p.origin === "UNIV" ? 7 : 8;
        if (p.nationality === "KOR" && (p.contractYears || 1) <= 1 && (p.faYears || 0) >= reqYears && p.getTrueOvr() >= 73) {
          candidates.push(p);
        }
      });

      // 시장 가치가 높은 상위 maxPerTeam명만 실제 FA 권리 신청 (나머지는 구단 단년 재계약 잔류)
      candidates.sort((a, b) => (b.getTrueOvr() + b.getWar() * 3) - (a.getTrueOvr() + a.getWar() * 3));
      const exercisingIds = new Set(candidates.slice(0, maxPerTeam).map((p) => p.id));

      // 미신청 FA 유자격자는 연봉 재계약(적정 연봉) 처리
      candidates.slice(maxPerTeam).forEach((stayer) => {
        stayer.salary = calculateFairSalary(stayer);
        stayer.contractYears = 1;
      });

      const moveToFAPool = (p) => {
        p.formerTeamId = team.id;
        p.formerTeamName = team.name;
        p.status = "FA";
        p.teamId = null;
        p.faProfile = evaluateFAPlayerMarketProfile(p, context);
        context.faPool.push(p);
        newlyDeclared.push(p);
      };

      team.roster1G = team.roster1G.filter((p) => {
        if (exercisingIds.has(p.id)) {
          moveToFAPool(p);
          return false;
        }
        return true;
      });

      team.roster2G = team.roster2G.filter((p) => {
        if (exercisingIds.has(p.id)) {
          moveToFAPool(p);
          return false;
        }
        return true;
      });
    });

    // 기존 context.faPool에 있던 선수들도 faProfile 보장
    context.faPool.forEach((p) => {
      if (!p.faProfile || !p.faProfile.breakdown) {
        p.faProfile = evaluateFAPlayerMarketProfile(p, context);
      }
      if (!p.formerTeamId) {
        p.formerTeamId = "KIA";
        p.formerTeamName = "광주 고양이즈";
      }
    });

    if (!context.faMarketPhase) {
      context.faMarketPhase = "PRIORITY";
    }
    if (!Array.isArray(context.faSignedHistory)) {
      context.faSignedHistory = [];
    }

    return newlyDeclared;
  }

  /**
   * [요청 3] FA 시장 협상 단계 조회 (PRIORITY: 원소속구단 우선협상 기간 / OPEN: 전 구단 완전 개방 기간)
   */
  function getFAMarketPhaseStatus(context) {
    if (!context) {
      return {
        phase: "PRIORITY",
        phaseLabel: "1단계: 원소속구단 우선협상 기간",
        canNegotiateExternal: false,
        homeFACount: 0,
        externalFACount: 0,
        totalFACount: 0
      };
    }
    if (!context.faMarketPhase) {
      context.faMarketPhase = "PRIORITY";
    }
    const faPool = Array.isArray(context.faPool) ? context.faPool : [];
    const userTeamId = context.userTeamId;
    const homeFAs = faPool.filter((p) => p.formerTeamId === userTeamId);
    const externalFAs = faPool.filter((p) => p.formerTeamId !== userTeamId);
    const isPriority = context.faMarketPhase === "PRIORITY";

    return {
      phase: context.faMarketPhase,
      phaseLabel: isPriority
        ? "1단계: 원소속구단 우선협상 기간 (독점 협상 · 보상금/보상선수 면제 · 충성도 보너스 +7%)"
        : "2단계: 전 구단 완전 개방 기간 (Open Market · 타 구단 AI 실시간 경쟁 입찰 및 A/B/C 보상규정 적용)",
      canNegotiateExternal: !isPriority,
      homeFACount: homeFAs.length,
      externalFACount: externalFAs.length,
      totalFACount: faPool.length,
      signedHistoryCount: Array.isArray(context.faSignedHistory) ? context.faSignedHistory.length : 0
    };
  }

  /**
   * [요청 3] 원소속구단 우선협상 기간 종료 -> 전 구단 자유협상(OPEN) 시장 전환 (또는 단계 직접 전환)
   * - PRIORITY -> OPEN 전환 시 타 AI 구단들도 자팀 핵심 FA 중 일부와 우선협상 재계약을 시도하여 현실성 부여
   */
  function advanceToOpenFAMarket(context, options = {}) {
    if (!context) return { ok: false, message: "유효한 게임 컨텍스트가 없습니다." };
    const targetPhase = options.targetPhase || "OPEN";
    const rng = options.rng || Math.random;

    if (!Array.isArray(context.faSignedHistory)) {
      context.faSignedHistory = [];
    }

    const aiPrioritySignings = [];
    if (context.faMarketPhase === "PRIORITY" && targetPhase === "OPEN" && options.simulateAIPriority !== false) {
      const remainingPool = [];
      (context.faPool || []).forEach((faPlayer) => {
        const prof = faPlayer.faProfile || evaluateFAPlayerMarketProfile(faPlayer, context);
        faPlayer.faProfile = prof;

        // 유저 구단 소속 FA거나 원소속구단이 없는 경우 그대로 오픈 마켓 진출
        if (!faPlayer.formerTeamId || faPlayer.formerTeamId === context.userTeamId) {
          remainingPool.push(faPlayer);
          return;
        }

        const formerTeam = context.getTeam ? context.getTeam(faPlayer.formerTeamId) : null;
        if (!formerTeam) {
          remainingPool.push(faPlayer);
          return;
        }

        // AI 원소속구단이 우선협상 기간에 잔류 계약을 성사시킬 확률 (A급/B급 프랜차이즈 중 예산 여유 시)
        const canAfford = (formerTeam.budget || 1200000) >= prof.demandSigningBonus + 350000;
        const retainProb = !canAfford
          ? 0.0
          : prof.faGrade === "A"
          ? 0.42
          : prof.faGrade === "B"
          ? 0.35
          : 0.25;

        if (rng() < retainProb) {
          const years = prof.demandYears;
          const totalAmount = round100(prof.demandTotal * (0.96 + rng() * 0.08));
          const split = breakdownContract(totalAmount, prof.faGrade, years);
          formerTeam.budget = Math.max(200000, (formerTeam.budget || 1200000) - split.DP);
          faPlayer.teamId = formerTeam.id;
          faPlayer.salary = split.annualBaseSalaryManwon;
          faPlayer.contractYears = years;
          faPlayer.faYears = 0;
          if (formerTeam.roster1G.length < 28) {
            faPlayer.status = "1GUN";
            formerTeam.roster1G.push(faPlayer);
          } else {
            faPlayer.status = "2GUN";
            formerTeam.roster2G.push(faPlayer);
          }
          const rec = {
            playerId: faPlayer.id,
            playerName: faPlayer.name,
            pos: faPlayer.pos,
            age: faPlayer.age,
            faGrade: prof.faGrade,
            formerTeamId: formerTeam.id,
            newTeamId: formerTeam.id,
            newTeamName: formerTeam.name,
            isRetention: true,
            years,
            annualSalary: split.annualBaseSalaryManwon,
            signingBonus: split.DP,
            incentives: split.Opt,
            totalAmount,
            phase: "PRIORITY",
            compensation: null,
            note: "원소속구단 우선협상 기간 잔류 타결"
          };
          aiPrioritySignings.push(rec);
          context.faSignedHistory.push(rec);
        } else {
          remainingPool.push(faPlayer);
        }
      });
      context.faPool = remainingPool;
    }

    context.faMarketPhase = targetPhase;
    return {
      ok: true,
      phase: context.faMarketPhase,
      aiPrioritySignings,
      status: getFAMarketPhaseStatus(context),
      message:
        targetPhase === "OPEN"
          ? `전 구단 자유협상(Open Market) 기간이 개시되었습니다! (타 구단 우선협상 잔류 ${aiPrioritySignings.length}명 / 시장 잔여 FA ${(context.faPool || []).length}명)`
          : `원소속구단 우선협상 기간(PRIORITY)으로 전환되었습니다.`
    };
  }

  /**
   * [요청 4] FA 선수 리스트 세분화 필터링 및 등급(A/B/C) · 포지션별 통계 집계
   * @param {Array} faPool
   * @param {Object} filterSpec - { grade: 'ALL'|'A'|'B'|'C', posGroup: 'ALL'|'PITCHER'|'SP'|'RP'|'CL'|'C'|'IF'|'1B'|'2B'|'3B'|'SS'|'OF'|'DH', affiliation: 'ALL'|'HOME'|'EXTERNAL', sortBy: 'OVR'|'WAR'|'DEMAND'|'AGE' }
   * @param {GMGameContext} context
   */
  function filterAndGroupFAPlayers(faPool = [], filterSpec = {}, context = null) {
    const list = Array.isArray(faPool) ? faPool : [];
    const userTeamId = context && context.userTeamId ? context.userTeamId : null;
    const gradeFilter = (filterSpec.grade || "ALL").toUpperCase();
    const posFilter = (filterSpec.posGroup || "ALL").toUpperCase();
    const affFilter = (filterSpec.affiliation || "ALL").toUpperCase();
    const sortBy = (filterSpec.sortBy || "DEMAND").toUpperCase();

    const gradeCounts = { ALL: list.length, A: 0, B: 0, C: 0 };
    const posCounts = {
      ALL: list.length,
      PITCHER: 0,
      SP: 0,
      RP: 0,
      CL: 0,
      C: 0,
      IF: 0,
      "1B": 0,
      "2B": 0,
      "3B": 0,
      SS: 0,
      OF: 0,
      LF: 0,
      CF: 0,
      RF: 0,
      DH: 0
    };
    const affiliationCounts = { ALL: list.length, HOME: 0, EXTERNAL: 0 };

    const enriched = list.map((p) => {
      const prof = p.faProfile || evaluateFAPlayerMarketProfile(p, context);
      p.faProfile = prof;
      const g = prof.faGrade || "C";
      if (gradeCounts[g] != null) gradeCounts[g] += 1;

      const pos = String(p.pos || "DH").toUpperCase();
      if (posCounts[pos] != null) posCounts[pos] += 1;
      if (pos === "SP" || pos === "RP" || pos === "CL" || p.type === "pitcher") {
        posCounts.PITCHER += 1;
      }
      if (pos === "1B" || pos === "2B" || pos === "3B" || pos === "SS") {
        posCounts.IF += 1;
      }
      if (pos === "LF" || pos === "CF" || pos === "RF" || pos === "OF") {
        posCounts.OF += 1;
      }

      const isHome = userTeamId && p.formerTeamId === userTeamId;
      if (isHome) affiliationCounts.HOME += 1;
      else affiliationCounts.EXTERNAL += 1;

      return p;
    });

    const filtered = enriched.filter((p) => {
      const prof = p.faProfile;
      const g = (prof && prof.faGrade) || "C";
      if (gradeFilter !== "ALL" && g !== gradeFilter) return false;

      const pos = String(p.pos || "DH").toUpperCase();
      if (posFilter !== "ALL") {
        if (posFilter === "PITCHER") {
          if (!(pos === "SP" || pos === "RP" || pos === "CL" || p.type === "pitcher")) return false;
        } else if (posFilter === "IF") {
          if (!(pos === "1B" || pos === "2B" || pos === "3B" || pos === "SS")) return false;
        } else if (posFilter === "OF") {
          if (!(pos === "LF" || pos === "CF" || pos === "RF" || pos === "OF")) return false;
        } else if (pos !== posFilter) {
          return false;
        }
      }

      if (affFilter === "HOME" && (!userTeamId || p.formerTeamId !== userTeamId)) return false;
      if (affFilter === "EXTERNAL" && userTeamId && p.formerTeamId === userTeamId) return false;

      return true;
    });

    filtered.sort((a, b) => {
      const pa = a.faProfile || {};
      const pb = b.faProfile || {};
      if (sortBy === "OVR") {
        const oa = typeof a.getTrueOvr === "function" ? a.getTrueOvr() : 70;
        const ob = typeof b.getTrueOvr === "function" ? b.getTrueOvr() : 70;
        return ob - oa;
      }
      if (sortBy === "WAR") {
        return (pb.war3yr || 0) - (pa.war3yr || 0);
      }
      if (sortBy === "AGE") {
        return (a.age || 30) - (b.age || 30);
      }
      return (pb.demandTotal || 0) - (pa.demandTotal || 0);
    });

    return {
      players: filtered,
      totalCount: list.length,
      filteredCount: filtered.length,
      gradeCounts,
      posCounts,
      affiliationCounts
    };
  }

  /**
   * [요청 3] 실제 다회차(최대 3라운드) 양방향 FA 협상 및 즉시 계약 타결 엔진
   * - 우선협상 기간(PRIORITY)에는 원소속구단 선수와 독점 협상(타 구단 입찰 배제 + 충성도 보너스 +7%)
   * - 전 구단 개방 기간(OPEN)에는 타 AI 구단 경쟁 오퍼 생성 및 에이전트 역제안(Counter-Offer) 발생
   * - 타결 시 즉시 구단 로스터 편입 및 외부 A/B/C 등급 보상선수/보상금 정산
   */
  function negotiateFAPlayerDirect(context, playerId, offerSpec = {}, options = {}) {
    if (!context || !Array.isArray(context.faPool)) {
      return { ok: false, message: "유효한 FA 시장 컨텍스트가 없습니다." };
    }
    const userTeam = context.getUserTeam ? context.getUserTeam() : null;
    if (!userTeam) {
      return { ok: false, message: "유저 구단 정보를 찾을 수 없습니다." };
    }

    const faPlayer = context.faPool.find((p) => p.id === playerId);
    if (!faPlayer) {
      return { ok: false, message: "해당 선수는 이미 계약이 완료되었거나 FA 명단에 없습니다." };
    }

    const prof = faPlayer.faProfile || evaluateFAPlayerMarketProfile(faPlayer, context);
    faPlayer.faProfile = prof;

    if (!context.faMarketPhase) {
      context.faMarketPhase = "PRIORITY";
    }
    const phase = context.faMarketPhase;
    const isHomeTeam = faPlayer.formerTeamId === userTeam.id;

    // 1. 우선협상 기간(PRIORITY) 검증: 원소속구단 선수만 협상 가능
    if (phase === "PRIORITY" && !isHomeTeam && !options.allowExternalInPriority) {
      return {
        ok: false,
        code: "PRIORITY_WINDOW_RESTRICTED",
        phase,
        playerName: faPlayer.name,
        formerTeamName: faPlayer.formerTeamName || faPlayer.formerTeamId,
        message: `[우선협상 기간 제한] 현재 '원소속구단 우선협상 기간'입니다. 타 구단(${faPlayer.formerTeamName || faPlayer.formerTeamId}) 소속 FA ${faPlayer.name} 선수와 협상하려면 상단의 [전 구단 자유협상(Open Market) 전환]을 먼저 진행해 주세요.`
      };
    }

    // 2. 선수별 다회차 협상 상태 초기화/조회
    if (!faPlayer.faNegotiationState) {
      let competingBid = null;
      if (phase === "OPEN") {
        // 오픈 마켓일 경우 관심 있는 경쟁 AI 구단 오퍼 생성
        const candidateTeams = (context.kboTeams || []).filter(
          (t) => t.id !== userTeam.id && (t.budget || 1200000) >= prof.demandTotal * 0.4
        );
        if (candidateTeams.length > 0) {
          const seed = String(faPlayer.id || "FA")
            .split("")
            .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
          const rivalTeam = candidateTeams[seed % candidateTeams.length];
          const rivalFactor = prof.faGrade === "A" ? 1.02 : prof.faGrade === "B" ? 0.98 : 0.94;
          const rivalTotal = round100(prof.demandTotal * rivalFactor);
          const rivalSplit = breakdownContract(rivalTotal, prof.faGrade, prof.demandYears);
          const rivalEval = evaluateOfferAcceptance(
            faPlayer,
            { Y: rivalSplit.Y, DP: rivalSplit.DP, BS: rivalSplit.BS, Opt: rivalSplit.Opt },
            prof.breakdown,
            { isHomeTeam: rivalTeam.id === faPlayer.formerTeamId, context }
          );
          competingBid = {
            teamId: rivalTeam.id,
            teamName: rivalTeam.name,
            Y: rivalSplit.Y,
            DP: rivalSplit.DP,
            BS: rivalSplit.BS,
            Opt: rivalSplit.Opt,
            annualBS: rivalSplit.annualBaseSalaryManwon,
            totalManwon: rivalSplit.totalManwon,
            U_offer: rivalEval.U_offer
          };
        }
      }

      faPlayer.faNegotiationState = {
        round: 0,
        maxRounds: 3,
        status: "ACTIVE", // ACTIVE | COUNTERED | SIGNED | WALKED_AWAY
        patience: 100,
        competingBid,
        lastCounterOffer: null,
        history: []
      };
    }

    const negState = faPlayer.faNegotiationState;
    if (negState.status === "WALKED_AWAY") {
      return {
        ok: false,
        code: "NEGOTIATION_BROKEN",
        negotiationState: negState,
        message: `${faPlayer.name} 선수 측 에이전트가 이미 협상 결렬을 선언하여 더 이상 개별 제안을 받지 않습니다.`
      };
    }

    // 3. 유저 제시 조건 정규화 (역제안 즉시 수락 옵션 지원)
    let offerY = clamp(Math.round(Number(offerSpec.Y || offerSpec.years || prof.demandYears || 4)), 1, 6);
    let offerDP = Math.max(0, round100(Number(offerSpec.DP != null ? offerSpec.DP : offerSpec.signingBonus || 0)));
    let offerBS = Math.max(
      MIN_SALARY * offerY,
      round100(
        Number(
          offerSpec.BS != null
            ? offerSpec.BS
            : offerSpec.annualBS != null
            ? Number(offerSpec.annualBS) * offerY
            : prof.demandBaseSalaryTotal
        )
      )
    );
    let offerOpt = Math.max(0, round100(Number(offerSpec.Opt != null ? offerSpec.Opt : offerSpec.incentives || 0)));

    if (options.acceptCounterOffer && negState.lastCounterOffer) {
      const co = negState.lastCounterOffer;
      offerY = co.Y;
      offerDP = co.DP;
      offerBS = co.BS;
      offerOpt = co.Opt;
    }

    const annualSalary = Math.max(MIN_SALARY, round100(offerBS / offerY));
    const totalOfferManwon = offerDP + offerBS + offerOpt;

    // 예산 확인 (계약금 + 첫해 연봉 + 외부 영입 시 예상 현금보상금 지불 가능 여부)
    const expectedCompCash = isHomeTeam
      ? 0
      : Math.round((prof.prevSalary || 15000) * (prof.faGrade === "A" ? 2.0 : prof.faGrade === "B" ? 1.0 : 1.5));
    if ((userTeam.budget || 0) < offerDP + expectedCompCash) {
      return {
        ok: false,
        code: "INSUFFICIENT_BUDGET",
        message: `구단 가용 예산(${((userTeam.budget || 0) / 10000).toFixed(2)}억)이 계약금(${(offerDP / 10000).toFixed(2)}억) 및 예상 보상금(${(expectedCompCash / 10000).toFixed(2)}억) 합계보다 부족합니다.`
      };
    }

    negState.round += 1;

    const hasNegotiator =
      (context.gmProfile && context.gmProfile.trait === "NEGOTIATOR") || (context.negotiationDiscount || 0) > 0;

    const evalResult = evaluateOfferAcceptance(
      faPlayer,
      { Y: offerY, DP: offerDP, BS: offerBS, Opt: offerOpt },
      prof.breakdown,
      {
        isHomeTeam,
        isPriorityPhase: phase === "PRIORITY",
        hasNegotiatorTrait: hasNegotiator,
        rng: options.rng || Math.random,
        context
      }
    );

    // 오픈 마켓에서 경쟁 구단 오퍼가 있을 경우 경쟁 오퍼 대비 경쟁력 체크
    const competingBid = phase === "OPEN" ? negState.competingBid : null;
    const beatsCompetingBid =
      !competingBid || evalResult.U_offer >= competingBid.U_offer * 0.97 || options.acceptCounterOffer;

    const isAccepted =
      Boolean(options.acceptCounterOffer) || (evalResult.accepted && beatsCompetingBid);

    if (isAccepted) {
      // 즉시 계약 체결 처리!
      negState.status = "SIGNED";
      userTeam.budget = clamp((userTeam.budget || 1200000) - offerDP, 100000, 2500000);

      const formerTeam = context.getTeam ? context.getTeam(faPlayer.formerTeamId) : null;
      faPlayer.teamId = userTeam.id;
      faPlayer.salary = annualSalary;
      faPlayer.contractYears = offerY;
      faPlayer.faYears = 0;

      // FA 풀에서 제거하고 유저 구단 1군(정원 초과 시 백업 2군 강등)에 등록
      context.faPool = context.faPool.filter((p) => p.id !== faPlayer.id);
      if (userTeam.roster1G.length < 28) {
        faPlayer.status = "1GUN";
        userTeam.roster1G.push(faPlayer);
      } else {
        const demote1G = userTeam.roster1G
          .filter((p) => p.nationality === "KOR")
          .sort((a, b) => a.getTrueOvr() - b.getTrueOvr())[0];
        if (demote1G) {
          userTeam.roster1G = userTeam.roster1G.filter((p) => p.id !== demote1G.id);
          demote1G.status = "2GUN";
          userTeam.roster2G.push(demote1G);
        }
        faPlayer.status = "1GUN";
        userTeam.roster1G.push(faPlayer);
      }

      if (typeof faPlayer.updateScoutingReport === "function") {
        faPlayer.updateScoutingReport(context.scoutLevel || 1, true);
      }

      // 외부 FA 영입인 경우 즉시 보상금 및 20인/25인 외 보상선수 지명 실행
      let compResult = null;
      if (formerTeam && formerTeam.id !== userTeam.id) {
        compResult = executeFACompensation(context, userTeam, formerTeam, faPlayer, options);
      }

      if (prof.faGrade === "A") {
        userTeam.fanRatio = clamp((userTeam.fanRatio || 50) + 6, 0, 100);
      } else if (prof.faGrade === "B") {
        userTeam.fanRatio = clamp((userTeam.fanRatio || 50) + 3, 0, 100);
      }

      const signedRecord = {
        playerId: faPlayer.id,
        playerName: faPlayer.name,
        pos: faPlayer.pos,
        age: faPlayer.age,
        faGrade: prof.faGrade,
        formerTeamId: faPlayer.formerTeamId,
        newTeamId: userTeam.id,
        newTeamName: userTeam.name,
        isRetention: isHomeTeam,
        phase,
        round: negState.round,
        years: offerY,
        annualSalary,
        signingBonus: offerDP,
        baseSalaryTotal: offerBS,
        incentives: offerOpt,
        totalAmount: totalOfferManwon,
        compensation: compResult
      };

      if (!Array.isArray(context.faSignedHistory)) {
        context.faSignedHistory = [];
      }
      context.faSignedHistory.push(signedRecord);

      negState.history.push({
        round: negState.round,
        phase,
        offer: { Y: offerY, DP: offerDP, BS: offerBS, Opt: offerOpt, totalManwon: totalOfferManwon },
        outcome: "SIGNED",
        ratio: evalResult.ratio,
        comment: evalResult.playerComment
      });

      return {
        ok: true,
        outcome: "SIGNED",
        phase,
        round: negState.round,
        maxRounds: negState.maxRounds,
        signedContract: signedRecord,
        compensation: compResult,
        evalResult,
        negotiationState: negState,
        message: `🎉 [${faPlayer.name} FA 계약 타결!] ${offerY}년 총액 ${(totalOfferManwon / 10000).toFixed(2)}억 원 (계약금 ${(offerDP / 10000).toFixed(2)}억 · 연봉 ${(annualSalary / 10000).toFixed(2)}억 · 옵션 ${(offerOpt / 10000).toFixed(2)}억)${compResult ? ` | 보상: ${compResult.summary}` : " (원소속 잔류 · 보상 없음)"}`
      };
    }

    // 4. 미타결 시: 헐값 오퍼(ratio < 0.76)이거나 3라운드 모두 소진 시 협상 결렬(WALKED_AWAY)
    const patienceLoss = evalResult.ratio < 0.85 ? 45 : 25;
    negState.patience = Math.max(0, negState.patience - patienceLoss);

    if (evalResult.ratio < 0.76 || negState.round >= negState.maxRounds || negState.patience <= 0) {
      negState.status = "WALKED_AWAY";
      const walkReason =
        evalResult.ratio < 0.76
          ? `"구단이 제시한 총액 ${(totalOfferManwon / 10000).toFixed(1)}억 원(충족률 ${(evalResult.ratio * 100).toFixed(1)}%)은 제 자존심을 짓밟는 조건입니다. 협상 테이블을 접겠습니다!"`
          : `"${negState.maxRounds}차례 협상에도 불구하고 구단과의 시각차를 좁히지 못했습니다. 다른 구단의 오퍼를 알아보겠습니다."`;

      negState.history.push({
        round: negState.round,
        phase,
        offer: { Y: offerY, DP: offerDP, BS: offerBS, Opt: offerOpt, totalManwon: totalOfferManwon },
        outcome: "WALKED_AWAY",
        ratio: evalResult.ratio,
        comment: walkReason
      });

      return {
        ok: true,
        outcome: "WALKED_AWAY",
        phase,
        round: negState.round,
        maxRounds: negState.maxRounds,
        evalResult,
        negotiationState: negState,
        message: `❌ [${faPlayer.name} 협상 최종 결렬 (${negState.round}/${negState.maxRounds}차)] ${walkReason}`
      };
    }

    // 5. 에이전트 역제안(Counter-Offer) 산출 (1~2라운드 미타결 시)
    negState.status = "COUNTERED";
    const targetBD = prof.breakdown || breakdownContract(prof.demandTotal, prof.faGrade, prof.demandYears);
    const concessionRate = isHomeTeam ? (phase === "PRIORITY" ? 0.95 : 0.98) : 1.02;
    const baseTargetTotal = competingBid
      ? Math.max(targetBD.totalManwon * concessionRate, competingBid.totalManwon * 1.02)
      : targetBD.totalManwon * concessionRate;

    // 유저 제안과 에이전트 목표치 사이에서 현실적인 역제안(가중평균 72:28) 생성
    const counterY = clamp(Math.round((targetBD.Y * 0.65 + offerY * 0.35)), 1, 6);
    const counterTotal = Math.max(
      totalOfferManwon + 5000,
      round100(baseTargetTotal * 0.72 + totalOfferManwon * 0.28)
    );
    const counterSplit = breakdownContract(counterTotal, prof.faGrade, counterY, {
      competitionLevel: phase === "OPEN" ? 0.75 : 0.45
    });

    const counterOffer = {
      Y: counterY,
      DP: counterSplit.DP,
      BS: counterSplit.BS,
      Opt: counterSplit.Opt,
      annualBS: counterSplit.annualBaseSalaryManwon,
      totalManwon: counterSplit.totalManwon
    };
    negState.lastCounterOffer = counterOffer;

    const rivalMsg = competingBid
      ? ` 현재 [${competingBid.teamName}] 측에서 ${competingBid.Y}년 총액 ${(competingBid.totalManwon / 10000).toFixed(1)}억 원 오퍼를 제시한 상태입니다.`
      : phase === "PRIORITY"
      ? ` 원소속구단 예우를 감안해 요구액을 일부 조정했습니다.`
      : "";

    const agentComment = `"${evalResult.playerComment}${rivalMsg} 에이전트 측 수정 역제안은 [${counterOffer.Y}년 총액 ${(counterOffer.totalManwon / 10000).toFixed(2)}억 원 (계약금 ${(counterOffer.DP / 10000).toFixed(2)}억 / 연봉 ${(counterOffer.annualBS / 10000).toFixed(2)}억 / 옵션 ${(counterOffer.Opt / 10000).toFixed(2)}억)] 입니다."`;

    negState.history.push({
      round: negState.round,
      phase,
      offer: { Y: offerY, DP: offerDP, BS: offerBS, Opt: offerOpt, totalManwon: totalOfferManwon },
      counterOffer,
      outcome: "COUNTER_OFFER",
      ratio: evalResult.ratio,
      comment: agentComment
    });

    return {
      ok: true,
      outcome: "COUNTER_OFFER",
      phase,
      round: negState.round,
      maxRounds: negState.maxRounds,
      counterOffer,
      competingBid,
      evalResult,
      negotiationState: negState,
      message: `💬 [${faPlayer.name} ${negState.round}/${negState.maxRounds}차 협상 — 에이전트 역제안] ${agentComment}`
    };
  }

  /**
   * 타구단 FA 영입 시 보호선수(A등급 20인 / B등급 25인) 외 보상선수 1명 자동 지명 및 보상금 정산
   */
  function executeFACompensation(context, signingTeam, formerTeam, signedFAPlayer, options = {}) {
    const profile = signedFAPlayer.faProfile || evaluateFAPlayerMarketProfile(signedFAPlayer);
    const gradeRule = FA_GRADE_RULES[profile.faGrade] || FA_GRADE_RULES.C;
    const prevSalary = profile.prevSalary || signedFAPlayer.salary || 15000;

    // 원소속구단 재계약(잔류)이거나 C등급이면 보상선수 없음
    if (!formerTeam || signingTeam.id === formerTeam.id) {
      return null;
    }

    if (profile.faGrade === "C") {
      const cashComp = Math.round(prevSalary * gradeRule.cashOnlyMultiplier);
      signingTeam.budget = (signingTeam.budget || 0) - cashComp;
      formerTeam.budget = (formerTeam.budget || 0) + cashComp;
      return {
        faGrade: "C",
        fromTeamId: signingTeam.id,
        toTeamId: formerTeam.id,
        cashCompensation: cashComp,
        compensatedPlayer: null,
        summary: `C등급 보상금 ${(cashComp / 10000).toFixed(2)}억원 지급 (보상선수 없음)`
      };
    }

    // A등급(20인 보호) 또는 B등급(25인 보호) 보호선수 명단 작성
    // 외국인 선수, 당해 신인, 방금 영입한 FA 선수는 자동 보호 대상
    const eligiblePool = signingTeam.getAllPlayers().filter((p) => {
      if (p.id === signedFAPlayer.id) return false;
      if (p.nationality && p.nationality !== "KOR") return false;
      if (p.draftInfo && p.draftInfo.year === (context.currentYear || 2026)) return false;
      return true;
    });

    const protectedCount = gradeRule.protectedCount; // A: 20, B: 25
    let protectedIds = new Set();

    // 유저 구단이 직접 지정한 보호선수 명단(options.userProtectedIds 또는 signingTeam.customProtectedIds)이 있으면 우선 적용
    const customModeKey = profile.faGrade === "A" ? "FA_20" : "FA_25";
    const savedCustomList =
      signingTeam.customProtectedIds && Array.isArray(signingTeam.customProtectedIds[customModeKey])
        ? signingTeam.customProtectedIds[customModeKey]
        : [];
    const effectiveUserProtected =
      Array.isArray(options.userProtectedIds) && options.userProtectedIds.length > 0
        ? options.userProtectedIds
        : savedCustomList;

    if (signingTeam.id === context.userTeamId && effectiveUserProtected.length > 0) {
      effectiveUserProtected.slice(0, protectedCount).forEach((id) => protectedIds.add(id));
    } else {
      // 자동 보호 알고리즘: 현재 능력치(OVR) + 유망주 잠재력 가치가 높은 상위 N명 보호
      const rankedForProtection = eligiblePool.slice().sort((a, b) => {
        const valA = a.getTrueOvr() * 0.62 + (a.potential || 70) * 0.38 - Math.max(0, a.age - 31) * 1.8;
        const valB = b.getTrueOvr() * 0.62 + (b.potential || 70) * 0.38 - Math.max(0, b.age - 31) * 1.8;
        return valB - valA;
      });
      rankedForProtection.slice(0, protectedCount).forEach((p) => protectedIds.add(p.id));
    }

    // 보호선수 명단에서 풀린 선수들 중 원소속구단이 가장 가치 높은 선수(젊은 유망주/즉시전력) 1명 지명
    const unprotectedPool = eligiblePool.filter((p) => !protectedIds.has(p.id));
    unprotectedPool.sort((a, b) => {
      const scoreA = a.getTrueOvr() * 0.55 + (a.potential || 70) * 0.45 + Math.max(0, 26 - a.age) * 1.2;
      const scoreB = b.getTrueOvr() * 0.55 + (b.potential || 70) * 0.45 + Math.max(0, 26 - b.age) * 1.2;
      return scoreB - scoreA;
    });

    const chosenCompPlayer = unprotectedPool[0] || null;
    if (!chosenCompPlayer) {
      const cashOnly = Math.round(prevSalary * gradeRule.cashOnlyMultiplier);
      signingTeam.budget = clamp((signingTeam.budget || 1200000) - cashOnly, 1000000, 2500000);
      formerTeam.budget = clamp((formerTeam.budget || 1200000) + cashOnly, 1000000, 2500000);
      return {
        faGrade: profile.faGrade,
        fromTeamId: signingTeam.id,
        toTeamId: formerTeam.id,
        cashCompensation: cashOnly,
        compensatedPlayer: null,
        summary: `${profile.faGrade}등급 전액 금전보상 ${(cashOnly / 10000).toFixed(2)}억원 지급`
      };
    }

    // 영입 구단 로스터에서 보상선수 제거 후 원소속구단 로스터로 이동
    signingTeam.roster1G = signingTeam.roster1G.filter((p) => p.id !== chosenCompPlayer.id);
    signingTeam.roster2G = signingTeam.roster2G.filter((p) => p.id !== chosenCompPlayer.id);
    signingTeam.rosterDev = signingTeam.rosterDev.filter((p) => p.id !== chosenCompPlayer.id);

    chosenCompPlayer.teamId = formerTeam.id;
    if (formerTeam.roster1G.length < 28) {
      chosenCompPlayer.status = "1GUN";
      formerTeam.roster1G.push(chosenCompPlayer);
    } else if (formerTeam.roster2G.length < 30) {
      chosenCompPlayer.status = "2GUN";
      formerTeam.roster2G.push(chosenCompPlayer);
    } else {
      chosenCompPlayer.status = "YUKSEONG";
      formerTeam.rosterDev.push(chosenCompPlayer);
    }

    const cashComp = Math.round(prevSalary * gradeRule.cashMultiplierWithComp);
    signingTeam.budget = clamp((signingTeam.budget || 1200000) - cashComp, 1000000, 2500000);
    formerTeam.budget = clamp((formerTeam.budget || 1200000) + cashComp, 1000000, 2500000);

    return {
      faGrade: profile.faGrade,
      protectedLimit: protectedCount,
      fromTeamId: signingTeam.id,
      fromTeamName: signingTeam.name,
      toTeamId: formerTeam.id,
      toTeamName: formerTeam.name,
      cashCompensation: cashComp,
      compensatedPlayer: {
        playerId: chosenCompPlayer.id,
        name: chosenCompPlayer.name,
        pos: chosenCompPlayer.pos,
        age: chosenCompPlayer.age,
        trueOvr: chosenCompPlayer.getTrueOvr(),
        potential: chosenCompPlayer.potential
      },
      summary: `${profile.faGrade}등급 ${protectedCount}인 외 보상선수 [${chosenCompPlayer.name}(${chosenCompPlayer.pos}, ${chosenCompPlayer.age}세)] 지명 + 보상금 ${(cashComp / 10000).toFixed(2)}억원`
    };
  }

  /**
   * KBO FA 시장 개장 및 비공개 경쟁 입찰 시뮬레이션
   * @param {GMGameContext} context
   * @param {Object} userBids
   *   - { [playerId]: { years: 4, annualSalary: 80000, signingBonus: 100000 } } 또는 { [playerId]: { years: 4, totalAmount: 420000 } }
   * @param {Object} options
   *   - autoDeclareFromRosters: true (기본값, 자격 충족 선수 자동 FA 공시)
   *   - userProtectedIds: Array<string> (유저 구단 A/B급 외부 FA 영입 시 20인 보호명단)
   */
  function runFAMarketSession(context, userBids = {}, options = {}) {
    if (!context || !Array.isArray(context.kboTeams)) {
      throw new Error("유효한 GMGameContext 인스턴스가 필요합니다.");
    }
    const rng = options.rng || Math.random;

    if (options.autoDeclareFromRosters !== false) {
      declareEligibleFAPlayers(context);
    }

    const analyzeNeedsFn =
      (KBO_GM && KBO_GM.Draft && KBO_GM.Draft.analyzeTeamNeeds) ||
      function () {
        return {};
      };

    // 구단별 포지션 필요도 캐싱
    const teamNeedsMap = {};
    context.kboTeams.forEach((t) => {
      teamNeedsMap[t.id] = analyzeNeedsFn(t);
    });

    const signedContracts = [];
    const unsignedFAs = [];
    const compensationLogs = [];

    // FA 시장의 모든 선수를 대상으로 비공개 경쟁 입찰 진행
    const poolSnapshot = context.faPool.slice();
    context.faPool = [];

    poolSnapshot.forEach((faPlayer) => {
      const profile = faPlayer.faProfile || evaluateFAPlayerMarketProfile(faPlayer);
      faPlayer.faProfile = profile;

      const bids = [];

      // 1) 플레이어(유저) 구단 입찰 확인 (KBO_GM.FA.evaluateOfferAcceptance 로지스틱 효용 평가 연동)
      const uBid = userBids && userBids[faPlayer.id];
      if (uBid) {
        const userTeam = context.getUserTeam();
        const years = clamp(uBid.years || uBid.Y || profile.demandYears || 4, 1, 6);
        const isHomeTeam = faPlayer.formerTeamId === userTeam.id;
        const hasNegotiator =
          (context.gmProfile && context.gmProfile.trait === "NEGOTIATOR") || (context.negotiationDiscount || 0) > 0;

        let signingBonus = 0;
        let baseSalaryTotal = 0;
        let incentives = 0;
        let totalAmount = 0;

        if (uBid.DP != null || uBid.downPaymentManwon != null) {
          signingBonus = Math.max(0, round100(Number(uBid.DP != null ? uBid.DP : uBid.downPaymentManwon)));
          baseSalaryTotal = Math.max(
            MIN_SALARY * years,
            round100(Number(uBid.BS != null ? uBid.BS : uBid.baseSalaryTotalManwon || profile.demandBaseSalaryTotal))
          );
          incentives = Math.max(0, round100(Number(uBid.Opt != null ? uBid.Opt : uBid.incentivesManwon || 0)));
          totalAmount = signingBonus + baseSalaryTotal + incentives;
        } else {
          totalAmount =
            uBid.totalAmount != null
              ? Number(uBid.totalAmount)
              : (Number(uBid.signingBonus) || 0) + (Number(uBid.annualSalary) || profile.demandAnnual) * years;
          const split = breakdownContract(totalAmount, profile.faGrade, years);
          signingBonus = uBid.signingBonus != null ? Number(uBid.signingBonus) : split.DP;
          baseSalaryTotal = split.BS;
          incentives = split.Opt;
        }

        const annualSalary = Math.max(MIN_SALARY, round100(baseSalaryTotal / years));
        const evalAccept = evaluateOfferAcceptance(
          faPlayer,
          { Y: years, DP: signingBonus, BS: baseSalaryTotal, Opt: incentives },
          profile.breakdown,
          { isHomeTeam, hasNegotiatorTrait: hasNegotiator, rng, context }
        );

        const effectiveValue = evalAccept.U_offer;

        if (evalAccept.accepted || evalAccept.ratio >= 0.85) {
          bids.push({
            teamId: userTeam.id,
            teamName: userTeam.name,
            isUserBid: true,
            years,
            annualSalary,
            signingBonus,
            baseSalaryTotal,
            incentives,
            totalAmount,
            effectiveValue,
            logisticEval: evalAccept
          });
        }
      }

      // 2) AI 9개 구단(유저 무입찰 시 유저 구단 원소속 잔류 입찰 포함 가능) 경쟁 입찰 생성
      context.kboTeams.forEach((team) => {
        if (team.id === context.userTeamId && uBid) return;
        if (team.id === context.userTeamId && !options.allowAutoUserRetention) return;

        const isFormerTeam = team.id === faPlayer.formerTeamId;
        const posNeed = (teamNeedsMap[team.id] && teamNeedsMap[team.id][faPlayer.pos]) || 0;

        // A등급 외부 영입은 20인 외 보상선수 + 연봉 200~300% 리스크가 크므로 포지션 구멍이 크고 예산이 넉넉할 때만 입찰
        const compRiskThreshold = profile.faGrade === "A" ? 5.5 : profile.faGrade === "B" ? 3.0 : 1.5;
        const compMultiplier = profile.faGrade === "A" ? 2.0 : profile.faGrade === "B" ? 1.0 : 1.5;
        const expectedCompCash = Math.round((profile.prevSalary || 10000) * compMultiplier);
        const minBudgetRequired =
          profile.demandTotal * 0.45 + 300000 + (isFormerTeam ? 0 : expectedCompCash);

        if (team.budget < minBudgetRequired) return;

        let bidInterestProb = isFormerTeam ? 0.72 : 0.18 + posNeed * 0.045;
        if (!isFormerTeam && posNeed < compRiskThreshold && profile.faGrade === "A") {
          bidInterestProb *= 0.25;
        }
        // [FA_PREEMPTIVE_BUMP 연동] 원소속구단이 예비 FA 연봉을 150~200% 전략적 인상한 경우 타 구단 AI가 보상금(200~300%) 폭탄에 부담을 느껴 입찰 확률 대폭 축소
        if (!isFormerTeam && (faPlayer.preemptiveBumpApplied || expectedCompCash >= 70000)) {
          const bumpFactor = Number(faPlayer.preemptiveBumpFactor) || 1.75;
          const deterrenceMul = clamp(1 / (bumpFactor * 2.2), 0.10, 0.35);
          bidInterestProb *= deterrenceMul;
        }

        if (rng() < bidInterestProb) {
          const years = profile.demandYears;
          const aggression = 0.88 + rng() * 0.22 + (posNeed >= 6 ? 0.06 : 0);
          const totalAmount = Math.max(MIN_SALARY * years, round100(profile.demandTotal * aggression));
          const aiSplit = breakdownContract(totalAmount, profile.faGrade, years, {
            competitionLevel: clamp(posNeed / 8, 0.2, 0.9)
          });
          const signingBonus = aiSplit.DP;
          const baseSalaryTotal = aiSplit.BS;
          const incentives = aiSplit.Opt;
          const annualSalary = aiSplit.annualBaseSalaryManwon;
          const aiEval = evaluateOfferAcceptance(
            faPlayer,
            { Y: years, DP: signingBonus, BS: baseSalaryTotal, Opt: incentives },
            profile.breakdown,
            { isHomeTeam: isFormerTeam, rng, context }
          );
          const effectiveValue = aiEval.U_offer;

          bids.push({
            teamId: team.id,
            teamName: team.name,
            isUserBid: false,
            years,
            annualSalary,
            signingBonus,
            baseSalaryTotal,
            incentives,
            totalAmount,
            effectiveValue,
            logisticEval: aiEval
          });
        }
      });

      // 최고 입찰 구단 선정 (단, 선수 최소 기대치의 82% 이상이어야 계약 성사)
      bids.sort((a, b) => b.effectiveValue - a.effectiveValue);
      const winningBid = bids[0];

      if (winningBid && winningBid.totalAmount >= profile.demandTotal * 0.82) {
        const winTeam = context.getTeam(winningBid.teamId);
        const formerTeam = context.getTeam(faPlayer.formerTeamId);

        // 계약금 + 첫해 연봉 구단 예산 반영 (100억~250억 원 밸런스 범위 유지)
        winTeam.budget = clamp((winTeam.budget || 1200000) - winningBid.signingBonus, 1000000, 2500000);

        faPlayer.teamId = winTeam.id;
        faPlayer.salary = winningBid.annualSalary;
        faPlayer.contractYears = winningBid.years;
        faPlayer.faYears = 0; // FA 계약 체결 시 FA 연차 리셋(4년 뒤 재취득 자격)

        if (winTeam.roster1G.length < 28) {
          faPlayer.status = "1GUN";
          winTeam.roster1G.push(faPlayer);
        } else {
          // 1군(28명) 정원 초과 시 1군 최하위 백업을 2군으로 내리고 FA 영입 선수를 1군 등록 (2군도 30명 초과 시 육성군 이동)
          const demote1G = winTeam.roster1G
            .filter((p) => p.nationality === "KOR")
            .sort((a, b) => a.getTrueOvr() - b.getTrueOvr())[0];
          if (demote1G) {
            winTeam.roster1G = winTeam.roster1G.filter((p) => p.id !== demote1G.id);
            if (winTeam.roster2G.length >= 30) {
              const demote2G = winTeam.roster2G
                .filter((p) => p.nationality === "KOR")
                .sort((a, b) => a.getTrueOvr() - b.getTrueOvr())[0];
              if (demote2G) {
                winTeam.roster2G = winTeam.roster2G.filter((p) => p.id !== demote2G.id);
                demote2G.status = "YUKSEONG";
                winTeam.rosterDev.push(demote2G);
              }
            }
            demote1G.status = "2GUN";
            winTeam.roster2G.push(demote1G);
            faPlayer.status = "1GUN";
            winTeam.roster1G.push(faPlayer);
          } else if (winTeam.roster2G.length < 30) {
            faPlayer.status = "2GUN";
            winTeam.roster2G.push(faPlayer);
          } else {
            faPlayer.status = "YUKSEONG";
            winTeam.rosterDev.push(faPlayer);
          }
        }

        if (typeof faPlayer.updateScoutingReport === "function") {
          faPlayer.updateScoutingReport(context.scoutLevel || 1, winTeam.id === context.userTeamId);
        }

        // 타구단 이적 시 A/B/C 등급별 보상선수 지명 및 보상금 집행
        let compResult = null;
        if (formerTeam && formerTeam.id !== winTeam.id) {
          compResult = executeFACompensation(context, winTeam, formerTeam, faPlayer, options);
          if (compResult) {
            compensationLogs.push(compResult);
          }
        }

        // 대형 FA 영입 시 팬 민심 상승
        if (profile.faGrade === "A") {
          winTeam.fanRatio = clamp(winTeam.fanRatio + 6, 0, 100);
        } else if (profile.faGrade === "B") {
          winTeam.fanRatio = clamp(winTeam.fanRatio + 3, 0, 100);
        }

        signedContracts.push({
          playerId: faPlayer.id,
          playerName: faPlayer.name,
          pos: faPlayer.pos,
          age: faPlayer.age,
          faGrade: profile.faGrade,
          formerTeamId: faPlayer.formerTeamId,
          newTeamId: winTeam.id,
          newTeamName: winTeam.name,
          isRetention: faPlayer.formerTeamId === winTeam.id,
          years: winningBid.years,
          annualSalary: winningBid.annualSalary,
          signingBonus: winningBid.signingBonus,
          totalAmount: winningBid.totalAmount,
          competingBidsCount: bids.length,
          compensation: compResult
        });
      } else {
        // 미계약(FA 미아) -> 원소속구단 단년 삭감 계약 또는 FA 풀 잔류
        const fallbackTeam = context.getTeam(faPlayer.formerTeamId);
        if (fallbackTeam && options.autoSignLeftoverFAs !== false) {
          faPlayer.teamId = fallbackTeam.id;
          faPlayer.salary = Math.max(MIN_SALARY, round100(profile.prevSalary * 0.75));
          faPlayer.contractYears = 1;
          faPlayer.faYears = 0;
          if (fallbackTeam.roster1G.length < 28) {
            faPlayer.status = "1GUN";
            fallbackTeam.roster1G.push(faPlayer);
          } else if (fallbackTeam.roster2G.length < 30) {
            faPlayer.status = "2GUN";
            fallbackTeam.roster2G.push(faPlayer);
          } else {
            faPlayer.status = "YUKSEONG";
            fallbackTeam.rosterDev.push(faPlayer);
          }

          signedContracts.push({
            playerId: faPlayer.id,
            playerName: faPlayer.name,
            pos: faPlayer.pos,
            age: faPlayer.age,
            faGrade: profile.faGrade,
            formerTeamId: faPlayer.formerTeamId,
            newTeamId: fallbackTeam.id,
            newTeamName: fallbackTeam.name,
            isRetention: true,
            years: 1,
            annualSalary: faPlayer.salary,
            signingBonus: 0,
            totalAmount: faPlayer.salary,
            competingBidsCount: bids.length,
            compensation: null,
            note: "시장 미계약 후 원소속구단 단년 잔류"
          });
        } else {
          context.faPool.push(faPlayer);
          unsignedFAs.push({
            playerId: faPlayer.id,
            name: faPlayer.name,
            pos: faPlayer.pos,
            faGrade: profile.faGrade,
            demandTotal: profile.demandTotal
          });
        }
      }
    });

    return {
      year: context.currentYear,
      totalSigned: signedContracts.length,
      signedContracts,
      compensationLogs,
      unsignedFAs,
      userTeamSignings: signedContracts.filter((c) => c.newTeamId === context.userTeamId),
      userTeamCompensations: compensationLogs.filter(
        (c) => c.fromTeamId === context.userTeamId || c.toTeamId === context.userTeamId
      )
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 3. [요청 3] 외국인 선수 3명(투2/타1) 재계약 & NPB/해외 풀 영입 (processForeignPlayerContracts)
   * ═══════════════════════════════════════════════════════════════════════ */

  /**
   * NPB/해외 스카우트 풀(`context.npbPool`)에서 구단 조건에 맞는 추천 외국인 후보 리스트 반환
   * @param {GMGameContext} context
   * @param {'pitcher'|'batter'|null} roleFilter
   * @param {number} count
   */
  function getRecommendedForeignCandidates(context, roleFilter = null, count = 8) {
    if (!context || !Array.isArray(context.npbPool)) return [];

    const pool = roleFilter
      ? context.npbPool.filter((p) => p.type === roleFilter && !p.isAsianQuarter)
      : context.npbPool.filter((p) => !p.isAsianQuarter);

    const scored = pool.map((p) => {
      const se = p.scoutError || { ovrMin: 68, ovrMax: 80 };
      const perceivedMid = ((se.ovrMin || 68) + (se.ovrMax || 80)) / 2;
      const war = typeof p.getWar === "function" ? p.getWar() : 0;
      const agePenalty = Math.max(0, (p.age || 28) - 31) * 1.5;
      const scoutScore = +(perceivedMid * 0.75 + war * 4.5 - agePenalty).toFixed(2);

      return {
        playerId: p.id,
        name: p.name,
        nationality: p.nationality,
        origin: p.origin,
        pos: p.pos,
        type: p.type,
        age: p.age,
        ovrRange: `${se.ovrMin}~${se.ovrMax}`,
        expectedSalary: p.salary || 55000,
        metrics: p.metrics || null,
        scoutScore
      };
    });

    scored.sort((a, b) => b.scoutScore - a.scoutScore);
    return scored.slice(0, count);
  }

  const UPPER_LEAGUE_SUITORS = [
    { league: "MLB", club: "샌디에이고 파드리스" },
    { league: "MLB", club: "세인트루이스 카디널스" },
    { league: "MLB", club: "밀워키 브루어스" },
    { league: "MLB", club: "애리조나 다이아몬드백스" },
    { league: "NPB", club: "요미우리 자이언츠" },
    { league: "NPB", club: "소프트뱅크 호크스" },
    { league: "NPB", club: "한신 타이거스" }
  ];

  /**
   * 보유 외국인 선수의 MLB/NPB 등 상위리그 오퍼 유무 및 재계약 협상 요구액 산출
   * - 단일 선수(fp, context) 호출과 구단 전체(context, teamId) 호출 모두 지원
   */
  function evaluateForeignPlayerRenewalMarket(fpOrContext, contextOrTeamId = null) {
    if (!fpOrContext) return null;

    // 구단 전체 컨텍스트 호출인 경우: evaluateForeignPlayerRenewalMarket(ctx, teamId)
    if (Array.isArray(fpOrContext.kboTeams) || typeof fpOrContext.getUserTeam === "function") {
      const ctx = fpOrContext;
      const tid = typeof contextOrTeamId === "string" ? contextOrTeamId : ctx.userTeamId;
      const team = ctx.getTeam ? ctx.getTeam(tid) : ctx.getUserTeam();
      if (!team) return { ok: false, profiles: [] };
      const foreigns = team.getAllPlayers().filter((p) => p.nationality !== "KOR" && !p.isAsianQuarter);
      const profiles = foreigns.map((fp) => {
        const prof = evaluateForeignPlayerRenewalMarket(fp, ctx);
        fp.renewalMarketProfile = prof;
        return prof;
      });
      return { ok: true, teamId: team.id, profiles };
    }

    const fp = fpOrContext;
    const context = contextOrTeamId && typeof contextOrTeamId === "object" ? contextOrTeamId : null;
    const ovr = typeof fp.getTrueOvr === "function" ? fp.getTrueOvr() : 75;
    const war = typeof fp.getWar === "function" ? fp.getWar() : 0;
    const curSal = fp.salary || 60000;
    const discount =
      context && context.gmProfile && context.gmProfile.trait === "NEGOTIATOR" ? 0.95 : 1.0;

    // OVR 79 이상이거나 WAR 2.5 이상이면 MLB/NPB 상위리그 오퍼 발생 (또는 이름 해시로 최소 1명 이상 오퍼 발생 보장)
    const hashSeed = String(fp.id || fp.name || "A")
      .split("")
      .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const hasUpperLeagueOffer = ovr >= 79 || war >= 2.5 || hashSeed % 2 === 0;
    const suitor = UPPER_LEAGUE_SUITORS[hashSeed % UPPER_LEAGUE_SUITORS.length];

    const baseRaise = clamp(1.08 + Math.max(0, war - 1.5) * 0.06 + Math.max(0, ovr - 76) * 0.025, 1.05, 1.45);
    const competingMul = hasUpperLeagueOffer ? clamp(baseRaise + 0.18, 1.25, 1.55) : baseRaise;
    const competingOfferSalary = round100(curSal * competingMul);
    const minAcceptSalary = round100(
      (hasUpperLeagueOffer ? competingOfferSalary * 0.94 : curSal * baseRaise * 0.96) * discount
    );
    const recommendedOfferSalary = round100(Math.max(minAcceptSalary, competingOfferSalary));

    const prof = {
      playerId: fp.id,
      name: fp.name,
      hasUpperLeagueOffer,
      suitorLeague: hasUpperLeagueOffer ? suitor.league : null,
      suitorClub: hasUpperLeagueOffer ? suitor.club : null,
      currentSalary: curSal,
      competingOfferSalary,
      competingOfferManwon: competingOfferSalary,
      minAcceptSalary,
      recommendedOfferSalary,
      negotiationStatus:
        fp.renewalNegotiationStatus === "COUNTERED"
          ? "REJECTED_WARNING"
          : fp.renewalNegotiationStatus || "PENDING",
      agreedSalary: fp.agreedRenewalSalary || null,
      offerNote: hasUpperLeagueOffer
        ? `🚨 [${suitor.league} '${suitor.club}' 영입 오퍼 수신!] 경쟁 제시액 ${(competingOfferSalary / 10000).toFixed(2)}억 원 (KBO 잔류 최소 요구액: ${(minAcceptSalary / 10000).toFixed(2)}억 원)`
        : `상위리그 오퍼 없음 · 적정 재계약 요구액 ${(minAcceptSalary / 10000).toFixed(2)}억 원`
    };
    fp.renewalMarketProfile = prof;
    return prof;
  }

  /**
   * 개별 외국인 선수 1:1 재계약 연봉 협상 실행
   * - (context, playerId, offeredSalary) 또는 (context, teamId, playerId, offeredSalary) 모두 지원
   */
  function negotiateSingleForeignPlayer(context, arg2, arg3, arg4) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    let teamId = context.userTeamId;
    let playerId = arg2;
    let offeredSalaryManwon = arg3;
    if (arg4 !== undefined) {
      teamId = arg2 || context.userTeamId;
      playerId = arg3;
      offeredSalaryManwon = arg4;
    }

    const userTeam = (context.getTeam && context.getTeam(teamId)) || context.getUserTeam();
    if (!userTeam) return { ok: false, reason: "구단을 찾을 수 없습니다." };
    const fp = userTeam.getAllPlayers().find((p) => p.id === playerId && p.nationality !== "KOR");
    if (!fp) return { ok: false, reason: "해당 외국인 선수를 찾을 수 없습니다." };

    const mkt = evaluateForeignPlayerRenewalMarket(fp, context);
    const offer = round100(Math.max(30000, Number(offeredSalaryManwon) || mkt.recommendedOfferSalary));

    if (offer >= mkt.minAcceptSalary) {
      fp.renewalNegotiationStatus = "AGREED";
      fp.agreedRenewalSalary = offer;
      const updatedMkt = evaluateForeignPlayerRenewalMarket(fp, context);
      return {
        ok: true,
        accepted: true,
        offeredSalary: offer,
        minAcceptSalary: mkt.minAcceptSalary,
        market: updatedMkt,
        message: mkt.hasUpperLeagueOffer
          ? `[외국인 재계약 합의!] ${fp.name} 선수가 ${mkt.suitorLeague} '${mkt.suitorClub}' 오퍼를 거절하고 연봉 ${(offer / 10000).toFixed(2)}억 원에 우리 구단 잔류를 수락했습니다!`
          : `[외국인 재계약 합의!] ${fp.name} 선수와 연봉 ${(offer / 10000).toFixed(2)}억 원에 재계약 조건 합의를 마쳤습니다!`
      };
    } else {
      fp.renewalNegotiationStatus = "COUNTERED";
      const updatedMkt = evaluateForeignPlayerRenewalMarket(fp, context);
      return {
        ok: true,
        accepted: false,
        offeredSalary: offer,
        requiredSalary: mkt.minAcceptSalary,
        minAcceptSalary: mkt.minAcceptSalary,
        market: updatedMkt,
        message: mkt.hasUpperLeagueOffer
          ? `[협상 결렬 경고] ${fp.name} 에이전트: "${mkt.suitorLeague} ${mkt.suitorClub}에서 ${(mkt.competingOfferSalary / 10000).toFixed(2)}억 원을 제시받았습니다. 최소 ${(mkt.minAcceptSalary / 10000).toFixed(2)}억 원 이상 맞춰주지 않으면 상위리그로 떠나겠습니다!"`
          : `[협상 난항] ${fp.name} 에이전트: "제시액(${(offer / 10000).toFixed(2)}억)이 기대치보다 낮습니다. 최소 ${(mkt.minAcceptSalary / 10000).toFixed(2)}억 원은 맞춰주십시오."`
      };
    }
  }

  /**
   * 10개 구단 외국인 선수(최대 3인: 투수 2 + 야수 1) 재계약/방출 및 NPB/해외 풀 신규 영입 일괄 처리
   * @param {GMGameContext} context
   * @param {Object|null} userForeignAction
   *   - keepIds: Array<string> (유저 구단 재계약 유지할 기존 외국인 ID 배열)
   *   - releaseIds: Array<string> (유저 구단 방출할 기존 외국인 ID 배열)
   *   - signIds: Array<string> (context.npbPool에서 영입할 신규 외국인 ID 배열)
   *   - 생략(null) 시 유저 구단도 성적/스카우트 기준 최적 자동 처리
   * @param {Object} options
   */
  function processForeignPlayerContracts(context, userForeignAction = null, options = {}) {
    if (!context || !Array.isArray(context.kboTeams)) {
      throw new Error("유효한 GMGameContext 인스턴스가 필요합니다.");
    }
    const rng = options.rng || Math.random;

    const teamForeignReports = {};

    context.kboTeams.forEach((team) => {
      const isUserTeam = team.id === context.userTeamId;
      const allPlayers = team.getAllPlayers();
      const currentForeigners = allPlayers.filter((p) => p.nationality && p.nationality !== "KOR" && !p.isAsianQuarter);

      const reSigned = [];
      const released = [];
      const newlySigned = [];
      const departedUpperLeague = [];

      // 1) 기존 외국인 선수 재계약 vs 방출 (상위리그 MLB/NPB 오퍼 경합 반영)
      currentForeigners.forEach((fp) => {
        const war = typeof fp.getWar === "function" ? fp.getWar() : 0;
        const ovr = fp.getTrueOvr();
        const gPlayed = (fp.rec && fp.rec.g) || 0;
        const mkt = evaluateForeignPlayerRenewalMarket(fp, context);

        let shouldKeep = false;
        if (isUserTeam && userForeignAction) {
          if (Array.isArray(userForeignAction.releaseIds) && userForeignAction.releaseIds.includes(fp.id)) {
            shouldKeep = false;
          } else if (Array.isArray(userForeignAction.keepIds) && userForeignAction.keepIds.includes(fp.id)) {
            shouldKeep = true;
          } else if (Array.isArray(userForeignAction.keepIds)) {
            // keepIds 배열이 명시적으로 전달되었고 그 안에 없으면 제외 처리
            shouldKeep = false;
          } else {
            shouldKeep = gPlayed > 0 ? war >= 2.2 && fp.age <= 34 : ovr >= 80 && fp.age <= 34;
          }
        } else {
          // 시즌 성적이 있으면 WAR 2.2 이상(또는 투수 ERA 3.60 이하, 타자 OPS 0.850 이상), 시즌 전이면 OVR 80 이상일 때 재계약
          shouldKeep = gPlayed >= 10 ? war >= 2.2 && fp.age <= 34 : ovr >= 80 && fp.age <= 34;
        }

        // 유저 구단에서 재계약 유지를 선택했으나 상위리그(MLB/NPB) 오퍼 대비 제시액이 현저히 부족한 경우 상위리그 이적 발생
        const userOfferedSal =
          isUserTeam && userForeignAction && userForeignAction.salaryOffers && userForeignAction.salaryOffers[fp.id]
            ? round100(Number(userForeignAction.salaryOffers[fp.id]))
            : fp.agreedRenewalSalary || (mkt ? mkt.recommendedOfferSalary : round100((fp.salary || 60000) * 1.15));

        if (
          shouldKeep &&
          isUserTeam &&
          userForeignAction &&
          userForeignAction.salaryOffers &&
          userForeignAction.salaryOffers[fp.id] != null &&
          mkt &&
          mkt.hasUpperLeagueOffer &&
          userOfferedSal < mkt.minAcceptSalary &&
          fp.renewalNegotiationStatus !== "AGREED"
        ) {
          // 상위리그 오퍼를 택해 KBO를 떠남
          team.roster1G = team.roster1G.filter((p) => p.id !== fp.id);
          team.roster2G = team.roster2G.filter((p) => p.id !== fp.id);
          team.rosterDev = team.rosterDev.filter((p) => p.id !== fp.id);
          fp.teamId = null;
          fp.status = "FOREIGN_RELEASED";
          const depRec = {
            playerId: fp.id,
            name: fp.name,
            pos: fp.pos,
            suitorLeague: mkt.suitorLeague,
            suitorClub: mkt.suitorClub,
            offeredByUser: userOfferedSal,
            competingOffer: mkt.competingOfferSalary
          };
          departedUpperLeague.push(depRec);
          released.push({
            playerId: fp.id,
            name: fp.name,
            nationality: fp.nationality,
            pos: fp.pos,
            type: fp.type,
            age: fp.age,
            war,
            prevSalary: fp.salary,
            status: "FOREIGN_RELEASED",
            note: `${mkt.suitorLeague} ${mkt.suitorClub} 역수출 이적`
          });
          if (!Array.isArray(context.releasedForeignArchives)) {
            context.releasedForeignArchives = [];
          }
          context.releasedForeignArchives.push({
            playerId: fp.id,
            name: fp.name,
            status: "FOREIGN_RELEASED"
          });
          return;
        }

        if (shouldKeep) {
          const oldSal = fp.salary || 60000;
          const raiseRate = clamp(1.08 + Math.max(0, war - 2.0) * 0.06, 1.05, 1.35);
          fp.salary = isUserTeam && userOfferedSal ? userOfferedSal : round100(oldSal * raiseRate);
          fp.contractYears = 1;
          fp.renewalNegotiationStatus = "AGREED";
          team.budget = clamp((team.budget || 1200000) - Math.round(fp.salary * 0.15), 1000000, 2500000); // 재계약 인센티브/계약금 차감

          reSigned.push({
            playerId: fp.id,
            name: fp.name,
            nationality: fp.nationality,
            pos: fp.pos,
            type: fp.type,
            age: fp.age,
            war,
            oldSalary: oldSal,
            newSalary: fp.salary,
            beatUpperLeague: mkt && mkt.hasUpperLeagueOffer ? `${mkt.suitorLeague} ${mkt.suitorClub} 오퍼 방어 성공` : null
          });
        } else {
          // [규정 6] 웨이버 공시 / 재계약 포기 방출 시 즉시 FOREIGN_RELEASED 처리 및 시장에서 영구 퇴출
          team.roster1G = team.roster1G.filter((p) => p.id !== fp.id);
          team.roster2G = team.roster2G.filter((p) => p.id !== fp.id);
          team.rosterDev = team.rosterDev.filter((p) => p.id !== fp.id);
          fp.teamId = null;
          fp.status = "FOREIGN_RELEASED";

          const releaseRecord = {
            playerId: fp.id,
            name: fp.name,
            nationality: fp.nationality,
            pos: fp.pos,
            type: fp.type,
            age: fp.age,
            war,
            prevSalary: fp.salary,
            status: "FOREIGN_RELEASED",
            releasedDate: context.currentDate || `${context.currentYear}-01-01`
          };
          released.push(releaseRecord);
          if (!Array.isArray(context.releasedForeignArchives)) {
            context.releasedForeignArchives = [];
          }
          context.releasedForeignArchives.push(releaseRecord);
        }
      });

      // 2) 빈 외국인 슬롯 확인 (표준 쿼터: 투수 2명 + 타자 1명 = 총 3명)
      let currentPitcherCount = reSigned.filter((x) => x.type === "pitcher").length;
      let currentBatterCount = reSigned.filter((x) => x.type === "batter").length;

      const signFromNPBPool = (candidate) => {
        if (!candidate) return null;
        const poolIdx = context.npbPool.findIndex((p) => p.id === candidate.id);
        if (poolIdx !== -1) {
          context.npbPool.splice(poolIdx, 1);
        }

        const contractSalary = round100(candidate.salary || 55000);
        const buyoutFee = round100(contractSalary * 0.25); // 이적료/바이아웃 + 계약금
        team.budget = clamp((team.budget || 1200000) - buyoutFee, 1000000, 2500000);

        candidate.teamId = team.id;
        candidate.salary = contractSalary;
        candidate.contractYears = 1;
        candidate.faYears = 0;

        // 1군 정원(28명) 초과 시 1군 최하위 국내 백업 선수를 2군으로 내리고 외국인 선수를 1군 등록 (2군도 30명 초과 시 육성군 이동)
        if (team.roster1G.length >= 28) {
          const demoteCand = team.roster1G
            .filter((p) => p.nationality === "KOR" && p.type === candidate.type)
            .sort((a, b) => a.getTrueOvr() - b.getTrueOvr())[0] ||
            team.roster1G.filter((p) => p.nationality === "KOR").sort((a, b) => a.getTrueOvr() - b.getTrueOvr())[0];
          if (demoteCand) {
            team.roster1G = team.roster1G.filter((p) => p.id !== demoteCand.id);
            if (team.roster2G.length >= 30) {
              const demote2G = team.roster2G
                .filter((p) => p.nationality === "KOR")
                .sort((a, b) => a.getTrueOvr() - b.getTrueOvr())[0];
              if (demote2G) {
                team.roster2G = team.roster2G.filter((p) => p.id !== demote2G.id);
                demote2G.status = "YUKSEONG";
                team.rosterDev.push(demote2G);
              }
            }
            demoteCand.status = "2GUN";
            team.roster2G.push(demoteCand);
          }
        }
        candidate.status = "1GUN";
        team.roster1G.push(candidate);

        if (typeof candidate.updateScoutingReport === "function") {
          candidate.updateScoutingReport(context.scoutLevel || 1, isUserTeam);
        }

        const record = {
          playerId: candidate.id,
          name: candidate.name,
          nationality: candidate.nationality,
          origin: candidate.origin,
          pos: candidate.pos,
          type: candidate.type,
          age: candidate.age,
          salary: candidate.salary,
          buyoutFee,
          ovrRange: `${candidate.scoutError.ovrMin}~${candidate.scoutError.ovrMax}`,
          trueOvr: isUserTeam ? candidate.getTrueOvr() : undefined
        };
        newlySigned.push(record);
        return record;
      };

      // 유저가 직접 지정한 영입 대상(userForeignAction.signIds) 먼저 처리
      if (isUserTeam && userForeignAction && Array.isArray(userForeignAction.signIds)) {
        userForeignAction.signIds.forEach((targetId) => {
          if (currentPitcherCount + currentBatterCount >= 3) return;
          const cand = context.npbPool.find((p) => p.id === targetId && !p.isAsianQuarter);
          if (!cand) return;
          if (cand.type === "pitcher" && currentPitcherCount < 2) {
            signFromNPBPool(cand);
            currentPitcherCount += 1;
          } else if (cand.type === "batter" && currentBatterCount < 1) {
            signFromNPBPool(cand);
            currentBatterCount += 1;
          }
        });
      }

      // 부족한 외국인 투수 슬롯(최대 2명)을 NPB/해외 풀에서 스카우팅 점수로 영입
      while (currentPitcherCount < 2) {
        const pitcherPool = context.npbPool.filter((p) => p.type === "pitcher" && !p.isAsianQuarter);
        if (!pitcherPool.length) break;

        pitcherPool.sort((a, b) => {
          const midA = ((a.scoutError.ovrMin || 65) + (a.scoutError.ovrMax || 75)) / 2 + (a.pos === "SP" ? 5 : 0);
          const midB = ((b.scoutError.ovrMin || 65) + (b.scoutError.ovrMax || 75)) / 2 + (b.pos === "SP" ? 5 : 0);
          const noise = isUserTeam ? 0 : (rng() * 4 - 2);
          return midB + noise - midA;
        });

        const chosen = pitcherPool[0];
        if (chosen.pos !== "SP") chosen.pos = "SP"; // 외국인 투수는 선발 보직 기본 부여
        signFromNPBPool(chosen);
        currentPitcherCount += 1;
      }

      // 부족한 외국인 타자 슬롯(최대 1명)을 NPB/해외 풀에서 영입
      while (currentBatterCount < 1) {
        const batterPool = context.npbPool.filter((p) => p.type === "batter" && !p.isAsianQuarter);
        if (!batterPool.length) break;

        batterPool.sort((a, b) => {
          const midA = ((a.scoutError.ovrMin || 65) + (a.scoutError.ovrMax || 75)) / 2 + ((a.st && (a.st.pow || a.st.power)) || 70) * 0.2;
          const midB = ((b.scoutError.ovrMin || 65) + (b.scoutError.ovrMax || 75)) / 2 + ((b.st && (b.st.pow || b.st.power)) || 70) * 0.2;
          const noise = isUserTeam ? 0 : (rng() * 4 - 2);
          return midB + noise - midA;
        });

        signFromNPBPool(batterPool[0]);
        currentBatterCount += 1;
      }

      teamForeignReports[team.id] = {
        teamId: team.id,
        teamName: team.name,
        reSigned,
        released,
        departedUpperLeague,
        newlySigned,
        activeForeignCount: currentPitcherCount + currentBatterCount
      };
    });

    return {
      year: context.currentYear,
      teamForeignReports,
      userTeamReport: teamForeignReports[context.userTeamId] || null,
      remainingNPBPoolCount: context.npbPool.length
    };
  }

  FA_MODULE.getFAMarketPhaseStatus = getFAMarketPhaseStatus;
  FA_MODULE.advanceToOpenFAMarket = advanceToOpenFAMarket;
  FA_MODULE.filterAndGroupFAPlayers = filterAndGroupFAPlayers;
  FA_MODULE.negotiateFAPlayerDirect = negotiateFAPlayerDirect;

  if (KBO_GM) {
    KBO_GM.FA = Object.assign(KBO_GM.FA || {}, FA_MODULE);
  }

  return {
    MIN_SALARY,
    FA_GRADE_RULES,
    FA: FA_MODULE,
    determineGrade,
    calculateCompensationPenalty,
    calculateTargetValuation,
    breakdownContract,
    evaluateOfferAcceptance,
    getFAMarketPhaseStatus,
    advanceToOpenFAMarket,
    filterAndGroupFAPlayers,
    negotiateFAPlayerDirect,
    calculateFairSalary,
    processSalaryRenewals,
    evaluateFAPlayerMarketProfile,
    declareEligibleFAPlayers,
    executeFACompensation,
    runFAMarketSession,
    getRecommendedForeignCandidates,
    evaluateForeignPlayerRenewalMarket,
    negotiateSingleForeignPlayer,
    processForeignPlayerContracts
  };
});
