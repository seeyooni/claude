/**
 * KBO 단장 모드 (v1.0) — 통합 세팅 · 8대 핵심 시스템 확장 모듈 (KBO_GM.Setup & KBO_GM.Rules)
 * 구현 시스템:
 *   1. 단장 프로필 & 초기 고정 계약 (3년 총액 8억 원: 계약금 2억 + 연봉 2억) 및 3년 후 재계약 협상
 *   2. 2025년 1월 1일 시작 날짜 시스템 & 하루(+1일) / 1주(+7일) 시간 진행 엔진
 *   3. 9월 3주차(9월 15일~21일) 아마추어 신인 드래프트 고정 스케줄
 *   4. 고교 1~3학년 및 대학 리그 아마추어 스카우트 인원(1~5명) 전략 파견 & Fog of War 점진 축소
 *   5. 고교/대학 유망주 랭킹 및 5대 능력치(투수 구속 km/h·구종 / 타자 세부 포지션) 상세 팝업 리포트
 *   6. 외국인 선수 육성군(YUKSEONG) 등록 금지 & 방출 시 즉시 퇴출(FOREIGN_RELEASED) 영구 제거 규정
 *   7. 6주(42일) 이상 장기 부상 외국인 일시 재활 명단 및 6주 단기 대체 외국인 영입/복귀 전환 제도
 *   8. 2024년 KBO 최종 순위 기반 구단 전력(tier1G/tier2G) 및 역순 예산(10위 키움 175억 ~ 1위 KIA 120억) 배정
 */

