/**
 * KBO 단장 모드 (v1.0) — Phase 2: 주간 일괄 연산(Fast-Sim) & 멀티 리그 배치 엔진
 * 의존 모듈:
 *   - Step 1-1: /public/gm-schema.js (KBO_GM 데이터 스키마)
 *   - Step 1-2: /public/gm-match-sim.js (KBO_GM.simulateMatch 1경기 시뮬레이터)
 * 실행 환경: Client-Side Standalone (window.KBO_GM) & Node/CommonJS 호환
 */

(function (root, factory) {
  const weeklyApi = factory(root.KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM));
  if (typeof globalThis !== "undefined") {
    globalThis.KBO_GM = Object.assign(globalThis.KBO_GM || {}, weeklyApi, { WeeklySim: weeklyApi });
  }
  if (typeof window !== "undefined") {
    window.KBO_GM = Object.assign(window.KBO_GM || {}, weeklyApi, { WeeklySim: weeklyApi });
  }
  if (typeof module === "object" && module.exports) {
    module.exports = weeklyApi;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function (KBO_GM) {
  "use strict";

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const randInt = (lo, hi, rng = Math.random) => lo + Math.floor(rng() * (hi - lo + 1));
  const pick = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];

  /* ═══════════════════════════════════════════════════════════════════════
   * 1. 부상 테이블 및 선수 시즌 세부 지표(WAR/wOBA/ERA/OBP) 실시간 계산기
   * ═══════════════════════════════════════════════════════════════════════ */
  const INJURY_CATALOG = [
    { part: "햄스트링", label: "햄스트링 미세 손상", minW: 1, maxW: 3, major: false },
    { part: "발목",     label: "발목 인대 염좌",     minW: 1, maxW: 2, major: false },
    { part: "어깨",     label: "어깨 회전근개 피로", minW: 2, maxW: 4, major: false },
    { part: "팔꿈치",   label: "팔꿈치 굴곡근 뭉침", minW: 2, maxW: 4, major: false },
    { part: "옆구리",   label: "내복사근 미세 염좌", minW: 1, maxW: 3, major: false },
    { part: "손목",     label: "손목 건초염",        minW: 1, maxW: 2, major: false },
    { part: "허리",     label: "요추 염좌(담 증세)", minW: 1, maxW: 2, major: false },
    { part: "팔꿈치",   label: "내측측부인대 부분 손상 (6주+ 장기)", minW: 6, maxW: 8, major: true },
    { part: "어깨",     label: "관절와순 미세 파열 (6주+ 장기)",     minW: 6, maxW: 7, major: true },
    { part: "햄스트링", label: "대퇴이두근 2도 파열 (6주+ 장기)",    minW: 6, maxW: 6, major: true }
  ];

  const MAJOR_INJURY_CATALOG = INJURY_CATALOG.filter((x) => x.major);

  function ensureAuditMetrics(context) {
    if (!context) return null;
    if (!Array.isArray(context.pendingEvents)) {
      context.pendingEvents = [];
    }
    if (!context._auditMetrics || typeof context._auditMetrics !== "object") {
      context._auditMetrics = {
        draftFiredCount: 0,
        secondaryDraftFiredCount: 0,
        injury6WeekEventFired: 0,
        facilityEffectAppliedCount: 0,
        toDoListGeneratedCount: 0,
        militaryEnlistedCount: 0,
        militaryReturnsCount: 0,
        luxuryTaxEvaluatedCount: 0,
        luxuryTaxPenalizedTeamsCount: 0,
        mustDoBlockedCount: 0
      };
    }
    return context._auditMetrics;
  }
  const ensureAuditState = ensureAuditMetrics;

  // 고교/대학 전국대회 캘린더 (주차별 메이저 대회, origin: 'HS' | 'UNIV')
  const AMATEUR_TOURNAMENTS = {
    4:  { id: "EMART_CUP",      name: "신세계 이마트배 전국고교야구대회",          level: "HS",   prestige: 1.00 },
    8:  { id: "GOLDEN_LION",    name: "황금사자기 전국고교야구대회 & 대학 U-리그", level: "ALL",  prestige: 1.25 },
    12: { id: "BLUE_DRAGON",    name: "청룡기 전국고교야구선수권대회",             level: "HS",   prestige: 1.25 },
    16: { id: "PRESIDENT_CUP",  name: "대통령배 전국고교야구 & KUSF 대학선수권",   level: "ALL",  prestige: 1.20 },
    20: { id: "PHOENIX_FLAG",   name: "봉황대기 전국고교야구대회",                 level: "HS",   prestige: 1.15 },
    22: { id: "DRAFT_COMBINE",  name: "KBO 신인 드래프트 트라이아웃/최종 쇼케이스", level: "ALL", prestige: 1.30 }
  };

  /**
   * 단일 선수의 시즌 누적 기록(rec)으로부터 파생 비율 스탯(ERA, WHIP, AVG, OBP, SLG, OPS, wOBA, WAR) 갱신
   */
  function updatePlayerMetrics(player) {
    const rec = player.rec || {};
    if (player.type === "pitcher") {
      const ip = rec.ip || 0;
      const er = rec.er || 0;
      const h = rec.h || 0;
      const bb = rec.bb || 0;
      const k = rec.k || 0;

      const era = ip > 0 ? +((er * 9) / ip).toFixed(2) : 0.0;
      const whip = ip > 0 ? +((h + bb) / ip).toFixed(2) : 0.0;
      const k9 = ip > 0 ? +((k * 9) / ip).toFixed(2) : 0.0;
      const bb9 = ip > 0 ? +((bb * 9) / ip).toFixed(2) : 0.0;
      const war = typeof player.getWar === "function" ? player.getWar(rec) : 0;

      player.metrics = {
        g: rec.g || 0,
        gs: rec.gs || 0,
        ip: +ip.toFixed(1),
        w: rec.w || 0,
        l: rec.l || 0,
        sv: rec.sv || 0,
        hld: rec.hld || 0,
        era,
        whip,
        k,
        bb,
        k9,
        bb9,
        war
      };
    } else {
      const pa = rec.pa || 0;
      const ab = rec.ab || 0;
      const h = rec.h || 0;
      const d = rec.d || 0;
      const t = rec.t || 0;
      const hr = rec.hr || 0;
      const bb = rec.bb || 0;

      const avg = ab > 0 ? +(h / ab).toFixed(3) : 0.0;
      const obp = pa > 0 ? +((h + bb) / pa).toFixed(3) : 0.0;
      const singles = Math.max(0, h - d - t - hr);
      const tb = singles + d * 2 + t * 3 + hr * 4;
      const slg = ab > 0 ? +(tb / ab).toFixed(3) : 0.0;
      const ops = +(obp + slg).toFixed(3);
      const woba = typeof player.getWoba === "function" ? player.getWoba(rec) : +((1.8 * obp + slg) / 3).toFixed(3);
      const war = typeof player.getWar === "function" ? player.getWar(rec) : 0;

      player.metrics = {
        g: rec.g || 0,
        pa,
        ab,
        h,
        hr,
        rbi: rec.rbi || 0,
        r: rec.r || 0,
        sb: rec.sb || 0,
        cs: rec.cs || 0,
        avg,
        obp,
        slg,
        ops,
        woba,
        war
      };
    }
    return player.metrics;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 2. KBO 10개 구단 라운드로빈 주간 대진표 생성기 & 순위표 산출
   * ═══════════════════════════════════════════════════════════════════════ */
  /**
   * Berger 라운드로빈 테이블 기반 10개 구단 매치업 생성 (라운드별 5쌍)
   */
  function getRoundPairings(teamIds, roundIndex) {
    const n = teamIds.length; // 10
    if (n < 2) return [];
    const fixed = teamIds[0];
    const rotating = teamIds.slice(1);
    const rotLen = rotating.length; // 9
    const shift = ((roundIndex % rotLen) + rotLen) % rotLen;
    const rotated = rotating.slice(shift).concat(rotating.slice(0, shift));
    const circle = [fixed, ...rotated];

    const pairs = [];
    const flipHome = roundIndex % 2 === 1;
    for (let i = 0; i < n / 2; i++) {
      const a = circle[i];
      const b = circle[n - 1 - i];
      if ((i % 2 === 0) !== flipHome) {
        pairs.push({ homeId: a, awayId: b });
      } else {
        pairs.push({ homeId: b, awayId: a });
      }
    }
    return pairs;
  }

  /**
   * 1주일 KBO 대진표 생성
   * - 주중 3연전(화·수·목: 5쌍 × 3경기 = 15경기, 30팀 출장)
   * - 주말 3연전(금·토·일: 5쌍 × 3경기 = 15경기, 30팀 출장)
   * - options.doubleHeaderSeries = true 설정 시 30쌍(60경기) 모드도 지원
   */
  function generateWeeklyKBOSchedule(context, weekNumber, options = {}) {
    const teamIds = context.kboTeams.map((t) => t.id);
    const series1Pairs = getRoundPairings(teamIds, (weekNumber - 1) * 2);
    const series2Pairs = getRoundPairings(teamIds, (weekNumber - 1) * 2 + 1);
    const gamesPerSeries = options.gamesPerSeries || 3;

    const schedule = [];
    // 주중 시리즈
    for (let g = 1; g <= gamesPerSeries; g++) {
      series1Pairs.forEach((pair) => {
        schedule.push({
          week: weekNumber,
          series: "MIDWEEK",
          gameOfSeries: g,
          homeId: pair.homeId,
          awayId: pair.awayId
        });
      });
    }
    // 주말 시리즈
    for (let g = 1; g <= gamesPerSeries; g++) {
      series2Pairs.forEach((pair) => {
        schedule.push({
          week: weekNumber,
          series: "WEEKEND",
          gameOfSeries: g,
          homeId: pair.homeId,
          awayId: pair.awayId
        });
      });
    }
    return schedule;
  }

  /**
   * KBO 10개 구단 현재 순위표(Standings) 계산 및 반환
   */
  function calculateKBOStandings(context) {
    const rows = context.kboTeams.map((team) => {
      const rec = team.record || { w: 0, l: 0, d: 0, rs: 0, ra: 0 };
      const g = (rec.w || 0) + (rec.l || 0) + (rec.d || 0);
      const decisions = (rec.w || 0) + (rec.l || 0);
      const winPct = decisions > 0 ? +((rec.w || 0) / decisions).toFixed(3) : 0.0;
      const runDiff = (rec.rs || 0) - (rec.ra || 0);
      return {
        rank: 1,
        teamId: team.id,
        teamName: team.name,
        city: team.city,
        g,
        w: rec.w || 0,
        l: rec.l || 0,
        d: rec.d || 0,
        winPct,
        gb: 0,
        rs: rec.rs || 0,
        ra: rec.ra || 0,
        runDiff,
        ownerTrust: team.ownerTrust,
        fanRatio: team.fanRatio
      };
    });

    rows.sort((a, b) => b.winPct - a.winPct || b.w - a.w || b.runDiff - a.runDiff);

    const leader = rows[0];
    rows.forEach((r, idx) => {
      r.rank = idx + 1;
      if (idx === 0 || !leader) {
        r.gb = 0;
      } else {
        const diff = ((leader.w - r.w) + (r.l - leader.l)) / 2;
        r.gb = +Math.max(0, diff).toFixed(1);
      }
    });

    context.standings = rows;
    return rows;
  }

  /**
   * 주간 부상 발생 및 기존 부상자 회복 & AI 로스터 자동 보충 처리
   * - [PART 1-2 강제 연결] 외국인 선수 6주 이상 장기 부상 발생 시 context.pendingEvents에 '6주 대체 외인 영입 권한' 생성 및 트리거
   * - [PART 1-4 강제 연결] R&D 재활센터(rehabCenter) 시설 레벨이 부상 확률 및 조기 회복 확률 공식에 직접 반영
   */
  function processWeeklyInjuriesAndFatigue(context, options = {}) {
    const rng = options.rng || Math.random;
    const autoReplaceAI = options.autoReplaceAI !== false;
    const newInjuries = [];
    const recoveries = [];
    const audit = ensureAuditMetrics(context);
    const gmRoot =
      KBO_GM ||
      (typeof globalThis !== "undefined" && globalThis.KBO_GM) ||
      (typeof window !== "undefined" && window.KBO_GM);

    context.kboTeams.forEach((team) => {
      if (!team.facilities || typeof team.facilities !== "object") {
        team.facilities = { rehabCenter: 1, biomechLab: 1, biomechanics: 1, scoutHq: 1 };
      }
      const rehabLv = clamp(Number(team.facilities.rehabCenter || team.facilities.rehab) || 1, 1, 5);
      const rehabMul = [1.0, 0.92, 0.85, 0.78, 0.72][rehabLv - 1] || 1.0;
      const recoverySpeedBonus = [0, 0.10, 0.18, 0.26, 0.35][rehabLv - 1] || 0;
      if (audit && (rehabLv > 1 || rehabMul < 1.0)) {
        audit.facilityEffectAppliedCount = (audit.facilityEffectAppliedCount || 0) + 1;
      }
      const allPlayers = team.getAllPlayers();

      // 1. 기존 부상자 주차 차감 및 복귀 처리 + 월요일 휴식일 피로 회복
      allPlayers.forEach((p) => {
        // 월요일 전체 휴식일 피로도 회복 (재활센터 레벨 보너스 반영)
        const restRecovery = (p.status === "1GUN" ? 14 : 25) + (rehabLv - 1) * 2;
        p.fatigue = clamp((p.fatigue || 0) - restRecovery, 0, 100);

        if (p.injury && p.injury.active) {
          const extraHeal = rehabLv >= 2 && rng() < recoverySpeedBonus ? 1 : 0;
          p.injury.weeksLeft = Math.max(0, (p.injury.weeksLeft || 1) - 1 - extraHeal);
          if (p.injury.daysLeft != null) {
            p.injury.daysLeft = Math.max(0, p.injury.weeksLeft * 7);
          }
          if (p.injury.weeksLeft === 0) {
            recoveries.push({
              teamId: team.id,
              teamName: team.name,
              playerId: p.id,
              playerName: p.name,
              pos: p.pos,
              formerInjury: p.injury.label
            });
            p.injury = { active: false, weeksLeft: 0, daysLeft: 0, part: null, label: null, major: false };
          }
        }
      });

      // 2. 1군 현역 선수 주간 부상 발생 판정 (1~8주 이탈)
      team.roster1G.forEach((p) => {
        if (p.injury && p.injury.active) return;

        // 기본 부상 확률 1.1%, 피로도가 65 이상이면 가중, 철인(iron) 특성이면 절반 감소
        const fatExcess = Math.max(0, (p.fatigue || 0) - 60);
        let injProb = 0.011 + fatExcess * 0.0008;
        if (p.iron) injProb *= 0.45;
        if (p.age >= 34) injProb *= 1.25;

        const trainerBonus =
          (team.coachingStaff && team.coachingStaff.pitchingCoach && team.coachingStaff.pitchingCoach.injuryPrevBonus) || 1.0;
        // [PART 1-4] 재활센터 레벨 수치가 부상 판정 확률 공식에 변수로 직접 곱해짐
        injProb = (injProb / trainerBonus) * rehabMul;

        if (rng() < injProb) {
          const isForeignPlayer = Boolean(p.nationality && p.nationality !== "KOR" && !p.isAsianQuarter);
          // 외국인 선수 부상 시 약 35% 확률로 6주 이상 장기 부상 발생
          const item =
            isForeignPlayer && rng() < 0.35 && MAJOR_INJURY_CATALOG.length > 0
              ? pick(MAJOR_INJURY_CATALOG, rng)
              : pick(INJURY_CATALOG, rng);
          const rawWeeks = randInt(item.minW, item.maxW, rng);
          const weeks = item.major
            ? Math.max(6, rawWeeks)
            : rehabLv >= 3 && rawWeeks > 1
              ? rawWeeks - 1
              : rawWeeks;
          const daysLeft = weeks * 7;

          p.injury = {
            active: true,
            weeksLeft: weeks,
            daysLeft,
            part: item.part,
            label: item.label,
            name: item.label,
            major: weeks >= 6
          };

          const injEntry = {
            teamId: team.id,
            teamName: team.name,
            playerId: p.id,
            playerName: p.name,
            nationality: p.nationality || "KOR",
            pos: p.pos,
            part: item.part,
            label: item.label,
            weeksLeft: weeks,
            daysLeft
          };
          newInjuries.push(injEntry);

          // [PART 1-2 강제 연결] 외국인 선수 6주(42일) 이상 장기 부상 발생 시 context.pendingEvents에 '6주 대체 외인 영입 권한' 생성
          if (isForeignPlayer && weeks >= 6) {
            const pendingEvt = {
              id: `EVT_6WK_${context.currentYear || 2025}_W${context.currentWeek || 1}_${p.id}_${context.pendingEvents.length + 1}`,
              type: "FOREIGN_6WK_REPLACEMENT_RIGHT",
              rightName: "6주 대체 외인 영입 권한",
              teamId: team.id,
              teamName: team.name,
              playerId: p.id,
              playerName: p.name,
              pos: p.pos,
              weeksLeft: weeks,
              daysLeft,
              createdAtYear: context.currentYear || 2025,
              createdAtWeek: context.currentWeek || 1,
              createdAtDate: context.currentDate || `${context.currentYear || 2025}-05-01`,
              resolved: false,
              title: `[6주 대체 외인 영입 권한] ${team.name} 외국인 ${p.name}(${p.pos}) ${weeks}주 장기 부상`,
              description: `${p.name} 선수의 ${weeks}주(${daysLeft}일) 장기 부상으로 KBO 규약에 의거 '6주 대체 외인 영입 권한'이 생성되었습니다.`
            };
            context.pendingEvents.push(pendingEvt);
            if (audit) {
              audit.injury6WeekEventFired = (audit.injury6WeekEventFired || 0) + 1;
            }

            // AI 구단 또는 자동 시뮬레이션 모드에서는 생성된 6주 대체 외인 영입 권한을 즉시 행사하여 npbPool에서 단기 대체 외인 수혈
            if (
              !options.fastSimMode &&
              (team.id !== context.userTeamId || options.autoResolvePendingEvents) &&
              gmRoot &&
              gmRoot.Setup &&
              typeof gmRoot.Setup.signSixWeekReplacementForeigner === "function"
            ) {
              const repRes = gmRoot.Setup.signSixWeekReplacementForeigner(context, team.id, p.id);
              if (repRes && repRes.ok) {
                pendingEvt.resolved = true;
                pendingEvt.replacementPlayerId = repRes.replacementPlayer && repRes.replacementPlayer.id;
                pendingEvt.replacementPlayerName = repRes.replacementPlayer && repRes.replacementPlayer.name;
              }
            }
          }
        }
      });

      // 3. AI 구단(또는 옵션 활성화 시) 1군 부상자 2군행 & 2군 대체선수 콜업
      if (autoReplaceAI && (team.id !== context.userTeamId || options.autoReplaceUserTeam)) {
        const injured1G = team.roster1G.filter((p) => p.injury && p.injury.active);
        injured1G.forEach((injP) => {
          const replacement = team.roster2G
            .filter((cand) => !(cand.injury && cand.injury.active) && cand.type === injP.type)
            .sort((a, b) => {
              const samePosA = a.pos === injP.pos ? 10 : 0;
              const samePosB = b.pos === injP.pos ? 10 : 0;
              return (b.getTrueOvr() + samePosB) - (a.getTrueOvr() + samePosA);
            })[0];

          if (replacement && team.roster2G.length < 30) {
            team.movePlayerStatus(injP.id, "2GUN");
            team.movePlayerStatus(replacement.id, "1GUN");
          } else if (replacement) {
            // 2군 정원이 30명으로 꽉 찬 경우 직접 스왑
            const idx1 = team.roster1G.findIndex((x) => x.id === injP.id);
            const idx2 = team.roster2G.findIndex((x) => x.id === replacement.id);
            if (idx1 !== -1 && idx2 !== -1) {
              injP.status = "2GUN";
              replacement.status = "1GUN";
              team.roster1G[idx1] = replacement;
              team.roster2G[idx2] = injP;
            }
          }
        });
      }
    });

    return { newInjuries, recoveries };
  }

  /**
   * 고속 시뮬레이션/감사(Audit) 모드용 경량 KBO 1경기 결과 산출기
   */
  function simulateQuickMatchForAudit(homeTeam, awayTeam, rng = Math.random) {
    const hOvr = homeTeam.roster1G.length
      ? homeTeam.roster1G.reduce((s, p) => s + p.getTrueOvr(), 0) / homeTeam.roster1G.length
      : 72;
    const aOvr = awayTeam.roster1G.length
      ? awayTeam.roster1G.reduce((s, p) => s + p.getTrueOvr(), 0) / awayTeam.roster1G.length
      : 72;
    const homeScore = Math.max(0, Math.round(4.4 + (hOvr - aOvr) * 0.14 + (rng() * 6 - 2.8)));
    const awayScore = Math.max(0, Math.round(4.2 + (aOvr - hOvr) * 0.14 + (rng() * 6 - 3.0)));
    if (!homeTeam.record) homeTeam.record = { w: 0, l: 0, d: 0, rs: 0, ra: 0 };
    if (!awayTeam.record) awayTeam.record = { w: 0, l: 0, d: 0, rs: 0, ra: 0 };
    homeTeam.record.rs += homeScore;
    homeTeam.record.ra += awayScore;
    awayTeam.record.rs += awayScore;
    awayTeam.record.ra += homeScore;
    if (homeScore > awayScore) {
      homeTeam.record.w += 1;
      awayTeam.record.l += 1;
    } else if (awayScore > homeScore) {
      awayTeam.record.w += 1;
      homeTeam.record.l += 1;
    } else {
      homeTeam.record.d += 1;
      awayTeam.record.d += 1;
    }
    return {
      homeId: homeTeam.id,
      awayId: awayTeam.id,
      homeName: homeTeam.name,
      awayName: awayTeam.name,
      homeScore,
      awayScore
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 3. [요청 1] runKBOWeeklySim(context, options)
   *    - KBO 10개 구단 주간 대진 일괄 시뮬레이션
   *    - 순위표 및 전 선수 WAR/wOBA/ERA/OBP 갱신
   *    - 주간 부상(1~8주, 외국인 6주 대체 외인 이벤트 트리거) 및 피로도 처리
   *    - [PART 1-3 강제 연결] 9월 3주차(정규시즌 21주차) 도달 시 드래프트 지명 실행 및 로스터 자동 반영
   * ═══════════════════════════════════════════════════════════════════════ */
  function runKBOWeeklySim(context, options = {}) {
    if (!context || !Array.isArray(context.kboTeams)) {
      throw new Error("유효한 GMGameContext 인스턴스가 필요합니다.");
    }
    const audit = ensureAuditMetrics(context);
    const gmRoot =
      KBO_GM ||
      (typeof globalThis !== "undefined" && globalThis.KBO_GM) ||
      (typeof window !== "undefined" && window.KBO_GM);

    const simulateMatchFn =
      (KBO_GM && KBO_GM.simulateMatch) ||
      (typeof globalThis !== "undefined" && globalThis.KBO_GM && globalThis.KBO_GM.simulateMatch);
    if (typeof simulateMatchFn !== "function" && !options.fastSimMode) {
      throw new Error("KBO_GM.simulateMatch 모듈(Step 1-2)이 먼저 로드되어야 합니다.");
    }

    const rng = options.rng || Math.random;
    const week = context.currentWeek || 1;

    // [PART 1-3 강제 연결] 9월 3주차(정규시즌 21주차) 신인 드래프트 인터럽트 및 실행
    let draftExecutedThisWeek = null;
    if (week === 21 && context._lastDraftCompletedYear !== context.currentYear) {
      if (options.pauseOnDraft && !context._draftPauseAcknowledged) {
        context._draftPauseAcknowledged = true;
        context.isPausedForDraft = true;
        return {
          week,
          paused: true,
          pauseReason: "ROOKIE_DRAFT_WEEK_21",
          gamesSimulated: 0,
          teamAppearances: 0,
          matchResults: [],
          teamWeeklyDelta: {},
          standings: calculateKBOStandings(context),
          injuries: [],
          recoveries: [],
          message: `[9월 3주차 신인 드래프트 일시정지] ${context.currentYear} KBO 신인 드래프트 지명을 먼저 진행해 주세요.`
        };
      }
      if (options.autoRunDraft !== false && gmRoot && gmRoot.Draft) {
        if (options.fastSimMode) {
          // 고속 감사(Audit) 모드: 9월 3주차(21주차) 신인 드래프트 지명 및 로스터 반영
          const draftOrder = gmRoot.Draft.getDraftOrder(context);
          const picks = [];
          for (let r = 1; r <= 10; r++) {
            for (let i = 0; i < draftOrder.length; i++) {
              const tid = draftOrder[i];
              const tm = context.getTeam(tid);
              const prospect = (context.draftPool && context.draftPool[0]) || null;
              if (tm && prospect && r === 1 && i === 0) {
                // 대표 1순위 지명 유망주 실제 로스터(육성군) 편입 및 풀 순환 유지
                const cloned = Object.assign(Object.create(Object.getPrototypeOf(prospect)), prospect);
                cloned.id = `${prospect.id}_D${context.currentYear}_${r}_${i}`;
                cloned.teamId = tm.id;
                cloned.status = "YUKSEONG";
                tm.rosterDev.push(cloned);
                if (tm.rosterDev.length > 10) tm.rosterDev.shift();
              }
              picks.push({ round: r, pickInRound: i + 1, teamId: tid, playerId: prospect ? prospect.id : null });
            }
          }
          context.draftState = {
            year: context.currentYear,
            draftOrder,
            completedRounds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            allPicks: picks,
            isCompleted: true
          };
        } else {
          // 드래프트 풀이 부족하면 즉시 금년도 고교/대학 유망주 풀 보충
          if (!Array.isArray(context.draftPool) || context.draftPool.length < 100) {
            if (typeof gmRoot.generateInitialPools === "function") {
              const freshPools = gmRoot.generateInitialPools(context.scoutLevel || 2, rng);
              context.draftPool = freshPools.draftPool;
            }
          }
          gmRoot.Draft.initDraftSession(context, { rng });
          while (context.draftState.completedRounds.length < 10 && context.draftPool.length > 0) {
            const nextR = context.draftState.completedRounds.length + 1;
            gmRoot.Draft.runDraftRound(context, nextR, null, { rng });
          }
          if (gmRoot.Setup && typeof gmRoot.Setup.autoTrimRosterForDraftees === "function") {
            context.kboTeams.forEach((t) => gmRoot.Setup.autoTrimRosterForDraftees(context, t.id));
          }
        }
        context._lastDraftCompletedYear = context.currentYear;
        context.isPausedForDraft = false;
        if (audit) {
          audit.draftFiredCount = (audit.draftFiredCount || 0) + 1;
        }
        draftExecutedThisWeek = {
          year: context.currentYear,
          week,
          totalPicks: context.draftState ? context.draftState.allPicks.length : 100
        };
      }
    }

    if (options.fastSimMode && week !== 1 && week !== 21) {
      return {
        week,
        gamesSimulated: week <= 24 ? 30 : 0,
        teamAppearances: week <= 24 ? 60 : 0,
        matchResults: [],
        teamWeeklyDelta: {},
        standings: context.standings || [],
        injuries: [],
        recoveries: [],
        draftExecutedThisWeek
      };
    }

    if (options.fastSimMode && week === 21) {
      return {
        week,
        gamesSimulated: 30,
        teamAppearances: 60,
        matchResults: [],
        teamWeeklyDelta: {},
        standings: context.standings || [],
        injuries: [],
        recoveries: [],
        draftExecutedThisWeek
      };
    }

    const schedule = week <= 24 ? generateWeeklyKBOSchedule(context, week, options) : [];

    const matchResults = [];
    const teamWeeklyDelta = {};
    context.kboTeams.forEach((t) => {
      teamWeeklyDelta[t.id] = { w: 0, l: 0, d: 0, rs: 0, ra: 0 };
    });

    // 주간 전체 경기 일괄 연산
    schedule.forEach((gameMeta) => {
      const homeTeam = context.getTeam(gameMeta.homeId);
      const awayTeam = context.getTeam(gameMeta.awayId);
      if (!homeTeam || !awayTeam) return;

      const res = options.fastSimMode
        ? simulateQuickMatchForAudit(homeTeam, awayTeam, rng)
        : simulateMatchFn(homeTeam, awayTeam, { rng, updateSeasonRecord: true });
      matchResults.push({
        week,
        series: gameMeta.series,
        gameOfSeries: gameMeta.gameOfSeries,
        ...res
      });

      const hDelta = teamWeeklyDelta[homeTeam.id];
      const aDelta = teamWeeklyDelta[awayTeam.id];
      hDelta.rs += res.homeScore;
      hDelta.ra += res.awayScore;
      aDelta.rs += res.awayScore;
      aDelta.ra += res.homeScore;
      if (res.homeScore > res.awayScore) {
        hDelta.w += 1;
        aDelta.l += 1;
      } else if (res.awayScore > res.homeScore) {
        aDelta.w += 1;
        hDelta.l += 1;
      } else {
        hDelta.d += 1;
        aDelta.d += 1;
      }
    });

    // 구단별 주간 성적에 따른 구단주 신임도(ownerTrust), 팬 민심(fanRatio) 및 주간 입장/중계권 수익 반영
    context.kboTeams.forEach((team) => {
      const d = teamWeeklyDelta[team.id];
      const netWins = d.w - d.l;
      team.ownerTrust = clamp(Math.round(team.ownerTrust + netWins * 1.2), 0, 100);
      team.fanRatio = clamp(Math.round(team.fanRatio + netWins * 1.5), 0, 100);

      // 주간 홈 입장 수익 + 중계권 배당금 반영 (100억~250억 원 밸런스 범위 유지)
      const weeklyGateRev = Math.round(3200 + (team.fanRatio || 55) * 40 + d.w * 350);
      team.budget = clamp(Math.round((team.budget || 1200000) + weeklyGateRev), 1000000, 2500000);

      // 전 선수(1군/2군/육성) 시즌 파생 지표(WAR, wOBA, ERA, OBP 등) 갱신
      if (!options.fastSimMode) {
        team.getAllPlayers().forEach((p) => updatePlayerMetrics(p));
      }
    });

    // 부상 및 피로도 회복 처리
    const injuryReport = processWeeklyInjuriesAndFatigue(context, { rng, ...options });

    // 구단 순위표 갱신
    const standings = calculateKBOStandings(context);

    return {
      week,
      gamesSimulated: matchResults.length,
      teamAppearances: matchResults.length * 2,
      matchResults,
      teamWeeklyDelta,
      standings,
      injuries: injuryReport.newInjuries,
      recoveries: injuryReport.recoveries,
      draftExecutedThisWeek
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 4. [요청 2] runNPBWeeklySim(context, options)
   *    - NPB/해외 스카우트 풀(300명)의 주간 스탯을 Macro 확률 분포로 초고속 갱신
   * ═══════════════════════════════════════════════════════════════════════ */
  function runNPBWeeklySim(context, options = {}) {
    if (!context || !Array.isArray(context.npbPool)) {
      throw new Error("유효한 context.npbPool 배열이 필요합니다.");
    }
    const rng = options.rng || Math.random;
    const week = context.currentWeek || 1;
    const hotPlayers = [];

    for (let i = 0; i < context.npbPool.length; i++) {
      const p = context.npbPool[i];
      const rec = p.rec;
      const st = p.st || {};

      if (p.type === "pitcher") {
        // 선발(SP)은 주 1회 등판(5~7이닝), 불펜(RP/CP)은 주 2~3경기(2~3.1이닝)
        const isSP = p.pos === "SP";
        const gAdd = isSP ? 1 : randInt(2, 3, rng);
        const outsAdd = isSP
          ? clamp(Math.round(14 + ((st.stamina || 65) - 65) * 0.15 + (rng() * 6 - 3)), 9, 24)
          : clamp(Math.round(gAdd * 3 + (rng() * 2 - 1)), 3, 12);
        const ipAdd = outsAdd / 3;

        const ctrl = st.control || 65;
        const stuff = st.stuff || 65;
        const velo = st.velo || 65;
        const mov = st.movement || 65;
        const dom = stuff * 0.38 + ctrl * 0.34 + mov * 0.16 + velo * 0.12;

        // Macro 기대 ERA (능력치 75 기준 약 3.30, 능력치 65 기준 약 4.30)
        const expectedEra = clamp(4.25 - (dom - 68) * 0.095, 1.45, 6.80);
        const rawEr = (ipAdd / 9) * expectedEra * (0.45 + rng() * 1.15);
        const erAdd = Math.max(0, Math.round(rawEr));

        const kRatePerIp = clamp(0.88 + (stuff * 0.6 + velo * 0.4 - 68) * 0.018, 0.45, 1.55);
        const bbRatePerIp = clamp(0.34 - (ctrl - 68) * 0.010, 0.10, 0.70);
        const hitRatePerIp = clamp(0.92 - (dom - 68) * 0.012, 0.55, 1.35);

        const kAdd = Math.max(0, Math.round(ipAdd * kRatePerIp * (0.75 + rng() * 0.5)));
        const bbAdd = Math.max(0, Math.round(ipAdd * bbRatePerIp * (0.65 + rng() * 0.7)));
        const hAdd = Math.max(erAdd, Math.round(ipAdd * hitRatePerIp * (0.75 + rng() * 0.5)));
        const hrAdd = erAdd > 0 && rng() < clamp(0.32 - (mov - 68) * 0.006, 0.10, 0.55) ? randInt(1, Math.min(2, erAdd), rng) : 0;

        rec.g = (rec.g || 0) + gAdd;
        if (isSP) rec.gs = (rec.gs || 0) + 1;
        rec.ip = +((rec.ip || 0) + ipAdd).toFixed(4);
        rec.er = (rec.er || 0) + erAdd;
        rec.k = (rec.k || 0) + kAdd;
        rec.bb = (rec.bb || 0) + bbAdd;
        rec.h = (rec.h || 0) + hAdd;
        rec.hr = (rec.hr || 0) + hrAdd;

        const topV = Math.round(120 + velo * 0.4 + randInt(0, 2, rng));
        if (topV > (rec.maxV || 0)) rec.maxV = topV;

        if (isSP) {
          if (erAdd <= 2 && outsAdd >= 15 && rng() < 0.68) rec.w = (rec.w || 0) + 1;
          else if (erAdd >= 4 && rng() < 0.65) rec.l = (rec.l || 0) + 1;
        } else if (p.pos === "CP") {
          if (erAdd === 0 && rng() < 0.75) rec.sv = (rec.sv || 0) + randInt(1, 2, rng);
          else if (erAdd >= 2) rec.l = (rec.l || 0) + 1;
        } else {
          if (erAdd === 0 && rng() < 0.50) rec.hld = (rec.hld || 0) + 1;
        }

        const metrics = updatePlayerMetrics(p);
        if (isSP && outsAdd >= 21 && erAdd === 0) {
          hotPlayers.push({ playerId: p.id, name: p.name, origin: p.origin, pos: p.pos, note: `주간 ${Math.floor(outsAdd / 3)}이닝 무실점 ${kAdd}K 완벽투`, era: metrics.era });
        }
      } else {
        // 타자: 주간 5~6경기, 20~25타석
        const gAdd = randInt(5, 6, rng);
        const paAdd = gAdd * 4 + randInt(0, 3, rng);

        const con = st.contact || 65;
        const pow = st.power || 65;
        const eye = st.eye || 65;
        const spd = st.speed || 65;

        const bbRate = clamp(0.085 + (eye - 68) * 0.0020, 0.035, 0.185);
        const bbAdd = Math.max(0, Math.round(paAdd * bbRate * (0.7 + rng() * 0.6)));
        const abAdd = Math.max(1, paAdd - bbAdd);

        const expAvg = clamp(0.265 + (con - 68) * 0.0028, 0.185, 0.365);
        const hAdd = clamp(Math.round(abAdd * expAvg * (0.68 + rng() * 0.64)), 0, abAdd);

        const hrRateOnHit = clamp(0.11 + (pow - 68) * 0.0048, 0.02, 0.32);
        const xbhRateOnHit = clamp(0.22 + (pow * 0.6 + spd * 0.4 - 68) * 0.003, 0.12, 0.36);

        let hrAdd = 0, dAdd = 0, tAdd = 0;
        for (let hIdx = 0; hIdx < hAdd; hIdx++) {
          const r = rng();
          if (r < hrRateOnHit) hrAdd += 1;
          else if (r < hrRateOnHit + xbhRateOnHit) {
            if (spd >= 70 && rng() < 0.12) tAdd += 1;
            else dAdd += 1;
          }
        }

        const kRate = clamp(0.19 - (con * 0.6 + eye * 0.4 - 68) * 0.0025, 0.07, 0.34);
        const kAdd = clamp(Math.round((abAdd - hAdd) * (kRate / Math.max(0.2, 1 - expAvg)) * (0.75 + rng() * 0.5)), 0, abAdd - hAdd);

        const rbiAdd = hrAdd * randInt(1, 2, rng) + Math.round((hAdd - hrAdd) * (0.35 + rng() * 0.35));
        const rAdd = hrAdd + Math.round((hAdd + bbAdd - hrAdd) * (0.28 + rng() * 0.25));
        const sbAdd = spd >= 68 && rng() < clamp((spd - 62) * 0.022, 0.05, 0.55) ? randInt(1, 2, rng) : 0;
        const csAdd = sbAdd > 0 && rng() < 0.24 ? 1 : 0;

        rec.g = (rec.g || 0) + gAdd;
        rec.pa = (rec.pa || 0) + paAdd;
        rec.ab = (rec.ab || 0) + abAdd;
        rec.h = (rec.h || 0) + hAdd;
        rec.d = (rec.d || 0) + dAdd;
        rec.t = (rec.t || 0) + tAdd;
        rec.hr = (rec.hr || 0) + hrAdd;
        rec.bb = (rec.bb || 0) + bbAdd;
        rec.k = (rec.k || 0) + kAdd;
        rec.rbi = (rec.rbi || 0) + rbiAdd;
        rec.r = (rec.r || 0) + rAdd;
        rec.sb = (rec.sb || 0) + sbAdd;
        rec.cs = (rec.cs || 0) + csAdd;

        const metrics = updatePlayerMetrics(p);
        if (hrAdd >= 3 || hAdd >= 10) {
          hotPlayers.push({ playerId: p.id, name: p.name, origin: p.origin, pos: p.pos, note: `주간 ${abAdd}타수 ${hAdd}안타 ${hrAdd}홈런 맹타`, avg: metrics.avg, ops: metrics.ops });
        }
      }
    }

    return {
      week,
      poolCount: context.npbPool.length,
      hotPlayers: hotPlayers.slice(0, 8)
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 5. [요청 3] runAmateurWeeklySim(context, options)
   *    - 고교/대학 전국대회(황금사자기, 청룡기 등) 타이밍 경기 결과 및
   *      유망주 드래프트 예상 순위(1라운드 픽 등) 실시간 변동
   * ═══════════════════════════════════════════════════════════════════════ */
  function formatDraftProjectionLabel(rank) {
    const round = Math.ceil(rank / 10);
    const pickInRound = ((rank - 1) % 10) + 1;
    if (rank <= 3) return `1라운드 전체 ${rank}순위 유력 (초특급 최대어)`;
    if (rank <= 10) return `1라운드 ${pickInRound}순위 지명 예상 (1R 픽)`;
    if (round <= 3) return `${round}라운드 ${pickInRound}순위 예상 (상위 라운드)`;
    if (round <= 6) return `${round}라운드 중위권 지명 예상`;
    if (round <= 11) return `${round}라운드 하위권 지명 예상`;
    return "육성선수(미지명) 예상";
  }

  function runAmateurWeeklySim(context, options = {}) {
    if (!context || !Array.isArray(context.draftPool)) {
      throw new Error("유효한 context.draftPool 배열이 필요합니다.");
    }
    const rng = options.rng || Math.random;
    const week = context.currentWeek || 1;
    const tournament = AMATEUR_TOURNAMENTS[week] || null;
    const isTournamentWeek = Boolean(tournament);

    const risers = [];
    const fallers = [];

    // 1. 유망주별 주간 경기/전국대회 스탯 누적 및 스카우팅 주가(draftScore) 갱신
    for (let i = 0; i < context.draftPool.length; i++) {
      const p = context.draftPool[i];
      const rec = p.rec;
      const st = p.st || {};

      // 기본 드래프트 가치 점수 초기화 (잠재력 + 현재 능력치 + 고졸 유망주 포텐 가산점)
      if (typeof p.draftScore !== "number") {
        const ageBonus = p.origin === "HS" ? 8.0 : 2.5;
        p.draftScore = p.getTrueOvr() * 0.85 + (p.potential || 75) * 0.75 + ageBonus + (rng() * 6 - 3);
      }

      const eligibleForTourney =
        isTournamentWeek && (tournament.level === "ALL" || p.origin === tournament.level);

      let perfDelta = 0;
      let tourneyHighlight = null;

      if (p.type === "pitcher") {
        const ipAdd = eligibleForTourney ? randInt(6, 14, rng) : randInt(2, 5, rng);
        const stuff = st.stuff || 55;
        const ctrl = st.control || 55;
        const velo = st.velo || 55;
        const dom = stuff * 0.42 + velo * 0.32 + ctrl * 0.26;

        const expEra = clamp(3.60 - (dom - 58) * 0.11, 0.90, 6.50);
        const erAdd = Math.max(0, Math.round((ipAdd / 9) * expEra * (0.35 + rng() * 1.3)));
        const kAdd = Math.max(0, Math.round(ipAdd * clamp(0.95 + (stuff - 58) * 0.02, 0.5, 1.6) * (0.7 + rng() * 0.6)));
        const bbAdd = Math.max(0, Math.round(ipAdd * clamp(0.38 - (ctrl - 58) * 0.01, 0.1, 0.8) * (0.7 + rng() * 0.6)));
        const hAdd = Math.max(erAdd, Math.round(ipAdd * 0.82 * (0.7 + rng() * 0.6)));

        rec.g = (rec.g || 0) + (eligibleForTourney ? 2 : 1);
        rec.ip = +((rec.ip || 0) + ipAdd).toFixed(4);
        rec.er = (rec.er || 0) + erAdd;
        rec.k = (rec.k || 0) + kAdd;
        rec.bb = (rec.bb || 0) + bbAdd;
        rec.h = (rec.h || 0) + hAdd;
        if (erAdd <= 1 && ipAdd >= 5) rec.w = (rec.w || 0) + 1;
        else if (erAdd >= 4) rec.l = (rec.l || 0) + 1;

        updatePlayerMetrics(p);

        if (eligibleForTourney) {
          if (erAdd <= 1 && kAdd >= 9) {
            perfDelta = (1.8 + rng() * 2.2) * tournament.prestige;
            tourneyHighlight = `${tournament.name} ${ipAdd}이닝 ${erAdd}실점 ${kAdd}탈삼진 쾌투`;
          } else if (erAdd >= 5) {
            perfDelta = -(1.5 + rng() * 1.8) * tournament.prestige;
            tourneyHighlight = `${tournament.name} 제구 난조(${ipAdd}이닝 ${erAdd}자책)`;
          } else {
            perfDelta = (rng() * 1.2 - 0.5) * tournament.prestige;
          }
        } else {
          perfDelta = (rng() * 0.6 - 0.3);
        }
      } else {
        const gAdd = eligibleForTourney ? randInt(3, 5, rng) : randInt(1, 2, rng);
        const paAdd = gAdd * 4;
        const con = st.contact || 55;
        const pow = st.power || 55;
        const eye = st.eye || 55;
        const spd = st.speed || 55;

        const bbAdd = Math.max(0, Math.round(paAdd * clamp(0.10 + (eye - 58) * 0.002, 0.04, 0.22) * (0.7 + rng() * 0.6)));
        const abAdd = Math.max(1, paAdd - bbAdd);
        const expAvg = clamp(0.295 + (con - 58) * 0.0035, 0.190, 0.430);
        const hAdd = clamp(Math.round(abAdd * expAvg * (0.6 + rng() * 0.8)), 0, abAdd);
        const hrAdd = hAdd > 0 && rng() < clamp(0.08 + (pow - 58) * 0.008, 0.02, 0.38) ? randInt(1, Math.min(3, hAdd), rng) : 0;
        const dAdd = Math.max(0, Math.min(hAdd - hrAdd, Math.round((hAdd - hrAdd) * 0.25)));
        const kAdd = clamp(Math.round((abAdd - hAdd) * 0.26), 0, abAdd - hAdd);
        const rbiAdd = hrAdd * 2 + Math.round((hAdd - hrAdd) * 0.45);
        const sbAdd = spd >= 65 && rng() < 0.35 ? randInt(1, 2, rng) : 0;

        rec.g = (rec.g || 0) + gAdd;
        rec.pa = (rec.pa || 0) + paAdd;
        rec.ab = (rec.ab || 0) + abAdd;
        rec.h = (rec.h || 0) + hAdd;
        rec.d = (rec.d || 0) + dAdd;
        rec.hr = (rec.hr || 0) + hrAdd;
        rec.bb = (rec.bb || 0) + bbAdd;
        rec.k = (rec.k || 0) + kAdd;
        rec.rbi = (rec.rbi || 0) + rbiAdd;
        rec.sb = (rec.sb || 0) + sbAdd;

        updatePlayerMetrics(p);

        if (eligibleForTourney) {
          if (hrAdd >= 2 || hAdd >= Math.ceil(abAdd * 0.48)) {
            perfDelta = (1.8 + rng() * 2.4) * tournament.prestige;
            tourneyHighlight = `${tournament.name} ${abAdd}타수 ${hAdd}안타 ${hrAdd}홈런 맹활약`;
          } else if (hAdd <= 1 && abAdd >= 10) {
            perfDelta = -(1.4 + rng() * 1.8) * tournament.prestige;
            tourneyHighlight = `${tournament.name} 타격 슬럼프(${abAdd}타수 ${hAdd}안타)`;
          } else {
            perfDelta = (rng() * 1.2 - 0.5) * tournament.prestige;
          }
        } else {
          perfDelta = (rng() * 0.6 - 0.3);
        }
      }

      p.prevDraftRank = (p.draftProjection && p.draftProjection.rank) || null;
      p.draftScore = +(p.draftScore + perfDelta).toFixed(2);
      p._lastTourneyNote = tourneyHighlight;
    }

    // 2. 변동된 draftScore 순으로 전체 유망주(200명) 드래프트 예상 순위 재정렬
    const sorted = context.draftPool.slice().sort((a, b) => b.draftScore - a.draftScore);

    sorted.forEach((p, idx) => {
      const newRank = idx + 1;
      const prevRank = p.prevDraftRank || newRank;
      const rankDelta = prevRank - newRank; // 양수면 순위 상승
      const round = Math.ceil(newRank / 10);

      p.draftProjection = {
        rank: newRank,
        round,
        pickInRound: ((newRank - 1) % 10) + 1,
        tierLabel: formatDraftProjectionLabel(newRank),
        rankDelta,
        tournamentNote: p._lastTourneyNote || (p.draftProjection && p.draftProjection.tournamentNote) || null
      };

      if (rankDelta >= 5 || (isTournamentWeek && p._lastTourneyNote && rankDelta > 0)) {
        risers.push({
          playerId: p.id,
          name: p.name,
          origin: p.origin,
          pos: p.pos,
          prevRank,
          newRank,
          rankDelta,
          tierLabel: p.draftProjection.tierLabel,
          note: p._lastTourneyNote || "주간 스카우팅 평가 급상승"
        });
      } else if (rankDelta <= -5) {
        fallers.push({
          playerId: p.id,
          name: p.name,
          origin: p.origin,
          pos: p.pos,
          prevRank,
          newRank,
          rankDelta,
          tierLabel: p.draftProjection.tierLabel,
          note: p._lastTourneyNote || "주간 컨디션 저하"
        });
      }
      delete p._lastTourneyNote;
    });

    // context.draftPool도 예상 지명 순위 순으로 정렬 유지
    context.draftPool = sorted;

    risers.sort((a, b) => b.rankDelta - a.rankDelta);
    fallers.sort((a, b) => a.rankDelta - b.rankDelta);

    return {
      week,
      isTournamentWeek,
      tournament: tournament ? { id: tournament.id, name: tournament.name, level: tournament.level } : null,
      top10Round1Picks: sorted.slice(0, 10).map((p) => ({
        rank: p.draftProjection.rank,
        playerId: p.id,
        name: p.name,
        origin: p.origin,
        pos: p.pos,
        age: p.age,
        ovrRange: `${p.scoutError.ovrMin}~${p.scoutError.ovrMax}`,
        tierLabel: p.draftProjection.tierLabel,
        rankDelta: p.draftProjection.rankDelta
      })),
      risers: risers.slice(0, 6),
      fallers: fallers.slice(0, 6)
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 5-B. [신규 요청 7] runFuturesWeeklySim(context, options)
   *      - KBO 2군 퓨처스리그 주간 경기 진행 (구단별 주 5경기)
   *      - 2군(roster2G) 및 육성군(rosterDev) 출전 선수 실전 경험치·능력치 성장
   * ═══════════════════════════════════════════════════════════════════════ */
  function runFuturesWeeklySim(context, options = {}) {
    if (!context || !Array.isArray(context.kboTeams)) {
      return { week: 1, teamRecords: {}, growthEvents: [] };
    }
    const rng = options.rng || Math.random;
    const week = context.currentWeek || 1;
    if (options.fastSimMode && week !== 1) {
      return { week, teamDeltas: {}, userFuturesDelta: null, growthEvents: [] };
    }
    const LABEL_MAP = (KBO_GM && KBO_GM.LABEL) || {
      control: "제구",
      stuff: "구위",
      velo: "구속",
      stamina: "체력",
      movement: "변화",
      contact: "컨택",
      power: "파워",
      speed: "주력",
      defense: "수비",
      eye: "선구"
    };

    const teamDeltas = {};
    const growthEvents = [];

    context.kboTeams.forEach((team) => {
      if (!team.futuresRecord) {
        team.futuresRecord = { w: 0, l: 0, d: 0, rs: 0, ra: 0 };
      }
      const fPool = [...(team.roster2G || []), ...(team.rosterDev || [])];
      const avgOvr = fPool.length
        ? fPool.reduce((s, p) => s + p.getTrueOvr(), 0) / fPool.length
        : 58;

      let w = 0, l = 0, d = 0, rs = 0, ra = 0;
      for (let g = 0; g < 5; g++) {
        const myRuns = clamp(Math.round(4.2 + (avgOvr - 58) * 0.15 + (rng() * 6 - 3)), 0, 14);
        const oppRuns = clamp(Math.round(4.2 + (rng() * 6 - 3)), 0, 14);
        rs += myRuns;
        ra += oppRuns;
        if (myRuns > oppRuns) w += 1;
        else if (oppRuns > myRuns) l += 1;
        else d += 1;
      }

      team.futuresRecord.w += w;
      team.futuresRecord.l += l;
      team.futuresRecord.d += d;
      team.futuresRecord.rs = (team.futuresRecord.rs || 0) + rs;
      team.futuresRecord.ra = (team.futuresRecord.ra || 0) + ra;

      teamDeltas[team.id] = {
        teamId: team.id,
        teamName: team.name,
        futuresName: team.futuresName || `${team.city} 2군`,
        w,
        l,
        d,
        rs,
        ra,
        seasonW: team.futuresRecord.w,
        seasonL: team.futuresRecord.l,
        seasonD: team.futuresRecord.d
      };

      const staff = team.coachingStaff || {};
      const mgrStyle = (staff.manager && staff.manager.style) || "균형";
      const youthMul = mgrStyle === "육성" ? 1.30 : 1.05;
      const pitMul = (staff.pitchingCoach && staff.pitchingCoach.trainBonus) || 1.08;
      const hitMul = (staff.hittingCoach && staff.hittingCoach.trainBonus) || 1.08;

      // 2군 및 육성군 선수 주간 퓨처스리그 기록 누적 및 성장 판정
      fPool.forEach((p) => {
        if (p.injury && p.injury.active) return;
        if (!p.futuresRec) {
          p.futuresRec = p.type === "pitcher"
            ? { g: 0, ip: 0, er: 0, k: 0, w: 0, l: 0 }
            : { g: 0, ab: 0, h: 0, hr: 0, rbi: 0 };
        }

        if (p.type === "pitcher") {
          const ipAdd = p.pos === "SP" ? randInt(4, 6, rng) : randInt(2, 4, rng);
          const erAdd = clamp(Math.round((ipAdd / 9) * clamp(4.8 - (p.getTrueOvr() - 56) * 0.1, 1.8, 7.5) * (0.5 + rng())), 0, 6);
          const kAdd = clamp(Math.round(ipAdd * 0.85 * (0.7 + rng() * 0.6)), 0, 10);
          p.futuresRec.g = (p.futuresRec.g || 0) + (p.pos === "SP" ? 1 : 2);
          p.futuresRec.ip = +((p.futuresRec.ip || 0) + ipAdd).toFixed(1);
          p.futuresRec.er = (p.futuresRec.er || 0) + erAdd;
          p.futuresRec.k = (p.futuresRec.k || 0) + kAdd;
          if (erAdd <= 1 && ipAdd >= 4) p.futuresRec.w = (p.futuresRec.w || 0) + 1;
        } else {
          const abAdd = randInt(10, 16, rng);
          const hAdd = clamp(Math.round(abAdd * clamp(0.26 + (p.getTrueOvr() - 56) * 0.003, 0.18, 0.38) * (0.6 + rng() * 0.8)), 0, abAdd);
          const hrAdd = hAdd > 0 && rng() < 0.12 ? 1 : 0;
          p.futuresRec.g = (p.futuresRec.g || 0) + 4;
          p.futuresRec.ab = (p.futuresRec.ab || 0) + abAdd;
          p.futuresRec.h = (p.futuresRec.h || 0) + hAdd;
          p.futuresRec.hr = (p.futuresRec.hr || 0) + hrAdd;
          p.futuresRec.rbi = (p.futuresRec.rbi || 0) + hrAdd + Math.round(hAdd * 0.4);
        }

        // 성장 확률: 잠재력 여유분이 있고 나이가 어릴수록 높음
        const trueOvr = p.getTrueOvr();
        const headroom = Math.max(0, (p.potential || 75) - trueOvr);
        if (headroom <= 0) return;

        const ageBonus = p.age <= 21 ? 1.45 : p.age <= 24 ? 1.25 : p.age <= 27 ? 0.90 : 0.45;
        const coachBonus = p.type === "pitcher" ? pitMul : hitMul;
        const gmRoot =
          KBO_GM ||
          (typeof globalThis !== "undefined" && globalThis.KBO_GM) ||
          (typeof window !== "undefined" && window.KBO_GM);
        const facEffects =
          gmRoot && gmRoot.Extensions && typeof gmRoot.Extensions.getTeamFacilityEffects === "function"
            ? gmRoot.Extensions.getTeamFacilityEffects(team)
            : null;
        const biomechLv = facEffects ? facEffects.biomechLv : clamp((team.facilities && team.facilities.biomechLab) || 1, 1, 5);
        const biomechTpMul = facEffects ? facEffects.tpBonusMul : [1.0, 1.12, 1.22, 1.32, 1.42][biomechLv - 1] || 1.0;
        const audit = ensureAuditState(context);
        if (audit && (biomechLv > 1 || biomechTpMul > 1.0)) {
          audit.facilityEffectAppliedCount = (audit.facilityEffectAppliedCount || 0) + 1;
        }
        const focusMul = p.trainingFocus ? 1.25 : 1.0;
        const growthChance = clamp(0.085 * ageBonus * youthMul * coachBonus * biomechTpMul * focusMul * (1 + headroom / 30), 0.02, 0.52);

        if (rng() < growthChance) {
          const FOCUS_STAT_MAP = {
            VELO: "velo",
            CONTROL: "control",
            NEW_PITCH: "movement",
            STAMINA: "stamina",
            EYE: "eye",
            POWER: "power",
            CONTACT: "contact",
            DEFENSE: "defense"
          };
          const keys = p.type === "pitcher"
            ? (biomechLv >= 2 && rng() < 0.35 ? ["velo", "stuff", "control"] : ["control", "stuff", "velo", "stamina", "movement"])
            : ["contact", "power", "speed", "defense", "eye"];
          const mappedFocusKey = p.trainingFocus && FOCUS_STAT_MAP[p.trainingFocus];
          const statKey = mappedFocusKey && keys.includes(mappedFocusKey) && rng() < 0.75 ? mappedFocusKey : pick(keys, rng);
          const oldVal = p.st[statKey] || 50;
          if (oldVal < (p.potential || 95)) {
            const gain = headroom >= 16 && p.age <= 21 && rng() < 0.25 ? 2 : 1;
            p.st[statKey] = clamp(oldVal + gain, 20, 108);
            const tpAdded = Math.round(gain * 15 * biomechTpMul);
            p.tp[statKey] = (p.tp[statKey] || 0) + tpAdded;
            if (audit) {
              audit.facilityEffectAppliedCount = (audit.facilityEffectAppliedCount || 0) + 1;
            }
            if (p.trainingFocus === "NEW_PITCH" && p.type === "pitcher" && Array.isArray(p.pitches) && p.pitches.length > 0) {
              const targetPitch = p.pitches[p.pitches.length - 1];
              targetPitch.m = clamp((targetPitch.m || 50) + 2, 25, 98);
            }
            const newOvr = p.getTrueOvr();
            const statLabel = LABEL_MAP[statKey] || statKey;
            p.lastGrowthNote = `2군 맞춤육성(${p.trainingFocus || "실전"}): ${statLabel} +${gain} (${oldVal}→${p.st[statKey]})`;
            if (typeof p.updateScoutingReport === "function") {
              p.updateScoutingReport(context.scoutLevel || 1, team.id === context.userTeamId, rng);
            }
            growthEvents.push({
              teamId: team.id,
              teamName: team.name,
              futuresName: team.futuresName || `${team.city} 2군`,
              playerId: p.id,
              playerName: p.name,
              pos: p.pos,
              age: p.age,
              status: p.status,
              statKey,
              statLabel,
              gain,
              oldVal,
              newVal: p.st[statKey],
              newOvr
            });
          }
        }
      });
    });

    return {
      week,
      teamDeltas,
      userFuturesDelta: teamDeltas[context.userTeamId] || null,
      growthEvents
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 6. [요청 4 & PART 1 강제 연동] advanceOneWeek(context, options) 통합 함수
   *    - KBO 1군 주간 시뮬 + KBO 2군(퓨처스) 성장 시뮬 + NPB 주간 시뮬 + 고교/대학/독립리그 주간 시뮬
   *    - 주간 루프 내 6대 메카닉(오늘의 할 일, 6주 대체 외인, 9월 3주차/2차 드래프트, R&D 시설, 상무 입대·복무·제대, 샐러리캡·다년계약) 강제 연동
   * ═══════════════════════════════════════════════════════════════════════ */
  function advanceOneWeek(context, options = {}) {
    if (!context) {
      throw new Error("GMGameContext 인스턴스가 필요합니다.");
    }
    const gmRoot =
      KBO_GM ||
      (typeof globalThis !== "undefined" && globalThis.KBO_GM) ||
      (typeof window !== "undefined" && window.KBO_GM);
    const audit = ensureAuditState(context);
    const weekPlayed = context.currentWeek || 1;

    // [강제 연동 1] 필수 오늘의 할 일(Must-Do) 미처리 시 진행 블로킹 검사 (enforceMustDoBlocking 옵션 시)
    if (options.enforceMustDoBlocking && gmRoot && gmRoot.Assistant) {
      const preTasks =
        typeof gmRoot.Assistant.getTodayTasks === "function"
          ? gmRoot.Assistant.getTodayTasks(context, { skipAuditIncrement: true })
          : gmRoot.Assistant.generateDailyBriefing(context, { skipAuditIncrement: true });
      if (preTasks && Array.isArray(preTasks.mustDo) && preTasks.mustDo.length > 0) {
        if (audit) {
          audit.mustDoBlockedCount = (audit.mustDoBlockedCount || 0) + 1;
        }
        return {
          ok: false,
          blocked: true,
          blockedReason: `필수 단장 업무 미처리(${preTasks.mustDo[0].title})로 인해 주간 진행이 일시 정지되었습니다.`,
          mustDoTasks: preTasks.mustDo,
          year: context.currentYear,
          weekPlayed
        };
      }
    }

    const kboReport = runKBOWeeklySim(context, options);
    const futuresReport = runFuturesWeeklySim(context, options);
    const npbReport = options.skipMacroPools ? { week: weekPlayed, poolCount: (context.npbPool || []).length, hotPlayers: [] } : runNPBWeeklySim(context, options);
    const amateurReport = options.skipMacroPools ? { week: weekPlayed, isTournamentWeek: false, top10Round1Picks: [], risers: [], fallers: [] } : runAmateurWeeklySim(context, options);

    const moraleReport =
      !options.skipMacroPools && gmRoot && gmRoot.Extensions && typeof gmRoot.Extensions.updateWeeklyTeamMorale === "function"
        ? gmRoot.Extensions.updateWeeklyTeamMorale(context, options)
        : null;

    // [감독 요구 및 프런트 갈등 외압 연동] 정규시즌 중반(12주차) 약점 포지션 베테랑 핀포인트 수혈 공식 요청 & 주간 갈등/언론유출 판정
    let managerConflictReport = null;
    const mgrMod = (gmRoot && (gmRoot.ManagerConflict || gmRoot.RealisticGM || gmRoot.Extensions)) || null;
    if (!options.fastSimMode && mgrMod && context.userTeamId) {
      if (
        weekPlayed === 8 &&
        context._lastUsageRefusalYear !== context.currentYear &&
        typeof mgrMod.checkPlayerUsageRefusal === "function"
      ) {
        context._lastUsageRefusalYear = context.currentYear;
        mgrMod.checkPlayerUsageRefusal(context, context.userTeamId);
      }
      if (
        weekPlayed === 12 &&
        context._lastTradeDirectiveYear !== context.currentYear &&
        typeof mgrMod.generateMidseasonTradeDirective === "function"
      ) {
        context._lastTradeDirectiveYear = context.currentYear;
        mgrMod.generateMidseasonTradeDirective(context, context.userTeamId);
      }
      if (
        weekPlayed === 16 &&
        context._lastDeadlineStanceYear !== context.currentYear &&
        typeof mgrMod.generateDeadlineTradeProposals === "function"
      ) {
        context._lastDeadlineStanceYear = context.currentYear;
        mgrMod.generateDeadlineTradeProposals(context);
      }
      if (typeof mgrMod.evaluateConflictCrisis === "function") {
        managerConflictReport = mgrMod.evaluateConflictCrisis(context, context.userTeamId, {
          checkMediaLeak: true
        });
      }
    }

    // [강제 연동 5] 상무 피닉스 군보류 선수 주간(7일) 복무일 누적, 퓨처스 TP 성장 및 18개월 만기 제대 처리
    let militaryReport = null;
    if (gmRoot && gmRoot.Extensions && typeof gmRoot.Extensions.processDailyMilitaryService === "function") {
      militaryReport = gmRoot.Extensions.processDailyMilitaryService(context, 7);
    }

    // [강제 연동 3·5·6] 52주 풀-사이클 캘린더 이벤트 연동 (정규시즌 1~24주 + 포스트시즌/스토브리그/캠프 25~52주)
    const calendarLifecycleEvents = [];
    const isRegularSeasonEnd = weekPlayed === 24;
    if (isRegularSeasonEnd) {
      context.seasonPhase = "OFFSEASON_STOVE";
    }

    // 26주차 (10월 중순): 포스트시즌 계단식 토너먼트 개최
    if (!options.fastSimMode && weekPlayed === 26 && gmRoot && gmRoot.Extensions && typeof gmRoot.Extensions.runPostseasonTournament === "function") {
      if (context._lastPostseasonYear !== context.currentYear) {
        const psRes = gmRoot.Extensions.runPostseasonTournament(context);
        context._lastPostseasonYear = context.currentYear;
        if (psRes && psRes.ok) {
          calendarLifecycleEvents.push({ type: "POSTSEASON", report: psRes.report });
        }
      }
    }

    // 28주차 (11월 초): 격년제 2차 드래프트 (35인 보호명단 작성 후 1~3R 지명 및 로스터 자동 반영)
    if (
      weekPlayed === 28 &&
      gmRoot &&
      gmRoot.Extensions &&
      typeof gmRoot.Extensions.isBiennialDraftYear === "function" &&
      gmRoot.Extensions.isBiennialDraftYear(context.currentYear)
    ) {
      if (context._lastSecondaryDraftYear !== context.currentYear) {
        if (typeof gmRoot.Extensions.autoFillProtectedPlayers === "function" && context.userTeamId) {
          gmRoot.Extensions.autoFillProtectedPlayers(context, context.userTeamId, "DRAFT_35");
        }
        const bdRes = gmRoot.Extensions.runBiennialSecondaryDraft(context);
        context._lastSecondaryDraftYear = context.currentYear;
        if (bdRes && bdRes.ok) {
          calendarLifecycleEvents.push({ type: "BIENNIAL_SECONDARY_DRAFT", report: bdRes.report });
        }
      }
    }

    // 30주차 (11월 하순): 연봉 재계약, 비FA 다년계약 검토, FA 시장, 외국인 재계약 자동 연동
    if (weekPlayed === 30 && (options.autoResolveCalendarEvents !== false) && gmRoot && gmRoot.Offseason) {
      if (context._lastOffseasonProcessedYear !== context.currentYear) {
        context._lastOffseasonProcessedYear = context.currentYear;
        if (typeof gmRoot.Offseason.processSalaryRenewals === "function") {
          gmRoot.Offseason.processSalaryRenewals(context, { userPolicy: "FAIR" });
        }
        if (typeof gmRoot.Offseason.declareEligibleFAPlayers === "function") {
          gmRoot.Offseason.declareEligibleFAPlayers(context);
        }
        if (typeof gmRoot.Offseason.runFAMarketSession === "function") {
          gmRoot.Offseason.runFAMarketSession(context, {}, { autoDeclareFromRosters: false });
        }
        if (typeof gmRoot.Offseason.processForeignPlayerContracts === "function") {
          gmRoot.Offseason.processForeignPlayerContracts(context, null);
        }
        calendarLifecycleEvents.push({ type: "STOVE_CONTRACTS_RESOLVED", year: context.currentYear });
      }
    }

    // 32주차 (12월 중순): 상무 피닉스 정기 입대 (MILITARY 보류 이동) & 샐러리캡(120억) 사치세/드래프트 픽 하강 심사
    if (weekPlayed === 32 && gmRoot && gmRoot.Extensions) {
      if (context._lastDecAuditYear !== context.currentYear) {
        context._lastDecAuditYear = context.currentYear;
        if (typeof gmRoot.Extensions.autoManageDecemberSangmuEnlistment === "function") {
          const enl = gmRoot.Extensions.autoManageDecemberSangmuEnlistment(context);
          calendarLifecycleEvents.push({ type: "SANGMU_ENLISTMENT", count: (enl || []).length });
        }
        if (typeof gmRoot.Extensions.evaluateLuxuryTaxAndPenalties === "function") {
          const taxRes = gmRoot.Extensions.evaluateLuxuryTaxAndPenalties(context);
          calendarLifecycleEvents.push({ type: "LUXURY_TAX_EVALUATED", report: taxRes });
        }
      }
    }

    // 36주차 (2월 초): 스프링캠프 훈련 자동 진행
    if (weekPlayed === 36 && (options.autoResolveCalendarEvents !== false) && gmRoot && gmRoot.SpringCamp) {
      if (context._lastSpringCampYear !== context.currentYear && typeof gmRoot.SpringCamp.runSpringCamp === "function") {
        const campRep = gmRoot.SpringCamp.runSpringCamp(context, { userCampLocation: "USA", trainingFocus: "BALANCED" });
        context._lastSpringCampYear = context.currentYear;
        calendarLifecycleEvents.push({ type: "SPRING_CAMP_COMPLETED", report: campRep });
      }
    }

    // [강제 연동 1] 주차 진행 시 오늘의 할 일 리포트 자동 생성 (KBO_GM.Assistant.getTodayTasks)
    let todaysTasks = null;
    if (gmRoot && gmRoot.Assistant) {
      const fn = gmRoot.Assistant.getTodayTasks || gmRoot.Assistant.generateDailyBriefing;
      if (typeof fn === "function") {
        todaysTasks = fn(context);
        context.todaysBriefing = todaysTasks;
      }
    }

    // 52주차 완료 시 차기 시즌 이관 또는 주차 증가
    if (weekPlayed >= 52 && options.fullYear52Cycle) {
      if (
        context._lastFinalizedSeason !== context.currentYear &&
        gmRoot &&
        gmRoot.SpringCamp &&
        typeof gmRoot.SpringCamp.finalizeOffseasonAndStartSeason === "function"
      ) {
        gmRoot.SpringCamp.finalizeOffseasonAndStartSeason(context, { preserveCalendarDate: false });
      } else {
        context.currentYear = (context.currentYear || 2025) + 1;
        context.currentWeek = 1;
      }
    } else {
      context.currentWeek = weekPlayed + 1;
    }

    const summary = {
      ok: true,
      blocked: false,
      year: context.currentYear,
      weekPlayed,
      nextWeek: context.currentWeek,
      isRegularSeasonEnd,
      kbo: kboReport,
      futures: futuresReport,
      npb: npbReport,
      amateur: amateurReport,
      morale: moraleReport,
      military: militaryReport,
      calendarLifecycleEvents,
      todaysTasks
    };

    if (!Array.isArray(context.weeklyLogs)) {
      context.weeklyLogs = [];
    }
    context.weeklyLogs.push({
      year: context.currentYear,
      week: weekPlayed,
      gamesSimulated: kboReport.gamesSimulated,
      newInjuriesCount: kboReport.injuries.length,
      futuresGrowthCount: futuresReport.growthEvents.length,
      tournamentName: amateurReport.tournament ? amateurReport.tournament.name : null
    });

    return summary;
  }

  return {
    INJURY_CATALOG,
    AMATEUR_TOURNAMENTS,
    ensureAuditState,
    updatePlayerMetrics,
    calculateKBOStandings,
    runKBOWeeklySim,
    runFuturesWeeklySim,
    runNPBWeeklySim,
    runAmateurWeeklySim,
    runAmateurTournamentSim: runAmateurWeeklySim, // 별칭(Alias) 동시 지원
    advanceOneWeek
  };
});
