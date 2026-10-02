// 모든 버튼을 실제 마우스 클릭으로 눌러 '아무 변화도 없는' 버튼을 찾는다
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const {go,allKeys}=require('./nav.js');
const DATES=(process.argv[2]||'2025-01-03,2025-05-20,2025-09-23,2025-11-06,2025-12-03').split(',');
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1400,height:900}});
  const errs=[]; let cur=''; p.on('pageerror',x=>errs.push(cur+' :: '+x.message+' @ '+String(x.stack||'').split('\n').slice(1,4).join(' | '))); p.on('dialog',d=>d.accept());
  await p.goto('file://'+require('path').resolve(__dirname,'../../dist/kbo-gm.html')+'?notutorial=1'); await p.waitForTimeout(900);
  await p.click('[data-lobby-new="slot_1"]'); await p.click('#btnConfirmCreateGM'); await p.waitForTimeout(1500);
  await p.evaluate(()=>{window.__fx=0; const mo=new MutationObserver(()=>window.__fx++); mo.observe(document.getElementById('gmToast'),{childList:true,subtree:true,characterData:true}); mo.observe(document.getElementById('gmModalBackdrop'),{attributes:true,childList:true,subtree:true});});
  const keys=await allKeys(p);
  const SKIP=/btnBackToLobby|btnNext|btnHeader|data-area|data-area-sub|gmModalClose|btnThemeToggle|btnSystemMenu|btnNotifInbox|data-inbox-filter|toast-close|btnQuickAutoSave|data-goto-tab|hdrNextDeadline|data-del-slot|data-load-slot|btnExport/;
  const dead={}, worked={};
  const snap=()=>p.evaluate(()=>{const c=window.KBO_GM.context; const u=c&&c.getUserTeam&&c.getUserTeam();
    const sec=document.querySelector('main > section[id^="tab_"]:not([hidden])');
    const h=s=>{let x=0;for(let i=0;i<s.length;i++)x=(x*31+s.charCodeAt(i))|0;return x};
    return [window.__fx, document.getElementById('gmToast').innerText, !document.getElementById('gmModalBackdrop').hidden, h(sec?sec.innerHTML:''), h(document.querySelector('.status-bar').innerText),
      u?[u.budget,u.roster1G.length,u.roster2G.length,u.rosterDev.length,(u.militaryList||[]).length,JSON.stringify(c._stoveDone||{}),(c.faPool||[]).length,c.currentDate].join('|'):''].join('§');});
  for(const date of DATES){
    let g=0; while(await p.evaluate(()=>window.KBO_GM.context.currentDate) < date && g++<80){ await p.click('#btnNextWeek'); await p.waitForTimeout(80); await p.evaluate(()=>document.getElementById('gmModalBackdrop').hidden=true); }
    const d=await p.evaluate(()=>window.KBO_GM.context.currentDate);
    for(const k of keys){
      await go(p,k);
      const n=await p.$$eval('main > section[id^="tab_"]:not([hidden]) button, main > section[id^="tab_"]:not([hidden]) summary',bs=>bs.length);
      for(let i=0;i<Math.min(n,90);i++){
        const info=await p.evaluate(i=>{const el=document.querySelectorAll('main > section[id^="tab_"]:not([hidden]) button, main > section[id^="tab_"]:not([hidden]) summary')[i]; document.querySelectorAll('[data-fx]').forEach(x=>x.removeAttribute('data-fx')); if(!el||el.disabled||!el.offsetParent)return null; el.setAttribute('data-fx',i); const at=[...el.attributes].filter(a=>a.name!=='class'&&a.name!=='style'&&a.name!=='data-fx'&&a.name!=='title'&&a.name!=='type').map(a=>a.name+'='+a.value.slice(0,20)).join(' '); return at+' «'+el.textContent.trim().replace(/\s+/g,' ').slice(0,28)+'»';},i);
        if(!info||SKIP.test(info)) continue;
        // 행 메뉴 안 버튼은 메뉴를 열어야 보인다 → summary 는 따로 확인
        cur=`${d} ${k} ${info}`;
        const before=await snap();
        try{ await p.click(`[data-fx="${i}"]`,{timeout:1500}); }catch(e){ (dead[k+' '+info.replace(/plr_\w+/g,'<id>')+' [CLICK-FAIL '+e.message.split('\n')[0].slice(0,60)+']']??={dates:[]}).dates.push(d); continue; }
        await p.waitForTimeout(60);
        const after=await snap();
        const key=k+' '+info.replace(/plr_\w+/g,'<id>').replace(/\d+(\.\d+)?억/g,'N억');
        if(before===after){ (dead[key]??={dates:[]}).dates.push(d); } else worked[key]=1;
        await p.evaluate(()=>{document.getElementById('gmModalBackdrop').hidden=true; document.querySelectorAll('details[open]').forEach(x=>x.open=false);});
        if(await p.isVisible('#lobbyContainer')){errs.push('LEFT '+cur); return;}
        await go(p,k);
      }
    }
  }
  const realDead=Object.entries(dead).filter(([k])=>!worked[k]);
  console.log('WORKED',Object.keys(worked).length,'DEAD',realDead.length);
  realDead.forEach(([k,v])=>console.log(' DEAD',k,'@',[...new Set(v.dates)].join(',')));
  console.log('ERRS',errs.length); errs.slice(0,20).forEach(e=>console.log(' ',e.slice(0,200)));
  await b.close();})();
