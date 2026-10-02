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

  /* ───────────────────────────────────────────────────────────────
   * 단장실 정리: '한 번 처리하면 끝나는 일' vs '계속 지켜볼 지표' vs '비서 추천'
   *   - 한 번 처리하면 끝: 마감이 있는 결정 (드래프트, 스토브리그 계약, 6주 대체 외인, 시기별 보호명단)
   *   - 계속 지켜볼 지표: 상태가 계속 바뀌는 것 (엔트리·부상, 예산, 신임도, 경쟁균형세, 2군 육성, 스카우트 배정, 사기)
   *   - 비서 추천: 지표에서 나온 제안 + 시기별 조언. 보류(14일)할 수 있고, 오래 떠 있던 추천은 뒤로 밀려 다른 추천이 올라온다
   * ─────────────────────────────────────────────────────────────── */
  const ONE_OFF_TASKS = new Set(["DRAFT_WEEK", "STOVE_LEAGUE_RENEWAL_FA", "FOREIGN_6WK_ACTION", "PROTECTION_LIST_SUBMIT"]);
  const SNOOZE_DAYS = 14;

  function addDays(dateStr, n) {
    const d = new Date(Date.parse(dateStr) + n * 86400000);
    return d.toISOString().slice(0, 10);
  }

  function ensureFOState(context) {
    if (!context.foState || typeof context.foState !== "object") context.foState = { snoozed: {}, firstSeen: {} };
    if (!context.foState.snoozed) context.foState.snoozed = {};
    if (!context.foState.firstSeen) context.foState.firstSeen = {};
    return context.foState;
  }

  function isSnoozed(context, id) {
    const st = ensureFOState(context);
    const until = st.snoozed[id];
    return Boolean(until && String(context.currentDate) < until);
  }

  /** 추천·지표를 SNOOZE_DAYS 동안 숨긴다 */
  function snooze(context, id, days = SNOOZE_DAYS) {
    const st = ensureFOState(context);
    st.snoozed[id] = addDays(context.currentDate, days);
    return st.snoozed[id];
  }

  // 계속 지켜볼 지표 (상태: ok · warn · bad)
  function buildWatchlist(context) {
    const g = gm();
    const team = context.getUserTeam();
    if (!team) return [];
    const items = [];
    const push = (id, label, value, status, note, target) => items.push({ id, label, value, status, note, target });
    const eok = (m) => `${(m / 10000).toFixed(1)}억`;

    const inj1 = team.roster1G.filter((p) => p.injury && p.injury.active).length;
    const r1 = team.roster1G.length;
    push("WATCH_ENTRY", "1군 엔트리 · 부상", `${r1}/28명 · 부상 ${inj1}명`, r1 < 28 || inj1 >= 3 ? "bad" : inj1 > 0 ? "warn" : "ok",
      inj1 ? "부상자가 있으면 2군 콜업으로 빈자리를 메우세요." : "정상 가동 중", { tab: "roster", sub: "1GUN" });

    const room = team.budget - team.getTotalPayroll();
    push("WATCH_BUDGET", "여유 예산", room < 0 ? `−${eok(-room)}` : eok(room), room < 0 ? "bad" : room < 50000 ? "warn" : "ok",
      room < 0 ? "적자 상태로 주간 정산을 맞으면 구단주 신임이 떨어집니다." : "FA 계약금·시설 투자·현금 트레이드에 쓸 수 있는 돈", { tab: "pennant" });

    const trust = Math.round(team.ownerTrust ?? 80);
    push("WATCH_OWNER", "구단주 신임", `${trust}`, trust < 40 ? "bad" : trust < 55 ? "warn" : "ok", trust < 55 ? "계약 만료 때 재계약이 위험해집니다." : "안정", { tab: "pennant" });

    const ext = g.Extensions;
    if (ext && typeof ext.getTop40DomesticPayroll === "function" && typeof ext.getSalaryCapLimit === "function") {
      const top40 = ext.getTop40DomesticPayroll(team, context);
      const cap = ext.getSalaryCapLimit(context);
      const pct = cap > 0 ? Math.round((top40 / cap) * 100) : 0;
      push("WATCH_CAP", "경쟁균형세 상한 대비", `${pct}%`, pct > 100 ? "bad" : pct >= 92 ? "warn" : "ok",
        pct > 100 ? "12월 10일 심사에서 제재금이 나옵니다." : `상한 ${eok(cap)}`, { tab: "offseason", sub: "front5", f5: [5] });
    }

    const futures = [...(team.roster2G || []), ...(team.rosterDev || [])];
    const unassigned = futures.filter((p) => !p.trainingFocus).length;
    push("WATCH_FUTURES", "2군 육성 과제 미지정", `${unassigned}/${futures.length}명`, unassigned > futures.length * 0.5 ? "warn" : "ok",
      "과제를 정하면 2군 성장 속도가 빨라집니다.", { tab: "facilities" });

    const morale = ext && typeof ext.getMoraleIssuePlayers === "function" ? ext.getMoraleIssuePlayers(team) : [];
    push("WATCH_MORALE", "사기 저하 · 트레이드 요구", `${morale.length}명`, morale.length >= 3 ? "bad" : morale.length > 0 ? "warn" : "ok",
      morale.length ? `${morale[0].name} 사기 ${morale[0].morale}` : "문제 없음", { tab: "manager" });

    const disp = context.scoutDispatch || { maxScouts: 4, allocation: {} };
    const alloc = disp.allocation || {};
    const used = Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0);
    const max = disp.maxScouts || 4;
    push("WATCH_SCOUT", "아마추어 스카우트 배정", `${used}/${max}명`, used < max ? "warn" : "ok", used < max ? "남는 스카우트가 있습니다." : "모두 배정됨", { tab: "offseason", sub: "draft" });

    return items;
  }

  // 시기별 조언 (달력 기준, 같은 시기에는 같은 조언이 나오지만 날짜가 지나면 바뀐다)
  function seasonalAdvice(context) {
    const d = String(context.currentDate);
    const m = Number(d.slice(5, 7));
    const day = Number(d.slice(8, 10));
    const out = [];
    const add = (id, title, desc, target) => out.push({ id, title, desc, target, kind: "SEASONAL" });
    if (m === 1 || m === 2) add("ADV_CAMP", "스프링캠프 전 코치진과 캠프 장소를 정하세요", "캠프 장소·훈련 방향에 따라 시즌 초 컨디션과 성장이 달라집니다.", { tab: "offseason", sub: "camp" });
    if (m === 3 && day < 22) add("ADV_OPENING", "개막 엔트리를 점검하세요", "28명 엔트리와 선발 로테이션을 개막 전에 확정하세요.", { tab: "roster", sub: "1GUN" });
    if (m >= 4 && m <= 6) add("ADV_EARLY", "시즌 초 기록을 보고 2군 콜업 후보를 고르세요", "2군 성적이 좋은 유망주는 1군 경험으로 더 빨리 큽니다.", { tab: "roster", sub: "2GUN" });
    if (m === 7) add("ADV_TRADE_DEADLINE", "7월 말 트레이드 마감 전 보강을 검토하세요", "순위 경쟁 중이라면 부족한 포지션을, 처졌다면 유망주 확보를 노릴 때입니다.", { tab: "offseason", sub: "trade" });
    if (m === 8 || (m === 9 && day < 23)) add("ADV_DRAFT_PREP", "드래프트 방침과 스카우트 파견을 점검하세요", "청소년 대표 직관과 스카우트 조사도가 지명 정확도를 좌우합니다.", { tab: "offseason", sub: "draft" });
    if (m === 10) add("ADV_POSTSEASON", "포스트시즌 결과에 따라 겨울 예산을 계획하세요", "배당금과 구단주 신임이 다음 시즌 예산에 반영됩니다.", { tab: "pennant" });
    if (m === 11) add("ADV_NONFA", "FA 직전 핵심 선수와 비FA 다년계약을 검토하세요", "12월 1일 공시 전에 묶지 않으면 다른 구단과 경쟁해야 합니다.", { tab: "offseason", sub: "front5", f5: [5] });
    if (m === 12) add("ADV_CAP", "12월 10일 경쟁균형세 심사 전에 상한을 확인하세요", "상한을 넘으면 제재금, 연속 초과면 1라운드 지명권이 밀립니다.", { tab: "offseason", sub: "front5", f5: [5] });
    return out;
  }

  /**
   * 브리핑(업무 비서) + 지표 + 시기별 조언을 단장실 3구역으로 나눈다
   * 반환: { oneOff: [task], watch: [item], advice: [rec] }
   */
  function organizeBriefing(context, briefing) {
    const st = ensureFOState(context);
    const all = [...((briefing && briefing.mustDo) || []), ...((briefing && briefing.recommended) || [])];
    const oneOff = all.filter((t) => ONE_OFF_TASKS.has(t.id));
    const recs = all.filter((t) => !ONE_OFF_TASKS.has(t.id)).map((t) => ({ ...t, kind: "ASSISTANT" }));
    const advicePool = [...recs, ...seasonalAdvice(context)].filter((r) => !isSnoozed(context, r.id));
    // 노출 시간 기준 순환: 화면에 실제로 보인 날부터 세고, 21일 넘게 보였는데 손대지 않은 추천은 14일 쉬고,
    // 그 사이 기다리던 추천이 올라온다 (같은 추천이 계속 고정되지 않도록). 비서 추천은 한 번에 2개까지.
    const today = String(context.currentDate);
    const ROTATE_AFTER = 21;
    const MAX_ASSISTANT = 2;
    const shownAge = (r) => (st.firstSeen[r.id] ? Math.max(0, Math.round((Date.parse(today) - Date.parse(st.firstSeen[r.id])) / 86400000)) : null);
    advicePool.forEach((r) => {
      const a = shownAge(r);
      if (r.kind === "ASSISTANT" && a != null && a >= ROTATE_AFTER) {
        snooze(context, r.id, SNOOZE_DAYS);
        delete st.firstSeen[r.id];
      }
    });
    const fresh = advicePool.filter((r) => !isSnoozed(context, r.id));
    const seasonal = fresh.filter((r) => r.kind === "SEASONAL").slice(0, 1);
    // 이미 보이던 추천 먼저(순서 유지), 그다음 기다리던 추천
    const assistant = fresh
      .filter((r) => r.kind === "ASSISTANT")
      .sort((x, y) => {
        const ax = shownAge(x), ay = shownAge(y);
        if ((ax == null) !== (ay == null)) return ax == null ? 1 : -1;
        return (ay || 0) - (ax || 0);
      })
      .slice(0, MAX_ASSISTANT);
    const advice = [...seasonal, ...assistant].map((r) => {
      if (!st.firstSeen[r.id]) st.firstSeen[r.id] = today;
      return { ...r, ageDays: shownAge(r) || 0 };
    });
    // 조건이 사라진 추천의 기록 정리
    Object.keys(st.firstSeen).forEach((id) => {
      if (!advicePool.some((r) => r.id === id)) delete st.firstSeen[id];
    });
    const watch = buildWatchlist(context).map((w) => ({ ...w, snoozed: isSnoozed(context, w.id) }));
    return { oneOff, watch, advice, hiddenCount: Math.max(0, fresh.length - advice.length) };
  }

  return {
    INFO_TYPES,
    getUpcomingCalendar,
    getStovePhases,
    organizeBriefing,
    buildWatchlist,
    snooze,
    isSnoozed
  };
});
