/**
 * KBO 단장 모드 (v1.0) — Step 1-2: Pure 경기 시뮬레이터 모듈 (simulateMatch)
 * 기반 엔진: 나만의 야구 선수 만들기 v16.8 투타 확률 연산 · 파크팩터 · 날씨 · 체력/불펜 교체 공식
 * 실행 환경: Client-Side Standalone (window.KBO_GM.simulateMatch) & Node/CommonJS 호환
 */

(function (root, factory) {
  const simApi = factory(root.KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM));
  if (typeof globalThis !== "undefined") {
    globalThis.KBO_GM = Object.assign(globalThis.KBO_GM || {}, simApi);
  }
  if (typeof window !== "undefined") {
    window.KBO_GM = Object.assign(window.KBO_GM || {}, simApi);
  }
  if (typeof module === "object" && module.exports) {
    module.exports = simApi;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function (KBO_GM) {
  "use strict";

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const kmh = (veloStat) => Math.round(120 + (veloStat || 50) * 0.4);
  const fmtIP = (outs) => `${Math.floor(outs / 3)}.${outs % 3}`;

  // v16.8 날씨 테이블
  const WEATHER_PRESETS = {
    clear: { k: "clear", n: "맑음",        hr: 1.00, ctrl: 0,  fat: 1.00 },
    hot:   { k: "hot",   n: "폭염",        hr: 1.08, ctrl: 0,  fat: 1.35 },
    cold:  { k: "cold",  n: "쌀쌀함",      hr: 0.92, ctrl: -2, fat: 1.00 },
    tail:  { k: "tail",  n: "외야 뒷바람", hr: 1.14, ctrl: 0,  fat: 1.00 },
    head:  { k: "head",  n: "홈 맞바람",   hr: 0.86, ctrl: 0,  fat: 1.00 },
    rain:  { k: "rain",  n: "이슬비",      hr: 0.94, ctrl: -5, fat: 1.10 },
    dome:  { k: "dome",  n: "돔구장",      hr: 1.00, ctrl: 0,  fat: 1.00 }
  };

  const FIELD_POSITIONS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"];

  /**
   * 1군 로스터에서 선발 라인업(1~9번 타순)과 투수진(SP 1명 + RP/CP 불펜)을 자동 구성
   */
  function buildMatchLineup(team) {
    const roster = (team.roster1G && team.roster1G.length ? team.roster1G : team.getAllPlayers()).filter(
      (p) => !(p.injury && p.injury.active)
    );

    const batters = roster.filter((p) => p.type === "batter");
    const pitchers = roster.filter((p) => p.type === "pitcher");

    // 1. 야수 9명 포지션 배정 (C, 1B, 2B, 3B, SS, LF, CF, RF, DH)
    const usedIds = new Set();
    const assigned = [];

    FIELD_POSITIONS.forEach((pos) => {
      // 해당 포지션 주포지션 선수 우선, 없으면 타격/수비 적합도 순
      let candidates = batters.filter((p) => !usedIds.has(p.id) && p.pos === pos);
      if (!candidates.length) {
        candidates = batters.filter((p) => !usedIds.has(p.id) && (p.subPos || []).includes(pos));
      }
      if (!candidates.length) {
        candidates = batters.filter((p) => !usedIds.has(p.id));
      }
      candidates.sort((a, b) => b.getTrueOvr() - a.getTrueOvr());
      const chosen = candidates[0] || batters[0];
      if (chosen) {
        usedIds.add(chosen.id);
        assigned.push({ player: chosen, fieldPos: pos });
      }
    });

    // 2. v16.8 타순(1~9번) 배치 알고리즘
    // 1번(출루+주력) · 2번(강한2번) · 3번(종합타격) · 4번(장타해결사) · 5번(중심타선) · 6~9번(하위타선)
    const pool = assigned.slice();
    const takeBest = (scoreFn) => {
      pool.sort((a, b) => scoreFn(b.player) - scoreFn(a.player));
      return pool.shift();
    };

    const s1 = takeBest((p) => p.st.contact * 0.35 + p.st.eye * 0.30 + p.st.speed * 0.35);
    const s4 = takeBest((p) => p.st.power * 0.52 + p.st.contact * 0.28 + p.st.eye * 0.20);
    const s3 = takeBest((p) => p.st.contact * 0.38 + p.st.power * 0.38 + p.st.eye * 0.24);
    const s2 = takeBest((p) => p.st.contact * 0.38 + p.st.eye * 0.32 + p.st.speed * 0.18 + p.st.power * 0.12);
    const s5 = takeBest((p) => p.st.power * 0.42 + p.st.contact * 0.35 + p.st.eye * 0.23);

    // 나머지 6~9번은 타격 점수 순
    pool.sort(
      (a, b) =>
        b.player.st.contact * 0.4 + b.player.st.power * 0.35 + b.player.st.eye * 0.25 -
        (a.player.st.contact * 0.4 + a.player.st.power * 0.35 + a.player.st.eye * 0.25)
    );
    const orderedLineup = [s1, s2, s3, s4, s5, ...pool].filter(Boolean);

    // 주전 포수 추출 (포수 블로킹 및 도루 저지 연산용)
    const catcherEntry = orderedLineup.find((x) => x.fieldPos === "C") || orderedLineup[0];
    const catcherDef = catcherEntry ? catcherEntry.player.st.defense || 65 : 65;

    // 3. 투수진 구성: 선발(SP) 1명 + 마무리(CP) 1명 + 셋업/추격조(RP)
    const spPool = pitchers.filter((p) => p.pos === "SP");
    spPool.sort((a, b) => (b.getTrueOvr() - (b.fatigue || 0) * 0.45) - (a.getTrueOvr() - (a.fatigue || 0) * 0.45));
    const starter = spPool[0] || pitchers[0];

    const relievers = pitchers.filter((p) => p.pos !== "SP" && p.id !== (starter && starter.id));
    const bullpenPool = relievers.length ? relievers : pitchers.filter((p) => p.id !== (starter && starter.id));
    const cpCandidate =
      bullpenPool.filter((p) => p.pos === "CP").sort((a, b) => b.getTrueOvr() - a.getTrueOvr())[0] ||
      bullpenPool.slice().sort((a, b) => (b.st.stuff + b.st.velo) - (a.st.stuff + a.st.velo))[0] ||
      null;

    const restBullpen = bullpenPool
      .filter((p) => !cpCandidate || p.id !== cpCandidate.id)
      .sort((a, b) => (b.getTrueOvr() - (b.fatigue || 0) * 0.3) - (a.getTrueOvr() - (a.fatigue || 0) * 0.3));

    const setupMen = restBullpen.slice(0, 2);
    const middleRelievers = restBullpen.slice(2);

    return {
      lineup: orderedLineup,
      catcherDef,
      starter,
      closer: cpCandidate,
      setupMen,
      middleRelievers
    };
  }

  /**
   * 출전 선수별 경기 박스스코어 엔트리 초기화
   */
  function createBatterBox(player, fieldPos, batOrder) {
    return {
      playerId: player.id,
      name: player.name,
      pos: fieldPos,
      role: "batter",
      batOrder,
      pa: 0,
      ab: 0,
      h: 0,
      d: 0,
      t: 0,
      hr: 0,
      rbi: 0,
      r: 0,
      bb: 0,
      k: 0,
      sb: 0,
      cs: 0,
      gidp: 0,
      playerRef: player
    };
  }

  function createPitcherBox(player, isStarter) {
    const stamina = (player && player.st && player.st.stamina) || 50;
    // 선발 한계 투구 수: 체력 70 -> 90구, 체력 90 -> 99구 수준 / 불펜: 25~35구
    const pitchLimit = isStarter ? Math.round(58 + stamina * 0.45) : Math.round(18 + stamina * 0.18);
    return {
      playerId: player.id,
      name: player.name,
      pos: player.pos,
      role: "pitcher",
      isStarter,
      outs: 0,
      ip: "0.0",
      er: 0,
      rAllowed: 0,
      h: 0,
      hr: 0,
      bb: 0,
      k: 0,
      pitchCount: 0,
      pitchLimit,
      maxV: 0,
      decision: null, // 'W' | 'L' | 'SV' | 'HLD' | null
      enteredInSaveSit: false,
      playerRef: player
    };
  }

  /**
   * 세이브 상황 판정 (공식 야구 규칙 기준)
   */
  function isSaveSituation(inning, lead, basesOccupiedCount) {
    if (inning < 7 || lead <= 0) return false;
    if (lead <= 3) return true;
    // 주자 + 타자 + 대기타자가 동점 주자가 되는 경우
    if (basesOccupiedCount + 2 >= lead) return true;
    return false;
  }

  /**
   * 투수 교체 판단 및 구원투수 선택
   */
  function maybeChangePitcher(defState, inning, half, scoreDiffForDef, outs, bases, wxFatMul) {
    const curP = defState.currentPitcherBox;
    if (!curP) return;

    const effLimit = curP.pitchLimit / (wxFatMul || 1.0);
    const basesOccupied = (bases[0] ? 1 : 0) + (bases[1] ? 1 : 0) + (bases[2] ? 1 : 0);

    let shouldChange = false;
    if (curP.isStarter) {
      // 9회 세이브 상황이고 전문 마무리가 대기 중이면 교체
      if (inning >= 9 && scoreDiffForDef >= 1 && scoreDiffForDef <= 3 && defState.closer && !defState.usedPitcherIds.has(defState.closer.id) && curP.pitchCount >= effLimit * 0.85) {
        shouldChange = true;
      } else if (curP.pitchCount >= effLimit) {
        shouldChange = true;
      } else if (curP.er >= 5 && inning >= 4) {
        shouldChange = true;
      } else if (inning >= 7 && curP.pitchCount >= effLimit * 0.82 && basesOccupied >= 2 && Math.abs(scoreDiffForDef) <= 3) {
        shouldChange = true;
      }
    } else {
      // 구원투수 교체 조건
      if (curP.pitchCount >= effLimit || curP.outs >= 5) {
        shouldChange = true;
      } else if (inning >= 9 && scoreDiffForDef >= 1 && scoreDiffForDef <= 3 && defState.closer && curP.playerId !== defState.closer.id && !defState.usedPitcherIds.has(defState.closer.id) && outs === 0) {
        shouldChange = true;
      }
    }

    if (!shouldChange) return;

    // 등판 가능한 불펜 후보 탐색
    let nextPitcher = null;
    const saveSit = isSaveSituation(inning, scoreDiffForDef, basesOccupied);

    if (inning >= 9 && saveSit && defState.closer && !defState.usedPitcherIds.has(defState.closer.id)) {
      nextPitcher = defState.closer;
    } else if (inning >= 7 && Math.abs(scoreDiffForDef) <= 3) {
      nextPitcher = defState.setupMen.find((p) => !defState.usedPitcherIds.has(p.id)) ||
                    defState.middleRelievers.find((p) => !defState.usedPitcherIds.has(p.id)) ||
                    (defState.closer && !defState.usedPitcherIds.has(defState.closer.id) ? defState.closer : null);
    } else {
      nextPitcher = defState.middleRelievers.find((p) => !defState.usedPitcherIds.has(p.id)) ||
                    defState.setupMen.find((p) => !defState.usedPitcherIds.has(p.id));
    }

    if (!nextPitcher) return;

    // 이전 투수가 세이브 상황에서 등판해 리드를 지킨 채 내려가면 홀드 후보 등록
    if (!curP.isStarter && curP.enteredInSaveSit && curP.outs >= 1 && scoreDiffForDef > 0) {
      defState.holdCandidates.push(curP);
    }

    defState.usedPitcherIds.add(nextPitcher.id);
    const newBox = createPitcherBox(nextPitcher, false);
    newBox.enteredInSaveSit = saveSit;
    defState.pitcherBoxes.push(newBox);
    defState.currentPitcherBox = newBox;
  }

  /**
   * v16.8 공식 기반 단일 타석(PA) 결과 판정
   * @returns {{ outcome: string, pitchesUsed: number, topVelo: number }}
   * outcome: 'BB' | 'K' | 'HR' | '3B' | '2B' | '1B' | 'GIDP' | 'OUT'
   */
  function resolvePlateAppearance(batter, pitcherBox, park, weather, bases, outs, staffBonus, rng) {
    const pitcher = pitcherBox.playerRef;
    const pSt = pitcher.st || {};
    const bSt = batter.st || {};

    // v16.8 투구 수 누적에 따른 체력 저하(af): 한계 투구 수의 60% 이후부터 구위·제구·구속 감소
    const limit = pitcherBox.pitchLimit || 80;
    const overRatio = Math.max(0, pitcherBox.pitchCount - limit * 0.6) / Math.max(1, limit * 0.8);
    const staminaFactor = clamp(1 - overRatio * 0.25 - (pitcher.fatigue || 0) * 0.0015, 0.72, 1.0);

    // 좌우 투타 상성 및 스위치히터('S') 보정 (v16.8 계승)
    const pHand = pitcher.throws || "R";
    const bHand = batter.bats === "S" ? (pHand === "R" ? "L" : "R") : (batter.bats || "R");
    const switchPenalty = batter.bats === "S" && bHand !== (batter.throws || "R") ? -2.5 : 0;
    const platoonBonus = pHand !== bHand ? 2.0 : -1.5;

    // 투수 유효 능력치
    const ctrl = (pSt.control || 50) * staminaFactor + (weather.ctrl || 0);
    const stuff = (pSt.stuff || 50) * staminaFactor * (staffBonus.pitBonus || 1.0);
    const velo = (pSt.velo || 50) * staminaFactor;
    const mov = (pSt.movement || 50) * staminaFactor;
    const pitches = pitcher.pitches && pitcher.pitches.length ? pitcher.pitches : [{ k: "FF", m: 55 }];
    const pAvg = pitches.reduce((acc, x) => acc + (x.m || 50), 0) / pitches.length;

    // 타자 유효 능력치
    const con = ((bSt.contact || 50) + platoonBonus + switchPenalty) * (staffBonus.hitBonus || 1.0);
    const pow = ((bSt.power || 50) + platoonBonus * 0.8 + switchPenalty) * (staffBonus.hitBonus || 1.0);
    const eye = (bSt.eye || 50) + platoonBonus * 0.5;
    const spd = bSt.speed || 50;

    // 이번 타석 소요 투구 수 (3~6구) 및 최고 구속
    const pitchesUsed = 3 + Math.floor(rng() * 4);
    const topVelo = Math.max(98, Math.round(kmh(velo) - (1 - staminaFactor) * 9 + (rng() * 3 - 1)));

    // 1. 사사구(BB) 판정
    const bbProb = clamp(0.082 + (eye - ctrl) * 0.0019, 0.025, 0.220);
    if (rng() < bbProb) {
      return { outcome: "BB", pitchesUsed: Math.max(4, pitchesUsed), topVelo };
    }

    // 2. 삼진(K) 판정
    const pitStrikeDom = stuff * 0.38 + velo * 0.26 + pAvg * 0.22 + mov * 0.14;
    const batWhiffRes = con * 0.65 + eye * 0.35;
    const kProb = clamp(0.195 + (pitStrikeDom - batWhiffRes) * 0.0024, 0.065, 0.400);
    if (rng() < kProb) {
      return { outcome: "K", pitchesUsed: Math.max(3, pitchesUsed), topVelo };
    }

    // 3. 인플레이 타구 안타 판정 (BB/K 이후 인플레이 타구 기준, 파크팩터 hit 반영 -> 리그 평균 타율 .270 내외)
    const pitSuppress = ctrl * 0.35 + stuff * 0.35 + mov * 0.30;
    const hitProb = clamp((0.318 + (con - pitSuppress) * 0.0025) * (park.hit || 1.0), 0.195, 0.450);

    if (rng() < hitProb) {
      // 안타 중 장타(홈런 / 3루타 / 2루타 / 단타) 분기
      const hrProb = clamp(
        (0.062 + (pow - (stuff * 0.55 + ctrl * 0.45)) * 0.0032) * (park.hr || 1.0) * (weather.hr || 1.0),
        0.008,
        0.290
      );
      const xbhProb = clamp(
        (0.205 + (pow * 0.6 + spd * 0.4 - pitSuppress) * 0.0018) * (park.xbh || 1.0),
        0.105,
        0.350
      );

      const r = rng();
      if (r < hrProb) {
        return { outcome: "HR", pitchesUsed, topVelo };
      }
      if (r < hrProb + xbhProb) {
        // v16.8 3루타 분기: 주력과 구장 xbh에 비례
        const tripleChance = clamp(0.06 + Math.max(0, spd - 62) * 0.0055 * (park.xbh || 1.0), 0.03, 0.24);
        return { outcome: rng() < tripleChance ? "3B" : "2B", pitchesUsed, topVelo };
      }
      return { outcome: "1B", pitchesUsed, topVelo };
    }

    // 4. 범타: 1루 주자 있고 2아웃 미만일 때 병살타(GIDP) 판정
    if (bases[0] && outs < 2) {
      const gidpProb = clamp(0.115 + (mov - spd) * 0.0018, 0.045, 0.220);
      if (rng() < gidpProb) {
        return { outcome: "GIDP", pitchesUsed, topVelo };
      }
    }

    return { outcome: "OUT", pitchesUsed, topVelo };
  }

  /**
   * 1경기 즉시 시뮬레이션 함수
   * @param {Object} homeTeam - Step 1-1 Team 인스턴스
   * @param {Object} awayTeam - Step 1-1 Team 인스턴스
   * @param {Object} options - { park, weather, rng, updateSeasonRecord = true }
   */
  function simulateMatch(homeTeam, awayTeam, options = {}) {
    const rng = options.rng || Math.random;
    const updateSeasonRecord = options.updateSeasonRecord !== false;

    const park = options.park || homeTeam.park || { name: "기본구장", hr: 1.0, xbh: 1.0, hit: 1.0, dome: false };
    const weatherKey = park.dome
      ? "dome"
      : typeof options.weather === "string"
        ? options.weather
        : options.weather && options.weather.k
          ? options.weather.k
          : rng() < 0.60
            ? "clear"
            : ["hot", "cold", "tail", "head", "rain"][Math.floor(rng() * 5)];
    const weather =
      (typeof options.weather === "object" && options.weather && options.weather.hr != null)
        ? options.weather
        : WEATHER_PRESETS[weatherKey] || WEATHER_PRESETS.clear;

    // 양 팀 라인업 및 투수진 구성
    const homePlan = buildMatchLineup(homeTeam);
    const awayPlan = buildMatchLineup(awayTeam);

    const createTeamMatchState = (team, plan) => {
      const batterBoxes = plan.lineup.map((item, idx) => createBatterBox(item.player, item.fieldPos, idx + 1));
      const starterBox = createPitcherBox(plan.starter, true);
      const staff = team.coachingStaff || {};
      return {
        team,
        batterBoxes,
        batIdx: 0,
        catcherDef: plan.catcherDef,
        closer: plan.closer,
        setupMen: plan.setupMen,
        middleRelievers: plan.middleRelievers,
        pitcherBoxes: [starterBox],
        currentPitcherBox: starterBox,
        usedPitcherIds: new Set([plan.starter.id]),
        holdCandidates: [],
        staffBonus: {
          hitBonus: (staff.hittingCoach && staff.hittingCoach.clutchBonus) || 1.0,
          pitBonus: (staff.pitchingCoach && staff.pitchingCoach.tacticsBonus) || 1.0
        },
        score: 0,
        inningScores: []
      };
    };

    const home = createTeamMatchState(homeTeam, homePlan);
    const away = createTeamMatchState(awayTeam, awayPlan);

    // 승리/패전 투수 추적용 리드 변경 기록
    let currentLeader = null; // 'home' | 'away' | null
    let pitcherOfRecord = {
      winCandidate: null,
      loseCandidate: null
    };

    /**
     * 득점 발생 시 주자 득점·투수 실점/자책점 및 승리·패전 책임투수 갱신
     */
    function scoreRunner(runnerObj, offSide, offState, defState, batterBox, creditRbi = true) {
      const prevDiff = offState.score - defState.score;
      offState.score += 1;
      offState.inningScores[offState.inningScores.length - 1] += 1;

      if (runnerObj && runnerObj.batterBox) {
        runnerObj.batterBox.r += 1;
      }
      if (creditRbi && batterBox) {
        batterBox.rbi += 1;
      }
      const respPitcher = (runnerObj && runnerObj.responsiblePitcherBox) || defState.currentPitcherBox;
      if (respPitcher) {
        respPitcher.rAllowed += 1;
        respPitcher.er += 1;
      }

      // 동점에서 앞서가는 결승점(Go-ahead run)이 나온 순간 책임 투수 기록
      const newDiff = offState.score - defState.score;
      if (prevDiff === 0 && newDiff === 1) {
        currentLeader = offSide;
        pitcherOfRecord.winCandidate = offState.currentPitcherBox;
        pitcherOfRecord.loseCandidate = respPitcher;
      }
    }

    /**
     * 반이닝(Half-Inning) 진행
     */
    function playHalfInning(inning, isBottom) {
      const offSide = isBottom ? "home" : "away";
      const offState = isBottom ? home : away;
      const defState = isBottom ? away : home;

      offState.inningScores.push(0);
      let outs = 0;
      // bases: [1루, 2루, 3루], 각 원소는 null 또는 { batterBox, responsiblePitcherBox }
      let bases = [null, null, null];

      while (outs < 3) {
        // 9회말 이후 홈팀이 리드 잡으면 즉시 끝내기(Walk-off) 종료
        if (isBottom && inning >= 9 && home.score > away.score) {
          break;
        }

        // 투수 교체 체크
        const defLead = defState.score - offState.score;
        maybeChangePitcher(defState, inning, isBottom ? "말" : "초", defLead, outs, bases, weather.fat);

        const curPitcherBox = defState.currentPitcherBox;
        const curBatterBox = offState.batterBoxes[offState.batIdx % offState.batterBoxes.length];
        offState.batIdx += 1;

        // ── 도루(Stolen Base) 시도 판정 (v16.8 공식) ──
        if (bases[0] && !bases[1]) {
          const runnerPlayer = bases[0].batterBox.playerRef;
          const rSpd = (runnerPlayer.st && runnerPlayer.st.speed) || 50;
          if (rSpd >= 62 && rng() < clamp(0.08 + (rSpd - 60) * 0.007, 0.05, 0.28)) {
            // v16.8 2루 도루 성공률: 주력 50 -> 40%, 70 -> 65%, 90 -> 90%, 포수 어깨 보정 ±6%p
            const catAdj = (defState.catcherDef - 70) * 0.003;
            const leftyAdj = curPitcherBox.playerRef.throws === "L" ? -0.05 : 0;
            const sbSuccessProb = clamp(0.40 + (rSpd - 50) * 0.0125 - catAdj + leftyAdj, 0.25, 0.93);

            if (rng() < sbSuccessProb) {
              bases[0].batterBox.sb += 1;
              bases[1] = bases[0];
              bases[0] = null;
            } else {
              bases[0].batterBox.cs += 1;
              bases[0] = null;
              outs += 1;
              curPitcherBox.outs += 1;
              if (outs >= 3) break;
            }
          }
        }

        // ── 타석(PA) 승부 판정 ──
        const paRes = resolvePlateAppearance(
          curBatterBox.playerRef,
          curPitcherBox,
          park,
          weather,
          bases,
          outs,
          { hitBonus: offState.staffBonus.hitBonus, pitBonus: defState.staffBonus.pitBonus },
          rng
        );

        curPitcherBox.pitchCount += paRes.pitchesUsed;
        if (paRes.topVelo > curPitcherBox.maxV) curPitcherBox.maxV = paRes.topVelo;
        curBatterBox.pa += 1;

        const runnerSelf = { batterBox: curBatterBox, responsiblePitcherBox: curPitcherBox };

        if (paRes.outcome === "BB") {
          curBatterBox.bb += 1;
          curPitcherBox.bb += 1;
          if (bases[0] && bases[1] && bases[2]) {
            scoreRunner(bases[2], offSide, offState, defState, curBatterBox, true);
          }
          if (bases[0] && bases[1]) bases[2] = bases[1];
          if (bases[0]) bases[1] = bases[0];
          bases[0] = runnerSelf;
        } else if (paRes.outcome === "K") {
          curBatterBox.ab += 1;
          curBatterBox.k += 1;
          curPitcherBox.k += 1;
          curPitcherBox.outs += 1;
          outs += 1;
        } else if (paRes.outcome === "HR") {
          curBatterBox.ab += 1;
          curBatterBox.h += 1;
          curBatterBox.hr += 1;
          curPitcherBox.h += 1;
          curPitcherBox.hr += 1;

          if (bases[2]) scoreRunner(bases[2], offSide, offState, defState, curBatterBox, true);
          if (bases[1]) scoreRunner(bases[1], offSide, offState, defState, curBatterBox, true);
          if (bases[0]) scoreRunner(bases[0], offSide, offState, defState, curBatterBox, true);
          scoreRunner(runnerSelf, offSide, offState, defState, curBatterBox, true);
          bases = [null, null, null];
        } else if (paRes.outcome === "3B") {
          curBatterBox.ab += 1;
          curBatterBox.h += 1;
          curBatterBox.t += 1;
          curPitcherBox.h += 1;

          if (bases[2]) scoreRunner(bases[2], offSide, offState, defState, curBatterBox, true);
          if (bases[1]) scoreRunner(bases[1], offSide, offState, defState, curBatterBox, true);
          if (bases[0]) scoreRunner(bases[0], offSide, offState, defState, curBatterBox, true);
          bases = [null, null, runnerSelf];
        } else if (paRes.outcome === "2B") {
          curBatterBox.ab += 1;
          curBatterBox.h += 1;
          curBatterBox.d += 1;
          curPitcherBox.h += 1;

          if (bases[2]) scoreRunner(bases[2], offSide, offState, defState, curBatterBox, true);
          if (bases[1]) scoreRunner(bases[1], offSide, offState, defState, curBatterBox, true);
          let nextB3 = null;
          if (bases[0]) {
            const r1Spd = (bases[0].batterBox.playerRef.st && bases[0].batterBox.playerRef.st.speed) || 50;
            if (rng() < clamp(0.35 + (r1Spd - 55) * 0.01, 0.20, 0.75)) {
              scoreRunner(bases[0], offSide, offState, defState, curBatterBox, true);
            } else {
              nextB3 = bases[0];
            }
          }
          bases = [null, runnerSelf, nextB3];
        } else if (paRes.outcome === "1B") {
          curBatterBox.ab += 1;
          curBatterBox.h += 1;
          curPitcherBox.h += 1;

          if (bases[2]) scoreRunner(bases[2], offSide, offState, defState, curBatterBox, true);
          let nextB3 = null;
          let nextB2 = null;
          if (bases[1]) {
            const r2Spd = (bases[1].batterBox.playerRef.st && bases[1].batterBox.playerRef.st.speed) || 50;
            if (rng() < clamp(0.58 + (r2Spd - 55) * 0.008, 0.35, 0.85)) {
              scoreRunner(bases[1], offSide, offState, defState, curBatterBox, true);
            } else {
              nextB3 = bases[1];
            }
          }
          if (bases[0]) {
            if (!nextB3 && rng() < 0.22) nextB3 = bases[0];
            else nextB2 = bases[0];
          }
          bases = [runnerSelf, nextB2, nextB3];
        } else if (paRes.outcome === "GIDP") {
          curBatterBox.ab += 1;
          curBatterBox.gidp += 1;
          const addedOuts = Math.min(3 - outs, 2);
          outs += addedOuts;
          curPitcherBox.outs += addedOuts;
          if (outs < 3 && bases[2]) {
            // 노아웃 1·3루 병살타 시 3루 주자 득점(타점 없음)
            scoreRunner(bases[2], offSide, offState, defState, curBatterBox, false);
          }
          bases = [null, bases[1], null];
        } else {
          // 일반 범타(OUT) 및 희생플라이 처리
          curBatterBox.ab += 1;
          outs += 1;
          curPitcherBox.outs += 1;
          if (outs < 3 && bases[2] && rng() < 0.42) {
            // 희생플라이 / 내야 땅볼 3루 주자 홈인
            scoreRunner(bases[2], offSide, offState, defState, curBatterBox, true);
            bases[2] = null;
          }
        }

        // 동점이 되면 기존 승리/패전 투수 후보 초기화
        if (home.score === away.score) {
          currentLeader = null;
          pitcherOfRecord.winCandidate = null;
          pitcherOfRecord.loseCandidate = null;
          // 블론세이브 발생 시 이전 홀드 후보 무효화
          defState.holdCandidates = [];
        }
      }
    }

    // ── 9이닝(연장 최대 12이닝) 루프 ──
    const MAX_INNINGS = 12;
    let totalInnings = 9;
    for (let inn = 1; inn <= MAX_INNINGS; inn++) {
      if (inn > 9 && home.score !== away.score) break;
      totalInnings = inn;

      // 초 공격 (원정팀)
      playHalfInning(inn, false);

      // 9회말 시작 전 이미 홈팀이 앞서 있으면 9회말 생략
      if (inn >= 9 && home.score > away.score) {
        break;
      }

      // 말 공격 (홈팀)
      playHalfInning(inn, true);
    }

    // ── 승/패/세이브/홀드 투수 최종 확정 ──
    let winPitcher = null;
    let losePitcher = null;
    let savePitcher = null;

    if (home.score !== away.score) {
      const winState = home.score > away.score ? home : away;
      const loseState = home.score > away.score ? away : home;

      let wCand = pitcherOfRecord.winCandidate;
      if (!wCand || !winState.pitcherBoxes.includes(wCand)) {
        wCand = winState.pitcherBoxes[winState.pitcherBoxes.length - 1];
      }
      // 선발 투수가 5이닝(15아웃) 미만 투구 시 가장 효과적인 구원투수에게 승리 부여 (야구 공식 규칙)
      if (wCand && wCand.isStarter && wCand.outs < 15 && winState.pitcherBoxes.length > 1) {
        const relievers = winState.pitcherBoxes.slice(1);
        relievers.sort((a, b) => (b.outs - b.er * 3) - (a.outs - a.er * 3));
        wCand = relievers[0];
      }
      winPitcher = wCand;
      if (winPitcher) winPitcher.decision = "W";

      losePitcher =
        pitcherOfRecord.loseCandidate && loseState.pitcherBoxes.includes(pitcherOfRecord.loseCandidate)
          ? pitcherOfRecord.loseCandidate
          : loseState.pitcherBoxes[loseState.pitcherBoxes.length - 1];
      if (losePitcher) losePitcher.decision = "L";

      // 세이브 판정: 승리팀 마지막 투수가 승리투수가 아니고, 세이브 상황 등판(또는 3이닝 소화) + 1아웃 이상
      const lastWinPitcher = winState.pitcherBoxes[winState.pitcherBoxes.length - 1];
      if (
        lastWinPitcher &&
        lastWinPitcher !== winPitcher &&
        lastWinPitcher.outs >= 1 &&
        (lastWinPitcher.enteredInSaveSit || lastWinPitcher.outs >= 9)
      ) {
        savePitcher = lastWinPitcher;
        savePitcher.decision = "SV";
      }

      // 홀드 부여
      winState.holdCandidates.forEach((hBox) => {
        if (hBox !== winPitcher && hBox !== savePitcher && !hBox.decision) {
          hBox.decision = "HLD";
        }
      });
    }

    // ── 출전 선수 Season Record (Player.rec) 및 구단 전적(Team.record) 누적 ──
    const finalizeTeamBoxes = (state) => {
      state.pitcherBoxes.forEach((pBox) => {
        pBox.ip = fmtIP(pBox.outs);
      });

      if (updateSeasonRecord) {
        state.batterBoxes.forEach((b) => {
          if (b.pa <= 0) return;
          const rec = b.playerRef.rec;
          rec.g = (rec.g || 0) + 1;
          rec.pa = (rec.pa || 0) + b.pa;
          rec.ab = (rec.ab || 0) + b.ab;
          rec.h = (rec.h || 0) + b.h;
          rec.d = (rec.d || 0) + b.d;
          rec.t = (rec.t || 0) + b.t;
          rec.hr = (rec.hr || 0) + b.hr;
          rec.bb = (rec.bb || 0) + b.bb;
          rec.k = (rec.k || 0) + b.k;
          rec.rbi = (rec.rbi || 0) + b.rbi;
          rec.r = (rec.r || 0) + b.r;
          rec.sb = (rec.sb || 0) + b.sb;
          rec.cs = (rec.cs || 0) + b.cs;
          rec.gidp = (rec.gidp || 0) + b.gidp;
          b.playerRef.fatigue = clamp((b.playerRef.fatigue || 0) + 1, 0, 100);
        });

        state.pitcherBoxes.forEach((p) => {
          if (p.pitchCount <= 0 && p.outs <= 0) return;
          const rec = p.playerRef.rec;
          rec.g = (rec.g || 0) + 1;
          if (p.isStarter) rec.gs = (rec.gs || 0) + 1;
          rec.ip = +((rec.ip || 0) + p.outs / 3).toFixed(4);
          rec.er = (rec.er || 0) + p.er;
          rec.k = (rec.k || 0) + p.k;
          rec.bb = (rec.bb || 0) + p.bb;
          rec.h = (rec.h || 0) + p.h;
          rec.hr = (rec.hr || 0) + p.hr;
          if (p.maxV > (rec.maxV || 0)) rec.maxV = p.maxV;
          if (p.decision === "W") rec.w = (rec.w || 0) + 1;
          if (p.decision === "L") rec.l = (rec.l || 0) + 1;
          if (p.decision === "SV") rec.sv = (rec.sv || 0) + 1;
          if (p.decision === "HLD") rec.hld = (rec.hld || 0) + 1;

          const fatGain = p.isStarter ? 44 : Math.max(8, Math.round(p.pitchCount * 0.65));
          p.playerRef.fatigue = clamp((p.playerRef.fatigue || 0) + fatGain, 0, 100);
        });

        // 미출전 투수/야수 휴식 회복 (5선발 로테이션 및 불펜 자연 순환)
        const pitchedIds = new Set(state.pitcherBoxes.map((p) => p.playerId));
        (state.team.roster1G || []).forEach((plr) => {
          if (plr.type === "pitcher" && !pitchedIds.has(plr.id)) {
            plr.fatigue = clamp((plr.fatigue || 0) - 11, 0, 100);
          }
        });
      }

      // 순수 직렬화 가능한 BoxScore 배열 생성 (타자 + 투수 통합 배열 및 .batters / .pitchers 서브 프로퍼티 동시 제공)
      const cleanBatters = state.batterBoxes.map(({ playerRef, ...rest }) => rest);
      const cleanPitchers = state.pitcherBoxes.map(({ playerRef, ...rest }) => rest);
      const combined = [...cleanBatters, ...cleanPitchers];
      Object.defineProperty(combined, "batters", { value: cleanBatters, enumerable: false });
      Object.defineProperty(combined, "pitchers", { value: cleanPitchers, enumerable: false });
      return combined;
    };

    const homeBoxScore = finalizeTeamBoxes(home);
    const awayBoxScore = finalizeTeamBoxes(away);

    if (updateSeasonRecord) {
      homeTeam.record = homeTeam.record || { w: 0, l: 0, d: 0, rs: 0, ra: 0 };
      awayTeam.record = awayTeam.record || { w: 0, l: 0, d: 0, rs: 0, ra: 0 };
      homeTeam.record.rs += home.score;
      homeTeam.record.ra += away.score;
      awayTeam.record.rs += away.score;
      awayTeam.record.ra += home.score;

      if (home.score > away.score) {
        homeTeam.record.w += 1;
        awayTeam.record.l += 1;
      } else if (away.score > home.score) {
        awayTeam.record.w += 1;
        homeTeam.record.l += 1;
      } else {
        homeTeam.record.d += 1;
        awayTeam.record.d += 1;
      }
    }

    const formatDecisionPitcher = (pBox) =>
      pBox
        ? {
            playerId: pBox.playerId,
            name: pBox.name,
            ip: pBox.ip,
            er: pBox.er,
            k: pBox.k,
            bb: pBox.bb,
            pitchCount: pBox.pitchCount
          }
        : null;

    return {
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      homeScore: home.score,
      awayScore: away.score,
      innings: {
        total: totalInnings,
        away: away.inningScores,
        home: home.inningScores
      },
      park: park.name,
      weather: weather.n,
      winPitcher: formatDecisionPitcher(winPitcher),
      losePitcher: formatDecisionPitcher(losePitcher),
      savePitcher: formatDecisionPitcher(savePitcher),
      homeBoxScore,
      awayBoxScore
    };
  }

  return {
    WEATHER_PRESETS,
    buildMatchLineup,
    simulateMatch
  };
});
