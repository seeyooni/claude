/**
 * KBO 단장 모드 (v1.0) — Step 1-1: 통합 데이터 스키마 및 초기화 모듈
 * 기반 엔진: 나만의 야구 선수 만들기 v16.8 연산 공식 (능력치, 구종, 노쇠화, wOBA/WAR, 파크팩터)
 * 실행 환경: Client-Side Standalone / ES Module & Global(window. KBO_GM) 겸용
 */

(function (root, factory) {
  const api = factory();
  if (typeof globalThis !== "undefined") {
    globalThis.KBO_GM = api;
  }
  if (typeof window !== "undefined") {
    window.KBO_GM = api;
  }
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ═══════════════════════════════════════════════════════════════════════
   * 1. v16.8 코어 상수 및 연산 테이블 (계승)
   * ═══════════════════════════════════════════════════════════════════════ */
  const P_KEYS = ["control", "stuff", "velo", "stamina", "movement"];
  const B_KEYS = ["contact", "power", "speed", "defense", "eye"];

  const LABEL = {
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

  // v16.8 17종 구종 테이블
  const PITCHES = {
    FF: { sp: 0,   n: "직구",         brk: 0.10, diff: 0, fam: "속구" },
    FT: { sp: -2,  n: "투심",         brk: 0.30, diff: 2, fam: "속구" },
    FC: { sp: -6,  n: "커터",         brk: 0.25, diff: 3, fam: "속구" },
    SL: { sp: -12, n: "슬라이더",     brk: 0.55, diff: 1, fam: "횡변화" },
    SW: { sp: -14, n: "스위퍼",       brk: 0.80, diff: 3, fam: "횡변화", from: ["SL"], fm: 60, keep: 0.60 },
    SV: { sp: -16, n: "슬러브",       brk: 0.65, diff: 2, fam: "횡변화", from: ["CB", "SL"], fm: 50, keep: 0.50 },
    CB: { sp: -22, n: "커브",         brk: 0.75, diff: 1, fam: "종변화" },
    PC: { sp: -16, n: "파워커브",     brk: 0.82, diff: 3, fam: "종변화", from: ["CB"], fm: 60, keep: 0.60 },
    NK: { sp: -20, n: "너클커브",     brk: 0.92, diff: 4, fam: "종변화", from: ["CB"], fm: 65, keep: 0.55 },
    SC: { sp: -32, n: "슬로우커브",   brk: 0.86, diff: 2, fam: "종변화", from: ["CB"], fm: 45, keep: 0.70 },
    FK: { sp: -13, n: "포크",         brk: 0.85, diff: 3, fam: "종변화" },
    SP: { sp: -7,  n: "스플리터",     brk: 0.70, diff: 2, fam: "종변화" },
    SI: { sp: -9,  n: "싱커",         brk: 0.60, diff: 3, fam: "종변화", from: ["FT"], fm: 65, keep: 0.60 },
    CH: { sp: -14, n: "체인지업",     brk: 0.50, diff: 2, fam: "감속" },
    CC: { sp: -15, n: "서클체인지업", brk: 0.62, diff: 3, fam: "감속", from: ["CH"], fm: 60, keep: 0.70 },
    KC: { sp: -12, n: "킥체인지업",   brk: 0.78, diff: 3, fam: "감속" },
    KN: { sp: -35, n: "너클볼",       brk: 0.95, diff: 4, fam: "특수" }
  };

  // 단장 모드 세부 포지션 (투수 3보직 + 야수 9포지션)
  const POSITIONS = {
    SP: { group: "pitcher", n: "선발투수", reqDef: 0,  reqSpd: 0,  warAdj: 0 },
    RP: { group: "pitcher", n: "구원투수", reqDef: 0,  reqSpd: 0,  warAdj: 0 },
    CP: { group: "pitcher", n: "마무리",   reqDef: 0,  reqSpd: 0,  warAdj: 0 },
    C:  { group: "batter",  n: "포수",     reqDef: 72, reqSpd: 0,  warAdj: 0.8 },
    SS: { group: "batter",  n: "유격수",   reqDef: 78, reqSpd: 56, warAdj: 0.5 },
    "2B": { group: "batter", n: "2루수",   reqDef: 70, reqSpd: 52, warAdj: 0.3 },
    CF: { group: "batter",  n: "중견수",   reqDef: 70, reqSpd: 62, warAdj: 0.3 },
    "3B": { group: "batter", n: "3루수",   reqDef: 64, reqSpd: 0,  warAdj: 0.1 },
    LF: { group: "batter",  n: "좌익수",   reqDef: 56, reqSpd: 0,  warAdj: -0.2 },
    RF: { group: "batter",  n: "우익수",   reqDef: 56, reqSpd: 0,  warAdj: -0.2 },
    "1B": { group: "batter", n: "1루수",   reqDef: 46, reqSpd: 0,  warAdj: -0.6 },
    DH: { group: "batter",  n: "지명타자", reqDef: 0,  reqSpd: 0,  warAdj: -0.9 }
  };

  // v16.8 연령별 노쇠화(Decay) 파라미터
  const DECAY = {
    speed:    { from: 28, rate: 1.60 },
    velo:     { from: 29, rate: 1.50 },
    stamina:  { from: 30, rate: 1.30 },
    stuff:    { from: 31, rate: 1.15 },
    power:    { from: 30, rate: 1.25 },
    defense:  { from: 30, rate: 1.10 },
    movement: { from: 33, rate: 0.75 },
    contact:  { from: 31, rate: 1.05 },
    control:  { from: 35, rate: 0.45 },
    eye:      { from: 33, rate: 0.65 }
  };

  const DECAYP = {
    a: 0.30, b2: 0.02, b1: 0.03, knee: 44, s: 0,
    ironP: 0.05, ironMul: 0.40, a0: 30, b0: 35
  };

  // KBO 10개 구단 기본 메타데이터 (v16.8 구단명·연고지·파크팩터 연동, 예산 단위: 만원 [1,500,000 = 150억])
  const KBO_TEAM_META = [
    { id: "KIA", name: "광주 고양이즈", futures: "함평 고양이즈", city: "광주", park: { name: "광주 챔피언스필드", hr: 0.98, xbh: 1.00, hit: 1.00, dome: false }, baseBudget: 1550000 },
    { id: "SAM", name: "대구 표범즈",   futures: "경산 표범즈",   city: "대구", park: { name: "대구 팔각구장",     hr: 1.20, xbh: 1.05, hit: 1.02, dome: false }, baseBudget: 1500000 },
    { id: "LG",  name: "서울 쌍둥이즈", futures: "이천 쌍둥이즈", city: "서울", park: { name: "잠실야구장",       hr: 0.82, xbh: 1.12, hit: 1.00, dome: false }, baseBudget: 1700000 },
    { id: "DOO", name: "잠실 판다즈",   futures: "이천 판다즈",   city: "잠실", park: { name: "잠실야구장",       hr: 0.82, xbh: 1.12, hit: 1.00, dome: false }, baseBudget: 1450000 },
    { id: "KT",  name: "수원 도깨비즈", futures: "익산 도깨비즈", city: "수원", park: { name: "수원 위즈파크",     hr: 1.02, xbh: 1.05, hit: 1.00, dome: false }, baseBudget: 1400000 },
    { id: "SSG", name: "인천 물범즈",   futures: "강화 물범즈",   city: "인천", park: { name: "문학야구장",       hr: 1.22, xbh: 1.02, hit: 1.01, dome: false }, baseBudget: 1600000 },
    { id: "LOT", name: "부산 갈매기즈", futures: "김해 갈매기즈", city: "부산", park: { name: "사직야구장",       hr: 0.95, xbh: 1.10, hit: 1.04, dome: false }, baseBudget: 1580000 },
    { id: "HAN", name: "대전 송골매즈", futures: "서산 송골매즈", city: "대전", park: { name: "대전 신구장",       hr: 0.96, xbh: 1.08, hit: 1.01, dome: false }, baseBudget: 1480000 },
    { id: "NC",  name: "창원 도마뱀즈", futures: "마산 도마뱀즈", city: "창원", park: { name: "창원 NC파크",      hr: 1.06, xbh: 1.00, hit: 1.00, dome: false }, baseBudget: 1380000 },
    { id: "KIW", name: "고척 용사즈",   futures: "고양 용사즈",   city: "고척", park: { name: "고척 스카이돔",     hr: 0.88, xbh: 0.96, hit: 0.99, dome: true  }, baseBudget: 1180000 }
  ];

  /* ═══════════════════════════════════════════════════════════════════════
   * 2. v16.8 코어 보조 연산 함수
   * ═══════════════════════════════════════════════════════════════════════ */
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pick = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];
  const randInt = (lo, hi, rng = Math.random) => lo + Math.floor(rng() * (hi - lo + 1));

  function grade(v) {
    if (v >= 100) return "SS";
    if (v >= 90)  return "S";
    if (v >= 80)  return "A";
    if (v >= 70)  return "B";
    if (v >= 60)  return "C";
    if (v >= 50)  return "D";
    if (v >= 40)  return "E";
    return "F";
  }

  function kmh(veloStat) {
    return Math.round(120 + veloStat * 0.4);
  }

  function costFor(v) {
    if (v < 50)  return 10;
    if (v < 65)  return 20;
    if (v < 75)  return 40;
    if (v < 85)  return 80;
    if (v < 93)  return 160;
    if (v < 100) return 320;
    if (v < 105) return 500;
    return 800;
  }

  // v16.8 연령 성장 계수
  function ageCoef(age) {
    if (age <= 25) return +(1.60 - (age - 16) * 0.0667).toFixed(3);
    if (age <= 30) return +(1.00 - (age - 25) * 0.10).toFixed(3);
    if (age <= 34) return +(0.50 - (age - 30) * 0.07).toFixed(3);
    if (age <= 39) return +Math.max(0.10, 0.22 - (age - 34) * 0.024).toFixed(3);
    return +Math.max(0.06, 0.10 - (age - 39) * 0.008).toFixed(3);
  }

  // v16.8 노쇠화 가속 곡선
  function decayAccel(age) {
    const P = DECAYP;
    const A = (x) => {
      const a = Math.max(0, x - (P.a0 || 30));
      const b = Math.max(0, x - (P.b0 || 35));
      return 1 + a * P.a + b * b * P.b2 + b * P.b1;
    };
    if (P.s == null || age <= P.knee) return A(age);
    return A(P.knee) + (age - P.knee) * P.s;
  }

  function decayAt(statKey, age) {
    const d = DECAY[statKey];
    if (!d) return 0;
    const over = age - d.from;
    if (over <= 0) return 0;
    return d.rate * (1 + over * 0.20) * decayAccel(age);
  }

  function createEmptySeasonRecord(type) {
    return type === "pitcher"
      ? { g: 0, gs: 0, ip: 0, er: 0, k: 0, bb: 0, h: 0, hr: 0, w: 0, l: 0, sv: 0, hld: 0, maxV: 0 }
      : { g: 0, pa: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, k: 0, rbi: 0, r: 0, sb: 0, cs: 0, gidp: 0 };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 3. Player 클래스 정의
   * ═══════════════════════════════════════════════════════════════════════ */
  class Player {
    /**
     * @param {Object} init
     */
    constructor(init = {}) {
      this.id = init.id || "plr_" + Math.random().toString(36).slice(2, 10);
      this.name = init.name || "무명선수";
      this.nationality = init.nationality || "KOR"; // 'KOR' | 'JPN' | 'USA' | 'DOM' | 'VEN' | 'TWN'
      this.origin = init.origin || "HS";            // 'HS' | 'UNIV' | 'KBO' | 'NPB' | 'AAA'

      // 포지션 및 투타 유형
      this.pos = init.pos || "SP";
      const posInfo = POSITIONS[this.pos] || POSITIONS.SP;
      this.type = init.type || posInfo.group;       // 'pitcher' | 'batter'
      this.subPos = Array.isArray(init.subPos) ? init.subPos : [];
      this.throws = init.throws || "R";             // 'R' | 'L'
      this.bats = init.bats || "R";                 // 'R' | 'L' | 'S'(스위치)

      // 나이 및 신체/노쇠화 특성 (v16.8 계승)
      this.age = Number.isFinite(init.age) ? init.age : 20;
      this.potential = Number.isFinite(init.potential) ? init.potential : 75; // 잠재력 상한 (60~110)
      this.iron = Boolean(init.iron);               // 늦게 늙는 몸 (5% 확률, 35세 이후 노쇠 ×0.4)
      this.lateBloom = Boolean(init.lateBloom);     // 대기만성 특성

      // 기본 능력치 (v16.8 5대 능력치 + TP 누적치)
      const keys = this.type === "pitcher" ? P_KEYS : B_KEYS;
      this.st = {};
      this.tp = {};
      keys.forEach((k) => {
        this.st[k] = clamp(Math.round((init.st && init.st[k]) ?? 50), 1, 110);
        this.tp[k] = (init.tp && init.tp[k]) ?? 0;
      });

      // 구종 배열 (투수 전용, v16.8 포맷: [{ k: "FF", m: 65 }, ...])
      this.pitches = this.type === "pitcher"
        ? (Array.isArray(init.pitches) && init.pitches.length
            ? init.pitches.map((p) => ({ k: p.k, m: clamp(Math.round(p.m), 1, 100) }))
            : [{ k: "FF", m: 55 }, { k: "SL", m: 45 }])
        : [];

      // 컨디션 및 피로도
      this.fatigue = clamp(init.fatigue ?? 0, 0, 100);
      this.cond = init.cond ?? 1.0;

      // ── 단장 모드 신규 속성 ──
      this.teamId = init.teamId || null;            // 소속 구단 ID (무소속/풀이면 null)
      this.status = init.status || "1GUN";          // '1GUN' | '2GUN' | 'YUKSEONG' | 'FOREIGN_POOL' | 'DRAFT_POOL' | 'FA'
      this.salary = init.salary ?? 3000;            // 연봉 (만원 단위, 최저연봉 3,000만원)
      this.contractYears = init.contractYears ?? 1; // 잔여 계약 연수 (1~6년)
      this.faYears = init.faYears ?? 0;             // 누적 FA 자격 연수 (고졸 8시즌 / 대졸 7시즌 시 FA 자격)
      this.serviceDaysThisYear = init.serviceDaysThisYear ?? 0; // 당해 1군 등록일수 (145일 이상 시 +1시즌)

      // 부상 상태 객체
      this.injury = init.injury
        ? {
            active: Boolean(init.injury.active),
            name: init.injury.name || init.injury.label || null,
            part: init.injury.part || null,
            label: init.injury.label || init.injury.name || null,
            weeksLeft: init.injury.weeksLeft || 0,
            major: Boolean(init.injury.major)
          }
        : { active: false, name: null, part: null, label: null, weeksLeft: 0, major: false };

      // 스카우팅 오차 (Fog of War)
      this.scoutError = init.scoutError || {
        ovrMin: 0,
        ovrMax: 0,
        statRanges: {},
        scoutedAtLevel: 1
      };

      // 시즌 기록, 파생 지표 및 통산 기록
      this.rec = init.rec || createEmptySeasonRecord(this.type);
      this.metrics = init.metrics || null;
      this.career = Array.isArray(init.career) ? init.career : [];

      // 아마추어 드래프트 평가 속성 (Phase 2 연동) 및 독립리그·아시아쿼터·2군 기록 속성
      if (init.draftScore !== undefined) this.draftScore = init.draftScore;
      if (init.draftProjection !== undefined) this.draftProjection = init.draftProjection;
      if (init.prevDraftRank !== undefined) this.prevDraftRank = init.prevDraftRank;
      this.isAsianQuarter = Boolean(init.isAsianQuarter);
      this.isAsianQuarterEligible = Boolean(
        init.isAsianQuarterEligible || ["JPN", "TWN", "AUS", "CHN"].includes(this.nationality)
      );
      this.indClubName = init.indClubName || null;
      this.futuresRec = init.futuresRec || createEmptySeasonRecord(this.type);
      this.lastGrowthNote = init.lastGrowthNote || null;

      // [PART 4 & 5] 상무 피닉스 병역 상태, 비FA 다년 연장 계약, 2군 맞춤형 훈련 과제, 사기(Morale) 및 트레이드 요구 속성
      this.militaryStatus =
        init.militaryStatus ||
        (this.nationality !== "KOR" ? "EXEMPT" : this.age >= 27 ? "COMPLETED" : "UNFULFILLED");
      this.militaryDaysLeft = Number(init.militaryDaysLeft) || 0;
      this.enlistedDate = init.enlistedDate || null;
      this.isForcedEnlistment = Boolean(init.isForcedEnlistment);
      this.isMultiYearExtended = Boolean(init.isMultiYearExtended);
      this.trainingFocus = init.trainingFocus || null; // 'VELO'|'CONTROL'|'NEW_PITCH'|'STAMINA'|'EYE'|'POWER'|'CONTACT'|'DEFENSE'
      this.morale = clamp(Number.isFinite(Number(init.morale)) ? Number(init.morale) : 78, 0, 100);
      this.tradeDemand = Boolean(init.tradeDemand);
      this.moraleReason = init.moraleReason || "구단 생활 및 출전 기회에 만족 중";

      // 초기 스카우팅 리포트 생성
      if (!init.scoutError) {
        this.updateScoutingReport(init.scoutLevel || 1);
      }
    }

    /**
     * 진정한(True) 종합 능력치(OVR) 산출 (포지션별 가중치 및 투수 구종 숙련도 반영)
     */
    getTrueOvr() {
      if (this.type === "pitcher") {
        const w = this.pos === "SP"
          ? { control: 0.26, stuff: 0.24, velo: 0.16, stamina: 0.22, movement: 0.12 }
          : { control: 0.22, stuff: 0.34, velo: 0.24, stamina: 0.06, movement: 0.14 };
        let s = 0;
        P_KEYS.forEach((k) => { s += (this.st[k] || 50) * w[k]; });
        if (this.pitches.length) {
          const top3 = this.pitches.slice().sort((a, b) => b.m - a.m).slice(0, 3);
          const pAvg = top3.reduce((acc, x) => acc + x.m, 0) / top3.length;
          s = s * 0.86 + pAvg * 0.14;
        }
        return Math.round(s);
      } else {
        const isCore = ["1B", "3B", "LF", "RF", "DH"].includes(this.pos);
        const w = isCore
          ? { contact: 0.28, power: 0.34, eye: 0.18, defense: 0.10, speed: 0.10 }
          : { contact: 0.28, power: 0.14, eye: 0.16, defense: 0.24, speed: 0.18 };
        let s = 0;
        B_KEYS.forEach((k) => { s += (this.st[k] || 50) * w[k]; });
        return Math.round(s);
      }
    }

    /**
     * 스카우트 레벨(1~5)에 따른 Fog of War(스카우팅 오차 범위) 갱신
     * - 자구단 소속('1GUN'|'2GUN'|'YUKSEONG')이고 isOwnTeam=true 이면 오차 대폭 축소
     */
    updateScoutingReport(scoutLevel = 1, isOwnTeam = false, rng = Math.random) {
      const trueOvr = this.getTrueOvr();
      // 레벨 1: ±10, 레벨 2: ±8, 레벨 3: ±6, 레벨 4: ±4, 레벨 5: ±2 (자구단은 ±1)
      const baseSpread = isOwnTeam ? 1 : Math.max(2, 12 - scoutLevel * 2);
      const bias = Math.round((rng() * 2 - 1) * (baseSpread * 0.6));
      const perceivedCenter = clamp(trueOvr + bias, 20, 110);

      const statRanges = {};
      const keys = this.type === "pitcher" ? P_KEYS : B_KEYS;
      keys.forEach((k) => {
        const tv = this.st[k];
        const sb = Math.round((rng() * 2 - 1) * (baseSpread * 0.6));
        statRanges[k] = [
          clamp(tv + sb - baseSpread, 20, 110),
          clamp(tv + sb + baseSpread, 20, 110)
        ];
      });

      this.scoutError = {
        ovrMin: clamp(perceivedCenter - baseSpread, 20, 110),
        ovrMax: clamp(perceivedCenter + baseSpread, 20, 110),
        statRanges,
        scoutedAtLevel: scoutLevel
      };
      return this.scoutError;
    }

    /**
     * 투수 ERA / WHIP 및 타자 AVG / OBP / SLG / OPS 산출 (0 나누기 NaN 방지 가드 포함)
     */
    getEra(rec = this.rec) {
      const ip = (rec && rec.ip) || 0;
      if (ip <= 0) return 0.0;
      return +(((rec.er || 0) * 9) / ip).toFixed(2);
    }

    getWhip(rec = this.rec) {
      const ip = (rec && rec.ip) || 0;
      if (ip <= 0) return 0.0;
      return +(((rec.h || 0) + (rec.bb || 0)) / ip).toFixed(2);
    }

    getAvg(rec = this.rec) {
      const ab = (rec && rec.ab) || 0;
      if (ab <= 0) return 0.0;
      return +((rec.h || 0) / ab).toFixed(3);
    }

    getObp(rec = this.rec) {
      const pa = (rec && rec.pa) || 0;
      if (pa <= 0) return 0.0;
      return +(((rec.h || 0) + (rec.bb || 0)) / pa).toFixed(3);
    }

    getSlg(rec = this.rec) {
      const ab = (rec && rec.ab) || 0;
      if (ab <= 0) return 0.0;
      const h = rec.h || 0, d = rec.d || 0, t = rec.t || 0, hr = rec.hr || 0;
      const singles = Math.max(0, h - d - t - hr);
      const tb = singles + d * 2 + t * 3 + hr * 4;
      return +(tb / ab).toFixed(3);
    }

    getOps(rec = this.rec) {
      return +(this.getObp(rec) + this.getSlg(rec)).toFixed(3);
    }

    /**
     * v16.8 공식 기반 타자 wOBA식 가치 ((1.8 * OBP + SLG) / 3)
     */
    getWoba(rec = this.rec) {
      if (this.type !== "batter") return 0;
      const pa = rec.pa || 0;
      const ab = rec.ab || 0;
      if (pa <= 0 || ab <= 0) return 0;
      const h = rec.h || 0, d = rec.d || 0, t = rec.t || 0, hr = rec.hr || 0, bb = rec.bb || 0;
      const obp = (h + bb) / pa;
      const singles = Math.max(0, h - d - t - hr);
      const tb = singles + d * 2 + t * 3 + hr * 4;
      const slg = tb / ab;
      return +((1.8 * obp + slg) / 3).toFixed(3);
    }

    /**
     * v16.8 공식 기반 시즌 WAR 산출
     * - 투수: ((5.10 - ERA) * IP / 9) / 9.2 + (SV * 0.035 + HLD * 0.02)
     * - 타자: ((wOBA - 0.315) / 1.40) * (PA / 10) + 포지션 보정 + 수비 보정 + 도루 보정
     */
    getWar(rec = this.rec) {
      if (this.type === "pitcher") {
        const ip = rec.ip || 0;
        if (ip <= 0) return 0;
        const era = ((rec.er || 0) * 9) / ip;
        const replacementEra = 5.10;
        const w = ((replacementEra - era) * (ip / 9)) / 9.2 + (rec.sv || 0) * 0.035 + (rec.hld || 0) * 0.02;
        return +clamp(w, -2.0, 11.0).toFixed(2);
      } else {
        const pa = rec.pa || 0;
        const ab = rec.ab || 0;
        if (pa <= 0 || ab <= 0) return 0;
        const woba = this.getWoba(rec);
        const batRuns = ((woba - 0.315) / 1.40) * (pa / 10);
        const posMeta = POSITIONS[this.pos] || POSITIONS.DH;
        const posAdj = (posMeta.warAdj || 0) * (pa / 600);
        const defAdj = ((this.st.defense || 50) - (posMeta.reqDef || 50)) * 0.012 * (pa / 600);
        const sbAdj = (rec.sb || 0) * 0.018 - (rec.cs || 0) * 0.030;
        return +clamp(batRuns + posAdj + defAdj + sbAdj, -2.0, 12.0).toFixed(2);
      }
    }

    /**
     * v16.8 공식 기반 비시즌 연령별 노쇠화(Decay) 적용
     */
    applyAgingDecay(rng = Math.random) {
      const keys = this.type === "pitcher" ? P_KEYS : B_KEYS;
      const lateMul = this.lateBloom ? 0.35 : 1.0;
      const ironMul = this.iron && this.age >= 35 ? DECAYP.ironMul : 1.0;
      const drops = {};

      keys.forEach((k) => {
        const raw = decayAt(k, this.age) * lateMul * ironMul;
        if (raw <= 0) return;
        const roll = 0.55 + rng() * 0.90;
        const dec = Math.round(raw * roll);
        if (dec > 0) {
          this.st[k] = clamp(this.st[k] - dec, 20, 110);
          drops[k] = dec;
        }
      });
      return drops;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 4. Team 클래스 정의 (KBO 10개 구단)
   * ═══════════════════════════════════════════════════════════════════════ */
  class Team {
    /**
     * @param {Object} init
     */
    constructor(init = {}) {
      this.id = init.id || "KIA";
      this.name = init.name || "광주 고양이즈";
      this.futuresName = init.futuresName || "함평 고양이즈";
      this.city = init.city || "광주";
      this.park = init.park || { name: "광주 챔피언스필드", hr: 0.98, xbh: 1.00, hit: 1.00, dome: false };

      // 재정 및 구단 운영 지표
      this.budget = Number.isFinite(Number(init.budget)) ? Number(init.budget) : 1400000; // 구단 예산 (만원 단위: 1,400,000 = 140억)
      this.ownerTrust = clamp(init.ownerTrust ?? 60, 0, 100); // 구단주 신임도 (0~100)
      this.fanRatio = clamp(init.fanRatio ?? 55, 0, 100);     // 팬 민심 (0~100)

      // 코칭스태프 (감독, 투수코치, 타격코치 — 저작권 보호 100% 가상 이름)
      this.coachingStaff = init.coachingStaff || {
        manager: {
          name: "한도훈",
          style: "균형", // '육성' | '윈나우' | '데이터' | '균형'
          tacticsBonus: 1.02,
          salary: 5000
        },
        pitchingCoach: {
          name: "구태준",
          specialty: "control", // 중점 육성 능력치
          trainBonus: 1.08,
          injuryPrevention: 0.94,
          salary: 2200
        },
        hittingCoach: {
          name: "마동현",
          specialty: "contact",
          trainBonus: 1.08,
          clutchBonus: 1.03,
          salary: 2200
        }
      };

      // 로스터: 1군(28명), 2군(30명), 육성선수(rosterDev), 6주 장기부상 외국인 재활명단(foreignRehabList), 상무 군보류 명단(militaryList)
      this.roster1G = Array.isArray(init.roster1G) ? init.roster1G.map((p) => (p instanceof Player ? p : new Player(p))) : [];
      this.roster2G = Array.isArray(init.roster2G) ? init.roster2G.map((p) => (p instanceof Player ? p : new Player(p))) : [];
      this.rosterDev = Array.isArray(init.rosterDev) ? init.rosterDev.map((p) => (p instanceof Player ? p : new Player(p))) : [];
      this.foreignRehabList = Array.isArray(init.foreignRehabList)
        ? init.foreignRehabList.map((p) => (p instanceof Player ? p : new Player(p)))
        : [];
      this.militaryList = Array.isArray(init.militaryList)
        ? init.militaryList.map((p) => (p instanceof Player ? p : new Player(p)))
        : [];

      // [PART 4 & 5] 구단 3대 인프라 시설 레벨(Lv.1~5), 비FA 다년 계약 내역, 경쟁균형세 내역, 보호선수 명단(20인/25인/35인), 구장 개조 내역
      this.facilities = init.facilities || {
        rehabCenter: 1,
        biomechLab: 1,
        scoutHq: 1
      };
      this.nonFAExtensions = Array.isArray(init.nonFAExtensions) ? init.nonFAExtensions : [];
      this.luxuryTaxHistory = Array.isArray(init.luxuryTaxHistory) ? init.luxuryTaxHistory : [];
      this.customProtectedIds = init.customProtectedIds || {
        FA_20: [],
        FA_25: [],
        DRAFT_35: []
      };
      this.parkRemodelHistory = Array.isArray(init.parkRemodelHistory) ? init.parkRemodelHistory : [];

      // 시즌 팀 성적 (1군 및 2군 퓨처스리그)
      this.record = init.record || { w: 0, l: 0, d: 0, rs: 0, ra: 0 };
      this.futuresRecord = init.futuresRecord || { w: 0, l: 0, d: 0, rs: 0, ra: 0 };
    }

    /**
     * 구단 전체 소속 선수 배열 반환
     */
    getAllPlayers() {
      return [...this.roster1G, ...this.roster2G, ...this.rosterDev];
    }

    /**
     * 구단 선수단 + 코칭스태프 총 연봉(Payroll, 만원 단위) 계산
     */
    getTotalPayroll() {
      const playerPay = this.getAllPlayers().reduce((sum, p) => sum + (p.salary || 0), 0);
      const staff = this.coachingStaff || {};
      const staffPay =
        ((staff.manager && staff.manager.salary) || 0) +
        ((staff.pitchingCoach && staff.pitchingCoach.salary) || 0) +
        ((staff.hittingCoach && staff.hittingCoach.salary) || 0);
      return playerPay + staffPay;
    }

    /**
     * 가용 잔여 예산(만원 단위) 반환
     */
    getAvailableBudget() {
      return this.budget - this.getTotalPayroll();
    }

    /**
     * 선수 엔트리 이동 ('1GUN' | '2GUN' | 'YUKSEONG')
     * - [규정 6] 외국인 선수는 육성군(rosterDev / 'YUKSEONG')에 절대 등록할 수 없음 (1군 또는 2군만 가능)
     */
    movePlayerStatus(playerId, targetStatus) {
      const all = this.getAllPlayers();
      const target = all.find((p) => p.id === playerId);
      if (!target) return { ok: false, reason: "선수를 찾을 수 없습니다." };

      if (targetStatus === "YUKSEONG" && target.nationality && target.nationality !== "KOR") {
        return {
          ok: false,
          reason: "외국인 선수는 육성군(YUKSEONG)에 등록할 수 없습니다. (1군 또는 2군만 가능)"
        };
      }

      if (targetStatus === "1GUN" && this.roster1G.length >= 28 && target.status !== "1GUN") {
        return { ok: false, reason: "1군 엔트리 정원(28명)이 가득 찼습니다." };
      }
      if (targetStatus === "2GUN" && this.roster2G.length >= 30 && target.status !== "2GUN") {
        return { ok: false, reason: "2군 엔트리 정원(30명)이 가득 찼습니다." };
      }

      this.roster1G = this.roster1G.filter((p) => p.id !== playerId);
      this.roster2G = this.roster2G.filter((p) => p.id !== playerId);
      this.rosterDev = this.rosterDev.filter((p) => p.id !== playerId);

      target.status = targetStatus;
      if (targetStatus === "1GUN") this.roster1G.push(target);
      else if (targetStatus === "2GUN") this.roster2G.push(target);
      else this.rosterDev.push(target);

      return { ok: true, player: target };
    }
  }

  const TEAM_ID_ALIASES = {
    SAMSUNG: "SAM",
    DOOSAN: "DOO",
    LOTTE: "LOT",
    HANWHA: "HAN",
    KIWOOM: "KIW",
    HEROES: "KIW",
    BEARS: "DOO",
    LIONS: "SAM",
    GIANTS: "LOT",
    EAGLES: "HAN",
    TIGERS: "KIA",
    TWINS: "LG",
    WIZ: "KT",
    LANDERS: "SSG",
    DINOS: "NC"
  };

  function normalizeTeamId(id) {
    if (!id) return "KIA";
    const upper = String(id).trim().toUpperCase();
    return TEAM_ID_ALIASES[upper] || upper;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 5. GMGameContext 클래스 정의 (전체 게임 상태)
   * ═══════════════════════════════════════════════════════════════════════ */
  class GMGameContext {
    /**
     * @param {Object} init
     */
    constructor(init = {}) {
      this.version = "1.0.0";
      this.slotId = init.slotId || "slot_1";
      this.userTeamId = normalizeTeamId(init.userTeamId || "KIA");
      this.startYear = init.startYear || 2025;
      this.currentYear = init.currentYear || this.startYear || 2025;
      this.currentWeek = init.currentWeek || 1;
      this.currentDate = init.currentDate || `${this.currentYear}-01-01`;
      this.scoutLevel = clamp(init.scoutLevel ?? 1, 1, 5); // 스카우트 팀 역량 (1~5단계)
      this.gmProfile = init.gmProfile || {
        name: "김단장",
        trait: "DATA_ANALYST",
        traitLabel: "데이터 분석가"
      };
      // [규정 1] 단장 초기 계약: 3년 총액 8억 원 (계약금 2억 원 + 연봉 2억 원) 고정
      this.gmContract = init.gmContract || {
        yearsTotal: 3,
        yearsLeft: 3,
        startYear: this.startYear,
        endYear: this.startYear + 2,
        signingBonus: 20000,   // 계약금 2억 원 (20,000만 원)
        annualSalary: 20000,   // 연봉 2억 원 (20,000만 원)
        totalAmount: 80000,    // 총액 8억 원 (80,000만 원)
        status: "ACTIVE"
      };
      // [규정 4] 고교 1~3학년 및 대학 리그 스카우트 파견 현황
      this.scoutDispatch = init.scoutDispatch || {
        maxScouts: Math.max(3, this.scoutLevel + 2),
        allocation: { HS_1: 1, HS_2: 1, HS_3: 2, UNIV: 1 }
      };
      this.releasedForeignArchives = Array.isArray(init.releasedForeignArchives)
        ? init.releasedForeignArchives
        : [];
      this.tradeHistory = Array.isArray(init.tradeHistory) ? init.tradeHistory : [];
      this.tradedPicks = Array.isArray(init.tradedPicks) ? init.tradedPicks : [];
      this.budgetRequestCountThisYear = Number(init.budgetRequestCountThisYear) || 0;
      this.releasedCountThisYear = Number(init.releasedCountThisYear) || 0;
      this.negotiationDiscount = Number.isFinite(init.negotiationDiscount)
        ? init.negotiationDiscount
        : this.gmProfile && this.gmProfile.trait === "NEGOTIATOR"
          ? 0.05
          : 0;

      this.kboTeams = Array.isArray(init.kboTeams)
        ? init.kboTeams.map((t) => (t instanceof Team ? t : new Team(t)))
        : [];
      this.npbPool = Array.isArray(init.npbPool)
        ? init.npbPool.map((p) => (p instanceof Player ? p : new Player(p)))
        : [];
      this.draftPool = Array.isArray(init.draftPool)
        ? init.draftPool.map((p) => (p instanceof Player ? p : new Player(p)))
        : [];
      this.faPool = Array.isArray(init.faPool)
        ? init.faPool.map((p) => (p instanceof Player ? p : new Player(p)))
        : [];
      this.standings = Array.isArray(init.standings) ? init.standings : [];
      this.weeklyLogs = Array.isArray(init.weeklyLogs) ? init.weeklyLogs : [];

      // [PART 4 & 5] 포스트시즌 히스토리, 격년 2차 드래프트 히스토리, 경쟁균형세 페널티, MLB 포스팅 히스토리, 오늘의 할 일 로그
      this.postseasonHistory = Array.isArray(init.postseasonHistory) ? init.postseasonHistory : [];
      this.biennialDraftHistory = Array.isArray(init.biennialDraftHistory) ? init.biennialDraftHistory : [];
      this.luxuryTaxPenalties = init.luxuryTaxPenalties || null;
      this.postingHistory = Array.isArray(init.postingHistory) ? init.postingHistory : [];
      this.assistantLogs = Array.isArray(init.assistantLogs) ? init.assistantLogs : [];
    }

    /**
     * 유저가 맡은 구단 객체 반환
     */
    getUserTeam() {
      const target = normalizeTeamId(this.userTeamId);
      return this.kboTeams.find((t) => t.id === target) || this.kboTeams[0] || null;
    }

    /**
     * 구단 ID로 특정 KBO 구단 객체 반환
     */
    getTeam(teamId) {
      const target = normalizeTeamId(teamId);
      return this.kboTeams.find((t) => t.id === target) || null;
    }

    /**
     * 스카우트 레벨 변경 시 전체 선수 스카우팅 오차(Fog of War) 일괄 재계산
     */
    refreshAllScoutingReports(rng = Math.random) {
      this.kboTeams.forEach((team) => {
        const isOwn = team.id === this.userTeamId;
        team.getAllPlayers().forEach((p) => p.updateScoutingReport(this.scoutLevel, isOwn, rng));
      });
      this.npbPool.forEach((p) => p.updateScoutingReport(this.scoutLevel, false, rng));
      this.draftPool.forEach((p) => p.updateScoutingReport(this.scoutLevel, false, rng));
      this.faPool.forEach((p) => p.updateScoutingReport(this.scoutLevel, false, rng));
    }

    /**
     * 브라우저 LocalStorage 저장 (Serverless Client-Side)
     */
    saveToStorage(storageKey = "kbo_gm_context_v1") {
      if (typeof localStorage === "undefined") return false;
      try {
        localStorage.setItem(storageKey, JSON.stringify(this));
        return true;
      } catch (e) {
        return false;
      }
    }

    static loadFromStorage(storageKey = "kbo_gm_context_v1") {
      if (typeof localStorage === "undefined") return null;
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return null;
        return new GMGameContext(JSON.parse(raw));
      } catch (e) {
        return null;
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 6. 초기 샘플 데이터 생성기 (Init Generator)
   *    - KBO 10개 구단 (구단별 1군 28명 + 2군 30명 + 육성 8명 = 66명, 총 660명)
   *    - NPB/해외 외국인 후보군 300명
   *    - 고교/대학 신인 드래프트 풀 200명
   * ═══════════════════════════════════════════════════════════════════════ */
  const KOR_SUR = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권", "황", "안", "송", "전", "홍"];
  const KOR_GIV = ["민준", "서준", "도윤", "예준", "시우", "하준", "주원", "지호", "지후", "준서", "준우", "현우", "도현", "지훈", "건우", "우진", "선우", "서진", "민재", "현준", "연우", "유준", "정우", "승우", "승현", "시윤", "준혁", "은우", "지환", "승민", "지우", "유찬", "윤우", "민성", "준영", "시현", "진우", "수현", "동현", "재윤", "태윤", "민규", "재민", "한결", "민우", "동건", "태민", "성민", "성현", "규민"];
  const JPN_SUR = ["사토", "스즈키", "다카하시", "다나카", "와타나베", "이토", "야마모토", "나카무라", "고바야시", "가토", "요시다", "야마구치", "마쓰모토", "이노우에", "기무라"];
  const JPN_GIV = ["쇼타", "렌", "하루토", "유토", "소타", "유마", "다이키", "카이토", "리쿠", "겐타", "다쿠미", "료", "고키", "유키", "하야토"];
  const WEST_FIRST = ["오스틴", "케이시", "에릭", "제임스", "카일", "타일러", "브랜든", "코디", "아리엘", "라울", "펠릭스", "요니", "길예르모", "멜", "빅터"];
  const WEST_LAST = ["딘", "켈리", "페디", "뷰캐넌", "알칸타라", "수아레즈", "미란다", "반즈", "산체스", "소크라테스", "에레디아", "로하스", "데이비슨", "위즈덤", "레이예스"];

  const SECONDARY_PITCH_POOL = ["SL", "CB", "CH", "FK", "SP", "FC", "FT", "SW", "SI", "PC"];

  function randomName(nat = "KOR", rng = Math.random) {
    if (nat === "JPN") return `${pick(JPN_SUR, rng)} ${pick(JPN_GIV, rng)}`;
    if (nat !== "KOR") return `${pick(WEST_FIRST, rng)} ${pick(WEST_LAST, rng)}`;
    return `${pick(KOR_SUR, rng)}${pick(KOR_GIV, rng)}`;
  }

  function generatePitches(baseOvr, rng = Math.random) {
    const pitches = [{ k: "FF", m: clamp(Math.round(baseOvr + randInt(-6, 10, rng)), 35, 98) }];
    const count = randInt(2, 4, rng);
    const used = new Set(["FF"]);
    while (pitches.length < count) {
      const pk = pick(SECONDARY_PITCH_POOL, rng);
      if (used.has(pk)) continue;
      used.add(pk);
      pitches.push({ k: pk, m: clamp(Math.round(baseOvr - 6 + randInt(-10, 10, rng)), 25, 95) });
    }
    return pitches;
  }

  function generatePlayer({
    pos,
    status,
    teamId = null,
    tierMean = 70,
    tierSpread = 8,
    ageRange = [20, 35],
    nationality = "KOR",
    origin = "KBO",
    scoutLevel = 1,
    isOwnTeam = false,
    rng = Math.random
  }) {
    const posMeta = POSITIONS[pos] || POSITIONS.SP;
    const type = posMeta.group;
    const keys = type === "pitcher" ? P_KEYS : B_KEYS;
    const age = randInt(ageRange[0], ageRange[1], rng);

    const st = {};
    keys.forEach((k) => {
      let bonus = 0;
      if (pos === "SP" && k === "stamina") bonus = 7;
      if ((pos === "CP" || pos === "RP") && (k === "stuff" || k === "velo")) bonus = 5;
      if (["C", "SS", "2B", "CF"].includes(pos) && k === "defense") bonus = 6;
      if (["1B", "3B", "LF", "RF", "DH"].includes(pos) && k === "power") bonus = 6;
      st[k] = clamp(Math.round(tierMean + bonus + (rng() * 2 - 1) * tierSpread), 32, 105);
    });

    const ovrEstimate = keys.reduce((a, k) => a + st[k], 0) / keys.length;
    const potential = clamp(Math.round(ovrEstimate + Math.max(0, (27 - age) * 1.8) + randInt(0, 12, rng)), Math.round(ovrEstimate), 108);

    // 연봉 및 FA 연차 계산
    let salary = 3000;
    let contractYears = 1;
    let faYears = 0;

    if (status === "DRAFT_POOL") {
      salary = 3000;
      contractYears = 1;
      faYears = 0;
    } else if (status === "YUKSEONG") {
      salary = 3000;
      contractYears = 1;
      faYears = 0;
    } else if (status === "FOREIGN_POOL") {
      // NPB/외국인 후보군: 희망 연봉 4억 ~ 18억 수준
      salary = Math.round(clamp((ovrEstimate - 65) * 4500 + randInt(35000, 55000, rng), 35000, 180000) / 100) * 100;
      contractYears = 1;
      faYears = 0;
    } else {
      faYears = status === "1GUN" ? clamp(age - 20 - randInt(0, 3, rng), 0, 8) : clamp(age - 22 - randInt(0, 4, rng), 0, 5);
      if (status === "1GUN") {
        const baseSal = ovrEstimate >= 85 ? 65000 : ovrEstimate >= 78 ? 32000 : ovrEstimate >= 72 ? 14000 : 6500;
        salary = Math.round((baseSal + randInt(-2000, 8000, rng)) / 100) * 100;
        contractYears = ovrEstimate >= 82 && age >= 28 && rng() < 0.45 ? randInt(2, 4, rng) : 1;
      } else {
        salary = Math.round(clamp(3000 + (age - 19) * 350 + randInt(0, 1500, rng), 3000, 9000) / 100) * 100;
        contractYears = 1;
      }
    }

    const throws = type === "pitcher" ? (rng() < 0.30 ? "L" : "R") : (rng() < 0.12 ? "L" : "R");
    const bats = type === "batter" ? (rng() < 0.04 ? "S" : rng() < 0.36 ? "L" : "R") : throws;

    return new Player({
      name: randomName(nationality, rng),
      nationality,
      origin,
      pos,
      type,
      throws,
      bats,
      age,
      potential,
      iron: rng() < DECAYP.ironP,
      lateBloom: rng() < 0.08,
      st,
      pitches: type === "pitcher" ? generatePitches(ovrEstimate, rng) : [],
      teamId,
      status,
      salary,
      contractYears,
      faYears,
      scoutLevel,
      isOwnTeam
    });
  }

  // 1군 28명 표준 포지션 구성 (투수 13명 + 야수 15명)
  const ROSTER_1G_TEMPLATE = [
    "SP", "SP", "SP", "SP", "SP",
    "RP", "RP", "RP", "RP", "RP", "RP", "RP",
    "CP",
    "C", "C",
    "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH",
    "C", "SS", "2B", "CF", "1B"
  ];

  // 2군 30명 표준 포지션 구성 (투수 15명 + 야수 15명)
  const ROSTER_2G_TEMPLATE = [
    "SP", "SP", "SP", "SP", "SP",
    "RP", "RP", "RP", "RP", "RP", "RP", "RP", "RP", "RP",
    "CP",
    "C", "C", "C",
    "1B", "1B", "2B", "2B", "3B", "3B", "SS", "SS", "LF", "CF", "RF", "DH"
  ];

  // 육성선수 8명 구성
  const ROSTER_DEV_TEMPLATE = ["SP", "RP", "RP", "C", "SS", "2B", "CF", "3B"];

  /**
   * 전체 단장 모드 컨텍스트 초기화 함수
   * @param {Object} options
   * @returns {GMGameContext}
   */
  function initGMGameContext(options = {}) {
    const userTeamId = normalizeTeamId(options.userTeamId || "KIA");
    const scoutLevel = clamp(options.scoutLevel ?? 1, 1, 5);
    const rng = options.rng || Math.random;

    // 1. KBO 10개 구단 생성
    const kboTeams = KBO_TEAM_META.map((meta) => {
      const isOwnTeam = meta.id === userTeamId;

      const roster1G = ROSTER_1G_TEMPLATE.map((pos, idx) => {
        // 구단별 외국인 선수 3명 (선발 2, 야수 1) 배치
        const isForeign = idx === 0 || idx === 1 || idx === 15;
        const nat = isForeign ? pick(["USA", "DOM", "VEN"], rng) : "KOR";
        const tierMean = isForeign ? 81 : idx < 23 ? 74 : 67;
        return generatePlayer({
          pos,
          status: "1GUN",
          teamId: meta.id,
          tierMean,
          tierSpread: 7,
          ageRange: isForeign ? [26, 33] : [21, 37],
          nationality: nat,
          origin: isForeign ? "AAA" : "KBO",
          scoutLevel,
          isOwnTeam,
          rng
        });
      });

      const roster2G = ROSTER_2G_TEMPLATE.map((pos) =>
        generatePlayer({
          pos,
          status: "2GUN",
          teamId: meta.id,
          tierMean: 59,
          tierSpread: 7,
          ageRange: [19, 31],
          nationality: "KOR",
          origin: "KBO",
          scoutLevel,
          isOwnTeam,
          rng
        })
      );

      const rosterDev = ROSTER_DEV_TEMPLATE.map((pos) =>
        generatePlayer({
          pos,
          status: "YUKSEONG",
          teamId: meta.id,
          tierMean: 51,
          tierSpread: 6,
          ageRange: [19, 24],
          nationality: "KOR",
          origin: rng() < 0.65 ? "HS" : "UNIV",
          scoutLevel,
          isOwnTeam,
          rng
        })
      );

      return new Team({
        id: meta.id,
        name: meta.name,
        futuresName: meta.futures,
        city: meta.city,
        park: meta.park,
        budget: meta.baseBudget,
        ownerTrust: 60,
        fanRatio: 55,
        roster1G,
        roster2G,
        rosterDev
      });
    });

    // 2. NPB / 해외 외국인 후보군 300명 생성
    const foreignPositions = ["SP", "SP", "SP", "RP", "CP", "1B", "3B", "LF", "CF", "RF", "DH"];
    const npbPool = [];
    for (let i = 0; i < 300; i++) {
      const isNpb = i < 150;
      const nat = isNpb ? (rng() < 0.75 ? "JPN" : pick(["USA", "DOM", "TWN"], rng)) : pick(["USA", "DOM", "VEN"], rng);
      const pos = pick(foreignPositions, rng);
      npbPool.push(
        generatePlayer({
          pos,
          status: "FOREIGN_POOL",
          teamId: null,
          tierMean: isNpb ? 77 : 75,
          tierSpread: 9,
          ageRange: [24, 34],
          nationality: nat,
          origin: isNpb ? "NPB" : "AAA",
          scoutLevel,
          isOwnTeam: false,
          rng
        })
      );
    }

    // 3. 고교 / 대학 아마추어 드래프트 풀 200명 생성
    const draftPositions = ["SP", "SP", "RP", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
    const draftPool = [];
    for (let i = 0; i < 200; i++) {
      const isUniv = rng() < 0.35;
      const pos = pick(draftPositions, rng);
      // 상위 유망주(Top 20)는 초기 능력치와 잠재력이 높음
      const isTopProspect = i < 20;
      const p = generatePlayer({
        pos,
        status: "DRAFT_POOL",
        teamId: null,
        tierMean: isTopProspect ? (isUniv ? 61 : 57) : (isUniv ? 53 : 48),
        tierSpread: 6,
        ageRange: isUniv ? [22, 22] : [18, 18],
        nationality: "KOR",
        origin: isUniv ? "UNIV" : "HS",
        scoutLevel,
        isOwnTeam: false,
        rng
      });
      if (isTopProspect) {
        p.potential = clamp(randInt(88, 106, rng), 88, 108);
      }
      draftPool.push(p);
    }

    return new GMGameContext({
      userTeamId,
      currentYear: options.currentYear || 2026,
      currentWeek: 1,
      scoutLevel,
      kboTeams,
      npbPool,
      draftPool,
      faPool: []
    });
  }

  return {
    P_KEYS,
    B_KEYS,
    LABEL,
    PITCHES,
    POSITIONS,
    DECAY,
    DECAYP,
    KBO_TEAM_META,
    grade,
    kmh,
    costFor,
    ageCoef,
    decayAccel,
    decayAt,
    Player,
    Team,
    GMGameContext,
    createEmptySeasonRecord,
    generatePlayer,
    initGMGameContext
  };
});
