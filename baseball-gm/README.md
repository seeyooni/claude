# 나만의 야구 단장 만들기 (KBO 단장 모드 v1.0)

브라우저에서 실행되는 KBO 구단 단장 시뮬레이션. 빌드 과정 없이 정적 파일만으로 동작한다.

## 실행

```bash
cd baseball-gm
python3 -m http.server 8000   # http://localhost:8000
```

`index.html`을 파일로 직접 열어도 실행된다. 단, "단일 index.html 다운로드" 버튼은 각 모듈을 `fetch`로 읽기 때문에 웹 서버로 띄웠을 때만 동작한다.

## 모듈 구성 (로드 순서)

| 파일 | 네임스페이스 | 역할 |
|---|---|---|
| `gm-schema.js` | `KBO_GM` | 데이터 스키마(선수·구단·게임 컨텍스트), v16.8 능력치·구종·노쇠화 공식 |
| `gm-match-sim.js` | `KBO_GM.simulateMatch` | 단일 경기 시뮬레이터 (투타 확률, 파크팩터, 날씨, 불펜 교체) |
| `gm-weekly-sim.js` | `KBO_GM.WeeklySim` | 주간 일괄 연산 & 멀티 리그 배치 |
| `gm-storage.js` | `KBO_GM.Storage` | IndexedDB / localStorage 세이브 슬롯 |
| `gm-draft.js` | `KBO_GM.Draft` | 고교·대학 신인 드래프트 |
| `gm-offseason.js` | `KBO_GM.Offseason` | FA 시장, 연봉 재계약, 외국인 선수 계약 |
| `gm-spring-camp.js` | `KBO_GM.SpringCamp` | 전지훈련, 코치진 인선, 구단주 목표, 새 시즌 개막 |
| `gm-extensions.js` | `KBO_GM.Extensions` | 포스트시즌 등 프런트 확장 시스템 |
| `gm-setup.js` | `KBO_GM.Setup` / `KBO_GM.Rules` | 단장 프로필·계약, 통합 세팅 규칙 |
| `gm-ui.js` | `KBO_GM.UI` | 대시보드 UI 컨트롤러 |

원본은 위 10개 모듈을 하나로 합친 단일 `index.html`이었으며, 여기서는 협업·수정이 쉽도록 원래의 모듈 단위로 다시 분리했다. 게임 코드는 원본과 동일하다.
