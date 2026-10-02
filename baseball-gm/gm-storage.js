/**
 * KBO 단장 모드 (v1.0) — Step 2-3: IndexedDB 대용량 비동기 저장소 모듈 (KBO_GM.Storage)
 * 의존 모듈:
 *   - Step 1-1: /public/gm-schema.js (Player, Team, GMGameContext 클래스)
 * 실행 환경: Client-Side Browser (IndexedDB 기본 + LocalStorage/Memory 자동 Fallback)
 */

(function (root, factory) {
  const storageModule = factory(root.KBO_GM || (typeof globalThis !== "undefined" && globalThis.KBO_GM));
  if (typeof globalThis !== "undefined") {
    globalThis.KBO_GM = Object.assign(globalThis.KBO_GM || {}, { Storage: storageModule });
  }
  if (typeof window !== "undefined") {
    window.KBO_GM = Object.assign(window.KBO_GM || {}, { Storage: storageModule });
  }
  if (typeof module === "object" && module.exports) {
    module.exports = storageModule;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function (KBO_GM) {
  "use strict";

  const DB_NAME = "KBO_GM_DB";
  const DB_VERSION = 1;
  const STORE_SAVES = "game_saves";
  const STORE_LOGS = "career_logs";

  // LocalStorage Fallback 키 프리픽스
  const LS_SAVE_PREFIX = "KBO_GM_DB_SAVE_";
  const LS_LOG_KEY = "KBO_GM_DB_CAREER_LOGS";

  // 브라우저 외 환경(Node 테스트 등) 또는 용량 초과 시 최후 메모리 Fallback
  const memorySaves = new Map();
  let memoryLogs = [];
  let memoryLogAutoId = 1;

  let dbInstance = null;
  let useFallbackMode = false;

  /**
   * 현재 KBO_GM 네임스페이스 참조 헬퍼
   */
  function getGMNamespace() {
    return (
      KBO_GM ||
      (typeof globalThis !== "undefined" && globalThis.KBO_GM) ||
      (typeof window !== "undefined" && window.KBO_GM) ||
      null
    );
  }

  /**
   * 1. 데이터 직렬화(Serialization) 및 인스턴스 복원(Hydration) 헬퍼
   */
  function toPlainSerializable(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * 순수 JSON 선수 객체를 KBO_GM.Player 인스턴스로 완벽 복원
   */
  function hydratePlayer(rawPlayer) {
    if (!rawPlayer) return null;
    const gm = getGMNamespace();
    const PlayerClass = gm && gm.Player;
    if (!PlayerClass) {
      throw new Error("KBO_GM.Player 클래스를 찾을 수 없습니다. gm-schema.js가 먼저 로드되어야 합니다.");
    }
    if (rawPlayer instanceof PlayerClass) return rawPlayer;

    const instance = new PlayerClass(rawPlayer);
    // 생성자 외에 동적으로 추가된 커스텀 속성(metrics, draftScore, draftProjection 등)까지 무손실 보존
    Object.keys(rawPlayer).forEach((key) => {
      if (instance[key] === undefined) {
        instance[key] = rawPlayer[key];
      }
    });
    return instance;
  }

  /**
   * 순수 JSON 구단 객체를 KBO_GM.Team 인스턴스(내부 선수들은 Player 인스턴스)로 완벽 복원
   */
  function hydrateTeam(rawTeam) {
    if (!rawTeam) return null;
    const gm = getGMNamespace();
    const TeamClass = gm && gm.Team;
    if (!TeamClass) {
      throw new Error("KBO_GM.Team 클래스를 찾을 수 없습니다. gm-schema.js가 먼저 로드되어야 합니다.");
    }
    if (rawTeam instanceof TeamClass) return rawTeam;

    const instance = new TeamClass({
      ...rawTeam,
      roster1G: Array.isArray(rawTeam.roster1G) ? rawTeam.roster1G.map(hydratePlayer) : [],
      roster2G: Array.isArray(rawTeam.roster2G) ? rawTeam.roster2G.map(hydratePlayer) : [],
      rosterDev: Array.isArray(rawTeam.rosterDev) ? rawTeam.rosterDev.map(hydratePlayer) : [],
      foreignRehabList: Array.isArray(rawTeam.foreignRehabList) ? rawTeam.foreignRehabList.map(hydratePlayer) : [],
      militaryList: Array.isArray(rawTeam.militaryList) ? rawTeam.militaryList.map(hydratePlayer) : []
    });

    Object.keys(rawTeam).forEach((key) => {
      if (
        key !== "roster1G" &&
        key !== "roster2G" &&
        key !== "rosterDev" &&
        key !== "foreignRehabList" &&
        key !== "militaryList" &&
        instance[key] === undefined
      ) {
        instance[key] = rawTeam[key];
      }
    });
    return instance;
  }

  /**
   * 순수 JSON 컨텍스트 객체를 KBO_GM.GMGameContext 인스턴스로 완벽 복원
   */
  function hydrateContext(rawContext) {
    if (!rawContext) return null;
    const gm = getGMNamespace();
    const ContextClass = gm && gm.GMGameContext;
    if (!ContextClass) {
      throw new Error("KBO_GM.GMGameContext 클래스를 찾을 수 없습니다. gm-schema.js가 먼저 로드되어야 합니다.");
    }
    if (rawContext instanceof ContextClass) return rawContext;

    const instance = new ContextClass({
      ...rawContext,
      kboTeams: Array.isArray(rawContext.kboTeams) ? rawContext.kboTeams.map(hydrateTeam) : [],
      npbPool: Array.isArray(rawContext.npbPool) ? rawContext.npbPool.map(hydratePlayer) : [],
      draftPool: Array.isArray(rawContext.draftPool) ? rawContext.draftPool.map(hydratePlayer) : [],
      faPool: Array.isArray(rawContext.faPool) ? rawContext.faPool.map(hydratePlayer) : []
    });

    // Phase 2 등에서 추가된 standings, weeklyLogs 및 기타 확장 프로퍼티 보존
    Object.keys(rawContext).forEach((key) => {
      if (
        key !== "kboTeams" &&
        key !== "npbPool" &&
        key !== "draftPool" &&
        key !== "faPool" &&
        instance[key] === undefined
      ) {
        instance[key] = rawContext[key];
      }
    });
    // 자유계약(방출) 선수 시장도 Player 인스턴스로 복원
    if (Array.isArray(rawContext.releasedPool)) instance.releasedPool = rawContext.releasedPool.map(hydratePlayer);

    return instance;
  }

  /**
   * 저장 슬롯 요약 메타데이터 생성
   */
  function buildSlotSummary(slotId, context, customMeta = {}) {
    const userTeam =
      typeof context.getUserTeam === "function"
        ? context.getUserTeam()
        : (context.kboTeams || []).find((t) => t.id === context.userTeamId) || (context.kboTeams || [])[0] || {};

    const now = new Date();
    const rec = userTeam.record || { w: 0, l: 0, d: 0 };
    const decisions = (rec.w || 0) + (rec.l || 0);
    const winPct = decisions > 0 ? +(rec.w / decisions).toFixed(3) : 0.0;
    const gmProfile = context.gmProfile || {
      name: customMeta.gmName || "김단장",
      trait: customMeta.gmTrait || "DATA_ANALYST",
      traitLabel: customMeta.gmTraitLabel || "데이터 분석가"
    };

    return {
      slotId: String(slotId),
      label: customMeta.label || (slotId === "auto_save" ? "자동 저장" : `슬롯 ${slotId}`),
      gmName: gmProfile.name || "김단장",
      gmTrait: gmProfile.trait || "DATA_ANALYST",
      gmTraitLabel: gmProfile.traitLabel || "데이터 분석가",
      difficultyLabel: ({ EASY: "쉬움", NORMAL: "보통", HARD: "어려움" })[context.difficulty] || "보통",
      userTeamId: context.userTeamId || userTeam.id || "KIA",
      userTeamName: userTeam.name || "KBO 구단",
      startYear: context.startYear || 2025,
      currentYear: context.currentYear || 2025,
      currentWeek: context.currentWeek || 1,
      scoutLevel: context.scoutLevel || 1,
      record: { w: rec.w || 0, l: rec.l || 0, d: rec.d || 0 },
      winPct,
      budget: userTeam.budget ?? 0,
      ownerTrust: userTeam.ownerTrust ?? 60,
      fanRatio: userTeam.fanRatio ?? 55,
      savedAt: now.toISOString(),
      savedAtTimestamp: now.getTime()
    };
  }

  /**
   * 2. LocalStorage / Memory Fallback 헬퍼
   */
  function fallbackSaveSlot(slotId, payload) {
    const key = LS_SAVE_PREFIX + slotId;
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(key, JSON.stringify(payload));
        return { ok: true, backend: "localStorage", summary: payload.summary };
      } catch (e) {
        // QuotaExceededError 등 발생 시 메모리 스토어로 우회
      }
    }
    memorySaves.set(String(slotId), payload);
    return { ok: true, backend: "memoryFallback", summary: payload.summary };
  }

  function fallbackLoadSlot(slotId) {
    const key = LS_SAVE_PREFIX + slotId;
    if (typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem(key);
        if (raw) return JSON.parse(raw);
      } catch (e) {
        // ignore parse error and check memory
      }
    }
    return memorySaves.get(String(slotId)) || null;
  }

  function fallbackGetSaveList() {
    const listMap = new Map();

    if (typeof localStorage !== "undefined") {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(LS_SAVE_PREFIX)) {
            const parsed = JSON.parse(localStorage.getItem(k));
            if (parsed && parsed.summary) {
              listMap.set(parsed.slotId, parsed.summary);
            }
          }
        }
      } catch (e) {
        // ignore
      }
    }

    memorySaves.forEach((val, k) => {
      if (val && val.summary) {
        listMap.set(k, val.summary);
      }
    });

    return Array.from(listMap.values()).sort((a, b) => (b.savedAtTimestamp || 0) - (a.savedAtTimestamp || 0));
  }

  function fallbackDeleteSlot(slotId) {
    const key = LS_SAVE_PREFIX + slotId;
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        // ignore
      }
    }
    memorySaves.delete(String(slotId));
    return { ok: true, slotId: String(slotId), backend: "fallback" };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 3. 핵심 비동기 API (initDB, saveGame, loadGame, getSaveList, deleteSave)
   * ═══════════════════════════════════════════════════════════════════════ */

  /**
   * IndexedDB 연결 및 ObjectStore(`game_saves`, `career_logs`) 초기화
   * @returns {Promise<IDBDatabase|null>}
   */
  async function initDB() {
    if (dbInstance) return dbInstance;
    if (useFallbackMode) return null;

    const idb =
      (typeof indexedDB !== "undefined" && indexedDB) ||
      (typeof window !== "undefined" && (window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB));

    if (!idb) {
      useFallbackMode = true;
      return null;
    }

    return new Promise((resolve) => {
      try {
        const request = idb.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;

          // 1) game_saves 스토어 (keyPath: 'slotId')
          if (!db.objectStoreNames.contains(STORE_SAVES)) {
            const saveStore = db.createObjectStore(STORE_SAVES, { keyPath: "slotId" });
            saveStore.createIndex("savedAtTimestamp", "savedAtTimestamp", { unique: false });
          }

          // 2) career_logs 스토어 (keyPath: 'id', autoIncrement: true)
          if (!db.objectStoreNames.contains(STORE_LOGS)) {
            const logStore = db.createObjectStore(STORE_LOGS, { keyPath: "id", autoIncrement: true });
            logStore.createIndex("slotId", "slotId", { unique: false });
            logStore.createIndex("year", "year", { unique: false });
          }
        };

        request.onsuccess = (event) => {
          dbInstance = event.target.result;
          dbInstance.onversionchange = () => {
            dbInstance.close();
            dbInstance = null;
          };
          resolve(dbInstance);
        };

        request.onerror = () => {
          useFallbackMode = true;
          resolve(null);
        };

        request.onblocked = () => {
          useFallbackMode = true;
          resolve(null);
        };
      } catch (err) {
        useFallbackMode = true;
        resolve(null);
      }
    });
  }

  /**
   * GMGameContext 인스턴스를 직렬화하여 지정된 슬롯에 비동기 저장
   * @param {string} slotId - 'slot_1', 'slot_2', 'auto_save' 등
   * @param {Object} context - GMGameContext 인스턴스
   * @param {Object} [meta] - 추가 슬롯 라벨 등 옵션
   */
  async function saveGame(slotId, context, meta = {}) {
    if (!slotId) throw new Error("저장할 slotId가 필요합니다.");
    if (!context) throw new Error("저장할 GMGameContext 인스턴스가 필요합니다.");

    const normalizedSlotId = String(slotId);
    const summary = buildSlotSummary(normalizedSlotId, context, meta);
    const serializedContext = toPlainSerializable(context);

    const payload = {
      slotId: normalizedSlotId,
      savedAtTimestamp: summary.savedAtTimestamp,
      summary,
      data: serializedContext
    };

    const db = await initDB();
    if (!db) {
      return fallbackSaveSlot(normalizedSlotId, payload);
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_SAVES], "readwrite");
        const store = tx.objectStore(STORE_SAVES);
        const req = store.put(payload);

        req.onsuccess = () => {
          resolve({ ok: true, backend: "indexedDB", slotId: normalizedSlotId, summary });
        };

        req.onerror = () => {
          resolve(fallbackSaveSlot(normalizedSlotId, payload));
        };
      } catch (err) {
        resolve(fallbackSaveSlot(normalizedSlotId, payload));
      }
    });
  }

  /**
   * 지정된 슬롯에서 데이터를 불러와 GMGameContext, Team, Player 클래스 인스턴스로 복원(Hydration)하여 반환
   * @param {string} slotId
   * @returns {Promise<GMGameContext|null>}
   */
  async function loadGame(slotId) {
    if (!slotId) throw new Error("불러올 slotId가 필요합니다.");
    const normalizedSlotId = String(slotId);

    const db = await initDB();
    if (!db) {
      const fbRecord = fallbackLoadSlot(normalizedSlotId);
      return fbRecord && fbRecord.data ? hydrateContext(fbRecord.data) : null;
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_SAVES], "readonly");
        const store = tx.objectStore(STORE_SAVES);
        const req = store.get(normalizedSlotId);

        req.onsuccess = (event) => {
          const record = event.target.result;
          if (record && record.data) {
            resolve(hydrateContext(record.data));
          } else {
            // 혹시 Fallback에 저장되어 있는지도 확인
            const fbRecord = fallbackLoadSlot(normalizedSlotId);
            resolve(fbRecord && fbRecord.data ? hydrateContext(fbRecord.data) : null);
          }
        };

        req.onerror = () => {
          const fbRecord = fallbackLoadSlot(normalizedSlotId);
          resolve(fbRecord && fbRecord.data ? hydrateContext(fbRecord.data) : null);
        };
      } catch (err) {
        const fbRecord = fallbackLoadSlot(normalizedSlotId);
        resolve(fbRecord && fbRecord.data ? hydrateContext(fbRecord.data) : null);
      }
    });
  }

  /**
   * 현재 저장된 모든 슬롯들의 요약 정보(슬롯ID, 구단명, 진행 연도, 주차, 저장 일시 등) 배열 반환
   * @returns {Promise<Array<Object>>}
   */
  async function getSaveList() {
    const db = await initDB();
    if (!db) {
      return fallbackGetSaveList();
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_SAVES], "readonly");
        const store = tx.objectStore(STORE_SAVES);
        const req = store.getAll();

        req.onsuccess = (event) => {
          const records = event.target.result || [];
          const summaries = records
            .map((r) => r.summary || { slotId: r.slotId, savedAtTimestamp: r.savedAtTimestamp || 0 })
            .sort((a, b) => (b.savedAtTimestamp || 0) - (a.savedAtTimestamp || 0));
          resolve(summaries);
        };

        req.onerror = () => {
          resolve(fallbackGetSaveList());
        };
      } catch (err) {
        resolve(fallbackGetSaveList());
      }
    });
  }

  /**
   * 특정 저장 슬롯 삭제
   * @param {string} slotId
   * @returns {Promise<{ok: boolean, slotId: string}>}
   */
  async function deleteSave(slotId) {
    if (!slotId) throw new Error("삭제할 slotId가 필요합니다.");
    const normalizedSlotId = String(slotId);

    // Fallback 스토어에서도 함께 제거
    fallbackDeleteSlot(normalizedSlotId);

    const db = await initDB();
    if (!db) {
      return { ok: true, slotId: normalizedSlotId, backend: "fallback" };
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_SAVES], "readwrite");
        const store = tx.objectStore(STORE_SAVES);
        const req = store.delete(normalizedSlotId);

        req.onsuccess = () => {
          resolve({ ok: true, slotId: normalizedSlotId, backend: "indexedDB" });
        };

        req.onerror = () => {
          resolve({ ok: true, slotId: normalizedSlotId, backend: "fallback" });
        };
      } catch (err) {
        resolve({ ok: true, slotId: normalizedSlotId, backend: "fallback" });
      }
    });
  }

  /**
   * 수십 년 치 시즌 결산/통산 기록을 `career_logs` 스토어(autoIncrement)에 누적 보관
   * @param {Object} logEntry - { slotId, year, championTeamId, standings, awards, userSummary, ... }
   */
  async function saveCareerLog(logEntry) {
    if (!logEntry || typeof logEntry !== "object") {
      throw new Error("유효한 logEntry 객체가 필요합니다.");
    }
    const payload = {
      ...toPlainSerializable(logEntry),
      createdAt: new Date().toISOString()
    };

    const db = await initDB();
    if (!db) {
      const assignedId = memoryLogAutoId++;
      const record = { id: assignedId, ...payload };
      memoryLogs.push(record);
      if (typeof localStorage !== "undefined") {
        try {
          const existing = JSON.parse(localStorage.getItem(LS_LOG_KEY) || "[]");
          existing.push(record);
          localStorage.setItem(LS_LOG_KEY, JSON.stringify(existing));
        } catch (e) {
          // ignore quota error
        }
      }
      return { ok: true, id: assignedId, backend: "fallback" };
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_LOGS], "readwrite");
        const store = tx.objectStore(STORE_LOGS);
        const req = store.add(payload);

        req.onsuccess = (event) => {
          resolve({ ok: true, id: event.target.result, backend: "indexedDB" });
        };

        req.onerror = () => {
          const assignedId = memoryLogAutoId++;
          memoryLogs.push({ id: assignedId, ...payload });
          resolve({ ok: true, id: assignedId, backend: "fallback" });
        };
      } catch (err) {
        const assignedId = memoryLogAutoId++;
        memoryLogs.push({ id: assignedId, ...payload });
        resolve({ ok: true, id: assignedId, backend: "fallback" });
      }
    });
  }

  /**
   * `career_logs` 스토어에서 통산 시즌 기록 조회 (slotId 필터 지원)
   * @param {string} [slotId]
   * @returns {Promise<Array<Object>>}
   */
  async function getCareerLogs(slotId = null) {
    const db = await initDB();
    if (!db) {
      let logs = memoryLogs.slice();
      if (typeof localStorage !== "undefined") {
        try {
          const raw = localStorage.getItem(LS_LOG_KEY);
          if (raw) logs = JSON.parse(raw);
        } catch (e) {
          // ignore
        }
      }
      return slotId ? logs.filter((x) => x.slotId === slotId) : logs;
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_LOGS], "readonly");
        const store = tx.objectStore(STORE_LOGS);
        const req = store.getAll();

        req.onsuccess = (event) => {
          const all = event.target.result || [];
          resolve(slotId ? all.filter((x) => x.slotId === slotId) : all);
        };

        req.onerror = () => {
          resolve(slotId ? memoryLogs.filter((x) => x.slotId === slotId) : memoryLogs.slice());
        };
      } catch (err) {
        resolve(slotId ? memoryLogs.filter((x) => x.slotId === slotId) : memoryLogs.slice());
      }
    });
  }

  return {
    DB_NAME,
    DB_VERSION,
    STORE_SAVES,
    STORE_LOGS,
    initDB,
    saveGame,
    loadGame,
    getSaveList,
    deleteSave,
    saveCareerLog,
    getCareerLogs,
    hydratePlayer,
    hydrateTeam,
    hydrateContext
  };
});
