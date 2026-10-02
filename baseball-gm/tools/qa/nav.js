// 새 6개 영역 메뉴용 테스트 내비게이션 헬퍼
const OLD = { pennant:'office:home', roster:'squad:roster', facilities:'ops:facilities', manager:'ops:manager', records:'records:records',
  draft:'scouting:draft', salary:'contracts:salary', fa:'contracts:fa', foreign:'scouting:foreign', camp:'ops:camp', trade:'contracts:trade', front5:'contracts:nonfa' };
async function go(p, key){
  key = OLD[key] || key;
  const [a, s] = key.split(':');
  await p.click(`[data-area="${a}"]`);
  if (s && await p.$(`[data-area-sub="${a}:${s}"]`)) await p.click(`[data-area-sub="${a}:${s}"]`);
  await p.waitForTimeout(60);
}
async function allKeys(p){
  const out=[]; const areas=await p.$$eval('[data-area]',els=>els.map(e=>e.dataset.area));
  for(const a of areas){ await p.click(`[data-area="${a}"]`); await p.waitForTimeout(40);
    const subs=await p.$$eval('[data-area-sub]',els=>els.map(e=>e.dataset.areaSub)); if(subs.length) out.push(...subs); else out.push(a+':'); }
  return out;
}
const SECTION = 'main > section[id^="tab_"]:not([hidden])';
module.exports={go,allKeys,SECTION};
