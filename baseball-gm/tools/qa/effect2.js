// 2차 점검: 행 '더보기' 메뉴 · 팝업(모달) 안 버튼 · 입력/선택 · 상단 메뉴 · 저장/불러오기 · 로비
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const {go,allKeys}=require('./nav.js');
const DATES=(process.argv[2]||'2025-01-03,2025-05-20,2025-09-23,2025-11-06,2025-12-03').split(',');
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1400,height:900}});
  const errs=[]; let cur=''; p.on('pageerror',x=>errs.push(cur+' :: '+x.message+' @ '+String(x.stack||'').split('\n').slice(1,4).join(' | '))); p.on('dialog',d=>d.accept());
  await p.goto('file://'+require('path').resolve(__dirname,'../../dist/kbo-gm.html')+'?notutorial=1'); await p.waitForTimeout(900);
  await p.click('[data-lobby-new="slot_1"]'); await p.click('#btnConfirmCreateGM'); await p.waitForTimeout(1500);
  await p.evaluate(()=>{window.__fx=0; const mo=new MutationObserver(()=>window.__fx++); mo.observe(document.getElementById('gmToast'),{childList:true,subtree:true,characterData:true}); mo.observe(document.getElementById('gmModalBackdrop'),{attributes:true,childList:true,subtree:true});});
  const snap=()=>p.evaluate(()=>{const c=window.KBO_GM.context; const u=c.getUserTeam(); const h=s=>{let x=0;for(let i=0;i<s.length;i++)x=(x*31+s.charCodeAt(i))|0;return x};
    return [window.__fx,h(document.querySelector('main').innerHTML),h(document.getElementById('gmModalBody').innerHTML),u.budget,u.roster1G.length,u.roster2G.length,u.rosterDev.length,(u.militaryList||[]).length,c.currentDate].join('|');});
  const res={ok:[],dead:[]};
  const mark=(label,ok)=>res[ok?'ok':'dead'].push(label);
  const closeAll=()=>p.evaluate(()=>{document.getElementById('gmModalBackdrop').hidden=true;document.querySelectorAll('details[open]').forEach(x=>x.open=false);});
  const keys=await allKeys(p);
  for(const date of DATES){
    let g=0; while(await p.evaluate(()=>window.KBO_GM.context.currentDate) < date && g++<80){ await p.click('#btnNextWeek'); await p.waitForTimeout(60); await closeAll(); }
    const d=await p.evaluate(()=>window.KBO_GM.context.currentDate);
    // (a) roster '더보기' 메뉴 항목 — 그룹별 첫 2명
    await go(p,'squad:roster');
    for(const sub of ['1GUN','2GUN','YUKSEONG']){
      await p.click(`[data-roster-sub="${sub}"]`);
      for(let r=0;r<2;r++){
        const menus=await p.$$('details.row-menu'); if(!menus[r]) break;
        const items=await menus[r].$$eval('.row-menu-pop button',bs=>bs.map((b,i)=>i+'|'+b.textContent.trim()));
        for(const it of items){ const [idx,txt]=it.split('|'); const m=(await p.$$('details.row-menu'))[r]; if(!m)break;
          await m.$eval('summary',s=>s.click()); const btn=(await m.$$('.row-menu-pop button'))[+idx]; if(!btn) continue;
          cur=`${d} roster ${sub} menu ${txt}`; const bf=await snap(); await btn.click(); await p.waitForTimeout(80); mark(cur, bf!==await snap()); await closeAll(); }
      }
    }
    // (b) 팝업 안 버튼: 화면별로 팝업을 여는 버튼 종류마다 1개씩
    for(const k of keys){
      await go(p,k);
      const openers=await p.evaluate(()=>{const seen=new Set(),out=[];document.querySelectorAll('main > section[id^="tab_"]:not([hidden]) button').forEach((b,i)=>{if(b.disabled||!b.offsetParent)return;const sig=[...b.attributes].map(a=>a.name).filter(n=>n.startsWith('data-')).sort().join(',');if(!sig||/player-modal|match-idx/.test(sig)||seen.has(sig))return;seen.add(sig);out.push(i);});return out;});
      for(const i of openers){
        const sel=`main > section[id^="tab_"]:not([hidden]) button >> nth=${i}`;
        const el=p.locator('main > section[id^="tab_"]:not([hidden]) button').nth(i); if(!(await el.isVisible().catch(()=>false))) continue;
        const name=(await el.textContent()).trim().replace(/\s+/g,' ').slice(0,26);
        await el.click().catch(()=>{}); await p.waitForTimeout(80);
        if(await p.isHidden('#gmModalBackdrop')){ await closeAll(); await go(p,k); continue; }
        const mBtns=await p.$$eval('#gmModalBody button',bs=>bs.map((b,i)=>b.disabled?null:i+'|'+b.textContent.trim().replace(/\s+/g,' ').slice(0,26)).filter(Boolean));
        for(const mb of mBtns.slice(0,12)){
          const [mi,mt]=mb.split('|');
          if(await p.isHidden('#gmModalBackdrop')){ await go(p,k); const e2=p.locator('main > section[id^="tab_"]:not([hidden]) button').nth(i); if(!(await e2.isVisible().catch(()=>false))) break; await e2.click().catch(()=>{}); await p.waitForTimeout(80); if(await p.isHidden('#gmModalBackdrop')) break; }
          const tb=(await p.$$('#gmModalBody button'))[+mi]; if(!tb||await tb.isDisabled()) continue;
          cur=`${d} ${k} popup[${name}] → ${mt}`; const bf=await snap(); await tb.click().catch(()=>{}); await p.waitForTimeout(80); mark(cur,bf!==await snap());
        }
        await closeAll(); await go(p,k);
      }
    }
    // (c) 입력·선택 상자: change 이벤트에 반응하는지
    for(const k of keys){
      await go(p,k);
      const sels=await p.$$eval('main > section[id^="tab_"]:not([hidden]) select',ss=>ss.map((s,i)=>s.offsetParent&&s.options.length>1?i+'|'+(s.id||s.name||[...s.attributes].map(a=>a.name).join(',')):null).filter(Boolean));
      for(const sv of sels){ const [si,sn]=sv.split('|'); const s=p.locator('main > section[id^="tab_"]:not([hidden]) select').nth(+si);
        const vals=await s.evaluate(e=>[...e.options].map(o=>o.value)); const curv=await s.inputValue(); const nv=vals.find(v=>v!==curv); if(nv==null) continue;
        cur=`${d} ${k} select ${sn}`; const bf=await snap(); await s.selectOption(nv).catch(()=>{}); await p.waitForTimeout(80); mark(cur+' (선택만 바꿈 — 저장 버튼 필요할 수 있음)',bf!==await snap()); }
    }
  }
  // (d) 상단: 진행·알림·저장·설정 메뉴
  const hdr=[['#btnNextDay','+1일'],['#btnNextWeek','+1주'],['#btnNext4Weeks','+4주'],['#btnNotifInbox','알림함'],['#btnQuickAutoSave','저장'],['#hdrNextDeadline','다음 마감'],['#btnOpenBudgetRequestModal','재정']];
  for(const [s,l] of hdr){ await closeAll(); const bf=await snap(); await p.click(s).catch(()=>{}); await p.waitForTimeout(250); mark('header '+l,bf!==await snap()); }
  await closeAll();
  for(const id of ['btnThemeToggle','btnOpenGuideInGame','btnHeaderWiringAudit']){ await p.click('#btnSystemMenu'); const th=await p.evaluate(()=>document.documentElement.dataset.theme); const bf=await snap(); await p.click('#'+id); await p.waitForTimeout(400); const changed=bf!==await snap()||th!==await p.evaluate(()=>document.documentElement.dataset.theme); mark('menu '+id,changed); await closeAll(); }
  await p.click('#btnSystemMenu'); await p.click('#systemMenu [data-main-tab="storage"]'); await p.waitForTimeout(500);
  const slotBtns=await p.$$eval('#storageSlotList button',bs=>bs.map((b,i)=>b.disabled?null:i+'|'+[...b.attributes].map(a=>a.name+'='+a.value).join(' ')).filter(Boolean));
  for(const sb of slotBtns){ const [i,t]=sb.split('|'); if(/data-del-slot/.test(t)) continue; const bf=await snap(); await p.locator('#storageSlotList button').nth(+i).click().catch(()=>{}); await p.waitForTimeout(500); mark('storage '+t.slice(0,50),bf!==await snap()); if(await p.isVisible('#lobbyContainer')) break; await closeAll(); }
  // (e) 로비: 슬롯 화면으로 → 이어하기
  await closeAll(); await p.click('#btnSystemMenu'); await p.click('#btnBackToLobby'); await p.waitForTimeout(600);
  const lobby=await p.isVisible('#lobbyContainer'); mark('menu btnBackToLobby → 로비',lobby);
  if(lobby){ const c=await p.$('[data-lobby-continue]'); if(c){ await c.click(); await p.waitForTimeout(1500); mark('lobby 이어하기 → 게임 복귀', await p.isVisible('#dashboardAppWrap')); } }
  console.log('OK',res.ok.length,'DEAD',res.dead.length); [...new Set(res.dead)].forEach(x=>console.log(' DEAD',x));
  console.log('ERRS',errs.length); errs.slice(0,20).forEach(e=>console.log(' ',e.slice(0,220)));
  await b.close();})();
