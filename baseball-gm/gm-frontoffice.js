/**
 * KBO 단장 모드 (v1.0) — 프런트오피스 정보 모듈 (KBO_GM.FrontOffice)
 * 단장실 화면에 필요한 '판단용 정보'를 한곳에서 만든다.
 *   - 일정·마감 캘린더: 앞으로 N일 안의 마감·행사 (드래프트, 청소년 대표 직관, FA 우선협상 종료, 스토브리그 마감,
 *     포스팅 기간, 경쟁균형세 심사, 포스트시즌, 시즌 회고 리포트, 2차 드래프트)
 *   - 정보 유형 분류: 확정(FACT) · 추정(ESTIMATE) · 의견(OPINION) · 결정 필요(ACTION)
 */

(function (root, factory) {
  const foModule = factory(root.KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM));
  if (typeof globalThis !== "undefined") {
    globalThis.KBO_GM = Object.assign(globalThis.KBO_GM || {}, { FrontOffice: foModule });
  }
  if (typeof window !== "undefined") {
    window.KBO_GM = Object.assign(window.KBO_GM || {}, { FrontOffice: foModule });
  }
  if (typeof module === "object" && module.exports) {
    module.exports = foModule;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function (KBO_GM) {
  "use strict";

  // 정보 유형: 단장이 '무엇을 믿고 무엇을 의심할지' 구분하기 위한 분류
  const INFO_TYPES = {
    FACT: { key: "FACT", label: "확정", desc: "기록·계약·경기 결과 등 확인된 사실" },
    ESTIMATE: { key: "ESTIMATE", label: "추정", desc: "스카우트 보고서·예측치. 오차가 있다" },
    OPINION: { key: "OPINION", label: "의견", desc: "감독·스카우트팀·에이전트·언론의 주장. 이해관계가 있다" },
    ACTION: { key: "ACTION", label: "결정", desc: "단장의 결정이 필요한 일" }
  };

  function gm() {
    return KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM) || {};
  }

  const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

  /**
   * 앞으로 horizonDays 일 안의 일정·마감
   * 반환: [{ date, dDay, title, detail, kind: 'DEADLINE'|'WINDOW'|'EVENT', tab, subTab, urgent }]
   */
  function getUpcomingCalendar(context, horizonDays = 60) {
    if (!context) return [];
    const g = gm();
    const today = context.currentDate;
    const y = context.currentYear;
    const items = [];
    // f5: 프런트 심화 패널 안의 섹션 번호 (2 = 2차 드래프트, 5 = 경쟁균형세·비FA, 6 = 포스팅)
    const add = (date, title, detail, kind, tab, subTab, f5) => {
      const d = dayDiff(date, today);
      if (d < 0 || d > horizonDays) return;
      items.push({ date, dDay: d, title, detail, kind, tab, subTab, f5: f5 || null, urgent: d <= 7 });
    };
    // 올해와 내년 날짜 모두 검사 (연말 → 연초 마감)
    [y, y + 1].forEach((yr) => {
      const off = g.Offseason;
      const stoveKeyNext = yr; // 12월 마감은 다음 시즌 키
      add(`${yr}-03-22`, "정규시즌 개막", "144경기 페넌트레이스 시작", "EVENT", "pennant");
      add(`${yr}-09-23`, "신인 드래프트 개막", "9/30까지 1~3R 직접 지명, 4R부터 스카우트팀 위임", "WINDOW", "offseason", "draft");
      add(`${yr}-09-30`, "신인 드래프트 마감", "지명하지 않으면 스카우트팀이 마무리", "DEADLINE", "offseason", "draft");
      add(`${yr}-10-10`, "포스트시즌 개막", "와일드카드 → 준PO → PO → 한국시리즈", "EVENT", "pennant");
      add(`${yr}-11-04`, "시즌 회고 리포트 도착", "결정 순효과·운·트레이드 장부·드래프트 성과", "EVENT", "records");
      if (g.Extensions && g.Extensions.isBiennialDraftYear && g.Extensions.isBiennialDraftYear(yr)) {
        add(`${yr}-11-05`, "2차 드래프트", "35인 보호명단 외 지명 (11/14 마감)", "WINDOW", "offseason", "front5", [2]);
      }
      add(`${yr}-11-01`, "MLB 포스팅 기간 시작", "12/15까지 · OVR 90+ 또는 능력치 95+ · 7시즌+", "WINDOW", "offseason", "front5", [6]);
      if (!(off && off.isStoveStepDone && off.isStoveStepDone(context, "salary", yr + 1))) {
        add(`${yr}-12-01`, "연봉 재계약 · FA 공시 마감", "직접 처리하지 않으면 '적정 협상'으로 자동 체결", "DEADLINE", "offseason", "salary");
      }
      add(`${yr}-12-10`, "경쟁균형세 심사 · 상무 정기 입대", "상한 초과 시 제재금 · 연속 초과 시 1R 지명권 하락", "DEADLINE", "offseason", "front5", [5]);
      add(`${yr}-01-15`, "FA 시장 마감", "미계약 FA는 AI 구단 입찰로 정리", "DEADLINE", "offseason", "fa");
      if (!(off && off.isStoveStepDone && off.isStoveStepDone(context, "salary", yr))) {
        add(`${yr}-01-31`, "연봉 재계약 마감", "직접 처리하지 않으면 '적정 협상'으로 자동 체결", "DEADLINE", "offseason", "salary");
      }
      if (!(off && off.isStoveStepDone && off.isStoveStepDone(context, "foreign", yr))) {
        add(`${yr}-01-31`, "외국인 계약 마감", "재계약·신규 영입을 하지 않으면 자동 처리", "DEADLINE", "offseason", "foreign");
      }
      void stoveKeyNext;
    });

    // FA 원소속 우선협상 종료
    if (context.faMarketPhase === "PRIORITY" && context.faPriorityEndsDate) {
      add(context.faPriorityEndsDate, "FA 우선협상 종료", "타 구단 FA 공개 · 전 구단 자유협상 시작", "DEADLINE", "offseason", "fa");
    }

    // 청소년 국가대표 직관
    if (g.Draft && typeof g.Draft.getYouthViewingEvents === "function") {
      g.Draft.getYouthViewingEvents(context).forEach((ev) => {
        if (ev.status === "UPCOMING" || ev.status === "OPEN") {
          add(ev.date, `${ev.name}`, ev.status === "OPEN" ? `지금 직관 가능 (남은 ${ev.remaining}회)` : `행사 10일 전부터 직관 가능`, "EVENT", "offseason", "draft");
        }
      });
    }

    return items.sort((a, b) => a.dDay - b.dDay || a.title.localeCompare(b.title));
  }

  /**
   * 스토브리그 단계: 연봉 재계약 → FA 우선협상 → FA 자유협상 → 외국인 계약 → 스프링캠프
   * 반환: [{ key, label, start, end, status: 'DONE'|'OPEN'|'UPCOMING'|'CLOSED', dDay, target }]
   *   시즌 중(3/22~9/30)에는 다가오는 겨울 기준으로 '예정'을 보여준다.
   */
  function getStovePhases(context) {
    if (!context) return [];
    const g = gm();
    const off = g.Offseason;
    const today = context.currentDate;
    const y = context.currentYear;
    const month = Number(String(today).slice(5, 7));
    const inSeason = (month > 3 && month < 10) || (month === 3 && String(today).slice(8) >= "22");
    const K = inSeason ? y + 1 : off && typeof off.getStoveSeasonKey === "function" ? off.getStoveSeasonKey(context) : month >= 10 ? y + 1 : y;
    const prevY = K - 1;
    const firstYear = K === ((context && context.startYear) || 2025);
    const done = (step) => Boolean(off && typeof off.isStoveStepDone === "function" && off.isStoveStepDone(context, step, K));
    const declaredThisCycle = done("declared");
    const priorityEnd = declaredThisCycle && context.faPriorityEndsDate ? context.faPriorityEndsDate : firstYear ? `${K}-01-08` : `${prevY}-12-08`;
    const faOpenNow = declaredThisCycle && context.faMarketPhase && context.faMarketPhase !== "PRIORITY";
    const phases = [
      { key: "salary", label: "연봉 재계약", start: firstYear ? `${K}-01-01` : `${prevY}-11-05`, end: firstYear ? `${K}-01-31` : `${prevY}-12-01`, isDone: done("salary"), target: { tab: "offseason", sub: "salary" } },
      { key: "faPriority", label: "FA 원소속 우선협상", start: firstYear ? `${K}-01-01` : `${prevY}-12-01`, end: priorityEnd, isDone: faOpenNow, target: { tab: "offseason", sub: "fa" } },
      { key: "faOpen", label: "FA 자유협상", start: priorityEnd, end: `${K}-01-15`, isDone: false, target: { tab: "offseason", sub: "fa" } },
      { key: "foreign", label: "외국인 · 아시아쿼터 계약", start: firstYear ? `${K}-01-01` : `${prevY}-11-05`, end: `${K}-01-31`, isDone: done("foreign"), target: { tab: "offseason", sub: "foreign" } },
      { key: "camp", label: "코치진 · 스프링캠프", start: `${K}-02-01`, end: `${K}-03-21`, isDone: false, target: { tab: "offseason", sub: "camp" } }
    ];
    return phases.map((ph) => {
      let status;
      if (ph.isDone) status = "DONE";
      else if (today < ph.start) status = "UPCOMING";
      else if (today <= ph.end) status = "OPEN";
      else status = "CLOSED";
      const dDay = status === "UPCOMING" ? dayDiff(ph.start, today) : status === "OPEN" ? dayDiff(ph.end, today) : null;
      return { key: ph.key, label: ph.label, start: ph.start, end: ph.end, status, dDay, target: ph.target };
    });
  }

  return {
    INFO_TYPES,
    getUpcomingCalendar,
    getStovePhases
  };
});