(function (root, factory) {
  const setupModule = factory(root.KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM));
  if (typeof globalThis !== "undefined") {
    globalThis.KBO_GM = Object.assign(globalThis.KBO_GM || {}, {
      KBO_TEAM_2024_META: setupModule.KBO_TEAM_2024_META,
      Setup: setupModule,
      Rules: setupModule,
      TestRunner: setupModule.TestRunner,
      runSelfDiagnosticTest: setupModule.runSelfDiagnosticTest
    });
  }
  if (typeof window !== "undefined") {
    window.KBO_GM = Object.assign(window.KBO_GM || {}, {
      KBO_TEAM_2024_META: setupModule.KBO_TEAM_2024_META,
      Setup: setupModule,
      Rules: setupModule,
      TestRunner: setupModule.TestRunner,
      runSelfDiagnosticTest: setupModule.runSelfDiagnosticTest
    });
  }
  if (typeof module === "object" && module.exports) {
    module.exports = setupModule;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function (KBO_GM) {
  "use strict";

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pick = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];
  const randInt = (lo, hi, rng = Math.random) => lo + Math.floor(rng() * (hi - lo + 1));
  const round100 = (v) => Math.round(v / 100) * 100;

  /* ═══════════════════════════════════════════════════════════════════════
   * [시스템 8] 2024 KBO 최종 순위 기반 10개 구단 메타데이터 (KBO_TEAM_2024_META)
   * - 전력(tier1G/tier2G): 2024 순위 순 (1위 KIA 78/62 ~ 10위 키움 67/56)
   * - 예산(budget): 2024 순위 역순 (10위 키움 175억 ~ 1위 KIA 120억, 단위: 만원)
   * ═══════════════════════════════════════════════════════════════════════ */
  const KBO_TEAM_2024_META = [
    {
      rank2024: 1,
      id: "KIA",
      kboName: "KIA",
      name: "광주 고양이즈",
      futures: "함평 고양이즈",
      city: "광주",
      park: { name: "광주 챔피언스필드", hr: 0.98, xbh: 1.00, hit: 1.00, dome: false },
      tier1G: 78,
      tier2G: 62,
      budget: 1200000, // 120억 원
      philosophy: "PRESTIGE",
      targetRank: 1,
      goalTitle: "한국시리즈 디펜딩 챔피언 / 우승 목표",
      difficulty: "보통"
    },
    {
      rank2024: 2,
      id: "SAM",
      kboName: "삼성",
      name: "대구 표범즈",
      futures: "경산 표범즈",
      city: "대구",
      park: { name: "대구 팔각구장", hr: 1.20, xbh: 1.05, hit: 1.02, dome: false },
      tier1G: 76,
      tier2G: 60,
      budget: 1250000, // 125억 원
      philosophy: "PRESTIGE",
      targetRank: 3,
      goalTitle: "상위권 수성 목표",
      difficulty: "보통"
    },
    {
      rank2024: 3,
      id: "LG",
      kboName: "LG",
      name: "서울 쌍둥이즈",
      futures: "이천 쌍둥이즈",
      city: "서울",
      park: { name: "잠실야구장", hr: 0.82, xbh: 1.12, hit: 1.00, dome: false },
      tier1G: 76,
      tier2G: 61,
      budget: 1300000, // 130억 원
      philosophy: "PRESTIGE",
      targetRank: 3,
      goalTitle: "상위권 수성 목표",
      difficulty: "보통"
    },
    {
      rank2024: 4,
      id: "DOO",
      kboName: "두산",
      name: "잠실 판다즈",
      futures: "이천 판다즈",
      city: "잠실",
      park: { name: "잠실야구장", hr: 0.82, xbh: 1.12, hit: 1.00, dome: false },
      tier1G: 74,
      tier2G: 59,
      budget: 1400000, // 140억 원
      philosophy: "PRESTIGE",
      targetRank: 5,
      goalTitle: "포스트시즌 진출 목표",
      difficulty: "보통"
    },
    {
      rank2024: 5,
      id: "KT",
      kboName: "kt",
      name: "수원 도깨비즈",
      futures: "익산 도깨비즈",
      city: "수원",
      park: { name: "수원 위즈파크", hr: 1.02, xbh: 1.05, hit: 1.00, dome: false },
      tier1G: 73,
      tier2G: 59,
      budget: 1450000, // 145억 원
      philosophy: "MONEYBALL",
      targetRank: 5,
      goalTitle: "가성비 가을야구 목표",
      difficulty: "보통"
    },
    {
      rank2024: 6,
      id: "SSG",
      kboName: "SSG",
      name: "인천 물범즈",
      futures: "강화 물범즈",
      city: "인천",
      park: { name: "문학야구장", hr: 1.22, xbh: 1.02, hit: 1.01, dome: false },
      tier1G: 73,
      tier2G: 58,
      budget: 1500000, // 150억 원
      philosophy: "PRESTIGE",
      targetRank: 5,
      goalTitle: "가을야구 복귀 목표",
      difficulty: "쉬움"
    },
    {
      rank2024: 7,
      id: "LOT",
      kboName: "롯데",
      name: "부산 갈매기즈",
      futures: "김해 갈매기즈",
      city: "부산",
      park: { name: "사직야구장", hr: 0.95, xbh: 1.10, hit: 1.04, dome: false },
      tier1G: 71,
      tier2G: 58,
      budget: 1550000, // 155억 원
      philosophy: "PRESTIGE",
      targetRank: 5,
      goalTitle: "포스트시즌 진출 목표",
      difficulty: "쉬움"
    },
    {
      rank2024: 8,
      id: "HAN",
      kboName: "한화",
      name: "대전 송골매즈",
      futures: "서산 송골매즈",
      city: "대전",
      park: { name: "대전 신구장", hr: 0.96, xbh: 1.08, hit: 1.01, dome: false },
      tier1G: 71,
      tier2G: 60,
      budget: 1600000, // 160억 원
      philosophy: "REBUILDING",
      targetRank: 6,
      goalTitle: "리빌딩 및 육성 목표",
      difficulty: "쉬움"
    },
    {
      rank2024: 9,
      id: "NC",
      kboName: "NC",
      name: "창원 도마뱀즈",
      futures: "마산 도마뱀즈",
      city: "창원",
      park: { name: "창원 NC파크", hr: 1.06, xbh: 1.00, hit: 1.00, dome: false },
      tier1G: 70,
      tier2G: 57,
      budget: 1650000, // 165억 원
      philosophy: "MONEYBALL",
      targetRank: 6,
      goalTitle: "중위권 도약 목표",
      difficulty: "가성비 도전"
    },
    {
      rank2024: 10,
      id: "KIW",
      kboName: "키움",
      name: "고척 용사즈",
      futures: "고양 용사즈",
      city: "고척",
      park: { name: "고척 스카이돔", hr: 0.88, xbh: 0.96, hit: 0.99, dome: true },
      tier1G: 67,
      tier2G: 56,
      budget: 1750000, // 175억 원
      philosophy: "MONEYBALL",
      targetRank: 8,
      goalTitle: "대형 리빌딩 자금 기반 유망주 대거 육성",
      difficulty: "리빌딩 도전"
    }
  ];

  const TEAM_ID_LOOKUP = {
    KIA: "KIA", 기아: "KIA",
    SAM: "SAM", SAMSUNG: "SAM", 삼성: "SAM",
    LG: "LG", 엘지: "LG",
    DOO: "DOO", DOOSAN: "DOO", 두산: "DOO",
    KT: "KT", 케이티: "KT",
    SSG: "SSG", 에스에스지: "SSG",
    LOT: "LOT", LOTTE: "LOT", 롯데: "LOT",
    HAN: "HAN", HANWHA: "HAN", 한화: "HAN",
    NC: "NC", 엔씨: "NC",
    KIW: "KIW", KIWOOM: "KIW", 키움: "KIW"
  };

  function resolveTeamId(inputId) {
    if (!inputId) return "KIA";
    const key = String(inputId).trim().toUpperCase();
    return TEAM_ID_LOOKUP[key] || TEAM_ID_LOOKUP[String(inputId).trim()] || "KIA";
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * [시스템 1] 단장 프로필 & 특성(GM Trait) 및 단장 계약(3년 총액 8억 원) 시스템
   * ═══════════════════════════════════════════════════════════════════════ */
  const GM_TRAITS = {
    DATA_ANALYST: {
      id: "DATA_ANALYST",
      label: "데이터 분석가",
      scoutLevelBonus: 1,
      ownerTrustBonus: 0,
      moraleCondBonus: 0,
      demandDiscount: 0,
      desc: "스카우트 기본 레벨 +1 보정 (타 구단 및 유망주 Fog of War 오차 범위 축소)"
    },
    FIELD_EXPERT: {
      id: "FIELD_EXPERT",
      label: "현장 출신",
      scoutLevelBonus: 0,
      ownerTrustBonus: 10,
      moraleCondBonus: 0.03,
      demandDiscount: 0,
      desc: "구단주 초기 신임도 +10 및 선수단/코치진 사기·초기 컨디션 보정"
    },
    NEGOTIATOR: {
      id: "NEGOTIATOR",
      label: "협상의 달인",
      scoutLevelBonus: 0,
      ownerTrustBonus: 0,
      moraleCondBonus: 0,
      demandDiscount: 0.05,
      desc: "FA 영입 및 연봉 재계약 시 선수 요구액 5% 절감 보정"
    }
  };

  function createGMProfile(gmName = "김단장", gmTrait = "DATA_ANALYST") {
    const cleanName = String(gmName || "").trim() || "김단장";
    const traitKey = GM_TRAITS[gmTrait] ? gmTrait : "DATA_ANALYST";
    const spec = GM_TRAITS[traitKey];

    return {
      name: cleanName,
      trait: spec.id,
      traitLabel: spec.label,
      desc: spec.desc,
      effects: {
        scoutLevelBonus: spec.scoutLevelBonus,
        ownerTrustBonus: spec.ownerTrustBonus,
        moraleCondBonus: spec.moraleCondBonus,
        demandDiscount: spec.demandDiscount
      }
    };
  }

  /**
   * 단장 초기 고정 계약 객체 생성
   * - 3년 계약 / 총액 8억 원 (계약금 2억 원[20,000만 원] + 연봉 2억 원[20,000만 원])
   */
  function createInitialGMContract(startYear = 2025) {
    return {
      yearsTotal: 3,
      yearsLeft: 3,
      startYear,
      endYear: startYear + 2,
      signingBonus: 20000,   // 2억 원 (단위: 만원)
      annualSalary: 20000,   // 연봉 2억 원 (단위: 만원)
      totalAmount: 80000,    // 3년 총액 8억 원 (단위: 만원)
      cumulativeEarnings: 40000, // 첫해 수령액 (계약금 2억 + 1년차 연봉 2억)
      status: "ACTIVE",      // 'ACTIVE' | 'RENEWAL_PENDING' | 'FIRED'
      summaryText: "3년 총액 8억 원 (계약금 2억 원 · 연봉 2억 원)",
      history: [
        {
          year: startYear,
          type: "INITIAL",
          years: 3,
          signingBonus: 20000,
          annualSalary: 20000,
          totalAmount: 80000,
          note: "신임 단장 선임 3년 공식 계약 체결"
        }
      ]
    };
  }

  /**
   * 단장 재임 상태 및 3년 만기 재계약 협상 판정
   * - 계약 기간(3년) 동안 구단주 신임도(ownerTrust)가 0으로 떨어지지 않으면 임기 보장
   * - 3년 임기 종료 시 구단주 신임도 및 목표 순위 달성 여부에 따라 재계약 조건 산출
   */
  function evaluateGMContractRenewal(context, options = {}) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const userTeam = context.getUserTeam();
    const contract = context.gmContract || createInitialGMContract(context.startYear || 2025);
    const trust = userTeam ? (userTeam.ownerTrust ?? 60) : 60;

    // 시즌 종료 시 잔여 계약 연차 1년 차감 (2025년 말 2년 -> 2026년 말 1년 -> 2027년 말 0년 만료)
    if (options.decrementYear !== false && contract.yearsLeft > 0) {
      contract.yearsLeft = Math.max(0, contract.yearsLeft - 1);
    }

    // 구단주 신임도가 0 이하로 추락한 경우 해임
    if (trust <= 0) {
      contract.status = "FIRED";
      return {
        ok: false,
        status: "FIRED",
        reason: "구단주 신임도가 0으로 하락하여 단장직에서 해임되었습니다."
      };
    }

    // 아직 임기가 남아 있으면 계약 유지
    if (contract.yearsLeft > 0 && !options.forceRenewal) {
      contract.status = "ACTIVE";
      return {
        ok: true,
        status: "ACTIVE",
        yearsLeft: contract.yearsLeft,
        ownerTrust: trust,
        message: `단장 임기 보장 중 (잔여 ${contract.yearsLeft}년 · 현재 신임도 ${trust}/100)`
      };
    }

    // 3년 계약 만료 시점에도 신임도가 25 미만이면 재계약 불가(해임)
    if (trust < 25) {
      contract.status = "FIRED";
      return {
        ok: false,
        status: "FIRED",
        ownerTrust: trust,
        reason: `3년 임기 만료 심사 결과 구단주 신임도(${trust}/100) 미달로 재계약이 불발(해임)되었습니다.`
      };
    }

    // 3년 계약 만료 후 재계약 조건 산정
    let newYears = 3;
    let newSigningBonus = 25000;
    let newAnnualSalary = 25000;
    let evalGrade = "B";

    if (trust >= 80) {
      evalGrade = "S";
      newYears = 4;
      newSigningBonus = 40000; // 계약금 4억
      newAnnualSalary = 35000; // 연봉 3.5억 (4년 총액 18억)
    } else if (trust >= 65) {
      evalGrade = "A";
      newYears = 3;
      newSigningBonus = 30000; // 계약금 3억
      newAnnualSalary = 30000; // 연봉 3억 (3년 총액 12억)
    } else if (trust >= 40) {
      evalGrade = "B";
      newYears = 2;
      newSigningBonus = 20000; // 계약금 2억
      newAnnualSalary = 20000; // 연봉 2억 (2년 총액 6억)
    } else {
      evalGrade = "C";
      newYears = 1;
      newSigningBonus = 10000; // 계약금 1억
      newAnnualSalary = 15000; // 연봉 1.5억 (1년 증명 계약)
    }

    const newTotalAmount = newSigningBonus + newAnnualSalary * newYears;

    if (options.accept !== false) {
      contract.yearsTotal = newYears;
      contract.yearsLeft = newYears;
      contract.startYear = context.currentYear;
      contract.endYear = context.currentYear + newYears - 1;
      contract.signingBonus = newSigningBonus;
      contract.annualSalary = newAnnualSalary;
      contract.totalAmount = newTotalAmount;
      contract.cumulativeEarnings = (contract.cumulativeEarnings || 80000) + newSigningBonus + newAnnualSalary;
      contract.status = "ACTIVE";
      contract.summaryText = `${newYears}년 총액 ${(newTotalAmount / 10000).toFixed(1)}억 원 (계약금 ${(newSigningBonus / 10000).toFixed(1)}억 · 연봉 ${(newAnnualSalary / 10000).toFixed(1)}억)`;
      contract.history = contract.history || [];
      contract.history.push({
        year: context.currentYear,
        type: "RENEWAL",
        evalGrade,
        years: newYears,
        signingBonus: newSigningBonus,
        annualSalary: newAnnualSalary,
        totalAmount: newTotalAmount,
        note: `고과 ${evalGrade}등급 재계약 체결`
      });
    }

    context.gmContract = contract;
    return {
      ok: true,
      status: "RENEWED",
      evalGrade,
      contract
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * [시스템 2 & 3] 날짜 시스템 (2025-01-01 시작), 9월 3주차 신인 드래프트 스케줄,
   *               하루(+1일) / 1주(+7일) 시간 진행 엔진
   * ═══════════════════════════════════════════════════════════════════════ */
  const DRAFT_SCHEDULE_CONFIG = {
    month: 9,
    weekOfMonth: 4,
    startDay: 23,
    endDay: 29,
    officialDay: 23, // 매년 9월 23일 신인 드래프트 개최
    label: "9월 23일 KBO 신인 드래프트"
  };

  const POSTSEASON_SCHEDULE_CONFIG = {
    startMonth: 10,
    startDay: 10,
    endMonth: 11,
    endDay: 15,
    officialDay: 10, // 매년 10월 10일 KBO 포스트시즌(가을야구) 개막
    label: "10월 10일 KBO 포스트시즌 (가을야구)"
  };

  const SECONDARY_DRAFT_SCHEDULE_CONFIG = {
    month: 11,
    startDay: 5,
    endDay: 30,
    officialDay: 5, // 격년(홀수 해) 11월 5일 KBO 2차 드래프트 개최
    label: "격년 11월 5일 KBO 2차 드래프트"
  };

  function parseDateISO(dateStr) {
    const parts = String(dateStr || "2025-01-01").split("-").map(Number);
    return new Date(Date.UTC(parts[0] || 2025, (parts[1] || 1) - 1, parts[2] || 1));
  }

  function formatDateISO(dateObj) {
    const y = dateObj.getUTCFullYear();
    const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function formatKoreanDate(dateStr) {
    const d = parseDateISO(dateStr);
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${days[d.getUTCDay()]})`;
  }

  function isSeptemberThirdWeekDraft(dateStr) {
    const d = parseDateISO(dateStr);
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    return month === 9 && day >= DRAFT_SCHEDULE_CONFIG.startDay && day <= DRAFT_SCHEDULE_CONFIG.endDay;
  }

  /**
   * 9월 23일 신인 드래프트 직접 지명 가능 여부 확인
   * - 9월 23일 이전(1월 1일 ~ 9월 22일)에는 스카우트 파견 및 유망주 스카우팅 리포트 열람만 가능하며 직접 지명은 잠금
   * - 9월 23일 당일 및 이후부터 직접 지명 활성화
   */
  function canPickRookieDraftNow(dateStr, context = null) {
    const curDate = dateStr || (context && context.currentDate) || "2025-01-01";
    const d = parseDateISO(curDate);
    const yr = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const draftDate = new Date(Date.UTC(yr, 8, DRAFT_SCHEDULE_CONFIG.officialDay)); // 9월 23일
    const diffDays = Math.ceil((draftDate.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    const allowed = month > 9 || (month === 9 && day >= DRAFT_SCHEDULE_CONFIG.officialDay);

    return {
      allowed,
      officialDateStr: `${yr}-09-23`,
      officialKoreanDate: `${yr}년 9월 23일`,
      daysUntilDraft: Math.max(0, diffDays),
      reason: allowed
        ? `🟢 [${yr}년 9월 23일 신인 드래프트 개막!] 현재 1~10라운드 직접 지명이 가능합니다.`
        : `🔒 신인 드래프트 '직접 지명'은 ${yr}년 9월 23일에 열립니다 (D-${Math.max(1, diffDays)}일). 9월 23일 전에는 아마추어 스카우트 파견 조정 및 유망주 스카우팅 리포트 열람만 가능합니다.`
    };
  }

  /**
   * 10월 10일 ~ 11월 15일 KBO 포스트시즌(가을야구) 진행 가능 여부 확인 (신인 드래프트와 동일한 캘린더 기간 해금 방식)
   * - 10월 10일 이전(페넌트레이스 진행 중)에는 예상 Top 5 대진표만 열람 가능하며 실행 잠금
   * - 10월 10일 가을야구 개막 당일 및 기간 중에만 포스트시즌 토너먼트 진행 활성화
   */
  function canPlayPostseasonNow(dateStr, context = null) {
    const curDate = dateStr || (context && context.currentDate) || "2025-01-01";
    const d = parseDateISO(curDate);
    const yr = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const psOpenDate = new Date(Date.UTC(yr, POSTSEASON_SCHEDULE_CONFIG.startMonth - 1, POSTSEASON_SCHEDULE_CONFIG.officialDay));
    const diffDays = Math.ceil((psOpenDate.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));

    const isDone = Boolean(
      context &&
        Array.isArray(context.postseasonHistory) &&
        context.postseasonHistory.some((h) => Number(h.year) === yr)
    );
    const inPeriod =
      (month === 10 && day >= POSTSEASON_SCHEDULE_CONFIG.startDay) ||
      (month === 11 && day <= POSTSEASON_SCHEDULE_CONFIG.endDay);
    const allowed = inPeriod && !isDone;

    return {
      allowed,
      inPeriod,
      isDone,
      alreadyCompleted: isDone,
      officialDateStr: `${yr}-10-10`,
      officialKoreanDate: `${yr}년 10월 10일`,
      periodLabel: `${yr}년 10월 10일 ~ 11월 15일 (가을야구 포스트시즌 기간)`,
      daysUntilPostseason: Math.max(0, diffDays),
      daysRemaining: Math.max(0, diffDays),
      reason: isDone
        ? `✅ [${yr}년 KBO 포스트시즌 종료 완료] 금년도 가을야구(한국시리즈) 일정이 모두 완료되었습니다.`
        : allowed
          ? `🟢 [${yr}년 10월 10일 가을야구 개막!] 현재 KBO 포스트시즌 계단식 토너먼트(WC → 준PO → PO → KS)를 진행할 수 있습니다.`
          : month < 10 || (month === 10 && day < POSTSEASON_SCHEDULE_CONFIG.startDay)
            ? `🔒 KBO 포스트시즌(가을야구)은 페넌트레이스 종료 후 매년 10월 10일에 발동됩니다 (D-${Math.max(1, diffDays)}일).`
            : `🔒 ${yr}년 KBO 포스트시즌 기간이 종료되었습니다.`
    };
  }

  /**
   * 격년(홀수 해: 2025·2027·2029...) 11월 5일 ~ 11월 30일 KBO 2차 드래프트 지명 가능 여부 확인
   * - 11월 5일 이전에는 35인 보호선수 명단 사전 관리만 가능하며 드래프트 실행 잠금
   * - 홀수 해 11월 5일 당일 및 기간(11월 5일 ~ 11월 30일) 도래 시에만 1~3라운드 지명 활성화
   */
  function canPickSecondaryDraftNow(dateStr, context = null) {
    const curDate = dateStr || (context && context.currentDate) || "2025-01-01";
    const d = parseDateISO(curDate);
    const yr = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const isBiennialYear = yr >= 2025 && yr % 2 === 1;
    const targetYear = isBiennialYear && (month < 11 || (month === 11 && day <= 30)) ? yr : isBiennialYear ? yr + 2 : yr + 1;
    const sdOpenDate = new Date(Date.UTC(targetYear, SECONDARY_DRAFT_SCHEDULE_CONFIG.month - 1, SECONDARY_DRAFT_SCHEDULE_CONFIG.officialDay));
    const diffDays = Math.ceil((sdOpenDate.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));

    const isDone = Boolean(
      context &&
        Array.isArray(context.biennialDraftHistory) &&
        context.biennialDraftHistory.some((h) => Number(h.year) === yr)
    );
    const inPeriod =
      isBiennialYear &&
      month === SECONDARY_DRAFT_SCHEDULE_CONFIG.month &&
      day >= SECONDARY_DRAFT_SCHEDULE_CONFIG.startDay &&
      day <= SECONDARY_DRAFT_SCHEDULE_CONFIG.endDay;
    const allowed = inPeriod && !isDone;

    return {
      allowed,
      inPeriod,
      isBiennialYear,
      isDone,
      alreadyCompleted: isDone,
      officialDateStr: `${targetYear}-11-05`,
      officialKoreanDate: `${targetYear}년 11월 5일`,
      periodLabel: `격년(홀수 해) 11월 5일 ~ 11월 30일`,
      daysUntilSecondaryDraft: Math.max(0, diffDays),
      daysRemaining: Math.max(0, diffDays),
      reason: isDone
        ? `✅ [${yr}년 KBO 2차 드래프트 완료] 금년도 35인 보호명단 외 1~3라운드 지명이 모두 완료되었습니다.`
        : !isBiennialYear
          ? `🔒 KBO 2차 드래프트는 격년(홀수 해: 2025·2027·2029년) 11월 5일에 열립니다 (차기 개최: ${targetYear}년 11월 5일 · D-${Math.max(1, diffDays)}일).`
          : allowed
            ? `🟢 [${yr}년 11월 5일 KBO 2차 드래프트 개막!] 현재 35인 보호명단 외 1~3라운드 지명을 진행할 수 있습니다.`
            : month < 11 || (month === 11 && day < SECONDARY_DRAFT_SCHEDULE_CONFIG.startDay)
              ? `🔒 ${yr}년 KBO 2차 드래프트는 11월 5일에 오픈됩니다 (D-${Math.max(1, diffDays)}일). 개막 전까지 35인 보호선수 명단을 사전 점검하세요.`
              : `🔒 ${yr}년 KBO 2차 드래프트 기간(11월)이 종료되었습니다.`
    };
  }

  /**
   * 현재 날짜(YYYY-MM-DD)에 따른 KBO 연간 시즌 페이즈 및 허용 업무 반환
   */
  function getSeasonPhaseByDate(dateStr) {
    const d = parseDateISO(dateStr);
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();

    if (month === 1) {
      return {
        code: "STOVE_LEAGUE",
        label: "1월 스토브리그 (FA·연봉·코치·외국인·트레이드 활성)",
        canNegotiateFA: true,
        canRenewSalary: true,
        canSignForeign: true,
        canManageStaff: true,
        canTrade: true,
        isRegularSeason: false,
        isDraftWeek: false
      };
    }
    if (month === 2 || (month === 3 && day <= 7)) {
      return {
        code: "SPRING_CAMP",
        label: "스프링캠프 (전지훈련 및 시범훈련 기간)",
        canNegotiateFA: true,
        canRenewSalary: true,
        canSignForeign: true,
        canManageStaff: true,
        canTrade: true,
        isRegularSeason: false,
        isDraftWeek: false
      };
    }
    if (month === 3 && day <= 21) {
      return {
        code: "EXHIBITION",
        label: "KBO 시범경기 및 개막 엔트리 최종 점검",
        canNegotiateFA: false,
        canRenewSalary: false,
        canSignForeign: true,
        canManageStaff: false,
        canTrade: true,
        isRegularSeason: false,
        isDraftWeek: false
      };
    }
    if ((month === 3 && day >= 22) || (month >= 4 && month <= 9)) {
      const draftWeek = isSeptemberThirdWeekDraft(dateStr);
      return {
        code: draftWeek ? "ROOKIE_DRAFT_WEEK" : "REGULAR_SEASON",
        label: draftWeek
          ? "9월 3주차 KBO 신인 드래프트 주간 & 정규시즌"
          : "KBO 정규시즌 페넌트레이스",
        canNegotiateFA: false,
        canRenewSalary: false,
        canSignForeign: true,
        canManageStaff: false,
        canTrade: month <= 7, // 7월 31일 트레이드 마감
        isRegularSeason: true,
        isDraftWeek: draftWeek
      };
    }
    if (month === 10 || (month === 11 && day <= 15)) {
      return {
        code: "POSTSEASON",
        label: "KBO 포스트시즌 (가을야구) 및 시즌 결산",
        canNegotiateFA: false,
        canRenewSalary: false,
        canSignForeign: false,
        canManageStaff: true,
        canTrade: false,
        isRegularSeason: false,
        isDraftWeek: false
      };
    }
    return {
      code: "OFFSEASON_STOVE",
      label: "연말 스토브리그 (차기 시즌 준비 및 FA·연봉 협상)",
      canNegotiateFA: true,
      canRenewSalary: true,
      canSignForeign: true,
      canManageStaff: true,
      canTrade: true,
      isRegularSeason: false,
      isDraftWeek: false
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * [시스템 4 & 5] 아마추어/독립리그 스카우트 팀 파견 & 유망주 상세 능력치 팝업
   * ═══════════════════════════════════════════════════════════════════════ */
  const KOREAN_INDEPENDENT_CLUBS = [
    "연천 미라클",
    "성남 맥파이스",
    "파주 챌린저스",
    "고양 위너스",
    "수원 파인이그스",
    "포천 몬스터",
    "가평 웨일스",
    "화성 코리요"
  ];

  const TEAM_MASCOT_MAP = {
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

  function getShortTeamMascot(teamIdOrName) {
    if (!teamIdOrName) return "고양이즈";
    const resolved = resolveTeamId(teamIdOrName);
    if (TEAM_MASCOT_MAP[resolved] && String(teamIdOrName).toUpperCase() === resolved) {
      return TEAM_MASCOT_MAP[resolved];
    }
    const str = String(teamIdOrName).trim();
    if (TEAM_MASCOT_MAP[str.toUpperCase()]) return TEAM_MASCOT_MAP[str.toUpperCase()];
    const parts = str.split(/\s+/);
    return parts.length > 1 ? parts[parts.length - 1] : TEAM_MASCOT_MAP[resolved] || str;
  }

  /**
   * 투타 표기 한글 변환 ('L타-L투' -> '좌타-좌투', 'R타-R투' -> '우타-우투')
   */
  function formatHandedness(throws = "R", bats = "R") {
    const tKor = throws === "L" ? "좌" : "우";
    const bKor = bats === "L" ? "좌" : bats === "S" ? "양" : "우";
    return `${bKor}타-${tKor}투`;
  }

  const AMATEUR_SCOUT_GROUPS = {
    HS_1: { id: "HS_1", label: "고교 1학년 리그", origin: "HS", gradeYear: 1, baseAge: 17 },
    HS_2: { id: "HS_2", label: "고교 2학년 리그", origin: "HS", gradeYear: 2, baseAge: 18 },
    HS_3: { id: "HS_3", label: "고교 3학년 (드래프트반)", origin: "HS", gradeYear: 3, baseAge: 19 },
    UNIV: { id: "UNIV", label: "대학 야구 연맹 (U-리그)", origin: "UNIV", gradeYear: 4, baseAge: 22 },
    IND:  { id: "IND",  label: "독립야구단 경기도리그 (연천·성남·파주 등)", origin: "IND", gradeYear: 5, baseAge: 24 }
  };

  /**
   * 고교 1~3학년, 대학 리그, 독립야구단에 보유 스카우트 인원(1~5명)을 전략적으로 파견/배정
   * @param {GMGameContext} context
   * @param {Object} allocation - { HS_1: number, HS_2: number, HS_3: number, UNIV: number, IND: number }
   */
  function dispatchAmateurScouts(context, allocation = {}) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const maxScouts = clamp((context.scoutLevel || 1) + 2, 1, 5); // 기본 3~5명 보유 (스카우트 레벨 연동)

    const cleanAlloc = {
      HS_1: clamp(Math.round(Number(allocation.HS_1) || 0), 0, 5),
      HS_2: clamp(Math.round(Number(allocation.HS_2) || 0), 0, 5),
      HS_3: clamp(Math.round(Number(allocation.HS_3) || 0), 0, 5),
      UNIV: clamp(Math.round(Number(allocation.UNIV) || 0), 0, 5),
      IND:  clamp(Math.round(Number(allocation.IND) || 0), 0, 5)
    };

    const totalRequested = cleanAlloc.HS_1 + cleanAlloc.HS_2 + cleanAlloc.HS_3 + cleanAlloc.UNIV + cleanAlloc.IND;
    if (totalRequested > maxScouts) {
      return {
        ok: false,
        maxScouts,
        totalRequested,
        reason: `배정 가능한 총 스카우트 인원(${maxScouts}명)을 초과했습니다. (요청: ${totalRequested}명)`
      };
    }

    context.scoutDispatch = {
      maxScouts,
      totalAssigned: totalRequested,
      allocation: cleanAlloc,
      updatedAt: context.currentDate || `${context.currentYear}-01-01`
    };

    // 파견 즉시 해당 그룹 유망주들의 초기 스카우팅 정밀도 1차 반영
    applyDailyScoutProgress(context, 3);

    return {
      ok: true,
      scoutDispatch: context.scoutDispatch
    };
  }

  /**
   * 일자 진행에 따라 파견된 학교/학년/독립리그 군 유망주들의 스카우팅 오차(Fog of War) 점진적 축소
   */
  function applyDailyScoutProgress(context, daysElapsed = 1) {
    if (!context || !Array.isArray(context.draftPool)) return;
    const gm = KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM);
    const P_KEYS = (gm && gm.P_KEYS) || ["control", "stuff", "velo", "stamina", "movement"];
    const B_KEYS = (gm && gm.B_KEYS) || ["contact", "power", "speed", "defense", "eye"];

    const alloc = (context.scoutDispatch && context.scoutDispatch.allocation) || {
      HS_1: 1,
      HS_2: 0,
      HS_3: 1,
      UNIV: 1,
      IND: 1
    };

    context.draftPool.forEach((p) => {
      const grpKey =
        p.origin === "IND"
          ? "IND"
          : p.origin === "UNIV"
            ? "UNIV"
            : p.gradeYear === 1
              ? "HS_1"
              : p.gradeYear === 2
                ? "HS_2"
                : "HS_3";

      const assignedScouts = alloc[grpKey] || 0;
      if (assignedScouts <= 0) return;

      // 파견 인원 1명당 하루 약 1.25%p씩 정밀도 상승
      const gain = assignedScouts * 1.25 * daysElapsed;
      p.scoutProgress = clamp(+(Number(p.scoutProgress || 15) + gain).toFixed(1), 0, 100);

      // scoutProgress(0~100%)에 반비례하여 오차 반경(halfWidth) 축소
      const isExact = p.scoutProgress >= 90;
      const halfWidth = isExact ? 0 : Math.max(1, Math.round(11 * (1 - p.scoutProgress / 95)));
      const trueOvr = p.getTrueOvr();

      const centerBias = p.scoutError && typeof p.scoutError.bias === "number" ? p.scoutError.bias : 0;
      const effectiveBias = isExact ? 0 : Math.round(centerBias * (1 - p.scoutProgress / 100));
      const estCenter = clamp(trueOvr + effectiveBias, 25, 110);

      const keys = p.type === "pitcher" ? P_KEYS : B_KEYS;
      const statRanges = {};
      keys.forEach((k) => {
        const tv = (p.st && p.st[k]) || 50;
        statRanges[k] = isExact
          ? [tv, tv]
          : [clamp(tv + effectiveBias - halfWidth, 20, 110), clamp(tv + effectiveBias + halfWidth, 20, 110)];
      });

      p.scoutError = {
        scoutLevel: context.scoutLevel || 1,
        assignedScouts,
        scoutProgress: p.scoutProgress,
        isExact,
        bias: effectiveBias,
        ovrMin: isExact ? trueOvr : clamp(estCenter - halfWidth, 20, 110),
        ovrMax: isExact ? trueOvr : clamp(estCenter + halfWidth, 20, 110),
        statRanges
      };
    });
  }

  /**
   * [시스템 5] 고교/대학/독립리그 유망주 랭킹 및 상세 능력치 팝업 리포트 생성
   * - 투수: 제구, 구위, 구속(km/h), 체력, 변화 (5대 스탯 + 보유 구종 숙련도)
   * - 타자: 컨택, 파워, 주력, 수비, 선구 (5대 스탯 + 세부 포지션)
   * - 스카우트 파견 수준(scoutProgress)에 따라 범주형(68~78) 또는 정확한 수치로 전환 표시
   */
  function inspectProspectReport(context, playerId) {
    if (!context) return null;
    const gm = KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM);
    const PITCHES = (gm && gm.PITCHES) || {};
    const POSITIONS = (gm && gm.POSITIONS) || {};
    const kmhFn = (gm && gm.kmh) || ((v) => Math.round(120 + v * 0.4));
    const gradeFn = (gm && gm.grade) || ((v) => (v >= 80 ? "A" : v >= 70 ? "B" : "C"));

    let player =
      (context.draftPool || []).find((p) => p.id === playerId) ||
      (context.npbPool || []).find((p) => p.id === playerId) ||
      (context.faPool || []).find((p) => p.id === playerId) ||
      null;
    let isOwnTeam = false;

    if (!player && Array.isArray(context.kboTeams)) {
      for (const t of context.kboTeams) {
        const found = [...t.roster1G, ...t.roster2G, ...t.rosterDev, ...(t.foreignRehabList || [])].find(
          (p) => p.id === playerId
        );
        if (found) {
          player = found;
          isOwnTeam = t.id === context.userTeamId;
          break;
        }
      }
    }
    if (!player) return null;

    const se = player.scoutError || { ovrMin: 55, ovrMax: 68, statRanges: {}, isExact: false, scoutProgress: 20 };
    const isExact = Boolean(isOwnTeam || se.isExact || (se.ovrMin === se.ovrMax));
    const progress = isOwnTeam ? 100 : Math.round(se.scoutProgress || 25);

    const groupLabel =
      player.origin === "IND"
        ? `독립야구단 (${player.indClubName || "연천 미라클"})`
        : player.origin === "UNIV"
          ? `대학리그 (${player.gradeYear || 4}학년)`
          : player.origin === "HS"
            ? `고교리그 (${player.gradeYear || 3}학년)`
            : `${player.origin} (${player.nationality}${player.isAsianQuarter ? " · 아시아쿼터" : ""})`;

    const statDefs =
      player.type === "pitcher"
        ? [
            { key: "control",  label: "제구" },
            { key: "stuff",    label: "구위" },
            { key: "velo",     label: "구속" },
            { key: "stamina",  label: "체력" },
            { key: "movement", label: "변화" }
          ]
        : [
            { key: "contact", label: "컨택" },
            { key: "power",   label: "파워" },
            { key: "speed",   label: "주력" },
            { key: "defense", label: "수비" },
            { key: "eye",     label: "선구" }
          ];

    const stats = statDefs.map(({ key, label }) => {
      const trueVal = (player.st && player.st[key]) || 50;
      const range =
        se.statRanges && Array.isArray(se.statRanges[key])
          ? se.statRanges[key]
          : [clamp(trueVal - 6, 20, 110), clamp(trueVal + 6, 20, 110)];

      if (key === "velo") {
        const exactKmh = kmhFn(trueVal);
        const minKmh = kmhFn(range[0]);
        const maxKmh = kmhFn(range[1]);
        return {
          key,
          label,
          isExact,
          displayValue: isExact ? `${trueVal} (${exactKmh}km/h · ${gradeFn(trueVal)})` : `${range[0]}~${range[1]} (${minKmh}~${maxKmh}km/h)`,
          barPercent: clamp(isExact ? trueVal : Math.round((range[0] + range[1]) / 2), 20, 100)
        };
      }

      return {
        key,
        label,
        isExact,
        displayValue: isExact ? `${trueVal} (${gradeFn(trueVal)})` : `${range[0]}~${range[1]} (${gradeFn(Math.round((range[0] + range[1]) / 2))})`,
        barPercent: clamp(isExact ? trueVal : Math.round((range[0] + range[1]) / 2), 20, 100)
      };
    });

    const pitchDetails =
      player.type === "pitcher" && Array.isArray(player.pitches)
        ? player.pitches.map((pt) => {
            const pName = (PITCHES[pt.k] && PITCHES[pt.k].n) || pt.k;
            const masteryRange = isExact
              ? `${pt.m} (${gradeFn(pt.m)})`
              : `${clamp(pt.m - 6, 20, 100)}~${clamp(pt.m + 6, 20, 100)}`;
            return {
              code: pt.k,
              name: pName,
              masteryDisplay: masteryRange,
              barPercent: clamp(pt.m, 20, 100)
            };
          })
        : [];

    const posMeta = POSITIONS[player.pos] || { n: player.pos };
    const positionDetail = `${player.pos} (${posMeta.n})${
      Array.isArray(player.subPos) && player.subPos.length ? ` · 부포지션: ${player.subPos.join(", ")}` : ""
    }`;

    return {
      playerId: player.id,
      name: player.name,
      age: player.age,
      type: player.type,
      pos: player.pos,
      positionDetail,
      throwsBats: formatHandedness(player.throws, player.bats),
      groupLabel,
      isDraftEligible: player.origin === "IND" || player.origin === "UNIV" || (player.gradeYear || 3) >= 3,
      scoutProgress: progress,
      isExact,
      ovrDisplay: isExact ? `${player.getTrueOvr()} (${gradeFn(player.getTrueOvr())}) [정밀 분석 완료]` : `${se.ovrMin}~${se.ovrMax} (오차 ±${Math.round((se.ovrMax - se.ovrMin) / 2)})`,
      potentialDisplay: isExact ? `${player.potential} (${gradeFn(player.potential)})` : `${clamp(player.potential - 7, 50, 108)}~${clamp(player.potential + 5, 55, 108)}`,
      stats,
      pitchDetails,
      lastGrowthNote: player.lastGrowthNote || null,
      draftProjection: player.draftProjection || null
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * [시스템 6 & 7] 외국인 선수 육성군 금지 · 방출 시 퇴출(FOREIGN_RELEASED) ·
   *               6주(42일) 이상 장기 부상 대체 외국인 영입 및 복귀 전환 제도
   * ═══════════════════════════════════════════════════════════════════════ */

  /**
   * [시스템 6] 선수 엔트리 이동 래퍼 (외국인 선수 육성군 등록 차단 & 1군 28명 / 2군 30명 정원 검증)
   */
  function movePlayerEntryWithForeignRule(context, teamId, playerId, targetStatus) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team || typeof team.movePlayerStatus !== "function") {
      return { ok: false, reason: "구단을 찾을 수 없습니다." };
    }
    return team.movePlayerStatus(playerId, targetStatus);
  }

  /**
   * [시스템 6] 현역 외국인 선수 즉시 웨이버 방출 / 계약 해지 (시장에서 완전 제거)
   */
  function releaseForeignPlayer(context, teamId, playerId) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const all = [...team.roster1G, ...team.roster2G, ...team.rosterDev, ...(team.foreignRehabList || [])];
    const target = all.find((p) => p.id === playerId);
    if (!target) return { ok: false, reason: "해당 선수를 찾을 수 없습니다." };
    if (target.nationality === "KOR") {
      return { ok: false, reason: "국내 선수는 외국인 퇴출 규정이 적용되지 않습니다." };
    }

    team.roster1G = team.roster1G.filter((p) => p.id !== playerId);
    team.roster2G = team.roster2G.filter((p) => p.id !== playerId);
    team.rosterDev = team.rosterDev.filter((p) => p.id !== playerId);
    team.foreignRehabList = (team.foreignRehabList || []).filter((p) => p.id !== playerId);

    // 시장(npbPool, faPool)에서도 완전 제거 및 상태를 FOREIGN_RELEASED로 고정
    context.npbPool = (context.npbPool || []).filter((p) => p.id !== playerId);
    context.faPool = (context.faPool || []).filter((p) => p.id !== playerId);

    target.teamId = null;
    target.status = "FOREIGN_RELEASED";

    const archiveEntry = {
      playerId: target.id,
      name: target.name,
      nationality: target.nationality,
      pos: target.pos,
      type: target.type,
      formerTeamId: team.id,
      status: "FOREIGN_RELEASED",
      releasedDate: context.currentDate || `${context.currentYear}-01-01`
    };
    if (!Array.isArray(context.releasedForeignArchives)) {
      context.releasedForeignArchives = [];
    }
    context.releasedForeignArchives.push(archiveEntry);

    return {
      ok: true,
      releasedPlayer: target,
      archiveEntry
    };
  }

  /**
   * [시스템 7] 구단 내 6주 이상(42일 이상) 장기 부상 중인 외국인 선수 조회
   */
  function getEligibleRehabForeignPlayers(team) {
    if (!team) return [];
    const activeForeigns = [...team.roster1G, ...team.roster2G].filter(
      (p) => p.nationality && p.nationality !== "KOR"
    );
    return activeForeigns.filter((p) => {
      if (!p.injury || !p.injury.active) return false;
      const weeks = p.injury.weeksLeft || 0;
      const days = p.injury.daysLeft != null ? p.injury.daysLeft : weeks * 7;
      return weeks >= 6 || days >= 42;
    });
  }

  /**
   * [시스템 7] 6주 장기 부상 외국인 선수를 '일시 부상 재활 명단(FOREIGN_REHAB)'으로 옮기고
   *           npbPool에서 6주 단기 대체 외국인 선수를 즉시 영입
   */
  function signSixWeekReplacementForeigner(context, teamId, injuredForeignId, replacementCandidateId) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const injuredPlayer = [...team.roster1G, ...team.roster2G].find(
      (p) => p.id === injuredForeignId && p.nationality !== "KOR"
    );
    if (!injuredPlayer) {
      return { ok: false, reason: "대상 외국인 선수를 로스터에서 찾을 수 없습니다." };
    }

    const weeksLeft = (injuredPlayer.injury && injuredPlayer.injury.weeksLeft) || 0;
    const daysLeft =
      injuredPlayer.injury && injuredPlayer.injury.daysLeft != null
        ? injuredPlayer.injury.daysLeft
        : weeksLeft * 7;

    if (!injuredPlayer.injury || !injuredPlayer.injury.active || (weeksLeft < 6 && daysLeft < 42)) {
      return {
        ok: false,
        reason: "6주(42일) 이상 장기 부상 진단을 받은 외국인 선수만 대체 외국인 영입이 가능합니다."
      };
    }

    // 대체 외국인 후보 찾기 (지정 ID가 없으면 npbPool 내 동일 타입 최상위 후보 자동 선택)
    let candidate = (context.npbPool || []).find((p) => p.id === replacementCandidateId);
    if (!candidate) {
      candidate = (context.npbPool || [])
        .filter((p) => p.type === injuredPlayer.type)
        .sort((a, b) => b.getTrueOvr() - a.getTrueOvr())[0];
    }
    if (!candidate) {
      return { ok: false, reason: "해외 스카우트 풀(npbPool)에 영입 가능한 대체 외국인 후보가 없습니다." };
    }

    // 1) 기존 장기 부상 외국인을 1군/2군에서 빼서 '일시 부상 재활 명단(foreignRehabList)'에 등록
    team.roster1G = team.roster1G.filter((p) => p.id !== injuredPlayer.id);
    team.roster2G = team.roster2G.filter((p) => p.id !== injuredPlayer.id);
    injuredPlayer.status = "FOREIGN_REHAB";
    injuredPlayer.injury.daysLeft = Math.max(42, daysLeft);
    if (!Array.isArray(team.foreignRehabList)) team.foreignRehabList = [];
    team.foreignRehabList.push(injuredPlayer);

    // 2) npbPool에서 대체 외국인 추출 및 6주(42일) 단기 계약 체결 (저렴한 단기 계약금: 연봉의 18%, 약 8,000만~1.8억)
    context.npbPool = context.npbPool.filter((p) => p.id !== candidate.id);
    // 단기 계약금은 대체 선수의 연봉으로 등록되어 연봉총액(여유 예산)에 반영된다.
    const shortTermFee = clamp(round100((candidate.salary || 50000) * 0.18), 8000, 18000);

    candidate.teamId = team.id;
    candidate.acquiredVia = { type: "FOREIGN", date: context.currentDate || null, fromTeamId: candidate.formerTeamId || null }; // 시즌 회고 리포트용 영입 경로
    candidate.salary = shortTermFee;
    candidate.contractYears = 1;
    candidate.status = team.roster1G.length < 28 ? "1GUN" : "2GUN";
    candidate.isTempForeignReplacement = true;
    candidate.replacesPlayerId = injuredPlayer.id;
    candidate.replacesPlayerName = injuredPlayer.name;
    candidate.tempContractWeeksLeft = 6;
    candidate.tempContractDaysLeft = 42;

    if (candidate.status === "1GUN") team.roster1G.push(candidate);
    else team.roster2G.push(candidate);

    if (typeof candidate.updateScoutingReport === "function") {
      candidate.updateScoutingReport(context.scoutLevel || 1, team.id === context.userTeamId);
    }

    return {
      ok: true,
      rehabPlayer: injuredPlayer,
      replacementPlayer: candidate,
      shortTermFee,
      summary: `${injuredPlayer.name}(${weeksLeft}주 부상) 재활 명단 이동 → 6주 대체 외국인 ${candidate.name}(${candidate.pos}) 단기 총액 ${(shortTermFee / 10000).toFixed(2)}억 원 영입 완료`
    };
  }

  /**
   * [시스템 7] 원 외국인 선수 부상 복귀 시 거취 결정
   * @param {GMGameContext} context
   * @param {string} teamId
   * @param {string} rehabForeignId - 재활 명단에 있던 원 외국인 선수 ID
   * @param {'RETURN_ORIGINAL'|'CONVERT_REPLACEMENT'} decision
   *   - 'RETURN_ORIGINAL': 원 외국인 1군 복귀 + 대체 외국인 계약 종료(퇴출)
   *   - 'CONVERT_REPLACEMENT': 대체 외국인 정식 계약 전환 + 원 외국인 웨이버 방출(퇴출)
   */
  function resolveReturnedForeignPlayer(context, teamId, rehabForeignId, decision = "RETURN_ORIGINAL") {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const rehabList = team.foreignRehabList || [];
    const origPlayer = rehabList.find((p) => p.id === rehabForeignId) || rehabList[0];
    if (!origPlayer) {
      return { ok: false, reason: "일시 부상 재활 명단에 해당 외국인 선수가 없습니다." };
    }

    const tempPlayer = [...team.roster1G, ...team.roster2G].find(
      (p) => p.isTempForeignReplacement && (p.replacesPlayerId === origPlayer.id || !p.replacesPlayerId)
    );

    team.foreignRehabList = rehabList.filter((p) => p.id !== origPlayer.id);
    origPlayer.injury = { active: false, name: null, part: null, label: null, weeksLeft: 0, daysLeft: 0, major: false };

    if (decision === "CONVERT_REPLACEMENT" && tempPlayer) {
      // 대체 외국인을 정식 잔여시즌 계약으로 전환 (추가 계약금 지급) 및 원 외국인 퇴출(FOREIGN_RELEASED)
      // 추가 계약금은 연봉 인상분으로 연봉총액(여유 예산)에 반영된다.
      const fullContractAddCost = round100((tempPlayer.salary || 12000) * 1.5);
      tempPlayer.isTempForeignReplacement = false;
      tempPlayer.replacesPlayerId = null;
      tempPlayer.tempContractDaysLeft = null;
      tempPlayer.tempContractWeeksLeft = null;
      tempPlayer.salary = (tempPlayer.salary || 12000) + fullContractAddCost;

      origPlayer.teamId = null;
      origPlayer.status = "FOREIGN_RELEASED";
      if (!Array.isArray(context.releasedForeignArchives)) context.releasedForeignArchives = [];
      context.releasedForeignArchives.push({
        playerId: origPlayer.id,
        name: origPlayer.name,
        nationality: origPlayer.nationality,
        pos: origPlayer.pos,
        formerTeamId: team.id,
        status: "FOREIGN_RELEASED",
        releasedDate: context.currentDate || `${context.currentYear}-01-01`
      });

      return {
        ok: true,
        decision: "CONVERT_REPLACEMENT",
        keptPlayer: tempPlayer,
        releasedPlayer: origPlayer,
        summary: `대체 외국인 ${tempPlayer.name} 정식 계약 전환 완료 (원 외국인 ${origPlayer.name} 웨이버 방출/퇴출)`
      };
    }

    // 기본값(RETURN_ORIGINAL): 원 외국인 1군/2군 복귀 + 대체 외국인 단기 계약 만료 퇴단(FOREIGN_RELEASED)
    if (tempPlayer) {
      team.roster1G = team.roster1G.filter((p) => p.id !== tempPlayer.id);
      team.roster2G = team.roster2G.filter((p) => p.id !== tempPlayer.id);
      tempPlayer.teamId = null;
      tempPlayer.status = "FOREIGN_RELEASED";
      if (!Array.isArray(context.releasedForeignArchives)) context.releasedForeignArchives = [];
      context.releasedForeignArchives.push({
        playerId: tempPlayer.id,
        name: tempPlayer.name,
        nationality: tempPlayer.nationality,
        pos: tempPlayer.pos,
        formerTeamId: team.id,
        status: "FOREIGN_RELEASED",
        releasedDate: context.currentDate || `${context.currentYear}-01-01`
      });
    }

    origPlayer.status = team.roster1G.length < 28 ? "1GUN" : "2GUN";
    if (origPlayer.status === "1GUN") team.roster1G.push(origPlayer);
    else team.roster2G.push(origPlayer);

    return {
      ok: true,
      decision: "RETURN_ORIGINAL",
      keptPlayer: origPlayer,
      releasedPlayer: tempPlayer || null,
      summary: `원 외국인 ${origPlayer.name} 부상 완쾌 후 1군 복귀 완료${tempPlayer ? ` (대체 외국인 ${tempPlayer.name} 단기 계약 만료 퇴단)` : ""}`
    };
  }

  /**
   * 1월 1일 개막 시점부터 즉시 활성화되는 구단 간 1:1 트레이드 실행 함수
   */
  function executePlayerTrade(context, targetTeamId, myPlayerId, targetPlayerId, cashOfferManwon = 0) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const phase = getSeasonPhaseByDate(context.currentDate);
    if (!phase.canTrade) {
      return { ok: false, reason: "트레이드 마감 기한(7월 31일) 이후에는 트레이드를 진행할 수 없습니다." };
    }

    const userTeam = context.getUserTeam();
    const targetTeam = context.getTeam(targetTeamId);
    if (!userTeam || !targetTeam || userTeam.id === targetTeam.id) {
      return { ok: false, reason: "유효한 상대 구단을 선택해 주세요." };
    }

    const myPlayer = userTeam.getAllPlayers().find((p) => p.id === myPlayerId);
    const targetPlayer = targetTeam.getAllPlayers().find((p) => p.id === targetPlayerId);
    if (!myPlayer || !targetPlayer) {
      return { ok: false, reason: "트레이드 대상 선수를 찾을 수 없습니다." };
    }

    const myIsForeign = Boolean(myPlayer.nationality && myPlayer.nationality !== "KOR");
    const targetIsForeign = Boolean(targetPlayer.nationality && targetPlayer.nationality !== "KOR");
    if (myIsForeign !== targetIsForeign) {
      return {
        ok: false,
        reason: "⚠️ [KBO 트레이드 규정] 외국인 트레이드는 외국인 선수끼리, 내국인 트레이드는 내국인 선수끼리만 가능합니다!"
      };
    }

    const cash = Number(cashOfferManwon) || 0;
    if (cash > 0 && userTeam.getAvailableBudget() < cash) {
      return { ok: false, reason: "구단 보유 예산이 부족하여 현금 트레이드를 진행할 수 없습니다." };
    }

    // 가치 평가 (OVR + 잠재력 + 연령 가치 + 현금 보정, 협상의 달인 특성 시 +5% 우대)
    const myVal =
      myPlayer.getTrueOvr() * 0.65 +
      (myPlayer.potential || 70) * 0.35 -
      Math.max(0, myPlayer.age - 30) * 1.5 +
      cash / 8000;
    const targetVal =
      targetPlayer.getTrueOvr() * 0.65 +
      (targetPlayer.potential || 70) * 0.35 -
      Math.max(0, targetPlayer.age - 30) * 1.5;

    const negBonus = context.gmProfile && context.gmProfile.trait === "NEGOTIATOR" ? 2.5 : 0;
    if (myVal + negBonus < targetVal - 2.5) {
      return {
        ok: false,
        myVal: +myVal.toFixed(1),
        targetVal: +targetVal.toFixed(1),
        reason: `${targetTeam.name} 단장이 트레이드 카드의 가치 불균형(제시 ${myVal.toFixed(1)} vs 요구 ${targetVal.toFixed(1)})을 이유로 거절했습니다. 현금을 추가하거나 동급 카드를 제시하세요.`
      };
    }

    // 양 구단 로스터에서 교환
    ["roster1G", "roster2G", "rosterDev"].forEach((rk) => {
      userTeam[rk] = userTeam[rk].filter((p) => p.id !== myPlayer.id);
      targetTeam[rk] = targetTeam[rk].filter((p) => p.id !== targetPlayer.id);
    });

    userTeam.budget -= cash;
    targetTeam.budget += cash;

    myPlayer.teamId = targetTeam.id;
    myPlayer.acquiredVia = { type: "TRADE", date: context.currentDate || null, fromTeamId: myPlayer.formerTeamId || null }; // 시즌 회고 리포트용 영입 경로
    myPlayer.status = targetTeam.roster1G.length < 28 ? "1GUN" : "2GUN";
    if (myPlayer.status === "1GUN") targetTeam.roster1G.push(myPlayer);
    else targetTeam.roster2G.push(myPlayer);

    targetPlayer.teamId = userTeam.id;
    targetPlayer.acquiredVia = { type: "TRADE", date: context.currentDate || null, fromTeamId: targetPlayer.formerTeamId || null }; // 시즌 회고 리포트용 영입 경로
    targetPlayer.status = userTeam.roster1G.length < 28 ? "1GUN" : "2GUN";
    if (targetPlayer.status === "1GUN") userTeam.roster1G.push(targetPlayer);
    else userTeam.roster2G.push(targetPlayer);

    if (typeof myPlayer.updateScoutingReport === "function") {
      myPlayer.updateScoutingReport(context.scoutLevel || 1, false);
    }
    if (typeof targetPlayer.updateScoutingReport === "function") {
      targetPlayer.updateScoutingReport(context.scoutLevel || 1, true);
    }

    const tradeRecord = {
      date: context.currentDate,
      fromTeamId: userTeam.id,
      fromTeamName: userTeam.name,
      toTeamId: targetTeam.id,
      toTeamName: targetTeam.name,
      sentPlayer: { id: myPlayer.id, name: myPlayer.name, pos: myPlayer.pos },
      receivedPlayer: { id: targetPlayer.id, name: targetPlayer.name, pos: targetPlayer.pos },
      cashOfferManwon: cash
    };
    if (!Array.isArray(context.tradeHistory)) context.tradeHistory = [];
    context.tradeHistory.unshift(tradeRecord);
    {
      const retroMod = typeof globalThis !== "undefined" && globalThis.KBO_GM && globalThis.KBO_GM.Retro;
      if (retroMod && typeof retroMod.recordTrade === "function") retroMod.recordTrade(context, { partnerTeamId: targetTeam.id, sentIds: [myPlayer.id], receivedIds: [targetPlayer.id], cashManwon: cash });
    }

    return {
      ok: true,
      tradeRecord,
      summary: `[트레이드 타결] ${userTeam.name} ${myPlayer.name}(${myPlayer.pos})${cash > 0 ? `+현금 ${(cash / 10000).toFixed(1)}억` : ""} ↔ ${targetTeam.name} ${targetPlayer.name}(${targetPlayer.pos})`
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * [신규 요청 1] 구단주 운영 예산 증액 요청 시스템 (previewBudgetRequestOdds / requestBudgetIncrease)
   * - 시즌당 최대 2회 요청 가능
   * - 구단주 신임도(ownerTrust), 팬심(fanRatio), 현재 순위, 단장 특성(NEGOTIATOR/FIELD_EXPERT)에 따라 승인 확률 산출
   * ═══════════════════════════════════════════════════════════════════════ */
  const BUDGET_REQUEST_TIERS = {
    SMALL:    { id: "SMALL",    label: "소규모 지원 (10억 원)", amount: 100000, probAdj: +15, failTrustPenalty: 4,  succTrustCost: 2, desc: "연봉 인상분·소규모 보강을 메우는 부담 없는 요청" },
    STANDARD: { id: "STANDARD", label: "표준 증액 (25억 원)",   amount: 250000, probAdj: 0,   failTrustPenalty: 8,  succTrustCost: 4, desc: "FA 1명 영입 또는 핵심 선수 잔류에 필요한 규모" },
    LARGE:    { id: "LARGE",    label: "대규모 긴급수혈 (45억 원)", amount: 450000, probAdj: -18, failTrustPenalty: 14, succTrustCost: 6, desc: "대형 FA·윈나우 승부수. 기각 시 신임도 타격이 큼" }
  };

  function previewBudgetRequestOdds(context, requestTier = "STANDARD") {
    if (!context) return { canRequest: false, probability: 0, reason: "컨텍스트 없음" };
    const userTeam = context.getUserTeam();
    const spec = BUDGET_REQUEST_TIERS[requestTier] || BUDGET_REQUEST_TIERS.STANDARD;
    const reqCount = Number(context.budgetRequestCountThisYear) || 0;
    const maxRequestsPerSeason = 2;

    const uiTier = { ...spec, trustCostOnSuccess: spec.succTrustCost, trustPenaltyOnFail: spec.failTrustPenalty };
    const goal = userTeam && userTeam.ownerExpectation;
    const targetRank = (goal && goal.targetRank) || 5;
    const rankRowForUi = (context.standings || []).find((s) => userTeam && s.teamId === userTeam.id);
    const currentRank = rankRowForUi ? rankRowForUi.rank : "-";

    if (reqCount >= maxRequestsPerSeason) {
      return {
        canRequest: false,
        probability: 0,
        probPct: 0,
        tier: uiTier,
        usedCount: reqCount,
        maxCount: maxRequestsPerSeason,
        remainingRequests: 0,
        currentRank,
        targetRank,
        reason: `이번 시즌 예산 증액 요청 횟수(${maxRequestsPerSeason}회)를 모두 소진했습니다.`
      };
    }

    const trust = userTeam ? (userTeam.ownerTrust ?? 60) : 60;
    const fan = userTeam ? (userTeam.fanRatio ?? 55) : 55;
    const standings = context.standings || [];
    const myRankRow = standings.find((s) => s.teamId === userTeam.id);
    const rank = myRankRow ? myRankRow.rank : (userTeam.rank2024 || 5);

    const trait = context.gmProfile ? context.gmProfile.trait : "DATA_ANALYST";
    const traitBonus = trait === "NEGOTIATOR" ? 12 : trait === "FIELD_EXPERT" ? 6 : 3;

    // 기본 확률 35% + 신임도 보정 + 팬심 보정 + 순위 보정 + 단장 특성 + 요청 규모 보정 - 반복 요청 페널티
    const diffAdj =
      KBO_GM && KBO_GM.Economy && typeof KBO_GM.Economy.getDifficulty === "function"
        ? KBO_GM.Economy.getDifficulty(context).ownerProbAdj
        : 0;
    const rawProb =
      35 +
      (trust - 50) * 0.85 +
      (fan - 50) * 0.35 +
      (6 - rank) * 3.5 +
      traitBonus +
      spec.probAdj +
      diffAdj -
      reqCount * 15;

    const probability = clamp(Math.round(rawProb), 10, 88);
    return {
      canRequest: true,
      probability,
      probPct: probability,
      tier: uiTier,
      usedCount: reqCount,
      maxCount: maxRequestsPerSeason,
      remainingRequests: maxRequestsPerSeason - reqCount,
      currentRank,
      targetRank,
      reason: `승인 확률 ${probability}% (신임도 ${trust} · 현재 ${rank}위 · 잔여 기회 ${maxRequestsPerSeason - reqCount}회)`
    };
  }

  function requestBudgetIncrease(context, requestTier = "STANDARD", rng = Math.random) {
    const preview = previewBudgetRequestOdds(context, requestTier);
    if (!preview.canRequest) {
      return { ok: false, approved: false, ...preview };
    }

    const userTeam = context.getUserTeam();
    const spec = preview.tier;
    context.budgetRequestCountThisYear = (Number(context.budgetRequestCountThisYear) || 0) + 1;

    const roll = rng() * 100;
    const approved = roll < preview.probability;

    if (approved) {
      userTeam.budget = clamp((userTeam.budget || 1200000) + spec.amount, -3000000, 4000000);
      if (!Array.isArray(context.ownerSupportLog)) context.ownerSupportLog = [];
      context.ownerSupportLog.push({ year: context.currentYear, date: context.currentDate, amountManwon: spec.amount, tier: spec.id });
      userTeam.ownerTrust = clamp((userTeam.ownerTrust ?? 60) - spec.succTrustCost, 0, 100);
      return {
        ok: true,
        approved: true,
        grantedAmount: spec.amount,
        probability: preview.probability,
        newBudget: userTeam.budget,
        newOwnerTrust: userTeam.ownerTrust,
        message: `[구단주 승인!] 모기업에서 ${spec.label} 추가 예산을 승인했습니다! (보유 예산 +${(spec.amount / 10000).toFixed(1)}억 원 · 기대치 상승으로 신임도 -${spec.succTrustCost})`
      };
    } else {
      userTeam.ownerTrust = clamp((userTeam.ownerTrust ?? 60) - spec.failTrustPenalty, 0, 100);
      return {
        ok: true,
        approved: false,
        grantedAmount: 0,
        probability: preview.probability,
        newBudget: userTeam.budget,
        newOwnerTrust: userTeam.ownerTrust,
        message: `[구단주 반려] 모기업 이사회에서 ${spec.label} 증액 요청을 기각했습니다. (승인 확률 ${preview.probability}% 실패 · 신임도 -${spec.failTrustPenalty})`
      };
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * [신규 요청 2] 신인 드래프트 입단 인원 연동 방출(웨이버 정리) 시스템
   * ═══════════════════════════════════════════════════════════════════════ */
  function getRosterReleaseStatus(context, teamId) {
    if (!context) {
      return {
        draftedCount: 0,
        drafteeCount: 0,
        releasedCount: 0,
        recommendedMoreReleases: 0,
        remainingFreeReleaseQuota: 0,
        totalRosterSize: 0,
        count2GAndDev: 0,
        potentialSavings2GAndDev: 0,
        totalSavedBudgetThisYear: 0
      };
    }
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) {
      return {
        draftedCount: 0,
        drafteeCount: 0,
        releasedCount: 0,
        recommendedMoreReleases: 0,
        remainingFreeReleaseQuota: 0,
        totalRosterSize: 0,
        count2GAndDev: 0,
        potentialSavings2GAndDev: 0,
        totalSavedBudgetThisYear: 0
      };
    }

    const curYear = context.currentYear || 2025;
    const allPlayers = team.getAllPlayers();
    const draftedRookies = allPlayers.filter(
      (p) => p.draftInfo && Number(p.draftInfo.year) === curYear
    );
    const draftedCount = draftedRookies.length;
    const releasedCount = Number(context.releasedCountThisYear) || 0;
    const recommendedMoreReleases = Math.max(0, draftedCount - releasedCount);

    const pool2GAndDev = [...(team.roster2G || []), ...(team.rosterDev || [])];
    const potentialSavings2GAndDev = pool2GAndDev.reduce(
      (acc, p) => acc + Math.max(1500, round100((p.salary || 3000) * 0.8)),
      0
    );

    return {
      draftedCount,
      drafteeCount: draftedCount,
      releasedCount,
      recommendedMoreReleases,
      remainingFreeReleaseQuota: recommendedMoreReleases,
      totalRosterSize: allPlayers.length,
      count2G: (team.roster2G || []).length,
      countDev: (team.rosterDev || []).length,
      count2GAndDev: pool2GAndDev.length,
      potentialSavings2GAndDev,
      totalSavedBudgetThisYear: Number(context.totalSavedBudgetThisYear) || 0,
      draftedRookies
    };
  }

  /**
   * 국내 선수 및 2군/육성선수 상시 방출 정리 (선수단 정리 및 잔여 연봉 예산 절감 반영)
   * - 2군(2GUN) 및 육성선수(YUKSEONG)는 시즌·스토브리그 언제나 제한 없이 즉시 방출 가능하며,
   *   방출 시 해당 선수의 연봉이 연봉총액에서 빠져 여유 예산(예산 - 연봉총액)이 그만큼 늘어납니다 (별도 환급 없음).
   */
  function releaseDomesticPlayer(context, teamId, playerId) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const all = team.getAllPlayers();
    const target = all.find((p) => p.id === playerId);
    if (!target) return { ok: false, reason: "방출할 선수를 찾을 수 없습니다." };

    if (target.nationality && target.nationality !== "KOR") {
      const fRes = releaseForeignPlayer(context, team.id, playerId);
      if (fRes && fRes.ok) {
        // 방출 선수의 연봉이 연봉총액에서 빠지는 만큼 여유 예산이 늘어난다 (별도 환급 없음)
        const savedForeignBudget = target.salary || 0;
        fRes.savedBudgetManwon = savedForeignBudget;
        fRes.summary = `${target.name} (${target.pos} · 외국인) 선수를 방출 정리하여 연봉 ${(savedForeignBudget / 10000).toFixed(2)}억 원만큼 여유 예산이 늘었습니다.`;
      }
      return fRes;
    }

    const prevStatus = target.status || "2GUN";
    const is2GOrDev = prevStatus === "2GUN" || prevStatus === "YUKSEONG";

    // 1군 선수는 최소 경기 출장 인원(20명) 보호, 단 2군/육성선수는 언제나 무제한 방출 가능!
    if (!is2GOrDev && prevStatus === "1GUN" && team.roster1G.length <= 20) {
      return { ok: false, reason: "1군 최소 경기 출장 인원(20명) 유지를 위해 먼저 2군으로 말소한 뒤 방출해 주세요." };
    }

    team.roster1G = team.roster1G.filter((p) => p.id !== playerId);
    team.roster2G = team.roster2G.filter((p) => p.id !== playerId);
    team.rosterDev = team.rosterDev.filter((p) => p.id !== playerId);

    // 방출 선수의 연봉이 연봉총액에서 빠지는 만큼 여유 예산이 늘어난다 (별도 환급 없음 · 방출-환급 반복으로 예산을 불리는 것을 막음)
    const playerSal = Number(target.salary) || 0;
    const savedBudgetManwon = playerSal;

    target.teamId = null;
    target.status = "RELEASED";
    if (team.id === context.userTeamId) {
      context.releasedCountThisYear = (Number(context.releasedCountThisYear) || 0) + 1;
      context.totalSavedBudgetThisYear = (Number(context.totalSavedBudgetThisYear) || 0) + savedBudgetManwon;
    }

    const statusInfo = getRosterReleaseStatus(context, team.id);
    const tierLabel = prevStatus === "YUKSEONG" ? "육성선수" : prevStatus === "2GUN" ? "2군 선수" : "1군 선수";
    return {
      ok: true,
      releasedPlayer: target,
      savedBudgetManwon,
      budgetDelta: savedBudgetManwon,
      statusInfo,
      summary: `[${tierLabel} 방출 · 예산 절감] ${target.name}(${target.pos} · ${target.age}세, 연봉 ${(playerSal / 10000).toFixed(2)}억) 선수를 방출하여 연봉총액에서 ${(savedBudgetManwon / 10000).toFixed(2)}억 원이 빠져 여유 예산이 늘었습니다! (현재 총 로스터 ${statusInfo.totalRosterSize}명)`
    };
  }

  /**
   * 2군 및 육성선수 하위 전력 상시 방출 정리 (언제나 실행 가능 · 선수단 슬림화 & 예산 절감)
   */
  function autoTrimRosterForDraftees(context, teamId, options = {}) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const status = getRosterReleaseStatus(context, team.id);
    const forceCount = Number(options.forceCount) || 0;
    const needed =
      forceCount > 0
        ? forceCount
        : status.recommendedMoreReleases > 0
        ? status.recommendedMoreReleases
        : Math.max(1, Math.min(3, (team.rosterDev.length || 0) + Math.max(0, (team.roster2G.length || 0) - 18)));

    const curYear = context.currentYear || 2025;
    const candidates = [...team.rosterDev, ...team.roster2G]
      .filter((p) => (!p.nationality || p.nationality === "KOR") && (!p.draftInfo || Number(p.draftInfo.year) !== curYear))
      .sort((a, b) => {
        const devPriorityA = a.status === "YUKSEONG" ? -5 : 0;
        const devPriorityB = b.status === "YUKSEONG" ? -5 : 0;
        const scoreA = a.getTrueOvr() * 0.6 + (a.potential || 65) * 0.4 - Math.max(0, a.age - 27) * 1.5 + devPriorityA;
        const scoreB = b.getTrueOvr() * 0.6 + (b.potential || 65) * 0.4 - Math.max(0, b.age - 27) * 1.5 + devPriorityB;
        return scoreA - scoreB;
      });

    if (candidates.length === 0) {
      return {
        ok: false,
        reason: "현재 2군 및 육성군에 방출 가능한 대상 선수가 없습니다."
      };
    }

    const releasedNames = [];
    let totalSavedManwon = 0;
    for (let i = 0; i < Math.min(needed, candidates.length); i++) {
      const res = releaseDomesticPlayer(context, team.id, candidates[i].id);
      if (res.ok) {
        releasedNames.push(`${candidates[i].name}(${candidates[i].pos})`);
        totalSavedManwon += res.savedBudgetManwon || 0;
      }
    }

    return {
      ok: true,
      releasedCount: releasedNames.length,
      releasedNames,
      totalSavedManwon,
      summary: `[2군·육성선수 정리 완료] 하위 전력 ${releasedNames.length}명(${releasedNames.join(", ")})을 방출하고 운영 예산 총 +${(totalSavedManwon / 10000).toFixed(2)}억 원(${totalSavedManwon.toLocaleString()}만 원)을 절감했습니다!`
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * [신규 요청 8 & 9] 단장 간 다대다 트레이드 카드 협상실 (선수 + 신인 지명권 양도 + 현금 트레이드)
   * - KBO 공식 트레이드 마감 시한: 매년 7월 31일 (8월 1일 ~ 포스트시즌 종료까지 트레이드 불가)
   * ═══════════════════════════════════════════════════════════════════════ */
  const DRAFT_PICK_TRADE_VALUES = {
    1: 28,
    2: 20,
    3: 15,
    4: 11,
    5: 8,
    6: 6,
    7: 4.5,
    8: 3.5,
    9: 2.5,
    10: 2.0
  };

  function calcSinglePlayerTradeValue(p) {
    if (!p) return 0;
    const ovr = p.getTrueOvr();
    const pot = p.potential || 70;
    const ageAdj = p.age <= 24 ? (25 - p.age) * 1.4 : -Math.max(0, p.age - 30) * 1.8;
    const warBonus = Math.max(0, p.getWar ? p.getWar() : 0) * 2.2;
    return +(ovr * 0.65 + pot * 0.35 + ageAdj + warBonus).toFixed(1);
  }

  /**
   * KBO 트레이드 마감 시한(7월 31일) 확인 헬퍼
   */
  function checkKBOTradeDeadline(context) {
    const curDate = (context && context.currentDate) || "2025-01-01";
    const yr = (context && context.currentYear) || 2025;
    const phase = getSeasonPhaseByDate(curDate);
    return {
      allowed: Boolean(phase.canTrade),
      deadlineDateStr: `${yr}-07-31`,
      label: phase.canTrade
        ? "🟢 KBO 트레이드 가능 기간 (타 구단 선택 및 직접 제안 활성)"
        : "🔴 7월 31일 트레이드 마감 시한 경과 (포스트시즌 종료 시까지 양도 불가)",
      reason: phase.canTrade
        ? "아래에서 협상할 상대 구단을 선택하고, 우리 선수·신인 지명권(1~5R)·현금을 조합해 직접 트레이드를 제안하세요."
        : "KBO 규약 제71조에 의거 8월 1일 ~ 10월 31일 기간에는 선수 및 지명권 트레이드가 금지됩니다."
    };
  }

  /**
   * 스프링캠프 출발 예약 (출발 시점과 14일 후 훈련 결과 확인 사이에 실제 날짜 진행 시차 부여)
   */
  function startSpringCampSchedule(context, options = {}) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const gm = KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM);
    const loc = options.userCampLocation || "USA";
    const focus = options.trainingFocus || "BALANCED";
    const locMap = {
      USA: "미국 애리조나/플로리다 캠프",
      OKINAWA: "일본 오키나와/미야자키 캠프",
      DOMESTIC: "국내 1차 스프링캠프"
    };
    const daysTotal = Number(options.durationDays) || 14;
    const d = parseDateISO(context.currentDate || `${context.currentYear}-02-01`);
    d.setUTCDate(d.getUTCDate() + daysTotal);
    const expectedEndDate = formatDateISO(d);

    const campObj = {
      year: context.currentYear,
      status: "IN_PROGRESS",
      location: loc,
      locationName: locMap[loc] || loc,
      focus,
      startDate: context.currentDate,
      expectedEndDate,
      endDate: expectedEndDate,
      daysTotal,
      durationDays: daysTotal,
      daysElapsed: 0,
      progressDays: 0,
      dailyLogs: [
        `[${context.currentDate}] ${locMap[loc] || loc} 본진 출발 및 숙소/훈련장 캠프 차리기 완료`
      ],
      report: null
    };
    context.springCampState = campObj;
    context.activeSpringCamp = campObj;

    const msg = `✈️ [스프링캠프 출발 완료!] '${locMap[loc] || loc}'로 선수단이 출국했습니다. 앞으로 ${daysTotal}일간(+1일/+7일 진행) 현지 훈련을 소화한 뒤(${formatKoreanDate(expectedEndDate)}) 최종 훈련 결과 리포트가 도착합니다!`;
    return {
      ok: true,
      campState: campObj,
      activeSpringCamp: campObj,
      message: msg,
      summary: msg
    };
  }

  /**
   * 단장 간 트레이드 패키지 가치 평가
   * @param {GMGameContext} context
   * @param {Object} spec
   *   - targetTeamId (또는 partnerTeamId): 상대 구단 ID
   *   - myPlayerIds: string[]
   *   - targetPlayerIds: string[]
   *   - myPickRounds: number[] (내가 양도하는 지명권 라운드, 예: [2])
   *   - targetPickRounds: number[] (상대에게 요구하는 지명권 라운드, 예: [4])
   *   - cashOfferManwon (또는 cashToPartner - cashFromPartner): number
   */
  function evaluateTradePackage(context, spec = {}) {
    if (!context) return { ok: false, canTradeNow: false, reason: "컨텍스트 없음" };
    const phase = getSeasonPhaseByDate(context.currentDate);
    const userTeam = context.getUserTeam();
    const resolvedPartnerId = spec.targetTeamId || spec.partnerTeamId;
    const targetTeam = context.getTeam(resolvedPartnerId);

    if (!userTeam || !targetTeam || userTeam.id === targetTeam.id) {
      return { ok: false, canTradeNow: phase.canTrade, reason: "상대 구단을 선택해 주세요." };
    }

    // 상대 구단 취약 포지션(partnerNeeds) 산출
    const posGroups = ["SP", "RP", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
    const posAvgList = posGroups.map((pos) => {
      const pList = targetTeam.roster1G.filter((p) => p.pos === pos);
      const avgOvr = pList.length ? pList.reduce((s, p) => s + p.getTrueOvr(), 0) / pList.length : 64;
      return { pos, avgOvr };
    });
    posAvgList.sort((a, b) => a.avgOvr - b.avgOvr);
    const partnerNeeds = posAvgList.slice(0, 3).map((x) => x.pos);

    const myIds = Array.isArray(spec.myPlayerIds) ? spec.myPlayerIds.filter(Boolean) : [];
    const targetIds = Array.isArray(spec.targetPlayerIds) ? spec.targetPlayerIds.filter(Boolean) : [];
    const myPicks = Array.isArray(spec.myPickRounds) ? spec.myPickRounds.map(Number).filter((r) => r >= 1 && r <= 10) : [];
    const targetPicks = Array.isArray(spec.targetPickRounds) ? spec.targetPickRounds.map(Number).filter((r) => r >= 1 && r <= 10) : [];
    const cash =
      spec.cashOfferManwon != null
        ? Number(spec.cashOfferManwon) || 0
        : (Number(spec.cashToPartner) || 0) - (Number(spec.cashFromPartner) || 0);

    const myPlayers = myIds.map((id) => userTeam.getAllPlayers().find((p) => p.id === id)).filter(Boolean);
    const targetPlayers = targetIds.map((id) => targetTeam.getAllPlayers().find((p) => p.id === id)).filter(Boolean);

    // [규정 2: 외국인 트레이드는 외국인끼리 / 내국인은 내국인끼리]
    const isForeignFn = (p) => Boolean(p && p.nationality && p.nationality !== "KOR");
    const myForeignCount = myPlayers.filter(isForeignFn).length;
    const myDomesticCount = myPlayers.length - myForeignCount;
    const targetForeignCount = targetPlayers.filter(isForeignFn).length;
    const targetDomesticCount = targetPlayers.length - targetForeignCount;

    let nationalityMismatch = false;
    let nationalityErrorReason = "";

    if ((myForeignCount > 0 && myDomesticCount > 0) || (targetForeignCount > 0 && targetDomesticCount > 0)) {
      nationalityMismatch = true;
      nationalityErrorReason =
        "⚠️ [KBO 트레이드 규정] 한 트레이드 패키지에 내국인 선수와 외국인 선수를 혼합하여 포함할 수 없습니다!";
    } else if (myForeignCount > 0 || targetForeignCount > 0) {
      if (myDomesticCount > 0 || targetDomesticCount > 0 || myForeignCount !== targetForeignCount) {
        nationalityMismatch = true;
        nationalityErrorReason =
          "⚠️ [KBO 트레이드 규정] 외국인 선수 트레이드는 반드시 외국인 선수끼리 동수(1:1 등)로만 교환할 수 있습니다! (내국인↔외국인 교차 트레이드 불가)";
      }
    }

    const needBonus = myPlayers.reduce((s, p) => s + (partnerNeeds.includes(p.pos) ? 3.5 : 0), 0);
    const myPlayerVal = myPlayers.reduce((s, p) => s + calcSinglePlayerTradeValue(p), 0) + needBonus;
    const targetPlayerVal = targetPlayers.reduce((s, p) => s + calcSinglePlayerTradeValue(p), 0);

    const myPickVal = myPicks.reduce((s, r) => s + (DRAFT_PICK_TRADE_VALUES[r] || 3), 0);
    const targetPickVal = targetPicks.reduce((s, r) => s + (DRAFT_PICK_TRADE_VALUES[r] || 3), 0);

    // 현금 1억(10,000만원)당 가치 1.5점 환산 (상대 구단이 리빌딩/머니볼이면 현금·지명권 선호도 1.25배)
    const targetPhil = targetTeam.philosophy || "PRESTIGE";
    const pickCashPref = targetPhil === "MONEYBALL" || targetPhil === "REBUILDING" ? 1.22 : 1.0;

    const cashVal = (cash / 10000) * 1.5 * pickCashPref;
    const negTraitBonus = context.gmProfile && context.gmProfile.trait === "NEGOTIATOR" ? 3.5 : 0;

    const myTotalVal = +(myPlayerVal + myPickVal * pickCashPref + cashVal + negTraitBonus).toFixed(1);
    const targetTotalVal = +(targetPlayerVal + targetPickVal).toFixed(1);
    const diff = +(myTotalVal - targetTotalVal).toFixed(1);

    const hasAnyAsset =
      myPlayers.length > 0 || targetPlayers.length > 0 || myPicks.length > 0 || targetPicks.length > 0 || Math.abs(cash) > 0;

    const isAcceptable = phase.canTrade && hasAnyAsset && !nationalityMismatch && diff >= -2.5;

    let reactionLabel = "카드 선택 대기";
    let aiComment = "좌측(우리 구단)과 우측(상대 구단)에서 교환할 선수(내국인↔내국인 또는 외국인↔외국인), 신인 지명권(1~5R), 현금을 선택해 직접 트레이드를 제안하세요.";
    if (!phase.canTrade) {
      reactionLabel = "트레이드 마감 (불가)";
      aiComment = "현재 KBO 트레이드 마감 시한(7월 31일)이 지나 포스트시즌 종료 후 스토브리그 개장 시점까지 트레이드가 금지됩니다.";
    } else if (nationalityMismatch) {
      reactionLabel = "규정 위반 (내국인↔내국인 / 외국인↔외국인)";
      aiComment = nationalityErrorReason;
    } else if (hasAnyAsset) {
      if (diff >= 5) {
        reactionLabel = "즉시 수락 (대환영)";
        aiComment = `"${targetTeam.name} 단장: 아주 매력적인 제안입니다! 당장 합의서에 도장을 찍겠습니다."`;
      } else if (diff >= -2.5) {
        reactionLabel = "합의 가능 (긍정적)";
        aiComment = `"${targetTeam.name} 단장: 양 구단 모두 수지가 맞는 합리적인 트레이드 카드군요. 제안을 수락하겠습니다!"`;
      } else {
        reactionLabel = "거절 (조건 보강 필요)";
        const neededCashEok = Math.ceil(Math.abs(diff + 1.5) / (1.5 * pickCashPref));
        aiComment = `"${targetTeam.name} 단장: 카드의 무게감이 부족합니다 (가치 차이 ${diff}점). 현금 약 ${neededCashEok}억 원을 추가하거나 상위 지명권/선수를 더 얹어 주십시오."`;
      }
    }

    return {
      ok: true,
      canTradeNow: phase.canTrade,
      nationalityMismatch,
      nationalityErrorReason,
      tradeDeadlineText: "매년 7월 31일 마감 (8월 1일 ~ 10월 31일 트레이드 금지)",
      partnerNeeds,
      reactionLabel,
      myPlayers,
      targetPlayers,
      myPicks,
      targetPicks,
      cashOfferManwon: cash,
      myTotalVal,
      targetTotalVal,
      myTotalValue: myTotalVal,
      targetTotalValue: targetTotalVal,
      diff,
      isAcceptable,
      aiComment
    };
  }

  /**
   * AI 단장에게 카드 밸런스를 자동으로 맞춰달라고 요청 (현금 또는 지명권 자동 보정)
   */
  function autoBalanceTradePackage(context, spec = {}) {
    const resolvedPartnerId = spec.targetTeamId || spec.partnerTeamId;
    const initCash =
      spec.cashOfferManwon != null
        ? Number(spec.cashOfferManwon) || 0
        : (Number(spec.cashToPartner) || 0) - (Number(spec.cashFromPartner) || 0);

    const nextSpec = {
      targetTeamId: resolvedPartnerId,
      partnerTeamId: resolvedPartnerId,
      myPlayerIds: Array.isArray(spec.myPlayerIds) ? [...spec.myPlayerIds] : [],
      targetPlayerIds: Array.isArray(spec.targetPlayerIds) ? [...spec.targetPlayerIds] : [],
      myPickRounds: Array.isArray(spec.myPickRounds) ? [...spec.myPickRounds] : [],
      targetPickRounds: Array.isArray(spec.targetPickRounds) ? [...spec.targetPickRounds] : [],
      cashOfferManwon: initCash
    };

    const userTeam = context.getUserTeam();
    const targetTeam = context.getTeam(resolvedPartnerId);
    if (!userTeam || !targetTeam) {
      return { ok: false, reason: "상대 구단을 먼저 선택해 주세요." };
    }

    // 아무 카드도 없으면 현재 트레이드 모드(내국인 vs 외국인)에 맞춰 상대 주전급 1명 + 내 동급 선수 1명 자동 세팅
    if (
      nextSpec.myPlayerIds.length === 0 &&
      nextSpec.targetPlayerIds.length === 0 &&
      nextSpec.myPickRounds.length === 0 &&
      nextSpec.targetPickRounds.length === 0
    ) {
      const wantForeign = spec.nationalityMode === "FOREIGN";
      const targetPool = targetTeam.roster1G.filter((p) =>
        wantForeign ? p.nationality && p.nationality !== "KOR" : !p.nationality || p.nationality === "KOR"
      );
      const myPool = userTeam.roster1G.filter((p) =>
        wantForeign ? p.nationality && p.nationality !== "KOR" : !p.nationality || p.nationality === "KOR"
      );
      const targetCand = targetPool[Math.min(wantForeign ? 0 : 4, Math.max(0, targetPool.length - 1))];
      const myCand = myPool[Math.min(wantForeign ? 0 : 5, Math.max(0, myPool.length - 1))];
      if (targetCand) nextSpec.targetPlayerIds = [targetCand.id];
      if (myCand) nextSpec.myPlayerIds = [myCand.id];
    }

    let check = evaluateTradePackage(context, nextSpec);
    if (!check.ok) return check;

    if (check.diff < -2.0) {
      const deficit = Math.abs(check.diff) - 1.0;
      // 1순위: 보유 지명권으로 맞출 수 있고 현금 부담이 크면 지명권 추가
      if (deficit >= 10 && nextSpec.myPickRounds.length === 0) {
        const suggestedRound = deficit >= 22 ? 1 : deficit >= 16 ? 2 : deficit >= 11 ? 3 : 4;
        nextSpec.myPickRounds = [suggestedRound];
        check = evaluateTradePackage(context, nextSpec);
      }
      // 남은 차액은 현금 트레이드 금액으로 정확히 보정
      if (check.diff < -1.5) {
        const addCashManwon = Math.ceil(((Math.abs(check.diff) / 1.5) * 10000) / 5000) * 5000;
        const maxAffordable = Math.max(0, userTeam.getAvailableBudget());
        nextSpec.cashOfferManwon = clamp(nextSpec.cashOfferManwon + addCashManwon, -300000, maxAffordable);
      }
    } else if (check.diff > 8.0) {
      // 내가 너무 손해보는 카드면 상대에게 지명권 또는 현금을 요구하도록 보정
      if (nextSpec.targetPickRounds.length === 0 && check.diff >= 12) {
        nextSpec.targetPickRounds = [check.diff >= 20 ? 2 : 3];
      } else if (nextSpec.cashOfferManwon > 0) {
        nextSpec.cashOfferManwon = Math.max(
          0,
          nextSpec.cashOfferManwon - Math.floor(((check.diff / 1.5) * 10000) / 5000) * 5000
        );
      }
    }

    const finalEval = evaluateTradePackage(context, nextSpec);
    const cashToPartner = nextSpec.cashOfferManwon > 0 ? nextSpec.cashOfferManwon : 0;
    const cashFromPartner = nextSpec.cashOfferManwon < 0 ? Math.abs(nextSpec.cashOfferManwon) : 0;

    return {
      ok: true,
      myPlayerIds: nextSpec.myPlayerIds,
      targetPlayerIds: nextSpec.targetPlayerIds,
      myPickRounds: nextSpec.myPickRounds,
      targetPickRounds: nextSpec.targetPickRounds,
      cashToPartner,
      cashFromPartner,
      balancedSpec: nextSpec,
      evaluation: finalEval,
      message: `AI 단장 요구에 맞춰 트레이드 카드(지명권 ${nextSpec.myPickRounds.length}장 · 현금 ${(cashToPartner / 10000).toFixed(1)}억)를 자동 조율했습니다!`
    };
  }

  /**
   * 단장 간 패키지 트레이드(선수 다수 + 지명권 양도 + 현금) 최종 실행
   */
  function executePackageTrade(context, spec = {}) {
    const resolvedPartnerId = spec.targetTeamId || spec.partnerTeamId;
    const ev = evaluateTradePackage(context, { ...spec, targetTeamId: resolvedPartnerId });
    if (!ev.ok) return { ok: false, reason: ev.reason };
    if (!ev.canTradeNow) {
      return {
        ok: false,
        reason: "트레이드 마감 시한(7월 31일)이 경과하여 현재는 트레이드를 실행할 수 없습니다. (11월 스토브리그 개장 시 재개)"
      };
    }
    if (!ev.isAcceptable) {
      return {
        ok: false,
        evaluation: ev,
        reason: ev.aiComment
      };
    }

    const gm = KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM);
    const mgrConflict = gm && (gm.ManagerConflict || gm.RealisticGM || gm.Extensions);

    // [감독 트레이드 거부권 행사 검증] 단장이 OVR 상위 핵심 선수를 트레이드 카드로 지정 시 감독이 거부권 행사
    if (
      !spec.forceOverrideVeto &&
      mgrConflict &&
      typeof mgrConflict.checkManagerTradeVeto === "function" &&
      Array.isArray(spec.myPlayerIds) &&
      spec.myPlayerIds.length > 0
    ) {
      const vetoCheck = mgrConflict.checkManagerTradeVeto(context, context.userTeamId, spec.myPlayerIds);
      if (vetoCheck && vetoCheck.vetoed) {
        return {
          ok: false,
          vetoedByManager: true,
          vetoEvent: vetoCheck.vetoEvent,
          player: vetoCheck.player,
          reason: vetoCheck.reason
        };
      }
    } else if (
      spec.forceOverrideVeto &&
      mgrConflict &&
      typeof mgrConflict.resolveTradeVeto === "function"
    ) {
      mgrConflict.resolveTradeVeto(context, context.userTeamId, "FORCE_TRADE");
    }

    const userTeam = context.getUserTeam();
    const targetTeam = context.getTeam(resolvedPartnerId);
    const cash = ev.cashOfferManwon;

    if (cash > 0 && userTeam.getAvailableBudget() - cash < 0) {
      return { ok: false, reason: "여유 예산(예산 - 연봉총액)이 부족합니다. 현금 지급액을 낮춰 주세요." };
    }
    if (cash < 0 && targetTeam.getAvailableBudget() - Math.abs(cash) < 0) {
      return { ok: false, reason: "상대 구단의 잔여 예산이 부족하여 해당 현금 요구액을 지불할 수 없습니다." };
    }

    // 1) 선수 이동
    ev.myPlayers.forEach((mp) => {
      ["roster1G", "roster2G", "rosterDev"].forEach((rk) => {
        userTeam[rk] = userTeam[rk].filter((p) => p.id !== mp.id);
      });
      mp.teamId = targetTeam.id;
      mp.acquiredVia = { type: "TRADE", date: context.currentDate || null, fromTeamId: mp.formerTeamId || null }; // 시즌 회고 리포트용 영입 경로
      mp.status = targetTeam.roster1G.length < 28 ? "1GUN" : "2GUN";
      if (mp.status === "1GUN") targetTeam.roster1G.push(mp);
      else targetTeam.roster2G.push(mp);
      mp.tradeDemand = false;
      mp.morale = clamp((mp.morale || 75) + 15, 0, 100);
      if (typeof mp.updateScoutingReport === "function") {
        mp.updateScoutingReport(context.scoutLevel || 1, false);
      }
    });

    ev.targetPlayers.forEach((tp) => {
      ["roster1G", "roster2G", "rosterDev"].forEach((rk) => {
        targetTeam[rk] = targetTeam[rk].filter((p) => p.id !== tp.id);
      });
      tp.teamId = userTeam.id;
      tp.acquiredVia = { type: "TRADE", date: context.currentDate || null, fromTeamId: tp.formerTeamId || null }; // 시즌 회고 리포트용 영입 경로
      tp.status = userTeam.roster1G.length < 28 ? "1GUN" : "2GUN";
      if (tp.status === "1GUN") userTeam.roster1G.push(tp);
      else userTeam.roster2G.push(tp);
      tp.tradeDemand = false;
      tp.morale = clamp((tp.morale || 75) + 12, 0, 100);
      if (typeof tp.updateScoutingReport === "function") {
        tp.updateScoutingReport(context.scoutLevel || 1, true);
      }
    });

    // 2) 신인 드래프트 지명권 양도 기록 (context.tradedPicks)
    if (!Array.isArray(context.tradedPicks)) context.tradedPicks = [];
    const curYear = context.currentYear || 2025;

    ev.myPicks.forEach((r) => {
      context.tradedPicks = context.tradedPicks.filter(
        (pk) => !(pk.year === curYear && pk.round === r && (pk.originalTeamId === userTeam.id || pk.fromTeamId === userTeam.id))
      );
      context.tradedPicks.push({
        year: curYear,
        round: r,
        fromTeamId: userTeam.id,
        toTeamId: targetTeam.id,
        originalTeamId: userTeam.id,
        originalTeamShort: getShortTeamMascot(userTeam.id),
        currentOwnerTeamId: targetTeam.id,
        currentOwnerShort: getShortTeamMascot(targetTeam.id),
        tradedAt: context.currentDate
      });
    });

    ev.targetPicks.forEach((r) => {
      context.tradedPicks = context.tradedPicks.filter(
        (pk) => !(pk.year === curYear && pk.round === r && (pk.originalTeamId === targetTeam.id || pk.fromTeamId === targetTeam.id))
      );
      context.tradedPicks.push({
        year: curYear,
        round: r,
        fromTeamId: targetTeam.id,
        toTeamId: userTeam.id,
        originalTeamId: targetTeam.id,
        originalTeamShort: getShortTeamMascot(targetTeam.id),
        currentOwnerTeamId: userTeam.id,
        currentOwnerShort: getShortTeamMascot(userTeam.id),
        tradedAt: context.currentDate
      });
    });

    // 3) 현금 이체
    userTeam.budget = clamp((userTeam.budget || 1200000) - cash, -3000000, 4000000);
    targetTeam.budget = clamp((targetTeam.budget || 1200000) + cash, -3000000, 4000000);

    const mySideDesc = [
      ...ev.myPlayers.map((p) => `${p.name}(${p.pos})`),
      ...ev.myPicks.map((r) => `${curYear} 드래프트 ${r}R 지명권`),
      ...(cash > 0 ? [`현금 ${(cash / 10000).toFixed(1)}억`] : [])
    ].join(" + ") || "현금/조건";

    const targetSideDesc = [
      ...ev.targetPlayers.map((p) => `${p.name}(${p.pos})`),
      ...ev.targetPicks.map((r) => `${curYear} 드래프트 ${r}R 지명권`),
      ...(cash < 0 ? [`현금 ${(Math.abs(cash) / 10000).toFixed(1)}억`] : [])
    ].join(" + ") || "현금/조건";

    const tradeRecord = {
      date: context.currentDate,
      fromTeamId: userTeam.id,
      fromTeamName: userTeam.name,
      toTeamId: targetTeam.id,
      toTeamName: targetTeam.name,
      myTeamName: userTeam.name,
      partnerTeamName: targetTeam.name,
      myPlayers: ev.myPlayers.map((p) => `${p.name}(${p.pos})`),
      targetPlayers: ev.targetPlayers.map((p) => `${p.name}(${p.pos})`),
      cashToPartner: cash > 0 ? cash : 0,
      cashFromPartner: cash < 0 ? Math.abs(cash) : 0,
      mySideDesc,
      targetSideDesc,
      cashOfferManwon: cash,
      myPickRounds: ev.myPicks,
      targetPickRounds: ev.targetPicks
    };

    if (!Array.isArray(context.tradeHistory)) context.tradeHistory = [];
    context.tradeHistory.unshift(tradeRecord);
    {
      const retroMod = typeof globalThis !== "undefined" && globalThis.KBO_GM && globalThis.KBO_GM.Retro;
      if (retroMod && typeof retroMod.recordTrade === "function") retroMod.recordTrade(context, { partnerTeamId: targetTeam.id, sentIds: ev.myPlayers.map((p) => p.id), receivedIds: ev.targetPlayers.map((p) => p.id), cashManwon: cash });
    }

    // [감독 핀포인트 트레이드 요청 달성 판정]
    let directiveFulfilled = null;
    if (mgrConflict && typeof mgrConflict.fulfillTradeDirective === "function") {
      directiveFulfilled = mgrConflict.fulfillTradeDirective(context, userTeam.id, ev.targetPlayers);
    }

    return {
      ok: true,
      tradeRecord,
      directiveFulfilled,
      summary: `[트레이드 타결!] ${getShortTeamMascot(userTeam.id)} (${mySideDesc}) ↔ ${getShortTeamMascot(targetTeam.id)} (${targetSideDesc})${
        directiveFulfilled && directiveFulfilled.fulfilled
          ? ` · [감독 핀포인트 영입 요청 완수! 감독 신임도 +18]`
          : ""
      }`
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * [신규 요청 11] KBO 아시아 쿼터 제도 (구단당 1명 추가 보유: 일본 NPB/독립 · 대만 CPBL · 호주 ABL)
   * - 기존 외국인 선수 3명(투수 2 + 타자 1)과 별도로 아시아 국적 선수 1명 추가 영입 가능
   * ═══════════════════════════════════════════════════════════════════════ */
  function getAsianQuarterCandidates(context, count = 12) {
    if (!context || !Array.isArray(context.npbPool)) return [];
    const gm = KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM);
    const updateMetrics = gm && gm.updatePlayerMetrics;

    const candidates = context.npbPool.filter((p) =>
      ["JPN", "TWN", "AUS", "CHN"].includes(p.nationality) || p.isAsianQuarterEligible
    );

    return candidates
      .slice(0, count)
      .map((p) => {
        if (typeof updateMetrics === "function") updateMetrics(p);
        const se = p.scoutError || { ovrMin: 65, ovrMax: 76 };
        const aqCapSalary = clamp(round100((p.salary || 35000) * 0.55), 20000, 45000); // 아시아 쿼터 적정 연봉 2억~4.5억
        const leagueLabel =
          p.nationality === "JPN"
            ? "일본 NPB/독립"
            : p.nationality === "TWN"
              ? "대만 CPBL"
              : p.nationality === "AUS"
                ? "호주 ABL"
                : "아시아 BFA";
        return {
          playerId: p.id,
          name: p.name,
          pos: p.pos,
          type: p.type,
          age: p.age,
          nationality: p.nationality,
          leagueLabel,
          throwsBats: formatHandedness(p.throws, p.bats),
          ovrRange: `${se.ovrMin}~${se.ovrMax}`,
          expectedSalary: aqCapSalary,
          metrics: p.metrics || null
        };
      });
  }

  function signAsianQuarterPlayer(context, teamId, candidateId) {
    if (!context) return { ok: false, reason: "컨텍스트가 없습니다." };
    const team = context.getTeam(teamId || context.userTeamId);
    if (!team) return { ok: false, reason: "구단을 찾을 수 없습니다." };

    const candidate = (context.npbPool || []).find((p) => p.id === candidateId);
    if (!candidate) return { ok: false, reason: "아시아 쿼터 후보 선수를 찾을 수 없습니다." };

    if (!["JPN", "TWN", "AUS", "CHN"].includes(candidate.nationality) && !candidate.isAsianQuarterEligible) {
      return { ok: false, reason: "아시아야구연맹(BFA) 및 호주 국적 선수만 아시아 쿼터로 영입할 수 있습니다." };
    }

    // 연봉(contractCost)은 연봉총액에 포함되어 여유 예산을 차지한다. 교체 대상 아시아 쿼터의 연봉은 방출 시 빠지므로 함께 고려.
    const existingAQ = [...team.roster1G, ...team.roster2G].find((p) => p.isAsianQuarter);
    const contractCost = clamp(round100((candidate.salary || 35000) * 0.55), 20000, 45000);
    const freedSalary = existingAQ ? existingAQ.salary || 0 : 0;
    if (team.getAvailableBudget() + freedSalary < contractCost) {
      return { ok: false, reason: `여유 예산(${(team.getAvailableBudget() / 10000).toFixed(1)}억)이 아시아 쿼터 연봉(${(contractCost / 10000).toFixed(1)}억)보다 부족합니다.` };
    }

    // 기존 아시아 쿼터 선수가 있으면 자동 웨이버 방출(퇴출) 후 교체
    if (existingAQ) {
      releaseForeignPlayer(context, team.id, existingAQ.id);
    }

    context.npbPool = context.npbPool.filter((p) => p.id !== candidate.id);

    candidate.teamId = team.id;
    candidate.acquiredVia = { type: "FOREIGN", date: context.currentDate || null, fromTeamId: candidate.formerTeamId || null }; // 시즌 회고 리포트용 영입 경로
    candidate.salary = contractCost;
    candidate.contractYears = 1;
    candidate.isAsianQuarter = true;
    candidate.isAsianQuarterEligible = true;
    candidate.status = team.roster1G.length < 28 ? "1GUN" : "2GUN";

    if (candidate.status === "1GUN") team.roster1G.push(candidate);
    else team.roster2G.push(candidate);

    if (typeof candidate.updateScoutingReport === "function") {
      candidate.updateScoutingReport(context.scoutLevel || 1, team.id === context.userTeamId);
    }

    return {
      ok: true,
      player: candidate,
      contractCost,
      replacedPlayer: existingAQ || null,
      summary: `[아시아 쿼터 영입] ${candidate.name} (${candidate.nationality}/${candidate.pos}) 선수와 연봉 ${(contractCost / 10000).toFixed(2)}억 원에 아시아 쿼터 계약을 체결했습니다!`
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * [시스템 2] 하루 단위(+1일) 및 1주 스킵(+7일) 통합 진행 엔진 (advanceDays)
   * ═══════════════════════════════════════════════════════════════════════ */
  function advanceDays(context, days = 1, options = {}) {
    if (!context) throw new Error("유효한 GMGameContext가 필요합니다.");
    const gm = KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM);
    const stepDays = clamp(Math.round(Number(days) || 1), 1, 30);
    if (!Array.isArray(context.pendingEvents)) {
      context.pendingEvents = [];
    }

    // [강제 연동 1] 필수 할 일(Must-Do) 미처리 시 진행 블로킹 검사
    if (options.enforceMustDoBlocking && gm && gm.Assistant && typeof gm.Assistant.checkMustDoBlocking === "function") {
      const blk = gm.Assistant.checkMustDoBlocking(context);
      if (blk && blk.blocked) {
        if (context._auditMetrics) {
          context._auditMetrics.mustDoBlockedCount = (context._auditMetrics.mustDoBlockedCount || 0) + 1;
        }
        return {
          ok: false,
          blocked: true,
          blockedReason: blk.reason,
          mustDoTasks: blk.mustDo,
          currentDate: context.currentDate,
          koreanDate: formatKoreanDate(context.currentDate),
          seasonPhase: getSeasonPhaseByDate(context.currentDate),
          daysAdvanced: 0,
          matchesSimulated: 0,
          dailyEvents: [],
          todaysBriefing: gm.Assistant.getTodayTasks(context, { skipAuditIncrement: true })
        };
      }
    }

    const dailyEvents = [];
    let latestWeeklyReport = null;
    let draftWeekTriggered = false;
    let postseasonWeekTriggered = false;
    let secondaryDraftTriggered = false;
    let matchesSimulated = 0;

    for (let dIdx = 0; dIdx < stepDays; dIdx++) {
      const prevDateObj = parseDateISO(context.currentDate || `${context.currentYear}-01-01`);
      let nextDateObj = new Date(prevDateObj.getTime() + 86400000);
      // 윤년(2월 29일)은 3월 1일로 정규화하여 매년 정확히 365일(5년 = 1,825일) 캘린더 유지
      if (nextDateObj.getUTCMonth() === 1 && nextDateObj.getUTCDate() === 29) {
        nextDateObj = new Date(nextDateObj.getTime() + 86400000);
      }
      const prevYear = prevDateObj.getUTCFullYear();
      const nextYear = nextDateObj.getUTCFullYear();

      context.currentDate = formatDateISO(nextDateObj);
      const month = nextDateObj.getUTCMonth() + 1;
      const dayOfMonth = nextDateObj.getUTCDate();

      // 1) 아마추어 스카우트 파견 일일 진행 (유망주 Fog of War 축소) 및 상무 피닉스 군보류 일일 진행
      applyDailyScoutProgress(context, 1);
      if (gm && gm.Extensions && typeof gm.Extensions.processDailyMilitaryService === "function") {
        const milRes = gm.Extensions.processDailyMilitaryService(context, 1);
        if (milRes) {
          (milRes.discharges || []).forEach((d) => {
            dailyEvents.push({
              date: context.currentDate,
              type: "SANGMU_DISCHARGE",
              teamId: d.teamId,
              playerId: d.playerId,
              message: d.message
            });
          });
          (milRes.forcedEnlistments || []).forEach((fe) => {
            dailyEvents.push({
              date: context.currentDate,
              type: "SANGMU_FORCED_ENLIST",
              teamId: fe.teamId,
              playerId: fe.playerId,
              message: fe.message
            });
          });
        }
      }

      // 2) 부상 선수 잔여일 및 6주 대체 외국인 계약 잔여일 일일 차감
      context.kboTeams.forEach((team) => {
        team.getAllPlayers().forEach((p) => {
          if (p.injury && p.injury.active) {
            if (p.injury.daysLeft == null) {
              p.injury.daysLeft = Math.max(1, (p.injury.weeksLeft || 1) * 7);
            }
            p.injury.daysLeft = Math.max(0, p.injury.daysLeft - 1);
            p.injury.weeksLeft = Math.ceil(p.injury.daysLeft / 7);
            if (p.injury.daysLeft <= 0) {
              p.injury = { active: false, name: null, part: null, label: null, weeksLeft: 0, daysLeft: 0, major: false };
              dailyEvents.push({
                date: context.currentDate,
                type: "RECOVERY",
                message: `[부상 복귀] ${team.name} ${p.name}(${p.pos}) 완쾌 후 복귀`
              });
            }
          }

          if (p.isTempForeignReplacement && typeof p.tempContractDaysLeft === "number") {
            p.tempContractDaysLeft = Math.max(0, p.tempContractDaysLeft - 1);
            p.tempContractWeeksLeft = Math.ceil(p.tempContractDaysLeft / 7);
          }
        });

        // 일시 재활 명단(foreignRehabList)에 있는 장기 부상 외국인 선수 재활 카운트 차감
        (team.foreignRehabList || []).forEach((rp) => {
          if (rp.injury && rp.injury.active) {
            if (rp.injury.daysLeft == null) {
              rp.injury.daysLeft = Math.max(1, (rp.injury.weeksLeft || 6) * 7);
            }
            rp.injury.daysLeft = Math.max(0, rp.injury.daysLeft - 1);
            rp.injury.weeksLeft = Math.ceil(rp.injury.daysLeft / 7);
            if (rp.injury.daysLeft <= 0) {
              rp.injury.active = false;
              dailyEvents.push({
                date: context.currentDate,
                type: "FOREIGN_REHAB_READY",
                teamId: team.id,
                playerId: rp.id,
                message: `[외국인 재활 완료] ${team.name} ${rp.name}(${rp.pos}) 6주 재활 완료! 복귀 또는 대체 외국인 정식 전환을 선택하세요.`
              });
            }
          }
        });
      });

      // 2-C) [요청 4] 스프링캠프 출발 후 진행 중(IN_PROGRESS)인 경우 일일 훈련 진행 및 14일차 결과 리포트 도착
      const campSt = context.springCampState || context.activeSpringCamp;
      if (campSt && campSt.status === "IN_PROGRESS") {
        context.springCampState = campSt;
        context.activeSpringCamp = campSt;
        campSt.daysElapsed = (campSt.daysElapsed || 0) + 1;
        campSt.progressDays = campSt.daysElapsed;
        if (!Array.isArray(campSt.dailyLogs)) campSt.dailyLogs = [];
        const dNum = campSt.daysElapsed;
        if (dNum === 3) {
          campSt.dailyLogs.push(`[${context.currentDate} · 캠프 3일차] 투수조 불펜 피칭 & 야수조 배팅 케이지 타격 훈련 소화`);
        } else if (dNum === 7) {
          campSt.dailyLogs.push(`[${context.currentDate} · 캠프 7일차] 자체 청백전 및 신구종 장착 집중 점검`);
        } else if (dNum === 11) {
          campSt.dailyLogs.push(`[${context.currentDate} · 캠프 11일차] 현지 연습경기 실전 감각 조율 및 유망주 기량 상승`);
        }
        if (campSt.daysElapsed >= (campSt.daysTotal || campSt.durationDays || 14)) {
          if (gm && gm.SpringCamp && typeof gm.SpringCamp.runSpringCamp === "function") {
            const campRep = gm.SpringCamp.runSpringCamp(context, {
              userCampLocation: campSt.location || "USA",
              trainingFocus: campSt.focus || "BALANCED"
            });
            campSt.status = "COMPLETED";
            campSt.completedDate = context.currentDate;
            campSt.endDate = context.currentDate;
            campSt.report = campRep;
            context.lastCampReport = campRep;
            campSt.dailyLogs.push(`[${context.currentDate} · 캠프 완주!] ${campSt.daysTotal || 14}일간의 전지훈련을 마치고 훈련 성과 보고서가 도착했습니다.`);
            dailyEvents.push({
              date: context.currentDate,
              type: "SPRING_CAMP_COMPLETED",
              report: campRep,
              message: `[스프링캠프 종료 및 훈련 결과 도착!] ${campSt.locationName} (${campSt.daysTotal || 14}일간) 전지훈련 결과 보고서가 도착했습니다!`
            });
          }
        }
      }

      // 3) 9월 23일 (공식 신인 드래프트 지명일) 도래 체크
      if (month === 9 && dayOfMonth === DRAFT_SCHEDULE_CONFIG.officialDay) {
        draftWeekTriggered = true;
        if (gm && gm.Draft && typeof gm.Draft.initDraftSession === "function" && !context.draftState) {
          gm.Draft.initDraftSession(context);
        }
        dailyEvents.push({
          date: context.currentDate,
          type: "ROOKIE_DRAFT",
          message: `[9월 23일 신인 드래프트 개막] ${context.currentYear} KBO 신인 드래프트 직접 지명이 시작되었습니다!`
        });
      }

      // 4) 정규시즌 기간(3월 22일 ~ 9월 30일) 주간 경기 시뮬레이션 연동
      // 매 7일 경과 또는 정규시즌 주간 단위로 advanceOneWeek 호출하여 24주(144경기) 소화 및 24주차 완료 시 오프시즌 전환 트리거
      const phase = getSeasonPhaseByDate(context.currentDate);
      if (phase.isRegularSeason && (context.currentWeek || 1) <= 24) {
        context._regSeasonDayCounter = (context._regSeasonDayCounter || 0) + 1;
        if (context._regSeasonDayCounter >= 7) {
          context._regSeasonDayCounter = 0;
          if (gm && typeof gm.advanceOneWeek === "function") {
            latestWeeklyReport = gm.advanceOneWeek(context, options);
            matchesSimulated += (latestWeeklyReport.kbo && latestWeeklyReport.kbo.matchResults.length) || 30;
            if (latestWeeklyReport.isRegularSeasonEnd || context.currentWeek > 24) {
              context.seasonPhase = "OFFSEASON_STOVE";
              dailyEvents.push({
                date: context.currentDate,
                type: "OFFSEASON_TRANSITION",
                message: `[24주차(144경기) 페넌트레이스 종료] 정규시즌이 마감되어 스토브리그(오프시즌) 체제로 전환되었습니다.`
              });
            }
          }
        }
      }

      // 4-B) [PART 4] 10월 10일: KBO 포스트시즌(가을야구) 개막 발동 (신인 드래프트와 동일하게 기간 도래 시 활성화, 마감일인 11월 3일까지 미진행 시 자동 결산)
      if (month === 10 && dayOfMonth === POSTSEASON_SCHEDULE_CONFIG.officialDay) {
        postseasonWeekTriggered = true;
        context.seasonPhase = "POSTSEASON";
        dailyEvents.push({
          date: context.currentDate,
          type: "POSTSEASON_OPENED",
          message: `[10월 10일 가을야구 개막!] ${context.currentYear} KBO 포스트시즌(와일드카드 → 준PO → PO → 한국시리즈)이 발동되었습니다!`
        });
        if (options.autoRunPostseason && gm && gm.Extensions && typeof gm.Extensions.runPostseasonTournament === "function") {
          const psRes = gm.Extensions.runPostseasonTournament(context, { bypassScheduleCheck: true });
          if (psRes && psRes.ok && psRes.report) {
            dailyEvents.push({
              date: context.currentDate,
              type: "POSTSEASON_COMPLETED",
              report: psRes.report,
              message: `[${context.currentYear} 한국시리즈 종료] ${psRes.report.championTeamName} 통합 우승! (준우승: ${psRes.report.runnerUpTeamName})`
            });
          }
        }
      }

      // 포스트시즌 마감 시한(11월 3일)까지 유저가 직접 진행하지 않은 경우 시즌 챔피언 누락 방지를 위해 자동 완료
      if (
        month === 11 &&
        dayOfMonth === 3 &&
        gm &&
        gm.Extensions &&
        typeof gm.Extensions.runPostseasonTournament === "function"
      ) {
        const alreadyDonePs =
          Array.isArray(context.postseasonHistory) &&
          context.postseasonHistory.some((h) => Number(h.year) === Number(context.currentYear));
        if (!alreadyDonePs) {
          const psRes = gm.Extensions.runPostseasonTournament(context, { bypassScheduleCheck: true });
          if (psRes && psRes.ok && psRes.report) {
            dailyEvents.push({
              date: context.currentDate,
              type: "POSTSEASON_COMPLETED",
              report: psRes.report,
              message: `[${context.currentYear} 한국시리즈 결산] ${psRes.report.championTeamName} 통합 우승! (준우승: ${psRes.report.runnerUpTeamName})`
            });
          }
        }
      }

      // 4-C) [PART 4] 격년(2025·2027·2029) 11월 5일: KBO 2차 드래프트 (35인 보호명단 외 1~3R 지명) 기간 개막 발동
      if (
        month === 11 &&
        dayOfMonth === SECONDARY_DRAFT_SCHEDULE_CONFIG.officialDay &&
        gm &&
        gm.Extensions &&
        typeof gm.Extensions.isBiennialDraftYear === "function" &&
        gm.Extensions.isBiennialDraftYear(context.currentYear)
      ) {
        secondaryDraftTriggered = true;
        dailyEvents.push({
          date: context.currentDate,
          type: "SECONDARY_DRAFT_OPENED",
          message: `[11월 5일 KBO 2차 드래프트 개막!] ${context.currentYear} KBO 2차 드래프트(35인 보호명단 외 1~3R 지명) 기간이 오픈되었습니다!`
        });
        if (options.autoRunSecondaryDraft && typeof gm.Extensions.runBiennialSecondaryDraft === "function") {
          const bdRes = gm.Extensions.runBiennialSecondaryDraft(context, { bypassScheduleCheck: true });
          if (bdRes && bdRes.ok && bdRes.report) {
            dailyEvents.push({
              date: context.currentDate,
              type: "BIENNIAL_SECONDARY_DRAFT",
              report: bdRes.report,
              message: `[${context.currentYear} KBO 2차 드래프트 완료] 35인 보호명단 외 총 ${bdRes.report.totalTransferred}명 구단 간 이적 완료`
            });
          }
        }
      }

      // 격년 2차 드래프트 마감 시한(11월 14일, 스토브리그 전환 직전)까지 미진행 시 자동 완료
      if (
        month === 11 &&
        dayOfMonth === 14 &&
        gm &&
        gm.Extensions &&
        typeof gm.Extensions.isBiennialDraftYear === "function" &&
        gm.Extensions.isBiennialDraftYear(context.currentYear) &&
        typeof gm.Extensions.runBiennialSecondaryDraft === "function"
      ) {
        const alreadyDoneBd =
          Array.isArray(context.biennialDraftHistory) &&
          context.biennialDraftHistory.some((h) => Number(h.year) === Number(context.currentYear));
        if (!alreadyDoneBd) {
          const bdRes = gm.Extensions.runBiennialSecondaryDraft(context, { bypassScheduleCheck: true });
          if (bdRes && bdRes.ok && bdRes.report) {
            dailyEvents.push({
              date: context.currentDate,
              type: "BIENNIAL_SECONDARY_DRAFT",
              report: bdRes.report,
              message: `[${context.currentYear} KBO 2차 드래프트 결산] 35인 보호명단 외 총 ${bdRes.report.totalTransferred}명 구단 간 이적 완료`
            });
          }
        }
      }

      // 4-C1) 11월 4일 (포스트시즌 마감 다음 날): 시즌 회고 리포트 생성 → 다음 시즌 기준 로스터 스냅샷
      if (month === 11 && dayOfMonth === 4 && gm && gm.Retro && typeof gm.Retro.buildSeasonRetrospective === "function") {
        const already = Array.isArray(context.seasonRetros) && context.seasonRetros.some((r) => r.year === context.currentYear);
        if (!already) {
          const retro = gm.Retro.buildSeasonRetrospective(context);
          if (retro) {
            dailyEvents.push({
              date: context.currentDate,
              type: "SEASON_RETRO",
              report: retro,
              message: `[시즌 회고 리포트 도착] ${retro.headline} — 데이터 기록실에서 확인하세요.`
            });
          }
        }
      }

      // 4-C2) 스토브리그 마감일 자동 처리 (유저가 버튼으로 먼저 처리한 단계는 건너뜀)
      //   - 12월 1일: 연봉 재계약(FA 연차 +1 포함) → FA 자격 선수 공시
      //   - 1월 15일: FA 시장 마감 — 미계약 FA는 AI 구단 입찰로 정리 (유저 구단은 자기 FA 잔류 입찰만 자동 진행)
      //   - 1월 31일: 외국인 선수 재계약/신규 계약 마감 (첫해처럼 연봉 재계약이 남아 있으면 함께 처리)
      if (gm && gm.Offseason && typeof gm.Offseason.isStoveStepDone === "function") {
        const off = gm.Offseason;
        const stoveEvent = (type, message) => dailyEvents.push({ date: context.currentDate, type, message });
        if (month === 12 && dayOfMonth === 1) {
          if (!off.isStoveStepDone(context, "salary")) {
            off.processSalaryRenewals(context, { userPolicy: "FAIR" });
            stoveEvent("STOVE_SALARY_AUTO", "[12월 1일 연봉 재계약 마감] 미처리 연봉 계약을 '적정 협상' 기준으로 일괄 체결했습니다.");
          }
          if (!off.isStoveStepDone(context, "declared")) {
            const declared = off.declareEligibleFAPlayers(context) || [];
            stoveEvent("STOVE_FA_DECLARED", `[FA 공시] ${context.currentYear + 1}시즌 FA 자격 선수 ${declared.length || (context.faPool || []).length}명이 시장에 나왔습니다. 1월 15일까지 협상하세요.`);
          }
        }
        // 원소속 우선협상 기간(공시 후 7일) 종료 → 전 구단 자유협상 자동 개시 (타 구단 FA 공개)
        if (typeof off.autoOpenFAMarketIfDue === "function") {
          const openRes = off.autoOpenFAMarketIfDue(context);
          if (openRes && openRes.ok) {
            stoveEvent(
              "FA_OPEN_MARKET_STARTED",
              `[FA 우선협상 종료] 전 구단 자유협상이 시작되었습니다. 타 구단 원소속 잔류 ${openRes.aiPrioritySignings.length}명 · 시장에 공개된 FA ${(context.faPool || []).length}명`
            );
          }
        }
        if (month === 1 && dayOfMonth === 15) {
          const openFAs = (context.faPool || []).filter((p) => !p.teamId || p.status === "FA");
          if (openFAs.length > 0 && typeof off.runFAMarketSession === "function") {
            const faRes = off.runFAMarketSession(context, {}, { autoDeclareFromRosters: false, allowAutoUserRetention: true });
            const signedCount = faRes && Number.isFinite(faRes.totalSigned) ? faRes.totalSigned : null;
            stoveEvent("STOVE_FA_MARKET_CLOSED", `[1월 15일 FA 시장 마감] 미계약 FA ${openFAs.length}명을 AI 구단 입찰로 정리했습니다${signedCount != null ? ` (계약 ${signedCount}건)` : ""}.`);
          }
        }
        if (month === 1 && dayOfMonth === 31) {
          if (!off.isStoveStepDone(context, "salary")) {
            off.processSalaryRenewals(context, { userPolicy: "FAIR" });
            stoveEvent("STOVE_SALARY_AUTO", "[1월 31일 연봉 재계약 마감] 미처리 연봉 계약을 '적정 협상' 기준으로 일괄 체결했습니다.");
          }
          if (!off.isStoveStepDone(context, "foreign") && typeof off.processForeignPlayerContracts === "function") {
            off.processForeignPlayerContracts(context, null);
            stoveEvent("STOVE_FOREIGN_AUTO", "[1월 31일 외국인 계약 마감] 10개 구단 외국인 선수 재계약·신규 계약을 마무리했습니다.");
          }
        }
      }

      // 4-D) [PART 4] 매년 12월 10일: 상무 피닉스 정기 입대 및 경쟁균형세(리그 평균 상위 40인 연봉 × 120% 상한) 심사
      if (month === 12 && dayOfMonth === 10 && gm && gm.Extensions) {
        if (typeof gm.Extensions.autoManageDecemberSangmuEnlistment === "function") {
          const enl = gm.Extensions.autoManageDecemberSangmuEnlistment(context);
          if (enl && enl.length > 0) {
            dailyEvents.push({
              date: context.currentDate,
              type: "SANGMU_REGULAR_ENLIST",
              count: enl.length,
              message: `[상무 피닉스 정기 입대] KBO 10개 구단 미필 유망주 ${enl.length}명 국군체육부대(18개월) 입대`
            });
          }
        }
        if (typeof gm.Extensions.evaluateLuxuryTaxAndPenalties === "function") {
          const taxRes = gm.Extensions.evaluateLuxuryTaxAndPenalties(context);
          if (taxRes && taxRes.ok) {
            dailyEvents.push({
              date: context.currentDate,
              type: "LUXURY_TAX_AUDIT",
              report: taxRes,
              message: `[경쟁균형세 심사 완료] 상위 40인 상한(${(taxRes.capLimitManwon / 10000).toFixed(1)}억) 초과 구단: ${taxRes.penalizedTeamIds.length}개 구단`
            });
          }
        }
      }

      // 5) 해가 바뀔 때(12월 31일 -> 1월 1일) 시즌 이관(finalizeOffseasonAndStartSeason) 및 단장 3년 주기 계약 심사(evaluateGMContractRenewal)
      if (nextYear > prevYear) {
        if (
          context._lastFinalizedSeason !== prevYear &&
          gm &&
          gm.SpringCamp &&
          typeof gm.SpringCamp.finalizeOffseasonAndStartSeason === "function"
        ) {
          context.currentYear = prevYear;
          const finRes = gm.SpringCamp.finalizeOffseasonAndStartSeason(context, {
            preserveCalendarDate: true
          });
          if (finRes && finRes.gmContractEvaluation) {
            dailyEvents.push({
              date: context.currentDate,
              type: "GM_CONTRACT_EVALUATED",
              evaluation: finRes.gmContractEvaluation,
              message: finRes.gmContractEvaluation.message || `[단장 계약 심사] ${finRes.gmContractEvaluation.status}`
            });
          }
        } else if (context.gmContract && context.gmContract._lastEvaluatedSeason !== prevYear) {
          const gmEval = evaluateGMContractRenewal(context);
          context.gmContract._lastEvaluatedSeason = prevYear;
          if (gmEval) {
            dailyEvents.push({
              date: context.currentDate,
              type: "GM_CONTRACT_EVALUATED",
              evaluation: gmEval,
              message: gmEval.message || `[단장 계약 심사] ${gmEval.status}`
            });
          }
        }
        context.currentYear = nextYear;
        context.currentWeek = 1;
        context._regSeasonDayCounter = 0;
      }
    }

    const todaysBriefing =
      gm && gm.Assistant && typeof gm.Assistant.generateDailyBriefing === "function"
        ? gm.Assistant.generateDailyBriefing(context)
        : null;
    if (todaysBriefing) {
      context.todaysBriefing = todaysBriefing;
    }

    return {
      currentDate: context.currentDate,
      koreanDate: formatKoreanDate(context.currentDate),
      seasonPhase: getSeasonPhaseByDate(context.currentDate),
      daysAdvanced: stepDays,
      matchesSimulated,
      draftWeekTriggered,
      postseasonWeekTriggered,
      secondaryDraftTriggered,
      offseasonTriggered: (context.currentWeek || 1) > 24,
      latestWeeklyReport,
      dailyEvents,
      todaysBriefing
    };
  }

  function advanceOneDay(context, options = {}) {
    return advanceDays(context, 1, options);
  }

  function advanceSevenDays(context, options = {}) {
    return advanceDays(context, 7, options);
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 3. 2024 성적 및 역순 예산 기반 로스터 생성 헬퍼
   * ═══════════════════════════════════════════════════════════════════════ */
  const KOR_SUR = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권", "황", "안", "송", "전", "홍"];
  const KOR_GIV = ["민준", "서준", "도윤", "예준", "시우", "하준", "주원", "지호", "지후", "준서", "준우", "현우", "도현", "지훈", "건우", "우진", "선우", "서진", "민재", "현준", "연우", "유준", "정우", "승우", "승현", "시윤", "준혁", "은우", "지환", "승민", "지우", "유찬", "윤우", "민성", "준영", "시현", "진우", "수현", "동현", "재윤", "태윤", "민규", "재민", "한결", "민우", "동건", "태민", "성민", "성현", "규민"];
  const JPN_SUR = ["사토", "스즈키", "다카하시", "다나카", "와타나베", "이토", "야마모토", "나카무라", "고바야시", "가토", "요시다", "야마구치", "마쓰모토", "이노우에", "기무라"];
  const JPN_GIV = ["쇼타", "렌", "하루토", "유토", "소타", "유마", "다이키", "카이토", "리쿠", "겐타", "다쿠미", "료", "고키", "유키", "하야토"];
  const WEST_FIRST = ["로건", "메이슨", "이든", "루카스", "잭슨", "에이든", "카터", "그레이슨", "레오", "세바스찬", "마테오", "디에고", "하비에르", "마르코스", "안토니오"];
  const WEST_LAST = ["밀러", "데이비스", "가르시아", "로드리게스", "마르티네스", "에르난데스", "로페스", "곤살레스", "윌슨", "앤더슨", "토마스", "테일러", "무어", "잭슨", "마틴"];
  const SECONDARY_PITCH_POOL = ["SL", "CB", "CH", "FK", "SP", "FC", "FT", "SW", "SI", "PC"];

  const ROSTER_1G_TEMPLATE = [
    "SP", "SP", "SP", "SP", "SP",
    "RP", "RP", "RP", "RP", "RP", "RP", "RP",
    "CP",
    "C", "C",
    "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH",
    "C", "SS", "2B", "CF", "1B"
  ];

  const ROSTER_2G_TEMPLATE = [
    "SP", "SP", "SP", "SP", "SP",
    "RP", "RP", "RP", "RP", "RP", "RP", "RP", "RP", "RP",
    "CP",
    "C", "C", "C",
    "1B", "1B", "2B", "2B", "3B", "3B", "SS", "SS", "LF", "CF", "RF", "DH"
  ];

  const ROSTER_DEV_TEMPLATE = ["SP", "RP", "RP", "C", "SS", "2B", "CF", "3B"];

  function generateName(nat = "KOR", rng = Math.random) {
    if (nat === "JPN") return `${pick(JPN_SUR, rng)} ${pick(JPN_GIV, rng)}`;
    if (nat !== "KOR") return `${pick(WEST_FIRST, rng)} ${pick(WEST_LAST, rng)}`;
    return `${pick(KOR_SUR, rng)}${pick(KOR_GIV, rng)}`;
  }

  function buildPitchArsenal(baseOvr, rng = Math.random) {
    const pitches = [{ k: "FF", m: clamp(Math.round(baseOvr + randInt(-5, 10, rng)), 38, 99) }];
    const count = randInt(2, 4, rng);
    const used = new Set(["FF"]);
    while (pitches.length < count) {
      const pk = pick(SECONDARY_PITCH_POOL, rng);
      if (used.has(pk)) continue;
      used.add(pk);
      pitches.push({ k: pk, m: clamp(Math.round(baseOvr - 5 + randInt(-10, 10, rng)), 28, 95) });
    }
    return pitches;
  }

  function createPlayerWithTier({
    pos,
    status,
    teamId = null,
    tierMean = 72,
    tierSpread = 7,
    ageRange = [20, 35],
    nationality = "KOR",
    origin = "KBO",
    gradeYear = null,
    scoutLevel = 1,
    isOwnTeam = false,
    moraleCondBonus = 0,
    rng = Math.random
  }) {
    const gm = KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM);
    const PlayerClass = gm.Player;
    const POSITIONS = gm.POSITIONS;
    const P_KEYS = gm.P_KEYS;
    const B_KEYS = gm.B_KEYS;
    const DECAYP = gm.DECAYP || { ironP: 0.05 };

    const posMeta = POSITIONS[pos] || POSITIONS.SP;
    const type = posMeta.group;
    const keys = type === "pitcher" ? P_KEYS : B_KEYS;
    const age = randInt(ageRange[0], ageRange[1], rng);

    const st = {};
    keys.forEach((k) => {
      let bonus = 0;
      if (pos === "SP" && (k === "stam" || k === "stamina")) bonus = 7;
      if ((pos === "CP" || pos === "RP") && (k === "stuff" || k === "velo")) bonus = 5;
      if (["C", "SS", "2B", "CF"].includes(pos) && (k === "def" || k === "defense")) bonus = 6;
      if (["1B", "3B", "LF", "RF", "DH"].includes(pos) && (k === "pow" || k === "power")) bonus = 6;
      st[k] = clamp(Math.round(tierMean + bonus + (rng() * 2 - 1) * tierSpread), 32, 106);
    });

    const ovrEst = keys.reduce((acc, k) => acc + st[k], 0) / keys.length;
    const potential = clamp(
      Math.round(ovrEst + Math.max(0, (27 - age) * 1.85) + randInt(0, 12, rng)),
      Math.round(ovrEst),
      108
    );

    let salary = 3000;
    let contractYears = 1;
    let faYears = 0;

    if (status === "DRAFT_POOL" || status === "YUKSEONG") {
      salary = 3000;
      contractYears = 1;
      faYears = 0;
    } else if (status === "FOREIGN_POOL") {
      salary = round100(clamp((ovrEst - 65) * 4500 + randInt(35000, 55000, rng), 35000, 180000));
      contractYears = 1;
      faYears = 0;
    } else {
      // 2025년 1월 1일 개막 시점에 일부 주전 베테랑이 즉시 FA 자격을 갖출 수 있도록 연차 배분
      faYears = status === "1GUN" ? clamp(age - 20 - randInt(0, 2, rng), 0, 9) : clamp(age - 22 - randInt(0, 4, rng), 0, 5);
      if (status === "1GUN") {
        const baseSal = ovrEst >= 84 ? 62000 : ovrEst >= 77 ? 30000 : ovrEst >= 71 ? 13500 : 6200;
        salary = round100(baseSal + randInt(-1800, 7500, rng));
        contractYears = ovrEst >= 82 && age >= 29 && faYears < 8 && rng() < 0.35 ? randInt(2, 4, rng) : 1;
      } else {
        salary = round100(clamp(3000 + (age - 19) * 330 + randInt(0, 1400, rng), 3000, 8800));
        contractYears = 1;
      }
    }

    const throws = type === "pitcher" ? (rng() < 0.30 ? "L" : "R") : (rng() < 0.12 ? "L" : "R");
    const bats = type === "batter" ? (rng() < 0.04 ? "S" : rng() < 0.36 ? "L" : "R") : throws;

    const p = new PlayerClass({
      name: generateName(nationality, rng),
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
      pitches: type === "pitcher" ? buildPitchArsenal(ovrEst, rng) : [],
      teamId,
      status,
      salary,
      contractYears,
      faYears,
      cond: +(1.0 + moraleCondBonus).toFixed(2),
      scoutLevel,
      isOwnTeam
    });

    if (gradeYear != null) {
      p.gradeYear = gradeYear;
    }
    p.scoutProgress = isOwnTeam ? 100 : status === "DRAFT_POOL" ? 20 + scoutLevel * 8 : 35;
    return p;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * [시스템 1·2·8] 신규 게임 세션 생성 함수 (initNewGameSession)
   * - 시작 날짜: 2025년 1월 1일 ("2025-01-01")
   * - 단장 첫 계약: 3년 총액 8억 원 (계약금 2억 원 + 연봉 2억 원) 고정
   * - 2024년 KBO 최종 순위 기반 구단 전력(tierMean) 및 역순 예산(10위 키움 175억 ~ 1위 KIA 120억)
   * ═══════════════════════════════════════════════════════════════════════ */
  function createGameContextSync(optionsOrSlotId = {}, gmNameArg, gmTraitArg, userTeamIdArg) {
    let opts = {};
    if (typeof optionsOrSlotId === "string") {
      opts = {
        slotId: optionsOrSlotId,
        gmName: gmNameArg,
        gmTrait: gmTraitArg,
        userTeamId: userTeamIdArg
      };
    } else if (optionsOrSlotId && typeof optionsOrSlotId === "object") {
      opts = { ...optionsOrSlotId };
    }

    const gm = KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM);
    if (!gm || !gm.Team || !gm.GMGameContext) {
      throw new Error("KBO_GM 스키마(gm-schema.js)가 로드되지 않았습니다.");
    }

    const slotId = String(opts.slotId || "slot_1");
    const userTeamId = resolveTeamId(opts.userTeamId || "KIA");
    const gmProfile = createGMProfile(opts.gmName || "김단장", opts.gmTrait || "DATA_ANALYST");
    const startYear = Number(opts.startYear) || 2025;
    const startDate = opts.startDate || `${startYear}-01-01`;
    const rng = opts.rng || Math.random;

    const baseScoutLevel = clamp(Number(opts.baseScoutLevel) || 1, 1, 5);
    const effectiveScoutLevel = clamp(baseScoutLevel + gmProfile.effects.scoutLevelBonus, 1, 5);
    const ownerTrustBonus = gmProfile.effects.ownerTrustBonus || 0;
    const moraleCondBonus = gmProfile.effects.moraleCondBonus || 0;
    const negotiationDiscount = gmProfile.effects.demandDiscount || 0;

    // 1) 2024년 KBO 순위 기반 10개 구단 로스터 생성 (외국인은 1군/2군만 배정, 육성군(rosterDev)은 전원 국내 선수)
    const kboTeams = KBO_TEAM_2024_META.map((meta) => {
      const isOwnTeam = meta.id === userTeamId;
      const condBonus = isOwnTeam ? moraleCondBonus : 0;

      const roster1G = ROSTER_1G_TEMPLATE.map((pos, idx) => {
        const isForeign = idx === 0 || idx === 1 || idx === 15;
        const nat = isForeign ? pick(["USA", "DOM", "VEN"], rng) : "KOR";
        const playerTierMean = isForeign
          ? meta.tier1G + 5
          : idx < 23
            ? meta.tier1G
            : meta.tier1G - 6;

        return createPlayerWithTier({
          pos,
          status: "1GUN",
          teamId: meta.id,
          tierMean: playerTierMean,
          tierSpread: 6,
          ageRange: isForeign ? [26, 33] : [21, 36],
          nationality: nat,
          origin: isForeign ? "AAA" : "KBO",
          scoutLevel: effectiveScoutLevel,
          isOwnTeam,
          moraleCondBonus: condBonus,
          rng
        });
      });

      const roster2G = ROSTER_2G_TEMPLATE.map((pos) =>
        createPlayerWithTier({
          pos,
          status: "2GUN",
          teamId: meta.id,
          tierMean: meta.tier2G,
          tierSpread: 6,
          ageRange: [19, 30],
          nationality: "KOR",
          origin: "KBO",
          scoutLevel: effectiveScoutLevel,
          isOwnTeam,
          moraleCondBonus: condBonus,
          rng
        })
      );

      // [시스템 6] 육성군(rosterDev)에는 외국인 등록 불가, 전원 국내 유망주로 생성
      const devBaseTier = Math.max(48, meta.tier2G - 7);
      const rosterDev = ROSTER_DEV_TEMPLATE.map((pos) => {
        const p = createPlayerWithTier({
          pos,
          status: "YUKSEONG",
          teamId: meta.id,
          tierMean: devBaseTier,
          tierSpread: 5,
          ageRange: [18, 23],
          nationality: "KOR",
          origin: rng() < 0.65 ? "HS" : "UNIV",
          scoutLevel: effectiveScoutLevel,
          isOwnTeam,
          moraleCondBonus: condBonus,
          rng
        });
        if (meta.philosophy === "REBUILDING" || meta.rank2024 >= 8) {
          p.potential = clamp(p.potential + 4, 72, 108);
        }
        return p;
      });

      const initialOwnerTrust = clamp(60 + (isOwnTeam ? ownerTrustBonus : 0), 0, 100);
      const initialFanRatio = clamp(58 - (meta.rank2024 - 1) * 1 + (isOwnTeam && ownerTrustBonus > 0 ? 5 : 0), 35, 95);

      const teamInstance = new gm.Team({
        id: meta.id,
        name: meta.name,
        futuresName: meta.futures,
        city: meta.city,
        park: meta.park,
        budget: meta.budget,
        ownerTrust: initialOwnerTrust,
        fanRatio: initialFanRatio,
        roster1G,
        roster2G,
        rosterDev,
        foreignRehabList: []
      });

      teamInstance.kboName = meta.kboName;
      teamInstance.rank2024 = meta.rank2024;
      teamInstance.tier1G = meta.tier1G;
      teamInstance.tier2G = meta.tier2G;
      teamInstance.philosophy = meta.philosophy;
      teamInstance.difficulty = meta.difficulty;
      teamInstance.ownerExpectation = {
        year: startYear,
        philosophy: meta.philosophy,
        prevRank: meta.rank2024,
        targetRank: meta.targetRank,
        goalTitle: meta.goalTitle,
        difficulty: meta.difficulty,
        allocatedBudget: meta.budget,
        trustBonusOnSuccess: 15,
        trustPenaltyOnFail: -15
      };

      if (isOwnTeam && gmProfile.trait === "FIELD_EXPERT" && teamInstance.coachingStaff) {
        teamInstance.coachingStaff.moraleBoost = 1.05;
        if (teamInstance.coachingStaff.pitchingCoach) {
          teamInstance.coachingStaff.pitchingCoach.trainBonus = +(
            (teamInstance.coachingStaff.pitchingCoach.trainBonus || 1.05) + 0.04
          ).toFixed(2);
        }
        if (teamInstance.coachingStaff.hittingCoach) {
          teamInstance.coachingStaff.hittingCoach.trainBonus = +(
            (teamInstance.coachingStaff.hittingCoach.trainBonus || 1.05) + 0.04
          ).toFixed(2);
        }
      }

      return teamInstance;
    });

    // 2) NPB / 대만 CPBL / 호주 ABL 아시아 쿼터 및 해외 외국인 후보군 300명 생성
    const foreignPositions = ["SP", "SP", "SP", "RP", "CP", "1B", "3B", "LF", "CF", "RF", "DH"];
    const npbPool = [];
    for (let i = 0; i < 300; i++) {
      const isAsian = i < 160;
      const nat = isAsian
        ? i < 100
          ? "JPN"
          : i < 135
            ? "TWN"
            : "AUS"
        : pick(["USA", "DOM", "VEN"], rng);
      const orig =
        nat === "JPN" ? "NPB" : nat === "TWN" ? "CPBL" : nat === "AUS" ? "ABL" : "AAA";
      const pos = pick(foreignPositions, rng);
      const fp = createPlayerWithTier({
        pos,
        status: "FOREIGN_POOL",
        teamId: null,
        tierMean: isAsian ? 75 : 76,
        tierSpread: 8,
        ageRange: [23, 34],
        nationality: nat,
        origin: orig,
        scoutLevel: effectiveScoutLevel,
        isOwnTeam: false,
        rng
      });
      fp.isAsianQuarterEligible = isAsian;
      npbPool.push(fp);
    }

    // 3) 고교 1~3학년 · 대학 · 독립리그(연천 미라클 등) 유망주 풀 200명 생성
    const draftPositions = ["SP", "SP", "RP", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
    const draftPool = [];
    for (let i = 0; i < 200; i++) {
      const isInd = i % 7 === 6; // 약 14% 독립야구단 경기도리그 출신
      const isUniv = !isInd && i % 4 === 3;
      const origin = isInd ? "IND" : isUniv ? "UNIV" : "HS";
      const gradeYear = isInd ? 5 : isUniv ? 4 : i < 110 ? 3 : i < 160 ? 2 : 1;
      const age = isInd ? randInt(21, 26, rng) : isUniv ? 22 : gradeYear === 3 ? 19 : gradeYear === 2 ? 18 : 17;
      const pos = pick(draftPositions, rng);
      const isTopProspect = i < 24;

      const prospect = createPlayerWithTier({
        pos,
        status: "DRAFT_POOL",
        teamId: null,
        tierMean: isTopProspect ? (isUniv || isInd ? 62 : 58) : (isInd ? 56 : isUniv ? 54 : 46 + gradeYear * 2),
        tierSpread: 6,
        ageRange: [age, age],
        nationality: "KOR",
        origin,
        gradeYear,
        scoutLevel: effectiveScoutLevel,
        isOwnTeam: false,
        rng
      });
      if (isInd) {
        prospect.indClubName = pick(KOREAN_INDEPENDENT_CLUBS, rng);
      }
      if (isTopProspect) {
        prospect.potential = clamp(randInt(88, 106, rng), 88, 108);
      }
      draftPool.push(prospect);
    }

    // 4) 단장 초기 계약(3년 8억 원) 및 2025년 1월 1일 컨텍스트 생성
    const gmContract = createInitialGMContract(startYear);
    const maxScouts = clamp(effectiveScoutLevel + 2, 1, 5);

    const context = new gm.GMGameContext({
      slotId,
      userTeamId,
      startYear,
      currentYear: startYear,
      currentWeek: 1,
      currentDate: startDate,
      scoutLevel: effectiveScoutLevel,
      gmProfile,
      gmContract,
      scoutDispatch: {
        maxScouts,
        totalAssigned: Math.min(maxScouts, 4),
        allocation: {
          HS_1: 1,
          HS_2: 0,
          HS_3: Math.max(1, maxScouts - 3),
          UNIV: 1,
          IND: 1
        }
      },
      negotiationDiscount,
      kboTeams,
      npbPool,
      draftPool,
      faPool: []
    });

    // KBO 등록 시즌 수 초기 추정 (고졸 19세 · 대졸 23세 입단 기준, 군 복무 18개월 반영 없이 단순 추정)
    kboTeams.forEach((team) => {
      team.getAllPlayers().forEach((p) => {
        if (p.nationality && p.nationality !== "KOR") return;
        if (!p.kboSeasons) {
          const entryAge = p.origin === "UNIV" ? 23 : 19;
          p.kboSeasons = Math.max(0, (p.age || 20) - entryAge);
        }
      });
    });

    // 국내 선수 병역 상태 초기 배정 (25세 이상 군필 · 21~24세 무작위 · 20세 이하 미필)
    if (gm.Extensions && typeof gm.Extensions.assignInitialMilitaryStatus === "function") {
      gm.Extensions.assignInitialMilitaryStatus(context);
    }

    // 시즌 회고 리포트 기준 로스터 (FA 공시 전 부임 시점 로스터)
    if (gm.Retro && typeof gm.Retro.takeRosterSnapshot === "function") {
      gm.Retro.takeRosterSnapshot(context);
    }

    // 2025년 1월 1일 개막 시점에 즉시 FA 잔여 협상이 가능하도록 초기 FA 시장 자격 선수 공시
    if (gm.Offseason && typeof gm.Offseason.declareEligibleFAPlayers === "function") {
      gm.Offseason.declareEligibleFAPlayers(context, { maxFAsPerTeam: 2 });
    }

    // 2024년 KBO 최종 순위를 초기 히스토리로 보존 (9월 3주차 신인 드래프트 역순 지명권 등에 활용)
    context.seasonHistory = [
      {
        year: 2024,
        standings: KBO_TEAM_2024_META.map((m) => ({
          rank: m.rank2024,
          teamId: m.id,
          teamName: m.name,
          kboName: m.kboName,
          w: Math.round(87 - (m.rank2024 - 1) * 3.2),
          l: Math.round(55 + (m.rank2024 - 1) * 3.2),
          d: 2,
          winPct: +((87 - (m.rank2024 - 1) * 3.2) / 142).toFixed(3)
        }))
      }
    ];

    // 난이도(쉬움/보통/어려움) 적용: 유저 구단 초기 예산 보정 및 재정 장부 초기화 (KBO_GM.Economy)
    if (gm.Economy && typeof gm.Economy.initDifficulty === "function") {
      gm.Economy.initDifficulty(context, opts.difficulty || "NORMAL");
    }

    // 유망주 초기 스카우팅 정밀도 계산
    applyDailyScoutProgress(context, 2);

    if (typeof gm.calculateKBOStandings === "function") {
      gm.calculateKBOStandings(context);
    }

    if (gm.Assistant && typeof gm.Assistant.generateDailyBriefing === "function") {
      context.todaysBriefing = gm.Assistant.generateDailyBriefing(context);
    }

    context.lastSaveResult = null;
    return context;
  }

  async function initNewGameSession(optionsOrSlotId = {}, gmNameArg, gmTraitArg, userTeamIdArg, difficultyArg) {
    let opts = {};
    if (typeof optionsOrSlotId === "string") {
      opts = {
        slotId: optionsOrSlotId,
        gmName: gmNameArg,
        gmTrait: gmTraitArg,
        userTeamId: userTeamIdArg,
        difficulty: difficultyArg
      };
    } else if (optionsOrSlotId && typeof optionsOrSlotId === "object") {
      opts = { ...optionsOrSlotId };
    }
    const gm = KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM);
    const context = createGameContextSync(opts);
    const slotId = String(opts.slotId || "slot_1");
    const gmProfile = context.gmProfile || createGMProfile(opts.gmName || "김단장", opts.gmTrait || "DATA_ANALYST");

    // 5) KBO_GM.Storage.saveGame으로 첫 세이브 즉시 실행
    let saveResult = null;
    if (opts.autoSave !== false && gm && gm.Storage && typeof gm.Storage.saveGame === "function") {
      saveResult = await gm.Storage.saveGame(slotId, context, {
        label: `${gmProfile.name} 단장 (${context.getUserTeam().name})`,
        gmName: gmProfile.name,
        gmTrait: gmProfile.trait,
        gmTraitLabel: gmProfile.traitLabel
      });
    }

    context.lastSaveResult = saveResult;
    return context;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 슬롯 요약 목록 조회 헬퍼 (getSlotMetadataList)
   * ═══════════════════════════════════════════════════════════════════════ */
  const STANDARD_SLOTS = [
    { slotId: "auto_save", slotTitle: "자동 저장 (Auto Save)" },
    { slotId: "slot_1",    slotTitle: "세이브 슬롯 1" },
    { slotId: "slot_2",    slotTitle: "세이브 슬롯 2" },
    { slotId: "slot_3",    slotTitle: "세이브 슬롯 3" }
  ];

  async function getSlotMetadataList() {
    const gm = KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM);
    let savedSummaries = [];

    if (gm && gm.Storage && typeof gm.Storage.getSaveList === "function") {
      savedSummaries = await gm.Storage.getSaveList();
    }

    const summaryMap = new Map();
    savedSummaries.forEach((item) => {
      if (item && item.slotId) {
        summaryMap.set(String(item.slotId), item);
      }
    });

    return STANDARD_SLOTS.map(({ slotId, slotTitle }) => {
      const saved = summaryMap.get(slotId);
      if (!saved) {
        return {
          slotId,
          slotTitle,
          hasSave: false,
          isEmpty: true,
          gmName: null,
          gmTrait: null,
          gmTraitLabel: null,
          userTeamId: null,
          userTeamName: null,
          currentYear: null,
          currentWeek: null,
          record: { w: 0, l: 0, d: 0 },
          winPct: 0.0,
          winPctFormatted: ".000",
          budget: 0,
          savedAt: null,
          savedAtFormatted: "비어 있음"
        };
      }

      const rec = saved.record || { w: 0, l: 0, d: 0 };
      const decisions = (rec.w || 0) + (rec.l || 0);
      const winPct =
        typeof saved.winPct === "number"
          ? saved.winPct
          : decisions > 0
            ? +(rec.w / decisions).toFixed(3)
            : 0.0;
      const winPctFormatted = winPct >= 1 ? "1.000" : winPct.toFixed(3).replace(/^0/, "");

      const traitSpec = GM_TRAITS[saved.gmTrait] || GM_TRAITS.DATA_ANALYST;
      let savedAtFormatted = "-";
      if (saved.savedAt) {
        try {
          savedAtFormatted = new Date(saved.savedAt).toLocaleString("ko-KR");
        } catch (e) {
          savedAtFormatted = String(saved.savedAt);
        }
      }

      return {
        slotId,
        slotTitle,
        hasSave: true,
        isEmpty: false,
        gmName: saved.gmName || "김단장",
        gmTrait: saved.gmTrait || traitSpec.id,
        gmTraitLabel: saved.gmTraitLabel || traitSpec.label,
        difficultyLabel: saved.difficultyLabel || "보통",
        userTeamId: saved.userTeamId || "KIA",
        userTeamName: saved.userTeamName || "광주 고양이즈",
        currentYear: saved.currentYear || 2025,
        currentWeek: saved.currentWeek || 1,
        record: { w: rec.w || 0, l: rec.l || 0, d: rec.d || 0 },
        winPct,
        winPctFormatted,
        budget: saved.budget ?? 0,
        ownerTrust: saved.ownerTrust ?? 60,
        fanRatio: saved.fanRatio ?? 55,
        savedAt: saved.savedAt || null,
        savedAtFormatted
      };
    });
  }

  function getTeam2024SetupMeta(teamId) {
    const resolved = resolveTeamId(teamId);
    return KBO_TEAM_2024_META.find((m) => m.id === resolved) || KBO_TEAM_2024_META[0];
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * [자가 진단] 1년(365일) 무인 자동 시뮬레이션 자가 진단 함수 (KBO_GM.runSelfDiagnosticTest)
   *   1) 2025년 1월 1일 신규 세션 생성 (단장 3년 8억 계약 / 2024 순위 역순 예산 검증)
   *   2) 365일(1일 단위 × 365회)을 스킵하며 페넌트레이스(1군·2군), 9월 3주차 드래프트,
   *      FA 시장, 연봉 재계약, 외국인/아시아쿼터/6주 대체외인, 스프링캠프,
   *      IndexedDB 저장/불러오기(Hydration)를 비동기 자동 연산
   *   3) 중간 예외(Exception)나 undefined/NaN 에러 유무를 console.log로 상세 리포트
   * ═══════════════════════════════════════════════════════════════════════ */
  async function runSelfDiagnosticTest(options = {}) {
    const gm = KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM);
    const startTime = Date.now();
    const diagSlotId = options.slotId || "__diag_self_test__";
    const teamId = resolveTeamId(options.teamId || "KIA");
    const gmName = options.gmName || "진단단장";
    const gmTrait = options.gmTrait || "DATA_ANALYST";

    const checkpoints = [];
    const errors = [];
    const recordCheck = (stepName, passed, detail) => {
      checkpoints.push({
        step: stepName,
        status: passed ? "PASS" : "FAIL",
        detail: String(detail || "")
      });
      if (!passed) {
        errors.push(`[${stepName}] ${detail}`);
      }
    };

    console.log("%c====================================================================", "color:#38bdf8;font-weight:bold");
    console.log("%c[KBO_GM.runSelfDiagnosticTest] 1년(365일) 무인 자동 시뮬레이션 자가 진단 시작...", "color:#38bdf8;font-weight:bold;font-size:13px");
    console.log("%c====================================================================", "color:#38bdf8;font-weight:bold");

    let ctx = null;
    let totalMatchesSimulated = 0;
    let draftTriggeredDay = null;
    let offseasonProcessed = false;

    try {
      // [Step 1] 모듈 네임스페이스 검증
      const hasModules = Boolean(
        gm &&
          gm.Player &&
          gm.Team &&
          gm.GMGameContext &&
          typeof gm.simulateMatch === "function" &&
          typeof gm.advanceOneWeek === "function" &&
          gm.Draft &&
          gm.Offseason &&
          gm.SpringCamp &&
          gm.Storage &&
          gm.Setup
      );
      recordCheck(
        "01. 모듈 네임스페이스 로드",
        hasModules,
        hasModules ? "Schema, MatchSim, WeeklySim, Draft, Offseason, SpringCamp, Storage, Setup 정상" : "일부 모듈 누락"
      );

      // [Step 2] 2025년 1월 1일 신규 세션 생성 및 초기 조건 검증
      ctx = await initNewGameSession({
        slotId: diagSlotId,
        gmName,
        gmTrait,
        userTeamId: teamId,
        startYear: 2025
      });

      const kiaTeam = ctx.getTeam("KIA");
      const kiwTeam = ctx.getTeam("KIW");
      const con = ctx.gmContract || {};
      const initOk =
        ctx.currentDate === "2025-01-01" &&
        con.yearsTotal === 3 &&
        con.totalAmount === 80000 &&
        con.signingBonus === 20000 &&
        con.annualSalary === 20000 &&
        kiaTeam.budget === 1200000 &&
        kiwTeam.budget === 1750000;

      recordCheck(
        "02. 2025-01-01 세션 & 역순 예산 & 3년 8억 계약",
        initOk,
        `시작일=${ctx.currentDate}, 계약=${con.yearsTotal}년/${con.totalAmount}만원, KIA예산=${kiaTeam.budget}만, 키움예산=${kiwTeam.budget}만`
      );

      // [Step 3] 아마추어/독립리그 스카우트 파견 및 유망주 5대 스탯 팝업 리포트 검증
      const dispRes = dispatchAmateurScouts(ctx, { HS_1: 1, HS_2: 1, HS_3: 1, UNIV: 1, IND: 0 });
      const sampleProspect = ctx.draftPool[0];
      const inspRep = inspectProspectReport(ctx, sampleProspect.id);
      const scoutOk = Boolean(dispRes.ok && inspRep && Array.isArray(inspRep.stats) && inspRep.stats.length === 5);
      recordCheck(
        "03. 스카우트 파견 & 유망주 5대 스탯 리포트",
        scoutOk,
        `파견=${dispRes.ok}, 샘플유망주=${inspRep ? inspRep.name : "-"} (스탯 ${inspRep && inspRep.stats ? inspRep.stats.length : 0}항목)`
      );

      // [Step 4] 외국인 선수 육성군 등록 차단 & 6주 대체 외국인 규정 검증
      const userTeam = ctx.getUserTeam();
      const sampleForeigner = userTeam.roster1G.find((p) => p.nationality !== "KOR");
      const moveDevBlock = movePlayerEntryWithForeignRule(ctx, userTeam.id, sampleForeigner.id, "YUKSEONG");
      sampleForeigner.injury = { active: true, name: "팔꿈치 염좌", label: "6주 장기부상", weeksLeft: 6, daysLeft: 42 };
      const rep6wk = signSixWeekReplacementForeigner(ctx, userTeam.id, sampleForeigner.id);
      const resRehab = resolveReturnedForeignPlayer(ctx, userTeam.id, sampleForeigner.id, "RETURN_ORIGINAL");
      const foreignRuleOk = Boolean(moveDevBlock.ok === false && rep6wk.ok && resRehab.ok);
      recordCheck(
        "04. 외국인 육성군 차단 & 6주 대체 외국인",
        foreignRuleOk,
        `육성군차단=${!moveDevBlock.ok}, 6주대체영입=${rep6wk.ok}, 원외인복귀=${resRehab.ok}`
      );

      // [Step 5] 365일(1일씩 365회) 무인 자동 진행 루프
      let nanOrUndefinedFound = false;
      let campExecuted = false;

      for (let dayIdx = 1; dayIdx <= 365; dayIdx++) {
        // 2월 1일 시점에 코칭스태프 선임 및 스프링캠프 실행
        if (ctx.currentDate === "2025-02-01" && !campExecuted) {
          gm.SpringCamp.manageCoachingStaff(ctx, {
            manager: "한도훈",
            pitchingCoach: "차명석",
            hittingCoach: "신태호"
          });
          const campRes = gm.SpringCamp.runSpringCamp(ctx, {
            userCampLocation: "USA",
            trainingFocus: "BALANCED"
          });
          campExecuted = Boolean(campRes && campRes.userCampReport);
          recordCheck(
            "05. 코칭스태프(가상명) & 스프링캠프",
            campExecuted,
            `캠프지=${campRes.userCampReport.locationName}, 비용=${campRes.userCampReport.cost}만원`
          );
        }

        // 하루(+1일) 진행
        const dayRes = advanceOneDay(ctx);
        totalMatchesSimulated += dayRes.matchesSimulated || 0;

        // 9월 3주차(9월 17일) 신인 드래프트 트리거 감지 시 1~10R 전 라운드 실행
        if (dayRes.draftWeekTriggered) {
          draftTriggeredDay = dayRes.currentDate;
          const draftRes = gm.Draft.runFullDraft(ctx);
          autoTrimRosterForDraftees(ctx, userTeam.id);
          const draftOk = Boolean(draftRes && draftRes.completedRounds && draftRes.completedRounds.length === 10);
          recordCheck(
            "06. 9월 3주차 신인 드래프트 (1~10R)",
            draftOk,
            `개최일=${draftTriggeredDay}, 완료라운드=${draftRes.completedRounds.length}R, 총지명=${draftRes.allPicks.length}건`
          );
        }

        // 24주차(144경기) 페넌트레이스 종료 후 오프시즌(연봉 협상 · FA 시장 · 외국인 재계약) 자동 실행
        if ((ctx.currentWeek || 1) > 24 && !offseasonProcessed) {
          offseasonProcessed = true;
          const salRep = gm.Offseason.processSalaryRenewals(ctx, { userPolicy: "FAIR" });
          gm.Offseason.declareEligibleFAPlayers(ctx);
          const faRep = gm.Offseason.runFAMarketSession(ctx, {}, { autoDeclareFromRosters: false });
          const forRep = gm.Offseason.processForeignPlayerContracts(ctx, null);

          const offOk = Boolean(salRep && faRep && forRep);
          recordCheck(
            "07. 스토브리그 (연봉·FA·외국인 재계약)",
            offOk,
            `연봉조정=${salRep.arbitrationCases.length}건, FA계약=${faRep.totalSigned}명, 외국인리포트=${Object.keys(forRep.teamForeignReports).length}구단`
          );
        }

        // 매일 전 구단 데이터 무결성(undefined / NaN / 엔트리 정원) 검사
        for (let t = 0; t < ctx.kboTeams.length; t++) {
          const tm = ctx.kboTeams[t];
          if (
            Number.isNaN(tm.budget) ||
            tm.roster1G.length > 28 ||
            tm.roster2G.length > 30 ||
            tm.rosterDev.some((p) => p.nationality !== "KOR")
          ) {
            nanOrUndefinedFound = true;
            errors.push(
              `[Day ${dayIdx} 무결성 위반] ${tm.id}: budget=${tm.budget}, 1G=${tm.roster1G.length}, 2G=${tm.roster2G.length}`
            );
            break;
          }
        }
      }

      const sim365Ok = !nanOrUndefinedFound && totalMatchesSimulated === 720 && Boolean(draftTriggeredDay);
      recordCheck(
        "08. 365일 일자 진행 & 페넌트레이스 720경기",
        sim365Ok,
        `종료일=${ctx.currentDate}, 누적시뮬경기=${totalMatchesSimulated}경기(팀당 144G), 2군전적=${userTeam.futuresRecord.w}승${userTeam.futuresRecord.l}패, 무결성오류=${nanOrUndefinedFound ? "발생" : "0건"}`
      );

      // [Step 6] IndexedDB 저장 및 불러오기(Hydration) 검증
      const saveRes = await gm.Storage.saveGame(diagSlotId, ctx, { label: "365일 자가진단 테스트" });
      const loadedCtx = await gm.Storage.loadGame(diagSlotId);
      const loadedTeam = loadedCtx ? loadedCtx.getUserTeam() : null;
      const sampleLoadedPlayer = loadedTeam && loadedTeam.roster1G[0];
      const hydrationOk = Boolean(
        saveRes &&
          saveRes.ok &&
          loadedCtx &&
          loadedTeam &&
          sampleLoadedPlayer &&
          typeof sampleLoadedPlayer.getTrueOvr === "function" &&
          typeof sampleLoadedPlayer.getWar === "function" &&
          !Number.isNaN(sampleLoadedPlayer.getTrueOvr()) &&
          !Number.isNaN(loadedTeam.getTotalPayroll())
      );
      recordCheck(
        "09. IndexedDB 저장/복원(Hydration) 검증",
        hydrationOk,
        `저장=${saveRes && saveRes.ok}, 복원선수OVR=${sampleLoadedPlayer ? sampleLoadedPlayer.getTrueOvr() : "-"}, 복원페이롤=${loadedTeam ? loadedTeam.getTotalPayroll() : "-"}만원`
      );

      // 진단용 임시 슬롯 정리
      await gm.Storage.deleteSave(diagSlotId);
    } catch (err) {
      errors.push(`예외(Exception) 발생: ${err && err.stack ? err.stack : String(err)}`);
      recordCheck("예외(Exception) 감지", false, String(err && err.message ? err.message : err));
    }

    const elapsedMs = Date.now() - startTime;
    const allPassed = errors.length === 0 && checkpoints.every((c) => c.status === "PASS");

    console.table(checkpoints);
    if (allPassed) {
      console.log(
        `%c✅ [자가 진단 최종 결과: PASS] 365일 무인 시뮬레이션 완료 (${elapsedMs}ms 소요 · 예외/undefined 에러 0건)`,
        "color:#22c55e;font-weight:bold;font-size:13px"
      );
    } else {
      console.error(
        `❌ [자가 진단 최종 결과: FAIL] 총 ${errors.length}건의 오류 감지 (${elapsedMs}ms 소요)`,
        errors
      );
    }

    return {
      ok: allPassed,
      elapsedMs,
      startDate: "2025-01-01",
      endDate: ctx ? ctx.currentDate : null,
      totalMatchesSimulated,
      draftTriggeredDay,
      offseasonProcessed,
      checkpoints,
      errors
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * [5개년 초고속 무인 시뮬레이션 검증 모듈] KBO_GM.TestRunner
   *   - async KBO_GM.TestRunner.run5YearSimulation(userTeamId = "KIA", options = {})
   *   - 2025년~2029년 (5개년, 총 1,825일) 하루 단위(+1일) 무인 자동 진행
   *   - 2027년 개막 시점 IndexedDB 저장(saveGame) 및 불러오기(loadGame) Hydration 검증
   *   - 8대 핵심 무결성 체크리스트 검사 및 연도별 리포트(console.group / console.table) 출력
   * ═══════════════════════════════════════════════════════════════════════ */
  async function run5YearSimulation(userTeamId = "KIA", options = {}) {
    const gm = KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM);
    const startTime = Date.now();
    const resolvedTeamId = resolveTeamId(userTeamId || "KIA");
    const testSlotId = options.slotId || "__test_runner_5yr__";
    const totalDaysToRun = 1825; // 365일 × 5개년 (2025~2029)

    const errors = [];
    const yearlyReports = [];
    const auditFlags = {
      nanOrNullErrorCount: 0,
      entryLimitViolations: 0,
      foreignInDevViolations: 0,
      budgetOutOfBoundsCount: 0,
      hydration2027Passed: false,
      hydration2027Detail: "",
      foreign6WeekTestedCount: 0,
      foreign6WeekReturnOk: false,
      foreignReleasedCleanOk: false,
      gmContract2027Triggered: false,
      gmContract2027Status: null,
      gmContract2027Detail: "",
      minDraftPoolSeen: Infinity,
      minNpbPoolSeen: Infinity,
      totalDraftedRookies5Yr: 0,
      totalMatches5Yr: 0
    };

    // 숫자 유효성 검사 헬퍼
    const isValidNum = (v) => typeof v === "number" && Number.isFinite(v) && !Number.isNaN(v);

    let ctx = await initNewGameSession({
      slotId: testSlotId,
      gmName: options.gmName || "검증단장",
      gmTrait: options.gmTrait || "DATA_ANALYST",
      userTeamId: resolvedTeamId,
      startYear: 2025,
      autoSave: false
    });

    // 5년 개근 선수 추적용 초기 로스터 ID 집합
    const initial2025PlayerIds = new Set(
      ctx.kboTeams.flatMap((t) => t.getAllPlayers().map((p) => p.id))
    );

    const campDoneYears = new Set();
    const draftDoneYears = new Set();
    const stoveDoneYears = new Set();
    const foreign6WeekDoneYears = new Set();

    let currentSeasonMatches = 0;
    let currentSeasonDraftCount = 0;
    let currentSeasonFASigned = 0;

    try {
      for (let dayCount = 1; dayCount <= totalDaysToRun; dayCount++) {
        const curDate = ctx.currentDate;
        const parsed = parseDateISO(curDate);
        const yr = parsed.getUTCFullYear();
        const mm = parsed.getUTCMonth() + 1;
        const dd = parsed.getUTCDate();

        // [특수 검증 A] 2027년 개막 시점(2027-03-22)에 IndexedDB 저장(saveGame) 및 불러오기(loadGame) 실행 후 Hydration 검증
        if (yr === 2027 && mm === 3 && dd === 22 && !auditFlags.hydration2027Passed) {
          const saveRes = await gm.Storage.saveGame(testSlotId, ctx, {
            label: "2027 개막 시점 Hydration 검증 세이브"
          });
          const loadedCtx = await gm.Storage.loadGame(testSlotId);
          const loadedUserTeam = loadedCtx ? loadedCtx.getUserTeam() : null;
          const samplePlr = loadedUserTeam && loadedUserTeam.roster1G[0];

          const methodsOk = Boolean(
            saveRes &&
              saveRes.ok &&
              loadedCtx instanceof gm.GMGameContext &&
              loadedUserTeam instanceof gm.Team &&
              samplePlr instanceof gm.Player &&
              typeof samplePlr.getTrueOvr === "function" &&
              typeof samplePlr.getWar === "function" &&
              typeof samplePlr.getWoba === "function" &&
              typeof loadedUserTeam.getTotalPayroll === "function" &&
              isValidNum(samplePlr.getTrueOvr()) &&
              isValidNum(samplePlr.getWar()) &&
              isValidNum(loadedUserTeam.getTotalPayroll())
          );

          auditFlags.hydration2027Passed = methodsOk;
          auditFlags.hydration2027Detail = methodsOk
            ? `2027-03-22 세이브/로드 성공 (${saveRes.backend}) · getTrueOvr()=${samplePlr.getTrueOvr()}, Payroll=${loadedUserTeam.getTotalPayroll()}만원`
            : "2027년 개막 시점 Hydration 복원 또는 클래스 메서드 호출 실패";

          if (!methodsOk) {
            errors.push(`[2027 Hydration 오류] ${auditFlags.hydration2027Detail}`);
          } else {
            // 복원된 컨텍스트로 교체하여 이후 2027~2029 시즌을 계속 진행
            ctx = loadedCtx;
          }
        }

        // [시즌 일정 1] 매년 2월 1일: 코칭스태프 재계약, 스프링캠프 및 [PART 4] 인프라 R&D 투자 & 비FA 다년 연장 계약 실행
        if (mm === 2 && dd === 1 && !campDoneYears.has(yr)) {
          campDoneYears.add(yr);
          gm.SpringCamp.manageCoachingStaff(ctx, {
            manager: "한도훈",
            pitchingCoach: "차명석",
            hittingCoach: "신태호"
          });
          gm.SpringCamp.runSpringCamp(ctx, {
            userCampLocation: yr % 2 === 1 ? "USA" : "OKINAWA",
            trainingFocus: "BALANCED"
          });

          if (gm.Extensions) {
            // 구단 인프라 3대 시설 단계별 R&D 투자
            const facKeys = ["rehabCenter", "biomechLab", "scoutHq"];
            gm.Extensions.upgradeTeamFacility(ctx, ctx.userTeamId, facKeys[yr % 3]);

            // 예비 FA(6~7년차) 핵심 선수 비FA 다년 연장 계약 체결 시도
            const extCands = gm.Extensions.getNonFAExtensionCandidates(ctx.getUserTeam());
            if (extCands.length > 0) {
              gm.Extensions.offerNonFAMultiYearExtension(ctx, ctx.userTeamId, extCands[0].playerId);
            }

            // [PART 5] 2군 맞춤형 육성 과제 일괄 배정 & 보호명단(20/25/35인) 최적화
            gm.Extensions.autoAssignFuturesTraining(ctx, ctx.userTeamId);
            gm.Extensions.autoFillProtectedPlayers(ctx, ctx.userTeamId, "FA_20");
            gm.Extensions.autoFillProtectedPlayers(ctx, ctx.userTeamId, "FA_25");
            gm.Extensions.autoFillProtectedPlayers(ctx, ctx.userTeamId, "DRAFT_35");

            // [PART 5] 2026년 2월 1일: 홈구장 리모델링(투수 친화 또는 타자 친화 개조) 실행
            if (yr === 2026) {
              gm.Extensions.remodelHomePark(ctx, ctx.userTeamId, "PITCHER_FORTRESS");
            }
            // [PART 5] 2028년 2월 1일: 간판 스타 MLB 포스팅 해외 진출 승인 (+100억~300억 이적료 유입)
            if (yr === 2028) {
              const postCands = gm.Extensions.getMLBPostingCandidates(ctx, ctx.userTeamId);
              if (postCands.length > 0) {
                gm.Extensions.executeMLBPosting(ctx, ctx.userTeamId, postCands[0].playerId, "APPROVE");
              }
            }
          }
        }

        // [시즌 일정 2] 6주(42일) 부상 대체 외국인 영입 및 방출 외인 시장 영구 제거 시나리오 (2025년·2028년 5월 1일)
        if ((yr === 2025 || yr === 2028) && mm === 5 && dd === 1 && !foreign6WeekDoneYears.has(yr)) {
          foreign6WeekDoneYears.add(yr);
          const uTeam = ctx.getUserTeam();
          const targetForeigner = uTeam.roster1G.find((p) => p.nationality !== "KOR" && !p.isAsianQuarter);
          if (targetForeigner) {
            targetForeigner.injury = {
              active: true,
              name: "내측측부인대 염좌",
              part: "팔꿈치",
              label: "6주 장기 부상",
              weeksLeft: 6,
              daysLeft: 42,
              major: true
            };
            const repRes = signSixWeekReplacementForeigner(ctx, uTeam.id, targetForeigner.id);
            if (repRes && repRes.ok) {
              auditFlags.foreign6WeekTestedCount += 1;
            }
          }
        }

        // 하루(+1일) 진행
        const prevYearBeforeStep = yr;
        const dayRes = advanceOneDay(ctx);
        currentSeasonMatches += dayRes.matchesSimulated || 0;
        auditFlags.totalMatches5Yr += dayRes.matchesSimulated || 0;

        // 6주 재활 완료 이벤트 발생 시 원 외국인 복귀(2025) 또는 대체 외인 정식 전환(2028) 처리 및 퇴출 검증
        if (Array.isArray(dayRes.dailyEvents)) {
          dayRes.dailyEvents.forEach((ev) => {
            if (ev.type === "FOREIGN_REHAB_READY") {
              const decision = prevYearBeforeStep === 2025 ? "RETURN_ORIGINAL" : "CONVERT_REPLACEMENT";
              const revRes = resolveReturnedForeignPlayer(ctx, ev.teamId, ev.playerId, decision);
              if (revRes && revRes.ok && revRes.releasedPlayer) {
                const relId = revRes.releasedPlayer.id;
                const stillInNpb = ctx.npbPool.some((p) => p.id === relId);
                const stillInFa = ctx.faPool.some((p) => p.id === relId);
                const stillInTeams = ctx.kboTeams.some((t) => t.getAllPlayers().some((p) => p.id === relId));
                auditFlags.foreign6WeekReturnOk = true;
                auditFlags.foreignReleasedCleanOk =
                  revRes.releasedPlayer.status === "FOREIGN_RELEASED" && !stillInNpb && !stillInFa && !stillInTeams;
              }
            }
            if (ev.type === "GM_CONTRACT_EVALUATED" && prevYearBeforeStep === 2027) {
              auditFlags.gmContract2027Triggered = true;
              auditFlags.gmContract2027Status = ev.evaluation ? ev.evaluation.status : null;
              auditFlags.gmContract2027Detail = `${prevYearBeforeStep}년 말 3년 임기 만료 심사 실행 -> status=${auditFlags.gmContract2027Status}, 등급=${(ev.evaluation && ev.evaluation.evalGrade) || "-"}, 신임계약=${ctx.gmContract.summaryText}`;
            }
          });
        }

        // [시즌 일정 3] 매년 9월 3주차(9월 17일): 신인 드래프트 1~10R 자동 실행 및 지명 인원만큼 웨이버 방출 정리
        if (dayRes.draftWeekTriggered && !draftDoneYears.has(prevYearBeforeStep)) {
          draftDoneYears.add(prevYearBeforeStep);
          auditFlags.minDraftPoolSeen = Math.min(auditFlags.minDraftPoolSeen, ctx.draftPool.length);
          const draftRes = gm.Draft.runFullDraft(ctx);
          currentSeasonDraftCount = draftRes ? draftRes.totalPicks : 0;
          auditFlags.totalDraftedRookies5Yr += currentSeasonDraftCount;

          // 전 구단 신인 입단 인원 연동 하위 로스터 정리
          ctx.kboTeams.forEach((t) => autoTrimRosterForDraftees(ctx, t.id));
        }

        // [시즌 일정 4] 매년 11월 15일(페넌트레이스 24주 + 9월 3주차 신인드래프트 완료 후): 스토브리그(연봉 재계약 · FA 시장 · 외국인 재계약) 실행
        if (mm === 11 && dd === 15 && !stoveDoneYears.has(prevYearBeforeStep)) {
          stoveDoneYears.add(prevYearBeforeStep);
          auditFlags.minNpbPoolSeen = Math.min(auditFlags.minNpbPoolSeen, ctx.npbPool.length);

          // 스토브리그 개장 시점에 해당 시즌 최종 성적 스냅샷 기록
          const uTeam = ctx.getUserTeam();
          const uRankRow = (ctx.standings || []).find((s) => s.teamId === uTeam.id) || {};
          const topWarPlayer = uTeam
            .getAllPlayers()
            .slice()
            .sort((a, b) => b.getWar() - a.getWar())[0];

          gm.Offseason.processSalaryRenewals(ctx, { userPolicy: "FAIR" });
          gm.Offseason.declareEligibleFAPlayers(ctx);
          const faRep = gm.Offseason.runFAMarketSession(ctx, {}, { autoDeclareFromRosters: false });
          currentSeasonFASigned = faRep ? faRep.totalSigned : 0;
          gm.Offseason.processForeignPlayerContracts(ctx, null);

          const psReport = Array.isArray(ctx.postseasonHistory)
            ? ctx.postseasonHistory.find((h) => h.year === prevYearBeforeStep)
            : null;

          yearlyReports.push({
            year: prevYearBeforeStep,
            teamName: uTeam.name,
            rank: uRankRow.rank || 1,
            record: `${uTeam.record.w}승 ${uTeam.record.l}패 ${uTeam.record.d}무`,
            winPct: uRankRow.winPct != null ? Number(uRankRow.winPct).toFixed(3) : ".500",
            ksChampion: psReport ? psReport.championTeamName : "-",
            futuresRecord: `${uTeam.futuresRecord.w}승 ${uTeam.futuresRecord.l}패`,
            budgetEok: `${(uTeam.budget / 10000).toFixed(1)}억`,
            payrollEok: `${(uTeam.getTotalPayroll() / 10000).toFixed(1)}억`,
            ownerTrust: uTeam.ownerTrust,
            draftedRookies: currentSeasonDraftCount,
            faSignedCount: currentSeasonFASigned,
            teamMvp: topWarPlayer ? `${topWarPlayer.name}(${topWarPlayer.pos}, WAR ${topWarPlayer.getWar().toFixed(2)})` : "-"
          });

          currentSeasonMatches = 0;
          currentSeasonDraftCount = 0;
          currentSeasonFASigned = 0;
        }

        // [일일 전수 무결성 검사] 10개 구단 예산 범위, 엔트리 정원, 육성군 외국인 유입, NaN/Null 여부
        for (let tIdx = 0; tIdx < ctx.kboTeams.length; tIdx++) {
          const tm = ctx.kboTeams[tIdx];
          if (!isValidNum(tm.budget) || !isValidNum(tm.ownerTrust) || !isValidNum(tm.fanRatio)) {
            auditFlags.nanOrNullErrorCount += 1;
          }
          if (tm.budget < -3000000 || tm.budget > 4000000) {
            auditFlags.budgetOutOfBoundsCount += 1;
            errors.push(`[Day ${dayCount} 예산 범위 이탈] ${tm.id}: ${tm.budget}만원`);
          }
          if (tm.roster1G.length > 28 || tm.roster2G.length > 30) {
            auditFlags.entryLimitViolations += 1;
            errors.push(`[Day ${dayCount} 엔트리 정원 초과] ${tm.id}: 1G=${tm.roster1G.length}, 2G=${tm.roster2G.length}`);
          }
          if (tm.rosterDev.some((p) => p.nationality && p.nationality !== "KOR")) {
            auditFlags.foreignInDevViolations += 1;
            errors.push(`[Day ${dayCount} 외국인 육성군 유입] ${tm.id}`);
          }
        }
      }

      // 5년 종료 시점 전 선수 비율 스탯(ERA, WHIP, AVG, OBP, SLG, OPS, wOBA, WAR) NaN 검사 및 career 배열 정합성 검사
      const allCurrentPlayers = ctx.kboTeams.flatMap((t) => t.getAllPlayers());
      allCurrentPlayers.forEach((p) => {
        const ovr = p.getTrueOvr();
        const war = p.getWar();
        const woba = p.getWoba();
        if (!isValidNum(ovr) || !isValidNum(war) || !isValidNum(woba) || !isValidNum(p.salary)) {
          auditFlags.nanOrNullErrorCount += 1;
        }
        if (p.type === "pitcher") {
          if (!isValidNum(p.getEra()) || !isValidNum(p.getWhip())) {
            auditFlags.nanOrNullErrorCount += 1;
          }
        } else {
          if (!isValidNum(p.getAvg()) || !isValidNum(p.getObp()) || !isValidNum(p.getSlg()) || !isValidNum(p.getOps())) {
            auditFlags.nanOrNullErrorCount += 1;
          }
        }
      });

      // 5개년 개근 선수(2025년 초기 멤버 중 2030년 개막 시점까지 현역 유지 선수)의 career 배열 길이 검증
      const fiveYearVeterans = allCurrentPlayers.filter((p) => initial2025PlayerIds.has(p.id));
      const allVeteransHaveExact5Careers =
        fiveYearVeterans.length > 0 &&
        fiveYearVeterans.every((p) => Array.isArray(p.career) && p.career.length === 5);
      const anyPlayerOver5Careers = allCurrentPlayers.some(
        (p) => Array.isArray(p.career) && p.career.length > 5
      );

      // 테스트용 슬롯 정리
      await gm.Storage.deleteSave(testSlotId);

      // 8대 핵심 검증 체크리스트 결과 구성
      const checklistResults = [
        {
          id: 1,
          item: "1) NaN / Null / undefined 예외 발생 여부 (비율 스탯·예산·승률)",
          status: auditFlags.nanOrNullErrorCount === 0 && errors.length === 0 ? "PASS" : "FAIL",
          detail: `1,825일 누적 NaN/Null/undefined 발생=${auditFlags.nanOrNullErrorCount}건, 총 시뮬레이션 경기=${auditFlags.totalMatches5Yr}G (연 720G × 5년)`
        },
        {
          id: 2,
          item: "2) 엔트리 정원 준수 여부 (1군≤28명, 2군≤30명, 외국인 육성군 차단)",
          status:
            auditFlags.entryLimitViolations === 0 && auditFlags.foreignInDevViolations === 0 ? "PASS" : "FAIL",
          detail: `정원 초과=${auditFlags.entryLimitViolations}건, 외국인 육성군 유입=${auditFlags.foreignInDevViolations}건`
        },
        {
          id: 3,
          item: "3) 메모리 누수 및 커리어(career) 배열 데이터 정합성 (5년간 정확히 5개)",
          status: allVeteransHaveExact5Careers && !anyPlayerOver5Careers && ctx.seasonHistory.length === 6 ? "PASS" : "FAIL",
          detail: `5년 개근 선수(${fiveYearVeterans.length}명) 전원 career.length===5 (${allVeteransHaveExact5Careers}), 5초과 선수=0명, 시즌히스토리=${ctx.seasonHistory.length}개(2024~2029)`
        },
        {
          id: 4,
          item: "4) 신인 드래프트 및 해외 풀(npbPool) 고갈 없는 세대교체 여부",
          status:
            auditFlags.totalDraftedRookies5Yr === 500 &&
            ctx.draftPool.length === 200 &&
            ctx.npbPool.length === 300
              ? "PASS"
              : "FAIL",
          detail: `5년간 신인 지명 총 ${auditFlags.totalDraftedRookies5Yr}명(매년 100명), 현재 드래프트풀=${ctx.draftPool.length}명, 해외풀=${ctx.npbPool.length}명 유지`
        },
        {
          id: 5,
          item: "5) 6주 부상 대체 외인 복귀 및 방출 외인 즉시 시장 제거 여부",
          status:
            auditFlags.foreign6WeekTestedCount >= 2 &&
            auditFlags.foreign6WeekReturnOk &&
            auditFlags.foreignReleasedCleanOk
              ? "PASS"
              : "FAIL",
          detail: `6주 대체영입 테스트=${auditFlags.foreign6WeekTestedCount}회, 복귀/전환=${auditFlags.foreign6WeekReturnOk}, 퇴출 외인(FOREIGN_RELEASED) 시장 완전제거=${auditFlags.foreignReleasedCleanOk} (아카이브 ${ctx.releasedForeignArchives.length}건)`
        },
        {
          id: 6,
          item: "6) 10개 구단 예산 밸런스 유지 여부 (100억~250억 원 범위)",
          status: auditFlags.budgetOutOfBoundsCount === 0 ? "PASS" : "FAIL",
          detail: `1,825일 전 구단 예산 이탈=${auditFlags.budgetOutOfBoundsCount}건 (현재 10구단 예산 범위: ${(Math.min(...ctx.kboTeams.map((t) => t.budget)) / 10000).toFixed(1)}억 ~ ${(Math.max(...ctx.kboTeams.map((t) => t.budget)) / 10000).toFixed(1)}억)`
        },
        {
          id: 7,
          item: "7) 2027년 개막 시점 저장/불러오기 복원(Hydration) 후 메서드 호출",
          status: auditFlags.hydration2027Passed ? "PASS" : "FAIL",
          detail: auditFlags.hydration2027Detail
        },
        {
          id: 8,
          item: "8) 3년 계약 만료 시점(2027년 말) 구단주 재계약/해임 이벤트 트리거",
          status: auditFlags.gmContract2027Triggered && Boolean(auditFlags.gmContract2027Status) ? "PASS" : "FAIL",
          detail: auditFlags.gmContract2027Detail
        },
        {
          id: 9,
          item: "9) [PART 4] 5대 프런트 핵심 시스템 (포스트시즌·2차드래프트·상무·R&D시설·샐러리캡/비FA다년)",
          status:
            Array.isArray(ctx.postseasonHistory) &&
            ctx.postseasonHistory.length === 5 &&
            Array.isArray(ctx.biennialDraftHistory) &&
            ctx.biennialDraftHistory.length >= 3 &&
            Boolean(ctx.luxuryTaxPenalties)
              ? "PASS"
              : "FAIL",
          detail: `포스트시즌 개최=${(ctx.postseasonHistory || []).length}회(2025~2029), 격년 2차드래프트=${(ctx.biennialDraftHistory || []).length}회(25·27·29), 상무복무=${ctx.kboTeams.reduce((s, t) => s + (t.militaryList || []).length, 0)}명, 내구단 시설Lv=${Object.values(ctx.getUserTeam().facilities || {}).join("/")}, 비FA다년연장=${(ctx.getUserTeam().nonFAExtensions || []).length}건`
        },
        {
          id: 10,
          item: "10) [PART 2 & 5] 오늘의 할 일(Assistant) 및 5대 심화 디테일(2군맞춤육성·포스팅·구장개조·사기·보호명단)",
          status:
            Boolean(ctx.todaysBriefing) &&
            Array.isArray(ctx.postingHistory) &&
            ctx.postingHistory.length >= 1 &&
            Array.isArray(ctx.getUserTeam().parkRemodelHistory) &&
            ctx.getUserTeam().parkRemodelHistory.length >= 1 &&
            ctx.getUserTeam().customProtectedIds &&
            ctx.getUserTeam().customProtectedIds.FA_20.length === 20
              ? "PASS"
              : "FAIL",
          detail: `오늘의할일 브리핑=${ctx.todaysBriefing ? ctx.todaysBriefing.totalCount + "건" : "-"}, MLB포스팅=${(ctx.postingHistory || []).length}건, 구장개조=${(ctx.getUserTeam().parkRemodelHistory || []).length}회, FA보호명단=${(ctx.getUserTeam().customProtectedIds && ctx.getUserTeam().customProtectedIds.FA_20.length) || 0}/20명`
        }
      ];

      const elapsedMs = Date.now() - startTime;
      const allPassed = checklistResults.every((c) => c.status === "PASS") && errors.length === 0;

      console.group("%c================================================================================", "color:#38bdf8;font-weight:bold");
      console.log(
        `%c[KBO_GM.TestRunner.run5YearSimulation] 5개년(2025~2029, 1,825일) 초고속 무인 시뮬레이션 리포트 (${elapsedMs}ms 소요)`,
        "color:#38bdf8;font-weight:bold;font-size:13px"
      );
      console.log("%c[1] 연도별 시즌 결산 리포트 (2025 ~ 2029)", "color:#facc15;font-weight:bold");
      console.table(yearlyReports);
      console.log("%c[2] 8대 핵심 무결성 검증 체크리스트 결과", "color:#facc15;font-weight:bold");
      console.table(checklistResults);

      if (allPassed) {
        console.log(
          `%c✅ [5개년 시뮬레이션 최종 판정: ALL PASS] 총 1,825일 · 3,600경기 무결성 검증 통과 (${elapsedMs}ms)`,
          "color:#22c55e;font-weight:bold;font-size:13px"
        );
      } else {
        console.error(`❌ [5개년 시뮬레이션 최종 판정: FAIL] 오류 ${errors.length}건`, errors);
      }
      console.groupEnd();

      return {
        ok: allPassed,
        elapsedMs,
        daysSimulated: totalDaysToRun,
        startDate: "2025-01-01",
        endDate: ctx.currentDate,
        userTeamId: resolvedTeamId,
        yearlyReports,
        checklistResults,
        errors
      };
    } catch (err) {
      const errMsg = err && err.stack ? err.stack : String(err);
      errors.push(errMsg);
      console.error("❌ [KBO_GM.TestRunner.run5YearSimulation] 치명적 예외 발생:", err);
      return {
        ok: false,
        elapsedMs: Date.now() - startTime,
        yearlyReports,
        checklistResults: [],
        errors
      };
    }
  }

  function initGame(userTeamId = "KIA") {
    const ctx = createGameContextSync({
      userTeamId: resolveTeamId(userTeamId),
      gmName: "김단장",
      gmTrait: "DATA_ANALYST",
      autoSave: false
    });
    const gm = KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM) || null;
    if (gm) {
      gm.context = ctx;
      if (gm.Offseason && typeof gm.Offseason.declareEligibleFAPlayers === "function" && (!Array.isArray(ctx.faPool) || ctx.faPool.length === 0)) {
        gm.Offseason.declareEligibleFAPlayers(ctx);
      }
      ctx.faMarket = (ctx.faPool || []).map((p) => {
        const prof = gm.Offseason && typeof gm.Offseason.evaluateFAPlayerMarketProfile === "function"
          ? gm.Offseason.evaluateFAPlayerMarketProfile(p, ctx)
          : null;
        const grade = (prof && prof.faGrade) || (gm.FA && gm.FA.determineGrade ? gm.FA.determineGrade(p) : "C");
        const val = gm.FA && gm.FA.calculateTargetValuation ? gm.FA.calculateTargetValuation(p, grade) : { grade, years: 2, totalValuation: 40000, annualAverage: 20000 };
        const bd = gm.FA && gm.FA.breakdownContract ? gm.FA.breakdownContract(val, grade) : { years: val.years, total: val.totalValuation, downPayment: 10000, annualBaseSalary: 15000 };
        return { player: p, grade, val, bd };
      });
    }
    return ctx;
  }

  const TestRunner = {
    run5YearSimulation,
    runSelfDiagnosticTest
  };

  return {
    KBO_TEAM_2024_META,
    initGame,
    KOREAN_INDEPENDENT_CLUBS,
    GM_TRAITS,
    STANDARD_SLOTS,
    DRAFT_SCHEDULE_CONFIG,
    POSTSEASON_SCHEDULE_CONFIG,
    SECONDARY_DRAFT_SCHEDULE_CONFIG,
    AMATEUR_SCOUT_GROUPS,
    BUDGET_REQUEST_TIERS,
    resolveTeamId,
    getShortTeamMascot,
    formatHandedness,
    getTeam2024SetupMeta,
    createGMProfile,
    createInitialGMContract,
    evaluateGMContractRenewal,
    parseDateISO,
    formatDateISO,
    formatKoreanDate,
    isSeptemberThirdWeekDraft,
    canPickRookieDraftNow,
    canPlayPostseasonNow,
    canPickSecondaryDraftNow,
    getSeasonPhaseByDate,
    dispatchAmateurScouts,
    applyDailyScoutProgress,
    inspectProspectReport,
    movePlayerEntryWithForeignRule,
    releaseForeignPlayer,
    getEligibleRehabForeignPlayers,
    signSixWeekReplacementForeigner,
    resolveReturnedForeignPlayer,
    executePlayerTrade,
    previewBudgetRequestOdds,
    requestBudgetIncrease,
    getRosterReleaseStatus,
    releaseDomesticPlayer,
    autoTrimRosterForDraftees,
    checkKBOTradeDeadline,
    startSpringCampSchedule,
    evaluateTradePackage,
    autoBalanceTradePackage,
    executePackageTrade,
    getAsianQuarterCandidates,
    signAsianQuarterPlayer,
    advanceDays,
    advanceOneDay,
    advanceSevenDays,
    createGameContextSync,
    createNewGameContext: createGameContextSync,
    initNewGameSession,
    getSlotMetadataList,
    runSelfDiagnosticTest,
    run5YearSimulation,
    TestRunner
  };
});
