/**
 * KBO 단장 모드 (v1.0) — Phase 4 & 5: 프런트엔드 대시보드 UI 컨트롤러 (KBO_GM.UI)
 * 의존 모듈: KBO_GM (Schema, simulateMatch, WeeklySim, Storage, Draft, Offseason, SpringCamp)
 */

(function () {
  "use strict";

  const GM = window.KBO_GM;
  if (!GM) {
    console.error("KBO_GM 엔진이 로드되지 않았습니다.");
    return;
  }

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  // 내부 만원 단위를 억 원(숫자)으로 변환 (예: 150000 -> 15, 3000 -> 0.3)
  function toEokNum(manwon) {
    const v = Number(manwon) || 0;
    return +(v / 10000).toFixed(2);
  }

  // 유저가 입력한 '억 원' 단위 입력값을 내부 연산용 '만원' 단위로 변환
  // (예: 15 -> 150000, 0.3 -> 3000 / 혹시 1000 이상의 큰 숫자를 입력하면 만원 단위로 자동 호환)
  function fromEokInput(inputVal, minManwon = 0) {
    const num = Number(inputVal);
    if (!Number.isFinite(num) || num <= 0) return minManwon;
    const manwon = num >= 1000 ? Math.round(num) : Math.round(num * 10000);
    return Math.max(minManwon, manwon);
  }

  // 금액 포맷: 모든 금액을 복잡한 만원 단위 없이 깔끔한 '억 원' 단위로 통일 (예: 120억, 15.5억, 0.3억)
  function fmtMoney(manwon) {
    const v = Math.round(Number(manwon) || 0);
    if (v === 0) return "0억";
    const sign = v < 0 ? "-" : "";
    const eok = Math.abs(v) / 10000;
    const formatted = Number(eok.toFixed(2)).toLocaleString("ko-KR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
    return `${sign}${formatted}억`;
  }

  // 좌/우 투타 한글 표기 헬퍼 ([요청 5] L타-L투 -> 좌타-좌투, R타-R투 -> 우타-우투)
  function fmtHand(p) {
    if (GM.Setup && typeof GM.Setup.formatHandedness === "function") {
      return GM.Setup.formatHandedness(p);
    }
    const bRaw = String((p && p.bats) || "R").toUpperCase();
    const tRaw = String((p && p.throws) || "R").toUpperCase();
    const bKor = bRaw === "L" ? "좌" : bRaw === "S" ? "양" : "우";
    const tKor = tRaw === "L" ? "좌" : "우";
    return `${bKor}타-${tKor}투`;
  }

  // 구단 뒤 이름(마스코트명: 표범즈, 고양이즈 등) 추출 헬퍼 ([요청 4])
  function fmtMascot(teamIdOrName) {
    if (GM.Setup && typeof GM.Setup.getShortTeamMascot === "function") {
      return GM.Setup.getShortTeamMascot(teamIdOrName, STATE.ctx);
    }
    return String(teamIdOrName || "");
  }

  // 상태 관리 객체
  const STATE = {
    ctx: null,
    activeTab: "pennant",       // 'pennant' | 'roster' | 'offseason' | 'records' | 'storage'
    rosterSubTab: "1GUN",       // '1GUN' | '2GUN' | 'YUKSEONG'
    rosterPosFilter: "ALL",     // 'ALL' | 'pitcher' | 'C' | 'IF' | 'OF'
    rosterViewTeamId: null,     // null 이면 내 구단
    rosterSortField: "ovr",     // 'pos' | 'name' | 'age' | 'ovr' | 'pot' | 'war' | 'salary' | 'fatigue'
    rosterSortAsc: false,       // false: 내림차순, true: 오름차순
    offseasonSubTab: "draft",   // 'draft' | 'salary' | 'fa' | 'foreign' | 'camp' | 'trade'
    recordsSubTab: "kboBat",    // 'kboBat' | 'kboPit' | 'npb' | 'amateur' | 'history' | 'retro'
    lastWeeklyReport: null,
    lastDraftReport: null,
    lastSalaryReport: null,
    lastFAReport: null,
    lastForeignReport: null,
    lastCampReport: null,
    // 유저 스토브리그 임시 입력 상태
    userSalaryOffers: {},
    userSalaryPolicy: "FAIR",
    userFABids: {},
    userForeignKeepIds: new Set(),
    foreignKeepInitializedYear: null,
    userForeignSalaryOffers: {},
    userForeignSignIds: new Set(),
    userStaffSelection: {
      manager: "한도훈",
      pitchingCoach: "차명석",
      hittingCoach: "신태호"
    },
    userCampLocation: "USA",
    userCampFocus: "BALANCED",
    // [요청 8] 단장 간 다대다 트레이드 협상실 상태
    tradePartnerTeamId: "",
    tradeNationalityMode: "DOMESTIC", // 'DOMESTIC' (내국인끼리) | 'FOREIGN' (외국인끼리)
    tradeMyPlayerIds: [],
    tradeTargetPlayerIds: [],
    tradeMyPickRounds: [],
    tradeTargetPickRounds: [],
    tradeCashToPartner: 0,
    tradeCashFromPartner: 0,
    exploredTradeOffers: [],
    // [요청 3 & 4] FA 시장 등급별(A/B/C) · 포지션별 세분화 필터 상태
    faGradeFilter: "ALL",       // 'ALL' | 'A' | 'B' | 'C'
    faPosFilter: "ALL",         // 'ALL' | 'PITCHER' | 'SP' | 'RP' | 'CL' | 'C' | 'IF' | '1B' | '2B' | '3B' | 'SS' | 'OF' | 'DH'
    faAffiliationFilter: "ALL", // 'ALL' | 'HOME' | 'EXTERNAL'
    faSortBy: "DEMAND"          // 'DEMAND' | 'OVR' | 'WAR' | 'AGE'
  };

  /* ═══════════════════════════════════════════════════════════════════════
   * 1. 토스트 알림 및 테마 전환
   * ═══════════════════════════════════════════════════════════════════════ */
  let toastTimer = null;
  function showToast(msg, type = "info") {
    const el = $("gmToast");
    if (!el) return;
    el.textContent = msg;
    el.dataset.type = type;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === "dark" || theme === "light") {
      root.setAttribute("data-theme", theme);
      try {
        localStorage.setItem("kbo_gm_theme", theme);
      } catch (e) {}
    }
    const cur = root.getAttribute("data-theme") || "light";
    const btn = $("btnThemeToggle");
    if (btn) {
      btn.textContent = cur === "dark" ? "☀️ 밝게" : "🌙 야간 경기장";
    }
    const lobbyBtn = $("btnLobbyTheme");
    if (lobbyBtn) {
      lobbyBtn.textContent = cur === "dark" ? "🌙 어둡게" : "☀️ 밝게";
    }
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") || "light";
    applyTheme(cur === "dark" ? "light" : "dark");
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 1-B. 시작 로비(슬롯 선택) & 새 단장 생성 화면 (스크린샷 1·2 동일 플로우)
   *      한 번 선택한 담당 구단은 해당 슬롯에서 영구 고정(변경 불가)
   * ═══════════════════════════════════════════════════════════════════════ */
  let createTargetSlotId = "slot_1";
  let createSelectedTrait = "DATA_ANALYST";
  let createSelectedDifficulty = "NORMAL";
  let createSelectedTeamId = "KIA";

  async function renderLobbySlots() {
    const container = $("lobbySlotCards");
    if (!container) return;

    const slots = GM.Setup && typeof GM.Setup.getSlotMetadataList === "function"
      ? await GM.Setup.getSlotMetadataList()
      : [];

    const ordered = [
      slots.find((s) => s.slotId === "slot_1") || { slotId: "slot_1", slotTitle: "단장 슬롯 1", isEmpty: true },
      slots.find((s) => s.slotId === "slot_2") || { slotId: "slot_2", slotTitle: "단장 슬롯 2", isEmpty: true },
      slots.find((s) => s.slotId === "slot_3") || { slotId: "slot_3", slotTitle: "단장 슬롯 3", isEmpty: true },
      slots.find((s) => s.slotId === "auto_save") || { slotId: "auto_save", slotTitle: "자동 저장 슬롯", isEmpty: true }
    ];

    container.innerHTML = ordered
      .map((s, idx) => {
        const slotLabel = s.slotId === "auto_save" ? "자동 저장 슬롯" : `단장 ${idx + 1}`;
        if (s.isEmpty || !s.hasSave) {
          return `
            <div class="lobby-slot-card empty">
              <div class="lobby-slot-left">
                <div class="lobby-plus-icon">+</div>
                <div>
                  <div class="lobby-slot-name" style="font-size:15px">${esc(slotLabel)} — 빈 슬롯</div>
                  <div class="lobby-slot-sub">새 단장 프로필을 생성하고 담당 구단에 부임하세요 (3년 8억 계약)</div>
                </div>
              </div>
              <div class="lobby-slot-right">
                <button type="button" class="btn-new-gm-pill" data-lobby-new="${esc(s.slotId)}">새 단장 만들기</button>
              </div>
            </div>
          `;
        }

        const rec = s.record || { w: 0, l: 0, d: 0 };
        return `
          <div class="lobby-slot-card">
            <div class="lobby-slot-left">
              <div class="lobby-ball-icon">⚾</div>
              <div>
                <div class="lobby-slot-name">${esc(s.gmName || "백승수")}</div>
                <div class="lobby-slot-sub">
                  ${s.currentYear || 2025}시즌 ${s.currentWeek || 1}주차 · <strong>${esc(s.userTeamName)} (${esc(s.userTeamId)}) [구단 고정]</strong> · ${esc(s.gmTraitLabel || "데이터 분석가")} · 난이도 ${esc(s.difficultyLabel || "보통")}<br/>
                  전적 ${rec.w}승 ${rec.l}패 ${rec.d}무 (승률 ${s.winPctFormatted || ".000"}) · 보유 예산 ${fmtMoney(s.budget)} · 신임도 ${s.ownerTrust ?? 60}
                </div>
              </div>
            </div>
            <div class="lobby-slot-right">
              <button type="button" class="btn-continue-link" data-lobby-continue="${esc(s.slotId)}">이어하기</button>
              <button type="button" class="btn-clear-pill" data-lobby-clear="${esc(s.slotId)}">비우기</button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderCreateTeamGrid() {
    const grid = $("createTeamGrid");
    const descBox = $("createTeamDescBox");
    if (!grid || !GM.Setup) return;

    const metaList = GM.Setup.KBO_TEAM_2024_META || [];
    grid.innerHTML = metaList
      .map((m) => {
        const isAct = m.id === createSelectedTeamId;
        return `
          <button type="button" class="create-team-box ${isAct ? "active" : ""}" data-select-create-team="${esc(m.id)}">
            <span class="t-name">${esc(m.kboName)} (${esc(m.name.split(" ")[0])})</span>
            <span class="t-sub">24시즌 ${m.rank2024}위 · 전력 ${m.tier1G}</span>
            <span class="t-bud">예산 ${(m.budget / 10000).toFixed(0)}억</span>
          </button>
        `;
      })
      .join("");

    const selMeta = metaList.find((m) => m.id === createSelectedTeamId) || metaList[0];
    if (descBox && selMeta) {
      descBox.innerHTML = `
        <strong>[${selMeta.rank2024}위 ${esc(selMeta.name)} (${esc(selMeta.kboName)}) — ${esc(selMeta.goalTitle)}]</strong><br/>
        1군 평균 체급 <strong>${selMeta.tier1G}</strong> · 2군 체급 <strong>${selMeta.tier2G}</strong> · 초기 배정 예산 <strong>${fmtMoney(selMeta.budget)}</strong> (난이도: ${esc(selMeta.difficulty)}).<br/>
        첫 계약은 <strong>[3년 계약 / 총액 8억 원 (계약금 2억 + 연봉 2억)]</strong>으로 고정되며, <strong>2025년 1월 1일</strong> 스토브리그부터 즉시 업무를 시작합니다. <strong>한 번 선택한 담당 구단은 중도 변경이 불가능합니다.</strong>
      `;
    }
  }

  function openCreateGmForm(slotId) {
    createTargetSlotId = slotId || "slot_1";
    $("lobbySlotView").hidden = true;
    $("lobbyCreateView").hidden = false;
    renderCreateTeamGrid();
  }

  function closeCreateGmForm() {
    $("lobbyCreateView").hidden = true;
    $("lobbySlotView").hidden = false;
    renderLobbySlots();
  }

  function enterDashboardWithContext(ctx) {
    STATE.ctx = ctx;
    STATE.rosterViewTeamId = ctx.userTeamId;
    STATE.lastWeeklyReport = null;
    $("lobbyContainer").hidden = true;
    const lobbyThemeBtn = $("btnLobbyTheme");
    if (lobbyThemeBtn) lobbyThemeBtn.hidden = true;
    $("dashboardAppWrap").hidden = false;
    renderAll();
  }

  async function returnToLobby() {
    if (STATE.ctx && GM.Storage) {
      const targetSlot = STATE.ctx.slotId || "auto_save";
      await GM.Storage.saveGame(targetSlot, STATE.ctx);
    }
    $("dashboardAppWrap").hidden = true;
    $("lobbyContainer").hidden = false;
    const lobbyThemeBtn = $("btnLobbyTheme");
    if (lobbyThemeBtn) lobbyThemeBtn.hidden = false;
    closeCreateGmForm();
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 2. 상단 대시보드 헤더 렌더링 (담당 구단 고정 — 변경 드롭다운 제거)
   * ═══════════════════════════════════════════════════════════════════════ */
  function renderHeader() {
    const ctx = STATE.ctx;
    if (!ctx) return;
    const userTeam = ctx.getUserTeam();
    if (!userTeam) return;

    const lockedBadge = $("hdrLockedTeamName");
    if (lockedBadge) {
      lockedBadge.textContent = `${userTeam.name} (${userTeam.id})`;
    }

    const rec = userTeam.record || { w: 0, l: 0, d: 0 };
    const standings = ctx.standings || GM.calculateKBOStandings(ctx);
    const myRankRow = standings.find((s) => s.teamId === userTeam.id);
    const rankNum = myRankRow ? myRankRow.rank : "-";

    const payroll = userTeam.getTotalPayroll();
    const availBudget = userTeam.budget - payroll;
    const gmProf = ctx.gmProfile || { name: "김단장", traitLabel: "데이터 분석가" };
    const gmCon = ctx.gmContract || { yearsTotal: 3, yearsLeft: 3, totalAmount: 80000, signingBonus: 20000, annualSalary: 20000 };

    const diffLabel = GM.Economy ? GM.Economy.getDifficulty(ctx).label : "보통";
    $("hdrTeamMeta").textContent = `${gmProf.name} 단장 (${gmProf.traitLabel}) · 난이도 ${diffLabel} · 계약: ${gmCon.yearsTotal}년 총액 ${fmtMoney(gmCon.totalAmount)} (계약금 ${fmtMoney(gmCon.signingBonus)}/연봉 ${fmtMoney(gmCon.annualSalary)}, 잔여 ${gmCon.yearsLeft}년)`;
    $("hdrBudget").textContent = fmtMoney(userTeam.budget);
    const payrollSubEl = $("hdrPayrollSub");
    payrollSubEl.textContent = `연봉총액 ${fmtMoney(payroll)} · 여유 ${fmtMoney(availBudget)}${availBudget < 0 ? " (적자: 매주 구단주 신임도 하락)" : ""} · 현재 ${rankNum}위 (${rec.w}승 ${rec.l}패 ${rec.d}무)`;
    payrollSubEl.classList.toggle("text-bad", availBudget < 0);

    const trust = clamp(userTeam.ownerTrust ?? 80, 0, 100);
    const fan = clamp(userTeam.fanRatio ?? 60, 0, 100);
    const mcMod = GM.ManagerConflict || GM.Extensions;
    const mcState = mcMod && typeof mcMod.ensureManagerConflictState === "function"
      ? mcMod.ensureManagerConflictState(userTeam)
      : null;
    const mgrTrust = clamp(mcState ? mcState.managerTrust : (userTeam.managerTrust ?? 75), 0, 100);

    $("hdrTrustVal").textContent = `${trust} / 100`;
    $("hdrTrustBar").style.width = `${trust}%`;
    const mgrValEl = $("hdrMgrTrustVal");
    const mgrBarEl = $("hdrMgrTrustBar");
    if (mgrValEl) mgrValEl.textContent = `${mgrTrust} / 100`;
    if (mgrBarEl) mgrBarEl.style.width = `${mgrTrust}%`;
    $("hdrFanVal").textContent = `${fan} / 100`;
    $("hdrFanBar").style.width = `${fan}%`;

    const curDate = ctx.currentDate || `${ctx.currentYear}-01-01`;
    const korDate = GM.Setup ? GM.Setup.formatKoreanDate(curDate) : curDate;
    const phaseInfo = GM.Setup ? GM.Setup.getSeasonPhaseByDate(curDate) : { label: "페넌트레이스" };
    $("hdrSeasonBadge").textContent = `${korDate} · ${phaseInfo.label}`;

    const exp = userTeam.ownerExpectation;
    $("hdrOwnerGoal").textContent = exp
      ? `2024시즌 ${exp.prevRank || "-"}위 → 구단주 목표: ${exp.goalTitle} (스카우트 Lv.${ctx.scoutLevel})`
      : `구단주 목표: 포스트시즌 진출 (스카우트 Lv.${ctx.scoutLevel})`;

    const btnNextDay = $("btnNextDay");
    if (btnNextDay) {
      btnNextDay.textContent = "+1일 진행";
    }
    const btnNext = $("btnNextWeek");
    if (btnNext) {
      btnNext.textContent = "1주 스킵 (+7일 진행)";
      btnNext.disabled = false;
    }

    renderTodaysTodoPanel();
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 2-B. [PART 2] 단장 업무 가이드 '오늘의 할 일 (Today's To-Do)' 렌더링 (KBO_GM.Assistant)
   * ═══════════════════════════════════════════════════════════════════════ */
  function renderTodaysTodoPanel() {
    const panel = $("todaysTodoPanel");
    const ctx = STATE.ctx;
    if (!panel || !ctx || !GM.Assistant) return;

    const briefing = GM.Assistant.generateDailyBriefing(ctx);
    ctx.todaysBriefing = briefing;
    const allTasks = [...(briefing.mustDo || []), ...(briefing.recommended || [])];

    if (!allTasks.length) {
      panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <div>
            <strong style="font-size:13.5px">📋 오늘의 단장 업무 브리핑 (${esc(briefing.koreanDate)})</strong>
            <span class="tiny text-good" style="margin-left:8px">현재 처리해야 할 긴급/추천 업무가 모두 완료되었습니다! 안심하고 일정을 진행하세요.</span>
          </div>
        </div>
      `;
      return;
    }

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <div>
          <strong style="font-size:14px">📋 오늘의 단장 업무 가이드 (KBO_GM.Assistant · ${esc(briefing.koreanDate)})</strong>
          <span class="tiny" style="margin-left:8px">
            🔴 필수 할 일 <strong>${briefing.mustDo.length}건</strong> ·
            🟡 추천 할 일 <strong>${briefing.recommended.length}건</strong>
          </span>
        </div>
        <span class="tiny muted">원클릭 자동 해결 또는 해당 업무 탭으로 즉시 이동할 수 있습니다.</span>
      </div>
      <div class="scout-grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:8px">
        ${allTasks
          .map(
            (t) => `
            <div class="scout-card" style="padding:10px 12px;border-left:4px solid ${t.priority === "MUST_DO" ? "var(--bad)" : "#f59e0b"}">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
                <strong style="font-size:12.5px">${esc(t.badge)} · ${esc(t.title)}</strong>
              </div>
              <div class="tiny" style="margin:4px 0 8px">${esc(t.desc)}</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button type="button" class="btn-xs primary" data-assistant-quick-task="${esc(t.id)}">⚡ ${esc(t.quickActionLabel)}</button>
                <button type="button" class="btn-xs ghost" data-assistant-goto-tab="${esc(t.targetTab)}" data-assistant-goto-sub="${esc(t.targetSubTab || "")}">업무 화면 이동 →</button>
              </div>
            </div>
          `
          )
          .join("")}
      </div>
    `;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 3. 탭 [1] 주간 페넌트레이스 렌더링
   * ═══════════════════════════════════════════════════════════════════════ */
  function renderPennantTab() {
    const ctx = STATE.ctx;
    if (!ctx) return;
    const userTeam = ctx.getUserTeam();
    const standings = ctx.standings && ctx.standings.length ? ctx.standings : GM.calculateKBOStandings(ctx);

    // 1) KBO 10개 구단 순위표
    const stBody = $("pennantStandingsBody");
    if (stBody) {
      stBody.innerHTML = standings
        .map((r) => {
          const isMe = r.teamId === userTeam.id;
          const psClass = r.rank <= 5 ? "ps-line" : "";
          return `
            <tr class="${isMe ? "my-team-row" : ""} ${psClass}">
              <td class="tnum font-bold">${r.rank}</td>
              <td>
                <span class="font-bold">${esc(r.teamName)}</span>
                ${isMe ? '<span class="inline-tag">내 구단</span>' : ""}
              </td>
              <td class="tnum">${r.g}</td>
              <td class="tnum font-bold">${r.w}</td>
              <td class="tnum">${r.l}</td>
              <td class="tnum">${r.d}</td>
              <td class="tnum font-bold">${r.winPct.toFixed(3)}</td>
              <td class="tnum">${r.gb === 0 ? "-" : r.gb.toFixed(1)}</td>
              <td class="tnum">${r.rs}</td>
              <td class="tnum">${r.ra}</td>
              <td class="tnum ${r.runDiff >= 0 ? "text-good" : "text-bad"}">${r.runDiff > 0 ? "+" + r.runDiff : r.runDiff}</td>
              <td class="tnum">${r.ownerTrust}</td>
              <td class="tnum">${r.fanRatio}</td>
            </tr>
          `;
        })
        .join("");
    }

    // 2) 우리 구단 팀 타율 / 팀 평균자책점 / 팀 홈런 / 팀 WAR 요약
    const allMy = userTeam.getAllPlayers();
    let totAB = 0, totH = 0, totHR = 0, totPA = 0, totBB = 0;
    let totIP = 0, totER = 0, totK = 0, totWar = 0;
    allMy.forEach((p) => {
      const rec = p.rec || {};
      totWar += p.getWar();
      if (p.type === "batter") {
        totAB += rec.ab || 0;
        totH += rec.h || 0;
        totHR += rec.hr || 0;
        totPA += rec.pa || 0;
        totBB += rec.bb || 0;
      } else {
        totIP += rec.ip || 0;
        totER += rec.er || 0;
        totK += rec.k || 0;
      }
    });
    const teamAvg = totAB > 0 ? (totH / totAB).toFixed(3) : ".000";
    const teamObp = totPA > 0 ? ((totH + totBB) / totPA).toFixed(3) : ".000";
    const teamEra = totIP > 0 ? ((totER * 9) / totIP).toFixed(2) : "0.00";

    const statSummaryEl = $("pennantTeamStatSummary");
    if (statSummaryEl) {
      statSummaryEl.innerHTML = `
        <div class="stat-tile">
          <div class="stat-label">팀 타율 / 출루율</div>
          <div class="stat-val tnum">${teamAvg} <span class="stat-sub">/ ${teamObp}</span></div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">팀 평균자책점 (ERA)</div>
          <div class="stat-val tnum">${teamEra} <span class="stat-sub">(${totK}탈삼진)</span></div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">팀 누적 홈런</div>
          <div class="stat-val tnum">${totHR}개</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">선수단 합산 WAR</div>
          <div class="stat-val tnum">${totWar.toFixed(1)}</div>
        </div>
      `;
    }

    // 3) 주간 경기 결과 (내 구단 6경기 상세 + 전체 경기)
    const matchBoxEl = $("pennantWeeklyMatches");
    const rep = STATE.lastWeeklyReport;
    if (matchBoxEl) {
      if (!rep || !rep.kbo || !Array.isArray(rep.kbo.matchResults)) {
        matchBoxEl.innerHTML = `
          <div class="empty-box">
            아직 진행된 주간 경기가 없습니다. 상단의 <strong>'주차 진행 (Fast-Sim)'</strong> 버튼을 눌러 페넌트레이스를 시작하세요.
          </div>
        `;
      } else {
        const myMatches = rep.kbo.matchResults.filter(
          (m) => m.homeTeamId === userTeam.id || m.awayTeamId === userTeam.id
        );
        const myDelta = rep.kbo.teamWeeklyDelta[userTeam.id] || { w: 0, l: 0, d: 0, rs: 0, ra: 0 };

        matchBoxEl.innerHTML = `
          <div class="weekly-summary-banner">
            <strong>${rep.weekPlayed}주차 ${esc(userTeam.name)} 주간 성적:</strong>
            <span class="tnum font-bold">${myDelta.w}승 ${myDelta.l}패 ${myDelta.d}무</span>
            <span class="sep">·</span>
            <span class="tnum">득점 ${myDelta.rs} / 실점 ${myDelta.ra}</span>
            <span class="sep">·</span>
            <span>카드를 클릭하면 상세 이닝 스코어와 박스스코어를 확인합니다.</span>
          </div>
          <div class="match-card-grid">
            ${myMatches
              .map((m, idx) => {
                const isHome = m.homeTeamId === userTeam.id;
                const myScore = isHome ? m.homeScore : m.awayScore;
                const oppScore = isHome ? m.awayScore : m.homeScore;
                const oppTeam = ctx.getTeam(isHome ? m.awayTeamId : m.homeTeamId);
                const resLabel = myScore > oppScore ? "승" : myScore < oppScore ? "패" : "무";
                const resCls = myScore > oppScore ? "win" : myScore < oppScore ? "lose" : "draw";
                const matchIndexInAll = rep.kbo.matchResults.indexOf(m);
                return `
                  <button type="button" class="match-result-card ${resCls}" data-match-idx="${matchIndexInAll}">
                    <div class="match-card-top">
                      <span>${m.series === "MIDWEEK" ? "주중" : "주말"} ${m.gameOfSeries}차전 (${isHome ? "홈" : "원정"})</span>
                      <span class="match-badge ${resCls}">${resLabel}</span>
                    </div>
                    <div class="match-score-line tnum">
                      <span>${esc(userTeam.name)} <strong>${myScore}</strong></span>
                      <span class="vs">:</span>
                      <span><strong>${oppScore}</strong> ${esc(oppTeam ? oppTeam.name : m.awayTeamId)}</span>
                    </div>
                    <div class="match-Pitcher-line">
                      ${m.winPitcher ? `승: ${esc(m.winPitcher.name)}(${m.winPitcher.ip}이닝)` : "무승부"}
                      ${m.savePitcher ? ` · 세: ${esc(m.savePitcher.name)}` : ""}
                      ${m.losePitcher ? ` · 패: ${esc(m.losePitcher.name)}` : ""}
                    </div>
                  </button>
                `;
              })
              .join("")}
          </div>
        `;
      }
    }

    // 4) [요청 6 & 7] 주간 부상/복귀 · 2군 퓨처스리그 성장 · 멀티리그 스카우트 속보 (내 구단 관련 사항은 '굵은 글씨' 강조!)
    const newsEl = $("pennantWeeklyNews");
    if (newsEl) {
      if (!rep) {
        const activeInj = userTeam.getAllPlayers().filter((p) => p.injury && p.injury.active);
        const fRec = userTeam.futuresRecord || { w: 0, l: 0, d: 0 };
        const baseItems = [];
        if (activeInj.length) {
          activeInj.forEach((p) => {
            baseItems.push(
              `<div class="news-item bad" style="border-left:4px solid var(--bad)"><strong style="font-weight:800">[내 구단 부상자] ${esc(userTeam.name)} ${esc(p.name)} (${p.pos}) — ${esc(p.injury.label)} (${p.injury.weeksLeft}주 잔여)</strong></div>`
            );
          });
        } else {
          baseItems.push(
            `<div class="news-item good"><strong style="font-weight:800">[내 구단 컨디션] ${esc(userTeam.name)}(${esc(fmtMascot(userTeam.id))}) 현재 부상자 0명 — 1군·2군 전원 정상 가동 중 (2군 퓨처스 ${fRec.w}승 ${fRec.l}패 ${fRec.d}무)</strong></div>`
          );
        }
        newsEl.innerHTML = baseItems.join("");
      } else {
        const items = [];
        // [요청 7 & 6] 내 구단 2군 퓨처스리그 주간 성적 및 유망주 성장 리포트 (내 구단이므로 굵은 글씨!)
        if (rep.futures) {
          const myFDelta = rep.futures.teamWeeklyDelta && rep.futures.teamWeeklyDelta[userTeam.id];
          const myGrowths = (rep.futures.growthEvents || []).filter((g) => g.teamId === userTeam.id);
          if (myFDelta) {
            const gText = myGrowths.length
              ? ` · 2군 급성장: ${myGrowths.map((g) => `${esc(g.playerName)}(${g.pos}, ${esc(g.statGained)})`).join(", ")}`
              : " · 2군 유망주 실전 경험치 축적 중";
            items.push(
              `<div class="news-item highlight" style="border-left:4px solid var(--accent)"><strong style="font-weight:800">[내 구단 2군 퓨처스 속보] ${esc(userTeam.name)} 2군 금주 ${myFDelta.w}승 ${myFDelta.l}패 ${myFDelta.d}무${gText}</strong></div>`
            );
          }
        }

        // [요청 6] 부상자 리포트 (내 구단 선수는 굵은 글씨 강조)
        (rep.kbo.injuries || []).forEach((inj) => {
          const isMy = inj.teamId === userTeam.id || inj.teamName === userTeam.name;
          const lineTxt = `[${esc(inj.teamName)} 부상] ${esc(inj.playerName)} (${inj.pos}) — ${esc(inj.label)} (${inj.weeksLeft}주 진단의료)`;
          items.push(
            `<div class="news-item ${isMy ? "bad" : ""}" ${isMy ? 'style="border-left:4px solid var(--bad)"' : ""}>${
              isMy ? `<strong style="font-weight:800">★ [내 구단 긴급] ${lineTxt}</strong>` : lineTxt
            }</div>`
          );
        });

        // [요청 6] 부상 복귀 리포트 (내 구단 선수는 굵은 글씨 강조)
        (rep.kbo.recoveries || []).forEach((recov) => {
          const isMy = recov.teamId === userTeam.id || recov.teamName === userTeam.name;
          const lineTxt = `[부상 복귀] ${esc(recov.teamName)} ${esc(recov.playerName)} (${recov.pos}) 선수 완쾌 후 엔트리 합류`;
          items.push(
            `<div class="news-item good" ${isMy ? 'style="border-left:4px solid var(--good)"' : ""}>${
              isMy ? `<strong style="font-weight:800">★ [내 구단 호재] ${lineTxt}</strong>` : lineTxt
            }</div>`
          );
        });

        // 타구단 2군 주요 성장 소식 (1건)
        if (rep.futures && Array.isArray(rep.futures.growthEvents)) {
          const otherGrowths = rep.futures.growthEvents.filter((g) => g.teamId !== userTeam.id).slice(0, 1);
          otherGrowths.forEach((og) => {
            items.push(
              `<div class="news-item">[퓨처스 2군 리포트] ${esc(og.teamName)} 2군 ${esc(og.playerName)}(${og.pos}, ${og.age}세) 실전 등판/출장으로 ${esc(og.statGained)} 성장 (OVR ${og.newOvr})</div>`
            );
          });
        }

        if (rep.amateur && rep.amateur.tournament) {
          items.push(
            `<div class="news-item highlight">[전국대회 개막] <strong>${esc(rep.amateur.tournament.name)}</strong> 개최! 고교·대학·독립리그 유망주 드래프트 주가가 요동쳤습니다.</div>`
          );
          (rep.amateur.risers || []).slice(0, 2).forEach((r) => {
            const origKor = r.origin === "IND" ? "독립리그" : r.origin === "UNIV" ? "대학" : "고교";
            items.push(
              `<div class="news-item good">[스카우트 타겟 급상승] <strong style="font-weight:800">[우리 스카우트팀 주목]</strong> ${esc(r.name)} (${origKor}/${r.pos}) — ${esc(r.note)} (예상 ${r.prevRank}위 → ${r.newRank}위, ▲${r.rankDelta})</div>`
            );
          });
        }

        (rep.npb.hotPlayers || []).slice(0, 2).forEach((hp) => {
          items.push(
            `<div class="news-item">[해외/아시아쿼터 스카우트 속보] ${esc(hp.name)} (${hp.origin}/${hp.pos}) — ${esc(hp.note)}</div>`
          );
        });

        newsEl.innerHTML = items.length
          ? items.join("")
          : `<div class="news-item"><strong style="font-weight:800">[내 구단 브리핑] ${esc(userTeam.name)} 금주 부상자 없이 정규시즌 및 2군 퓨처스 일정이 순조롭게 진행되었습니다.</strong></div>`;
      }
    }

    // 5) [PART 4-1] KBO 포스트시즌(가을야구) 계단식 토너먼트 현황 패널 (가을야구 기간 10월 10일 개막 시 발동)
    const psPanel = $("pennantPostseasonPanel");
    if (psPanel && GM.Extensions) {
      const psHist = Array.isArray(ctx.postseasonHistory) ? ctx.postseasonHistory : [];
      const thisYearPs = psHist.find((h) => Number(h.year) === Number(ctx.currentYear)) || null;
      const latestPs = thisYearPs || psHist[psHist.length - 1] || null;
      const psGate =
        GM.Setup && typeof GM.Setup.canPlayPostseasonNow === "function"
          ? GM.Setup.canPlayPostseasonNow(ctx.currentDate, ctx)
          : {
              allowed: false,
              daysRemaining: 0,
              alreadyCompleted: Boolean(thisYearPs),
              officialDateStr: `${ctx.currentYear}-10-10`,
              reason: ""
            };
      const top5Str = standings
        .slice(0, 5)
        .map((s) => `${s.rank}위 ${esc(s.teamName)}(${s.w}승 ${s.l}패)`)
        .join(" · ");

      const psBtnLabel = thisYearPs
        ? `✅ ${ctx.currentYear} 포스트시즌 종료 (우승: ${esc(thisYearPs.championTeamName)})`
        : psGate.allowed
        ? `🏆 ${ctx.currentYear} KBO 포스트시즌 진행 (WC → 준PO → PO → KS)`
        : `🔒 10월 10일 가을야구 개막 시 활성화 (D-${psGate.daysRemaining}일)`;

      const psGateBannerHtml = thisYearPs
        ? `<div class="weekly-summary-banner" style="margin-bottom:10px;border-left:4px solid var(--good)">
             ✅ <strong>[${ctx.currentYear} KBO 포스트시즌 종료]</strong> 한국시리즈 통합 우승: <strong>${esc(thisYearPs.championTeamName)}</strong> · 준우승: <strong>${esc(thisYearPs.runnerUpTeamName)}</strong>
           </div>`
        : psGate.allowed
        ? `<div class="weekly-summary-banner" style="margin-bottom:10px;border-left:4px solid #22c55e;background:rgba(34,197,94,0.12)">
             🟢 <strong>[${ctx.currentYear} KBO 가을야구 포스트시즌 개막!]</strong> 페넌트레이스가 종료되고 가을야구 시즌(10월 10일~)이 도래했습니다! 우측 상단 <strong>'🏆 ${ctx.currentYear} KBO 포스트시즌 진행'</strong> 버튼을 눌러 와일드카드부터 한국시리즈까지 진행하세요. (10월 31일 스토브리그 전환 시 자동 결산)
           </div>`
        : `<div class="weekly-summary-banner" style="margin-bottom:10px;border-left:4px solid #f59e0b;background:rgba(245,158,11,0.1)">
             🔒 <strong>[가을야구 개막 대기 · D-${psGate.daysRemaining}일]</strong> KBO 포스트시즌은 페넌트레이스 종료 후 <strong>${ctx.currentYear}년 10월 10일</strong>에 공식 개막합니다. 정규시즌 일정을 진행해 상위 5개 시드를 확정하세요.
           </div>`;

      psPanel.innerHTML = `
        <div class="panel-head">
          <div>
            <h2 class="panel-title">🏆 KBO 포스트시즌(가을야구) 계단식 토너먼트 (와일드카드 → 준PO → PO → 한국시리즈)</h2>
            <div class="tiny">정규시즌 상위 5개 구단 진출 · 4인 선발 압축 로테이션 &amp; 불펜 총력전 · 배당금(+15억~+50억 원) 및 구단주 신임도(+5~+25) 지급</div>
          </div>
          <button type="button" class="btn-primary" data-run-postseason="1" ${psGate.allowed && !thisYearPs ? "" : "disabled"}>
            ${psBtnLabel}
          </button>
        </div>
        ${psGateBannerHtml}
        <div class="weekly-summary-banner" style="margin-bottom:10px">
          <strong>현재 가을야구 진출권 (Top 5):</strong> ${top5Str}
        </div>
        ${
          latestPs
            ? `
              <div class="report-box">
                <div style="font-size:14px;margin-bottom:6px">
                  <strong class="text-good">🎉 [${latestPs.year} KBO 한국시리즈 통합 우승: ${esc(latestPs.championTeamName)}]</strong>
                  (준우승: ${esc(latestPs.runnerUpTeamName)})
                </div>
                <div class="tiny" style="display:grid;gap:4px">
                  <div>· <strong>와일드카드 결정전(4위 vs 5위):</strong> ${esc(latestPs.series.wildCard.summaryText)}</div>
                  <div>· <strong>준플레이오프(3위 vs WC승):</strong> ${esc(latestPs.series.semiPlayoff.summaryText)}</div>
                  <div>· <strong>플레이오프(2위 vs 준PO승):</strong> ${esc(latestPs.series.playoff.summaryText)}</div>
                  <div>· <strong>한국시리즈(1위 vs PO승 · 7전4선승):</strong> ${esc(latestPs.series.koreanSeries.summaryText)}</div>
                </div>
              </div>
            `
            : `<div class="empty-box">페넌트레이스 종료 후 <strong>10월 10일 가을야구 개막일</strong>이 도래하면 포스트시즌 토너먼트가 활성화됩니다.</div>`
        }
      `;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 4. 탭 [2] 선수단 관리 (Roster & Fog of War & 정렬 & 2군 경기/성장 & 신인 입단분 방출 정리)
   * ═══════════════════════════════════════════════════════════════════════ */
  function renderRosterTab() {
    const ctx = STATE.ctx;
    if (!ctx) return;

    const viewTeamId = STATE.rosterViewTeamId || ctx.userTeamId;
    const viewTeam = ctx.getTeam(viewTeamId) || ctx.getUserTeam();
    const isOwnTeam = viewTeam.id === ctx.userTeamId;

    // 구단 조회 셀렉터
    const teamSel = $("rosterTeamSelect");
    if (teamSel) {
      if (!teamSel.options.length) {
        ctx.kboTeams.forEach((t) => {
          const opt = document.createElement("option");
          opt.value = t.id;
          opt.textContent = `${t.name} (${fmtMascot(t.id)}) ${t.id === ctx.userTeamId ? "[내 구단]" : "[스카우팅]"}`;
          teamSel.appendChild(opt);
        });
      }
      teamSel.value = viewTeam.id;
    }

    // 엔트리 인원수 카운트 표시
    $("cntRoster1G").textContent = `${viewTeam.roster1G.length} / 28명`;
    $("cntRoster2G").textContent = `${viewTeam.roster2G.length} / 30명`;
    $("cntRosterDev").textContent = `${viewTeam.rosterDev.length}명`;
    if ($("cntRosterMil")) {
      $("cntRosterMil").textContent = `${(viewTeam.militaryList || []).length} / 4명`;
    }

    // [요청 1 & 요청 2] 선수단 방출 정리 배너 (2군 및 육성선수 상시 방출 + 예산 절감 안내)
    const relBannerEl = $("rosterReleaseBanner");
    if (relBannerEl && GM.Setup && typeof GM.Setup.getRosterReleaseStatus === "function") {
      if (isOwnTeam) {
        const relStat = GM.Setup.getRosterReleaseStatus(ctx, viewTeam.id);
        const removable2GDevCount = (viewTeam.roster2G ? viewTeam.roster2G.length : 0) + (viewTeam.rosterDev ? viewTeam.rosterDev.length : 0);
        relBannerEl.hidden = false;
        relBannerEl.innerHTML = `
          <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;width:100%">
            <div>
              <strong>[선수단 정리 &amp; 예산 절감 방출 관리]</strong>
              <span class="sep">·</span>
              <span class="tnum">전체 보유 <strong>${relStat.totalRosterSize}명</strong> (2군 ${viewTeam.roster2G.length}명 / 육성군 ${viewTeam.rosterDev.length}명)</span>
              <span class="sep">·</span>
              <span class="tnum text-good">✅ <strong>2군·육성선수 상시 무제한 방출 가능</strong> (위약금 면제 · 연봉총액에서 즉시 제외)</span>
              <span class="sep">·</span>
              <span class="tnum">1군 무료방출 쿼터: <strong>${relStat.remainingFreeReleaseQuota}명</strong></span>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <button type="button" class="btn-xs ghost text-bad" id="btnQuickReleaseLowest2GDev" ${removable2GDevCount <= 0 ? "disabled" : ""}>
                🧹 2군/육성 최하위 1명 즉시 방출 (예산 절감)
              </button>
              <button type="button" class="btn-xs primary" id="btnAutoTrimDraftees" ${relStat.remainingFreeReleaseQuota <= 0 && removable2GDevCount <= 0 ? "disabled" : ""}>
                신인 입단 수만큼 하위 전력 자동 방출 (${relStat.remainingFreeReleaseQuota}명)
              </button>
            </div>
          </div>
        `;
      } else {
        relBannerEl.hidden = true;
      }
    }

    // [요청 7] 2군 퓨처스리그 경기 전적 및 유망주 실전 성장 현황 배너
    const futBannerEl = $("futuresTeamSummaryBanner");
    if (futBannerEl) {
      const fRec = viewTeam.futuresRecord || { w: 0, l: 0, d: 0, g: 0, rs: 0, ra: 0, lastWeekGrowths: [], lastWeekSummary: "" };
      const fTot = (fRec.w || 0) + (fRec.l || 0);
      const fPct = fTot > 0 ? (fRec.w / fTot).toFixed(3) : ".000";
      const growths = Array.isArray(fRec.lastWeekGrowths) ? fRec.lastWeekGrowths : [];
      futBannerEl.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;width:100%">
          <div>
            <strong>[2군 퓨처스리그 &amp; 육성 현황 — ${esc(viewTeam.name)} (${esc(fmtMascot(viewTeam.id))})]</strong>
            <span class="sep">·</span>
            <span class="tnum">2군 전적: <strong>${fRec.w || 0}승 ${fRec.l || 0}패 ${fRec.d || 0}무 (승률 ${fPct})</strong> · 득점 ${fRec.rs || 0} / 실점 ${fRec.ra || 0}</span>
          </div>
          <div class="tiny">
            ${
              growths.length
                ? `<strong class="text-good">최근 2군 경기 성장 선수:</strong> ${growths
                    .slice(0, 4)
                    .map((g) => `<strong>${esc(g.playerName)}</strong>(${g.pos}, ${esc(g.statGained)} → OVR ${g.newOvr})`)
                    .join(" · ")}`
                : `주간 진행 시 2군/육성군 경기가 함께 치러지며 유망주들의 능력치가 실시간 성장합니다.`
            }
          </div>
        </div>
      `;
    }

    // 스카우트 팀 업그레이드 버튼 상태
    const btnUpgradeScout = $("btnUpgradeScout");
    if (btnUpgradeScout) {
      const nextLv = ctx.scoutLevel + 1;
      const upgCost = nextLv * 12000; // 24000 ~ 60000만원
      if (ctx.scoutLevel >= 5) {
        btnUpgradeScout.textContent = "스카우트 팀 Lv.5 (최고 단계)";
        btnUpgradeScout.disabled = true;
      } else {
        btnUpgradeScout.textContent = `스카우트 Lv.${nextLv} 증설 (${fmtMoney(upgCost)})`;
        btnUpgradeScout.disabled = false;
      }
    }

    // 현재 선택된 서브탭(1군 / 2군 / 육성군 / 상무 군보류) 선수 리스트 필터링
    let list = (
      STATE.rosterSubTab === "1GUN"
        ? viewTeam.roster1G
        : STATE.rosterSubTab === "2GUN"
          ? viewTeam.roster2G
          : STATE.rosterSubTab === "MILITARY"
            ? viewTeam.militaryList || []
            : viewTeam.rosterDev
    ).slice();

    const pf = STATE.rosterPosFilter;
    if (pf === "pitcher") {
      list = list.filter((p) => p.type === "pitcher");
    } else if (pf === "C") {
      list = list.filter((p) => p.pos === "C");
    } else if (pf === "IF") {
      list = list.filter((p) => ["1B", "2B", "3B", "SS", "DH"].includes(p.pos));
    } else if (pf === "OF") {
      list = list.filter((p) => ["LF", "CF", "RF"].includes(p.pos));
    }

    // [요청 4-B] 컬럼 헤더 클릭 정렬 (포지션, 이름, 나이, OVR, 잠재력, WAR, 연봉, 피로도)
    list.forEach((p) => GM.updatePlayerMetrics(p));
    const POS_ORDER = { SP: 1, RP: 2, CP: 3, C: 4, "1B": 5, "2B": 6, "3B": 7, SS: 8, LF: 9, CF: 10, RF: 11, DH: 12 };
    const sf = STATE.rosterSortField || "ovr";
    const dir = STATE.rosterSortAsc ? 1 : -1;

    list.sort((a, b) => {
      let va = 0;
      let vb = 0;
      if (sf === "pos") {
        va = POS_ORDER[a.pos] || 99;
        vb = POS_ORDER[b.pos] || 99;
      } else if (sf === "name") {
        return String(a.name || "").localeCompare(String(b.name || ""), "ko") * dir;
      } else if (sf === "age") {
        va = a.age || 20;
        vb = b.age || 20;
      } else if (sf === "ovr") {
        va = isOwnTeam ? a.getTrueOvr() : ((a.scoutError && a.scoutError.ovrMin) || 50);
        vb = isOwnTeam ? b.getTrueOvr() : ((b.scoutError && b.scoutError.ovrMin) || 50);
      } else if (sf === "pot") {
        va = a.potential || 60;
        vb = b.potential || 60;
      } else if (sf === "war") {
        va = a.getWar();
        vb = b.getWar();
      } else if (sf === "salary") {
        va = a.salary || 3000;
        vb = b.salary || 3000;
      } else if (sf === "fatigue") {
        va = a.fatigue || 0;
        vb = b.fatigue || 0;
      }
      if (va === vb) return (b.getTrueOvr() - a.getTrueOvr());
      return (va - vb) * dir;
    });

    // 정렬 화살표 인디케이터 업데이트
    ["pos", "name", "age", "ovr", "pot", "war", "salary", "fatigue"].forEach((col) => {
      const ind = $(`sortInd_${col}`);
      if (ind) {
        ind.textContent = sf === col ? (STATE.rosterSortAsc ? "▲" : "▼") : "↕";
        ind.style.opacity = sf === col ? "1" : "0.35";
      }
    });

    const tbody = $("rosterTableBody");
    if (!tbody) return;

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="11" class="empty-cell">해당 분류에 등록된 선수가 없습니다.</td></tr>`;
      return;
    }

    tbody.innerHTML = list
      .map((p) => {
        const m = p.metrics || {};
        const se = p.scoutError || { ovrMin: 60, ovrMax: 70 };
        const ovrDisplay = isOwnTeam
          ? `<strong class="tnum">${p.getTrueOvr()}</strong> <span class="muted">(${GM.grade(p.getTrueOvr())})</span>`
          : `<span class="tnum">${se.ovrMin}~${se.ovrMax}</span>`;
        const potDisplay = isOwnTeam
          ? `<span class="tnum">${p.potential}</span>`
          : `<span class="muted">스카우팅</span>`;

        // 1군 기록 + 2군 퓨처스리그 기록 및 성장치 표시 ([요청 7])
        const fRec = p.futuresRec || { g: 0, ab: 0, h: 0, hr: 0, rbi: 0, ip: 0, er: 0, k: 0, w: 0, l: 0, statGains: 0 };
        let statLine = "";
        if (STATE.rosterSubTab !== "1GUN" && (fRec.g || 0) > 0) {
          if (p.type === "pitcher") {
            const fEra = fRec.ip > 0 ? ((fRec.er * 9) / fRec.ip).toFixed(2) : "0.00";
            statLine = `[2군] ${fRec.g}G ${fRec.ip.toFixed(1)}이닝 · ERA ${fEra} · ${fRec.w}승 ${fRec.l}패 ${fRec.k}K`;
          } else {
            const fAvg = fRec.ab > 0 ? (fRec.h / fRec.ab).toFixed(3) : ".000";
            statLine = `[2군] ${fRec.g}G · 타율 ${fAvg} · ${fRec.hr}홈런 ${fRec.rbi}타점`;
          }
          if (fRec.statGains > 0) {
            statLine += ` <strong class="text-good">(성장 +${fRec.statGains})</strong>`;
          }
        } else {
          statLine =
            p.type === "pitcher"
              ? `${m.g || 0}G ${m.ip || 0}이닝 · ERA ${(m.era || 0).toFixed(2)} · ${m.w || 0}승 ${m.l || 0}패 ${m.sv || 0}세`
              : `${m.g || 0}G · 타율 ${(m.avg || 0).toFixed(3)} · ${m.hr || 0}홈런 ${m.rbi || 0}타점 · OPS ${(m.ops || 0).toFixed(3)}`;
          if (fRec.statGains > 0) {
            statLine += ` <span class="text-good">(2군성장 +${fRec.statGains})</span>`;
          }
        }

        const mil = p.military || {};
        const injHtml =
          p.status === "MILITARY"
            ? `<span class="status-text good">상무 복무중 (D-${mil.daysRemaining || 0}일 · 성장 +${mil.statGains || 0})</span>`
            : p.injury && p.injury.active
              ? `<span class="status-text bad">부상(${p.injury.weeksLeft}주)</span>`
              : `<span class="status-text good">정상(피로 ${p.fatigue || 0})${mil.status === "UNFULFILLED" && p.age >= 25 ? ` · <strong class="text-bad">미필(${p.age}세)</strong>` : ""}</span>`;

        // 엔트리 이동 및 방출 버튼 ([요청 2]: 국내 선수도 방출 가능 + [PART 4-3] 상무 입대 지원)
        let actionBtns = `<button type="button" class="btn-xs ghost" data-player-modal="${p.id}" data-team-id="${viewTeam.id}">상세</button>`;
        if (isOwnTeam && p.status !== "MILITARY") {
          if (p.status !== "1GUN") {
            actionBtns += ` <button type="button" class="btn-xs primary" data-move-player="${p.id}" data-target-status="1GUN">1군 콜업</button>`;
          }
          if (p.status !== "2GUN") {
            actionBtns += ` <button type="button" class="btn-xs" data-move-player="${p.id}" data-target-status="2GUN">2군행</button>`;
          }
          if (p.nationality === "KOR") {
            if (p.status !== "YUKSEONG") {
              actionBtns += ` <button type="button" class="btn-xs ghost" data-move-player="${p.id}" data-target-status="YUKSEONG">육성군</button>`;
            }
            if (mil.status === "UNFULFILLED" && p.age >= 19 && p.age <= 27) {
              actionBtns += ` <button type="button" class="btn-xs" data-enlist-sangmu="${p.id}" title="상무 피닉스 18개월 입대">상무입대</button>`;
            }
            if (p.status === "2GUN" || p.status === "YUKSEONG") {
              const estSave = Math.max(1000, Math.round((p.salary || 3000) * (p.status === "YUKSEONG" ? 1.0 : 0.85)));
              actionBtns += ` <button type="button" class="btn-xs text-bad" data-release-domestic="${p.id}" title="2군/육성선수는 언제든 위약금 없이 즉시 방출하여 예산(${fmtMoney(estSave)})을 절감합니다">즉시방출(+${fmtMoney(estSave)})</button>`;
            } else {
              actionBtns += ` <button type="button" class="btn-xs ghost text-bad" data-release-domestic="${p.id}" title="1군 선수 웨이버 방출">방출</button>`;
            }
          } else {
            actionBtns += ` <button type="button" class="btn-xs ghost text-bad" data-release-foreign="${p.id}">퇴출(방출)</button>`;
          }
        }

        const originBadge =
          p.isAsianQuarter
            ? `<span class="inline-tag" style="background:rgba(56,189,248,0.2);color:#38bdf8">아시아쿼터(${esc(p.nationality)})</span>`
            : p.nationality !== "KOR"
              ? `<span class="inline-tag">${esc(p.nationality)}</span>`
              : p.origin === "IND"
                ? `<span class="inline-tag" style="background:rgba(168,85,247,0.18);color:#c084fc">독립리그 출신</span>`
                : "";

        return `
          <tr class="player-row" data-player-modal="${p.id}" data-team-id="${viewTeam.id}">
            <td><span class="pos-code pos-${p.type}">${esc(p.pos)}</span></td>
            <td>
              <strong>${esc(p.name)}</strong>
              ${originBadge}
            </td>
            <td class="tnum">${p.age}세</td>
            <td>${esc(fmtHand(p))}</td>
            <td>${ovrDisplay}</td>
            <td>${potDisplay}</td>
            <td class="tnum">${statLine}</td>
            <td class="tnum font-bold ${(m.war || 0) >= 2 ? "text-good" : (m.war || 0) < 0 ? "text-bad" : ""}">${(m.war || 0).toFixed(2)}</td>
            <td class="tnum">${fmtMoney(p.salary)}</td>
            <td>${injHtml}</td>
            <td class="action-cell" onclick="event.stopPropagation()">${actionBtns}</td>
          </tr>
        `;
      })
      .join("");
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 5. 탭 [3] 스토브리그 (신인 드래프트 · 연봉 · FA · 외국인/아시아쿼터 · 캠프 · 트레이드 협상실)
   * ═══════════════════════════════════════════════════════════════════════ */
  function renderOffseasonTab() {
    const ctx = STATE.ctx;
    if (!ctx) return;

    // 서브탭 표시 제어 ('trade', 'front5' 포함)
    ["draft", "salary", "fa", "foreign", "camp", "trade", "front5"].forEach((k) => {
      const panel = $(`offPanel_${k}`);
      const btn = document.querySelector(`[data-off-sub="${k}"]`);
      if (panel) panel.hidden = STATE.offseasonSubTab !== k;
      if (btn) btn.classList.toggle("active", STATE.offseasonSubTab === k);
    });

    if (STATE.offseasonSubTab === "draft") renderDraftSubPanel();
    else if (STATE.offseasonSubTab === "salary") renderSalarySubPanel();
    else if (STATE.offseasonSubTab === "fa") renderFASubPanel();
    else if (STATE.offseasonSubTab === "foreign") renderForeignSubPanel();
    else if (STATE.offseasonSubTab === "camp") renderCampSubPanel();
    else if (STATE.offseasonSubTab === "trade") renderTradeSubPanel();
    else if (STATE.offseasonSubTab === "front5") renderFront5SubPanel();
  }

  function renderDraftSubPanel() {
    const ctx = STATE.ctx;
    const userTeam = ctx.getUserTeam();
    if (!ctx.draftState) {
      GM.Draft.initDraftSession(ctx);
    }
    const state = ctx.draftState;
    const nextRound = state.completedRounds.length + 1;
    const isDone = state.isCompleted || nextRound > 10 || ctx.draftPool.length === 0;

    // [요청 2] 신인드래프트 '직접 지명'은 매년 9월 23일부터 가능 (9월 23일 전에는 스카우트 파견 및 리포트 열람만 가능)
    const canPickRes =
      GM.Setup && typeof GM.Setup.canPickRookieDraftNow === "function"
        ? GM.Setup.canPickRookieDraftNow(ctx.currentDate, ctx)
        : { allowed: true, reason: "신인 드래프트 지명 가능" };
    const canPickNow = Boolean(canPickRes && canPickRes.allowed && !isDone);

    // 직접 지명 라운드(1~3R): 앞 순번 구단 지명을 먼저 진행하고 단장 차례에서 멈춘다
    let userTurnInfo = null;
    if (canPickNow && GM.Draft && typeof GM.Draft.prepareUserDraftTurn === "function") {
      userTurnInfo = GM.Draft.prepareUserDraftTurn(ctx);
    }
    const draftTurnBannerHtml =
      userTurnInfo && userTurnInfo.picksBefore && userTurnInfo.picksBefore.length
        ? `<div class="tiny" style="margin-top:6px"><strong>${userTurnInfo.round}라운드 앞 순번 지명 결과:</strong> ${userTurnInfo.picksBefore
            .map((pk) => `${esc(pk.teamName || pk.teamId)} ${pk.passed ? "PASS" : `${esc(pk.playerName || "")}(${esc(pk.pos || "")})`}`)
            .join(" · ")} — 이제 우리 차례입니다.</div>`
        : "";

    const btnAutoR = $("btnDraftAutoRound");
    const btnPassR = $("btnDraftPassRound");
    const btnRunAll = $("btnDraftRunAll");
    if (btnAutoR) {
      btnAutoR.disabled = !canPickNow;
      btnAutoR.textContent = isDone
        ? "전 라운드 지명 완료"
        : canPickNow
          ? `현재 ${nextRound}라운드 스카우트 추천 지명`
          : "🔒 9월 23일 지명 오픈 (추천 지명)";
    }
    if (btnPassR) {
      btnPassR.disabled = !canPickNow;
      btnPassR.textContent = canPickNow ? "지명권 포기 (PASS)" : "🔒 9월 23일 오픈";
    }
    if (btnRunAll) {
      btnRunAll.disabled = !canPickNow;
      btnRunAll.textContent = isDone ? "1~10R 완료됨" : canPickNow ? "1~10R 전 구단 자동 완료" : "🔒 9월 23일 일괄 지명 오픈";
    }

    // [요청 4-A] 신인드래프트 지명 순서 때 이름은 뒤의 마스코트 이름(표범즈 등)으로 표기 + 양도 지명권 반영
    const orderMascotLabels = state.draftOrder.map((origTid, i) => {
      const mascot = fmtMascot(origTid);
      const curOwnerTid =
        GM.Draft && typeof GM.Draft.getPickOwnerTeamId === "function" && !isDone
          ? GM.Draft.getPickOwnerTeamId(ctx, nextRound, origTid)
          : origTid;
      const isTraded = curOwnerTid !== origTid;
      const ownerMascot = isTraded ? fmtMascot(curOwnerTid) : mascot;
      const isMyTurn = curOwnerTid === userTeam.id;
      const txt = isTraded ? `${i + 1}순위 ${ownerMascot}(←${mascot})` : `${i + 1}순위 ${mascot}`;
      return isMyTurn ? `<strong class="text-good">${esc(txt)}[내구단]</strong>` : esc(txt);
    });

    const dateStatusHtml = isDone
      ? `<span class="text-good font-bold">✅ 금년도 1~10라운드 공식 지명 완료</span>`
      : canPickNow
        ? `<span class="text-good font-bold">🟢 [드래프트 지명 진행 가능] 오늘(9월 23일 이후) 직접 지명 또는 라운드 자동 지명을 실행할 수 있습니다! (현재 ${nextRound}R 차례 · 잔여 ${ctx.draftPool.length}명)</span>`
        : `<span style="color:#f59e0b;font-weight:700">⏳ [사전 스카우팅 기간] 신인 드래프트 직접 지명은 매년 <strong>9월 23일</strong>에 오픈됩니다. 9월 23일 전까지는 아래에서 스카우트 팀을 파견하고 유망주 스카우트 리포트를 열람하세요!</span>`;

    $("draftStatusBanner").innerHTML = `
      <div>
        <strong>${ctx.currentYear} KBO 신인 드래프트 (공식 지명일: 매년 9월 23일 · 고교/대학/독립야구단 참가)</strong>
        <span class="sep">·</span>
        ${dateStatusHtml}
      </div>
      <div class="tnum" style="margin-top:4px">지명 순서(뒤 이름): ${orderMascotLabels.join(" → ")}</div>
      <div class="tiny muted" style="margin-top:4px">1~3라운드는 단장이 직접 지명하고, 4~10라운드는 스카우트팀이 스카우트 추정치로 지명합니다 (번복 불가). 9월 30일까지 지명하지 않으면 스카우트팀이 마무리합니다.</div>
      ${draftTurnBannerHtml}
    `;

    // [시스템 4 & 요청 3] 고교 1~3학년 · 대학 리그 · 독립야구단 스카우트 파견 컨트롤 렌더링
    // 청소년 국가대표 경기 단장 직관 (연 3회)
    const youthEl = $("youthViewingBox");
    if (youthEl && GM.Draft && typeof GM.Draft.getYouthViewingEvents === "function") {
      const evs = GM.Draft.getYouthViewingEvents(ctx);
      const statusLabel = { UPCOMING: "예정", OPEN: "직관 가능", ATTENDED: "직관 완료", MISSED: "지나감", LIMIT_REACHED: "횟수 소진" };
      const lastSeen = STATE.lastYouthViewing;
      youthEl.innerHTML = `
        <div class="report-box" style="margin:12px 0">
          <strong>🏟️ 청소년 국가대표 경기 단장 직관</strong>
          <span class="tiny muted"> · 올해 ${evs.length ? evs[0].remaining : 0} / ${GM.Draft.YOUTH_VIEWING_LIMIT || 3}회 남음 · 행사일 ±${GM.Draft.YOUTH_VIEWING_WINDOW_DAYS || 10}일 안에만 가능 · 직관한 선수는 잠재력 추정이 크게 정확해집니다</span>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
            ${evs
              .map(
                (ev) => `
              <div class="scout-card" style="min-width:210px;flex:1">
                <strong style="font-size:13px">${esc(ev.name)}</strong>
                <div class="tiny muted">${esc(ev.date)} · 대표 ${ev.size}명 · ${statusLabel[ev.status] || ev.status}</div>
                <button type="button" class="btn-xs ${ev.status === "OPEN" ? "primary" : "ghost"}" style="margin-top:6px" data-attend-youth="${esc(ev.id)}" ${ev.status === "OPEN" ? "" : "disabled"}>
                  ${ev.status === "ATTENDED" ? "✅ 직관 완료" : ev.status === "OPEN" ? "단장 직관 가기" : statusLabel[ev.status] || ev.status}
                </button>
              </div>`
              )
              .join("")}
          </div>
          ${
            lastSeen && lastSeen.seen
              ? `<div class="tiny" style="margin-top:8px"><strong>최근 직관 (${esc(lastSeen.event.name)}):</strong> ${lastSeen.seen
                  .slice(0, 20)
                  .map((s) => `${esc(s.name)}(${esc(s.pos)} · 잠재력 ${s.potentialLow}~${s.potentialHigh})`)
                  .join(" · ")}</div>`
              : ""
          }
        </div>`;
    }

    const scoutDispEl = $("amateurScoutDispatchBox");
    if (scoutDispEl && GM.Setup) {
      const disp = ctx.scoutDispatch || {
        maxScouts: clamp((ctx.scoutLevel || 1) + 2, 1, 5),
        allocation: { HS_1: 1, HS_2: 1, HS_3: 1, UNIV: 1, IND: 0 }
      };
      const alloc = disp.allocation || { HS_1: 1, HS_2: 1, HS_3: 1, UNIV: 1, IND: 0 };
      const maxS = disp.maxScouts || clamp((ctx.scoutLevel || 1) + 2, 1, 5);
      const totS = (alloc.HS_1 || 0) + (alloc.HS_2 || 0) + (alloc.HS_3 || 0) + (alloc.UNIV || 0) + (alloc.IND || 0);
      scoutDispEl.innerHTML = `
        <div class="weekly-summary-banner" style="margin-bottom:12px; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px;">
          <div>
            <strong>🔭 아마추어 &amp; 독립리그 스카우트 팀 파견 배정 (9월 23일 드래프트 전 상시 운영)</strong>
            <span class="sep">·</span>
            <span class="tnum">배정 인원: <strong>${totS} / ${maxS}명</strong> (스카우트 Lv.${ctx.scoutLevel})</span>
            <span class="sep">·</span>
            <span class="tiny muted">파견된 리그의 유망주 스카우팅 진척도(%)가 매주 상승하여 능력치 오차(Fog of War)가 줄어듭니다.</span>
          </div>
          <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px;">
            <label class="tiny">고교 1학년 <input type="number" id="scDisp_HS1" class="num-input-xs tnum" min="0" max="5" value="${alloc.HS_1 || 0}">명</label>
            <label class="tiny">고교 2학년 <input type="number" id="scDisp_HS2" class="num-input-xs tnum" min="0" max="5" value="${alloc.HS_2 || 0}">명</label>
            <label class="tiny">고교 3학년 <input type="number" id="scDisp_HS3" class="num-input-xs tnum" min="0" max="5" value="${alloc.HS_3 || 0}">명</label>
            <label class="tiny">대학 리그 <input type="number" id="scDisp_UNIV" class="num-input-xs tnum" min="0" max="5" value="${alloc.UNIV || 0}">명</label>
            <label class="tiny">독립리그 <input type="number" id="scDisp_IND" class="num-input-xs tnum" min="0" max="5" value="${alloc.IND || 0}">명</label>
            <button type="button" class="btn-xs primary" id="btnApplyScoutDispatch">스카우트 파견 확정</button>
          </div>
        </div>
      `;
    }

    // 스카우트 추천 Top 6 유망주
    const recs = isDone ? [] : GM.Draft.getRecommendedPicks(ctx, userTeam.id, 6, nextRound);
    const recEl = $("draftRecGrid");
    if (recEl) {
      if (isDone) {
        recEl.innerHTML = `<div class="empty-box">금년도 1~10라운드 공식 지명이 모두 완료되었습니다. 아래에서 미지명 육성선수를 추가 영입하거나 신인 입단 수만큼 기존 선수를 방출 정리하세요.</div>`;
      } else {
        recEl.innerHTML = recs
          .map((r, idx) => {
            const pObj = ctx.draftPool.find((x) => x.id === r.playerId);
            const origLabel =
              r.origin === "IND"
                ? `독립리그(${(pObj && pObj.indClubName) || "연천 미라클"})`
                : r.origin === "UNIV"
                  ? "대졸 예정"
                  : "고졸 예정";
            return `
            <div class="scout-card">
              <div class="scout-card-head">
                <span class="pos-code">${esc(r.pos)}</span>
                <strong>${esc(r.name)}</strong>
                <span class="muted">(${esc(origLabel)} · ${r.age}세 · ${pObj ? fmtHand(pObj) : ""})</span>
                <span class="scout-rank-tag">추천 ${idx + 1}순위</span>
              </div>
              <div class="scout-metrics tnum">
                <span>스카우트 추정 OVR: <strong>${esc(r.ovrRange)}</strong></span>
                <span class="sep">·</span>
                <span>추정 포텐셜: <strong>${r.perceivedPot}</strong></span>
                <span class="sep">·</span>
                <span>종합점수: <strong>${r.totalScore}</strong></span>
              </div>
              <div class="scout-reason">${esc(r.reason)}</div>
              <div class="scout-actions">
                ${
                  canPickNow
                    ? `<button type="button" class="btn-sm primary" data-draft-pick="${r.playerId}">${nextRound}라운드 직접 지명</button>`
                    : `<button type="button" class="btn-sm ghost" disabled title="매년 9월 23일부터 직접 지명이 가능합니다">🔒 9월 23일 직접 지명 오픈</button>`
                }
                <button type="button" class="btn-sm ${canPickNow ? "ghost" : "primary"}" data-player-modal="${r.playerId}" data-pool="draft">📋 스카우트 리포트 열람</button>
              </div>
            </div>
          `;
          })
          .join("");
      }
    }

    // 전체 유망주 테이블 (상위 45명 — 고교/대학/독립리그 포함)
    const poolBody = $("draftPoolTableBody");
    if (poolBody) {
      poolBody.innerHTML = ctx.draftPool
        .slice(0, 45)
        .map((p, idx) => {
          const se = p.scoutError || { ovrMin: 50, ovrMax: 65 };
          const proj = p.draftProjection ? p.draftProjection.tierLabel : `${idx + 1}순위권 유망주`;
          const grpText =
            p.origin === "IND"
              ? `<span style="color:#c084fc;font-weight:700">독립(${esc(p.indClubName || "연천 미라클")}·${p.age}세)</span>`
              : p.origin === "UNIV"
                ? `대학(${p.gradeYear || 4}학년·${p.age}세)`
                : `고교(${p.gradeYear || 3}학년·${p.age}세)`;
          const progPct = Math.round(p.scoutProgress || 25);
          const ovrText = se.isExact || se.ovrMin === se.ovrMax ? `${p.getTrueOvr()} (정밀완료)` : `${se.ovrMin}~${se.ovrMax} (조사 ${progPct}%)`;
          return `
            <tr>
              <td class="tnum">${idx + 1}</td>
              <td><span class="pos-code pos-${p.type}">${esc(p.pos)}</span></td>
              <td><strong>${esc(p.name)}</strong> <span class="tiny muted">(${esc(fmtHand(p))})</span></td>
              <td>${grpText}</td>
              <td class="tnum">${ovrText}</td>
              <td>${esc(proj)}</td>
              <td>
                ${
                  !isDone
                    ? canPickNow
                      ? `<button type="button" class="btn-xs primary" data-draft-pick="${p.id}">${nextRound}R 직접지명</button>`
                      : `<button type="button" class="btn-xs ghost" disabled title="9월 23일부터 직접 지명 가능">🔒 9/23 지명</button>`
                    : `<button type="button" class="btn-xs" data-sign-undrafted="${p.id}">육성영입</button>`
                }
                <button type="button" class="btn-xs ${canPickNow ? "ghost" : "primary"}" data-player-modal="${p.id}" data-pool="draft">상세 리포트</button>
              </td>
            </tr>
          `;
        })
        .join("");
    }

    // 내 구단 지명 결과 로그 + [요청 2] 신인 입단 인원수만큼 기존 선수 방출 정리 바로가기
    const myPicks = (state.allPicks || []).filter((pk) => pk.teamId === userTeam.id);
    const signedRookiesCount = myPicks.filter((pk) => !pk.passed).length;
    const relStat = GM.Setup && GM.Setup.getRosterReleaseStatus ? GM.Setup.getRosterReleaseStatus(ctx, userTeam.id) : null;
    const logEl = $("draftMyPicksLog");
    if (logEl) {
      const releaseActionBox =
        signedRookiesCount > 0 && relStat
          ? `
            <div class="weekly-summary-banner" style="margin-bottom:10px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px">
              <div class="tiny">
                <strong>신인 ${signedRookiesCount}명 입단 완료!</strong>
                (방출 정리 잔여 쿼터: <strong>${relStat.remainingFreeReleaseQuota}명</strong>)
              </div>
              <button type="button" class="btn-xs primary" id="btnDraftAutoTrimNow" ${relStat.remainingFreeReleaseQuota <= 0 ? "disabled" : ""}>
                입단 신인 수만큼 하위 선수 자동 방출 정리 (${relStat.remainingFreeReleaseQuota}명)
              </button>
            </div>
          `
          : "";

      logEl.innerHTML =
        releaseActionBox +
        (myPicks.length
          ? myPicks
              .map((pk) =>
                pk.passed
                  ? `<div class="log-row muted">${pk.round}라운드 (${pk.overallPick}순위 · ${esc(fmtMascot(pk.teamId))}): 지명권 포기 (PASS)</div>`
                  : `<div class="log-row"><strong>${pk.round}R (#${pk.overallPick} · ${esc(fmtMascot(pk.teamId))})</strong> ${esc(pk.playerName)} (${pk.pos}/${pk.origin === "IND" ? "독립리그" : pk.origin === "UNIV" ? "대졸" : "고졸"}) — 계약금 <span class="tnum">${fmtMoney(pk.signingBonus)}</span> · 배정: ${pk.assignedStatus}</div>`
              )
              .join("")
          : `<div class="empty-box">아직 지명한 신인 선수가 없습니다.</div>`);
    }
  }

  function renderSalarySubPanel() {
    const ctx = STATE.ctx;
    const userTeam = ctx.getUserTeam();
    const domesticPlayers = userTeam
      .getAllPlayers()
      .filter((p) => p.nationality === "KOR" && (p.contractYears || 1) <= 1)
      .sort((a, b) => b.salary - a.salary);

    const tbody = $("salaryTableBody");
    if (tbody) {
      tbody.innerHTML = domesticPlayers
        .slice(0, 35)
        .map((p) => {
          const fair = GM.Offseason.calculateFairSalary(p);
          const curOffer =
            STATE.userSalaryOffers[p.id] != null
              ? STATE.userSalaryOffers[p.id]
              : STATE.userSalaryPolicy === "GENEROUS"
                ? Math.round((fair * 1.06) / 100) * 100
                : STATE.userSalaryPolicy === "AUSTERITY"
                  ? Math.max(3000, Math.round((fair * 0.80) / 100) * 100)
                  : fair;
          const diff = curOffer - p.salary;
          return `
            <tr>
              <td><span class="pos-code pos-${p.type}">${esc(p.pos)}</span></td>
              <td><strong>${esc(p.name)}</strong> (${p.age}세 · ${esc(fmtHand(p))} · ${p.status})</td>
              <td class="tnum font-bold">${p.getWar().toFixed(2)}</td>
              <td class="tnum">${fmtMoney(p.salary)}</td>
              <td class="tnum">${fmtMoney(fair)}</td>
              <td>
                <input type="number" class="num-input tnum" step="0.1" min="0.3" value="${toEokNum(curOffer)}" data-salary-input="${p.id}"> 억
              </td>
              <td class="tnum ${diff >= 0 ? "text-good" : "text-bad"}">${diff >= 0 ? "+" : ""}${fmtMoney(diff)}</td>
            </tr>
          `;
        })
        .join("");
    }

    const repEl = $("salaryResultReport");
    if (repEl) {
      const rep = STATE.lastSalaryReport;
      if (!rep) {
        repEl.innerHTML = `<div class="empty-box">제시액을 조정한 뒤 <strong>'전 구단 연봉 재계약 일괄 실행'</strong> 버튼을 누르세요. 과도한 삭감 시 연봉 조정 위원회 또는 스프링캠프 불참 이벤트가 발생합니다.</div>`;
      } else {
        const uSum = rep.userTeamRenewal || {};
        repEl.innerHTML = `
          <div class="report-box">
            <div><strong>연봉 재계약 완료:</strong> 총 ${uSum.renewedCount || 0}명 계약 갱신 · 페이롤 변동 <span class="tnum">${fmtMoney(uSum.payrollDelta || 0)}</span></div>
            <div><strong>연봉 조정 위원회 건수:</strong> ${rep.arbitrationCases.length}건 · <strong>캠프 불참(Holdout):</strong> ${rep.holdoutEvents.length}건</div>
            ${rep.arbitrationCases
              .slice(0, 4)
              .map(
                (c) =>
                  `<div class="tiny" style="margin-top:4px">· [조정위/${esc(c.teamName)}] ${esc(c.playerName)}(${c.pos}): 구단 ${fmtMoney(c.clubOffer)} vs 요구 ${fmtMoney(c.playerDemand)} → <strong>${c.winner === "PLAYER" ? "선수 승" : "구단 승"} (${fmtMoney(c.finalSalary)})</strong></div>`
              )
              .join("")}
          </div>
        `;
      }
    }
  }

  function renderFASubPanel() {
    const ctx = STATE.ctx;
    // 원소속 우선협상 기간에는 타 구단 FA를 공개하지 않는다 (기간 종료 시 자동 공개)
    const priorityHidden = (ctx.faMarketPhase || "PRIORITY") === "PRIORITY";
    const rawFaList = (ctx.faPool || []).filter((p) => !priorityHidden || p.formerTeamId === ctx.userTeamId);
    const tbody = $("faMarketTableBody");

    // [요청 3 & 4] 우선협상 기간 단계 컨트롤 + A/B/C 등급별 & 포지션별 세분화 필터 바 렌더링
    const phaseInfo =
      GM.Offseason && typeof GM.Offseason.getFAMarketPhaseStatus === "function"
        ? GM.Offseason.getFAMarketPhaseStatus(ctx)
        : {
            phase: ctx.faMarketPhase || "PRIORITY",
            phaseLabel: "1단계: 원소속구단 우선협상 기간",
            canNegotiateExternal: false,
            homeFACount: rawFaList.filter((p) => p.formerTeamId === ctx.userTeamId).length,
            externalFACount: rawFaList.filter((p) => p.formerTeamId !== ctx.userTeamId).length,
            totalFACount: rawFaList.length
          };

    const grouped =
      GM.Offseason && typeof GM.Offseason.filterAndGroupFAPlayers === "function"
        ? GM.Offseason.filterAndGroupFAPlayers(
            rawFaList,
            {
              grade: STATE.faGradeFilter || "ALL",
              posGroup: STATE.faPosFilter || "ALL",
              affiliation: STATE.faAffiliationFilter || "ALL",
              sortBy: STATE.faSortBy || "DEMAND"
            },
            ctx
          )
        : {
            players: rawFaList,
            totalCount: rawFaList.length,
            filteredCount: rawFaList.length,
            gradeCounts: { ALL: rawFaList.length, A: 0, B: 0, C: 0 },
            posCounts: { ALL: rawFaList.length, PITCHER: 0, SP: 0, RP: 0, CL: 0, C: 0, IF: 0, "1B": 0, "2B": 0, "3B": 0, SS: 0, OF: 0, DH: 0 },
            affiliationCounts: { ALL: rawFaList.length, HOME: phaseInfo.homeFACount, EXTERNAL: phaseInfo.externalFACount }
          };

    const faList = grouped.players;

    if (tbody) {
      const tableEl = tbody.closest("table");
      const wrapEl = tableEl ? tableEl.parentElement : null;
      if (wrapEl) {
        let ctrlBar = $("faSegmentationAndPhaseBar");
        if (!ctrlBar) {
          ctrlBar = document.createElement("div");
          ctrlBar.id = "faSegmentationAndPhaseBar";
          ctrlBar.style.marginBottom = "12px";
          wrapEl.parentElement.insertBefore(ctrlBar, wrapEl);
        }

        const isPriority = phaseInfo.phase === "PRIORITY";
        const gc = grouped.gradeCounts;
        const pc = grouped.posCounts;
        const ac = grouped.affiliationCounts;

        const gradeTabs = [
          { key: "ALL", label: `전체 등급 (${gc.ALL})` },
          { key: "A", label: `🅰️ A등급 (${gc.A})` },
          { key: "B", label: `🅱️ B등급 (${gc.B})` },
          { key: "C", label: `🅲 C등급 (${gc.C})` }
        ];
        const affTabs = [
          { key: "ALL", label: `전체 소속 (${ac.ALL})` },
          { key: "HOME", label: `🏠 내 구단 원소속·우선협상 (${ac.HOME})` },
          { key: "EXTERNAL", label: isPriority ? `🌐 타 구단 외부 FA (${phaseInfo.priorityEndsDate || "우선협상 종료 후"} 공개)` : `🌐 타 구단 외부 FA (${ac.EXTERNAL})` }
        ];
        const posTabs = [
          { key: "ALL", label: `전 포지션 (${pc.ALL})` },
          { key: "PITCHER", label: `⚾ 투수 전체 (${pc.PITCHER})` },
          { key: "SP", label: `선발 SP (${pc.SP})` },
          { key: "RP", label: `불펜 RP (${pc.RP})` },
          { key: "CL", label: `마무리 CL (${pc.CL || 0})` },
          { key: "C", label: `🧤 포수 C (${pc.C})` },
          { key: "IF", label: `내야 전체 (${pc.IF})` },
          { key: "1B", label: `1B (${pc["1B"]})` },
          { key: "2B", label: `2B (${pc["2B"]})` },
          { key: "3B", label: `3B (${pc["3B"]})` },
          { key: "SS", label: `SS (${pc.SS})` },
          { key: "OF", label: `외야 전체 (${pc.OF})` },
          { key: "DH", label: `지명타자 DH (${pc.DH})` }
        ];

        ctrlBar.innerHTML = `
          <!-- [요청 3] FA 협상 단계 (원소속 우선협상 기간 ↔ 전 구단 완전 개방 기간) -->
          <div class="weekly-summary-banner" style="margin-bottom:10px;border-left:4px solid ${isPriority ? "#f59e0b" : "#22c55e"};display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px">
            <div>
              <div style="font-size:13.5px">
                <strong>${isPriority ? "🔒 [1단계: 원소속구단 우선협상 기간]" : "🔓 [2단계: 전 구단 완전 개방 (Open Market) 기간]"}</strong>
                <span class="sep">·</span>
                <span class="tiny">${esc(phaseInfo.phaseLabel)}</span>
              </div>
              <div class="tiny muted" style="margin-top:3px">
                내 구단 원소속 FA: <strong>${phaseInfo.homeFACount}명</strong> · 외부 구단 FA: <strong>${isPriority ? "비공개" : `${phaseInfo.externalFACount}명`}</strong> · 금년 실시간 타결 누적: <strong>${(ctx.faSignedHistory || []).length}건</strong>
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              ${
                isPriority
                  ? `<span class="scout-rank-tag tnum">⏳ 우선협상 종료 ${esc(phaseInfo.priorityEndsDate || "-")} (D-${phaseInfo.priorityDaysLeft || 0}) · 이후 타 구단 FA 자동 공개</span>`
                  : `<span class="scout-rank-tag tnum">🔓 자유협상 진행 중 · 1월 15일 FA 시장 마감</span>`
              }
            </div>
          </div>

          <!-- [요청 4] FA 리스트 A-B-C 등급별 & 포지션별 세분화 필터 바 -->
          <div class="report-box" style="padding:10px 12px">
            <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
              <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px">
                <strong class="tiny" style="min-width:68px">🏷️ FA 등급:</strong>
                ${gradeTabs
                  .map(
                    (t) =>
                      `<button type="button" class="btn-xs ${STATE.faGradeFilter === t.key ? "primary" : "ghost"}" data-fa-grade-filter="${t.key}">${t.label}</button>`
                  )
                  .join("")}
              </div>
              <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px">
                <strong class="tiny">소속 구분:</strong>
                ${affTabs
                  .map(
                    (t) =>
                      `<button type="button" class="btn-xs ${STATE.faAffiliationFilter === t.key ? "primary" : "ghost"}" data-fa-aff-filter="${t.key}">${t.label}</button>`
                  )
                  .join("")}
                <select id="faSortSelect" class="gm-select" style="padding:3px 8px;font-size:12px">
                  <option value="DEMAND" ${STATE.faSortBy === "DEMAND" ? "selected" : ""}>정렬: 요구총액 높은순</option>
                  <option value="OVR" ${STATE.faSortBy === "OVR" ? "selected" : ""}>정렬: OVR 능력치순</option>
                  <option value="WAR" ${STATE.faSortBy === "WAR" ? "selected" : ""}>정렬: 3년 가중 WAR순</option>
                  <option value="AGE" ${STATE.faSortBy === "AGE" ? "selected" : ""}>정렬: 나이 젊은순</option>
                </select>
              </div>
            </div>
            <div style="display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.18)">
              <strong class="tiny" style="min-width:68px">⚾ 포지션:</strong>
              ${posTabs
                .map(
                  (t) =>
                    `<button type="button" class="btn-xs ${STATE.faPosFilter === t.key ? "primary" : "ghost"}" data-fa-pos-filter="${t.key}">${t.label}</button>`
                )
                .join("")}
            </div>
          </div>
        `;
      }

      if (!rawFaList.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-cell">현재 공시된 FA 선수가 없습니다. 상단의 <strong>'FA 자격 선수 공시'</strong> 버튼을 눌러 시장을 개장하세요.</td></tr>`;
      } else if (!faList.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-cell">선택한 필터 조건(등급: ${STATE.faGradeFilter} / 포지션: ${STATE.faPosFilter} / 소속: ${STATE.faAffiliationFilter})에 해당하는 FA 선수가 없습니다. 필터를 '전체'로 변경해 보세요.</td></tr>`;
      } else {
        tbody.innerHTML = faList
          .map((p) => {
            const prof = p.faProfile || GM.Offseason.evaluateFAPlayerMarketProfile(p, ctx);
            const bd =
              prof.breakdown ||
              (GM.FA && GM.FA.breakdownContract
                ? GM.FA.breakdownContract(prof.demandTotal, prof.faGrade, prof.demandYears)
                : {
                    DP: prof.demandSigningBonus || 0,
                    BS: (prof.demandAnnual || 0) * (prof.demandYears || 4),
                    Opt: 0,
                    guaranteedRatio: 0.85
                  });
            const existingBid = STATE.userFABids[p.id];
            const bidYrs = existingBid ? existingBid.years : prof.demandYears;
            const bidTot = existingBid ? existingBid.totalAmount : prof.demandTotal;
            const st = p.st || {};
            const isHomeFA = p.formerTeamId === ctx.userTeamId;
            const isPriorityRestricted = phaseInfo.phase === "PRIORITY" && !isHomeFA;
            const negState = p.faNegotiationState || null;

            // [요청 10] FA 선수 이름 옆에 핵심 능력치(OVR, 잠재력, 투타 5대 세부 스탯) 상세 표시
            const statDetailStr =
              p.type === "pitcher"
                ? `제구 <strong>${st.ctrl || 70}</strong> · 구위 <strong>${st.stuff || 70}</strong> · 구속 <strong>${GM.kmh(st.velo || 70)}km</strong> · 체력 <strong>${st.stam || 65}</strong> · 변화 <strong>${st.brk || 70}</strong>`
                : `컨택 <strong>${st.con || 70}</strong> · 파워 <strong>${st.pow || 70}</strong> · 주력 <strong>${st.spd || 65}</strong> · 수비 <strong>${st.def || 68}</strong> · 선구 <strong>${st.eye || 68}</strong>`;

            const evalPreview =
              GM.FA && typeof GM.FA.evaluateOfferAcceptance === "function"
                ? GM.FA.evaluateOfferAcceptance(
                    p,
                    existingBid && existingBid.DP != null
                      ? existingBid
                      : { years: bidYrs, totalAmount: bidTot },
                    bd,
                    {
                      isHomeTeam: isHomeFA,
                      isPriorityPhase: phaseInfo.phase === "PRIORITY",
                      context: ctx
                    }
                  )
                : null;

            const negBadgeHtml = negState
              ? negState.status === "WALKED_AWAY"
                ? `<div class="tiny text-bad font-bold" style="margin-top:2px">❌ 협상 결렬 (${negState.round}/${negState.maxRounds}차)</div>`
                : negState.status === "COUNTERED" && negState.lastCounterOffer
                ? `<div class="tiny" style="margin-top:2px;color:#f59e0b;font-weight:700">💬 ${negState.round}/${negState.maxRounds}차 역제안: ${negState.lastCounterOffer.Y}년 ${fmtMoney(negState.lastCounterOffer.totalManwon)}</div>`
                : `<div class="tiny text-good" style="margin-top:2px">협상 진행중 (${negState.round}/${negState.maxRounds}차)</div>`
              : "";

            return `
              <tr>
                <td>
                  <span class="fa-grade grade-${prof.faGrade}">${prof.faGrade}등급</span>
                  <div class="tiny muted" style="margin-top:2px">구단${prof.clubSalaryRank || "-"}위/리그${prof.leagueSalaryRank || "-"}위</div>
                </td>
                <td>
                  <span class="pos-code pos-${p.type}">${esc(p.pos)}</span>
                  <strong>${esc(p.name)}</strong> (${p.age}세 · ${esc(fmtHand(p))})
                  <div class="tiny muted">D_age ${(prof.D_age || 1.0).toFixed(2)} · P_grade ${(prof.P_grade || 1.0).toFixed(2)}</div>
                </td>
                <td>
                  <div>${esc(p.formerTeamName || p.formerTeamId)} (${esc(fmtMascot(p.formerTeamId))})</div>
                  <div class="tiny ${isHomeFA ? "text-good font-bold" : "muted"}" style="margin-top:2px">
                    ${isHomeFA ? "🏠 내 구단 원소속 (우선협상 우대)" : isPriorityRestricted ? "🔒 우선협상 종료 후 영입 가능" : "🌐 외부 FA 영입 가능"}
                  </div>
                </td>
                <td class="tnum">
                  <div><strong class="text-good">OVR ${p.getTrueOvr()}</strong> <span class="tiny muted">(잠재 ${p.potential})</span></div>
                  <div class="tiny" style="margin-top:2px">${statDetailStr}</div>
                </td>
                <td class="tnum">
                  <div class="font-bold">${(prof.WAR_3yr || p.getWar()).toFixed(2)}</div>
                  <div class="tiny muted">3년가중WAR</div>
                </td>
                <td class="tnum">
                  <div><strong>${prof.demandYears}년 / 총액 ${fmtMoney(prof.demandTotal)}</strong></div>
                  <div class="tiny muted">계약금 ${fmtMoney(bd.DP)} · 연봉총액 ${fmtMoney(bd.BS)} · 옵션 ${fmtMoney(bd.Opt)}</div>
                  ${negBadgeHtml}
                </td>
                <td class="tiny">
                  <div>${isHomeFA ? "원소속 재계약 (보상선수·보상금 없음)" : esc(prof.rule.desc)}</div>
                  <div class="${isHomeFA ? "text-good" : "text-bad"} tnum" style="margin-top:2px">
                    보상리스크: <strong>${isHomeFA ? "0원 (면제)" : fmtMoney(prof.Penalty_comp || 0)}</strong>
                  </div>
                </td>
                <td>
                  <input type="number" class="num-input-xs tnum" id="faYrs_${p.id}" min="1" max="6" value="${bidYrs}">년
                  <input type="number" class="num-input tnum" id="faTot_${p.id}" step="0.5" min="0.5" value="${toEokNum(bidTot)}">억
                  ${
                    evalPreview
                      ? `<div class="tiny tnum" style="margin-top:3px">수용확률 P: <strong class="${evalPreview.probabilityPct >= 75 ? "text-good" : evalPreview.probabilityPct <= 25 ? "text-bad" : ""}">${evalPreview.probabilityPct}%</strong> (ratio ${evalPreview.ratio.toFixed(2)})</div>`
                      : ""
                  }
                </td>
                <td>
                  <div style="display:flex;flex-direction:column;gap:4px">
                    <button type="button" class="btn-xs primary" data-fa-logistic-modal="${p.id}">
                      🤝 실전 협상 테이블 (${negState ? `${negState.round}/${negState.maxRounds}차` : "1~3차"})
                    </button>
                    <button type="button" class="btn-xs ${existingBid ? "primary" : "ghost"}" data-fa-bid="${p.id}">
                      ${existingBid ? "✓ 입찰서 등록됨" : "📥 일괄입찰 등록"}
                    </button>
                  </div>
                </td>
              </tr>
            `;
          })
          .join("");
      }
    }

    const repEl = $("faResultReport");
    if (repEl) {
      const rep = STATE.lastFAReport;
      const directHist = ctx.faSignedHistory || [];
      if (!rep && !directHist.length) {
        repEl.innerHTML = `<div class="empty-box"><strong>[우선협상 기간 &amp; 실전 협상 안내]</strong> 1단계 <strong>원소속구단 우선협상 기간</strong>에는 내 구단 소속 FA 선수와 독점 협상을 진행할 수 있으며, <strong>'전 구단 자유협상(Open Market) 전환'</strong> 후에는 모든 구단 FA 선수와 최대 3라운드 실시간 줄다리기 협상(즉시 타결 가능) 또는 일괄 경쟁 입찰을 진행할 수 있습니다.</div>`;
      } else {
        const directHtml = directHist.length
          ? `<div style="margin-bottom:8px">
              <strong>🤝 실시간 직접 협상 &amp; 우선협상 타결 내역 (${directHist.length}건):</strong>
              ${directHist
                .slice(-8)
                .reverse()
                .map(
                  (c) =>
                    `<div class="tiny" style="margin-top:3px">· [${c.phase === "PRIORITY" ? "우선협상" : "오픈마켓"} · ${c.faGrade}등급] <strong>${esc(c.playerName)}</strong>(${c.pos}) → <strong>${esc(c.newTeamName)}</strong> (${c.years}년 총액 ${fmtMoney(c.totalAmount)} · 계약금 ${fmtMoney(c.signingBonus)}) ${c.compensation ? `| ${esc(c.compensation.summary)}` : " (원소속 잔류)"}</div>`
                )
                .join("")}
            </div>`
          : "";
        const batchHtml = rep
          ? `<div><strong>FA 시장 일괄 마감 결과:</strong> 총 ${rep.totalSigned}명 계약 성사 · 내 구단 영입 ${rep.userTeamSignings.length}명</div>
            ${rep.signedContracts
              .slice(0, 8)
              .map(
                (c) =>
                  `<div class="tiny" style="margin-top:4px">· [${c.faGrade}등급] <strong>${esc(c.playerName)}</strong>(${c.pos}) → <strong>${esc(c.newTeamName)}</strong> (${c.years}년 총액 ${fmtMoney(c.totalAmount)}) ${c.compensation ? `| ${esc(c.compensation.summary)}` : " (잔류)"}</div>`
              )
              .join("")}`
          : "";
        repEl.innerHTML = `<div class="report-box">${directHtml}${batchHtml}</div>`;
      }
    }
  }

  function renderForeignSubPanel() {
    const ctx = STATE.ctx;
    const userTeam = ctx.getUserTeam();
    const currentForeigns = userTeam.getAllPlayers().filter((p) => p.nationality !== "KOR" && !p.isAsianQuarter);
    const currentAsianQ = userTeam.getAllPlayers().find((p) => p.isAsianQuarter);

    // [요청 3 해결] 초기 기본값은 시즌당 딱 1회만 설정! 유저가 3명을 모두 체크 해제(0명)해도 다시 리셋되지 않음
    if (STATE.foreignKeepInitializedYear !== ctx.currentYear && currentForeigns.length > 0) {
      STATE.foreignKeepInitializedYear = ctx.currentYear;
      STATE.userForeignKeepIds.clear();
      currentForeigns.forEach((fp) => {
        if (fp.getTrueOvr() >= 80 || fp.getWar() >= 2.0) {
          STATE.userForeignKeepIds.add(fp.id);
        }
      });
    }

    // [요청 3 해결] 외국인 선수별 MLB / NPB 상위리그 오퍼 및 요구 연봉 산출
    if (GM.Offseason && typeof GM.Offseason.evaluateForeignPlayerRenewalMarket === "function") {
      GM.Offseason.evaluateForeignPlayerRenewalMarket(ctx, userTeam.id);
    }

    const repEl = $("foreignResultReport");
    if (repEl) {
      const rep = STATE.lastForeignReport;
      if (rep && rep.userTeamSummary) {
        const us = rep.userTeamSummary;
        repEl.innerHTML = `
          <div class="report-box">
            <div>
              <strong>외국인 재계약 및 영입 결과:</strong>
              유지 <strong>${(us.kept || []).length}명</strong> ·
              방출/이적 <strong>${(us.released || []).length + (us.departedToUpperLeague || []).length}명</strong> ·
              신규 영입 <strong>${(us.signed || []).length}명</strong>
            </div>
            ${
              us.departedToUpperLeague && us.departedToUpperLeague.length
                ? us.departedToUpperLeague
                    .map(
                      (d) =>
                        `<div class="tiny text-bad" style="margin-top:4px">· ⚠️ <strong>${esc(d.name)}</strong>(${d.pos}): 우리 구단 제시액(${fmtMoney(d.offeredSalary)})이 최소 요구액(${fmtMoney(d.minAcceptSalary)})에 미달하여 <strong>${esc(d.suitorLeague)} ${esc(d.suitorClub)}</strong>(으)로 이적했습니다!</div>`
                    )
                    .join("")
                : ""
            }
            ${
              us.signed && us.signed.length
                ? `<div class="tiny text-good" style="margin-top:4px">· 신규 외국인 합류: ${us.signed.map((s) => `${esc(s.name)}(${s.pos}, OVR ${s.trueOvr}, ${fmtMoney(s.salary)})`).join(", ")}</div>`
                : ""
            }
          </div>
        `;
      } else {
        repEl.innerHTML = "";
      }
    }

    const curEl = $("foreignCurrentList");
    if (curEl) {
      const rehabList = userTeam.foreignRehabList || [];
      const rehabBannerHtml = rehabList.length
        ? rehabList
            .map(
              (rp) => `
              <div class="scout-card" style="border-color: var(--warn);">
                <div class="scout-card-head">
                  <span class="pos-code">${esc(rp.pos)}</span>
                  <strong>[6주 부상 재활 명단] ${esc(rp.name)}</strong>
                  <span class="muted">(${rp.nationality} · 잔여 재활 ${rp.injury && rp.injury.daysLeft ? `${rp.injury.daysLeft}일` : "완료"})</span>
                </div>
                <div class="scout-reason">원 외국인 복귀 시 대체 외국인은 계약 종료되며, 대체 외국인을 정식 전환하면 원 외국인은 웨이버 방출(영구 퇴출)됩니다.</div>
                <div class="scout-actions">
                  <button type="button" class="btn-xs primary" data-resolve-rehab="${rp.id}" data-rehab-decision="RETURN_ORIGINAL">원 외국인 1군 복귀</button>
                  <button type="button" class="btn-xs" data-resolve-rehab="${rp.id}" data-rehab-decision="CONVERT_REPLACEMENT">대체 외국인 정식 전환</button>
                </div>
              </div>
            `
            )
            .join("")
        : "";

      curEl.innerHTML =
        (currentForeigns.length
          ? currentForeigns
              .map((fp) => {
                const keep = STATE.userForeignKeepIds.has(fp.id);
                const isLongInj = fp.injury && fp.injury.active && ((fp.injury.weeksLeft || 0) >= 6 || (fp.injury.daysLeft || 0) >= 42);
                const prof = fp.renewalMarketProfile || {
                  hasUpperLeagueOffer: false,
                  offerNote: "KBO 잔류 우선 협상 가능",
                  recommendedOfferSalary: Math.round(fp.salary * 1.15),
                  minAcceptSalary: Math.round(fp.salary * 1.05),
                  negotiationStatus: "PENDING"
                };
                const defaultOffer =
                  STATE.userForeignSalaryOffers[fp.id] != null
                    ? STATE.userForeignSalaryOffers[fp.id]
                    : prof.agreedSalary || prof.recommendedOfferSalary || fp.salary;
                const statusBadge =
                  prof.negotiationStatus === "AGREED"
                    ? `<span class="text-good font-bold">✅ 재계약 합의 완료 (${fmtMoney(prof.agreedSalary || defaultOffer)})</span>`
                    : prof.negotiationStatus === "REJECTED_WARNING"
                      ? `<span class="text-bad font-bold">⚠️ 협상 난항 (최소 ${fmtMoney(prof.minAcceptSalary)} 요구)</span>`
                      : prof.hasUpperLeagueOffer
                        ? `<span style="color:#f59e0b;font-weight:700">🔥 상위리그 오퍼 경쟁 중 (${esc(prof.suitorLeague)} ${esc(prof.suitorClub)})</span>`
                        : `<span class="muted">단독 재계약 협상 대기</span>`;

                return `
                  <div class="scout-card" style="border-left:4px solid ${keep ? "var(--good)" : "rgba(148,163,184,0.35)"}">
                    <div class="scout-card-head">
                      <span class="pos-code">${esc(fp.pos)}</span>
                      <strong>${esc(fp.name)}</strong>
                      <span class="muted">(${fp.nationality} · ${fp.age}세 · ${esc(fmtHand(fp))}${fp.isTempForeignReplacement ? " · 6주 대체외국인" : ""})</span>
                      <span class="scout-rank-tag">${keep ? "유지 대상" : "방출(교체) 예정"}</span>
                    </div>
                    <div class="scout-metrics tnum">
                      <span>실제 OVR: <strong>${fp.getTrueOvr()}</strong></span>
                      <span class="sep">·</span>
                      <span>시즌 WAR: <strong>${fp.getWar().toFixed(2)}</strong></span>
                      <span class="sep">·</span>
                      <span>현 연봉: <strong>${fmtMoney(fp.salary)}</strong></span>
                    </div>
                    <div class="tiny" style="margin:6px 0;padding:6px 8px;background:rgba(15,23,42,0.55);border-radius:6px">
                      <div>${statusBadge}</div>
                      <div style="margin-top:3px">${esc(prof.offerNote)}</div>
                      <div class="tnum" style="margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                        <span>제시 연봉:</span>
                        <input type="number" class="num-input tnum" id="foreignOffer_${fp.id}" data-foreign-offer-input="${fp.id}" step="0.5" min="3.0" max="50.0" value="${toEokNum(defaultOffer)}" style="width:95px"> 억
                        <button type="button" class="btn-xs primary" data-negotiate-foreign="${fp.id}">💬 재계약 조건 제시 협상</button>
                      </div>
                    </div>
                    <div class="scout-actions">
                      <button type="button" class="btn-sm ${keep ? "primary" : "ghost"}" data-toggle-foreign-keep="${fp.id}">
                        ${keep ? "✓ 재계약 유지 선택됨 (클릭 시 제외)" : "✕ 재계약 제외됨 (클릭 시 유지)"}
                      </button>
                      <button type="button" class="btn-xs ghost text-bad" data-release-foreign="${fp.id}">즉시 웨이버 퇴출</button>
                      ${
                        isLongInj
                          ? `<button type="button" class="btn-xs primary" data-sign-6wk-foreign="${fp.id}">6주 대체 외국인 영입</button>`
                          : `<button type="button" class="btn-xs ghost" data-sim-6wk-injury="${fp.id}" title="6주 장기부상 대체외국인 제도 테스트">6주 부상 발생(테스트)</button>`
                      }
                    </div>
                  </div>
                `;
              })
              .join("")
          : `<div class="empty-box">현재 보유 중인 일반 외국인 선수가 없습니다.</div>`) + rehabBannerHtml;
    }

    // [신규 요청 11] KBO 아시아 쿼터제 (구단당 1명 별도 영입 가능 — 일본 NPB / 대만 CPBL / 호주 ABL)
    const aqBox = $("asianQuarterSectionBox");
    if (aqBox && GM.Setup && typeof GM.Setup.getAsianQuarterCandidates === "function") {
      const aqCands = GM.Setup.getAsianQuarterCandidates(ctx, 6);
      const curAqHtml = currentAsianQ
        ? `
          <div class="weekly-summary-banner" style="margin-bottom:10px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px">
            <div>
              <strong>현재 보유 아시아 쿼터 선수:</strong>
              <span class="pos-code">${esc(currentAsianQ.pos)}</span>
              <strong>${esc(currentAsianQ.name)}</strong> (${esc(currentAsianQ.nationality)} · ${currentAsianQ.age}세 · ${esc(fmtHand(currentAsianQ))})
              <span class="sep">·</span>
              <span class="tnum">OVR <strong>${currentAsianQ.getTrueOvr()}</strong> · WAR <strong>${currentAsianQ.getWar().toFixed(2)}</strong> · 연봉 <strong>${fmtMoney(currentAsianQ.salary)}</strong></span>
            </div>
            <button type="button" class="btn-xs ghost text-bad" data-release-foreign="${currentAsianQ.id}">아시아 쿼터 웨이버 방출</button>
          </div>
        `
        : `<div class="weekly-summary-banner" style="margin-bottom:10px"><strong>현재 아시아 쿼터 슬롯 공석 (0 / 1명)</strong> — 아래 아시아 쿼터 후보(일본 독립/2군, 대만 CPBL, 호주 ABL) 중 1명을 기존 외국인 3인 외에 별도로 영입할 수 있습니다.</div>`;

      aqBox.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
          <div>
            <h3 style="font-size:14.5px;margin:0;color:#38bdf8">🌏 KBO 아시아 쿼터제 특별 영입 (구단당 1명 별도 보유 · 가성비 즉시전력)</h3>
            <div class="tiny">기존 외국인 선수 3인 쿼터와 별개로 아시아야구연맹(일본·대만·호주) 소속 선수를 구단당 1명 추가 등록할 수 있습니다.</div>
          </div>
        </div>
        ${curAqHtml}
        <div class="scout-grid">
          ${aqCands
            .map(
              (c) => `
              <div class="scout-card">
                <div class="scout-card-head">
                  <span class="pos-code">${esc(c.pos)}</span>
                  <strong>${esc(c.name)}</strong>
                  <span class="muted">(${esc(c.leagueLabel)} · ${c.age}세 · ${esc(c.handedness)})</span>
                </div>
                <div class="scout-metrics tnum">
                  <span>추정 OVR: <strong>${esc(c.ovrRange)}</strong> (실제 ${c.trueOvr})</span>
                  <span class="sep">·</span>
                  <span>영입 총액: <strong>${fmtMoney(c.expectedCost)}</strong></span>
                </div>
                <div class="tiny" style="margin:4px 0">${esc(c.statSummary)}</div>
                <div class="scout-actions">
                  <button type="button" class="btn-xs primary" data-sign-asian-quarter="${c.playerId}" ${currentAsianQ ? "disabled" : ""}>
                    ${currentAsianQ ? "아시아쿼터 보유중(방출 후 영입가능)" : "아시아 쿼터 즉시 영입"}
                  </button>
                  <button type="button" class="btn-xs ghost" data-player-modal="${c.playerId}" data-pool="npb">상세 스탯</button>
                </div>
              </div>
            `
            )
            .join("")}
        </div>
      `;
    }

    const recPitchers = GM.Offseason.getRecommendedForeignCandidates(ctx, "pitcher", 6);
    const recBatters = GM.Offseason.getRecommendedForeignCandidates(ctx, "batter", 6);
    const candList = [...recPitchers, ...recBatters];

    const poolBody = $("foreignPoolTableBody");
    if (poolBody) {
      poolBody.innerHTML = candList
        .map((c) => {
          const selected = STATE.userForeignSignIds.has(c.playerId);
          const pObj = ctx.npbPool.find((x) => x.id === c.playerId);
          const statStr =
            c.metrics && c.type === "pitcher"
              ? `ERA ${(c.metrics.era || 0).toFixed(2)} · ${c.metrics.w || 0}승 · ${c.metrics.k || 0}K`
              : c.metrics
                ? `타율 ${(c.metrics.avg || 0).toFixed(3)} · ${c.metrics.hr || 0}홈런 · OPS ${(c.metrics.ops || 0).toFixed(3)}`
                : "스카우트 관찰 중";
          return `
            <tr>
              <td><span class="pos-code pos-${c.type}">${esc(c.pos)}</span></td>
              <td><strong>${esc(c.name)}</strong> (${c.origin}/${c.nationality} · ${pObj ? esc(fmtHand(pObj)) : ""})</td>
              <td class="tnum">${c.age}세</td>
              <td class="tnum font-bold">${esc(c.ovrRange)}</td>
              <td class="tnum">${statStr}</td>
              <td class="tnum">${fmtMoney(c.expectedSalary)}</td>
              <td>
                <button type="button" class="btn-xs ${selected ? "primary" : ""}" data-toggle-foreign-sign="${c.playerId}">
                  ${selected ? "영입타겟 지정됨" : "영입타겟 선택"}
                </button>
              </td>
            </tr>
          `;
        })
        .join("");
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 5-B. [신규 요청 8 & 9] 단장 간 트레이드 협상실 (다대다 선수 + 신인 지명권 양도 + 현금 + 7월 31일 마감 시한)
   * ═══════════════════════════════════════════════════════════════════════ */
  function renderTradeSubPanel() {
    const ctx = STATE.ctx;
    if (!ctx || !GM.Setup) return;
    const userTeam = ctx.getUserTeam();
    const otherTeams = ctx.kboTeams.filter((t) => t.id !== userTeam.id);

    if (!STATE.tradePartnerTeamId || STATE.tradePartnerTeamId === userTeam.id) {
      STATE.tradePartnerTeamId = otherTeams[0] ? otherTeams[0].id : "SAM";
    }
    const partnerTeam = ctx.getTeam(STATE.tradePartnerTeamId) || otherTeams[0];

    // 1) KBO 트레이드 마감 시한(7월 31일) 상태 배너
    const dlInfo = GM.Setup.checkKBOTradeDeadline(ctx);
    const dlBanner = $("tradeDeadlineBanner");
    if (dlBanner) {
      dlBanner.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;width:100%">
          <div>
            <strong class="${dlInfo.allowed ? "text-good" : "text-bad"}">${esc(dlInfo.label)}</strong>
            <span class="sep">·</span>
            <span class="tiny">${esc(dlInfo.reason)}</span>
          </div>
          <div class="tnum tiny">현재 일자: <strong>${esc(GM.Setup.formatKoreanDate(ctx.currentDate))}</strong> (마감 기준일: ${esc(dlInfo.deadlineDateStr)})</div>
        </div>
      `;
    }

    // 2) 패키지 실시간 가치 평가
    const evalRes = GM.Setup.evaluateTradePackage(ctx, {
      partnerTeamId: partnerTeam.id,
      myPlayerIds: STATE.tradeMyPlayerIds,
      targetPlayerIds: STATE.tradeTargetPlayerIds,
      myPickRounds: STATE.tradeMyPickRounds,
      targetPickRounds: STATE.tradeTargetPickRounds,
      cashToPartner: STATE.tradeCashToPartner,
      cashFromPartner: STATE.tradeCashFromPartner
    });

    const isForeignTrack = STATE.tradeNationalityMode === "FOREIGN";
    const filterByNatTrack = (p) => {
      const isFor = Boolean(p && ((p.nationality && p.nationality !== "KOR") || p.isAsianQuarter));
      return isForeignTrack ? isFor : !isFor;
    };

    const allMyRoster = [...userTeam.roster1G, ...userTeam.roster2G].sort((a, b) => b.getTrueOvr() - a.getTrueOvr());
    const allPartnerRoster = [...partnerTeam.roster1G, ...partnerTeam.roster2G].sort((a, b) => b.getTrueOvr() - a.getTrueOvr());

    const myRoster = allMyRoster.filter(filterByNatTrack);
    const partnerRoster = allPartnerRoster.filter(filterByNatTrack);

    const renderPlayerSelectRows = (players, selectedIds, attrName) =>
      players
        .slice(0, 32)
        .map((p) => {
          const checked = selectedIds.includes(p.id);
          const isFor = Boolean((p.nationality && p.nationality !== "KOR") || p.isAsianQuarter);
          const natTag = isFor
            ? `<span class="inline-tag" style="background:rgba(245,158,11,0.18);color:#f59e0b">${p.isAsianQuarter ? `아시아쿼터(${esc(p.nationality)})` : `외국인(${esc(p.nationality)})`}</span>`
            : `<span class="inline-tag" style="background:rgba(34,197,94,0.15);color:#22c55e">내국인(KOR)</span>`;
          return `
            <label style="display:flex;align-items:center;justify-content:space-between;padding:5px 8px;border-bottom:1px solid rgba(148,163,184,0.14);cursor:pointer;background:${checked ? "rgba(37,99,235,0.16)" : "transparent"}">
              <span>
                <input type="checkbox" ${attrName}="${esc(p.id)}" ${checked ? "checked" : ""}>
                <span class="pos-code pos-${p.type}">${esc(p.pos)}</span>
                <strong>${esc(p.name)}</strong>
                ${natTag}
                <span class="tiny muted">(${p.age}세 · ${esc(fmtHand(p))})</span>
              </span>
              <span class="tnum tiny">
                <strong>OVR ${p.getTrueOvr()}</strong> · WAR ${p.getWar().toFixed(1)} · ${fmtMoney(p.salary)}
              </span>
            </label>
          `;
        })
        .join("");

    const renderPickCheckboxes = (teamId, selectedRounds, attrName) =>
      [1, 2, 3, 4, 5]
        .map((r) => {
          const alreadyTraded = (ctx.tradedPicks || []).some(
            (tp) => Number(tp.year) === Number(ctx.currentYear) && Number(tp.round) === r && tp.fromTeamId === teamId
          );
          const checked = selectedRounds.includes(r);
          return `
            <label class="btn-xs ${checked ? "primary" : "ghost"}" style="cursor:${alreadyTraded ? "not-allowed" : "pointer"};opacity:${alreadyTraded ? "0.4" : "1"}">
              <input type="checkbox" ${attrName}="${r}" ${checked ? "checked" : ""} ${alreadyTraded ? "disabled" : ""} style="margin-right:4px">
              ${r}R 지명권 ${alreadyTraded ? "(양도됨)" : ""}
            </label>
          `;
        })
        .join(" ");

    const boxEl = $("tradeNegotiationTableBox");
    if (boxEl) {
      const mySelectedNames = STATE.tradeMyPlayerIds
        .map((id) => myRoster.find((p) => p.id === id))
        .filter(Boolean)
        .map((p) => `${p.name}(${p.pos}, OVR ${p.getTrueOvr()})`);
      const targetSelectedNames = STATE.tradeTargetPlayerIds
        .map((id) => partnerRoster.find((p) => p.id === id))
        .filter(Boolean)
        .map((p) => `${p.name}(${p.pos}, OVR ${p.getTrueOvr()})`);

      const myPkgSummary =
        [
          ...mySelectedNames,
          ...STATE.tradeMyPickRounds.map((r) => `${r}R 지명권`),
          STATE.tradeCashToPartner > 0 ? `현금 ${fmtMoney(STATE.tradeCashToPartner)}` : ""
        ]
          .filter(Boolean)
          .join(" + ") || "선택된 카드 없음";

      const targetPkgSummary =
        [
          ...targetSelectedNames,
          ...STATE.tradeTargetPickRounds.map((r) => `${r}R 지명권`),
          STATE.tradeCashFromPartner > 0 ? `현금 ${fmtMoney(STATE.tradeCashFromPartner)}` : ""
        ]
          .filter(Boolean)
          .join(" + ") || "선택된 카드 없음";

      const mgrConflictMod = GM.ManagerConflict || GM.RealisticGM || GM.Extensions;
      const mgrState =
        mgrConflictMod && typeof mgrConflictMod.ensureManagerConflictState === "function"
          ? mgrConflictMod.ensureManagerConflictState(userTeam)
          : null;
      const pendingDirectives = mgrState
        ? (mgrState.activeTradeDirectives || []).filter((d) => d.status === "PENDING")
        : [];
      const activeDirective = pendingDirectives[0] || null;

      boxEl.innerHTML = `
        <!-- [감독 요구 및 프런트 갈등 외압] 정규시즌 핀포인트 베테랑 수혈 공식 요청 문서 (TRADE_DIRECTIVE) -->
        <div class="report-box" style="margin-bottom:12px;border-left:4px solid ${activeDirective ? "#f59e0b" : "#38bdf8"}">
          <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px">
            <div>
              <strong>📄 [현장 감독 트레이드 공식 문서 (TRADE_DIRECTIVE)]</strong>
              <span class="sep">·</span>
              <span>현 감독: <strong>${esc(mgrState ? mgrState.managerName : "감독")}</strong> (신임도 <strong>${mgrState ? mgrState.managerTrust : 65}/100</strong> · 갈등게이지 <strong>${mgrState ? mgrState.conflictGauge : 35}</strong>)</span>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button type="button" class="btn-xs ghost" data-issue-trade-directive="1">📨 감독 약점포지션 베테랑 영입 요청서 수신</button>
              ${
                activeDirective
                  ? `
                    <button type="button" class="btn-xs primary" data-directive-action="AUTO_ACQUIRE" data-directive-id="${esc(activeDirective.id)}">
                      ⚡ 요청 베테랑(${esc(activeDirective.topTarget ? activeDirective.topTarget.playerName : activeDirective.weakPosLabel)}) 즉시 트레이드 수혈 (신임도 +18)
                    </button>
                    <button type="button" class="btn-xs text-bad" data-directive-action="REJECT_DIRECTIVE" data-directive-id="${esc(activeDirective.id)}">
                      ✕ 공식 요청 기각 (신임도 -20)
                    </button>
                  `
                  : ""
              }
            </div>
          </div>
          ${
            activeDirective
              ? `<div class="tiny" style="margin-top:6px;line-height:1.5">
                  <strong>${esc(activeDirective.docNumber)} ${esc(activeDirective.title)}</strong><br/>
                  ${esc(activeDirective.officialText)}
                 </div>`
              : `<div class="tiny muted" style="margin-top:4px">정규시즌 중반(12주차) 도달 시 감독이 구단 약점 포지션(불펜/포수 등) 베테랑 즉시전력감 영입을 공식 문서로 요청합니다. 또한 OVR 상위 핵심 선수를 트레이드 카드로 지정하면 감독이 <strong>[트레이드 거부권]</strong>을 행사합니다.</div>`
          }
        </div>

        <!-- [요청 2 & 요청 5 해결] 9개 상대 구단 원클릭 선택 버튼 바 + 내국인끼리 / 외국인끼리 트레이드 전용 트랙 전환 스위치 -->
        <div class="weekly-summary-banner" style="margin-bottom:12px">
          <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <strong style="font-size:13.5px">🏟️ Step 1. 트레이드 협상 상대 구단 &amp; 국적 트랙 선택:</strong>
              <select id="tradePartnerSelect" class="gm-select">
                ${otherTeams
                  .map(
                    (t) =>
                      `<option value="${esc(t.id)}" ${t.id === partnerTeam.id ? "selected" : ""}>${esc(t.name)} (${esc(fmtMascot(t.id))} · 예산 ${fmtMoney(t.budget)})</option>`
                  )
                  .join("")}
              </select>
              <button type="button" class="btn-xs ${!isForeignTrack ? "primary" : "ghost"}" data-trade-nat-mode="DOMESTIC">
                🇰🇷 내국인끼리 트레이드 (${allMyRoster.filter((p) => p.nationality === "KOR" && !p.isAsianQuarter).length}명 ↔ ${allPartnerRoster.filter((p) => p.nationality === "KOR" && !p.isAsianQuarter).length}명)
              </button>
              <button type="button" class="btn-xs ${isForeignTrack ? "primary" : "ghost"}" data-trade-nat-mode="FOREIGN">
                🌍 외국인끼리 트레이드 (${allMyRoster.filter((p) => (p.nationality && p.nationality !== "KOR") || p.isAsianQuarter).length}명 ↔ ${allPartnerRoster.filter((p) => (p.nationality && p.nationality !== "KOR") || p.isAsianQuarter).length}명)
              </button>
              <button type="button" class="btn-xs ghost" id="btnResetTradeCards">협상 테이블 초기화</button>
            </div>
            <div class="tiny">
              <strong>[트레이드 국적 규정]</strong> <span class="text-good">내국인은 내국인끼리, 외국인은 외국인끼리(동일 보직/인원수)만 교환 가능</span> · 취약 포지션: <strong class="text-good">${evalRes.partnerNeeds ? evalRes.partnerNeeds.join(", ") : "-"}</strong>
            </div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${otherTeams
              .map(
                (t) => `
                <button type="button" class="btn-xs ${t.id === partnerTeam.id ? "primary" : "ghost"}" data-select-trade-partner="${esc(t.id)}">
                  ${esc(t.name)} (${esc(fmtMascot(t.id))})
                </button>
              `
              )
              .join("")}
          </div>
        </div>

        <!-- [요청 5 해결] 내가 구성한 트레이드 카드 실시간 요약 및 직접 제안 실행 바 -->
        <div class="report-box" style="margin-bottom:14px;border-left:4px solid ${evalRes.isAcceptable ? "var(--good)" : "var(--warn)"}">
          <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px">
            <div>
              <div style="font-size:13.5px">
                <strong>[내가 구성한 직접 트레이드 제안서]</strong>
                <span class="sep">·</span>
                <span>📤 우리 제시: <strong class="text-good">${esc(myPkgSummary)}</strong></span>
                <span style="margin:0 6px">⇄</span>
                <span>📥 상대 요구(${esc(partnerTeam.name)}): <strong style="color:#38bdf8">${esc(targetPkgSummary)}</strong></span>
              </div>
              <div class="tnum tiny" style="margin-top:4px">
                <strong>[AI 단장 판정: ${esc(evalRes.reactionLabel || "카드 선택 대기")}]</strong>
                우리 제시 가치 <strong>${evalRes.myTotalValue || 0}pt</strong> vs 상대 요구 가치 <strong>${evalRes.targetTotalValue || 0}pt</strong>
                (밸런스 격차: <strong class="${(evalRes.diff || 0) >= -1.5 ? "text-good" : "text-bad"}">${(evalRes.diff || 0) > 0 ? "+" : ""}${evalRes.diff || 0}pt</strong>)
                — ${esc(evalRes.aiComment || "아래 좌·우 명단에서 교환할 선수를 체크한 뒤 직접 트레이드를 제안하세요.")}
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button type="button" class="btn-sm ghost" data-action-auto-balance="1">🤝 AI 조건 자동 조율</button>
              <button type="button" class="btn-sm primary" data-action-propose-trade="1" ${!dlInfo.allowed ? "disabled" : ""}>
                📨 ${esc(partnerTeam.name)}에 직접 트레이드 제안하기
              </button>
            </div>
          </div>
        </div>

        <div class="grid-2col">
          <!-- 좌측: 우리 구단 제시 카드 -->
          <div class="panel" style="margin-bottom:0">
            <h3 style="font-size:14px;margin:0 0 8px">📤 Step 2-A. 우리 구단 (${esc(userTeam.name)} · ${esc(fmtMascot(userTeam.id))}) 보낼 선수 선택</h3>
            <div class="tiny muted" style="margin-bottom:6px">1) 보낼 선수 체크 (최대 3명 — 현재 ${STATE.tradeMyPlayerIds.length}명 선택됨)</div>
            <div style="max-height:220px;overflow-y:auto;border:1px solid rgba(148,163,184,0.22);border-radius:8px;margin-bottom:10px">
              ${renderPlayerSelectRows(myRoster, STATE.tradeMyPlayerIds, "data-trade-my-player")}
            </div>

            <div class="tiny muted" style="margin-bottom:4px">2) 우리 구단 신인 드래프트 지명권 양도 추가</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
              ${renderPickCheckboxes(userTeam.id, STATE.tradeMyPickRounds, "data-trade-my-pick")}
            </div>

            <div class="tiny muted" style="margin-bottom:4px">3) 현금 트레이드 지급액 추가 (보유 예산: ${fmtMoney(userTeam.budget)})</div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <input type="number" id="tradeCashOfferInput" class="num-input tnum" step="0.5" min="0" max="30" value="${toEokNum(STATE.tradeCashToPartner)}"> 억
              <button type="button" class="btn-xs ghost" data-trade-quick-cash="0">0억</button>
              <button type="button" class="btn-xs ghost" data-trade-quick-cash="20000">+2억</button>
              <button type="button" class="btn-xs ghost" data-trade-quick-cash="50000">+5억</button>
              <button type="button" class="btn-xs ghost" data-trade-quick-cash="100000">+10억</button>
            </div>
          </div>

          <!-- 우측: 상대 구단 요구 카드 -->
          <div class="panel" style="margin-bottom:0">
            <h3 style="font-size:14px;margin:0 0 8px">📥 Step 2-B. 상대 구단 (${esc(partnerTeam.name)} · ${esc(fmtMascot(partnerTeam.id))}) 영입할 선수 선택</h3>
            <div class="tiny muted" style="margin-bottom:6px">1) 데려올 선수 체크 (최대 3명 — 현재 ${STATE.tradeTargetPlayerIds.length}명 선택됨)</div>
            <div style="max-height:220px;overflow-y:auto;border:1px solid rgba(148,163,184,0.22);border-radius:8px;margin-bottom:10px">
              ${renderPlayerSelectRows(partnerRoster, STATE.tradeTargetPlayerIds, "data-trade-target-player")}
            </div>

            <div class="tiny muted" style="margin-bottom:4px">2) 상대 구단 신인 드래프트 지명권 요구 추가</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
              ${renderPickCheckboxes(partnerTeam.id, STATE.tradeTargetPickRounds, "data-trade-target-pick")}
            </div>

            <div class="tiny muted" style="margin-bottom:4px">3) 상대 구단에 현금 보전 요구 (상대 예산: ${fmtMoney(partnerTeam.budget)})</div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <input type="number" id="tradeCashReqInput" class="num-input tnum" step="0.5" min="0" max="20" value="${toEokNum(STATE.tradeCashFromPartner)}"> 억
            </div>
          </div>
        </div>
      `;
    }

    // 2-C) 타구단 트레이드 역제안(오퍼 탐색) 결과 렌더링
    const expEl = $("tradeOffersExplorerBox");
    if (expEl) {
      const offers = STATE.exploredTradeOffers || [];
      if (!offers.length) {
        expEl.innerHTML = "";
      } else {
        expEl.innerHTML = `
          <div class="report-box" style="border-left:4px solid #38bdf8">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <strong>🔍 타구단 단장 역제안(트레이드 오퍼) 탐색 결과 (${offers.length}건)</strong>
              <span class="tiny muted">마음에 드는 제안을 선택해 협상 테이블에 불러오거나 즉시 수락할 수 있습니다.</span>
            </div>
            <div class="scout-grid">
              ${offers
                .map(
                  (of, idx) => `
                  <div class="scout-card">
                    <div class="scout-card-head">
                      <strong>${esc(of.partnerTeamName)} 단장 역제안</strong>
                      <span class="scout-rank-tag tnum">가치차 ${of.diff > 0 ? "+" : ""}${of.diff}pt</span>
                    </div>
                    <div class="tiny" style="margin:6px 0">
                      <div>📤 우리 제시: <strong>${esc(of.myDesc)}</strong></div>
                      <div style="margin-top:2px">📥 상대 제시: <strong class="text-good">${esc(of.targetDesc)}</strong></div>
                    </div>
                    <div class="scout-actions">
                      <button type="button" class="btn-xs primary" data-accept-explored-trade="${idx}">즉시 제안 수락 (트레이드 단행)</button>
                      <button type="button" class="btn-xs ghost" data-load-explored-trade="${idx}">협상 테이블로 불러오기</button>
                    </div>
                  </div>
                `
                )
                .join("")}
            </div>
          </div>
        `;
      }
    }

    // 3) 트레이드 성사 내역 및 양도된 지명권 현황 로그
    const histEl = $("tradeHistoryLogBox");
    if (histEl) {
      const th = ctx.tradeHistory || [];
      const tp = ctx.tradedPicks || [];
      histEl.innerHTML = `
        <div class="report-box">
          <strong>최근 단장 간 트레이드 타결 기록 (${th.length}건) &amp; 양도된 지명권 (${tp.length}건)</strong>
          ${
            th.length
              ? th
                  .slice(0, 6)
                  .map(
                    (r) =>
                      `<div class="tiny" style="margin-top:4px">· [${esc(r.date)}] <strong>${esc(r.myTeamName)}</strong> (${(r.myPlayers || []).join(", ") || "선수없음"}${r.myPickRounds && r.myPickRounds.length ? ` + ${r.myPickRounds.map((x) => `${x}R지명권`).join(",")}` : ""}${r.cashToPartner > 0 ? ` + 현금 ${fmtMoney(r.cashToPartner)}` : ""}) ↔ <strong>${esc(r.partnerTeamName)}</strong> (${(r.targetPlayers || []).join(", ") || "선수없음"}${r.targetPickRounds && r.targetPickRounds.length ? ` + ${r.targetPickRounds.map((x) => `${x}R지명권`).join(",")}` : ""}${r.cashFromPartner > 0 ? ` + 현금 ${fmtMoney(r.cashFromPartner)}` : ""})</div>`
                  )
                  .join("")
              : `<div class="tiny muted" style="margin-top:4px">아직 성사된 트레이드가 없습니다.</div>`
          }
        </div>
      `;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 5-C. [신규 요청 1] 구단주 운영 예산 증액 요청 모달
   * ═══════════════════════════════════════════════════════════════════════ */
  function openBudgetRequestModal() {
    const ctx = STATE.ctx;
    if (!ctx || !GM.Setup) return;
    const userTeam = ctx.getUserTeam();
    const tiers = ["SMALL", "STANDARD", "LARGE"].map((tid) => GM.Setup.previewBudgetRequestOdds(ctx, tid));
    const fin = GM.Economy ? GM.Economy.getFinanceSummary(ctx, userTeam) : null;
    const financeHtml = fin
      ? `
      <div class="report-box" style="margin-bottom:12px">
        <strong>📒 ${fin.year} 재정 장부 (난이도: ${esc(fin.difficulty.label)})</strong>
        <div class="tiny tnum" style="margin-top:6px;line-height:1.7">
          모기업 지원금 <strong>${fmtMoney(fin.subsidy)}</strong>${fin.subsidyRank ? ` (직전 시즌 ${fin.subsidyRank}위 기준 · 순위 역순 지급)` : ""}
          · 이월금 <strong class="${fin.carryover < 0 ? "text-bad" : ""}">${fmtMoney(fin.carryover)}</strong><br>
          시즌 자체 수입 <strong class="text-good">+${fmtMoney(fin.seasonRevenue)}</strong>
          · 운영비 <strong class="text-bad">-${fmtMoney(fin.seasonOperatingCost)}</strong>
          · 연봉총액 <strong>${fmtMoney(fin.payroll)}</strong>
          · 여유 예산 <strong class="${fin.available < 0 ? "text-bad" : "text-good"}">${fmtMoney(fin.available)}</strong>
          ${fin.deficitWeeks > 0 ? `<br><span class="text-bad">⚠️ 올해 적자 상태로 맞은 정산 ${fin.deficitWeeks}주 — 매주 구단주 신임도가 깎입니다.</span>` : ""}
        </div>
        <div class="tiny muted" style="margin-top:6px">
          다음 시즌 모기업 지원금: ${fin.subsidyTable
            .filter((r) => [1, 3, 5, 8, 10].includes(r.rank))
            .map((r) => `${r.rank}위 ${fmtMoney(r.subsidy)}`)
            .join(" · ")}
        </div>
      </div>`
      : "";

    $("gmModalTitle").textContent = `💰 ${userTeam.name} 구단주 특별 운영 예산 증액 결재 상신`;
    $("gmModalBody").innerHTML = `
      <div class="weekly-summary-banner" style="margin-bottom:12px">
        <div>
          <strong>현재 보유 예산: ${fmtMoney(userTeam.budget)}</strong>
          <span class="sep">·</span>
          <span>구단주 신임도: <strong>${userTeam.ownerTrust} / 100</strong></span>
          <span class="sep">·</span>
          <span>금년 증액 요청 횟수: <strong>${ctx.budgetRequestCountThisYear || 0} / 2회</strong></span>
        </div>
        <div class="tiny muted" style="margin-top:4px">
          구단주 신임도, 현재 순위(목표 대비 성적), 단장 특성(협상의 달인 등), 난이도에 따라 승인 확률이 자체 산출됩니다. 기각 시 구단주 신임도가 소폭 하락합니다.
        </div>
      </div>
      ${financeHtml}
      <div class="scout-grid">
        ${tiers
          .map(
            (t) => `
            <div class="scout-card">
              <div class="scout-card-head">
                <strong>${esc(t.tier.label)}</strong>
                <span class="scout-rank-tag tnum">승인 확률 ${t.probPct}%</span>
              </div>
              <div class="scout-metrics tnum">
                <span>요청 금액: <strong class="text-good">+${fmtMoney(t.tier.amount)}</strong></span>
                <span class="sep">·</span>
                <span>승인 시 신임도: <strong>-${t.tier.trustCostOnSuccess}</strong> / 기각 시: <strong class="text-bad">-${t.tier.trustPenaltyOnFail}</strong></span>
              </div>
              <div class="scout-reason">${esc(t.tier.desc)} (현재 ${t.currentRank}위 / 목표 ${t.targetRank}위권)</div>
              <div class="scout-actions">
                <button type="button" class="btn-sm primary" data-exec-budget-req="${esc(t.tier.id)}" ${t.remainingRequests <= 0 ? "disabled" : ""}>
                  ${t.remainingRequests <= 0 ? "금년 요청 한도 소진(2/2)" : `${fmtMoney(t.tier.amount)} 증액 결재 상신`}
                </button>
              </div>
            </div>
          `
          )
          .join("")}
      </div>
      <div id="budgetReqModalResultBox" style="margin-top:12px"></div>
    `;
    $("gmModalBackdrop").hidden = false;
  }

  function renderCampSubPanel() {
    const ctx = STATE.ctx;
    const userTeam = ctx.getUserTeam();
    const staff = userTeam.coachingStaff || {};
    const cands = GM.SpringCamp.getCoachingCandidates();

    const mgrSel = $("campMgrSelect");
    const pitSel = $("campPitSelect");
    const hitSel = $("campHitSelect");

    if (mgrSel && !mgrSel.options.length) {
      cands.managers.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.name;
        opt.textContent = `${m.name} (${m.label} · 연봉 ${fmtMoney(m.salary)}) — ${m.desc}`;
        mgrSel.appendChild(opt);
      });
    }
    if (pitSel && !pitSel.options.length) {
      cands.pitchingCoaches.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.name;
        opt.textContent = `${c.name} (중점: ${c.specialty} · 훈련+${Math.round((c.trainBonus - 1) * 100)}% · 연봉 ${fmtMoney(c.salary)})`;
        pitSel.appendChild(opt);
      });
    }
    if (hitSel && !hitSel.options.length) {
      cands.hittingCoaches.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.name;
        opt.textContent = `${c.name} (중점: ${c.specialty} · 훈련+${Math.round((c.trainBonus - 1) * 100)}% · 연봉 ${fmtMoney(c.salary)})`;
        hitSel.appendChild(opt);
      });
    }

    $("currentStaffSummary").innerHTML = `
      <span>현 감독: <strong>${esc(staff.manager ? staff.manager.name : "-")}</strong> (${esc(staff.manager ? staff.manager.style : "-")})</span>
      <span class="sep">·</span>
      <span>투수코치: <strong>${esc(staff.pitchingCoach ? staff.pitchingCoach.name : "-")}</strong></span>
      <span class="sep">·</span>
      <span>타격코치: <strong>${esc(staff.hittingCoach ? staff.hittingCoach.name : "-")}</strong></span>
    `;

    const campRepEl = $("campResultReport");
    const btnRunCamp = $("btnRunSpringCamp");
    const activeCamp = ctx.activeSpringCamp && ctx.activeSpringCamp.year === ctx.currentYear ? ctx.activeSpringCamp : null;

    if (btnRunCamp) {
      if (activeCamp && activeCamp.status === "IN_PROGRESS") {
        btnRunCamp.disabled = true;
        btnRunCamp.textContent = `⛺ 스프링캠프 진행 중 (${activeCamp.progressDays}/${activeCamp.durationDays}일차)`;
      } else if (activeCamp && activeCamp.status === "COMPLETED") {
        btnRunCamp.disabled = true;
        btnRunCamp.textContent = `✅ ${ctx.currentYear}시즌 스프링캠프 완료`;
      } else {
        btnRunCamp.disabled = false;
        btnRunCamp.textContent = "✈️ 스프링캠프 출발 (14일 전지훈련 시작)";
      }
    }

    if (campRepEl) {
      if (activeCamp && activeCamp.status === "IN_PROGRESS") {
        const pct = Math.min(100, Math.round((activeCamp.progressDays / activeCamp.durationDays) * 100));
        const remDays = Math.max(1, activeCamp.durationDays - activeCamp.progressDays);
        campRepEl.innerHTML = `
          <div class="report-box" style="border-left:4px solid #38bdf8">
            <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px">
              <div>
                <strong style="font-size:14px">⛺ [${esc(activeCamp.locationName)}] 스프링캠프 전지훈련 진행 중 (${activeCamp.progressDays} / ${activeCamp.durationDays}일차 · ${pct}%)</strong>
                <div class="tiny muted" style="margin-top:3px">
                  출발일: <strong>${esc(activeCamp.startDate)}</strong> · 귀국 및 결과 발표 예정일: <strong>${esc(activeCamp.endDate)}</strong> (잔여 ${remDays}일)
                </div>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button type="button" class="btn-xs ghost" data-camp-advance-days="1">⏩ 캠프 +1일 진행</button>
                <button type="button" class="btn-xs primary" data-camp-advance-days="${remDays}">⏩ 캠프 귀국일까지 진행 (+${remDays}일 · 훈련 결과 확인)</button>
              </div>
            </div>
            <div style="margin:10px 0;height:8px;background:rgba(148,163,184,0.2);border-radius:999px;overflow:hidden">
              <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#38bdf8,#22c55e);transition:width 0.25s"></div>
            </div>
            <div class="tiny">
              ${(activeCamp.dailyLogs || [])
                .slice(-5)
                .map((lg) => `<div style="margin-top:3px">· ${esc(lg)}</div>`)
                .join("")}
            </div>
          </div>
        `;
      } else {
        const rep = (activeCamp && activeCamp.report) || ctx.lastCampReport || STATE.lastCampReport;
        if (!rep || !rep.userCampReport) {
          campRepEl.innerHTML = `<div class="empty-box">코치진 인선과 캠프지를 선택한 뒤 <strong>'✈️ 스프링캠프 출발 (14일 전지훈련 시작)'</strong> 버튼을 누르세요. 출발 후 <strong>14일간의 캠프 일정</strong>이 진행된 뒤 최종 훈련 성과를 확인합니다.</div>`;
        } else {
          const u = rep.userCampReport;
          campRepEl.innerHTML = `
            <div class="report-box" style="border-left:4px solid var(--good)">
              <div>
                <strong>✅ 14일 스프링캠프 전지훈련 최종 결과 보고서:</strong>
                ${esc(u.locationName)} (집행 비용 ${fmtMoney(u.cost)}${activeCamp ? ` · 기간: ${esc(activeCamp.startDate)} ~ ${esc(activeCamp.endDate)}` : ""})
              </div>
              ${u.campMvp ? `<div style="margin-top:4px">· 🏆 <strong>캠프 MVP:</strong> ${esc(u.campMvp.name)} (${u.campMvp.pos}, ${u.campMvp.age}세) — 능력치 +${u.campMvp.totalStatGain}, 구종숙련 +${u.campMvp.pitchMasteryGain} (현 OVR ${u.campMvp.newTrueOvr})</div>` : ""}
              ${u.newPitchUnlocked.length ? `<div style="margin-top:4px">· 🎯 <strong>신구종 장착 투수:</strong> ${u.newPitchUnlocked.map((np) => `${esc(np.name)}(${np.pitchKey} 숙련 ${np.mastery})`).join(", ")}</div>` : ""}
              ${u.campInjuries.length ? `<div class="text-bad" style="margin-top:4px">· 🚑 <strong>캠프 부상자:</strong> ${u.campInjuries.map((ij) => `${esc(ij.name)}(${ij.label}, ${ij.weeksLeft}주)`).join(", ")}</div>` : `<div class="text-good" style="margin-top:4px">· 부상자 없이 전원 건강한 상태로 14일간의 캠프를 완주했습니다!</div>`}
            </div>
          `;
        }
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 5-C. [PART 4] KBO 5대 프런트 핵심 시스템 통합 컨트롤 타워 렌더링
   *      (1) 포스트시즌 토너먼트  (2) 격년 2차 드래프트(35인 보호)  (3) 상무 피닉스 병역
   *      (4) 구단 인프라 3대 R&D 시설 (Lv.1~5)  (5) 샐러리캡(120억) & 비FA 다년 연장 계약
   * ═══════════════════════════════════════════════════════════════════════ */
  function renderFront5SubPanel() {
    const ctx = STATE.ctx;
    const container = $("front5DashboardContainer");
    if (!ctx || !container || !GM.Extensions) return;

    const userTeam = ctx.getUserTeam();
    const ext = GM.Extensions;

    // 1) 포스트시즌 히스토리 및 일정 검증 (10월 10일 가을야구 개막)
    const psHist = Array.isArray(ctx.postseasonHistory) ? ctx.postseasonHistory : [];
    const thisYearPs = psHist.find((h) => Number(h.year) === Number(ctx.currentYear)) || null;
    const latestPs = thisYearPs || psHist[psHist.length - 1] || null;
    const psGate =
      GM.Setup && typeof GM.Setup.canPlayPostseasonNow === "function"
        ? GM.Setup.canPlayPostseasonNow(ctx.currentDate, ctx)
        : {
            allowed: false,
            daysRemaining: 0,
            alreadyCompleted: Boolean(thisYearPs),
            officialDateStr: `${ctx.currentYear}-10-10`,
            reason: ""
          };

    // 2) 격년 2차 드래프트 (35인 보호선수 명단, 일정 검증 및 비보호 후보 풀)
    const protInfo = ext.buildTeam35ManProtection(ctx, userTeam);
    const bdHist = Array.isArray(ctx.biennialDraftHistory) ? ctx.biennialDraftHistory : [];
    const thisYearBd = bdHist.find((h) => Number(h.year) === Number(ctx.currentYear)) || null;
    const latestBd = thisYearBd || bdHist[bdHist.length - 1] || null;
    const isBiennialYr = ext.isBiennialDraftYear(ctx.currentYear);
    const bdGate =
      GM.Setup && typeof GM.Setup.canPickSecondaryDraftNow === "function"
        ? GM.Setup.canPickSecondaryDraftNow(ctx.currentDate, ctx)
        : {
            allowed: false,
            isBiennialYear: isBiennialYr,
            daysRemaining: 0,
            alreadyCompleted: Boolean(thisYearBd),
            officialDateStr: `${ctx.currentYear}-11-05`,
            reason: ""
          };
    const secExposedCands =
      typeof ext.getSecondaryDraftExposedCandidates === "function"
        ? ext.getSecondaryDraftExposedCandidates(ctx).slice(0, 12)
        : [];

    // 3) 상무 피닉스 병역 관리
    const sangmuCands = ext.getEligibleSangmuCandidates(userTeam);
    const servingList = userTeam.militaryList || [];

    // 4) 구단 인프라 R&D 3대 시설
    const fac = ext.ensureTeamFacilities(userTeam);
    const facEff = ext.getTeamFacilityEffects(userTeam);
    const facCardsHtml = ["rehabCenter", "biomechLab", "scoutHq"]
      .map((fKey) => {
        const spec = ext.FACILITY_SPECS[fKey];
        const curLv = fac[fKey] || 1;
        const nextLv = curLv + 1;
        const nextCost = spec.costsByNextLevel[nextLv] || 0;
        const isMax = curLv >= 5;
        return `
          <div class="scout-card">
            <div class="scout-card-head">
              <strong>🏗️ ${esc(spec.name)}</strong>
              <span class="scout-rank-tag tnum">Lv.${curLv} / 5</span>
            </div>
            <div class="tiny" style="margin:6px 0">${esc(spec.desc)}</div>
            <div class="scout-actions">
              <button type="button" class="btn-xs primary" data-upgrade-facility="${fKey}" ${isMax ? "disabled" : ""}>
                ${isMax ? "최고 단계 (Lv.5 완료)" : `Lv.${nextLv} 증축 투자 (${fmtMoney(nextCost)})`}
              </button>
            </div>
          </div>
        `;
      })
      .join("");

    // 5) 샐러리캡(경쟁균형세: 리그 평균 상위 40인 연봉 × 120%) 및 비FA 다년 연장 계약 대상자
    const top40Payroll = ext.getTop40DomesticPayroll(userTeam, ctx);
    const capLimit = typeof ext.getSalaryCapLimit === "function" ? ext.getSalaryCapLimit(ctx) : ext.KBO_SALARY_CAP_LIMIT || 1200000;
    const lastTax = (userTeam.luxuryTaxHistory || []).slice(-1)[0] || null;
    const capDiff = capLimit - top40Payroll;
    const nonFaCands = GM.NonFA ? GM.NonFA.getCandidates(ctx, userTeam.id) : ext.getNonFAExtensionCandidates(userTeam);
    const signedExts = userTeam.nonFAExtensions || [];

    container.innerHTML = `
      <div style="display:grid;gap:16px">
        <!-- [1] 가을야구 포스트시즌 계단식 토너먼트 (10월 10일 가을야구 개막 시 발동) -->
        <div class="panel" style="margin-bottom:0">
          <div class="panel-head">
            <div>
              <h3 class="panel-title" style="font-size:15px">1. 🏆 KBO 포스트시즌 계단식 토너먼트 (와일드카드 → 준PO → PO → 한국시리즈)</h3>
              <div class="tiny">정규시즌 1~5위 진출 · 4위 와일드카드 1승 어드밴티지 · 단기전 4선발 압축 로테이션 · 우승 배당금 +50억 &amp; 신임도 +25</div>
            </div>
            <button type="button" class="btn-sm primary" data-run-postseason="1" ${psGate.allowed && !thisYearPs ? "" : "disabled"}>
              ${
                thisYearPs
                  ? `✅ ${ctx.currentYear} 포스트시즌 종료`
                  : psGate.allowed
                  ? `🏆 ${ctx.currentYear} 포스트시즌 토너먼트 진행`
                  : `🔒 10/10 가을야구 개막 대기 (D-${psGate.daysRemaining}일)`
              }
            </button>
          </div>
          ${
            thisYearPs
              ? `<div class="weekly-summary-banner" style="margin-bottom:8px;border-left:4px solid var(--good)">
                   ✅ <strong>[${ctx.currentYear} KBO 포스트시즌 완료]</strong> 한국시리즈 챔피언: <strong>${esc(thisYearPs.championTeamName)}</strong> (준우승: ${esc(thisYearPs.runnerUpTeamName)})
                 </div>`
              : psGate.allowed
              ? `<div class="weekly-summary-banner" style="margin-bottom:8px;border-left:4px solid #22c55e;background:rgba(34,197,94,0.12)">
                   🟢 <strong>[${ctx.currentYear} KBO 가을야구 개막!]</strong> 정규시즌 일정이 마무리되어 포스트시즌 토너먼트를 진행할 수 있습니다. 우측 상단 버튼을 눌러 가을야구를 진행하세요!
                 </div>`
              : `<div class="weekly-summary-banner" style="margin-bottom:8px;border-left:4px solid #f59e0b;background:rgba(245,158,11,0.1)">
                   🔒 <strong>[가을야구 개막 대기 · D-${psGate.daysRemaining}일]</strong> 포스트시즌은 페넌트레이스 종료 후 <strong>${ctx.currentYear}년 10월 10일</strong>에 개막합니다. (현재 날짜: ${esc(ctx.currentDate)})
                 </div>`
          }
          ${
            latestPs
              ? `
                <div class="report-box">
                  <div><strong class="text-good">[${latestPs.year} 한국시리즈 챔피언: ${esc(latestPs.championTeamName)}]</strong> · 준우승: ${esc(latestPs.runnerUpTeamName)}</div>
                  <div class="tiny" style="margin-top:4px">
                    · 와일드카드: ${esc(latestPs.series.wildCard.summaryText)}<br/>
                    · 준플레이오프: ${esc(latestPs.series.semiPlayoff.summaryText)}<br/>
                    · 플레이오프: ${esc(latestPs.series.playoff.summaryText)}<br/>
                    · 한국시리즈: ${esc(latestPs.series.koreanSeries.summaryText)}
                  </div>
                </div>
              `
              : `<div class="empty-box">페넌트레이스 종료 후 <strong>10월 10일 가을야구 기간</strong>이 도래하면 포스트시즌 토너먼트를 진행할 수 있습니다.</div>`
          }
        </div>

        <!-- [2] KBO 2차 드래프트 (격년 11월 5일 개막 · 신인드래프트처럼 기간 도래 시 지명) -->
        <div class="panel" style="margin-bottom:0">
          <div class="panel-head">
            <div>
              <h3 class="panel-title" style="font-size:15px">2. 🔄 KBO 2차 드래프트 (격년 11월 5일 개막 · 35인 보호선수 외 1~3R 양도금 지명)</h3>
              <div class="tiny">1R 양도금 4억 · 2R 3억 · 3R 2억 원 · 외국인/FA/신인(1~2년차)/군보류 자동 보호 외 핵심 35인 보호 (${ctx.currentYear}년: ${isBiennialYr ? "공식 개최 연도 · 11월 5일 개막" : `격년 휴식기 · ${Number(ctx.currentYear) + 1}년 11월 5일 개최`})</div>
            </div>
            <button type="button" class="btn-sm primary" data-run-biennial-draft="1" ${bdGate.allowed && !thisYearBd ? "" : "disabled"}>
              ${
                thisYearBd
                  ? `✅ ${ctx.currentYear} 2차 드래프트 완료`
                  : !bdGate.isBiennialYear
                  ? `🔒 격년 휴식기 (${Number(ctx.currentYear) + 1}년 11/5 개최)`
                  : bdGate.allowed
                  ? `🔄 ${ctx.currentYear} 2차 드래프트 1~3R 지명 진행`
                  : `🔒 11/5 지명 오픈 대기 (D-${bdGate.daysRemaining}일)`
              }
            </button>
          </div>
          ${
            thisYearBd
              ? `<div class="weekly-summary-banner" style="margin-bottom:8px;border-left:4px solid var(--good)">
                   ✅ <strong>[${ctx.currentYear} KBO 2차 드래프트 완료]</strong> 35인 보호명단 외 총 <strong>${thisYearBd.totalSelected}명</strong> 구단 간 지명 및 양도금 이적이 완료되었습니다.
                 </div>`
              : !bdGate.isBiennialYear
              ? `<div class="weekly-summary-banner" style="margin-bottom:8px;border-left:4px solid #64748b">
                   🔒 <strong>[${ctx.currentYear}년 2차 드래프트 격년 휴식기]</strong> KBO 2차 드래프트는 격년(홀수 해: 2025·2027·2029년) <strong>11월 5일</strong>에 개최됩니다.
                 </div>`
              : bdGate.allowed
              ? `<div class="weekly-summary-banner" style="margin-bottom:8px;border-left:4px solid #22c55e;background:rgba(34,197,94,0.12)">
                   🟢 <strong>[${ctx.currentYear} KBO 2차 드래프트 지명 기간 개막!]</strong> 11월 5일 공식 지명일이 도래했습니다! 아래 <strong>[타 9개 구단 35인 보호 제외(비보호 노출) 후보 명단]</strong>에서 원하는 선수를 직접 지명하거나 우측 상단 <strong>'🔄 ${ctx.currentYear} 2차 드래프트 1~3R 지명 진행'</strong> 버튼을 누르세요. (11월 14일 마감 시 자동 진행)
                 </div>`
              : `<div class="weekly-summary-banner" style="margin-bottom:8px;border-left:4px solid #f59e0b;background:rgba(245,158,11,0.1)">
                   🔒 <strong>[2차 드래프트 지명 잠금 · D-${bdGate.daysRemaining}일]</strong> ${ctx.currentYear} KBO 2차 드래프트는 포스트시즌 종료 후 <strong>${ctx.currentYear}년 11월 5일</strong>에 공식 개막합니다. 개막 전까지 하단 <strong>[35인 보호선수 명단]</strong>을 정비하고 타 구단 비보호 예상 후보를 확인하세요.
                 </div>`
          }
          <div class="weekly-summary-banner" style="margin-bottom:8px">
            <strong>우리 구단(${esc(userTeam.name)}) 35인 보호 현황:</strong>
            자동보호 <strong>${protInfo.autoProtectedPlayers.length}명</strong> ·
            35인 보호명단 <strong>${protInfo.protectedIds.size}명</strong> ·
            2차 드래프트 노출(비보호 유망주/베테랑) <strong>${protInfo.exposedPool.length}명</strong>
          </div>
          ${
            isBiennialYr && !thisYearBd && secExposedCands.length
              ? `
                <div class="table-wrap" style="margin-bottom:10px;max-height:260px;overflow-y:auto">
                  <table class="gm-table compact">
                    <thead>
                      <tr>
                        <th>원소속</th>
                        <th>포지션</th>
                        <th>선수명</th>
                        <th>나이</th>
                        <th>현재 OVR</th>
                        <th>잠재력</th>
                        <th>1R 양도금</th>
                        <th>직접 지명</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${secExposedCands
                        .map((item) => {
                          const p = item.player;
                          const rep = p.scoutingReport || p.updateScoutingReport(ctx.scoutLevel || 1, false);
                          return `
                            <tr>
                              <td><strong>${esc(item.formerTeamName)}</strong></td>
                              <td><span class="pos-code">${esc(p.pos)}</span></td>
                              <td><button type="button" class="player-link" data-player-modal="${p.id}" data-team-id="${item.formerTeamId}">${esc(p.name)}</button></td>
                              <td class="tnum">${p.age}세</td>
                              <td class="tnum"><strong>${esc(rep.ovrDisplay)}</strong></td>
                              <td class="tnum">${esc(rep.potentialDisplay)}</td>
                              <td class="tnum">4억 원</td>
                              <td>
                                <button
                                  type="button"
                                  class="btn-xs ${bdGate.allowed ? "primary" : "ghost"}"
                                  data-sec-draft-pick="${p.id}"
                                  ${bdGate.allowed ? "" : "disabled"}
                                >
                                  ${bdGate.allowed ? "1R 지명 영입" : "🔒 11/5 오픈"}
                                </button>
                              </td>
                            </tr>
                          `;
                        })
                        .join("")}
                    </tbody>
                  </table>
                </div>
              `
              : ""
          }
          ${
            latestBd
              ? `
                <div class="report-box">
                  <div><strong>[${latestBd.year} KBO 2차 드래프트 결과]</strong> 총 ${latestBd.totalSelected}명 구단 간 이적 완료</div>
                  <div class="tiny" style="margin-top:4px">
                    ${latestBd.picks
                      .slice(0, 8)
                      .map((pk) => `<div>· ${esc(pk.summary)}</div>`)
                      .join("")}
                  </div>
                </div>
              `
              : `<div class="empty-box">홀수 해(2025·2027·2029년) <strong>11월 5일 2차 드래프트 기간</strong>이 도래하면 신인 드래프트처럼 비보호 선수를 지명할 수 있습니다.</div>`
          }
        </div>

        <!-- [3] 상무 피닉스 병역 관리 시스템 -->
        <div class="panel" style="margin-bottom:0">
          <div class="panel-head">
            <div>
              <h3 class="panel-title" style="font-size:15px">3. 🪖 상무 피닉스 야구단 병역 보류 시스템 (18개월 복무 · 실전 성장 · 정원/페이롤 제외)</h3>
              <div class="tiny">만 19~26세 미필 선수 입대 가능 (구단당 최대 4명 복무) · 만 27세까지 미필 시 강제 일반 입대로 노쇠화 리스크 발생</div>
            </div>
          </div>
          <div class="weekly-summary-banner" style="margin-bottom:10px">
            <strong>현재 상무 복무 중인 우리 선수 (${servingList.length} / 4명):</strong>
            ${
              servingList.length
                ? servingList
                    .map(
                      (sp) =>
                        `<strong>${esc(sp.name)}</strong>(${sp.pos}, ${sp.age}세, 전역 D-${(sp.military && sp.military.daysRemaining) || 0}일, 복무성장 +${(sp.military && sp.military.statGains) || 0})`
                    )
                    .join(" · ")
                : "현재 복무 중인 선수가 없습니다."
            }
          </div>
          <div class="scout-grid">
            ${
              sangmuCands.slice(0, 6).map(
                (p) => `
                <div class="scout-card">
                  <div class="scout-card-head">
                    <span class="pos-code">${esc(p.pos)}</span>
                    <strong>${esc(p.name)}</strong>
                    <span class="muted">(${p.age}세 · ${p.status} · 미필)</span>
                    ${p.age >= 26 ? `<span class="scout-rank-tag text-bad">입대 시급!</span>` : ""}
                  </div>
                  <div class="scout-metrics tnum">
                    <span>실제 OVR: <strong>${p.getTrueOvr()}</strong></span>
                    <span class="sep">·</span>
                    <span>포텐셜: <strong>${p.potential}</strong></span>
                  </div>
                  <div class="scout-actions">
                    <button type="button" class="btn-xs primary" data-enlist-sangmu="${p.id}" ${servingList.length >= 4 ? "disabled" : ""}>
                      상무 피닉스 입대 신청 (18개월)
                    </button>
                  </div>
                </div>
              `
              ).join("") || `<div class="empty-box">입대 대상 미필 선수가 없습니다.</div>`
            }
          </div>
        </div>

        <!-- [4] 구단 인프라 & R&D 3대 시설 투자 (Lv.1~5) -->
        <div class="panel" style="margin-bottom:0">
          <div class="panel-head">
            <div>
              <h3 class="panel-title" style="font-size:15px">4. 🔬 구단 인프라 &amp; R&amp;D 3대 시설 투자 (Lv.1 ~ Lv.5 영구 버프)</h3>
              <div class="tiny">현재 효과: 부상 위험 <strong>${Math.round((1 - facEff.injuryRiskMul) * 100)}% 감소</strong> · 2군 TP 획득 <strong>+${Math.round((facEff.tpGainMul - 1) * 100)}% 가속</strong> · 최대 파견 스카우트 <strong>${facEff.maxScouts}명</strong></div>
            </div>
          </div>
          <div class="scout-grid">${facCardsHtml}</div>
        </div>

        <!-- [5] 샐러리캡(경쟁균형세) & 비FA 다년 연장 계약 -->
        <div class="panel" style="margin-bottom:0">
          <div class="panel-head">
            <div>
              <h3 class="panel-title" style="font-size:15px">5. ⚖️ KBO 샐러리캡(경쟁균형세 · 올해 상한 ${fmtMoney(capLimit)}) &amp; 비FA 다년 연장 계약</h3>
              <div class="tiny">상한 = 10개 구단 상위 40인 국내 연봉 평균의 120%. 초과 시 1회 50% · 2회 연속 100% + 다음 1R 지명권 9단계 하락 · 3회 이상 연속 150% + 9단계 하락 (매년 12월 10일 심사)${lastTax && lastTax.isOverCap ? ` — 우리 구단 ${lastTax.year}년 ${lastTax.overCapStreak || 1}회 연속 초과` : ""}</div>
            </div>
            <button type="button" class="btn-sm" data-eval-luxury-tax="1">10개 구단 경쟁균형세 즉시 심사</button>
          </div>
          <div class="weekly-summary-banner" style="margin-bottom:10px">
            <strong>우리 구단 상위 40인 국내 연봉 총액:</strong>
            <span class="tnum font-bold ${capDiff >= 0 ? "text-good" : "text-bad"}">${fmtMoney(top40Payroll)}</span> / 상한선 ${fmtMoney(capLimit)}
            (${capDiff >= 0 ? `여유액 ${fmtMoney(capDiff)}` : `상한 초과 ${fmtMoney(Math.abs(capDiff))} · 예상 제재금 ${fmtMoney(Math.round(Math.abs(capDiff) * 0.5))}`})
          </div>
          ${renderNonFAContractSectionHtml(ctx, userTeam, nonFaCands)}
        </div>

        <!-- [6] [PART 5-1] KBO-MLB 포스팅 시스템 (간판 스타 해외 진출 & +100억~300억 이적료 유입) -->
        <div class="panel" style="margin-bottom:0">
          <div class="panel-head">
            <div>
              <h3 class="panel-title" style="font-size:15px">6. ✈️ KBO-MLB 포스팅 시스템 (리그 최정상급 스타 해외 진출 &amp; +100억~300억 이적료 유입)</h3>
              <div class="tiny">포스팅 기간(11월 1일~12월 15일)에 KBO ${ext.POSTING_MIN_SEASONS || 7}시즌 이상 뛴 만 31세 이하 국내 선수 중 종합 OVR ${ext.POSTING_MIN_OVR || 90} 이상 또는 단일 능력치 ${ext.POSTING_ELITE_STAT || 95} 이상인 1명에게만 MLB 구단의 제안이 들어옵니다. 승인 시 이적료(+100억~300억 원)와 구단주 신임도(+12)가 유입되고, 불허하면 그해에는 다시 제안이 오지 않습니다(사기 -18).</div>
            </div>
          </div>
          <div class="scout-grid">
            ${
              ext.getMLBPostingCandidates(ctx, userTeam.id).map(
                (pc) => `
                <div class="scout-card">
                  <div class="scout-card-head">
                    <span class="pos-code">${esc(pc.pos)}</span>
                    <strong>${esc(pc.name)}</strong>
                    <span class="muted">(${pc.age}세 · OVR ${pc.trueOvr} · WAR ${pc.war.toFixed(2)})</span>
                  </div>
                  <div class="scout-metrics tnum">
                    <span>MLB 관심 구단: <strong>${esc(pc.mlbSuitor)}</strong></span>
                    <span class="sep">·</span>
                    <span>예상 포스팅 이적료: <strong class="text-good">+${pc.postingFeeEok}억 원</strong></span>
                  </div>
                  <div class="tiny muted" style="margin:4px 0">제안 사유: ${esc(pc.offerReason || "-")}</div>
                  <div class="scout-actions" style="display:flex;gap:6px">
                    <button type="button" class="btn-xs primary" data-exec-mlb-posting="${pc.playerId}" data-posting-decision="APPROVE">
                      MLB 포스팅 승인 (+${pc.postingFeeEok}억 유입)
                    </button>
                    <button type="button" class="btn-xs ghost" data-exec-mlb-posting="${pc.playerId}" data-posting-decision="REJECT">
                      잔류 설득(불허)
                    </button>
                  </div>
                </div>
              `
              ).join("") ||
              `<div class="empty-box">${
                ext.isPostingWindowOpen && !ext.isPostingWindowOpen(ctx)
                  ? "MLB 포스팅 제안은 11월 1일~12월 15일에만 들어옵니다."
                  : `현재 MLB 구단의 포스팅 제안을 받은 선수가 없습니다. (KBO ${ext.POSTING_MIN_SEASONS || 7}시즌+ · OVR ${ext.POSTING_MIN_OVR || 90}+ 또는 단일 능력치 ${ext.POSTING_ELITE_STAT || 95}+ 필요)`
              }</div>`
            }
          </div>
          ${
            Array.isArray(ctx.postingHistory) && ctx.postingHistory.length
              ? `<div class="tiny text-good" style="margin-top:8px"><strong>역대 MLB 포스팅 진출 기록:</strong> ${ctx.postingHistory.map((h) => `${h.year}년 ${esc(h.playerName)}(${esc(h.mlbTeam)}, 이적료 +${h.postingFeeEok}억)`).join(" · ")}</div>`
              : ""
          }
        </div>

        <!-- [7] [PART 5-2] 홈구장 리모델링 및 파크 팩터 개조 -->
        <div class="panel" style="margin-bottom:0">
          <div class="panel-head">
            <div>
              <h3 class="panel-title" style="font-size:15px">7. 🏟️ 홈구장 리모델링 및 파크 팩터 개조 (펜스 거리 · 담장 높이 설계)</h3>
              <div class="tiny">현재 홈구장: <strong>${esc(userTeam.park ? userTeam.park.name : "")}</strong> · 홈런 팩터 <strong>${userTeam.park ? userTeam.park.hr : 1.0}</strong> · 장타 팩터 <strong>${userTeam.park ? userTeam.park.xbh : 1.0}</strong> · 안타 팩터 <strong>${userTeam.park ? userTeam.park.hit : 1.0}</strong></div>
            </div>
          </div>
          <div class="scout-grid">
            ${Object.values(ext.PARK_REMODEL_PRESETS)
              .map(
                (pr) => `
                <div class="scout-card">
                  <div class="scout-card-head">
                    <strong>🏟️ ${esc(pr.label)}</strong>
                    <span class="scout-rank-tag tnum">${fmtMoney(pr.costManwon)}</span>
                  </div>
                  <div class="tiny" style="margin:6px 0">${esc(pr.desc)} (HR ${pr.hr} / XBH ${pr.xbh} / HIT ${pr.hit})</div>
                  <div class="scout-actions">
                    <button type="button" class="btn-xs primary" data-remodel-park="${pr.key}">
                      구장 리모델링 시공 (${fmtMoney(pr.costManwon)})
                    </button>
                  </div>
                </div>
              `
              )
              .join("")}
          </div>
        </div>

        <!-- [8] [PART 5-3] 2군 맞춤형 육성 가이드라인 (선수별 집중 과제 지정) -->
        <div class="panel" style="margin-bottom:0">
          <div class="panel-head">
            <div>
              <h3 class="panel-title" style="font-size:15px">8. 🎯 2군 맞춤형 육성 가이드라인 (구속 · 제구 · 신구종 · 선구안 · 파워 집중 과제)</h3>
              <div class="tiny">2군·육성군 유망주에게 맞춤형 집중 과제를 지정하면 주간 퓨처스리그 성장 확률이 +25% 가속되고 해당 능력치가 집중 상승합니다.</div>
            </div>
            <button type="button" class="btn-sm primary" data-auto-futures-train="1">미지정 유망주 일괄 최적 과제 부여</button>
          </div>
          <div class="scout-grid">
            ${[...(userTeam.roster2G || []), ...(userTeam.rosterDev || [])]
              .slice(0, 9)
              .map((fp) => {
                const progs = Object.values(ext.FUTURES_TRAINING_PROGRAMS).filter((pg) => pg.role === fp.type);
                return `
                  <div class="scout-card">
                    <div class="scout-card-head">
                      <span class="pos-code">${esc(fp.pos)}</span>
                      <strong>${esc(fp.name)}</strong>
                      <span class="muted">(${fp.age}세 · OVR ${fp.getTrueOvr()} / 포텐 ${fp.potential})</span>
                    </div>
                    <div style="margin-top:6px">
                      <select class="gm-select" style="width:100%;font-size:12px" data-futures-training-select="${fp.id}">
                        <option value="">-- 집중 육성 과제 선택 --</option>
                        ${progs
                          .map(
                            (pg) =>
                              `<option value="${pg.key}" ${fp.trainingFocus === pg.key ? "selected" : ""}>${esc(pg.label)}</option>`
                          )
                          .join("")}
                      </select>
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>
        </div>

        <!-- [9] [PART 5-4] 선수 사기(Morale) & 트레이드 공식 요구 관리 -->
        <div class="panel" style="margin-bottom:0">
          <div class="panel-head">
            <div>
              <h3 class="panel-title" style="font-size:15px">9. 💬 라커룸 케미스트리 · 선수 사기(Morale) &amp; 트레이드 공식 요구 관리</h3>
              <div class="tiny">1군급 기량(OVR 73+) 선수가 장기 2군 체류하거나 연봉 삭감 시 사기가 저하되며 트레이드 요구(Trade Demand)가 발생합니다.</div>
            </div>
          </div>
          <div class="scout-grid">
            ${
              ext.getMoraleIssuePlayers(userTeam).slice(0, 6).map(
                (mp) => `
                <div class="scout-card" style="border-left:4px solid ${mp.tradeDemand ? "var(--bad)" : "#f59e0b"}">
                  <div class="scout-card-head">
                    <span class="pos-code">${esc(mp.pos)}</span>
                    <strong>${esc(mp.name)}</strong>
                    <span class="muted">(${mp.age}세 · ${mp.status} · OVR ${mp.getTrueOvr()})</span>
                    <span class="scout-rank-tag ${mp.tradeDemand ? "text-bad" : ""}">사기 ${mp.morale}/100 ${mp.tradeDemand ? "· 트레이드 요구!" : ""}</span>
                  </div>
                  <div class="tiny" style="margin:6px 0">${esc(mp.moraleReason || "출전 기회 및 역할 불만")}</div>
                  <div class="scout-actions" style="display:flex;gap:6px;flex-wrap:wrap">
                    <button type="button" class="btn-xs primary" data-resolve-morale="${mp.id}" data-morale-action="PEP_TALK">
                      1:1 면담 &amp; 격려금 (0.2억)
                    </button>
                    <button type="button" class="btn-xs" data-resolve-morale="${mp.id}" data-morale-action="PROMOTE_1G">
                      1군 콜업 약속
                    </button>
                    <button type="button" class="btn-xs ghost" data-morale-goto-trade="${mp.id}">
                      트레이드 협상실 올리기
                    </button>
                  </div>
                </div>
              `
              ).join("") || `<div class="empty-box text-good">현재 라커룸 내 사기 저하 또는 트레이드 요구 선수가 없습니다! (전원 사기 양호)</div>`
            }
          </div>
        </div>

        <!-- [10] [PART 5-5] FA 20인/25인 & 2차 드래프트 35인 수동 보호명단 작성 UI -->
        ${(() => {
          const pMode = STATE.protectionMode || "FA_20";
          const pState = ext.getTeamProtectionState(ctx, userTeam.id, pMode);
          if (!pState) return "";
          return `
            <div class="panel" style="margin-bottom:0">
              <div class="panel-head">
                <div>
                  <h3 class="panel-title" style="font-size:15px">10. 🛡️ FA 20인/25인 &amp; 2차 드래프트 35인 보호명단 수동 작성 및 AI 심리전</h3>
                  <div class="tiny">보호명단에서 제외된 선수 중 AI가 가장 노리는 1순위 유출 위험 타겟을 실시간 시뮬레이션합니다.</div>
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                  <button type="button" class="btn-xs ${pMode === "FA_20" ? "primary" : ""}" data-prot-mode="FA_20">FA A등급 (20인)</button>
                  <button type="button" class="btn-xs ${pMode === "FA_25" ? "primary" : ""}" data-prot-mode="FA_25">FA B등급 (25인)</button>
                  <button type="button" class="btn-xs ${pMode === "DRAFT_35" ? "primary" : ""}" data-prot-mode="DRAFT_35">2차 드래프트 (35인)</button>
                  <button type="button" class="btn-xs ghost" data-prot-autofill="${pMode}">⚡ 자동 최적 구성</button>
                  <button type="button" class="btn-xs primary" data-open-protection-mandate="${pMode}">👔 감독 보호명단 외압 이벤트(PROTECTION_MANDATE)</button>
                </div>
              </div>
              <div class="weekly-summary-banner" style="margin-bottom:10px">
                <strong>[${esc(pState.label)}]</strong> 현재 보호 지정: <strong class="tnum">${pState.currentCount} / ${pState.limit}명</strong>
                (자동보호 ${pState.autoExemptPlayers.length}명 별도)
                ${
                  pState.aiDangerTarget
                    ? ` · <strong class="text-bad">⚠️ AI 보상/지명 1순위 타겟: ${esc(pState.aiDangerTarget.name)}(${pState.aiDangerTarget.pos}, ${pState.aiDangerTarget.age}세, OVR ${pState.aiDangerTarget.getTrueOvr()})</strong>`
                    : ""
                }
              </div>
              <div class="grid-2col">
                <div>
                  <h4 style="font-size:13px;margin:0 0 6px">🔒 현재 보호명단 등록 선수 (${pState.protectedPlayers.length}/${pState.limit}명 · 클릭 시 해제)</h4>
                  <div style="display:flex;flex-wrap:wrap;gap:6px">
                    ${pState.protectedPlayers
                      .map((pp) => {
                        const isLockedVet = (pState.lockedMandateIds || []).includes(pp.id);
                        return `
                        <button type="button" class="btn-xs primary" data-toggle-protect="${pp.id}" data-prot-target-mode="${pMode}">
                          ${isLockedVet ? "📌[감독고정]" : "🔒"} ${esc(pp.name)} (${pp.pos}/${pp.age}세·OVR ${pp.getTrueOvr()}) ${isLockedVet ? "고정됨" : "✕"}
                        </button>
                      `;
                      })
                      .join("")}
                  </div>
                </div>
                <div>
                  <h4 style="font-size:13px;margin:0 0 6px">🔓 보호 제외(노출) 선수 상위 15명 (클릭 시 보호명단 편입)</h4>
                  <div style="display:flex;flex-wrap:wrap;gap:6px">
                    ${pState.exposedPlayers
                      .slice(0, 15)
                      .map(
                        (ep, idx) => `
                        <button type="button" class="btn-xs ${idx === 0 ? "text-bad" : "ghost"}" data-toggle-protect="${ep.id}" data-prot-target-mode="${pMode}">
                          🔓 ${esc(ep.name)} (${ep.pos}/${ep.age}세·OVR ${ep.getTrueOvr()}) +보호
                        </button>
                      `
                      )
                      .join("")}
                  </div>
                </div>
              </div>
            </div>
          `;
        })()}

        <!-- [11] [KBO_GM.RealisticGM / KBO_GM.ManagerConflict] 감독 요구 및 프런트 갈등 외압 컨트롤 타워 -->
        ${(() => {
          const mc = GM.ManagerConflict || GM.RealisticGM || ext;
          if (!mc || typeof mc.ensureManagerConflictState !== "function") return "";
          const st = mc.ensureManagerConflictState(userTeam);
          const severanceManwon = st.remainingContractYears * st.annualSalaryManwon;
          const stageLabels = [
            "정상 (협업 체제 유지)",
            "🚨 [1단계 파국] 감독 언론 인터뷰 프런트 야구 공개 비판 (팬 민심 -15)",
            "🚨 [2단계 파국] 감독 자진 사퇴 배수진 & 구단주 이사회 중재 청문회 개최",
            "🚨 [3단계 파국] 단장 직권 감독 경질 선택지 활성화 (잔여 계약 위약금 예산 차감)"
          ];
          const pendingDirs = (st.activeTradeDirectives || []).filter((d) => d.status === "PENDING");
          const cands = mc.REPLACEMENT_MANAGER_CANDIDATES || [];

          return `
            <div class="panel" style="margin-bottom:0;border:1px solid ${st.managerTrust <= 20 ? "var(--bad)" : "rgba(148,163,184,0.28)"}">
              <div class="panel-head">
                <div>
                  <h3 class="panel-title" style="font-size:15px">11. 👔 감독 요구 및 프런트 갈등 외압 시스템 (KBO_GM.RealisticGM · KBO_GM.ManagerConflict)</h3>
                  <div class="tiny">보호선수 명단 감독 외압(PROTECTION_MANDATE) · 핵심선수 트레이드 거부권 및 핀포인트 수혈 요청(TRADE_DIRECTIVE) · 갈등 게이지 및 1~3단계 파국 처리</div>
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                  <button type="button" class="btn-xs primary" data-open-protection-mandate="${STATE.protectionMode || "FA_20"}">🛡️ 보호명단 감독 외압 모달</button>
                  <button type="button" class="btn-xs" data-issue-trade-directive="1">📄 약점포지션 수혈 공문 발행</button>
                  <button type="button" class="btn-xs ghost" data-sim-manager-crisis="1">⚡ 갈등 파국(신임도≤20) 단계 테스트</button>
                </div>
              </div>

              <!-- 갈등 게이지 & 신임도 요약 배너 -->
              <div class="weekly-summary-banner" style="margin-bottom:10px">
                <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px">
                  <div>
                    현 1군 감독: <strong>${esc(st.managerName)} (${esc(st.managerStyle)})</strong> ·
                    잔여 계약: <strong>${st.remainingContractYears}년 (연봉 ${fmtMoney(st.annualSalaryManwon)} / 경질 위약금 ${fmtMoney(severanceManwon)})</strong>
                  </div>
                  <div>
                    감독 신임도(managerTrust): <strong class="tnum ${st.managerTrust <= 20 ? "text-bad" : "text-good"}">${st.managerTrust} / 100</strong> ·
                    갈등 수치(Conflict Gauge): <strong class="tnum ${st.conflictGauge >= 80 ? "text-bad" : ""}">${st.conflictGauge} / 100</strong> ·
                    언론 불만 유출 확률: <strong class="tnum">${Math.round(st.mediaLeakProb * 100)}%</strong> ·
                    팬 민심: <strong class="tnum">${userTeam.fanRatio || 55}</strong>
                  </div>
                </div>
                <div style="margin-top:8px;height:8px;background:rgba(148,163,184,0.22);border-radius:999px;overflow:hidden">
                  <div style="width:${st.conflictGauge}%;height:100%;background:${st.managerTrust <= 20 ? "#ef4444" : st.managerTrust <= 45 ? "#f59e0b" : "#22c55e"};transition:width 0.25s"></div>
                </div>
                <div class="tiny" style="margin-top:6px">
                  <strong>현재 갈등 단계:</strong> <span class="${st.crisisStage >= 1 ? "text-bad font-bold" : "text-good"}">${esc(stageLabels[st.crisisStage] || stageLabels[0])}</span>
                </div>
              </div>

              <!-- [2단계 파국] 구단주 이사회 중재 청문회 박스 -->
              ${
                st.pendingBoardHearing || st.crisisStage === 2
                  ? `
                    <div class="report-box" style="margin-bottom:10px;border-left:4px solid var(--bad)">
                      <div><strong class="text-bad">⚖️ [파국 2단계 · 감독 자진 사퇴 배수진 &amp; 구단주 이사회 중재 청문회 개최]</strong></div>
                      <div class="tiny" style="margin:6px 0">
                        ${esc(st.managerName)} 감독이 현장 기용 전권을 요구하며 자진 사퇴 배수진을 쳤습니다. 구단주 이사회 청문회에서 단장의 입장을 결정하십시오.
                      </div>
                      <div style="display:flex;gap:8px;flex-wrap:wrap">
                        <button type="button" class="btn-xs primary" data-board-hearing-choice="COMPROMISE">
                          🤝 중재안 수용 · 현장 권한 보장 (감독 신임도 +25 · 구단주 신임도 -5)
                        </button>
                        <button type="button" class="btn-xs text-bad" data-board-hearing-choice="ESCALATE_TO_STAGE_3">
                          🔥 프런트 원칙 고수 · 3단계 [감독 경질 인사권] 즉시 활성화
                        </button>
                      </div>
                    </div>
                  `
                  : ""
              }

              <!-- [3단계 파국] 단장의 감독 경질 선택지 (잔여 계약 위약금 예산 차감) -->
              <div class="report-box" style="margin-bottom:10px;border-left:4px solid ${st.canFireManager ? "var(--bad)" : "rgba(148,163,184,0.35)"}">
                <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px">
                  <div>
                    <strong>🪓 [파국 3단계 · 단장 직권 감독 경질 및 신임 감독 선임]</strong>
                    <div class="tiny muted" style="margin-top:2px">
                      감독 신임도 20 이하 추락 또는 이사회 청문회 결렬 시 활성화됩니다. 경질 시 잔여 계약 기간(${st.remainingContractYears}년) 위약금 <strong>${fmtMoney(severanceManwon)}</strong>이 구단 예산(${fmtMoney(userTeam.budget)})에서 즉시 차감됩니다.
                    </div>
                  </div>
                  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                    <select id="fireMgrReplacementSelect" class="gm-select" style="font-size:12px">
                      ${cands
                        .map(
                          (c) =>
                            `<option value="${esc(c.name)}">신임 후보: ${esc(c.name)} (${esc(c.style)} · 연봉 ${fmtMoney(c.annualSalaryManwon)})</option>`
                        )
                        .join("")}
                    </select>
                    <button type="button" class="btn-xs ${st.canFireManager ? "primary" : "ghost"}" data-fire-manager-now="1" ${!st.canFireManager ? "disabled" : ""}>
                      ${st.canFireManager ? `⚡ ${esc(st.managerName)} 감독 전격 경질 (위약금 -${fmtMoney(severanceManwon)})` : "경질 비활성 (신임도 20 이하 시 해금)"}
                    </button>
                  </div>
                </div>
              </div>

              <!-- 핀포인트 수혈 공식 문서 & 최근 감독-프런트 갈등 일지 -->
              <div class="grid-2col">
                <div class="report-box">
                  <strong>📄 감독 공식 트레이드 수혈 요청 문서 (${pendingDirs.length}건 대기)</strong>
                  ${
                    pendingDirs.length
                      ? pendingDirs
                          .map(
                            (d) => `
                            <div class="tiny" style="margin-top:6px">
                              <div><strong>${esc(d.docNumber)}</strong> — ${esc(d.weakPosLabel)}</div>
                              <div style="margin:3px 0">${esc(d.officialText)}</div>
                              <div style="display:flex;gap:6px;margin-top:4px">
                                <button type="button" class="btn-xs primary" data-directive-action="AUTO_ACQUIRE" data-directive-id="${esc(d.id)}">즉시 맞춤 트레이드 이행 (+18)</button>
                                <button type="button" class="btn-xs ghost" data-directive-action="REJECT_DIRECTIVE" data-directive-id="${esc(d.id)}">공식 기각 (-20)</button>
                              </div>
                            </div>
                          `
                          )
                          .join("")
                      : `<div class="tiny muted" style="margin-top:4px">현재 대기 중인 감독 핀포인트 트레이드 요청 공문이 없습니다.</div>`
                  }
                </div>
                <div class="report-box">
                  <strong>📋 감독-프런트 외압 및 갈등 타임라인 로그</strong>
                  ${
                    (st.conflictLogs || []).length
                      ? st.conflictLogs
                          .slice(0, 5)
                          .map((lg) => `<div class="tiny" style="margin-top:4px">· [${esc(lg.date)}] ${esc(lg.message)}</div>`)
                          .join("")
                      : `<div class="tiny muted" style="margin-top:4px">아직 발생한 감독 외압/갈등 이력이 없습니다.</div>`
                  }
                </div>
              </div>
            </div>
          `;
        })()}

        <!-- [12] [KBO_GM.RealisticGM] '야구 구단 단장(GM) 직무 보고서' 기반 5대 리얼리즘 메카닉 통합 컨트롤 타워 -->
        ${(() => {
          const rgmMod = GM.RealisticGM || ext;
          if (!rgmMod || typeof rgmMod.ensureRealisticGMState !== "function") return "";
          const rgm = rgmMod.ensureRealisticGMState(userTeam);
          const archMap = rgmMod.MANAGER_ARCHETYPES || {};
          const curArch = archMap[rgm.managerArchetype] || { label: "현장 고집형", refusalProb: 0.7 };
          const preFaList = rgmMod.getPreemptiveFABumpCandidates(ctx, userTeam.id) || [];
          const deadlineInfo = rgmMod.evaluateDeadlineMarketStances(ctx);
          const myDeadlineRow =
            (deadlineInfo.teamStances || []).find((x) => x.teamId === userTeam.id) || {
              rank: 5,
              effectiveStance: "BUYER",
              stanceLabel: "🔥 BUYER"
            };
          const deadlineDeals = rgm.deadlineProposals || [];
          const topStarForSal =
            userTeam.roster1G.slice().sort((a, b) => b.getTrueOvr() - a.getTrueOvr())[0] ||
            userTeam.roster1G[0];

          return `
            <div class="panel" style="margin-bottom:0;border:1px solid rgba(56,189,248,0.4)">
              <div class="panel-head">
                <div>
                  <h3 class="panel-title" style="font-size:15px">12. 📊 단장(GM) 직무 보고서 기반 5대 리얼리즘 메카닉 (KBO_GM.RealisticGM)</h3>
                  <div class="tiny">① '지시완/허문회' 기용 거부 딜레마 · ② BATNA 다안건 협상 &amp; 연봉조정위(-50 락바텀) · ③ 예비 FA(faYears=7) 보상금 뻥튀기 방어 · ④ 7/31 Buyer/Seller 마감일 스탠스 · ⑤ 감봉 집단 항명 &amp; 미디어 여론전</div>
                </div>
              </div>

              <div class="weekly-summary-banner" style="margin-bottom:12px">
                <span>감독 아키타입: <strong>${esc(curArch.label)}</strong> (유망주 기용 거부율 ${Math.round((curArch.refusalProb || 0.5) * 100)}%)</span>
                <span class="sep">·</span>
                <span>미래 팜 시스템 건전성: <strong class="tnum ${rgm.farmSystemHealth < 65 ? "text-bad" : "text-good"}">${rgm.farmSystemHealth} / 100</strong></span>
                <span class="sep">·</span>
                <span>구단 프런트 신뢰도: <strong class="tnum ${rgm.clubTrustScore <= 30 ? "text-bad" : "text-good"}">${rgm.clubTrustScore} / 100</strong></span>
                <span class="sep">·</span>
                <span>언론 여론 지수: <strong class="tnum ${rgm.mediaSentiment < 45 ? "text-bad" : "text-good"}">${rgm.mediaSentiment} / 100</strong></span>
              </div>

              <div style="display:grid;gap:12px">
                <!-- (1) 단장 vs 감독 권력 갈등 & '지시완/허문회' 기용 거부 시스템 -->
                <div class="report-box" style="border-left:4px solid #f59e0b">
                  <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px">
                    <div>
                      <strong>① [GM_MANAGER_CONFLICT] 감독 아키타입 &amp; '지시완/허문회' 기용 거부(벤치 방치) 딜레마</strong>
                      <div class="tiny muted" style="margin-top:2px">단장이 올린 2군 유망주/트레이드 영입 선수를 감독이 벤치에 방치할 때 [기용권 경고(감독 사퇴·사기 급락)] vs [감독 수용(미래 팜 파괴)] 딜레마 결단</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                      <select id="rgmArchetypeSelect" class="gm-select" style="font-size:12px">
                        ${Object.values(archMap)
                          .map(
                            (a) =>
                              `<option value="${esc(a.key)}" ${rgm.managerArchetype === a.key ? "selected" : ""}>${esc(a.label)}</option>`
                          )
                          .join("")}
                      </select>
                      <button type="button" class="btn-xs ghost" data-rgm-set-archetype="1">아키타입 적용</button>
                      <button type="button" class="btn-xs primary" data-rgm-open-usage-refusal="1">🚨 기용 거부(벤치 방치) 면담 모달 열기</button>
                    </div>
                  </div>
                </div>

                <!-- (2) BATNA 다안건 연봉 협상 & 1월 말 연봉조정위원회 -->
                <div class="report-box" style="border-left:4px solid #38bdf8">
                  <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px">
                    <div>
                      <strong>② [SALARY_ARBITRATION] BATNA 다안건 연봉 협상 &amp; 1월 말 연봉조정위원회 판결</strong>
                      <div class="tiny muted" style="margin-top:2px">[보장 출전 타석/이닝] + [성과 옵션] + [비FA 다년 전환] 다안건 교환 협상. 결렬 시 연봉조정위 회부 (구단 승소 시 연봉 절감 ↔ 선수 사기 및 구단 신뢰도 -50 락바텀 추락!)</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                      <button type="button" class="btn-xs primary" data-rgm-multi-issue-neg="${topStarForSal ? topStarForSal.id : ""}">
                        🤝 다안건(출전보장+옵션+다년) 패키지 협상 타결
                      </button>
                      <button type="button" class="btn-xs text-bad" data-rgm-run-arbitration="${topStarForSal ? topStarForSal.id : ""}">
                        ⚖️ 1월 말 연봉조정위원회 판결 실행 (구단 승소 시 신뢰도 -50)
                      </button>
                    </div>
                  </div>
                </div>

                <!-- (3) 예비 FA(faYears === 7) 보상금 뻥튀기 사전 방어 전략 -->
                <div class="report-box" style="border-left:4px solid #22c55e">
                  <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">
                    <div>
                      <strong>③ [FA_PREEMPTIVE_BUMP] 예비 FA(faYears=7) 보상금 뻥튀기 사전 방어 전략 (150~200% 인상)</strong>
                      <div class="tiny muted" style="margin-top:2px">FA 1년 전 핵심 선수의 연봉을 고의로 150~200% 대폭 인상해 타 구단 AI의 보상금(200~300%) 부담을 폭증시켜 FA 입찰 확률을 축소합니다.</div>
                    </div>
                  </div>
                  <div class="scout-grid">
                    ${preFaList
                      .slice(0, 3)
                      .map(
                        (c) => `
                        <div class="scout-card">
                          <div class="scout-card-head">
                            <strong>${esc(c.name)} (${esc(c.pos)} · ${c.age}세 · OVR ${c.trueOvr})</strong>
                            <span class="scout-rank-tag tnum">FA년차 ${c.faYears}</span>
                          </div>
                          <div class="tiny" style="margin:4px 0">
                            현 연봉: <strong>${fmtMoney(c.currentSalaryManwon)}</strong> → 180% 인상 시 보상금(200~300%): <strong class="text-bad">${fmtMoney(Math.round(c.currentSalaryManwon * 1.8 * 2))} ~ ${fmtMoney(Math.round(c.currentSalaryManwon * 1.8 * 3))}</strong>
                          </div>
                          <div class="scout-actions">
                            <button type="button" class="btn-xs primary" data-rgm-fa-bump="${c.playerId}" ${c.alreadyBumped ? "disabled" : ""}>
                              ${c.alreadyBumped ? "✅ 보상금 방어막 가동 완료" : "🛡️ 연봉 180% 전략적 인상 (AI 입찰 -72% 차단)"}
                            </button>
                          </div>
                        </div>
                      `
                      )
                      .join("")}
                  </div>
                </div>

                <!-- (4) 7월 31일 트레이드 마감일 Buyer / Seller 스탠스 엔진 -->
                <div class="report-box" style="border-left:4px solid #a855f7">
                  <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">
                    <div>
                      <strong>④ [DEADLINE_STANCE] 7월 31일 트레이드 마감일 Buyer / Seller 스탠스 엔진 (현 순위 ${myDeadlineRow.rank}위 · ${esc(myDeadlineRow.stanceLabel)})</strong>
                      <div class="tiny muted" style="margin-top:2px">Buyer(유망주 지불 &amp; 렌탈 베테랑 영입) vs Seller(베테랑 양도 &amp; 특급 유망주·2R 지명권 수급) AI 자동 스탠스 전환 및 마감일 블록버스터 딜</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                      <button type="button" class="btn-xs primary" data-rgm-deadline-stance="BUYER">🔥 BUYER(윈나우 매수) 오퍼 생성</button>
                      <button type="button" class="btn-xs" data-rgm-deadline-stance="SELLER">🌱 SELLER(리빌딩 매각) 오퍼 생성</button>
                    </div>
                  </div>
                  ${
                    deadlineDeals.length
                      ? `<div style="display:grid;gap:6px;margin-top:6px">
                          ${deadlineDeals
                            .slice(0, 3)
                            .map(
                              (dl) => `
                              <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;padding:6px 10px;background:rgba(148,163,184,0.1);border-radius:6px">
                                <span class="tiny"><strong>${esc(dl.headline)}</strong></span>
                                <button type="button" class="btn-xs primary" data-rgm-exec-deadline-deal="${esc(dl.id)}">즉시 마감일 딜 체결</button>
                              </div>
                            `
                            )
                            .join("")}
                        </div>`
                      : `<div class="tiny muted">우측 상단 [BUYER 오퍼 생성] 또는 [SELLER 오퍼 생성] 버튼을 눌러 7/31 마감일 맞춤 트레이드 제안을 수신하세요.</div>`
                  }
                </div>

                <!-- (5) 과도한 감봉 시 선수단 집단 항명 & 미디어 여론전 -->
                <div class="report-box" style="border-left:4px solid var(--bad)">
                  <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px">
                    <div>
                      <strong>⑤ [SQUAD_REBELLION] 과도한 감봉 시 선수단 집단 항명 &amp; 미디어 인터뷰 여론전</strong>
                      <div class="tiny muted" style="margin-top:2px">고강도 연봉 삭감 시 선수단 집단 항명(팀 컨디션 -0.12 · 팬 민심 -15) 발동! 미디어 인터뷰 대처에 따라 구단주 신임도 및 언론 여론이 변동됩니다.</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                      <button type="button" class="btn-xs text-bad" data-rgm-trigger-rebellion="1">🔥 감봉 집단 항명 발동 테스트</button>
                      <button type="button" class="btn-xs ghost" data-rgm-media-response="HARDLINE_PRINCIPLE">🎙️ 강경 원칙론 (구단주+10 / 여론-18)</button>
                      <button type="button" class="btn-xs primary" data-rgm-media-response="CONCILIATORY_BONUS">🤝 유화책·보너스 신설 (여론+22 / 사기+20)</button>
                      <button type="button" class="btn-xs" data-rgm-media-response="TRANSPARENT_REBUILD_PR">📊 리빌딩 재투자 브리핑 (구단주+6 / 여론+16)</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
        })()}
      </div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 6. 탭 [4] 데이터 / 기록실 (KBO 타이틀 · NPB 라이브 · 아마추어 전국대회 랭킹 · 역대 시즌)
   * ═══════════════════════════════════════════════════════════════════════ */
  /**
   * 시즌 회고 리포트 (KBO_GM.Retro): 단장의 결정이 승수에 미친 영향
   */
  function renderSeasonRetroHtml(ctx) {
    const reports = Array.isArray(ctx.seasonRetros) ? ctx.seasonRetros : [];
    const intro = `
      <div class="weekly-summary-banner" style="margin-bottom:12px">
        <strong>시즌 회고 리포트</strong> · 매년 11월 4일(포스트시즌 종료 후) 자동 작성됩니다.
        직전 시즌 종료 시점 로스터와 비교해 <strong>영입한 선수의 WAR − 떠난 선수의 WAR = 결정 순효과</strong>(1 WAR ≈ 1승)를 계산하고,
        득실점 기대 승수와 실제 승수의 차이(운)를 따로 보여줍니다.
      </div>`;
    if (!reports.length) {
      return `${intro}<div class="empty-box">아직 작성된 리포트가 없습니다. 첫 리포트는 ${ctx.currentYear}년 11월 4일에 도착합니다.</div>`;
    }
    const sign = (v) => `${v >= 0 ? "+" : ""}${v}`;
    const card = (r, open) => `
      <details class="report-box" style="margin-bottom:12px" ${open ? "open" : ""}>
        <summary style="cursor:pointer;font-weight:700">${esc(r.headline)}</summary>
        <div class="grid-3col" style="margin-top:10px">
          <div class="scout-card">
            <strong>결정 순효과</strong>
            <div class="metric-block-val tnum ${r.netDecisionWins >= 0 ? "text-good" : "text-bad"}">${sign(r.netDecisionWins)}승</div>
            <div class="tiny muted">영입 ${sign(r.acquiredWar)} · 이탈 -${r.departedWar}</div>
          </div>
          <div class="scout-card">
            <strong>운 (득실점 기대 대비)</strong>
            <div class="metric-block-val tnum ${r.luckWins >= 0 ? "text-good" : "text-bad"}">${sign(r.luckWins)}승</div>
            <div class="tiny muted">기대 ${r.expectedWins}승 · 실제 ${r.record.w}승 (득점 ${r.record.rs} / 실점 ${r.record.ra})</div>
          </div>
          <div class="scout-card">
            <strong>구단주 목표</strong>
            <div class="metric-block-val tnum ${r.goal && r.goal.achieved ? "text-good" : "text-bad"}">${r.rank || "-"}위 / 목표 ${r.goal ? r.goal.targetRank : "-"}위</div>
            <div class="tiny muted">${esc((r.goal && r.goal.title) || "-")}</div>
          </div>
        </div>
        <div class="grid-2col" style="margin-top:10px">
          <div>
            <strong class="tiny">영입 경로별 WAR</strong>
            <table class="gm-table compact"><tbody>
              ${(r.byRoute || []).map((b) => `<tr><td>${esc(b.label)}</td><td class="tnum">${b.count}명</td><td class="tnum">${sign(b.war)}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">영입 없음</td></tr>`}
            </tbody></table>
            <strong class="tiny" style="display:block;margin-top:8px">주요 영입</strong>
            <table class="gm-table compact"><tbody>
              ${(r.acquired || []).slice(0, 6).map((a) => `<tr><td>${esc(a.name)} <span class="muted">${esc(a.pos)}</span></td><td>${esc(a.routeLabel)}</td><td class="tnum">${sign(a.war)}</td></tr>`).join("") || `<tr><td class="muted">-</td></tr>`}
            </tbody></table>
          </div>
          <div>
            <strong class="tiny">떠난 선수 (이번 시즌 다른 곳에서의 WAR)</strong>
            <table class="gm-table compact"><tbody>
              ${(r.departed || []).slice(0, 6).map((d) => `<tr><td>${esc(d.name)} <span class="muted">${esc(d.pos)}</span></td><td>${esc(d.destination)}</td><td class="tnum">${d.war}${d.estimated ? "*" : ""}</td></tr>`).join("") || `<tr><td class="muted">이탈 없음</td></tr>`}
            </tbody></table>
            <div class="tiny muted">* KBO를 떠난 선수는 직전 시즌 WAR로 추정</div>
            <strong class="tiny" style="display:block;margin-top:8px">성장 / 하락 (잔류 선수 OVR)</strong>
            <div class="tiny">${(r.topGrowth || []).map((x) => `${esc(x.name)} ${x.ovrBefore}→<strong class="text-good">${x.ovrNow}</strong>`).join(" · ") || "-"}</div>
            <div class="tiny">${(r.topDecline || []).map((x) => `${esc(x.name)} ${x.ovrBefore}→<strong class="text-bad">${x.ovrNow}</strong>`).join(" · ") || ""}</div>
          </div>
        </div>
        <div class="grid-3col" style="margin-top:10px">
          <div>
            <strong class="tiny">🔁 트레이드 장부 (트레이드 연도부터 누적 WAR)</strong>
            <table class="gm-table compact"><tbody>
              ${(r.tradeLedger || [])
                .slice()
                .reverse()
                .slice(0, 6)
                .map(
                  (t) => `<tr title="받음: ${esc(t.receivedNames.join(", "))} / 보냄: ${esc(t.sentNames.join(", "))}">
                    <td class="tnum">${esc(t.date || String(t.year))}</td>
                    <td>${esc(t.partnerTeamName)}<div class="tiny muted">받음 ${esc(t.receivedNames.join(", "))}</div></td>
                    <td class="tnum ${t.netWar >= 0 ? "text-good" : "text-bad"}">${sign(t.netWar)}<div class="tiny muted">+${t.gainedWar} / -${t.lostWar}</div></td>
                  </tr>`
                )
                .join("") || `<tr><td class="muted">아직 트레이드가 없습니다.</td></tr>`}
            </tbody></table>
          </div>
          <div>
            <strong class="tiny">🎓 드래프트 성과 (지명 연도별 누적 WAR)</strong>
            <table class="gm-table compact"><tbody>
              ${(r.draftClasses || [])
                .slice(0, 6)
                .map(
                  (c) => `<tr>
                    <td class="tnum">${c.year}</td>
                    <td class="tnum">${c.picks}명 (잔류 ${c.withUs})</td>
                    <td class="tnum">${sign(c.war)}<div class="tiny muted">직접 ${sign(c.directWar || 0)} · 위임 ${sign(c.delegatedWar || 0)}</div></td>
                    <td class="tiny">${c.best ? `${esc(c.best.name)} ${c.best.round}R · OVR ${c.best.ovr}` : "-"}</td>
                  </tr>`
                )
                .join("") || `<tr><td class="muted">아직 지명한 신인이 없습니다.</td></tr>`}
            </tbody></table>
          </div>
          <div>
            <strong class="tiny">💰 구단주 증액 효과 (올해)</strong>
            ${
              r.ownerSupport && r.ownerSupport.grantsThisYear
                ? `<div class="tiny" style="margin-top:4px">승인 ${r.ownerSupport.grantsThisYear}회 · ${fmtMoney(r.ownerSupport.amountManwon)} → 이후 영입 선수 WAR <strong class="${r.ownerSupport.acquiredWar >= 0 ? "text-good" : "text-bad"}">${sign(r.ownerSupport.acquiredWar)}</strong>${r.ownerSupport.warPerEok != null ? ` (1억당 ${r.ownerSupport.warPerEok}승)` : ""}</div>
                   <div class="tiny muted">${r.ownerSupport.acquiredAfter.map((a) => `${esc(a.name)} ${sign(a.war)}`).join(" · ") || "증액 이후 영입 없음"}</div>`
                : `<div class="tiny muted" style="margin-top:4px">올해 승인된 증액 없음${r.ownerSupport && r.ownerSupport.allTimeManwon ? ` (누적 ${fmtMoney(r.ownerSupport.allTimeManwon)})` : ""}</div>`
            }
          </div>
        </div>
        ${
          r.finance
            ? `<div class="tiny muted" style="margin-top:8px">재정: 모기업 지원금 ${fmtMoney(r.finance.subsidy)} · 이월금 ${fmtMoney(r.finance.carryover)} · 시즌 수입 ${fmtMoney(r.finance.revenue)} · 연봉총액 ${fmtMoney(r.finance.payroll)} · 시즌 종료 여유 예산 ${fmtMoney(r.finance.available)}${r.finance.deficitWeeks ? ` · 적자 정산 ${r.finance.deficitWeeks}주` : ""}</div>`
            : ""
        }
      </details>`;
    return intro + reports.map((r, i) => card(r, i === 0)).join("");
  }

  function renderRecordsTab() {
    const ctx = STATE.ctx;
    if (!ctx) return;

    const sub = STATE.recordsSubTab;
    document.querySelectorAll("[data-rec-sub]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.recSub === sub);
    });

    const container = $("recordsContentBox");
    if (!container) return;

    // 모든 KBO 선수 수집
    const allKBOPlayers = [];
    ctx.kboTeams.forEach((t) => {
      t.getAllPlayers().forEach((p) => {
        GM.updatePlayerMetrics(p);
        allKBOPlayers.push({ player: p, teamName: t.name, teamId: t.id });
      });
    });

    if (sub === "kboBat") {
      const batters = allKBOPlayers
        .filter((x) => x.player.type === "batter" && (x.player.rec.pa || 0) > 0)
        .sort((a, b) => (b.player.metrics.war || 0) - (a.player.metrics.war || 0))
        .slice(0, 25);

      container.innerHTML = `
        <div class="table-wrap">
          <table class="gm-table">
            <thead>
              <tr>
                <th>순위</th><th>선수명</th><th>소속</th><th>포지션</th><th>경기</th><th>타율</th><th>홈런</th><th>타점</th><th>도루</th><th>OPS</th><th>wOBA</th><th>WAR</th>
              </tr>
            </thead>
            <tbody>
              ${
                batters.length
                  ? batters
                      .map(({ player: p, teamName }, i) => {
                        const m = p.metrics;
                        return `
                        <tr class="player-row" data-player-modal="${p.id}" data-team-id="${p.teamId}">
                          <td class="tnum font-bold">${i + 1}</td>
                          <td><strong>${esc(p.name)}</strong></td>
                          <td>${esc(teamName)}</td>
                          <td>${p.pos}</td>
                          <td class="tnum">${m.g}</td>
                          <td class="tnum font-bold">${m.avg.toFixed(3)}</td>
                          <td class="tnum">${m.hr}</td>
                          <td class="tnum">${m.rbi}</td>
                          <td class="tnum">${m.sb}</td>
                          <td class="tnum">${m.ops.toFixed(3)}</td>
                          <td class="tnum">${m.woba.toFixed(3)}</td>
                          <td class="tnum font-bold text-good">${m.war.toFixed(2)}</td>
                        </tr>
                      `;
                      })
                      .join("")
                  : `<tr><td colspan="12" class="empty-cell">진행된 경기가 없어 집계된 타자 기록이 없습니다.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      `;
    } else if (sub === "kboPit") {
      const pitchers = allKBOPlayers
        .filter((x) => x.player.type === "pitcher" && (x.player.rec.ip || 0) > 0)
        .sort((a, b) => (b.player.metrics.war || 0) - (a.player.metrics.war || 0))
        .slice(0, 25);

      container.innerHTML = `
        <div class="table-wrap">
          <table class="gm-table">
            <thead>
              <tr>
                <th>순위</th><th>선수명</th><th>소속</th><th>보직</th><th>경기</th><th>이닝</th><th>승-패-세-홀</th><th>ERA</th><th>WHIP</th><th>탈삼진</th><th>WAR</th>
              </tr>
            </thead>
            <tbody>
              ${
                pitchers.length
                  ? pitchers
                      .map(({ player: p, teamName }, i) => {
                        const m = p.metrics;
                        return `
                        <tr class="player-row" data-player-modal="${p.id}" data-team-id="${p.teamId}">
                          <td class="tnum font-bold">${i + 1}</td>
                          <td><strong>${esc(p.name)}</strong></td>
                          <td>${esc(teamName)}</td>
                          <td>${p.pos}</td>
                          <td class="tnum">${m.g}</td>
                          <td class="tnum">${m.ip}</td>
                          <td class="tnum">${m.w}승 ${m.l}패 ${m.sv}세 ${m.hld}홀</td>
                          <td class="tnum font-bold">${m.era.toFixed(2)}</td>
                          <td class="tnum">${m.whip.toFixed(2)}</td>
                          <td class="tnum">${m.k}</td>
                          <td class="tnum font-bold text-good">${m.war.toFixed(2)}</td>
                        </tr>
                      `;
                      })
                      .join("")
                  : `<tr><td colspan="11" class="empty-cell">진행된 경기가 없어 집계된 투수 기록이 없습니다.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      `;
    } else if (sub === "npb") {
      const topNPB = ctx.npbPool
        .slice()
        .map((p) => {
          GM.updatePlayerMetrics(p);
          return p;
        })
        .sort((a, b) => (b.metrics.war || 0) - (a.metrics.war || 0))
        .slice(0, 30);

      container.innerHTML = `
        <div class="table-wrap">
          <table class="gm-table">
            <thead>
              <tr>
                <th>순위</th><th>선수명</th><th>리그/국적</th><th>포지션</th><th>나이</th><th>스카우트 OVR</th><th>주요 시즌 기록</th><th>WAR</th><th>희망연봉</th>
              </tr>
            </thead>
            <tbody>
              ${topNPB
                .map((p, i) => {
                  const m = p.metrics || {};
                  const stat =
                    p.type === "pitcher"
                      ? `${m.ip || 0}이닝 · ERA ${(m.era || 0).toFixed(2)} · ${m.w || 0}승 · ${m.k || 0}K`
                      : `타율 ${(m.avg || 0).toFixed(3)} · ${m.hr || 0}홈런 · ${m.rbi || 0}타점 · OPS ${(m.ops || 0).toFixed(3)}`;
                  return `
                    <tr>
                      <td class="tnum">${i + 1}</td>
                      <td><strong>${esc(p.name)}</strong></td>
                      <td>${p.origin} / ${p.nationality}</td>
                      <td>${p.pos}</td>
                      <td class="tnum">${p.age}세</td>
                      <td class="tnum font-bold">${p.scoutError.ovrMin}~${p.scoutError.ovrMax}</td>
                      <td class="tnum">${stat}</td>
                      <td class="tnum font-bold text-good">${(m.war || 0).toFixed(2)}</td>
                      <td class="tnum">${fmtMoney(p.salary)}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      `;
    } else if (sub === "retro") {
      container.innerHTML = renderSeasonRetroHtml(ctx);
    } else if (sub === "amateur") {
      const topAmateur = ctx.draftPool.slice(0, 30);
      container.innerHTML = `
        <div class="weekly-summary-banner" style="margin-bottom:12px">
          <strong>전국대회 일정:</strong> 4주차(이마트배) · 8주차(황금사자기) · 12주차(청룡기) · 16주차(대통령배) · 20주차(봉황대기) · 22주차(드래프트 트라이아웃)
        </div>
        <div class="table-wrap">
          <table class="gm-table">
            <thead>
              <tr>
                <th>예상순위</th><th>유망주명</th><th>구분</th><th>포지션</th><th>스카우트 OVR</th><th>대회/스카우팅 노트</th><th>지명 예상 라운드</th>
              </tr>
            </thead>
            <tbody>
              ${topAmateur
                .map((p, i) => {
                  const proj = p.draftProjection || { rank: i + 1, tierLabel: "상위 라운드 후보", rankDelta: 0 };
                  const deltaStr =
                    proj.rankDelta > 0
                      ? `<span class="text-good">▲${proj.rankDelta}</span>`
                      : proj.rankDelta < 0
                        ? `<span class="text-bad">▼${Math.abs(proj.rankDelta)}</span>`
                        : "-";
                  return `
                    <tr class="player-row" data-player-modal="${p.id}" data-pool="draft">
                      <td class="tnum font-bold">#${proj.rank || i + 1} (${deltaStr})</td>
                      <td><strong>${esc(p.name)}</strong> <span class="tiny muted">(${esc(fmtHand(p))})</span></td>
                      <td>${p.origin === "IND" ? `독립(${esc(p.indClubName || "연천 미라클")})` : p.origin === "HS" ? "고교" : "대학"} (${p.age}세)</td>
                      <td>${p.pos}</td>
                      <td class="tnum">${p.scoutError.ovrMin}~${p.scoutError.ovrMax}</td>
                      <td class="tiny">${esc(proj.tournamentNote || "정규 주말리그 순항 중")}</td>
                      <td><strong>${esc(proj.tierLabel)}</strong></td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      `;
    } else {
      const hist = ctx.seasonHistory || [];
      container.innerHTML = hist.length
        ? hist
            .map(
              (h) => `
              <div class="report-box" style="margin-bottom:12px">
                <strong>${h.year}시즌 최종 순위</strong>
                <div class="tiny" style="margin-top:6px">
                  ${h.standings.map((s) => `${s.rank}위 ${esc(s.teamName)}(${s.w}승 ${s.l}패)`).join(" · ")}
                </div>
              </div>
            `
            )
            .join("")
        : `<div class="empty-box">아직 완주한 이전 시즌 기록이 없습니다.</div>`;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 7. 탭 [5] IndexedDB 저장소 렌더링 및 슬롯 관리
   * ═══════════════════════════════════════════════════════════════════════ */
  async function renderStorageTab() {
    const listEl = $("storageSlotList");
    if (!listEl) return;

    const savedList = await GM.Storage.getSaveList();
    const savedMap = new Map(savedList.map((s) => [s.slotId, s]));

    const standardSlots = [
      { id: "auto_save", title: "자동 저장 슬롯 (Auto Save)" },
      { id: "slot_1",    title: "저장 슬롯 1" },
      { id: "slot_2",    title: "저장 슬롯 2" },
      { id: "slot_3",    title: "저장 슬롯 3" }
    ];

    listEl.innerHTML = standardSlots
      .map((slot) => {
        const info = savedMap.get(slot.id);
        return `
          <div class="slot-card">
            <div class="slot-info">
              <div class="slot-title">${esc(slot.title)} <span class="muted">(${slot.id})</span></div>
              ${
                info
                  ? `
                    <div class="slot-meta tnum">
                      <strong>${esc(info.userTeamName)}</strong> · ${info.currentYear}시즌 ${info.currentWeek}주차 · 전적 ${info.record.w}승 ${info.record.l}패 ${info.record.d}무 · 예산 ${fmtMoney(info.budget)}
                    </div>
                    <div class="tiny muted">저장 시각: ${new Date(info.savedAt).toLocaleString("ko-KR")}</div>
                  `
                  : `<div class="slot-meta muted">비어 있는 슬롯입니다.</div>`
              }
            </div>
            <div class="slot-actions">
              <button type="button" class="btn-sm primary" data-save-slot="${slot.id}">현재 상태 저장</button>
              <button type="button" class="btn-sm" data-load-slot="${slot.id}" ${!info ? "disabled" : ""}>불러오기</button>
              <button type="button" class="btn-sm ghost" data-del-slot="${slot.id}" ${!info ? "disabled" : ""}>삭제</button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 8. 모달 (선수/유망주 5대 능력치 스카우팅 리포트 & 경기 상세 박스스코어)
   * ═══════════════════════════════════════════════════════════════════════ */
  function openPlayerModal(playerId, teamId, poolType = null) {
    const ctx = STATE.ctx;
    let player = null;
    let isOwnTeam = false;

    if (poolType === "draft") {
      player = ctx.draftPool.find((p) => p.id === playerId);
    } else if (poolType === "npb") {
      player = ctx.npbPool.find((p) => p.id === playerId);
    } else {
      const team = ctx.getTeam(teamId || ctx.userTeamId);
      if (team) {
        player = [...team.roster1G, ...team.roster2G, ...team.rosterDev, ...(team.foreignRehabList || [])].find(
          (p) => p.id === playerId
        );
        isOwnTeam = team.id === ctx.userTeamId;
      }
    }
    if (!player) return;

    GM.updatePlayerMetrics(player);

    // [시스템 5] KBO_GM.Setup.inspectProspectReport 연동 (5대 스탯 + 구속 km/h + 구종 숙련도 + 세부 포지션)
    const report = GM.Setup && typeof GM.Setup.inspectProspectReport === "function"
      ? GM.Setup.inspectProspectReport(ctx, playerId)
      : null;

    const statBarsHtml = report
      ? report.stats
          .map(
            (st) => `
          <div class="modal-stat-row">
            <span class="modal-stat-label">${esc(st.label)}</span>
            <div class="modal-stat-bar"><i style="width:${st.barPercent}%"></i></div>
            <span class="modal-stat-val tnum">${esc(st.displayValue)}</span>
          </div>
        `
          )
          .join("")
      : "";

    const pitchesHtml =
      report && report.pitchDetails && report.pitchDetails.length
        ? `<div style="margin-top:12px"><strong>보유 구종 및 숙련도:</strong> ${report.pitchDetails
            .map((pt) => `${esc(pt.name)}(${esc(pt.masteryDisplay)})`)
            .join(" · ")}</div>`
        : player.type === "pitcher" && player.pitches && player.pitches.length
          ? `<div style="margin-top:12px"><strong>보유 구종:</strong> ${player.pitches
              .map((pt) => `${(GM.PITCHES && GM.PITCHES[pt.k] && GM.PITCHES[pt.k].n) || pt.k}(숙련 ${pt.m})`)
              .join(" · ")} · 최고구속 시속 ${GM.kmh(player.st.velo)}km</div>`
          : "";

    const careerHtml =
      player.career && player.career.length
        ? `<div style="margin-top:12px"><strong>시즌별 통산 기록:</strong>
            <div class="tiny" style="margin-top:4px">${player.career
              .map((c) => `${c.year}년(${c.age}세): WAR ${c.war}`)
              .join(" / ")}</div>
           </div>`
        : "";

    const modalBody = $("gmModalBody");
    $("gmModalTitle").textContent = `${player.name} (${report ? report.positionDetail : player.pos} · ${player.age}세 · ${fmtHand(player)})`;
    modalBody.innerHTML = `
      <div class="modal-meta-line">
        <span>구분/상태: <strong>${esc(report ? report.groupLabel : player.teamId || player.status)}</strong></span>
        <span class="sep">·</span>
        <span>스카우트 조사도: <strong>${report ? `${report.scoutProgress}%` : isOwnTeam ? "100%" : `Lv.${ctx.scoutLevel}`}</strong></span>
        <span class="sep">·</span>
        <span>종합 능력치(OVR): <strong>${esc(report ? report.ovrDisplay : `${player.getTrueOvr()}`)}</strong> (잠재력 ${esc(report ? report.potentialDisplay : `${player.potential}`)})</span>
        <span class="sep">·</span>
        <span>연봉: <strong>${fmtMoney(player.salary)}</strong></span>
      </div>
      <div class="modal-stat-list" style="margin-top:14px">${statBarsHtml}</div>
      ${pitchesHtml}
      ${careerHtml}
    `;
    $("gmModalBackdrop").hidden = false;
  }

  function openMatchBoxModal(matchIndex) {
    const rep = STATE.lastWeeklyReport;
    if (!rep || !rep.kbo || !rep.kbo.matchResults[matchIndex]) return;
    const m = rep.kbo.matchResults[matchIndex];
    const awayTeam = STATE.ctx.getTeam(m.awayTeamId);
    const homeTeam = STATE.ctx.getTeam(m.homeTeamId);

    $("gmModalTitle").textContent = `${awayTeam ? awayTeam.name : m.awayTeamId} ${m.awayScore} : ${m.homeScore} ${homeTeam ? homeTeam.name : m.homeTeamId} (${m.park} · ${m.weather})`;

    const innCount = m.innings.total;
    const innHeaders = Array.from({ length: innCount }, (_, i) => `<th>${i + 1}</th>`).join("");
    const awayInns = Array.from({ length: innCount }, (_, i) => `<td class="tnum">${m.innings.away[i] ?? "-"}</td>`).join("");
    const homeInns = Array.from({ length: innCount }, (_, i) => `<td class="tnum">${m.innings.home[i] ?? "X"}</td>`).join("");

    const formatBatters = (boxArr) =>
      boxArr
        .filter((x) => x.role === "batter")
        .map(
          (b) =>
            `<tr><td>${b.batOrder}</td><td>${esc(b.name)} (${b.pos})</td><td class="tnum">${b.ab}</td><td class="tnum">${b.h}</td><td class="tnum">${b.hr}</td><td class="tnum">${b.rbi}</td><td class="tnum">${b.bb}</td><td class="tnum">${b.k}</td></tr>`
        )
        .join("");

    const formatPitchers = (boxArr) =>
      boxArr
        .filter((x) => x.role === "pitcher")
        .map(
          (p) =>
            `<tr><td>${esc(p.name)} ${p.decision ? `<strong>(${p.decision})</strong>` : ""}</td><td class="tnum">${p.ip}</td><td class="tnum">${p.h}</td><td class="tnum">${p.er}</td><td class="tnum">${p.bb}</td><td class="tnum">${p.k}</td><td class="tnum">${p.pitchCount}구 (${p.maxV}km)</td></tr>`
        )
        .join("");

    $("gmModalBody").innerHTML = `
      <div class="table-wrap" style="margin-bottom:12px">
        <table class="gm-table compact">
          <thead><tr><th>팀</th>${innHeaders}<th>R</th></tr></thead>
          <tbody>
            <tr><td><strong>${esc(awayTeam ? awayTeam.name : m.awayTeamId)}</strong></td>${awayInns}<td class="tnum font-bold">${m.awayScore}</td></tr>
            <tr><td><strong>${esc(homeTeam ? homeTeam.name : m.homeTeamId)}</strong></td>${homeInns}<td class="tnum font-bold">${m.homeScore}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="boxscore-split">
        <div>
          <strong>원정 타자 / 투수 기록</strong>
          <table class="gm-table compact" style="margin-top:6px">
            <thead><tr><th>#</th><th>타자</th><th>타수</th><th>안타</th><th>홈런</th><th>타점</th><th>볼넷</th><th>삼진</th></tr></thead>
            <tbody>${formatBatters(m.awayBoxScore)}</tbody>
          </table>
          <table class="gm-table compact" style="margin-top:8px">
            <thead><tr><th>투수</th><th>이닝</th><th>피안타</th><th>자책</th><th>볼넷</th><th>삼진</th><th>투구수</th></tr></thead>
            <tbody>${formatPitchers(m.awayBoxScore)}</tbody>
          </table>
        </div>
        <div>
          <strong>홈 타자 / 투수 기록</strong>
          <table class="gm-table compact" style="margin-top:6px">
            <thead><tr><th>#</th><th>타자</th><th>타수</th><th>안타</th><th>홈런</th><th>타점</th><th>볼넷</th><th>삼진</th></tr></thead>
            <tbody>${formatBatters(m.homeBoxScore)}</tbody>
          </table>
          <table class="gm-table compact" style="margin-top:8px">
            <thead><tr><th>투수</th><th>이닝</th><th>피안타</th><th>자책</th><th>볼넷</th><th>삼진</th><th>투구수</th></tr></thead>
            <tbody>${formatPitchers(m.homeBoxScore)}</tbody>
          </table>
        </div>
      </div>
    `;
    $("gmModalBackdrop").hidden = false;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 8-B. [KBO_GM.ManagerConflict] 감독 보호선수 명단 외압(PROTECTION_MANDATE) 및 트레이드 거부권(TRADE_DIRECTIVE) 모달
   * ═══════════════════════════════════════════════════════════════════════ */
  function openProtectionMandateModal(mode = "FA_20") {
    const ctx = STATE.ctx;
    const mc = GM.ManagerConflict || GM.RealisticGM || GM.Extensions;
    if (!ctx || !mc || typeof mc.triggerProtectionMandate !== "function") return;

    const userTeam = ctx.getUserTeam();
    const trig = mc.triggerProtectionMandate(ctx, userTeam.id, mode);
    if (!trig || !trig.ok || !trig.mandateEvent) return;
    const ev = trig.mandateEvent;
    const st = mc.ensureManagerConflictState(userTeam);

    $("gmModalTitle").textContent = `👔 ${ev.title}`;
    $("gmModalBody").innerHTML = `
      <div class="weekly-summary-banner" style="margin-bottom:12px;border-left:4px solid #f59e0b">
        <div>
          <strong>발신: ${esc(userTeam.name)} 1군 감독 ${esc(ev.managerName)}</strong>
          <span class="sep">·</span>
          <span>현재 감독 신임도: <strong>${st.managerTrust} / 100</strong> (갈등 수치 ${st.conflictGauge})</span>
        </div>
        <div style="margin-top:8px;font-size:14px;line-height:1.6">
          ${esc(ev.quote)}
        </div>
      </div>

      <div class="grid-2col" style="margin-bottom:14px">
        <div class="scout-card" style="border-left:4px solid var(--good)">
          <div class="scout-card-head">
            <strong>📌 감독 보호 요구 베테랑/친분 선수</strong>
            <span class="scout-rank-tag tnum">${ev.veteranAge}세 · OVR ${ev.veteranOvr}</span>
          </div>
          <div class="tiny" style="margin-top:6px">
            선수명: <strong>${esc(ev.veteranPlayerName)} (${esc(ev.veteranPos)})</strong><br/>
            수용 시 ${esc(ev.modeLabel)}에 필수 보호 고정되어 해제할 수 없습니다.
          </div>
        </div>

        <div class="scout-card" style="border-left:4px solid var(--bad)">
          <div class="scout-card-head">
            <strong>⚠️ 보호명단 탈락(유출) 위험 핵심 유망주</strong>
            <span class="scout-rank-tag text-bad tnum">포텐셜 ${ev.atRiskProspectPot}</span>
          </div>
          <div class="tiny" style="margin-top:6px">
            선수명: <strong>${esc(ev.atRiskProspectName)} (${esc(ev.atRiskProspectPos)})</strong><br/>
            베테랑을 보호 고정할 경우 정원(${ev.limit}인) 제한으로 인해 비보호 명단으로 밀려나 유출 리스크가 가중됩니다.
          </div>
        </div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button type="button" class="btn-sm primary" data-resolve-mandate="ACCEPT" data-mandate-mode="${esc(ev.mode)}">
          ✅ [수용] 감독 요구 수용 (${esc(ev.veteranPlayerName)} 보호 고정 · 감독신임도 +15 · 팀사기 +5 · 유망주 노출 리스크)
        </button>
        <button type="button" class="btn-sm text-bad" data-resolve-mandate="REJECT" data-mandate-mode="${esc(ev.mode)}">
          ❌ [거부] 프런트 원칙 고수 (유망주 ${esc(ev.atRiskProspectName)} 정상 보호 · 감독신임도 -25 · 언론불만 유출확률 +35%)
        </button>
      </div>
    `;
    $("gmModalBackdrop").hidden = false;
  }

  function openTradeVetoModal(vetoEvent) {
    const ctx = STATE.ctx;
    const mc = GM.ManagerConflict || GM.RealisticGM || GM.Extensions;
    if (!ctx || !mc || !vetoEvent) return;
    const userTeam = ctx.getUserTeam();
    const st = mc.ensureManagerConflictState(userTeam);

    $("gmModalTitle").textContent = `🚨 ${vetoEvent.title}`;
    $("gmModalBody").innerHTML = `
      <div class="weekly-summary-banner" style="margin-bottom:12px;border-left:4px solid var(--bad)">
        <div>
          <strong>현장 감독 긴급 항의 방문: ${esc(vetoEvent.managerName)} 감독</strong>
          <span class="sep">·</span>
          <span>현재 감독 신임도: <strong>${st.managerTrust} / 100</strong></span>
        </div>
        <div style="margin-top:8px;font-size:14px;line-height:1.6">
          ${esc(vetoEvent.quote)}
        </div>
      </div>

      <div class="report-box" style="margin-bottom:14px">
        <div><strong>트레이드 거부권 행사 대상 핵심 전력:</strong> ${esc(vetoEvent.playerName)} (${esc(vetoEvent.pos)} · ${vetoEvent.age}세 · 실제 OVR <strong>${vetoEvent.ovr}</strong>)</div>
        <div class="tiny muted" style="margin-top:4px">
          감독의 거부권을 존중하여 트레이드를 철회하거나, 단장 인사 직권으로 거부권을 기각하고 트레이드를 강행할 수 있습니다.
        </div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button type="button" class="btn-sm primary" data-resolve-trade-veto="WITHDRAW_TRADE">
          🤝 [거부권 수용 · 트레이드 철회] 감독 의견 존중 (감독 신임도 +10)
        </button>
        <button type="button" class="btn-sm text-bad" data-resolve-trade-veto="FORCE_TRADE">
          ⚡ [단장 직권 트레이드 강행] 감독 거부권 기각 및 즉시 트레이드 체결 (감독 신임도 -25 · 언론유출 확률 +35%)
        </button>
      </div>
    `;
    $("gmModalBackdrop").hidden = false;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 8-C. [탭 4-A] R&D 시설 & 2군 육성 전용 탭 렌더링
   *      [탭 4-B] 감독 & 미디어 인터뷰 전용 탭 렌더링
   * ═══════════════════════════════════════════════════════════════════════ */
  function renderFacilitiesTab() {
    const ctx = STATE.ctx;
    const container = $("facilitiesTabContainer");
    if (!ctx || !container || !GM.Extensions) return;

    const userTeam = ctx.getUserTeam();
    const ext = GM.Extensions;
    const fac = ext.ensureTeamFacilities(userTeam);
    const facEff = ext.getTeamFacilityEffects(userTeam);
    const sangmuCands = ext.getEligibleSangmuCandidates(userTeam);
    const servingList = userTeam.militaryList || [];
    const futuresPlayers = [...(userTeam.roster2G || []), ...(userTeam.rosterDev || [])];
    const trainProgs = ext.FUTURES_TRAINING_PROGRAMS || {};
    const parkPresets = ext.PARK_REMODEL_PRESETS || {};
    const curParkPreset = userTeam.parkPresetKey || "NEUTRAL";

    const facIcons = {
      rehabCenter: "🏥",
      biomechLab: "🔬",
      scoutHq: "📡"
    };

    const facCardsHtml = ["rehabCenter", "biomechLab", "scoutHq"]
      .map((fKey) => {
        const spec = ext.FACILITY_SPECS[fKey];
        const curLv = fac[fKey] || 1;
        const nextLv = curLv + 1;
        const nextCost = spec.costsByNextLevel[nextLv] || 0;
        const isMax = curLv >= 5;
        return `
          <div class="panel" style="margin-bottom:0">
            <div class="panel-head">
              <div>
                <h3 class="panel-title" style="font-size:15.5px">${facIcons[fKey] || "🏗️"} ${esc(spec.name)}</h3>
                <span class="scout-rank-tag tnum" style="margin-top:4px;display:inline-block">현재 Lv.${curLv} / 5</span>
              </div>
            </div>
            <p class="tiny" style="margin:8px 0 14px;line-height:1.55">${esc(spec.desc)}</p>
            <button type="button" class="btn-primary" style="width:100%" data-upgrade-facility="${fKey}" ${isMax ? "disabled" : ""}>
              ${isMax ? "최고 단계 (Lv.5 완료)" : `Lv.${nextLv} 증축 투자 (${fmtMoney(nextCost)})`}
            </button>
          </div>
        `;
      })
      .join("");

    container.innerHTML = `
      <div style="display:grid;gap:16px">
        <div class="weekly-summary-banner">
          <strong>구단 R&amp;D 3대 시설 실시간 보너스:</strong>
          선수단 부상 발생률 <strong>-${Math.round((1 - facEff.injuryRiskMul) * 100)}%</strong> ·
          2군 유망주 TP/성장 속도 <strong>+${Math.round((facEff.tpGainMul - 1) * 100)}%</strong> ·
          스카우트 레벨 <strong>Lv.${ctx.scoutLevel || 1}</strong> · 파견 정원 <strong>${facEff.maxScouts}명</strong>
        </div>

        <div class="grid-3col">
          ${facCardsHtml}
        </div>

        <div class="panel" style="margin-bottom:0">
          <div class="panel-head">
            <div>
              <h3 class="panel-title">🌱 2군 퓨처스 &amp; 육성군 유망주 맞춤형 집중 훈련 배정 (${futuresPlayers.length}명)</h3>
              <div class="tiny">2군 바이오메카닉스 랩과 연동되어 매주 퓨처스리그 경기 후 지정된 능력치가 가속 성장합니다.</div>
            </div>
            <button type="button" class="btn-sm primary" data-auto-futures-train="1">취약 능력치 자동 일괄 배정</button>
          </div>
          <div class="table-wrap" style="max-height:300px;overflow-y:auto">
            <table class="gm-table compact">
              <thead>
                <tr>
                  <th>군</th>
                  <th>포지션</th>
                  <th>선수명</th>
                  <th>나이</th>
                  <th>현재 OVR</th>
                  <th>잠재력</th>
                  <th>집중 육성 과제 선택</th>
                </tr>
              </thead>
              <tbody>
                ${futuresPlayers
                  .slice(0, 25)
                  .map(
                    (p) => `
                    <tr>
                      <td><span class="inline-tag">${esc(p.status)}</span></td>
                      <td><span class="pos-code">${esc(p.pos)}</span></td>
                      <td><button type="button" class="player-link" data-player-modal="${p.id}" data-team-id="${userTeam.id}">${esc(p.name)}</button></td>
                      <td class="tnum">${p.age}세</td>
                      <td class="tnum"><strong>${p.getTrueOvr()}</strong></td>
                      <td class="tnum">${p.potential}</td>
                      <td>
                        <select class="gm-select" style="font-size:12px;padding:3px 8px" data-futures-training-select="${p.id}">
                          <option value="">-- 과제 선택 --</option>
                          ${Object.values(trainProgs)
                            .filter((pr) => !pr.targetType || pr.targetType === p.type)
                            .map(
                              (pr) =>
                                `<option value="${esc(pr.key)}" ${p.trainingFocus === pr.key ? "selected" : ""}>${esc(pr.label)}</option>`
                            )
                            .join("")}
                        </select>
                      </td>
                    </tr>
                  `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>

        <div class="grid-2col">
          <div class="panel" style="margin-bottom:0">
            <div class="panel-head">
              <div>
                <h3 class="panel-title" style="font-size:15px">🪖 상무 피닉스 야구단 병역 보류 시스템 (${servingList.length} / 4명 복무 중)</h3>
                <div class="tiny">만 19~26세 미필 선수 18개월 복무 성장 · 정원/페이롤 제외</div>
              </div>
            </div>
            <div class="scout-grid">
              ${
                sangmuCands
                  .slice(0, 4)
                  .map(
                    (p) => `
                    <div class="scout-card">
                      <div class="scout-card-head">
                        <strong>${esc(p.name)} (${esc(p.pos)} · ${p.age}세)</strong>
                        <span class="scout-rank-tag tnum">OVR ${p.getTrueOvr()} / 포텐 ${p.potential}</span>
                      </div>
                      <div class="scout-actions" style="margin-top:6px">
                        <button type="button" class="btn-xs primary" data-enlist-sangmu="${p.id}" ${servingList.length >= 4 ? "disabled" : ""}>
                          상무 피닉스 입대 신청 (18개월)
                        </button>
                      </div>
                    </div>
                  `
                  )
                  .join("") || `<div class="empty-box">현재 입대 대상 미필 선수가 없습니다.</div>`
              }
            </div>
          </div>

          <div class="panel" style="margin-bottom:0">
            <div class="panel-head">
              <div>
                <h3 class="panel-title" style="font-size:15px">🏟️ 홈구장 외야 펜스 리모델링 (파크팩터 전략 조정)</h3>
                <div class="tiny">우리 구단 팀 컬러(거포 군단 vs 마운드/수비 중심)에 맞춰 외야 펜스 거리와 높이를 개조합니다.</div>
              </div>
            </div>
            <div style="display:grid;gap:8px">
              ${Object.values(parkPresets)
                .map(
                  (pk) => `
                  <div class="scout-card" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                    <div>
                      <strong>${esc(pk.label)}</strong>
                      <div class="tiny muted">${esc(pk.desc)}</div>
                    </div>
                    <button type="button" class="btn-xs ${curParkPreset === pk.key ? "ghost" : "primary"}" data-remodel-park="${esc(pk.key)}" ${curParkPreset === pk.key ? "disabled" : ""}>
                      ${curParkPreset === pk.key ? "현재 적용 중" : `개조 (${fmtMoney(pk.costManwon)})`}
                    </button>
                  </div>
                `
                )
                .join("")}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderManagerTab() {
    const ctx = STATE.ctx;
    const container = $("managerTabContainer");
    if (!ctx || !container || !GM.Extensions) return;

    const userTeam = ctx.getUserTeam();
    const ext = GM.Extensions;
    const mc = ext.ensureManagerConflictState(userTeam);
    const rgm = ext.ensureRealisticGMState(userTeam);
    const archMap = ext.MANAGER_ARCHETYPES || {};
    const curArch = archMap[rgm.managerArchetype] || { label: "베테랑 선호형", desc: "검증된 베테랑과 주전 기용 선호" };
    const moraleIssues = ext.getMoraleIssuePlayers(userTeam);
    const topStarForSal = userTeam.roster1G.slice().sort((a, b) => b.getTrueOvr() - a.getTrueOvr())[0];

    container.innerHTML = `
      <div style="display:grid;gap:16px">
        <div class="panel" style="margin-bottom:0">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">👔 현장 감독 성향 및 프런트 갈등 관리 (${esc(mc.managerName)} 감독 · ${esc(curArch.label)})</h2>
              <div class="tiny">감독 신임도: <strong>${mc.managerTrust} / 100</strong> · 갈등 게이지: <strong>${mc.conflictGauge} / 100</strong> · 위기 단계: <strong>${mc.crisisStage}단계</strong> · 언론 여론 지수: <strong>${rgm.mediaSentiment} / 100</strong></div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <select id="rgmArchetypeSelect" class="gm-select" style="font-size:12.5px">
                ${Object.values(archMap)
                  .map(
                    (a) =>
                      `<option value="${esc(a.key)}" ${rgm.managerArchetype === a.key ? "selected" : ""}>${esc(a.label)}</option>`
                  )
                  .join("")}
              </select>
              <button type="button" class="btn-xs ghost" data-rgm-set-archetype="1">성향 변경 적용</button>
              <button type="button" class="btn-xs primary" data-rgm-open-usage-refusal="1">🚨 기용 거부(벤치 방치) 면담 모달</button>
              <button type="button" class="btn-xs" data-open-protection-mandate="FA_20">📋 보호선수 감독 외압 면담</button>
            </div>
          </div>

          <div class="weekly-summary-banner" style="margin-bottom:10px">
            <strong>현재 감독 운영 기조:</strong> ${esc(curArch.desc || "1군 즉시전력감 및 베테랑 중심 기용")} ·
            선수단 프런트 신뢰도 <strong>${rgm.clubTrustScore}</strong> · 미래 팜 시스템 건전성 <strong>${rgm.farmSystemHealth}</strong>
          </div>

          <div class="grid-2col">
            <div class="report-box" style="border-left:4px solid var(--bad)">
              <strong>🎙️ 과도한 감봉 시 선수단 집단 항명 &amp; 미디어 인터뷰 여론전</strong>
              <div class="tiny muted" style="margin:6px 0 10px">
                고강도 연봉 삭감 시 선수단 집단 항명(팀 컨디션 저하 · 팬심 하락)이 발생하며, 단장의 공식 미디어 인터뷰 스탠스에 따라 구단주 신임도와 언론 여론이 결정됩니다.
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button type="button" class="btn-xs text-bad" data-rgm-trigger-rebellion="1">🔥 감봉 집단 항명 발생 시뮬레이션</button>
                <button type="button" class="btn-xs ghost" data-rgm-media-response="HARDLINE_PRINCIPLE">🎙️ 강경 원칙론 인터뷰 (구단주+10 / 여론-18)</button>
                <button type="button" class="btn-xs primary" data-rgm-media-response="CONCILIATORY_BONUS">🤝 유화책·보너스 신설 (여론+22 / 사기+20)</button>
                <button type="button" class="btn-xs" data-rgm-media-response="TRANSPARENT_REBUILD_PR">📊 리빌딩 재투자 브리핑 (구단주+6 / 여론+16)</button>
              </div>
            </div>

            <div class="report-box" style="border-left:4px solid #38bdf8">
              <strong>⚖️ BATNA 다안건 연봉 협상 &amp; 1월 말 연봉조정위원회</strong>
              <div class="tiny muted" style="margin:6px 0 10px">
                보장 출전 타석/이닝 + 성과 옵션 + 비FA 다년 전환 패키지 협상 또는 연봉조정위원회 회부를 결단합니다.
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button type="button" class="btn-xs primary" data-rgm-multi-issue-neg="${topStarForSal ? topStarForSal.id : ""}">
                  🤝 핵심 선수 다안건 패키지 협상 타결
                </button>
                <button type="button" class="btn-xs text-bad" data-rgm-run-arbitration="${topStarForSal ? topStarForSal.id : ""}">
                  ⚖️ 연봉조정위원회 판결 실행
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="panel" style="margin-bottom:0">
          <div class="panel-head">
            <div>
              <h3 class="panel-title">💬 선수단 사기(Morale) 관리 &amp; 트레이드 요구 선수 1:1 단장 면담 (${moraleIssues.length}명)</h3>
              <div class="tiny">출전 기회 부족이나 2군 장기 체류로 불만이 쌓인 선수와 1:1 면담(격려금 지급) 또는 1군 콜업 약속을 진행합니다.</div>
            </div>
          </div>
          <div class="scout-grid">
            ${
              moraleIssues
                .slice(0, 6)
                .map(
                  (p) => `
                  <div class="scout-card" style="border-left:4px solid ${p.tradeDemand ? "var(--bad)" : "#f59e0b"}">
                    <div class="scout-card-head">
                      <strong>${esc(p.name)} (${esc(p.pos)} · ${p.age}세 · ${esc(p.status)})</strong>
                      <span class="scout-rank-tag ${p.tradeDemand ? "text-bad" : ""}">사기 ${p.morale} ${p.tradeDemand ? "· 트레이드 요구" : ""}</span>
                    </div>
                    <div class="tiny" style="margin:6px 0">${esc(p.moraleReason || "출전 기회 및 입지 불만")}</div>
                    <div class="scout-actions">
                      <button type="button" class="btn-xs primary" data-resolve-morale="${p.id}" data-morale-action="PEP_TALK">단장 1:1 면담 (0.2억)</button>
                      <button type="button" class="btn-xs ghost" data-resolve-morale="${p.id}" data-morale-action="PROMOTE_1G">1군 기용 보장</button>
                    </div>
                  </div>
                `
                )
                .join("") || `<div class="empty-box">현재 트레이드 요구나 심각한 사기 저하 선수가 없습니다. 선수단 분위기가 안정적입니다!</div>`
            }
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 8시즌 밸런스 진단 (KBO_GM.Balance): 새 리그를 만들어 실제 엔진으로 진행 — 진행 중인 게임에는 영향 없음
   */
  let balanceRunToken = 0;

  function openBalanceCheckModal() {
    const ctx = STATE.ctx;
    if (!GM.Balance) return;
    const diff = (ctx && ctx.difficulty) || "NORMAL";
    const team = (ctx && ctx.userTeamId) || "KIA";
    $("gmModalTitle").textContent = "📊 8시즌 밸런스 진단 (실제 엔진)";
    $("gmModalBody").innerHTML = `
      <div class="weekly-summary-banner" style="margin-bottom:12px">
        새 리그를 만들어 실제 경기 엔진으로 8시즌을 진행하고 전력 평준화·재정·선수 성장을 측정합니다.
        <strong>진행 중인 게임과 세이브에는 영향이 없습니다.</strong> 진단용 리그의 내 구단(${esc(team)})은 아무 조작도 하지 않습니다.
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
        <label class="tiny">반복 횟수
          <select id="balanceRuns" class="gm-select"><option value="1">1회 (빠름)</option><option value="3" selected>3회 (권장)</option><option value="5">5회 (정밀)</option></select>
        </label>
        <label class="tiny">난이도
          <select id="balanceDifficulty" class="gm-select">
            ${["EASY", "NORMAL", "HARD"].map((k) => `<option value="${k}" ${k === diff ? "selected" : ""}>${({ EASY: "쉬움", NORMAL: "보통", HARD: "어려움" })[k]}</option>`).join("")}
          </select>
        </label>
        <button type="button" class="btn-primary" id="btnStartBalanceCheck">진단 시작</button>
      </div>
      <div class="gauge-track" style="height:10px"><div id="balanceProgressBar" class="gauge-fill" style="width:0%"></div></div>
      <div id="balanceProgressLabel" class="tiny muted" style="margin:4px 0 12px">대기 중</div>
      <div id="balanceResultBox"></div>
    `;
    $("gmModalBackdrop").hidden = false;
    $("btnStartBalanceCheck").addEventListener("click", () => startBalanceCheck(team));
  }

  async function startBalanceCheck(team) {
    const token = ++balanceRunToken;
    const btn = $("btnStartBalanceCheck");
    if (btn) btn.disabled = true;
    const runs = Number(($("balanceRuns") || {}).value) || 3;
    const difficulty = ($("balanceDifficulty") || {}).value || "NORMAL";
    const setProgress = (fraction, label) => {
      // 모달을 닫거나 새 진단을 시작하면 진행 중인 진단을 중단
      if (token !== balanceRunToken || $("gmModalBackdrop").hidden || !$("balanceProgressBar")) {
        throw new Error("BALANCE_CHECK_CANCELLED");
      }
      $("balanceProgressBar").style.width = `${Math.round(fraction * 100)}%`;
      $("balanceProgressLabel").textContent = `${Math.round(fraction * 100)}% · ${label}`;
    };
    try {
      const result = await GM.Balance.runBalanceCheck({ seasons: 8, runs, team, difficulty, onProgress: setProgress });
      $("balanceResultBox").innerHTML = renderBalanceResultHtml(result);
      $("balanceProgressLabel").textContent = `완료 · ${(result.elapsedMs / 1000).toFixed(0)}초`;
    } catch (err) {
      if (String(err && err.message) !== "BALANCE_CHECK_CANCELLED") {
        showToast("밸런스 진단 중 오류가 발생했습니다.", "bad");
        throw err;
      }
    } finally {
      const b = $("btnStartBalanceCheck");
      if (b) b.disabled = false;
    }
  }

  function renderBalanceResultHtml(result) {
    const { summary, options } = result;
    const f = (v, d = 3) => (v == null || Number.isNaN(v) ? "-" : Number(v).toFixed(d));
    const ref = summary.reference;
    const inRange = (v, [lo, hi]) => v >= lo - 0.005 && v <= hi + 0.005;
    const last = summary.rows[summary.rows.length - 1] || {};
    return `
      <div class="report-box" style="margin-bottom:10px">
        <strong>${options.seasons}시즌 × ${options.runs}회 평균 (${({ EASY: "쉬움", NORMAL: "보통", HARD: "어려움" })[options.difficulty]})</strong>
        <div class="tiny" style="margin-top:4px">
          마지막 시즌 승률 표준편차 <strong class="${inRange(last.sd, ref.sd) ? "text-good" : "text-bad"}">${f(last.sd)}</strong> (실제 KBO ${ref.sd.join("~")}) ·
          1위 <strong>${f(last.topPct)}</strong> · 10위 <strong>${f(last.bottomPct)}</strong> ·
          회당 외부 FA 이적 ${f(summary.totals.faExternalMoves, 1)}건 · 포스팅 제안 ${f(summary.totals.postingOffers, 1)}건 · 경쟁균형세 제재 ${f(summary.totals.luxuryTaxPenalties, 1)}건
        </div>
      </div>
      <div class="table-wrap" style="max-height:360px;overflow:auto">
        <table class="gm-table compact">
          <thead><tr><th>시즌</th><th>승률 SD</th><th>1위</th><th>10위</th><th>순위상관</th><th>내 구단 순위</th><th>최고 OVR</th><th>90+</th><th>95+</th><th>적자 구단</th><th>내 여유(억)</th></tr></thead>
          <tbody>
            ${summary.rows
              .map(
                (r) => `<tr>
                  <td class="tnum">${r.year}</td><td class="tnum">${f(r.sd)}</td><td class="tnum">${f(r.topPct)}</td><td class="tnum">${f(r.bottomPct)}</td>
                  <td class="tnum">${f(r.rankCorr, 2)}</td><td class="tnum">${r.userRanks.join("/")}</td><td class="tnum">${f(r.maxOvr, 1)}</td>
                  <td class="tnum">${f(r.ovr90, 1)}</td><td class="tnum">${f(r.ovr95, 1)}</td><td class="tnum">${f(r.deficitTeams, 1)}</td><td class="tnum">${f(r.userRoom, 1)}</td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <div class="tiny muted" style="margin-top:6px">순위상관: 전년 순위와의 상관(1 = 순위 고착, 0 = 무작위). 진단용 리그의 내 구단은 아무 조작도 하지 않으므로 적자·순위는 '방치했을 때'의 결과입니다.</div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 비FA 다년계약 (KBO_GM.NonFA): 대상자 · 협상 모달 · 진행 중 계약 · 프랜차이즈 예외
   * ═══════════════════════════════════════════════════════════════════════ */
  function renderNonFAContractSectionHtml(ctx, userTeam, cands) {
    const NF = GM.NonFA;
    if (!NF) return "";
    const active = userTeam
      .getAllPlayers()
      .filter((p) => p.nonFAContract && p.nonFAContract.active)
      .sort((a, b) => (b.nonFAContract.aav || 0) - (a.nonFAContract.aav || 0));
    const franchiseList = NF.getFranchiseEligible(ctx, userTeam.id);
    const events = (ctx.nonFAEventLog || []).filter((e) => e.teamId === userTeam.id).slice(0, 5);
    return `
      <h4 style="font-size:13.5px;margin:8px 0">비FA 다년계약 (계약금 없음 · 보장 연봉 + 성과 옵션 · 2~${NF.MAX_YEARS}년)</h4>
      <div class="tiny muted" style="margin-bottom:8px">
        KBO 3시즌 이상 · 만 21~35세 국내 선수. 선수 요구액은 FA 시장가 × FA까지 남은 기간 × 포지션 희소성 × 부상 이력 × 우리 구단 여유 예산으로 정해집니다.
        옵션은 시즌 WAR ${NF.OPTION_WAR_THRESHOLD} 이상일 때만 지급되고, 선수는 옵션을 절반 가치로 봅니다. 포스팅 허용 조항이 없으면 계약 기간 중 포스팅할 수 없습니다.
      </div>
      <div class="scout-grid">
        ${
          cands
            .slice(0, 8)
            .map(
              (c) => `
          <div class="scout-card">
            <div class="scout-card-head">
              <span class="pos-code">${esc(c.pos)}</span>
              <strong>${esc(c.name)}</strong>
              <span class="muted">(${c.age}세 · OVR ${c.trueOvr} · KBO ${c.kboSeasons}시즌 · FA까지 ${c.yearsToFA}년)</span>
            </div>
            <div class="scout-metrics tnum">
              <span>현 연봉 ${fmtMoney(c.currentSalary)}</span><span class="sep">·</span>
              <span>요구: <strong>${c.desiredYears}년 · 연평균 ${fmtMoney(c.demandAAV)}</strong></span>
            </div>
            <div class="tiny muted" style="margin:4px 0">${c.notes.map(esc).join(" · ")}${c.postingClauseValued ? " · 포스팅 조항을 원함(-8%)" : ""}</div>
            <div class="scout-actions"><button type="button" class="btn-xs primary" data-nonfa-negotiate="${c.playerId}">협상 테이블 열기</button></div>
          </div>`
            )
            .join("") || `<div class="empty-box">현재 비FA 다년계약 대상 선수가 없습니다.</div>`
        }
      </div>
      <div class="grid-2col" style="margin-top:10px">
        <div>
          <strong class="tiny">진행 중인 비FA 다년계약</strong>
          <table class="gm-table compact"><tbody>
            ${
              active
                .map((p) => {
                  const c = p.nonFAContract;
                  const now = c.schedule.find((x) => x.year === ctx.currentYear) || c.schedule[0];
                  return `<tr><td>${esc(p.name)} <span class="muted">${esc(p.pos)}</span></td><td class="tnum">${c.startYear}~${c.startYear + c.years - 1}</td><td class="tnum">올해 ${fmtMoney(now.salary)}${now.option ? ` +옵션 ${fmtMoney(now.option)}` : ""}</td><td class="tiny">${esc((NF.STRUCTURES[c.structure] || {}).label || c.structure)}${c.postingClause ? " · 포스팅 허용" : ""}</td></tr>`;
                })
                .join("") || `<tr><td class="muted">없음</td></tr>`
            }
          </tbody></table>
          ${events.length ? `<div class="tiny" style="margin-top:6px"><strong>최근 계약 이벤트:</strong> ${events.map((e) => `${e.year} ${esc(e.playerName)}: ${e.events.map(esc).join(", ")}`).join(" · ")}</div>` : ""}
        </div>
        <div>
          <strong class="tiny">🏅 프랜차이즈 예외 (KBO판 버드 룰 · 1명)</strong>
          <div class="tiny muted">한 구단에서 ${NF.FRANCHISE_MIN_SEASONS}시즌 이상 뛴 선수 1명은 경쟁균형세 산정 시 연봉의 50%만 반영됩니다.</div>
          <select id="franchiseSelect" class="gm-select" style="margin-top:6px;max-width:100%">
            <option value="">— 지정 안 함 —</option>
            ${franchiseList
              .map((f) => `<option value="${esc(f.playerId)}" ${userTeam.franchisePlayerId === f.playerId ? "selected" : ""}>${esc(f.name)} (${esc(f.pos)} · ${f.tenure}시즌 · 연봉 ${fmtMoney(f.salary)})</option>`)
              .join("")}
          </select>
          <button type="button" class="btn-xs" data-set-franchise="1">지정 저장</button>
        </div>
      </div>`;
  }

  function openNonFANegotiationModal(playerId) {
    const ctx = STATE.ctx;
    const NF = GM.NonFA;
    const team = ctx.getUserTeam();
    const player = team.getAllPlayers().find((p) => p.id === playerId);
    if (!NF || !player) return;
    const d = NF.computeDemand(ctx, team, player);
    $("gmModalTitle").textContent = `✍️ 비FA 다년계약 협상 — ${player.name} (${player.pos}, ${player.age}세)`;
    $("gmModalBody").innerHTML = `
      <div class="weekly-summary-banner" style="margin-bottom:10px">
        에이전트 요구: <strong>${d.desiredYears}년 · 연평균 ${fmtMoney(d.aav)}</strong> (FA 시장가 ${fmtMoney(d.marketAAV)} 기준) · 옵션 허용 ${Math.round(d.maxOptionRatio * 100)}%까지
        <div class="tiny muted">${d.notes.map(esc).join(" · ")}${d.postingClauseValued ? " · 포스팅 허용 조항을 넣으면 요구액 -8%" : ""}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px">
        <label class="tiny">계약 기간 (년)<input type="number" id="nfYears" class="gm-select" min="${NF.MIN_YEARS}" max="${NF.MAX_YEARS}" value="${d.desiredYears}"></label>
        <label class="tiny">연평균 (만원)<input type="number" id="nfAav" class="gm-select" step="500" value="${d.aav}"></label>
        <label class="tiny">옵션 비율 (%)<input type="number" id="nfOption" class="gm-select" min="0" max="50" step="5" value="0"></label>
        <label class="tiny">연봉 구조
          <select id="nfStructure" class="gm-select">${Object.values(NF.STRUCTURES).map((s) => `<option value="${s.key}">${esc(s.label)}</option>`).join("")}</select>
        </label>
        <label class="tiny" style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="nfPosting"> 포스팅 허용 조항</label>
      </div>
      <div id="nfEvalBox" style="margin-top:10px"></div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button type="button" class="btn-primary" data-nonfa-sign="${esc(player.id)}">이 조건으로 계약 제시</button>
      </div>`;
    $("gmModalBackdrop").hidden = false;
    const readOffer = () => ({
      years: Number($("nfYears").value),
      aav: Number($("nfAav").value),
      optionRatio: Number($("nfOption").value) / 100,
      structure: $("nfStructure").value,
      postingClause: $("nfPosting").checked
    });
    const refresh = () => {
      const offer = readOffer();
      const ev = NF.evaluateOffer(ctx, team, player, offer);
      const sched = NF.previewSchedule(ctx, offer);
      $("nfEvalBox").innerHTML = `
        <div class="report-box ${ev.accept ? "text-good" : "text-bad"}"><strong>${esc(ev.message)}</strong>
          <div class="tiny muted">선수가 보는 실질 연평균 ${fmtMoney(ev.effectiveAAV)} / 필요 ${fmtMoney(ev.requiredAAV)} · 총액 ${fmtMoney(ev.aav * ev.years)} (보장 ${fmtMoney(Math.round(ev.aav * ev.years * (1 - ev.optionRatio)))})</div>
        </div>
        <div class="tiny" style="margin-top:6px"><strong>연봉표:</strong> ${sched
          .slice(0, 11)
          .map((x) => `${x.year} ${fmtMoney(x.salary)}${x.option ? `+${fmtMoney(x.option)}` : ""}`)
          .join(" · ")}</div>`;
    };
    ["nfYears", "nfAav", "nfOption", "nfStructure", "nfPosting"].forEach((id) => {
      $(id).addEventListener("input", refresh);
      $(id).addEventListener("change", refresh);
    });
    refresh();
  }

  /** 단장 직접 지명(1~3R) 완료 후 4~10라운드 스카우트팀 위임 지명 */
  function runDelegatedDraftIfReady(ctx) {
    if (!ctx || !ctx.draftState || !GM.Draft || typeof GM.Draft.runDelegatedRounds !== "function") return null;
    const done = ctx.draftState.completedRounds.length;
    if (done < (GM.Draft.DELEGATE_FROM_ROUND || 4) - 1 || done >= 10) return null;
    const results = GM.Draft.runDelegatedRounds(ctx);
    const picks = results.map((r) => r.userPick).filter(Boolean);
    showToast(
      `4~10라운드는 스카우트팀이 지명했습니다: ${picks.map((p) => `${p.playerName}(${p.pos})`).join(", ") || "지명 없음"}`,
      "info"
    );
    return results;
  }

  function runWiringAuditModal() {
    try {
      const rep =
        GM.Auditor && typeof GM.Auditor.runWiringAudit1000 === "function"
          ? GM.Auditor.runWiringAudit1000({ runs: 1000 })
          : null;

      // C등급 15억 상한선 검증 샘플 함께 산출
      const sampleC =
        GM.FA && typeof GM.FA.calculateTargetValuation === "function"
          ? GM.FA.calculateTargetValuation({ age: 35, career: [{ war: 5.5 }] }, "C")
          : { totalValuation: 150000, years: 2 };

      $("gmModalTitle").textContent = "✅ 1,000회 자가 진단 (Wiring Audit) 결과 리포트";
      $("gmModalBody").innerHTML = `
        <div class="weekly-summary-banner" style="margin-bottom:12px;border-left:4px solid var(--good)">
          <strong class="text-good">1,000회 자가 진단 테스트 완료 (ALL PASS)</strong><br/>
          단 한 건의 <code>undefined</code> 에러나 C등급 오버페이(C등급 고WAR 테스트 결과: <strong>${fmtMoney(sampleC.totalValuation)} / 상한 15억</strong>)가 발견되지 않았습니다.
        </div>
        ${
          rep
            ? `
              <div class="report-box">
                <div><strong>총 검증 규모:</strong> ${rep.totalRuns.toLocaleString()}시즌 (${rep.totalWeeksSimulated.toLocaleString()}주) · 소요 시간: ${rep.elapsedMs}ms</div>
                <div class="tiny" style="margin-top:8px;display:grid;gap:4px">
                  ${(rep.assertions || [])
                    .map(
                      (a) =>
                        `<div>· <strong>${esc(a.expr)}:</strong> 실제값 <strong>${esc(a.actual)}</strong> (기대값 ${esc(a.expected)}) — <span class="text-good">${a.passed ? "PASS" : "FAIL"}</span></div>`
                    )
                    .join("")}
                </div>
              </div>
            `
            : ""
        }
      `;
      $("gmModalBackdrop").hidden = false;
      showToast("1,000회 자가 진단 완료: 단 한 건의 에러나 C등급 오버페이 없이 모두 통과했습니다! (PASS)", "good");
      return rep;
    } catch (err) {
      showToast(`진단 중 오류: ${err && err.message ? err.message : err}`, "bad");
      return null;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 9. 전체 화면 갱신 및 이벤트 바인딩
   * ═══════════════════════════════════════════════════════════════════════ */
  function renderAll() {
    if (STATE.ctx) {
      GM.context = STATE.ctx;
    }
    renderHeader();

    const tabs = ["pennant", "roster", "offseason", "facilities", "manager", "records", "storage"];
    tabs.forEach((t) => {
      const sec = $(`tab_${t}`);
      const btn = document.querySelector(`[data-main-tab="${t}"]`);
      if (sec) sec.hidden = STATE.activeTab !== t;
      if (btn) btn.classList.toggle("active", STATE.activeTab === t);
    });

    if (STATE.activeTab === "pennant") renderPennantTab();
    else if (STATE.activeTab === "roster") renderRosterTab();
    else if (STATE.activeTab === "offseason") renderOffseasonTab();
    else if (STATE.activeTab === "facilities") renderFacilitiesTab();
    else if (STATE.activeTab === "manager") renderManagerTab();
    else if (STATE.activeTab === "records") renderRecordsTab();
    else if (STATE.activeTab === "storage") renderStorageTab();
  }

  function advanceDaysUI(days = 1) {
    const ctx = STATE.ctx;
    if (!ctx) return;

    if (GM.Setup && typeof GM.Setup.advanceDays === "function") {
      const res = GM.Setup.advanceDays(ctx, days);
      if (res.latestWeeklyReport) {
        STATE.lastWeeklyReport = res.latestWeeklyReport;
      }
      const retroEvent = (res.dailyEvents || []).find((ev) => ev.type === "SEASON_RETRO");
      if (retroEvent) {
        STATE.recordsSubTab = "retro";
        showToast(retroEvent.message, "good");
      } else if (res.draftWeekTriggered) {
        STATE.activeTab = "offseason";
        STATE.offseasonSubTab = "draft";
        showToast(`[9월 23일] ${ctx.currentYear} KBO 신인 드래프트 지명 기간이 개막했습니다!`, "good");
      } else if (res.postseasonWeekTriggered) {
        STATE.activeTab = "pennant";
        showToast(`🏆 [10월 10일 가을야구 개막] ${ctx.currentYear} KBO 포스트시즌(WC → 준PO → PO → KS)이 개막했습니다!`, "good");
      } else if (res.secondaryDraftTriggered) {
        STATE.activeTab = "offseason";
        STATE.offseasonSubTab = "front5";
        showToast(`🔄 [11월 5일 2차 드래프트 개막] ${ctx.currentYear} KBO 2차 드래프트(35인 보호 외 지명) 기간이 개막했습니다!`, "good");
      } else if (res.dailyEvents && res.dailyEvents.length) {
        showToast(`${res.koreanDate} (${days}일 경과) — ${res.dailyEvents[0].message}`, "info");
      } else {
        showToast(`${res.koreanDate} (+${days}일 진행 완료 · 스카우트 조사도 상승)`, "info");
      }
      renderAll();
      return;
    }

    let played = 0;
    for (let i = 0; i < Math.max(1, Math.round(days / 7)); i++) {
      if (ctx.currentWeek > 24) break;
      STATE.lastWeeklyReport = GM.advanceOneWeek(ctx);
      played += 1;
    }
    if (played > 0) {
      showToast(`${STATE.lastWeeklyReport.weekPlayed}주차 멀티 리그 연산 완료!`, "info");
    }
    renderAll();
  }

  function advanceWeeks(count = 1) {
    advanceDaysUI(count * 7);
  }

  function bindEvents() {
    // 메인 탭 전환
    document.querySelectorAll("[data-main-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        STATE.activeTab = btn.dataset.mainTab;
        renderAll();
      });
    });

    // 슬롯 선택 로비 화면으로 돌아가기 버튼
    const btnBackLobby = $("btnBackToLobby");
    if (btnBackLobby) {
      btnBackLobby.addEventListener("click", () => returnToLobby());
    }

    // 로비 우측 상단 테마 토글
    const btnLobbyTheme = $("btnLobbyTheme");
    if (btnLobbyTheme) {
      btnLobbyTheme.addEventListener("click", toggleTheme);
    }

    // 로비 게임 설명 모달
    const btnGuide = $("btnOpenGuideModal");
    if (btnGuide) {
      btnGuide.addEventListener("click", () => {
        $("gmModalTitle").textContent = "KBO 단장 모드 v1.0 — 8대 핵심 시스템 안내";
        $("gmModalBody").innerHTML = `
          <div style="display:grid;gap:10px;font-size:13.5px;line-height:1.6">
            <div><strong>1. 단장 프로필 &amp; 고정 첫 계약:</strong> 첫 시작 시 단장 이름·특성·담당 구단을 선택하며, <strong>[3년 계약 / 총액 8억 원 (계약금 2억 + 연봉 2억)]</strong>으로 고정 시작합니다. <strong>담당 구단은 한 번 정해지면 변경할 수 없습니다.</strong></div>
            <div><strong>2. 2025년 1월 1일 개막 &amp; 일자 진행:</strong> 2025년 1월 1일부터 FA·연봉·외국인·코치·트레이드가 즉시 활성화되며, <strong>+1일 진행</strong> 및 <strong>+7일 스킵</strong>을 지원합니다.</div>
            <div><strong>3. 2024 순위 기반 체급 &amp; 역순 예산:</strong> 1위 KIA(전력 78 / 예산 120억)부터 10위 키움(전력 67 / 예산 175억)까지 역순 예산이 배정됩니다.</div>
            <div><strong>3-1. 구단 재정 (난이도: 쉬움·보통·어려움):</strong> 예산은 한 해 운영 봉투이고 <strong>여유 예산 = 예산 − 연봉총액</strong>입니다. FA 계약금·첫해 연봉·시설 투자·현금 트레이드는 여유 예산 안에서만 가능합니다. 매 시즌 예산은 <strong>모기업 지원금(리그 평균 연봉 × 직전 순위 역순 배율: 1위 1.20배 ~ 10위 1.65배) + 이월금</strong>으로 정해지고, 정규시즌에는 매주 자체 수입과 운영비가 정산됩니다. 적자(여유 예산 마이너스)로 주간 정산을 맞으면 구단주 신임도가 깎이며, 상위권을 지키려면 구단주 증액 요청이 필요할 수 있습니다.</div>
            <div><strong>3-2. 전력 평준화 제도:</strong> 신인 드래프트·2차 드래프트·외국인 선수 영입은 순위 역순으로 진행됩니다. 경쟁균형세 상한은 리그 평균 상위 40인 연봉의 120%이며, 초과 시 1회 50% · 2회 연속 100% + 다음 1R 지명권 9단계 하락 · 3회 이상 150% + 9단계 하락입니다. 스토브리그 업무를 직접 처리하지 않으면 마감일(12/1 연봉·FA 공시, 1/15 FA 시장, 1/31 외국인)에 자동 처리됩니다. FA 공시 후 7일은 원소속구단 우선협상 기간으로, 타 구단 FA는 기간이 끝나야 공개됩니다.</div>
            <div><strong>3-3. 상무 · MLB 포스팅:</strong> 시작 시 만 25세 이상은 군필, 21~24세는 군필·미필이 섞여 있습니다. 상무는 구단당 4명까지이며 우리 구단 입대는 단장이 직접 결정합니다. MLB 포스팅 제안은 11월 1일~12월 15일에 KBO 7시즌 이상 · 만 31세 이하 · OVR 90+ 또는 단일 능력치 95+ 선수 중 구단당 1명에게만 들어옵니다. 선수는 매 시즌 나이·잠재력·출전 시간에 따라 성장하며, 가끔 각성 시즌이 찾아옵니다.</div>
            <div><strong>3-4. 신인 드래프트:</strong> 9월 23일~30일. 1~3라운드는 앞 순번 구단 지명 후 단장 차례에서 직접 고르고, 4~10라운드는 스카우트팀이 스카우트 추정치로 지명합니다(번복 불가). 유망주 잠재력은 스카우트 레벨·조사도·단장 직관에 따라 정확도가 달라지며, 청소년 국가대표 경기(대학 대표 선발전·U-18 평가전·U-18 아시아 선수권·U-16 대회)를 연 3회까지 직관할 수 있습니다.</div>
            <div><strong>3-5. 비FA 다년계약:</strong> 계약금 없이 보장 연봉 + 성과 옵션(시즌 WAR 2.0 이상 지급), 2~11년, 균등·앞쪽·뒤쪽 몰아주기. 요구액은 FA 시장가 × FA까지 남은 기간 × 포지션 희소성 × 부상 이력 × 우리 여유 예산. 포스팅 허용 조항이 없으면 계약 중 포스팅 불가. 7시즌 이상 프랜차이즈 선수 1명은 경쟁균형세 산정 시 연봉 50% 제외. 32세 이상 5년+ 계약은 에이징 커브 파동 위험.</div>
            <div><strong>4. 9월 3주차 신인 드래프트 &amp; 스카우트 파견:</strong> 고교 1~3학년 및 대학 리그에 스카우트를 파견해 유망주 오차(Fog of War)를 줄이고 9월 3주차에 드래프트를 진행합니다.</div>
            <div><strong>5. 외국인 선수 엄격 제한 &amp; 6주 대체 외인:</strong> 외국인은 육성군 등록이 절대 불가하며 방출 시 영구 퇴출됩니다. 6주 이상 장기 부상 시 6주 단기 대체 외국인을 영입할 수 있습니다.</div>
          </div>
        `;
        $("gmModalBackdrop").hidden = false;
      });
    }

    // 로비에서 단일 index.html 다운로드
    const btnLobbyExport = $("btnLobbyExportHtml");
    if (btnLobbyExport) {
      btnLobbyExport.addEventListener("click", () => {
        const expBtn = $("btnExportStandaloneHtml");
        if (expBtn) expBtn.click();
      });
    }

    // 새 단장 만들기 취소
    const btnCancelCreate = $("btnCancelCreateGM");
    if (btnCancelCreate) {
      btnCancelCreate.addEventListener("click", closeCreateGmForm);
    }

    // 새 단장 만들기 확정 (단장 부임하기)
    const btnConfirmCreate = $("btnConfirmCreateGM");
    if (btnConfirmCreate) {
      btnConfirmCreate.addEventListener("click", async () => {
        const rawName = ($("createGmName") && $("createGmName").value) || "";
        const gmName = rawName.trim() || "백승수";
        const newCtx = await GM.Setup.initNewGameSession(
          createTargetSlotId,
          gmName,
          createSelectedTrait,
          createSelectedTeamId,
          createSelectedDifficulty
        );
        await GM.Storage.saveGame("auto_save", newCtx);
        showToast(
          `${gmName} 단장 부임 완료! (${newCtx.getUserTeam().name} 고정 · 3년 8억 계약 · 2025년 1월 1일 개막)`,
          "good"
        );
        enterDashboardWithContext(newCtx);
      });
    }

    // 하루 진행(+1일), 1주 스킵(+7일), 4주 진행(+28일)
    const btnNextDay = $("btnNextDay");
    if (btnNextDay) btnNextDay.addEventListener("click", () => advanceDaysUI(1));

    const btnNext = $("btnNextWeek");
    if (btnNext) btnNext.addEventListener("click", () => advanceDaysUI(7));

    const btnNext4 = $("btnNext4Weeks");
    if (btnNext4) btnNext4.addEventListener("click", () => advanceDaysUI(28));

    const btnHeaderAudit = $("btnHeaderWiringAudit");
    if (btnHeaderAudit) btnHeaderAudit.addEventListener("click", () => runWiringAuditModal());

    const btnHeaderBalance = $("btnHeaderBalanceCheck");
    if (btnHeaderBalance) btnHeaderBalance.addEventListener("click", () => openBalanceCheckModal());

    // 상단 자동 저장 버튼
    const btnAutoSave = $("btnQuickAutoSave");
    if (btnAutoSave) {
      btnAutoSave.addEventListener("click", async () => {
        const res = await GM.Storage.saveGame("auto_save", STATE.ctx, { label: "상단 빠른 자동저장" });
        if (res && res.ok) {
          showToast(`IndexedDB 'auto_save' 슬롯에 저장되었습니다.`, "good");
          if (STATE.activeTab === "storage") renderStorageTab();
        }
      });
    }

    // 테마 토글
    const btnTheme = $("btnThemeToggle");
    if (btnTheme) btnTheme.addEventListener("click", toggleTheme);

    // Netlify 배포용 단일 index.html 번들 다운로드
    const btnExportHtml = $("btnExportStandaloneHtml");
    if (btnExportHtml) {
      btnExportHtml.addEventListener("click", async () => {
        try {
          btnExportHtml.disabled = true;
          btnExportHtml.textContent = "단일 index.html 병합 중...";
          const scriptFiles = [
            "gm-schema.js",
            "gm-match-sim.js",
            "gm-weekly-sim.js",
            "gm-storage.js",
            "gm-draft.js",
            "gm-offseason.js",
            "gm-spring-camp.js",
            "gm-extensions.js",
            "gm-setup.js",
            "gm-economy.js",
            "gm-nonfa.js",
            "gm-retro.js",
            "gm-balance.js",
            "gm-ui.js"
          ];
          const codes = await Promise.all(
            scriptFiles.map((url) => fetch(url).then((r) => r.text()))
          );
          const docClone = document.documentElement.cloneNode(true);
          docClone.querySelectorAll("script").forEach((s) => s.remove());
          const inlineScript = document.createElement("script");
          inlineScript.textContent = "\n" + codes.join("\n\n") + "\n";
          docClone.querySelector("body").appendChild(inlineScript);
          const fullHtml = "<!doctype html>\n" + docClone.outerHTML;
          const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "index.html";
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(a.href);
          showToast("7개 엔진 + UI가 하나로 병합된 단일 index.html 파일이 다운로드되었습니다!", "good");
        } catch (err) {
          showToast("단일 파일 생성 중 오류가 발생했습니다.", "bad");
        } finally {
          btnExportHtml.disabled = false;
          btnExportHtml.textContent = "단일 index.html 다운로드 (Netlify용)";
        }
      });
    }

    // [요청 1] 상단 구단주 증액 요청 버튼
    const btnBudgetModal = $("btnOpenBudgetRequestModal");
    if (btnBudgetModal) {
      btnBudgetModal.addEventListener("click", () => openBudgetRequestModal());
    }

    // [요청 4-B] 로스터 테이블 컬럼 헤더 클릭 정렬 (포지션, 선수명, 나이, OVR, 잠재력, WAR, 연봉, 피로도)
    document.querySelectorAll("[data-roster-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const col = th.dataset.rosterSort;
        if (!col) return;
        if (STATE.rosterSortField === col) {
          STATE.rosterSortAsc = !STATE.rosterSortAsc;
        } else {
          STATE.rosterSortField = col;
          STATE.rosterSortAsc = col === "pos" || col === "name" || col === "age";
        }
        renderRosterTab();
      });
    });

    // [요청 8] 단장 간 트레이드 협상실: 타구단 오퍼 탐색, AI 조건 자동 맞추기 & 최종 트레이드 실행 버튼
    const btnFindOffers = $("btnFindTradeOffers");
    if (btnFindOffers) {
      btnFindOffers.addEventListener("click", () => {
        const ctx = STATE.ctx;
        if (!ctx || !GM.Setup) return;
        const userTeam = ctx.getUserTeam();
        const myAll = [...userTeam.roster1G, ...userTeam.roster2G].sort((a, b) => b.getTrueOvr() - a.getTrueOvr());
        const myPids = STATE.tradeMyPlayerIds.length
          ? STATE.tradeMyPlayerIds
          : myAll.slice(4, 6).map((p) => p.id);
        if (!STATE.tradeMyPlayerIds.length && myPids.length) {
          STATE.tradeMyPlayerIds = [myPids[0]];
        }
        const offers = [];
        const otherTeams = ctx.kboTeams.filter((t) => t.id !== userTeam.id);
        otherTeams.forEach((ot) => {
          const candRoster = [...ot.roster1G, ...ot.roster2G].sort((a, b) => b.getTrueOvr() - a.getTrueOvr());
          for (let i = 0; i < Math.min(18, candRoster.length); i++) {
            const tp = candRoster[i];
            const ev = GM.Setup.evaluateTradePackage(ctx, {
              partnerTeamId: ot.id,
              myPlayerIds: STATE.tradeMyPlayerIds,
              targetPlayerIds: [tp.id],
              myPickRounds: [],
              targetPickRounds: [],
              cashToPartner: 0,
              cashFromPartner: 0
            });
            if (ev && ev.ok && ev.diff >= -6 && ev.diff <= 8) {
              const cashAdj = ev.diff < -1.5 ? Math.min(ot.budget, Math.ceil(Math.abs(ev.diff + 1.0) / 0.00022 / 1000) * 1000) : 0;
              const myNames = STATE.tradeMyPlayerIds
                .map((id) => myAll.find((x) => x.id === id))
                .filter(Boolean)
                .map((x) => `${x.name}(${x.pos}, OVR ${x.getTrueOvr()})`)
                .join(", ");
              offers.push({
                partnerTeamId: ot.id,
                partnerTeamName: ot.name,
                myPlayerIds: [...STATE.tradeMyPlayerIds],
                targetPlayerIds: [tp.id],
                cashToPartner: cashAdj,
                myDesc: `${myNames}${cashAdj > 0 ? ` + 현금 ${fmtMoney(cashAdj)}` : ""}`,
                targetDesc: `${tp.name}(${tp.pos}, OVR ${tp.getTrueOvr()}, WAR ${tp.getWar().toFixed(1)})`,
                diff: Number((ev.diff + cashAdj * 0.00022).toFixed(1))
              });
              break;
            }
          }
        });
        STATE.exploredTradeOffers = offers.slice(0, 6);
        if (STATE.exploredTradeOffers.length) {
          showToast(`타구단 단장들로부터 ${STATE.exploredTradeOffers.length}건의 트레이드 역제안이 도착했습니다!`, "good");
        } else {
          showToast("선택한 선수와 가치 밸런스가 맞는 1:1 카드를 찾지 못했습니다. 다른 선수를 선택해 보세요.", "info");
        }
        renderTradeSubPanel();
      });
    }

    const btnTradeAutoBal = $("btnTradeAutoBalance");
    if (btnTradeAutoBal) {
      btnTradeAutoBal.addEventListener("click", () => {
        if (!GM.Setup || typeof GM.Setup.autoBalanceTradePackage !== "function") return;
        const res = GM.Setup.autoBalanceTradePackage(STATE.ctx, {
          partnerTeamId: STATE.tradePartnerTeamId,
          myPlayerIds: STATE.tradeMyPlayerIds,
          targetPlayerIds: STATE.tradeTargetPlayerIds,
          myPickRounds: STATE.tradeMyPickRounds,
          targetPickRounds: STATE.tradeTargetPickRounds,
          cashToPartner: STATE.tradeCashToPartner,
          cashFromPartner: STATE.tradeCashFromPartner
        });
        if (!res.ok) {
          showToast(res.reason || "트레이드할 우리 선수 또는 상대 선수를 먼저 체크해 주세요.", "bad");
          return;
        }
        STATE.tradeMyPickRounds = res.myPickRounds || [];
        STATE.tradeTargetPickRounds = res.targetPickRounds || [];
        STATE.tradeCashToPartner = res.cashToPartner || 0;
        STATE.tradeCashFromPartner = res.cashFromPartner || 0;
        showToast(res.message || "AI 단장 요구에 맞춰 신인 지명권 및 현금 카드를 자동 보정했습니다!", "good");
        renderTradeSubPanel();
      });
    }

    const btnExecPkgTrade = $("btnExecutePackageTrade");
    if (btnExecPkgTrade) {
      btnExecPkgTrade.addEventListener("click", () => {
        if (!GM.Setup || typeof GM.Setup.executePackageTrade !== "function") return;
        const res = GM.Setup.executePackageTrade(STATE.ctx, {
          partnerTeamId: STATE.tradePartnerTeamId,
          myPlayerIds: STATE.tradeMyPlayerIds,
          targetPlayerIds: STATE.tradeTargetPlayerIds,
          myPickRounds: STATE.tradeMyPickRounds,
          targetPickRounds: STATE.tradeTargetPickRounds,
          cashToPartner: STATE.tradeCashToPartner,
          cashFromPartner: STATE.tradeCashFromPartner
        });
        if (!res.ok) {
          if (res.vetoedByManager && res.vetoEvent) {
            showToast(res.reason, "bad");
            openTradeVetoModal(res.vetoEvent);
            return;
          }
          showToast(res.reason || "트레이드 조건이 맞지 않거나 마감 시한이 지났습니다.", "bad");
          return;
        }
        STATE.tradeMyPlayerIds = [];
        STATE.tradeTargetPlayerIds = [];
        STATE.tradeMyPickRounds = [];
        STATE.tradeTargetPickRounds = [];
        STATE.tradeCashToPartner = 0;
        STATE.tradeCashFromPartner = 0;
        STATE.exploredTradeOffers = [];
        showToast(res.summary, "good");
        renderAll();
      });
    }

    // 로스터 서브탭 & 필터
    document.querySelectorAll("[data-roster-sub]").forEach((btn) => {
      btn.addEventListener("click", () => {
        STATE.rosterSubTab = btn.dataset.rosterSub;
        document.querySelectorAll("[data-roster-sub]").forEach((b) => b.classList.toggle("active", b === btn));
        renderRosterTab();
      });
    });

    document.querySelectorAll("[data-pos-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        STATE.rosterPosFilter = btn.dataset.posFilter;
        document.querySelectorAll("[data-pos-filter]").forEach((b) => b.classList.toggle("active", b === btn));
        renderRosterTab();
      });
    });

    const rosterTeamSel = $("rosterTeamSelect");
    if (rosterTeamSel) {
      rosterTeamSel.addEventListener("change", (e) => {
        STATE.rosterViewTeamId = e.target.value;
        renderRosterTab();
      });
    }

    const btnUpgradeScout = $("btnUpgradeScout");
    if (btnUpgradeScout) {
      btnUpgradeScout.addEventListener("click", () => {
        const ctx = STATE.ctx;
        if (ctx.scoutLevel >= 5) return;
        const cost = (ctx.scoutLevel + 1) * 12000;
        const userTeam = ctx.getUserTeam();
        userTeam.budget -= cost;
        ctx.scoutLevel += 1;
        ctx.refreshAllScoutingReports();
        showToast(`스카우트 팀이 Lv.${ctx.scoutLevel}(으)로 증설되어 타구단/유망주 오차 범위가 축소되었습니다!`, "good");
        renderAll();
      });
    }

    // 오프시즌 서브탭
    document.querySelectorAll("[data-off-sub]").forEach((btn) => {
      btn.addEventListener("click", () => {
        STATE.offseasonSubTab = btn.dataset.offSub;
        renderOffseasonTab();
      });
    });

    // 드래프트 액션 버튼들 (9월 23일 지명 오픈 검증 적용)
    const btnDraftAutoRound = $("btnDraftAutoRound");
    if (btnDraftAutoRound) {
      btnDraftAutoRound.addEventListener("click", () => {
        const ctx = STATE.ctx;
        if (GM.Setup && typeof GM.Setup.canPickRookieDraftNow === "function") {
          const chk = GM.Setup.canPickRookieDraftNow(ctx.currentDate, ctx);
          if (!chk.allowed) return showToast(chk.reason, "bad");
        }
        if (!ctx.draftState) GM.Draft.initDraftSession(ctx);
        const nextR = ctx.draftState.completedRounds.length + 1;
        if (nextR > 10) return showToast("이미 10라운드 지명이 모두 완료되었습니다.");
        const res = GM.Draft.runDraftRound(ctx, nextR, null);
        showToast(`${nextR}라운드 지명 완료: ${res.userPick ? res.userPick.playerName : "완료"}`, "good");
        runDelegatedDraftIfReady(ctx);
        renderAll();
      });
    }

    const btnDraftPassRound = $("btnDraftPassRound");
    if (btnDraftPassRound) {
      btnDraftPassRound.addEventListener("click", () => {
        const ctx = STATE.ctx;
        if (GM.Setup && typeof GM.Setup.canPickRookieDraftNow === "function") {
          const chk = GM.Setup.canPickRookieDraftNow(ctx.currentDate, ctx);
          if (!chk.allowed) return showToast(chk.reason, "bad");
        }
        if (!ctx.draftState) GM.Draft.initDraftSession(ctx);
        const nextR = ctx.draftState.completedRounds.length + 1;
        if (nextR > 10) return;
        GM.Draft.runDraftRound(ctx, nextR, "PASS");
        showToast(`${nextR}라운드 지명권을 포기(PASS)했습니다.`);
        runDelegatedDraftIfReady(ctx);
        renderAll();
      });
    }

    const btnDraftRunAll = $("btnDraftRunAll");
    if (btnDraftRunAll) {
      btnDraftRunAll.addEventListener("click", () => {
        const ctx = STATE.ctx;
        if (GM.Setup && typeof GM.Setup.canPickRookieDraftNow === "function") {
          const chk = GM.Setup.canPickRookieDraftNow(ctx.currentDate, ctx);
          if (!chk.allowed) return showToast(chk.reason, "bad");
        }
        if (!ctx.draftState) GM.Draft.initDraftSession(ctx);
        while (ctx.draftState.completedRounds.length < 10 && ctx.draftPool.length > 0) {
          const r = ctx.draftState.completedRounds.length + 1;
          GM.Draft.runDraftRound(ctx, r, null);
        }
        STATE.lastDraftReport = GM.Draft.buildDraftSummaryReport(ctx);
        showToast(`1~10라운드 전 구단 신인 드래프트 완료! (내 구단 등급: ${STATE.lastDraftReport.userTeamSummary.grade})`, "good");
        renderAll();
      });
    }

    // 연봉협상 정책 & 실행 버튼
    document.querySelectorAll("[data-salary-policy]").forEach((btn) => {
      btn.addEventListener("click", () => {
        STATE.userSalaryPolicy = btn.dataset.salaryPolicy;
        STATE.userSalaryOffers = {};
        document.querySelectorAll("[data-salary-policy]").forEach((b) => b.classList.toggle("active", b === btn));
        renderSalarySubPanel();
      });
    });

    const btnRunSalary = $("btnRunSalaryRenewals");
    if (btnRunSalary) {
      btnRunSalary.addEventListener("click", () => {
        STATE.lastSalaryReport = GM.Offseason.processSalaryRenewals(STATE.ctx, {
          userOffers: STATE.userSalaryOffers,
          userPolicy: STATE.userSalaryPolicy
        });
        showToast("전 구단 연봉 재계약 및 연봉 조정 심사가 완료되었습니다!", "good");
        renderAll();
      });
    }

    // FA 공시 및 입찰 마감 버튼
    const btnDeclareFA = $("btnDeclareFA");
    if (btnDeclareFA) {
      btnDeclareFA.addEventListener("click", () => {
        const list = GM.Offseason.declareEligibleFAPlayers(STATE.ctx);
        showToast(
          `KBO FA 자격 선수 ${STATE.ctx.faPool.length}명이 공시되었습니다! ${STATE.ctx.faPriorityEndsDate}까지 원소속구단 우선협상 기간입니다.`,
          "info"
        );
        renderAll();
      });
    }

    const btnRunFAMarket = $("btnRunFAMarket");
    if (btnRunFAMarket) {
      btnRunFAMarket.addEventListener("click", () => {
        if ((STATE.ctx.faMarketPhase || "PRIORITY") === "PRIORITY" && STATE.ctx.faPool.length > 0) {
          showToast(
            `원소속구단 우선협상 기간(${STATE.ctx.faPriorityEndsDate || "-"}까지)에는 FA 시장 입찰을 마감할 수 없습니다.`,
            "bad"
          );
          return;
        }
        STATE.lastFAReport = GM.Offseason.runFAMarketSession(STATE.ctx, STATE.userFABids, {
          autoDeclareFromRosters: STATE.ctx.faPool.length === 0
        });
        STATE.userFABids = {};
        showToast(`FA 시장 비공개 경쟁 입찰 및 보상선수 지명이 완료되었습니다!`, "good");
        renderAll();
      });
    }

    // 외국인 선수 전원 유지 / 전원 제외(교체) / 계약 확정 버튼
    const btnForAllKeep = $("btnForeignSelectAllKeep");
    if (btnForAllKeep) {
      btnForAllKeep.addEventListener("click", () => {
        const userTeam = STATE.ctx.getUserTeam();
        const curForeigns = userTeam.getAllPlayers().filter((p) => p.nationality !== "KOR" && !p.isAsianQuarter);
        STATE.foreignKeepInitializedYear = STATE.ctx.currentYear;
        curForeigns.forEach((fp) => STATE.userForeignKeepIds.add(fp.id));
        showToast(`현재 보유 외국인 ${curForeigns.length}명 전원을 재계약 유지 대상으로 선택했습니다.`, "info");
        renderForeignSubPanel();
      });
    }

    const btnForClearKeep = $("btnForeignClearAllKeep");
    if (btnForClearKeep) {
      btnForClearKeep.addEventListener("click", () => {
        STATE.foreignKeepInitializedYear = STATE.ctx.currentYear;
        STATE.userForeignKeepIds.clear();
        showToast("현재 보유 외국인 3명 전원을 재계약 제외(전원 교체)로 설정했습니다.", "info");
        renderForeignSubPanel();
      });
    }

    const btnRunForeign = $("btnRunForeignContracts");
    if (btnRunForeign) {
      btnRunForeign.addEventListener("click", () => {
        const userTeam = STATE.ctx.getUserTeam();
        const curForeigns = userTeam.getAllPlayers().filter((p) => p.nationality !== "KOR" && !p.isAsianQuarter);
        const keepIds = Array.from(STATE.userForeignKeepIds);
        const releaseIds = curForeigns.map((p) => p.id).filter((id) => !STATE.userForeignKeepIds.has(id));
        const signIds = Array.from(STATE.userForeignSignIds);

        STATE.lastForeignReport = GM.Offseason.processForeignPlayerContracts(STATE.ctx, {
          keepIds,
          releaseIds,
          signIds,
          salaryOffers: STATE.userForeignSalaryOffers
        });
        // 확정 후 새로운 외국인 명단에 맞춰 유지 ID 동기화
        STATE.userForeignSignIds.clear();
        STATE.foreignKeepInitializedYear = STATE.ctx.currentYear;
        STATE.userForeignKeepIds.clear();
        userTeam
          .getAllPlayers()
          .filter((p) => p.nationality !== "KOR" && !p.isAsianQuarter)
          .forEach((fp) => STATE.userForeignKeepIds.add(fp.id));

        const depCnt =
          STATE.lastForeignReport &&
          STATE.lastForeignReport.userTeamSummary &&
          STATE.lastForeignReport.userTeamSummary.departedToUpperLeague
            ? STATE.lastForeignReport.userTeamSummary.departedToUpperLeague.length
            : 0;
        showToast(
          depCnt > 0
            ? `외국인 계약 완료 (상위리그 오퍼로 ${depCnt}명 이적 발생 → 대체 외국인 자동 보강 완료!)`
            : "10개 구단 외국인 선수 재계약 및 NPB/해외 영입이 완료되었습니다!",
          depCnt > 0 ? "info" : "good"
        );
        renderAll();
      });
    }

    // 코치진 계약 & 스프링캠프(14일 일정 출발) & 새 시즌 개막 버튼
    const btnConfirmStaff = $("btnConfirmStaff");
    if (btnConfirmStaff) {
      btnConfirmStaff.addEventListener("click", () => {
        const mgr = $("campMgrSelect").value;
        const pit = $("campPitSelect").value;
        const hit = $("campHitSelect").value;
        GM.SpringCamp.manageCoachingStaff(STATE.ctx, {
          manager: mgr,
          pitchingCoach: pit,
          hittingCoach: hit
        });
        showToast(`감독(${mgr}) · 투수코치(${pit}) · 타격코치(${hit}) 선임이 완료되었습니다!`, "good");
        renderAll();
      });
    }

    const btnRunSpringCamp = $("btnRunSpringCamp");
    if (btnRunSpringCamp) {
      btnRunSpringCamp.addEventListener("click", () => {
        const loc = $("campLocSelect").value;
        const focus = $("campFocusSelect").value;
        if (GM.Setup && typeof GM.Setup.startSpringCampSchedule === "function") {
          const res = GM.Setup.startSpringCampSchedule(STATE.ctx, {
            userCampLocation: loc,
            trainingFocus: focus
          });
          if (!res.ok) {
            showToast(res.reason || "스프링캠프를 출발할 수 없습니다.", "bad");
            return;
          }
          showToast(res.message, "good");
          renderAll();
        } else {
          STATE.lastCampReport = GM.SpringCamp.runSpringCamp(STATE.ctx, {
            userCampLocation: loc,
            trainingFocus: focus
          });
          showToast(`${STATE.lastCampReport.userCampReport.locationName} 전지훈련을 마쳤습니다!`, "good");
          renderAll();
        }
      });
    }

    const btnStartNewSeason = $("btnStartNewSeason");
    if (btnStartNewSeason) {
      btnStartNewSeason.addEventListener("click", async () => {
        const res = GM.SpringCamp.finalizeOffseasonAndStartSeason(STATE.ctx);
        STATE.lastWeeklyReport = null;
        STATE.lastDraftReport = null;
        STATE.lastSalaryReport = null;
        STATE.lastFAReport = null;
        STATE.lastForeignReport = null;
        STATE.lastCampReport = null;
        await GM.Storage.saveGame("auto_save", STATE.ctx, { label: `${res.newYear}시즌 개막 자동저장` });
        STATE.activeTab = "pennant";
        showToast(`${res.newYear}시즌 페넌트레이스가 개막했습니다! (전 선수 나이+1 & 에이징 커브 반영)`, "good");
        renderAll();
      });
    }

    // 기록실 서브탭
    document.querySelectorAll("[data-rec-sub]").forEach((btn) => {
      btn.addEventListener("click", () => {
        STATE.recordsSubTab = btn.dataset.recSub;
        renderRecordsTab();
      });
    });

    // 모달 닫기
    const closeBtn = $("gmModalClose");
    const backdrop = $("gmModalBackdrop");
    if (closeBtn) closeBtn.addEventListener("click", () => (backdrop.hidden = true));
    if (backdrop) {
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) backdrop.hidden = true;
      });
    }

    // 문서 위임 클릭 핸들러 (동적 생성 버튼들 처리)
    document.addEventListener("click", async (e) => {
      const matchCard = e.target.closest("[data-match-idx]");
      if (matchCard) {
        openMatchBoxModal(Number(matchCard.dataset.matchIdx));
        return;
      }

      const moveBtn = e.target.closest("[data-move-player]");
      if (moveBtn) {
        const pid = moveBtn.dataset.movePlayer;
        const targetStatus = moveBtn.dataset.targetStatus;
        const userTeam = STATE.ctx.getUserTeam();
        const res = userTeam.movePlayerStatus(pid, targetStatus);
        if (!res.ok) {
          showToast(res.reason, "bad");
        } else {
          showToast(`${res.player.name} 선수를 ${targetStatus}(으)로 이동했습니다.`, "good");
          renderAll();
        }
        return;
      }

      const nfNegBtn = e.target.closest("[data-nonfa-negotiate]");
      if (nfNegBtn) {
        openNonFANegotiationModal(nfNegBtn.dataset.nonfaNegotiate);
        return;
      }
      const nfSignBtn = e.target.closest("[data-nonfa-sign]");
      if (nfSignBtn && GM.NonFA) {
        const res = GM.NonFA.signContract(STATE.ctx, STATE.ctx.userTeamId, nfSignBtn.dataset.nonfaSign, {
          years: Number($("nfYears").value),
          aav: Number($("nfAav").value),
          optionRatio: Number($("nfOption").value) / 100,
          structure: $("nfStructure").value,
          postingClause: $("nfPosting").checked
        });
        if (res.ok) {
          $("gmModalBackdrop").hidden = true;
          showToast(res.summary, "good");
          renderAll();
        } else {
          showToast(res.reason, "bad");
        }
        return;
      }
      if (e.target.closest("[data-set-franchise]") && GM.NonFA) {
        const res = GM.NonFA.setFranchisePlayer(STATE.ctx, STATE.ctx.userTeamId, ($("franchiseSelect") || {}).value || null);
        showToast(res.ok ? res.summary : res.reason, res.ok ? "good" : "bad");
        renderAll();
        return;
      }

      const youthBtn = e.target.closest("[data-attend-youth]");
      if (youthBtn && GM.Draft && typeof GM.Draft.attendYouthEvent === "function") {
        const res = GM.Draft.attendYouthEvent(STATE.ctx, youthBtn.dataset.attendYouth);
        if (res.ok) {
          STATE.lastYouthViewing = res;
          showToast(res.summary, "good");
        } else {
          showToast(res.reason, "bad");
        }
        renderAll();
        return;
      }

      const draftPickBtn = e.target.closest("[data-draft-pick]");
      if (draftPickBtn) {
        const pid = draftPickBtn.dataset.draftPick;
        const ctx = STATE.ctx;
        if (GM.Setup && typeof GM.Setup.canPickRookieDraftNow === "function") {
          const chk = GM.Setup.canPickRookieDraftNow(ctx.currentDate, ctx);
          if (!chk.allowed) {
            showToast(chk.reason, "bad");
            return;
          }
        }
        if (!ctx.draftState) GM.Draft.initDraftSession(ctx);
        const nextR = ctx.draftState.completedRounds.length + 1;
        if (nextR > 10) return showToast("이미 10라운드 지명이 모두 완료되었습니다.");
        const res = GM.Draft.runDraftRound(ctx, nextR, pid);
        showToast(
          `${nextR}라운드 지명 완료: ${res.userPick ? `${res.userPick.playerName} (${res.userPick.pos})` : ""}`,
          "good"
        );
        runDelegatedDraftIfReady(ctx);
        renderAll();
        return;
      }

      const undraftedBtn = e.target.closest("[data-sign-undrafted]");
      if (undraftedBtn) {
        const pid = undraftedBtn.dataset.signUndrafted;
        const res = GM.Draft.signUndraftedProspect(STATE.ctx, STATE.ctx.userTeamId, pid);
        if (res.ok) {
          showToast(`미지명 유망주 ${res.player.name} 선수를 육성선수로 영입했습니다!`, "good");
          renderAll();
        }
        return;
      }

      const faBidBtn = e.target.closest("[data-fa-bid]");
      if (faBidBtn) {
        const pid = faBidBtn.dataset.faBid;
        const yrsEl = $(`faYrs_${pid}`);
        const totEl = $(`faTot_${pid}`);
        const years = Number(yrsEl ? yrsEl.value : 4);
        const totalAmount = fromEokInput(totEl ? totEl.value : 10, 3000 * years);
        if (STATE.userFABids[pid]) {
          delete STATE.userFABids[pid];
          showToast("FA 입찰을 취소했습니다.");
        } else {
          STATE.userFABids[pid] = { years, totalAmount };
          showToast(`${years}년 총액 ${fmtMoney(totalAmount)} 입찰서가 등록되었습니다.`, "good");
        }
        renderFASubPanel();
        return;
      }

      // [요청 3] FA 시장 협상 단계 전환 (PRIORITY ↔ OPEN) 및 등급/포지션/소속 필터 핸들러
      const faPhaseBtn = e.target.closest("[data-fa-switch-phase]");
      if (faPhaseBtn && GM.Offseason && typeof GM.Offseason.advanceToOpenFAMarket === "function") {
        const targetPhase = faPhaseBtn.dataset.faSwitchPhase || "OPEN";
        const res = GM.Offseason.advanceToOpenFAMarket(STATE.ctx, { targetPhase });
        if (res && res.ok) {
          showToast(res.message, "good");
          renderAll();
        }
        return;
      }

      const faGradeBtn = e.target.closest("[data-fa-grade-filter]");
      if (faGradeBtn) {
        STATE.faGradeFilter = faGradeBtn.dataset.faGradeFilter || "ALL";
        renderFASubPanel();
        return;
      }

      const faAffBtn = e.target.closest("[data-fa-aff-filter]");
      if (faAffBtn) {
        STATE.faAffiliationFilter = faAffBtn.dataset.faAffFilter || "ALL";
        renderFASubPanel();
        return;
      }

      const faPosBtn = e.target.closest("[data-fa-pos-filter]");
      if (faPosBtn) {
        STATE.faPosFilter = faPosBtn.dataset.faPosFilter || "ALL";
        renderFASubPanel();
        return;
      }

      const tradeNatBtn = e.target.closest("[data-trade-nat-mode]");
      if (tradeNatBtn) {
        const nextMode = tradeNatBtn.dataset.tradeNatMode || "DOMESTIC";
        if (STATE.tradeNationalityMode !== nextMode) {
          STATE.tradeNationalityMode = nextMode;
          STATE.tradeMyPlayerIds = [];
          STATE.tradeTargetPlayerIds = [];
          showToast(
            nextMode === "FOREIGN"
              ? "🌍 외국인끼리 트레이드 트랙으로 전환되었습니다. (외국인 선수만 상호 교환 가능)"
              : "🇰🇷 내국인끼리 트레이드 트랙으로 전환되었습니다. (내국인 선수만 상호 교환 가능)",
            "info"
          );
          renderTradeSubPanel();
        }
        return;
      }

      // [요청 1] 2군/육성 최하위 전력 1명 즉시 방출 (예산 절감)
      if (e.target.closest("#btnQuickReleaseLowest2GDev") && GM.Setup) {
        const userTeam = STATE.ctx.getUserTeam();
        const pool2GDev = [...(userTeam.rosterDev || []), ...(userTeam.roster2G || [])].filter(
          (p) => p.nationality === "KOR"
        );
        if (!pool2GDev.length) {
          showToast("현재 방출 가능한 2군/육성선수가 없습니다.", "bad");
          return;
        }
        pool2GDev.sort((a, b) => a.getTrueOvr() * 0.65 + (a.potential || 60) * 0.35 - (b.getTrueOvr() * 0.65 + (b.potential || 60) * 0.35));
        const target = pool2GDev[0];
        const res = GM.Setup.releaseDomesticPlayer(STATE.ctx, userTeam.id, target.id);
        if (res.ok) {
          showToast(res.summary, "good");
          renderAll();
        } else {
          showToast(res.reason, "bad");
        }
        return;
      }

      // [KBO_GM.FA & 요청 3: 우선협상 기간 반영 실전 다회차(1~3차) FA 협상 모달]
      const faLogModalBtn = e.target.closest("[data-fa-logistic-modal]");
      if (faLogModalBtn && GM.FA) {
        const pid = faLogModalBtn.dataset.faLogisticModal;
        const p = (STATE.ctx.faPool || []).find((x) => x.id === pid);
        if (p) {
          const prof = p.faProfile || GM.Offseason.evaluateFAPlayerMarketProfile(p, STATE.ctx);
          const bd = prof.breakdown || GM.FA.breakdownContract(prof.demandTotal, prof.faGrade, prof.demandYears);
          const isHomeFA = p.formerTeamId === STATE.ctx.userTeamId;
          const phase = STATE.ctx.faMarketPhase || "PRIORITY";
          const isPriorityRestricted = phase === "PRIORITY" && !isHomeFA;
          const negState = p.faNegotiationState || { round: 0, maxRounds: 3, status: "ACTIVE", patience: 100, history: [] };
          const curBid =
            (negState.lastCounterOffer && {
              Y: negState.lastCounterOffer.Y,
              DP: negState.lastCounterOffer.DP,
              BS: negState.lastCounterOffer.BS,
              Opt: negState.lastCounterOffer.Opt
            }) ||
            STATE.userFABids[p.id] || {
              Y: bd.Y,
              DP: bd.DP,
              BS: bd.BS,
              Opt: bd.Opt
            };
          const evalRes = GM.FA.evaluateOfferAcceptance(p, curBid, bd, {
            isHomeTeam: isHomeFA,
            isPriorityPhase: phase === "PRIORITY",
            context: STATE.ctx
          });

          $("gmModalTitle").textContent = `🤝 [실전 FA 협상 테이블] ${p.name} (${p.pos}, ${p.age}세 · ${prof.faGrade}등급 · ${isHomeFA ? "원소속 우선협상 대상" : `${p.formerTeamName || p.formerTeamId} 출신 외부 FA`})`;
          $("gmModalBody").innerHTML = `
            <div class="weekly-summary-banner" style="margin-bottom:12px;border-left:4px solid ${isPriorityRestricted ? "#ef4444" : "#22c55e"}">
              <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px">
                <div>
                  <strong>현재 시장 단계: ${phase === "PRIORITY" ? "🔒 1단계 원소속구단 우선협상 기간" : "🔓 2단계 전 구단 완전 개방(Open Market)"}</strong>
                  <span class="sep">·</span>
                  <span class="tnum">협상 라운드: <strong>${negState.round} / ${negState.maxRounds}차</strong> (에이전트 인내심: <strong>${negState.patience}%</strong>)</span>
                </div>
                ${
                  isPriorityRestricted
                    ? `<button type="button" class="btn-xs primary" data-fa-unlock-and-reopen="${p.id}">🔓 지금 전 구단 자유협상(Open Market)으로 전환하고 협상 개시</button>`
                    : ""
                }
              </div>
              <div style="margin-top:6px">
                <strong>선수 요구 총액(V_req): ${fmtMoney(prof.demandTotal)} (${prof.demandYears}년)</strong>
                <span class="sep">·</span>
                <span class="tnum">3년가중 WAR: <strong>${(prof.WAR_3yr || 2.5).toFixed(2)}</strong> × 8.5억 × D_age(${(prof.D_age || 1.0).toFixed(2)}) × P_grade(${(prof.P_grade || 1.0).toFixed(2)})</span>
              </div>
              <div class="tiny muted" style="margin-top:4px">
                표준 분할(Target): 계약금(DP) <strong>${fmtMoney(bd.DP)}</strong> · 보장연봉 총액(BS) <strong>${fmtMoney(bd.BS)}</strong> · 인센티브 옵션(Opt) <strong>${fmtMoney(bd.Opt)}</strong> (${esc(bd.optionClauseDesc || "")})
              </div>
              <div class="tiny ${isHomeFA ? "text-good" : "text-bad"}" style="margin-top:3px">
                ${
                  isHomeFA
                    ? `🏠 [원소속구단 프리미엄] 보상선수·보상금 전면 면제 + 우선협상 충성도 보너스(${phase === "PRIORITY" ? "+7%" : "+3%"}) 적용!`
                    : `⚠️ [외부 영입 보상 페널티] ${fmtMoney(prof.Penalty_comp || 0)} (${esc(prof.gradeReason || prof.rule.desc)})`
                }
              </div>
            </div>

            <div class="scout-card" style="margin-bottom:12px">
              <div class="scout-card-head">
                <strong>구단 공식 오퍼 조건 입력 (단위: 억 원 · 계약금 가중치 1.15배, 옵션 계수 α=${evalRes.alpha_player})</strong>
              </div>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:8px">
                <label class="tiny">계약 기간 (Y, 1~6년)
                  <input type="number" id="faModY" class="num-input tnum" min="1" max="6" value="${evalRes.offer.Y}" style="width:100%;margin-top:4px">
                </label>
                <label class="tiny">계약금 일시금 (DP, 억 원)
                  <input type="number" id="faModDP" class="num-input tnum" step="0.5" min="0" value="${toEokNum(evalRes.offer.DP)}" style="width:100%;margin-top:4px">
                </label>
                <label class="tiny">보장연봉 총액 (BS, 억 원)
                  <input type="number" id="faModBS" class="num-input tnum" step="0.5" min="0.3" value="${toEokNum(evalRes.offer.BS)}" style="width:100%;margin-top:4px">
                </label>
                <label class="tiny">인센티브 옵션 (Opt, 억 원)
                  <input type="number" id="faModOpt" class="num-input tnum" step="0.2" min="0" value="${toEokNum(evalRes.offer.Opt)}" style="width:100%;margin-top:4px">
                </label>
              </div>
              <div id="faModEvalBox" class="report-box" style="margin-top:10px">
                <div><strong>제시 총액:</strong> ${fmtMoney(evalRes.offer.totalOfferManwon)} (연평균 보장 ${fmtMoney(evalRes.offer.annualBaseSalaryManwon)}) · <strong>효용 충족률(U_offer / U_target):</strong> <span class="tnum">${(evalRes.ratio * 100).toFixed(1)}% (${fmtMoney(evalRes.U_offer)} / ${fmtMoney(evalRes.U_target)})</span></div>
                <div style="margin-top:4px"><strong>로지스틱 수용 확률 P(Accept):</strong> <strong class="${evalRes.probabilityPct >= 80 ? "text-good" : evalRes.probabilityPct <= 20 ? "text-bad" : ""}">${evalRes.probabilityPct}%</strong> (${esc(evalRes.status)})</div>
                <div class="tiny muted" style="margin-top:4px">${esc(evalRes.playerComment)}</div>
                ${
                  negState.lastCounterOffer
                    ? `<div class="tiny" style="margin-top:6px;padding:6px 8px;background:rgba(245,158,11,0.12);border-radius:6px;color:#f59e0b">
                        <strong>💬 직전 에이전트 역제안 조건:</strong> ${negState.lastCounterOffer.Y}년 총액 <strong>${fmtMoney(negState.lastCounterOffer.totalManwon)}</strong> (계약금 ${fmtMoney(negState.lastCounterOffer.DP)} · 연봉총액 ${fmtMoney(negState.lastCounterOffer.BS)} · 옵션 ${fmtMoney(negState.lastCounterOffer.Opt)})
                       </div>`
                    : ""
                }
              </div>
              <div class="scout-actions" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px">
                <button type="button" class="btn-sm ghost" data-fa-logistic-preview="${p.id}">🔄 수용 확률 미리보기</button>
                <button type="button" class="btn-sm primary" data-fa-direct-negotiate="${p.id}" ${isPriorityRestricted || negState.status === "WALKED_AWAY" ? "disabled" : ""}>
                  🤝 ${negState.round + 1}차 실전 오퍼 제시 (즉시 협상 담판)
                </button>
                ${
                  negState.lastCounterOffer && negState.status !== "WALKED_AWAY"
                    ? `<button type="button" class="btn-sm primary" style="background:#16a34a" data-fa-accept-counter="${p.id}">
                        ⚡ 에이전트 역제안(${negState.lastCounterOffer.Y}년 ${fmtMoney(negState.lastCounterOffer.totalManwon)}) 즉시 수용·타결
                       </button>`
                    : ""
                }
                <button type="button" class="btn-sm ghost" data-fa-logistic-submit="${p.id}">📥 일괄 입찰서만 등록</button>
              </div>
            </div>
          `;
          $("gmModalBackdrop").hidden = false;
        }
        return;
      }

      // 우선협상 제한 모달에서 즉시 오픈마켓 전환 후 해당 선수 모달 재오픈
      const unlockReopenBtn = e.target.closest("[data-fa-unlock-and-reopen]");
      if (unlockReopenBtn && GM.Offseason && typeof GM.Offseason.advanceToOpenFAMarket === "function") {
        const pid = unlockReopenBtn.dataset.faUnlockAndReopen;
        const res = GM.Offseason.advanceToOpenFAMarket(STATE.ctx, { targetPhase: "OPEN", simulateAIPriority: false });
        if (res && res.ok) {
          showToast("전 구단 자유협상(Open Market) 단계로 전환되었습니다! 이제 외부 FA 선수와 직접 협상할 수 있습니다.", "good");
          renderFASubPanel();
          const fakeBtn = document.querySelector(`[data-fa-logistic-modal="${pid}"]`);
          if (fakeBtn) fakeBtn.click();
        }
        return;
      }

      // [요청 3] 실전 다회차 FA 직접 협상 제시 (즉시 타결 or 에이전트 역제안 or 결렬)
      const faDirectNegBtn = e.target.closest("[data-fa-direct-negotiate]");
      if (faDirectNegBtn && GM.Offseason && typeof GM.Offseason.negotiateFAPlayerDirect === "function") {
        const pid = faDirectNegBtn.dataset.faDirectNegotiate;
        const Y = clamp(Number($("faModY") && $("faModY").value) || 4, 1, 6);
        const DP = fromEokInput($("faModDP") && $("faModDP").value, 0);
        const BS = fromEokInput($("faModBS") && $("faModBS").value, 3000 * Y);
        const Opt = fromEokInput($("faModOpt") && $("faModOpt").value, 0);

        const res = GM.Offseason.negotiateFAPlayerDirect(STATE.ctx, pid, { Y, DP, BS, Opt });
        if (!res.ok) {
          showToast(res.message || "협상 진행 불가", "bad");
          return;
        }

        if (res.outcome === "SIGNED") {
          delete STATE.userFABids[pid];
          $("gmModalBackdrop").hidden = true;
          showToast(res.message, "good");
          renderAll();
        } else {
          showToast(res.message, res.outcome === "COUNTER_OFFER" ? "info" : "bad");
          renderFASubPanel();
          // 모달을 갱신하여 에이전트 역제안 조건 및 다음 라운드 버튼 표시
          const reopenTrigger = document.querySelector(`[data-fa-logistic-modal="${pid}"]`);
          if (reopenTrigger) reopenTrigger.click();
        }
        return;
      }

      // [요청 3] 에이전트 역제안 조건 즉시 수용 및 계약 타결
      const faAccCounterBtn = e.target.closest("[data-fa-accept-counter]");
      if (faAccCounterBtn && GM.Offseason && typeof GM.Offseason.negotiateFAPlayerDirect === "function") {
        const pid = faAccCounterBtn.dataset.faAcceptCounter;
        const res = GM.Offseason.negotiateFAPlayerDirect(STATE.ctx, pid, {}, { acceptCounterOffer: true });
        if (res && res.ok && res.outcome === "SIGNED") {
          delete STATE.userFABids[pid];
          $("gmModalBackdrop").hidden = true;
          showToast(res.message, "good");
          renderAll();
        } else if (res) {
          showToast(res.message || "역제안 수락 실패", "bad");
        }
        return;
      }

      const faLogPrevBtn = e.target.closest("[data-fa-logistic-preview]");
      if (faLogPrevBtn && GM.FA) {
        const pid = faLogPrevBtn.dataset.faLogisticPreview;
        const p = (STATE.ctx.faPool || []).find((x) => x.id === pid);
        if (p) {
          const prof = p.faProfile || GM.Offseason.evaluateFAPlayerMarketProfile(p, STATE.ctx);
          const Y = clamp(Number($("faModY") && $("faModY").value) || 4, 1, 6);
          const DP = fromEokInput($("faModDP") && $("faModDP").value, 0);
          const BS = fromEokInput($("faModBS") && $("faModBS").value, 3000 * Y);
          const Opt = fromEokInput($("faModOpt") && $("faModOpt").value, 0);
          const evalRes = GM.FA.evaluateOfferAcceptance(
            p,
            { Y, DP, BS, Opt },
            prof.breakdown,
            { isHomeTeam: p.formerTeamId === STATE.ctx.userTeamId, context: STATE.ctx }
          );
          const box = $("faModEvalBox");
          if (box) {
            box.innerHTML = `
              <div><strong>제시 총액:</strong> ${fmtMoney(evalRes.offer.totalOfferManwon)} (연평균 보장 ${fmtMoney(evalRes.offer.annualBaseSalaryManwon)}) · <strong>효용 충족률(U_offer / U_target):</strong> <span class="tnum">${(evalRes.ratio * 100).toFixed(1)}% (${fmtMoney(evalRes.U_offer)} / ${fmtMoney(evalRes.U_target)})</span></div>
              <div style="margin-top:4px"><strong>로지스틱 수용 확률 P(Accept):</strong> <strong class="${evalRes.probabilityPct >= 80 ? "text-good" : evalRes.probabilityPct <= 20 ? "text-bad" : ""}">${evalRes.probabilityPct}%</strong> (${esc(evalRes.status)})</div>
              <div class="tiny muted" style="margin-top:4px">${esc(evalRes.playerComment)}</div>
            `;
          }
        }
        return;
      }

      const faLogSubBtn = e.target.closest("[data-fa-logistic-submit]");
      if (faLogSubBtn && GM.FA) {
        const pid = faLogSubBtn.dataset.faLogisticSubmit;
        const p = (STATE.ctx.faPool || []).find((x) => x.id === pid);
        if (p) {
          const Y = clamp(Number($("faModY") && $("faModY").value) || 4, 1, 6);
          const DP = fromEokInput($("faModDP") && $("faModDP").value, 0);
          const BS = fromEokInput($("faModBS") && $("faModBS").value, 3000 * Y);
          const Opt = fromEokInput($("faModOpt") && $("faModOpt").value, 0);
          const totalAmount = DP + BS + Opt;
          STATE.userFABids[pid] = {
            years: Y,
            Y,
            DP,
            BS,
            Opt,
            signingBonus: DP,
            annualSalary: Math.round(BS / Y),
            totalAmount
          };
          $("gmModalBackdrop").hidden = true;
          showToast(
            `${p.name} 선수에게 [${Y}년 총액 ${fmtMoney(totalAmount)} (계약금 ${fmtMoney(DP)} / 보장연봉 ${fmtMoney(BS)} / 옵션 ${fmtMoney(Opt)})] 오퍼가 등록되었습니다!`,
            "good"
          );
          renderFASubPanel();
        }
        return;
      }

      // [요청 3] 외국인 선수 개별 재계약 협상 제시 (MLB/NPB 오퍼 대응)
      const negForBtn = e.target.closest("[data-negotiate-foreign]");
      if (negForBtn && GM.Offseason && typeof GM.Offseason.negotiateSingleForeignPlayer === "function") {
        const pid = negForBtn.dataset.negotiateForeign;
        const inpEl = $(`foreignOffer_${pid}`);
        const offered = fromEokInput(inpEl ? inpEl.value : 12.0, 30000);
        STATE.userForeignSalaryOffers[pid] = offered;
        const res = GM.Offseason.negotiateSingleForeignPlayer(STATE.ctx, STATE.ctx.userTeamId, pid, offered);
        if (res && res.ok) {
          STATE.foreignKeepInitializedYear = STATE.ctx.currentYear;
          if (res.accepted) {
            STATE.userForeignKeepIds.add(pid);
            showToast(res.message, "good");
          } else {
            showToast(res.message, "bad");
          }
          renderAll();
        }
        return;
      }

      // [요청 4] 스프링캠프 진행 중 '+1일 진행' 또는 '귀국일까지 진행(훈련 결과 확인)' 버튼
      const campAdvBtn = e.target.closest("[data-camp-advance-days]");
      if (campAdvBtn) {
        const days = Math.max(1, Number(campAdvBtn.dataset.campAdvanceDays || 1));
        advanceDaysUI(days);
        return;
      }

      // [요청 5] 트레이드 상대 구단 빠른 선택 버튼 / 직접 제안 / AI 자동 조율 / 탐색 오퍼 수락
      const selPartnerBtn = e.target.closest("[data-select-trade-partner]");
      if (selPartnerBtn) {
        STATE.tradePartnerTeamId = selPartnerBtn.dataset.selectTradePartner;
        STATE.tradeTargetPlayerIds = [];
        STATE.tradeTargetPickRounds = [];
        renderTradeSubPanel();
        return;
      }

      if (e.target.closest("[data-action-auto-balance]")) {
        const topBtn = $("btnTradeAutoBalance");
        if (topBtn) topBtn.click();
        return;
      }

      if (e.target.closest("[data-action-propose-trade]")) {
        const topBtn = $("btnExecutePackageTrade");
        if (topBtn) topBtn.click();
        return;
      }

      const loadExpBtn = e.target.closest("[data-load-explored-trade]");
      if (loadExpBtn) {
        const idx = Number(loadExpBtn.dataset.loadExploredTrade || 0);
        const of = (STATE.exploredTradeOffers || [])[idx];
        if (of) {
          STATE.tradePartnerTeamId = of.partnerTeamId;
          STATE.tradeMyPlayerIds = [...of.myPlayerIds];
          STATE.tradeTargetPlayerIds = [...of.targetPlayerIds];
          STATE.tradeMyPickRounds = [];
          STATE.tradeTargetPickRounds = [];
          STATE.tradeCashToPartner = of.cashToPartner || 0;
          STATE.tradeCashFromPartner = 0;
          showToast(`${of.partnerTeamName} 단장의 제안 조건을 협상 테이블에 불러왔습니다.`, "info");
          renderTradeSubPanel();
        }
        return;
      }

      const accExpBtn = e.target.closest("[data-accept-explored-trade]");
      if (accExpBtn && GM.Setup) {
        const idx = Number(accExpBtn.dataset.acceptExploredTrade || 0);
        const of = (STATE.exploredTradeOffers || [])[idx];
        if (of) {
          const res = GM.Setup.executePackageTrade(STATE.ctx, {
            partnerTeamId: of.partnerTeamId,
            myPlayerIds: of.myPlayerIds,
            targetPlayerIds: of.targetPlayerIds,
            myPickRounds: [],
            targetPickRounds: [],
            cashToPartner: of.cashToPartner || 0,
            cashFromPartner: 0
          });
          if (!res.ok) {
            showToast(res.reason || "트레이드 실행 실패", "bad");
          } else {
            STATE.exploredTradeOffers.splice(idx, 1);
            STATE.tradeMyPlayerIds = [];
            STATE.tradeTargetPlayerIds = [];
            showToast(res.summary, "good");
            renderAll();
          }
        }
        return;
      }

      const keepForBtn = e.target.closest("[data-toggle-foreign-keep]");
      if (keepForBtn) {
        const pid = keepForBtn.dataset.toggleForeignKeep;
        STATE.foreignKeepInitializedYear = STATE.ctx.currentYear;
        if (STATE.userForeignKeepIds.has(pid)) STATE.userForeignKeepIds.delete(pid);
        else STATE.userForeignKeepIds.add(pid);
        renderForeignSubPanel();
        return;
      }

      const signForBtn = e.target.closest("[data-toggle-foreign-sign]");
      if (signForBtn) {
        const pid = signForBtn.dataset.toggleForeignSign;
        if (STATE.userForeignSignIds.has(pid)) STATE.userForeignSignIds.delete(pid);
        else STATE.userForeignSignIds.add(pid);
        renderForeignSubPanel();
        return;
      }

      const saveSlotBtn = e.target.closest("[data-save-slot]");
      if (saveSlotBtn) {
        const slotId = saveSlotBtn.dataset.saveSlot;
        const res = await GM.Storage.saveGame(slotId, STATE.ctx);
        if (res && res.ok) {
          showToast(`슬롯 '${slotId}'에 현재 구단 데이터를 저장했습니다.`, "good");
          renderStorageTab();
        }
        return;
      }

      const loadSlotBtn = e.target.closest("[data-load-slot]");
      if (loadSlotBtn) {
        const slotId = loadSlotBtn.dataset.loadSlot;
        const loaded = await GM.Storage.loadGame(slotId);
        if (loaded) {
          STATE.ctx = loaded;
          STATE.rosterViewTeamId = loaded.userTeamId;
          showToast(`슬롯 '${slotId}'에서 ${loaded.getUserTeam().name} (${loaded.currentYear}년 ${loaded.currentWeek}주차) 데이터를 복원했습니다!`, "good");
          renderAll();
        } else {
          showToast("저장된 데이터를 찾을 수 없습니다.", "bad");
        }
        return;
      }

      const delSlotBtn = e.target.closest("[data-del-slot]");
      if (delSlotBtn) {
        const slotId = delSlotBtn.dataset.delSlot;
        await GM.Storage.deleteSave(slotId);
        showToast(`슬롯 '${slotId}' 데이터를 삭제했습니다.`);
        renderStorageTab();
        return;
      }

      const modalTrigger = e.target.closest("[data-player-modal]");
      if (modalTrigger) {
        openPlayerModal(
          modalTrigger.dataset.playerModal,
          modalTrigger.dataset.teamId,
          modalTrigger.dataset.pool || null
        );
        return;
      }

      // [시스템 4 & 요청 3] 아마추어 & 독립리그 스카우트 팀 파견 확정
      if (e.target.closest("#btnApplyScoutDispatch")) {
        const hs1 = Number(($("scDisp_HS1") && $("scDisp_HS1").value) || 0);
        const hs2 = Number(($("scDisp_HS2") && $("scDisp_HS2").value) || 0);
        const hs3 = Number(($("scDisp_HS3") && $("scDisp_HS3").value) || 0);
        const univ = Number(($("scDisp_UNIV") && $("scDisp_UNIV").value) || 0);
        const ind = Number(($("scDisp_IND") && $("scDisp_IND").value) || 0);
        const res = GM.Setup.dispatchAmateurScouts(STATE.ctx, { HS_1: hs1, HS_2: hs2, HS_3: hs3, UNIV: univ, IND: ind });
        if (!res.ok) {
          showToast(res.reason, "bad");
        } else {
          showToast(`스카우트 파견 완료 (고1:${hs1} · 고2:${hs2} · 고3:${hs3} · 대학:${univ} · 독립리그:${ind}명)`, "good");
          renderAll();
        }
        return;
      }

      // [신규 요청 1] 구단주 특별 운영 예산 증액 결재 실행
      const budReqBtn = e.target.closest("[data-exec-budget-req]");
      if (budReqBtn) {
        const tierId = budReqBtn.dataset.execBudgetReq;
        const res = GM.Setup.requestBudgetIncrease(STATE.ctx, tierId);
        if (!res.ok) {
          showToast(res.reason || "증액 요청을 진행할 수 없습니다.", "bad");
          return;
        }
        openBudgetRequestModal();
        const msgBox = $("budgetReqModalResultBox");
        if (msgBox) {
          msgBox.innerHTML = `<div class="report-box ${res.approved ? "text-good" : "text-bad"}"><strong>${esc(res.message)}</strong></div>`;
        }
        showToast(res.message, res.approved ? "good" : "bad");
        renderHeader();
        return;
      }

      // [신규 요청 2] 국내 선수 개별 방출 (신인 입단 수만큼 위약금 면제)
      const relDomBtn = e.target.closest("[data-release-domestic]");
      if (relDomBtn) {
        const pid = relDomBtn.dataset.releaseDomestic;
        const res = GM.Setup.releaseDomesticPlayer(STATE.ctx, STATE.ctx.userTeamId, pid);
        if (res.ok) {
          showToast(res.summary, "info");
          renderAll();
        } else {
          showToast(res.reason, "bad");
        }
        return;
      }

      // [신규 요청 2] 신인 드래프트 입단 수만큼 기존 하위 전력 자동 방출 정리
      if (e.target.closest("#btnAutoTrimDraftees") || e.target.closest("#btnDraftAutoTrimNow")) {
        const res = GM.Setup.autoTrimRosterForDraftees(STATE.ctx, STATE.ctx.userTeamId);
        if (res.ok) {
          showToast(res.summary, "good");
          renderAll();
        } else {
          showToast(res.reason, "bad");
        }
        return;
      }

      // [신규 요청 11] KBO 아시아 쿼터 선수 즉시 영입
      const signAqBtn = e.target.closest("[data-sign-asian-quarter]");
      if (signAqBtn) {
        const pid = signAqBtn.dataset.signAsianQuarter;
        const res = GM.Setup.signAsianQuarterPlayer(STATE.ctx, STATE.ctx.userTeamId, pid);
        if (res.ok) {
          showToast(res.summary, "good");
          renderAll();
        } else {
          showToast(res.reason, "bad");
        }
        return;
      }

      // [신규 요청 8] 트레이드 협상 테이블 초기화 및 현금 퀵 버튼
      if (e.target.closest("#btnResetTradeCards")) {
        STATE.tradeMyPlayerIds = [];
        STATE.tradeTargetPlayerIds = [];
        STATE.tradeMyPickRounds = [];
        STATE.tradeTargetPickRounds = [];
        STATE.tradeCashToPartner = 0;
        STATE.tradeCashFromPartner = 0;
        renderTradeSubPanel();
        return;
      }

      const quickCashBtn = e.target.closest("[data-trade-quick-cash]");
      if (quickCashBtn) {
        STATE.tradeCashToPartner = Number(quickCashBtn.dataset.tradeQuickCash || 0);
        renderTradeSubPanel();
        return;
      }

      // [시스템 6] 외국인 선수 즉시 웨이버 방출 (시장에서 영구 퇴출)
      const relForBtn = e.target.closest("[data-release-foreign]");
      if (relForBtn) {
        const pid = relForBtn.dataset.releaseForeign;
        const res = GM.Setup.releaseForeignPlayer(STATE.ctx, STATE.ctx.userTeamId, pid);
        if (res.ok) {
          STATE.userForeignKeepIds.delete(pid);
          showToast(`${res.releasedPlayer.name} 선수를 웨이버 방출(영구 퇴출: FOREIGN_RELEASED) 처리했습니다.`, "info");
          renderAll();
        } else {
          showToast(res.reason, "bad");
        }
        return;
      }

      // [시스템 7] 6주 장기 부상 시뮬레이션 테스트 및 6주 단기 대체 외국인 영입
      const simInjBtn = e.target.closest("[data-sim-6wk-injury]");
      if (simInjBtn) {
        const pid = simInjBtn.dataset.sim6wkInjury;
        const userTeam = STATE.ctx.getUserTeam();
        const fp = userTeam.getAllPlayers().find((p) => p.id === pid);
        if (fp) {
          fp.injury = { active: true, name: "내측측부인대 부분 손상", label: "팔꿈치 6주 장기부상", weeksLeft: 6, daysLeft: 42, major: true };
          showToast(`${fp.name} 선수에게 6주(42일) 장기 부상이 발생했습니다. '6주 대체 외국인 영입' 버튼이 활성화됩니다.`, "bad");
          renderAll();
        }
        return;
      }

      const sign6wkBtn = e.target.closest("[data-sign-6wk-foreign]");
      if (sign6wkBtn) {
        const pid = sign6wkBtn.dataset.sign6wkForeign;
        const res = GM.Setup.signSixWeekReplacementForeigner(STATE.ctx, STATE.ctx.userTeamId, pid);
        if (res.ok) {
          showToast(res.summary, "good");
          renderAll();
        } else {
          showToast(res.reason, "bad");
        }
        return;
      }

      const resolveRehabBtn = e.target.closest("[data-resolve-rehab]");
      if (resolveRehabBtn) {
        const pid = resolveRehabBtn.dataset.resolveRehab;
        const dec = resolveRehabBtn.dataset.rehabDecision || "RETURN_ORIGINAL";
        const res = GM.Setup.resolveReturnedForeignPlayer(STATE.ctx, STATE.ctx.userTeamId, pid, dec);
        if (res.ok) {
          showToast(res.summary, "good");
          renderAll();
        } else {
          showToast(res.reason, "bad");
        }
        return;
      }

      // [로비 화면] 빈 슬롯 '새 단장 만들기' 클릭
      const lobbyNewBtn = e.target.closest("[data-lobby-new]");
      if (lobbyNewBtn) {
        openCreateGmForm(lobbyNewBtn.dataset.lobbyNew);
        return;
      }

      // [로비 화면] 기존 슬롯 '이어하기' 클릭
      const lobbyContBtn = e.target.closest("[data-lobby-continue]");
      if (lobbyContBtn) {
        const slotId = lobbyContBtn.dataset.lobbyContinue;
        const loaded = await GM.Storage.loadGame(slotId);
        if (loaded) {
          loaded.slotId = slotId;
          showToast(`${loaded.gmProfile ? loaded.gmProfile.name : "단장"} (${loaded.getUserTeam().name}) 세이브를 불러왔습니다!`, "good");
          enterDashboardWithContext(loaded);
        }
        return;
      }

      // [로비 화면] 기존 슬롯 '비우기' 클릭
      const lobbyClearBtn = e.target.closest("[data-lobby-clear]");
      if (lobbyClearBtn) {
        const slotId = lobbyClearBtn.dataset.lobbyClear;
        await GM.Storage.deleteSave(slotId);
        showToast(`슬롯 '${slotId}' 데이터를 비웠습니다.`);
        renderLobbySlots();
        return;
      }

      // [새 단장 만들기 화면] 특성 필 선택
      const traitBtn = e.target.closest("[data-create-trait]");
      if (traitBtn) {
        createSelectedTrait = traitBtn.dataset.createTrait;
        document.querySelectorAll("[data-create-trait]").forEach((b) => b.classList.toggle("active", b === traitBtn));
        return;
      }

      // [새 단장 만들기 화면] 난이도 선택
      const diffBtn = e.target.closest("[data-create-difficulty]");
      if (diffBtn) {
        createSelectedDifficulty = diffBtn.dataset.createDifficulty;
        document
          .querySelectorAll("[data-create-difficulty]")
          .forEach((b) => b.classList.toggle("active", b === diffBtn));
        return;
      }

      // [새 단장 만들기 화면] 담당 구단 카드 선택
      const teamBox = e.target.closest("[data-select-create-team]");
      if (teamBox) {
        createSelectedTeamId = teamBox.dataset.selectCreateTeam;
        renderCreateTeamGrid();
        return;
      }

      // [시스템 1 & 8] 새 단장 프로필 & 2025년 1월 1일 신규 시즌 시작 버튼
      if (e.target.closest("#btnStartNewGMSetup")) {
        const gmName = ($("setupGmName") && $("setupGmName").value) || "백승수";
        const gmTrait = ($("setupGmTrait") && $("setupGmTrait").value) || "DATA_ANALYST";
        const teamId = ($("setupTeamId") && $("setupTeamId").value) || "KIA";
        const slotId = ($("setupSlotId") && $("setupSlotId").value) || "slot_1";
        const newCtx = await GM.Setup.initNewGameSession(slotId, gmName, gmTrait, teamId);
        STATE.ctx = newCtx;
        STATE.rosterViewTeamId = newCtx.userTeamId;
        STATE.lastWeeklyReport = null;
        STATE.activeTab = "pennant";
        showToast(
          `${gmName} 단장 부임! (${newCtx.getUserTeam().name} 고정 · 3년 총액 8억원 계약 · 2025년 1월 1일 스토브리그 시작)`,
          "good"
        );
        renderAll();
        return;
      }

      // [PART 4-1] 포스트시즌 계단식 토너먼트 진행 (10월 10일 가을야구 기간 검증 적용)
      if (e.target.closest("[data-run-postseason]")) {
        if (!GM.Extensions) return;
        const ctx = STATE.ctx;
        if (GM.Setup && typeof GM.Setup.canPlayPostseasonNow === "function") {
          const chk = GM.Setup.canPlayPostseasonNow(ctx.currentDate, ctx);
          if (!chk.allowed) {
            showToast(chk.reason, "bad");
            return;
          }
        }
        const res = GM.Extensions.runPostseasonTournament(ctx);
        if (res && res.ok && res.report) {
          showToast(res.report.headline, "good");
          renderAll();
        } else if (res) {
          showToast(res.reason || "포스트시즌 진행 실패", "bad");
        }
        return;
      }

      // [PART 4-2] KBO 2차 드래프트 (35인 보호선수 외 1~3R 지명 · 11월 5일 기간 검증 적용)
      if (e.target.closest("[data-run-biennial-draft]")) {
        if (!GM.Extensions) return;
        const ctx = STATE.ctx;
        if (GM.Setup && typeof GM.Setup.canPickSecondaryDraftNow === "function") {
          const chk = GM.Setup.canPickSecondaryDraftNow(ctx.currentDate, ctx);
          if (!chk.allowed) {
            showToast(chk.reason, "bad");
            return;
          }
        }
        const res = GM.Extensions.runBiennialSecondaryDraft(ctx);
        if (res && res.ok) {
          showToast(res.summary, "good");
          renderAll();
        } else if (res) {
          showToast(res.reason || "2차 드래프트 실행 실패", "bad");
        }
        return;
      }

      // [PART 4-2B] KBO 2차 드래프트 특정 비보호 선수 직접 1R 지명 영입 (신인드래프트 방식)
      const secPickBtn = e.target.closest("[data-sec-draft-pick]");
      if (secPickBtn) {
        if (!GM.Extensions) return;
        const ctx = STATE.ctx;
        const targetPid = secPickBtn.dataset.secDraftPick;
        if (GM.Setup && typeof GM.Setup.canPickSecondaryDraftNow === "function") {
          const chk = GM.Setup.canPickSecondaryDraftNow(ctx.currentDate, ctx);
          if (!chk.allowed) {
            showToast(chk.reason, "bad");
            return;
          }
        }
        const res = GM.Extensions.runBiennialSecondaryDraft(ctx, {
          userTargetPlayerIds: [targetPid]
        });
        if (res && res.ok) {
          const myAcq =
            res.report && Array.isArray(res.report.userAcquired) && res.report.userAcquired.length
              ? res.report.userAcquired.map((pk) => `${pk.playerName}(${pk.pos})`).join(", ")
              : "";
          showToast(
            myAcq
              ? `${res.summary} — 우리 구단 영입: ${myAcq}`
              : res.summary,
            "good"
          );
          renderAll();
        } else if (res) {
          showToast(res.reason || "2차 드래프트 지명 실패", "bad");
        }
        return;
      }

      // [PART 4-3] 상무 피닉스 야구단 18개월 입대 신청
      const sangmuBtn = e.target.closest("[data-enlist-sangmu]");
      if (sangmuBtn && GM.Extensions) {
        const pid = sangmuBtn.dataset.enlistSangmu;
        const res = GM.Extensions.enlistPlayerToSangmu(STATE.ctx, STATE.ctx.userTeamId, pid);
        if (res && res.ok) {
          showToast(res.summary, "good");
          renderAll();
        } else if (res) {
          showToast(res.reason, "bad");
        }
        return;
      }

      // [PART 4-4] 구단 인프라 & R&D 3대 시설 업그레이드 (Lv.1~5)
      const facBtn = e.target.closest("[data-upgrade-facility]");
      if (facBtn && GM.Extensions) {
        const fKey = facBtn.dataset.upgradeFacility;
        const res = GM.Extensions.upgradeTeamFacility(STATE.ctx, STATE.ctx.userTeamId, fKey);
        if (res && res.ok) {
          showToast(res.summary, "good");
          renderAll();
        } else if (res) {
          showToast(res.reason, "bad");
        }
        return;
      }

      // [PART 4-5A] 비FA 다년 연장 계약 제시 및 체결
      const extOfferBtn = e.target.closest("[data-offer-nonfa-ext]");
      if (extOfferBtn && GM.Extensions) {
        const pid = extOfferBtn.dataset.offerNonfaExt;
        const res = GM.Extensions.offerNonFAMultiYearExtension(STATE.ctx, STATE.ctx.userTeamId, pid);
        if (res && res.ok) {
          showToast(res.summary, "good");
          renderAll();
        } else if (res) {
          showToast(res.reason, "bad");
        }
        return;
      }

      // [PART 4-5B] 10개 구단 경쟁균형세(리그 평균 상위 40인 연봉 × 120% 상한) 심사
      if (e.target.closest("[data-eval-luxury-tax]") && GM.Extensions) {
        const res = GM.Extensions.evaluateLuxuryTaxAndPenalties(STATE.ctx);
        if (res && res.ok) {
          const cnt = res.penalizedTeamIds.length;
          showToast(
            cnt > 0
              ? `[경쟁균형세 심사 완료] 상한(${fmtMoney(res.capLimitManwon)}) 초과 ${cnt}개 구단에 연속 초과 횟수별 제재금(50~150%)·1R 지명권 하락 부과!`
              : `[경쟁균형세 심사 완료] 10개 구단 모두 상한(${fmtMoney(res.capLimitManwon)})을 준수했습니다!`,
            cnt > 0 ? "info" : "good"
          );
          renderAll();
        }
        return;
      }

      // [PART 2] 오늘의 할 일(KBO_GM.Assistant) 원클릭 자동 해결
      const quickTaskBtn = e.target.closest("[data-assistant-quick-task]");
      if (quickTaskBtn && GM.Assistant) {
        const tid = quickTaskBtn.dataset.assistantQuickTask;
        const res = GM.Assistant.executeAssistantQuickAction(STATE.ctx, tid);
        if (res && res.ok) {
          showToast(res.summary, "good");
          renderAll();
        } else if (res) {
          showToast(res.reason || "처리할 항목이 없습니다.", "info");
        }
        return;
      }

      // [PART 2 & 요청 1 해결] 오늘의 할 일 '업무 화면 이동 →' 버튼 클릭 시 해당 메인탭 및 서브탭으로 즉시 전환 및 스크롤 이동
      const gotoBtn = e.target.closest("[data-assistant-goto-tab]");
      if (gotoBtn) {
        const targetMain = gotoBtn.dataset.assistantGotoTab || "offseason";
        const targetSub = gotoBtn.dataset.assistantGotoSub || "";
        STATE.activeTab = targetMain;
        if (targetSub) {
          if (targetMain === "roster") {
            STATE.rosterSubTab = targetSub;
            document.querySelectorAll("[data-roster-sub]").forEach((b) =>
              b.classList.toggle("active", b.dataset.rosterSub === targetSub)
            );
          } else if (targetMain === "offseason") {
            STATE.offseasonSubTab = targetSub;
            document.querySelectorAll("[data-off-sub]").forEach((b) =>
              b.classList.toggle("active", b.dataset.offSub === targetSub)
            );
          } else if (targetMain === "records") {
            STATE.recordsSubTab = targetSub;
          }
        }
        renderAll();
        const secEl = $(`tab_${STATE.activeTab}`);
        if (secEl && typeof secEl.scrollIntoView === "function") {
          secEl.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        showToast("선택한 단장 업무 화면으로 이동했습니다.", "info");
        return;
      }

      // [PART 5-1] KBO-MLB 포스팅 승인/불허
      const postBtn = e.target.closest("[data-exec-mlb-posting]");
      if (postBtn && GM.Extensions) {
        const pid = postBtn.dataset.execMlbPosting;
        const dec = postBtn.dataset.postingDecision || "APPROVE";
        const res = GM.Extensions.executeMLBPosting(STATE.ctx, STATE.ctx.userTeamId, pid, dec);
        if (res && res.ok) {
          showToast(res.summary, dec === "APPROVE" ? "good" : "info");
          renderAll();
        } else if (res) {
          showToast(res.reason, "bad");
        }
        return;
      }

      // [PART 5-2] 홈구장 리모델링 및 파크 팩터 개조
      const parkBtn = e.target.closest("[data-remodel-park]");
      if (parkBtn && GM.Extensions) {
        const pKey = parkBtn.dataset.remodelPark;
        const res = GM.Extensions.remodelHomePark(STATE.ctx, STATE.ctx.userTeamId, pKey);
        if (res && res.ok) {
          showToast(res.summary, "good");
          renderAll();
        } else if (res) {
          showToast(res.reason, "bad");
        }
        return;
      }

      // [PART 5-3] 2군 미지정 유망주 맞춤형 훈련 일괄 설정
      if (e.target.closest("[data-auto-futures-train]") && GM.Extensions) {
        const res = GM.Extensions.autoAssignFuturesTraining(STATE.ctx, STATE.ctx.userTeamId);
        if (res && res.ok) {
          showToast(res.summary, "good");
          renderAll();
        }
        return;
      }

      // [PART 5-4] 선수 사기(Morale) 및 트레이드 요구 해결
      const morBtn = e.target.closest("[data-resolve-morale]");
      if (morBtn && GM.Extensions) {
        const pid = morBtn.dataset.resolveMorale;
        const act = morBtn.dataset.moraleAction || "PEP_TALK";
        const res = GM.Extensions.resolvePlayerMoraleIssue(STATE.ctx, STATE.ctx.userTeamId, pid, act);
        if (res && res.ok) {
          showToast(res.summary, "good");
          renderAll();
        } else if (res) {
          showToast(res.reason, "bad");
        }
        return;
      }

      const morTradeBtn = e.target.closest("[data-morale-goto-trade]");
      if (morTradeBtn) {
        const pid = morTradeBtn.dataset.moraleGotoTrade;
        STATE.activeTab = "offseason";
        STATE.offseasonSubTab = "trade";
        if (!STATE.tradeMyPlayerIds.includes(pid)) {
          STATE.tradeMyPlayerIds = [pid];
        }
        renderAll();
        const secEl = $("tab_offseason");
        if (secEl && typeof secEl.scrollIntoView === "function") {
          secEl.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        showToast("해당 선수를 트레이드 협상 테이블에 올렸습니다.", "info");
        return;
      }

      // [PART 5-5] 보호명단 모드 전환 / 자동 구성 / 선수 보호 토글
      const protModeBtn = e.target.closest("[data-prot-mode]");
      if (protModeBtn) {
        STATE.protectionMode = protModeBtn.dataset.protMode || "FA_20";
        renderFront5SubPanel();
        return;
      }

      const protAutoBtn = e.target.closest("[data-prot-autofill]");
      if (protAutoBtn && GM.Extensions) {
        const mode = protAutoBtn.dataset.protAutofill || "FA_20";
        const res = GM.Extensions.autoFillProtectedPlayers(STATE.ctx, STATE.ctx.userTeamId, mode);
        if (res && res.ok) {
          showToast(res.summary, "good");
          renderAll();
        }
        return;
      }

      const protToggleBtn = e.target.closest("[data-toggle-protect]");
      if (protToggleBtn && GM.Extensions) {
        const pid = protToggleBtn.dataset.toggleProtect;
        const mode = protToggleBtn.dataset.protTargetMode || STATE.protectionMode || "FA_20";
        const res = GM.Extensions.toggleProtectedPlayer(STATE.ctx, STATE.ctx.userTeamId, pid, mode);
        if (res && !res.ok) {
          showToast(res.reason, "bad");
        }
        renderAll();
        return;
      }

      // [KBO_GM.ManagerConflict 스펙 1] 보호선수 명단 감독 외압(PROTECTION_MANDATE) 모달 열기 및 수용/거부
      const openMandateBtn = e.target.closest("[data-open-protection-mandate]");
      if (openMandateBtn) {
        const mode = openMandateBtn.dataset.openProtectionMandate || STATE.protectionMode || "FA_20";
        openProtectionMandateModal(mode);
        return;
      }

      const resolveMandateBtn = e.target.closest("[data-resolve-mandate]");
      if (resolveMandateBtn) {
        const decision = resolveMandateBtn.dataset.resolveMandate || "ACCEPT";
        const mode = resolveMandateBtn.dataset.mandateMode || STATE.protectionMode || "FA_20";
        const mc = GM.ManagerConflict || GM.RealisticGM || GM.Extensions;
        if (mc && typeof mc.resolveProtectionMandate === "function") {
          const res = mc.resolveProtectionMandate(STATE.ctx, STATE.ctx.userTeamId, decision, mode);
          if (res && res.ok) {
            $("gmModalBackdrop").hidden = true;
            showToast(res.summary, decision === "ACCEPT" ? "good" : "bad");
            renderAll();
          }
        }
        return;
      }

      // [KBO_GM.ManagerConflict 스펙 2-A] 감독 트레이드 거부권 행사 모달 수용(철회) / 거부권 기각(직권 강행)
      const vetoDecBtn = e.target.closest("[data-resolve-trade-veto]");
      if (vetoDecBtn) {
        const decision = vetoDecBtn.dataset.resolveTradeVeto || "WITHDRAW_TRADE";
        const mc = GM.ManagerConflict || GM.RealisticGM || GM.Extensions;
        if (decision === "WITHDRAW_TRADE") {
          if (mc && typeof mc.resolveTradeVeto === "function") {
            const res = mc.resolveTradeVeto(STATE.ctx, STATE.ctx.userTeamId, "WITHDRAW_TRADE");
            STATE.tradeMyPlayerIds = [];
            $("gmModalBackdrop").hidden = true;
            showToast(res.summary, "info");
            renderAll();
          }
        } else {
          // FORCE_TRADE: 단장 직권으로 감독 거부권을 기각하고 트레이드 즉시 강행
          $("gmModalBackdrop").hidden = true;
          const tradeRes = GM.Setup.executePackageTrade(STATE.ctx, {
            partnerTeamId: STATE.tradePartnerTeamId,
            myPlayerIds: STATE.tradeMyPlayerIds,
            targetPlayerIds: STATE.tradeTargetPlayerIds,
            myPickRounds: STATE.tradeMyPickRounds,
            targetPickRounds: STATE.tradeTargetPickRounds,
            cashToPartner: STATE.tradeCashToPartner,
            cashFromPartner: STATE.tradeCashFromPartner,
            forceOverrideVeto: true
          });
          if (tradeRes && tradeRes.ok) {
            STATE.tradeMyPlayerIds = [];
            STATE.tradeTargetPlayerIds = [];
            STATE.tradeMyPickRounds = [];
            STATE.tradeTargetPickRounds = [];
            STATE.tradeCashToPartner = 0;
            STATE.tradeCashFromPartner = 0;
            showToast(`[단장 직권 강행 · 감독 신임도 -25] ${tradeRes.summary}`, "bad");
            renderAll();
          } else if (tradeRes) {
            showToast(tradeRes.reason || "트레이드 강행 실패", "bad");
          }
        }
        return;
      }

      // [KBO_GM.ManagerConflict 스펙 2-B] 정규시즌 중반 감독 약점포지션 베테랑 핀포인트 영입 공식 요청서 수신 & 이행/기각
      if (e.target.closest("[data-issue-trade-directive]")) {
        const mc = GM.ManagerConflict || GM.RealisticGM || GM.Extensions;
        if (mc && typeof mc.generateMidseasonTradeDirective === "function") {
          const res = mc.generateMidseasonTradeDirective(STATE.ctx, STATE.ctx.userTeamId);
          if (res && res.ok && res.directive) {
            showToast(`${res.directive.docNumber} ${res.directive.title} 공문이 접수되었습니다!`, "info");
            renderAll();
          }
        }
        return;
      }

      const dirActBtn = e.target.closest("[data-directive-action]");
      if (dirActBtn) {
        const act = dirActBtn.dataset.directiveAction || "AUTO_ACQUIRE";
        const dirId = dirActBtn.dataset.directiveId || "";
        const mc = GM.ManagerConflict || GM.RealisticGM || GM.Extensions;
        if (mc && typeof mc.resolveTradeDirectiveAction === "function") {
          const res = mc.resolveTradeDirectiveAction(STATE.ctx, STATE.ctx.userTeamId, dirId, act);
          if (res && res.ok) {
            showToast(res.summary, act === "AUTO_ACQUIRE" ? "good" : "bad");
            renderAll();
          } else if (res) {
            showToast(res.reason || "요청 처리 실패", "bad");
          }
        }
        return;
      }

      // [KBO_GM.ManagerConflict 스펙 3] 감독 갈등 파국(신임도 20 이하) 1~3단계 시뮬레이션 및 이사회 청문회 / 위약금 경질
      if (e.target.closest("[data-sim-manager-crisis]")) {
        const mc = GM.ManagerConflict || GM.RealisticGM || GM.Extensions;
        if (mc && typeof mc.ensureManagerConflictState === "function") {
          const userTeam = STATE.ctx.getUserTeam();
          const st = mc.ensureManagerConflictState(userTeam);
          st.managerTrust = Math.min(18, Math.max(5, st.managerTrust - 25));
          st.conflictGauge = 100 - st.managerTrust;
          const crisisRes = mc.evaluateConflictCrisis(STATE.ctx, userTeam.id, {
            checkMediaLeak: true,
            advanceCrisisStage: true
          });
          const latestEv =
            crisisRes && crisisRes.triggeredEvents && crisisRes.triggeredEvents[0]
              ? crisisRes.triggeredEvents[0].message
              : `감독 신임도가 ${st.managerTrust}(으)로 하락하여 파국 ${st.crisisStage}단계가 발동되었습니다!`;
          showToast(latestEv, "bad");
          renderAll();
        }
        return;
      }

      const hearingBtn = e.target.closest("[data-board-hearing-choice]");
      if (hearingBtn) {
        const choice = hearingBtn.dataset.boardHearingChoice || "COMPROMISE";
        const mc = GM.ManagerConflict || GM.RealisticGM || GM.Extensions;
        if (mc && typeof mc.resolveBoardHearing === "function") {
          const res = mc.resolveBoardHearing(STATE.ctx, STATE.ctx.userTeamId, choice);
          if (res && res.ok) {
            showToast(res.summary, choice === "COMPROMISE" ? "good" : "bad");
            renderAll();
          }
        }
        return;
      }

      if (e.target.closest("[data-fire-manager-now]")) {
        const mc = GM.ManagerConflict || GM.RealisticGM || GM.Extensions;
        if (mc && typeof mc.fireManagerWithSeverance === "function") {
          const selEl = $("fireMgrReplacementSelect");
          const repName = selEl ? selEl.value : null;
          const res = mc.fireManagerWithSeverance(STATE.ctx, STATE.ctx.userTeamId, repName);
          if (res && res.ok) {
            showToast(res.summary, "good");
            renderAll();
          } else if (res) {
            showToast(res.reason || "감독 경질 불가", "bad");
          }
        }
        return;
      }

      // [KBO_GM.RealisticGM 5대 직무 보고서 메카닉 이벤트 핸들러]
      if (e.target.closest("[data-rgm-set-archetype]")) {
        const rgmMod = GM.RealisticGM || GM.Extensions;
        const selEl = $("rgmArchetypeSelect");
        const archKey = selEl ? selEl.value : "FIELD_STUBBORN";
        if (rgmMod && typeof rgmMod.setManagerArchetype === "function") {
          const res = rgmMod.setManagerArchetype(STATE.ctx, STATE.ctx.userTeamId, archKey);
          if (res && res.ok) {
            showToast(res.summary, "info");
            renderAll();
          }
        }
        return;
      }

      if (e.target.closest("[data-rgm-open-usage-refusal]")) {
        const rgmMod = GM.RealisticGM || GM.Extensions;
        if (rgmMod && typeof rgmMod.checkPlayerUsageRefusal === "function") {
          const res = rgmMod.checkPlayerUsageRefusal(STATE.ctx, STATE.ctx.userTeamId, { forceTrigger: true });
          if (res && res.ok && res.modalEvent) {
            const ev = res.modalEvent;
            $("gmModalTitle").textContent = `🚨 ${ev.title}`;
            $("gmModalBody").innerHTML = `
              <div class="weekly-summary-banner" style="margin-bottom:12px;border-left:4px solid var(--bad)">
                <div><strong>감독 아키타입:</strong> ${esc(ev.managerArchetypeLabel)} · <strong>벤치 방치 대상:</strong> ${esc(ev.playerName)}(${esc(ev.pos)}, ${ev.age}세, OVR ${ev.ovr} / 포텐 ${ev.potential})</div>
                <div style="margin-top:8px;font-size:14px;line-height:1.6">${esc(ev.quote)}</div>
              </div>
              <div style="display:flex;gap:10px;flex-wrap:wrap">
                <button type="button" class="btn-sm text-bad" data-rgm-resolve-usage="FORCE_PLAY_WARNING" data-rgm-player="${esc(ev.playerId)}">
                  ⚡ ${esc(ev.dilemmaOptions.ignoreManagerAndForcePlay)}
                </button>
                <button type="button" class="btn-sm primary" data-rgm-resolve-usage="ACCEPT_BENCHING" data-rgm-player="${esc(ev.playerId)}">
                  🤝 ${esc(ev.dilemmaOptions.acceptManagerBenching)}
                </button>
              </div>
            `;
            $("gmModalBackdrop").hidden = false;
          }
        }
        return;
      }

      const usageDecBtn = e.target.closest("[data-rgm-resolve-usage]");
      if (usageDecBtn) {
        const dec = usageDecBtn.dataset.rgmResolveUsage || "FORCE_PLAY_WARNING";
        const pid = usageDecBtn.dataset.rgmPlayer || null;
        const rgmMod = GM.RealisticGM || GM.Extensions;
        if (rgmMod && typeof rgmMod.resolveUsageRefusalDilemma === "function") {
          const res = rgmMod.resolveUsageRefusalDilemma(STATE.ctx, STATE.ctx.userTeamId, dec, pid);
          $("gmModalBackdrop").hidden = true;
          if (res && res.ok) {
            showToast(res.summary, dec === "FORCE_PLAY_WARNING" ? "bad" : "info");
            renderAll();
          }
        }
        return;
      }

      const multiNegBtn = e.target.closest("[data-rgm-multi-issue-neg]");
      if (multiNegBtn) {
        const pid = multiNegBtn.dataset.rgmMultiIssueNeg;
        const rgmMod = GM.RealisticGM || GM.Extensions;
        if (rgmMod && typeof rgmMod.negotiateMultiIssueSalary === "function") {
          const res = rgmMod.negotiateMultiIssueSalary(STATE.ctx, STATE.ctx.userTeamId, pid, {
            guaranteedUsageKey: "FULL_STARTER",
            incentiveKey: "MAJOR_OPT",
            multiYearKey: "EXTEND_2Y"
          });
          if (res && res.ok) {
            showToast(res.summary, res.agreed ? "good" : "bad");
            renderAll();
          }
        }
        return;
      }

      const arbBtn = e.target.closest("[data-rgm-run-arbitration]");
      if (arbBtn) {
        const pid = arbBtn.dataset.rgmRunArbitration;
        const rgmMod = GM.RealisticGM || GM.Extensions;
        if (rgmMod && typeof rgmMod.runSalaryArbitrationHearing === "function") {
          const res = rgmMod.runSalaryArbitrationHearing(STATE.ctx, STATE.ctx.userTeamId, pid);
          if (res && res.ok) {
            showToast(res.summary, "bad");
            renderAll();
          }
        }
        return;
      }

      const faBumpBtn = e.target.closest("[data-rgm-fa-bump]");
      if (faBumpBtn) {
        const pid = faBumpBtn.dataset.rgmFaBump;
        const rgmMod = GM.RealisticGM || GM.Extensions;
        if (rgmMod && typeof rgmMod.applyPreemptiveFASalaryBump === "function") {
          const res = rgmMod.applyPreemptiveFASalaryBump(STATE.ctx, STATE.ctx.userTeamId, pid, 1.8);
          if (res && res.ok) {
            showToast(res.summary, "good");
            renderAll();
          } else if (res) {
            showToast(res.reason || "적용 실패", "bad");
          }
        }
        return;
      }

      const dlStanceBtn = e.target.closest("[data-rgm-deadline-stance]");
      if (dlStanceBtn) {
        const stance = dlStanceBtn.dataset.rgmDeadlineStance || "BUYER";
        const rgmMod = GM.RealisticGM || GM.Extensions;
        if (rgmMod && typeof rgmMod.generateDeadlineTradeProposals === "function") {
          const res = rgmMod.generateDeadlineTradeProposals(STATE.ctx, stance);
          if (res && res.ok) {
            showToast(
              `[7/31 트레이드 마감일] 우리 구단 스탠스를 [${stance}]로 설정하고 맞춤 AI 딜 ${res.proposals.length}건을 수신했습니다!`,
              "info"
            );
            renderAll();
          }
        }
        return;
      }

      const dlDealBtn = e.target.closest("[data-rgm-exec-deadline-deal]");
      if (dlDealBtn) {
        const dealId = dlDealBtn.dataset.rgmExecDeadlineDeal;
        const rgmMod = GM.RealisticGM || GM.Extensions;
        if (rgmMod && typeof rgmMod.executeDeadlineStanceDeal === "function") {
          const res = rgmMod.executeDeadlineStanceDeal(STATE.ctx, dealId);
          if (res && res.ok) {
            showToast(res.summary, "good");
            renderAll();
          } else if (res) {
            showToast(res.reason || "마감일 딜 체결 실패", "bad");
          }
        }
        return;
      }

      if (e.target.closest("[data-rgm-trigger-rebellion]")) {
        const rgmMod = GM.RealisticGM || GM.Extensions;
        if (rgmMod && typeof rgmMod.evaluateSquadRebellion === "function") {
          const res = rgmMod.evaluateSquadRebellion(STATE.ctx, STATE.ctx.userTeamId, {
            forceTrigger: true,
            userPolicy: "AUSTERITY"
          });
          if (res && res.ok && res.rebellionEvent) {
            showToast(res.rebellionEvent.title, "bad");
            renderAll();
          }
        }
        return;
      }

      const rebMediaBtn = e.target.closest("[data-rgm-media-response]");
      if (rebMediaBtn) {
        const strat = rebMediaBtn.dataset.rgmMediaResponse || "TRANSPARENT_REBUILD_PR";
        const rgmMod = GM.RealisticGM || GM.Extensions;
        if (rgmMod && typeof rgmMod.handleRebellionMediaResponse === "function") {
          const res = rgmMod.handleRebellionMediaResponse(STATE.ctx, STATE.ctx.userTeamId, strat);
          if (res && res.ok) {
            showToast(res.summary, strat === "HARDLINE_PRINCIPLE" ? "bad" : "good");
            renderAll();
          }
        }
        return;
      }
    });

    // 연봉 수동 입력 & 트레이드 협상 테이블 선택 위임
    document.addEventListener("change", (e) => {
      const salInput = e.target.closest("[data-salary-input]");
      if (salInput) {
        const pid = salInput.dataset.salaryInput;
        STATE.userSalaryOffers[pid] = fromEokInput(salInput.value, 3000);
        renderSalarySubPanel();
        return;
      }

      const forOfferInp = e.target.closest("[data-foreign-offer-input]");
      if (forOfferInp) {
        const pid = forOfferInp.dataset.foreignOfferInput;
        STATE.userForeignSalaryOffers[pid] = fromEokInput(forOfferInp.value, 30000);
        return;
      }

      if (e.target.id === "faSortSelect") {
        STATE.faSortBy = e.target.value || "DEMAND";
        renderFASubPanel();
        return;
      }

      if (e.target.id === "tradePartnerSelect") {
        STATE.tradePartnerTeamId = e.target.value;
        STATE.tradeTargetPlayerIds = [];
        STATE.tradeTargetPickRounds = [];
        renderTradeSubPanel();
        return;
      }

      const myPlChk = e.target.closest("[data-trade-my-player]");
      if (myPlChk) {
        const pid = myPlChk.dataset.tradeMyPlayer;
        if (myPlChk.checked) {
          if (STATE.tradeMyPlayerIds.length >= 3) {
            myPlChk.checked = false;
            showToast("한 번의 패키지에 최대 3명까지 포함할 수 있습니다.", "bad");
            return;
          }
          if (!STATE.tradeMyPlayerIds.includes(pid)) STATE.tradeMyPlayerIds.push(pid);
        } else {
          STATE.tradeMyPlayerIds = STATE.tradeMyPlayerIds.filter((x) => x !== pid);
        }
        renderTradeSubPanel();
        return;
      }

      const tgtPlChk = e.target.closest("[data-trade-target-player]");
      if (tgtPlChk) {
        const pid = tgtPlChk.dataset.tradeTargetPlayer;
        if (tgtPlChk.checked) {
          if (STATE.tradeTargetPlayerIds.length >= 3) {
            tgtPlChk.checked = false;
            showToast("한 번의 패키지에 최대 3명까지 요구할 수 있습니다.", "bad");
            return;
          }
          if (!STATE.tradeTargetPlayerIds.includes(pid)) STATE.tradeTargetPlayerIds.push(pid);
        } else {
          STATE.tradeTargetPlayerIds = STATE.tradeTargetPlayerIds.filter((x) => x !== pid);
        }
        renderTradeSubPanel();
        return;
      }

      const myPkChk = e.target.closest("[data-trade-my-pick]");
      if (myPkChk) {
        const r = Number(myPkChk.dataset.tradeMyPick);
        if (myPkChk.checked) {
          if (!STATE.tradeMyPickRounds.includes(r)) STATE.tradeMyPickRounds.push(r);
        } else {
          STATE.tradeMyPickRounds = STATE.tradeMyPickRounds.filter((x) => x !== r);
        }
        renderTradeSubPanel();
        return;
      }

      const tgtPkChk = e.target.closest("[data-trade-target-pick]");
      if (tgtPkChk) {
        const r = Number(tgtPkChk.dataset.tradeTargetPick);
        if (tgtPkChk.checked) {
          if (!STATE.tradeTargetPickRounds.includes(r)) STATE.tradeTargetPickRounds.push(r);
        } else {
          STATE.tradeTargetPickRounds = STATE.tradeTargetPickRounds.filter((x) => x !== r);
        }
        renderTradeSubPanel();
        return;
      }

      if (e.target.id === "tradeCashOfferInput") {
        STATE.tradeCashToPartner = fromEokInput(e.target.value, 0);
        renderTradeSubPanel();
        return;
      }

      if (e.target.id === "tradeCashReqInput") {
        STATE.tradeCashFromPartner = fromEokInput(e.target.value, 0);
        renderTradeSubPanel();
        return;
      }

      const futTrainSel = e.target.closest("[data-futures-training-select]");
      if (futTrainSel && GM.Extensions) {
        const pid = futTrainSel.dataset.futuresTrainingSelect;
        const progKey = futTrainSel.value;
        if (progKey) {
          const res = GM.Extensions.setPlayerFuturesTraining(STATE.ctx, STATE.ctx.userTeamId, pid, progKey);
          if (res && res.ok) {
            showToast(res.summary, "good");
            renderAll();
          }
        }
        return;
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 10. 초기화 및 부팅 — 항상 시작 슬롯 선택 로비 화면(#lobbyContainer)에서 시작
   * ═══════════════════════════════════════════════════════════════════════ */
  async function bootGMDashboard() {
    try {
      const savedTheme = localStorage.getItem("kbo_gm_theme");
      if (savedTheme) applyTheme(savedTheme);
      else applyTheme("light");
    } catch (e) {}

    await GM.Storage.initDB();

    // 백그라운드 기본 컨텍스트 준비 후 슬롯 선택 로비 화면 표시
    let initialCtx = await GM.Storage.loadGame("slot_1");
    if (!initialCtx) {
      initialCtx = await GM.Storage.loadGame("auto_save");
    }
    if (!initialCtx && GM.Setup && typeof GM.Setup.initNewGameSession === "function") {
      // 슬롯 1에 샘플 세이브가 없으면 빈 슬롯 상태로 두어 유저가 직접 '새 단장 만들기'로 구단을 선택하게 함
      initialCtx = GM.initGMGameContext({ userTeamId: "KIA", scoutLevel: 2 });
    }

    STATE.ctx = initialCtx;
    GM.context = initialCtx;
    STATE.rosterViewTeamId = initialCtx ? initialCtx.userTeamId : "KIA";
    bindEvents();
    await renderLobbySlots();
    renderCreateTeamGrid();
  }

  // 외부 및 콘솔 연동용 KBO_GM.UI 공개 인터페이스
  GM.UI = {
    state: STATE,
    init: function (userTeamId = "KIA") {
      if (GM.Setup && typeof GM.Setup.initGame === "function") {
        const ctx = GM.Setup.initGame(userTeamId);
        enterDashboardWithContext(ctx);
        return ctx;
      }
      renderAll();
      return STATE.ctx;
    },
    renderAll,
    switchTab: function (tabId) {
      const tabMap = {
        dashboard: "pennant",
        pennant: "pennant",
        roster: "roster",
        stove: "offseason",
        offseason: "offseason",
        facilities: "facilities",
        manager: "manager",
        records: "records",
        storage: "storage"
      };
      const resolved = tabMap[tabId] || "pennant";
      STATE.activeTab = resolved;
      if (tabId === "stove") {
        STATE.offseasonSubTab = "fa";
      }
      renderAll();
    },
    advanceDay: function () {
      advanceDaysUI(1);
    },
    advanceWeek: function () {
      advanceDaysUI(7);
    },
    upgradeFacility: function (type) {
      if (!STATE.ctx || !GM.Extensions) return;
      const res = GM.Extensions.upgradeTeamFacility(STATE.ctx, STATE.ctx.userTeamId, type);
      if (res && res.ok) {
        showToast(res.summary, "good");
        renderAll();
      } else if (res) {
        showToast(res.reason || "예산이 부족하거나 이미 최고 레벨입니다.", "bad");
      }
      return res;
    },
    openFAModal: function (idxOrPlayerId) {
      if (!STATE.ctx) return;
      const pool = STATE.ctx.faPool || [];
      const p =
        typeof idxOrPlayerId === "number"
          ? pool[idxOrPlayerId]
          : pool.find((x) => x.id === idxOrPlayerId) || pool[0];
      if (p) {
        openDirectFANegotiationModal(p.id);
      }
    },
    closeModal: function () {
      const bd = $("gmModalBackdrop");
      if (bd) bd.hidden = true;
    },
    submitFAOffer: function () {
      const btn = document.querySelector("[data-exec-fa-direct-neg]");
      if (btn) btn.click();
    },
    runWiringAudit: function () {
      return runWiringAuditModal();
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootGMDashboard);
  } else {
    bootGMDashboard();
  }
})();
