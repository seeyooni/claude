/**
 * KBO 단장 모드 (v1.0) — Step 3-3: 전지훈련(스프링캠프), 코치진 인선, 구단주 목표 설정 및 새 시즌 개막 모듈 (KBO_GM.SpringCamp)
 * 의존 모듈:
 *   - Step 1-1: /public/gm-schema.js (Player, Team, GMGameContext, KBO_TEAM_META, createEmptySeasonRecord, generatePlayer)
 *   - Phase 2:  /public/gm-weekly-sim.js (updatePlayerMetrics, calculateKBOStandings)
 * 실행 환경: Client-Side Standalone (window.KBO_GM.SpringCamp) & Node/CommonJS 호환
 */

(function (root, factory) {
  const springModule = factory(root.KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM));
  if (typeof globalThis !== "undefined") {
    globalThis.KBO_GM = Object.assign(globalThis.KBO_GM || {}, { SpringCamp: springModule });
  }
  if (typeof window !== "undefined") {
    window.KBO_GM = Object.assign(window.KBO_GM || {}, { SpringCamp: springModule });
  }
  if (typeof module === "object" && module.exports) {
    module.exports = springModule;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function (KBO_GM) {
  "use strict";

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const randInt = (lo, hi, rng = Math.random) => lo + Math.floor(rng() * (hi - lo + 1));
  const pick = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];
  const round100 = (v) => Math.round(v / 100) * 100;

  /* ═══════════════════════════════════════════════════════════════════════
   * 1. 전지훈련(스프링캠프) 장소 프리셋 & 코칭스태프 풀 정의
   * ═══════════════════════════════════════════════════════════════════════ */
  const CAMP_LOCATIONS = {
    USA: {
      id: "USA",
      name: "미국 애리조나/플로리다 캠프",
      cost: 35000,              // 3억 5,000만원
      injuryRisk: 0.008,        // 따뜻한 기후로 부상 위험 최저 (0.8%)
      statGainMul: 1.35,        // 능력치/TP 상승 효율 최고
      pitchMasteryMul: 1.45,    // 구종 숙련도 및 신구종 장착 확률 최고
      newPitchChance: 0.28,
      openingCond: 1.06,        // 개막 컨디션 최상
      desc: "고비용 · 부상 위험 최소 · 능력치 및 신구종 완성도 대폭 증가"
    },
    OKINAWA: {
      id: "OKINAWA",
      name: "일본 오키나와/미야자키 캠프",
      cost: 22000,              // 2억 2,000만원
      injuryRisk: 0.013,        // 부상 위험 낮음 (1.3%)
      statGainMul: 1.20,        // 실전 연습경기 중심 고른 성장
      pitchMasteryMul: 1.25,
      newPitchChance: 0.20,
      openingCond: 1.03,
      desc: "중상 비용 · 부상 위험 감소 · 연습경기 실전 감각 및 구종 숙련도 증가"
    },
    DOMESTIC: {
      id: "DOMESTIC",
      name: "국내 1차 캠프 (거제/제주/서산/함평)",
      cost: 5000,               // 5,000만원 (저비용)
      injuryRisk: 0.032,        // 꽃샘추위로 근육/관절 부상 위험 상승 (3.2%)
      statGainMul: 0.82,        // 훈련 효율 낮음
      pitchMasteryMul: 0.80,
      newPitchChance: 0.08,
      openingCond: 0.94,        // 개막 초반 컨디션 난조
      desc: "저비용 · 꽃샘추위 부상 위험 상승 · 개막 초반 컨디션 난조"
    }
  };

  // 감독 스타일별 특성 프리셋
  const MANAGER_STYLES = {
    데이터: {
      style: "데이터",
      label: "데이터중심형",
      tacticsBonus: 1.04,
      youthGrowthBonus: 1.04,
      smallBallBonus: 1.00,
      desc: "세이버메트릭스·수비 시프트·불펜 매치업 최적화 (전술 +4%)"
    },
    스몰볼: {
      style: "스몰볼",
      label: "스몰볼형",
      tacticsBonus: 1.03,
      youthGrowthBonus: 1.02,
      smallBallBonus: 1.12,
      desc: "기동력·작전야구·수비 기본기 극대화 (주력/수비 훈련 +12%)"
    },
    육성: {
      style: "육성",
      label: "육성형",
      tacticsBonus: 1.00,
      youthGrowthBonus: 1.22,
      smallBallBonus: 1.02,
      desc: "24세 이하 유망주·신인 능력치 및 구종 성장 속도 대폭 가속 (+22%)"
    },
    윈나우: {
      style: "윈나우",
      label: "윈나우형",
      tacticsBonus: 1.05,
      youthGrowthBonus: 0.95,
      smallBallBonus: 1.00,
      desc: "주전·베테랑 중심 단기전 및 정규시즌 승률 극대화 (전술 +5%)"
    },
    균형: {
      style: "균형",
      label: "균형형",
      tacticsBonus: 1.02,
      youthGrowthBonus: 1.06,
      smallBallBonus: 1.03,
      desc: "성적과 육성의 조화를 추구하는 밸런스형 리더십"
    }
  };

  // [저작권 보호] 실제 감독·코치 이름과 완전히 다른 100% 가상 코칭스태프 인재 풀
  const MANAGER_CANDIDATES = [
    { name: "한도훈", style: "데이터", salary: 6500 },
    { name: "강태산", style: "윈나우", salary: 6000 },
    { name: "류진석", style: "윈나우", salary: 7000 },
    { name: "박세진", style: "육성",   salary: 6000 },
    { name: "윤성호", style: "스몰볼", salary: 5200 },
    { name: "최현민", style: "육성",   salary: 4800 },
    { name: "장석우", style: "스몰볼", salary: 6200 },
    { name: "오건태", style: "균형",   salary: 4500 },
    { name: "서정후", style: "데이터", salary: 4400 },
    { name: "문태영", style: "데이터", salary: 5000 },
    { name: "신유성", style: "육성",   salary: 4300 },
    { name: "배진호", style: "윈나우", salary: 6800 }
  ];

  const PITCHING_COACH_CANDIDATES = [
    { name: "구태준", specialty: "stuff",    trainBonus: 1.12, tacticsBonus: 1.03, injuryPrevBonus: 1.05, salary: 2600 },
    { name: "민성재", specialty: "control",  trainBonus: 1.10, tacticsBonus: 1.02, injuryPrevBonus: 1.10, salary: 2500 },
    { name: "남궁현", specialty: "control",  trainBonus: 1.11, tacticsBonus: 1.03, injuryPrevBonus: 1.08, salary: 2600 },
    { name: "조태웅", specialty: "movement", trainBonus: 1.10, tacticsBonus: 1.04, injuryPrevBonus: 1.04, salary: 2500 },
    { name: "하진수", specialty: "stuff",    trainBonus: 1.13, tacticsBonus: 1.02, injuryPrevBonus: 1.03, salary: 2400 },
    { name: "권석주", specialty: "stamina",  trainBonus: 1.08, tacticsBonus: 1.02, injuryPrevBonus: 1.14, salary: 2200 }
  ];

  const HITTING_COACH_CANDIDATES = [
    { name: "마동현", specialty: "contact", trainBonus: 1.12, clutchBonus: 1.04, salary: 2600 },
    { name: "석진우", specialty: "power",   trainBonus: 1.14, clutchBonus: 1.05, salary: 2800 },
    { name: "황보성", specialty: "power",   trainBonus: 1.11, clutchBonus: 1.03, salary: 2400 },
    { name: "고태민", specialty: "contact", trainBonus: 1.11, clutchBonus: 1.03, salary: 2500 },
    { name: "노준혁", specialty: "eye",     trainBonus: 1.12, clutchBonus: 1.03, salary: 2500 },
    { name: "안성빈", specialty: "speed",   trainBonus: 1.10, clutchBonus: 1.02, salary: 2100 }
  ];

  // 구단별 기본 오너 성향 (명문 / 리빌딩 / 가성비)
  const TEAM_OWNER_ARCHETYPE = {
    KIA: "PRESTIGE",
    LG:  "PRESTIGE",
    SAM: "PRESTIGE",
    DOO: "PRESTIGE",
    LOT: "PRESTIGE",
    SSG: "PRESTIGE",
    KT:  "MONEYBALL",
    NC:  "MONEYBALL",
    HAN: "REBUILDING",
    KIW: "MONEYBALL"
  };

  const LEARNABLE_PITCHES = ["SL", "CB", "CH", "FK", "SP", "FC", "FT", "SW", "SI", "KC"];

  /* ═══════════════════════════════════════════════════════════════════════
   * 2. [요청 1] 전지훈련 진행 (runSpringCamp)
   *    - 미국 / 오키나와 / 국내 캠프 선택
   *    - 비용 차감, 능력치(TP/st) 상승, 투수 구종 숙련도 및 신구종 습득, 부상/컨디션 처리
   * ═══════════════════════════════════════════════════════════════════════ */
  function runSpringCamp(context, options = {}) {
    if (!context || !Array.isArray(context.kboTeams)) {
      throw new Error("유효한 GMGameContext 인스턴스가 필요합니다.");
    }
    const rng = options.rng || Math.random;
    const userCampKey = (options.userCampLocation || options.location || "OKINAWA").toUpperCase();
    const trainingFocus = (options.trainingFocus || "BALANCED").toUpperCase();

    const teamCampReports = {};

    context.kboTeams.forEach((team) => {
      const isUserTeam = team.id === context.userTeamId;

      // 1) 캠프지 결정 (유저 구단은 지정된 옵션, AI 구단은 잔여 예산 기준 자동 선택)
      let locKey = "OKINAWA";
      if (isUserTeam) {
        locKey = CAMP_LOCATIONS[userCampKey] ? userCampKey : "OKINAWA";
      } else {
        const avail = team.getAvailableBudget ? team.getAvailableBudget() : team.budget - 700000;
        if (avail >= 550000 && rng() < 0.65) locKey = "USA";
        else if (avail >= 250000) locKey = "OKINAWA";
        else locKey = "DOMESTIC";
      }

      const camp = CAMP_LOCATIONS[locKey];
      team.budget = clamp((team.budget || 1200000) - camp.cost, 1000000, 2500000);

      const staff = team.coachingStaff || {};
      const mgrStyleKey = (staff.manager && staff.manager.style) || "균형";
      const mgrProfile = MANAGER_STYLES[mgrStyleKey] || MANAGER_STYLES.균형;
      const pitCoachBonus = (staff.pitchingCoach && staff.pitchingCoach.trainBonus) || 1.06;
      const hitCoachBonus = (staff.hittingCoach && staff.hittingCoach.trainBonus) || 1.06;
      const pitSpec = (staff.pitchingCoach && staff.pitchingCoach.specialty) || "control";
      const hitSpec = (staff.hittingCoach && staff.hittingCoach.specialty) || "contact";

      const allPlayers = team.getAllPlayers();
      const campInjuries = [];
      const newPitchUnlocked = [];
      const growthLogs = [];

      allPlayers.forEach((p) => {
        // 기존 경미한 피로도 초기화 및 캠프 개막 컨디션 부여
        p.fatigue = locKey === "DOMESTIC" ? 12 : 4;
        p.cond = camp.openingCond;

        // 캠프 부상 판정 (국내 캠프는 꽃샘추위로 부상 확률 높음)
        let injProb = camp.injuryRisk;
        if (p.iron) injProb *= 0.45;
        if (p.age >= 33) injProb *= 1.30;
        const injuryPrev = (staff.pitchingCoach && staff.pitchingCoach.injuryPrevBonus) || 1.0;
        injProb /= injuryPrev;

        if (rng() < injProb) {
          const weeks = randInt(1, 3, rng);
          const label = locKey === "DOMESTIC" ? "꽃샘추위 근육 경직/염좌" : "스프링캠프 훈련 중 경미 염좌";
          p.injury = {
            active: true,
            name: label,
            part: p.type === "pitcher" ? "어깨" : "햄스트링",
            label,
            weeksLeft: weeks,
            major: false
          };
          p.cond = 0.88;
          campInjuries.push({
            playerId: p.id,
            name: p.name,
            pos: p.pos,
            label,
            weeksLeft: weeks
          });
          return; // 부상 시 캠프 성장 제외
        }

        // 연령 및 잠재력 여유분에 따른 성장 계수
        const trueOvr = p.getTrueOvr();
        const potHeadroom = Math.max(0, (p.potential || 75) - trueOvr);
        const ageFactor = p.age <= 24 ? 1.35 * mgrProfile.youthGrowthBonus : p.age <= 28 ? 1.0 : p.age <= 32 ? 0.55 : 0.25;
        const coachMul = p.type === "pitcher" ? pitCoachBonus : hitCoachBonus;

        const keys = p.type === "pitcher"
          ? ["control", "stuff", "velo", "stamina", "movement"]
          : ["contact", "power", "eye", "defense", "speed"];

        let totalStatGain = 0;
        const statDiffs = {};

        keys.forEach((k) => {
          let specMul = 1.0;
          if (p.type === "pitcher" && k === pitSpec) specMul = 1.25;
          if (p.type === "batter" && k === hitSpec) specMul = 1.25;
          if (mgrProfile.style === "스몰볼" && (k === "speed" || k === "defense")) specMul *= mgrProfile.smallBallBonus;
          if (isUserTeam && trainingFocus === "PITCHING" && p.type === "pitcher") specMul *= 1.15;
          if (isUserTeam && trainingFocus === "HITTING" && p.type === "batter") specMul *= 1.15;
          if (isUserTeam && trainingFocus === "ROOKIE_DEV" && p.age <= 23) specMul *= 1.22;

          // 훈련 포인트(TP) 획득 및 능력치(st) 반영
          const rawTpGain = (18 + Math.min(14, potHeadroom * 0.7)) * camp.statGainMul * ageFactor * coachMul * specMul * (0.65 + rng() * 0.7);
          p.tp = p.tp || {};
          p.tp[k] = (p.tp[k] || 0) + Math.round(rawTpGain);

          // TP 45점당 능력치 +1 상승 (단, 잠재력 한계치 이내)
          let gained = 0;
          while (p.tp[k] >= 45 && p.st[k] < Math.min(108, (p.potential || 80) + 4)) {
            p.tp[k] -= 45;
            p.st[k] = clamp(p.st[k] + 1, 20, 110);
            gained += 1;
          }
          if (gained > 0) {
            statDiffs[k] = gained;
            totalStatGain += gained;
          }
        });

        // 투수 전용: 구종 숙련도(m) 상승 및 신구종 장착
        let pitchMasteryGain = 0;
        if (p.type === "pitcher" && Array.isArray(p.pitches)) {
          p.pitches.forEach((pt) => {
            const mAdd = Math.max(1, Math.round((1.5 + rng() * 2.5) * camp.pitchMasteryMul * (p.age <= 26 ? 1.25 : 0.85)));
            const prevM = pt.m || 50;
            pt.m = clamp(prevM + mAdd, 20, 100);
            pitchMasteryGain += pt.m - prevM;
          });

          // 보유 구종이 4개 미만인 젊은 투수는 캠프에서 신구종 습득 가능
          if (p.pitches.length < 4 && p.age <= 29 && rng() < camp.newPitchChance) {
            const owned = new Set(p.pitches.map((x) => x.k));
            const availPitches = LEARNABLE_PITCHES.filter((pk) => !owned.has(pk));
            if (availPitches.length > 0) {
              const newKey = pick(availPitches, rng);
              const initMastery = clamp(Math.round(42 + camp.pitchMasteryMul * 8 + randInt(0, 8, rng)), 40, 68);
              p.pitches.push({ k: newKey, m: initMastery });
              newPitchUnlocked.push({
                playerId: p.id,
                name: p.name,
                pos: p.pos,
                pitchKey: newKey,
                mastery: initMastery
              });
            }
          }
        }

        if (totalStatGain > 0 || pitchMasteryGain >= 5) {
          growthLogs.push({
            playerId: p.id,
            name: p.name,
            pos: p.pos,
            age: p.age,
            totalStatGain,
            statDiffs,
            pitchMasteryGain,
            newTrueOvr: p.getTrueOvr()
          });
        }
      });

      // 스카우팅 리포트 갱신
      allPlayers.forEach((p) => {
        if (typeof p.updateScoutingReport === "function") {
          p.updateScoutingReport(context.scoutLevel || 1, isUserTeam, rng);
        }
      });

      growthLogs.sort((a, b) => (b.totalStatGain * 2 + b.pitchMasteryGain * 0.5) - (a.totalStatGain * 2 + a.pitchMasteryGain * 0.5));
      const campMvp = growthLogs[0] || null;

      teamCampReports[team.id] = {
        teamId: team.id,
        teamName: team.name,
        locationId: camp.id,
        locationName: camp.name,
        cost: camp.cost,
        remainingBudget: team.budget,
        campMvp,
        topGrowers: growthLogs.slice(0, 6),
        newPitchUnlocked,
        campInjuries
      };
    });

    return {
      year: context.currentYear,
      teamCampReports,
      userCampReport: teamCampReports[context.userTeamId] || null
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 3. [요청 2] 감독 및 코치진 계약 (manageCoachingStaff)
   *    - 감독(데이터중심형, 스몰볼형, 육성형, 윈나우형), 투수코치, 타격코치 영입/재계약
   * ═══════════════════════════════════════════════════════════════════════ */
  function getCoachingCandidates() {
    return {
      managers: MANAGER_CANDIDATES.map((m) => ({
        ...m,
        ...(MANAGER_STYLES[m.style] || MANAGER_STYLES.균형)
      })),
      pitchingCoaches: PITCHING_COACH_CANDIDATES.slice(),
      hittingCoaches: HITTING_COACH_CANDIDATES.slice()
    };
  }

  /**
   * 구단 감독 및 코칭스태프 인선/재계약 및 예산 반영
   * @param {GMGameContext} context
   * @param {Object} userStaffAssignments
   *   - { manager: { name, style, salary } | string(style/name), pitchingCoach: {...}, hittingCoach: {...} }
   * @param {Object} options
   */
  function manageCoachingStaff(context, userStaffAssignments = {}, options = {}) {
    if (!context || !Array.isArray(context.kboTeams)) {
      throw new Error("유효한 GMGameContext 인스턴스가 필요합니다.");
    }
    const rng = options.rng || Math.random;
    const teamStaffReports = {};

    context.kboTeams.forEach((team) => {
      const isUserTeam = team.id === context.userTeamId;
      const curStaff = team.coachingStaff || {};

      let nextManager = curStaff.manager;
      let nextPitCoach = curStaff.pitchingCoach;
      let nextHitCoach = curStaff.hittingCoach;

      if (isUserTeam && userStaffAssignments && Object.keys(userStaffAssignments).length > 0) {
        // 1) 감독 지정 처리 (이름, 스타일명, 또는 객체로 전달 지원)
        if (userStaffAssignments.manager) {
          const uMgr = userStaffAssignments.manager;
          if (typeof uMgr === "string") {
            const byName = MANAGER_CANDIDATES.find((c) => c.name === uMgr);
            const byStyle = MANAGER_CANDIDATES.find((c) => c.style === uMgr || (MANAGER_STYLES[c.style] && MANAGER_STYLES[c.style].label === uMgr));
            const base = byName || byStyle || { name: uMgr, style: MANAGER_STYLES[uMgr] ? uMgr : "데이터", salary: 5500 };
            const styleMeta = MANAGER_STYLES[base.style] || MANAGER_STYLES.데이터;
            nextManager = { ...base, ...styleMeta };
          } else if (typeof uMgr === "object") {
            const styleKey = uMgr.style || "데이터";
            const styleMeta = MANAGER_STYLES[styleKey] || MANAGER_STYLES.데이터;
            nextManager = {
              name: uMgr.name || "신임 감독",
              salary: uMgr.salary || 5500,
              ...styleMeta,
              ...uMgr
            };
          }
        }

        // 2) 투수코치 지정 처리
        if (userStaffAssignments.pitchingCoach) {
          const uPit = userStaffAssignments.pitchingCoach;
          if (typeof uPit === "string") {
            nextPitCoach =
              PITCHING_COACH_CANDIDATES.find((c) => c.name === uPit || c.specialty === uPit) || nextPitCoach;
          } else if (typeof uPit === "object") {
            nextPitCoach = { ...nextPitCoach, ...uPit };
          }
        }

        // 3) 타격코치 지정 처리
        if (userStaffAssignments.hittingCoach) {
          const uHit = userStaffAssignments.hittingCoach;
          if (typeof uHit === "string") {
            nextHitCoach =
              HITTING_COACH_CANDIDATES.find((c) => c.name === uHit || c.specialty === uHit) || nextHitCoach;
          } else if (typeof uHit === "object") {
            nextHitCoach = { ...nextHitCoach, ...uHit };
          }
        }
      } else if (!isUserTeam) {
        // AI 구단: 구단주 신임도가 낮으면(42 이하) 감독 경질 및 새 성향 감독 선임
        if ((team.ownerTrust || 60) <= 42 || !nextManager) {
          const chosen = pick(MANAGER_CANDIDATES, rng);
          const styleMeta = MANAGER_STYLES[chosen.style] || MANAGER_STYLES.균형;
          nextManager = { ...chosen, ...styleMeta };
        } else {
          const styleMeta = MANAGER_STYLES[nextManager.style] || MANAGER_STYLES.균형;
          nextManager = { ...styleMeta, ...nextManager };
        }
        if (!nextPitCoach) nextPitCoach = { ...pick(PITCHING_COACH_CANDIDATES, rng) };
        if (!nextHitCoach) nextHitCoach = { ...pick(HITTING_COACH_CANDIDATES, rng) };
      }

      team.coachingStaff = {
        manager: nextManager,
        pitchingCoach: nextPitCoach,
        hittingCoach: nextHitCoach
      };

      const totalStaffSalary =
        ((nextManager && nextManager.salary) || 5000) +
        ((nextPitCoach && nextPitCoach.salary) || 2200) +
        ((nextHitCoach && nextHitCoach.salary) || 2200);

      team.budget = clamp((team.budget || 1200000) - totalStaffSalary, 1000000, 2500000);

      teamStaffReports[team.id] = {
        teamId: team.id,
        teamName: team.name,
        manager: team.coachingStaff.manager,
        pitchingCoach: team.coachingStaff.pitchingCoach,
        hittingCoach: team.coachingStaff.hittingCoach,
        totalStaffSalary,
        remainingBudget: team.budget
      };
    });

    return {
      year: context.currentYear,
      teamStaffReports,
      userStaffReport: teamStaffReports[context.userTeamId] || null
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 4. [요청 3] 구단주 예산 책정 및 시즌 목표 설정 (setupOwnerExpectations)
   *    - 구단 성향(명문/리빌딩/가성비) 및 직전 시즌 성적 기반 차년도 총예산·목표 순위 부여
   * ═══════════════════════════════════════════════════════════════════════ */
  function setupOwnerExpectations(context, options = {}) {
    if (!context || !Array.isArray(context.kboTeams)) {
      throw new Error("유효한 GMGameContext 인스턴스가 필요합니다.");
    }

    const metaList = (KBO_GM && KBO_GM.KBO_TEAM_META) || [];
    const standingsMap = {};
    if (Array.isArray(context.standings)) {
      context.standings.forEach((s) => {
        standingsMap[s.teamId] = s.rank;
      });
    }

    const expectations = {};

    context.kboTeams.forEach((team) => {
      const meta = metaList.find((m) => m.id === team.id) || { baseBudget: 1450000 };
      const archetype = TEAM_OWNER_ARCHETYPE[team.id] || "PRESTIGE";
      const prevRank = standingsMap[team.id] || 5;

      // 구단 전체 로스터 상위 15인 평균 OVR 측정 (전력 평가)
      const top15 = team
        .getAllPlayers()
        .slice()
        .sort((a, b) => b.getTrueOvr() - a.getTrueOvr())
        .slice(0, 15);
      const rosterPower = top15.length
        ? top15.reduce((s, p) => s + p.getTrueOvr(), 0) / top15.length
        : 74;

      // 1) 구단 성향 및 전력에 따른 시즌 목표(Mission & Target Rank) 부여
      let targetRank = 5;
      let goalTitle = "포스트시즌 진출 (5위 이내)";
      let goalCode = "POSTSEASON";

      if (archetype === "PRESTIGE") {
        if (rosterPower >= 78.5 || prevRank <= 2) {
          targetRank = 1;
          goalTitle = "한국시리즈 우승 (1위)";
          goalCode = "CHAMPIONSHIP";
        } else {
          targetRank = 3;
          goalTitle = "상위권 수성 (3위 이내)";
          goalCode = "TOP_3";
        }
      } else if (archetype === "MONEYBALL") {
        if (rosterPower >= 77 || prevRank <= 4) {
          targetRank = 5;
          goalTitle = "가성비 포스트시즌 진출 (5위 이내)";
          goalCode = "POSTSEASON";
        } else {
          targetRank = 6;
          goalTitle = "중위권 도약 및 흑자 경영 (6위 이내)";
          goalCode = "MID_TABLE";
        }
      } else {
        // REBUILDING
        if (rosterPower >= 77) {
          targetRank = 5;
          goalTitle = "리빌딩 완성 · 가을야구 복귀 (5위 이내)";
          goalCode = "POSTSEASON";
        } else {
          targetRank = 8;
          goalTitle = "신인 육성 및 탈꼴찌 (8위 이내)";
          goalCode = "REBUILD_YOUTH";
        }
      }

      // 2) 차년도 총예산(budget) 책정
      // 기본 모기업 지원금 + 직전 시즌 관중/성적 인센티브 + 이월 잔여금(최대 25% 반영)
      const fanBonus = Math.round(((team.fanRatio || 55) - 50) * 2200);
      const rankBonus = Math.round((6 - prevRank) * 25000);
      const carryover = clamp(Math.round(Math.max(0, team.budget - team.getTotalPayroll()) * 0.20), 0, 250000);
      const nextBudget = round100(
        clamp((meta.baseBudget || 1450000) + fanBonus + rankBonus + carryover, 1050000, 2200000)
      );

      team.budget = nextBudget;

      // 3) 새 시즌 구단주 신임도 초기화 (기본 62점 + 기존 신임도 관성 30% 반영)
      team.ownerTrust = clamp(Math.round(62 * 0.7 + (team.ownerTrust || 60) * 0.3), 45, 85);

      team.ownerExpectation = {
        year: context.currentYear,
        archetype,
        archetypeLabel: archetype === "PRESTIGE" ? "명문 구단" : archetype === "MONEYBALL" ? "가성비 구단" : "리빌딩 구단",
        goalCode,
        goalTitle,
        targetRank,
        allocatedBudget: nextBudget,
        initialOwnerTrust: team.ownerTrust
      };

      expectations[team.id] = team.ownerExpectation;
    });

    return {
      year: context.currentYear,
      expectations,
      userExpectation: expectations[context.userTeamId] || null
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 5. [요청 4] 오프시즌 최종 마감 및 새 시즌 개막 전환 (finalizeOffseasonAndStartSeason)
   *    - currentYear +1, currentWeek = 1 초기화
   *    - 전 선수 나이 +1 및 노쇠화(applyAgingDecay) 적용
   *    - 직전 시즌 기록(rec)을 career 배열에 이관 후 rec 초기화
   *    - 신규 드래프트 풀(200명) 및 해외 풀(300명) 보충
   * ═══════════════════════════════════════════════════════════════════════ */
  function finalizeOffseasonAndStartSeason(context, options = {}) {
    if (!context || !Array.isArray(context.kboTeams)) {
      throw new Error("유효한 GMGameContext 인스턴스가 필요합니다.");
    }
    const rng = options.rng || Math.random;
    const completedYear = context.currentYear || 2026;
    const nextYear = completedYear + 1;

    const createEmptyRec =
      (KBO_GM && KBO_GM.createEmptySeasonRecord) ||
      function (type) {
        return type === "pitcher"
          ? { g: 0, gs: 0, ip: 0, er: 0, k: 0, bb: 0, h: 0, hr: 0, w: 0, l: 0, sv: 0, hld: 0, maxV: 0 }
          : { g: 0, pa: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, k: 0, rbi: 0, r: 0, sb: 0, cs: 0, gidp: 0 };
      };

    // 1. 완료된 시즌 팀 순위 기록 아카이빙
    if (!Array.isArray(context.seasonHistory)) {
      context.seasonHistory = [];
    }
    if (Array.isArray(context.standings) && context.standings.length > 0) {
      context.seasonHistory.push({
        year: completedYear,
        standings: JSON.parse(JSON.stringify(context.standings))
      });
    }

    let totalArchivedPlayers = 0;
    let totalAgingDecayedPlayers = 0;

    // 선수 1명의 시즌 전환 처리 헬퍼 (커리어 이관 + 나이 +1 + 노쇠화 + rec 초기화)
    const transitionPlayerToNewSeason = (player, isOwnTeam = false, isKboRoster = false) => {
      const rec = player.rec || {};
      const hasPlayed = isKboRoster || (rec.g || 0) > 0 || (rec.pa || 0) > 0 || (rec.ip || 0) > 0;

      if (hasPlayed) {
        if (!Array.isArray(player.career)) player.career = [];
        if (!player.career.some((c) => c.year === completedYear)) {
          player.career.push({
            year: completedYear,
            age: player.age,
            teamId: player.teamId,
            status: player.status,
            war: typeof player.getWar === "function" ? player.getWar(rec) : 0,
            woba: typeof player.getWoba === "function" ? player.getWoba(rec) : 0,
            rec: JSON.parse(JSON.stringify(rec))
          });
          totalArchivedPlayers += 1;
        }
      }

      // 시즌 누적 기록(1군/2군) 및 파생 지표 리셋
      player.rec = createEmptyRec(player.type);
      player.futuresRec = createEmptyRec(player.type);
      player.metrics = null;
      player.serviceDaysThisYear = 0;

      // 나이 +1 증가 및 에이징 커브(applyAgingDecay) 적용
      player.age = (player.age || 20) + 1;
      if (typeof player.applyAgingDecay === "function") {
        const drops = player.applyAgingDecay(rng);
        if (drops && Object.keys(drops).length > 0) {
          totalAgingDecayedPlayers += 1;
        }
      }

      // 스카우팅 리포트 재산출
      if (typeof player.updateScoutingReport === "function") {
        player.updateScoutingReport(context.scoutLevel || 1, isOwnTeam, rng);
      }
    };

    // 2. KBO 10개 구단 전 선수 전환(상무 군보류 및 재활명단 포함), 세대교체 로스터 밸런싱 및 팀 전적 초기화
    context.kboTeams.forEach((team) => {
      const isOwn = team.id === context.userTeamId;
      team.getAllPlayers().forEach((p) => transitionPlayerToNewSeason(p, isOwn, true));
      (team.militaryList || []).forEach((p) => transitionPlayerToNewSeason(p, isOwn, true));
      (team.foreignRehabList || []).forEach((p) => transitionPlayerToNewSeason(p, isOwn, true));

      // 육성군에 외국인 선수가 섞여 들어갔을 경우 즉시 2군으로 이동
      const devForeigners = team.rosterDev.filter((p) => p.nationality && p.nationality !== "KOR");
      if (devForeigners.length > 0) {
        team.rosterDev = team.rosterDev.filter((p) => !p.nationality || p.nationality === "KOR");
        devForeigners.forEach((fp) => {
          fp.status = "2GUN";
          team.roster2G.push(fp);
        });
      }

      // 구단 전체 인원이 68명을 초과하면 육성군/2군 하위 전력 노장부터 방출 정리 (메모리 누수 방지 및 세대교체)
      while (team.getAllPlayers().length > 68 && team.rosterDev.length > 6) {
        team.rosterDev.sort((a, b) => {
          const scoreA = a.getTrueOvr() * 0.6 + (a.potential || 65) * 0.4 - Math.max(0, a.age - 26) * 2.0;
          const scoreB = b.getTrueOvr() * 0.6 + (b.potential || 65) * 0.4 - Math.max(0, b.age - 26) * 2.0;
          return scoreA - scoreB;
        });
        const released = team.rosterDev.shift();
        if (released) {
          released.teamId = null;
          released.status = "RELEASED";
        }
      }

      // 육성군 상위 유망주 -> 2군 승격 및 2군 상위 전력 -> 1군 승격 (1군 28명 / 2군 30명 정원 준수)
      while (team.roster2G.length < 28 && team.rosterDev.length > 6) {
        team.rosterDev.sort((a, b) => b.getTrueOvr() - a.getTrueOvr());
        const promoted = team.rosterDev.shift();
        if (promoted) {
          promoted.status = "2GUN";
          team.roster2G.push(promoted);
        }
      }
      while (team.roster1G.length < 28 && team.roster2G.length > 18) {
        team.roster2G.sort((a, b) => b.getTrueOvr() - a.getTrueOvr());
        const promoted = team.roster2G.shift();
        if (promoted) {
          promoted.status = "1GUN";
          team.roster1G.push(promoted);
        }
      }
      while (team.roster1G.length > 28) {
        const demote = team.roster1G
          .filter((p) => p.nationality === "KOR")
          .sort((a, b) => a.getTrueOvr() - b.getTrueOvr())[0] || team.roster1G[team.roster1G.length - 1];
        team.roster1G = team.roster1G.filter((p) => p.id !== demote.id);
        demote.status = "2GUN";
        team.roster2G.push(demote);
      }
      while (team.roster2G.length > 30) {
        const demote = team.roster2G
          .filter((p) => p.nationality === "KOR")
          .sort((a, b) => a.getTrueOvr() - b.getTrueOvr())[0] || team.roster2G[team.roster2G.length - 1];
        team.roster2G = team.roster2G.filter((p) => p.id !== demote.id);
        if (demote.nationality && demote.nationality !== "KOR") {
          demote.teamId = null;
          demote.status = "FOREIGN_RELEASED";
        } else {
          demote.status = "YUKSEONG";
          team.rosterDev.push(demote);
        }
      }

      team.record = { w: 0, l: 0, d: 0, rs: 0, ra: 0 };
    });

    // 3. 해외 풀(npbPool) 전환 및 300명 정원 보충
    const genPlayerFn = KBO_GM && KBO_GM.generatePlayer;
    const posKeys = KBO_GM && KBO_GM.POSITIONS ? Object.keys(KBO_GM.POSITIONS) : ["SP", "RP", "CP", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"];

    context.npbPool = (context.npbPool || []).filter((p) => (p.age || 28) < 38 && p.status !== "FOREIGN_RELEASED");
    context.npbPool.forEach((p) => transitionPlayerToNewSeason(p, false, false));

    if (typeof genPlayerFn === "function") {
      while (context.npbPool.length < 300) {
        const idx = context.npbPool.length;
        const isPitcher = idx < 165;
        const pos = isPitcher ? pick(["SP", "SP", "RP", "CP"], rng) : pick(["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"], rng);
        const isAsian = rng() < 0.52;
        const nat = isAsian ? pick(["JPN", "JPN", "TWN", "AUS"], rng) : pick(["USA", "DOM", "VEN"], rng);
        const orig = nat === "JPN" ? "NPB" : nat === "TWN" ? "CPBL" : nat === "AUS" ? "ABL" : "AAA";
        const fp = genPlayerFn({
          pos,
          status: "FOREIGN_POOL",
          teamId: null,
          tierMean: 76,
          tierSpread: 9,
          ageRange: [24, 34],
          nationality: nat,
          origin: orig,
          scoutLevel: context.scoutLevel || 1,
          isOwnTeam: false,
          rng
        });
        fp.isAsianQuarterEligible = isAsian;
        context.npbPool.push(fp);
      }

      // 4. 새 시즌 고교/대학/독립리그 신인 드래프트 풀(200명) 신규 생성
      const indClubs = [
        "연천 미라클",
        "성남 맥파이스",
        "파주 챌린저스",
        "고양 위너스",
        "수원 파인이그스",
        "포천 몬스터",
        "가평 웨일스",
        "화성 코리요"
      ];
      context.draftPool = Array.from({ length: 200 }, (_, idx) => {
        const pos = posKeys[idx % posKeys.length];
        const rOrig = rng();
        const isInd = rOrig < 0.14;
        const isUniv = !isInd && rOrig < 0.44;
        const origin = isInd ? "IND" : isUniv ? "UNIV" : "HS";
        const p = genPlayerFn({
          pos,
          status: "DRAFT_POOL",
          teamId: null,
          tierMean: isInd ? 57 : isUniv ? 58 : 52,
          tierSpread: 9,
          ageRange: isInd ? [21, 26] : isUniv ? [22, 23] : [18, 19],
          nationality: "KOR",
          origin,
          scoutLevel: context.scoutLevel || 1,
          isOwnTeam: false,
          rng
        });
        if (isInd) {
          p.indClubName = pick(indClubs, rng);
        }
        return p;
      });
    }

    // 5. 연도 +1, 주차 1주차로 리셋, 단장 3년 주기 계약 심사 연동 및 구단주 새 시즌 예산/목표 자동 설정
    let gmContractEvaluation = null;
    if (
      KBO_GM &&
      KBO_GM.Setup &&
      typeof KBO_GM.Setup.evaluateGMContractRenewal === "function" &&
      context.gmContract &&
      context.gmContract._lastEvaluatedSeason !== completedYear
    ) {
      gmContractEvaluation = KBO_GM.Setup.evaluateGMContractRenewal(context);
      context.gmContract._lastEvaluatedSeason = completedYear;
    }

    context._lastFinalizedSeason = completedYear;
    context.currentYear = nextYear;
    context.currentWeek = 1;
    if (!options.preserveCalendarDate) {
      context.currentDate = `${nextYear}-03-22`;
      context.seasonPhase = "PENNANT_RACE";
    }
    context.weeklyLogs = [];
    context.draftState = null;
    context.budgetRequestCountThisYear = 0;
    context.releasedCountThisYear = 0;
    context.kboTeams.forEach((t) => {
      t.futuresRecord = { w: 0, l: 0, d: 0, rs: 0, ra: 0 };
    });

    if (options.setupExpectations !== false) {
      setupOwnerExpectations(context, options);
    }

    if (KBO_GM && typeof KBO_GM.calculateKBOStandings === "function") {
      KBO_GM.calculateKBOStandings(context);
    }

    return {
      previousYear: completedYear,
      newYear: context.currentYear,
      currentWeek: context.currentWeek,
      currentDate: context.currentDate,
      gmContractEvaluation,
      totalArchivedPlayers,
      totalAgingDecayedPlayers,
      npbPoolCount: context.npbPool.length,
      draftPoolCount: context.draftPool.length,
      userTeamExpectation: context.getUserTeam() ? context.getUserTeam().ownerExpectation : null
    };
  }

  return {
    CAMP_LOCATIONS,
    MANAGER_STYLES,
    MANAGER_CANDIDATES,
    PITCHING_COACH_CANDIDATES,
    HITTING_COACH_CANDIDATES,
    getCoachingCandidates,
    runSpringCamp,
    manageCoachingStaff,
    setupOwnerExpectations,
    finalizeOffseasonAndStartSeason
  };
});
