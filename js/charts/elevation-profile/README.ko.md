# 표고 프로필 — 유지보수 가이드

[English](README.md) | [日本語](README.ja.md) | 한국어

> **This file is machine-generated and may contain errors. If you find issues, please submit a PR.**
> 이 파일은 기계 생성되었으며 오류가 있을 수 있습니다. 문제를 발견하면 PR을 보내 주세요.

표고 / 텔레메트리 프로필 차트의 유지보수 방법: 각 모듈의 담당 범위, 새 코드의 위치,
아키텍처를 유지하는 규칙, 변경 사항 검증 방법.

## 이 디렉터리에 대하여

표고 프로필은 지도 아래의 Canvas 차트입니다: 표고 밴드, 메트릭 오버레이 곡선(심박, 속도 / 페이스 /
GAP, 케이던스, 온도, 파워), 심박 존 밴드, 구간 선택, 호버 십자선, 그리고 지도와 연동되는
일련의 상호작용. 원래는 약 1500줄짜리 단일 파일이었으나, 지금은 책임별 모듈 집합입니다.

**공개 API는 두 함수뿐**입니다:

```js
import { initProfile, setProfileTrack } from './charts/elevation-profile/index.js';
initProfile(document.getElementById('profile-body'));  // main.js, 부팅 시
setProfileTrack(track);                                // main.js, 트랙 로드 시
```

DOM 계약: `#profile-body` 안에 `#profile-canvas`, `#profile-tooltip`, `#handle-start`,
`#handle-end`. 바깥에 `#profile-readout`(터치 프로브의 고정 텔레메트리 밴드. `.profile-head`와
`#profile-body` 사이), `#btn-x-distance`, `#btn-x-time`,
`#btn-waypoint-snap`, `#btn-overlays`. 이 id들은 절대 이름을 바꾸지 않습니다.
`#profile-tooltip` 노드는 `#profile-body` 안(absolute)에 있어 워크스페이스 스크롤을 네이티브하게
따라갑니다. 터치 프로브의 읽기는 헤더와 차트 사이의 고정 밴드(`#profile-readout`)에 그려집니다. 밴드는
프로필 모듈 자체의 일부라 차트를 덮을 수 없고, 읽기가 나타나거나 사라져도 레이아웃이 움직이지
않습니다(showTooltipAt /
initProfile 참조).

## 모듈 맵

| 파일 | 담당 | 내보내기 |
|---|---|---|
| `index.js` | 오케스트레이션: DOM 조립, 외부 이벤트, 트랙 라이프사이클, 리스즈 처리 | `initProfile`, `setProfileTrack` |
| `profile-state.js` | 차트 인스턴스 하나의 공유 가변 상태(`state`) + `isWideLayout` | `state`, `isWideLayout` |
| `profile-data.js` | 순수 계산: 포인트별 캐시, 다운샘플링, 좌표 변환, 오버레이 정의와 토글 규칙. DOM 없음, 형제 모듈 비의존 | `OVERLAY_METRICS`, `SPEED_FAMILY`, `buildCaches`, `overlayAvailability`, `overlayValueAt`, `sampleOverlay`, `sampleElevation`, `seriesExtremes`, `distToX`, `xToDist`, `clientXtoX`, `speedToPace`, `formatOverlayValue`, `applyOverlayToggle` |
| `profile-render.js` | Canvas 그리기 전부: `sync()` 패스와 그 안의 모든 레이어, `scheduleSync`, 핸들 / 마스크 배치 | `initRender`, `scheduleSync`, `sync`, `resizeCanvas`, `positionHandles`, `refreshHandleLabels` |
| `profile-interaction.js` | 세 입력 경로(헤더 컨트롤, 캔버스 포인터 — 호버 / 드래그 선택 / 줌과 터치 프로브 제스처, 구간 핸들) + toast + 웨이포인트 스냅. 터치의 핀치/이동/두 번 탭 상태 머신은 여기 없습니다(이변수 차트도 함께 쓰는 공용 모듈 `js/charts/viewport-gestures.js`입니다). 그리지 않음 | `wireControls`, `wirePointer`, `wireHandles`, `setXMode`, `toggleOverlay`, `refreshControls`, `refreshSnapToggle`, `unpinWaypoint` |
| `profile-tooltip.js` | 호버 툴팁과 터치 프로브 읽기의 DOM과 내용 | `showTooltipAt`, `hideTooltip`, `resetProbeReadout` |

의존 그래프(화살표 = import. 현재 import 문 기준으로 대조 완료. 비순환 유지):

```text
index       → state, data, render, interaction, tooltip
interaction → state, data, render(scheduleSync만), tooltip, ../viewport-gestures(터치 핀치 / 이동 / 두 번 탭 초기화)
render      → state, data, tooltip(drawHover가 showTooltipAt 호출)
tooltip     → state, data
data        → 이 디렉터리 내 의존 없음(외부 geo / metrics / utils만)
state       → 의존 없음
```

`profile-data.js`는 의존 그래프의 최하층: 이 디렉터리의 어떤 파일도 import하지 않습니다——
그래서 단위 테스트가 가능합니다. **`profile-utils.js`는 존재하지 않습니다**: 현재 각 "작은
도우미"는 정확히 하나의 소비 모듈만 가지므로, 그 모듈 안에 살아 있습니다.

## 공유 상태

모듈 간 공유되는 모든 것은 `state` 객체(`profile-state.js`)에 있습니다. 단일 모듈만 사용하는
것은 그 모듈의 private `let`으로 남습니다——필드를 옮기기 전에 확인하세요.

`state.dom`(초기화 중 한 번 조립: `index.js`가 조회한 노드를 채우고, `initRender`가 마스크를
만들어 canvas/ctx를 바인딩, `wireControls`가 `snapBtn`을 채움): `root`, `canvas`, `ctx`,
`tooltip`, `readout`(프로브의 밴드. root 바깥), `handles.{start,end}`, `masks.{left,right}`,
`xButtons.{distance,time}`, `snapBtn`.

차트 데이터: `track`, `xs`(현재 축 모드의 포인트별 x), `speeds`, `gapSpeeds`,
`profileWaypoints`. `speeds`/`gapSpeeds` 캐시는 속도의 출처에 따라 정리됩니다 — 기록 속도는 각 측정값을 당시 dd/dt와 교차 검증하고(50% 초과 측정값은 제거),
5포인트 슬라이딩 윈도우로 평활화합니다(`cleanSpeedSeries`: 각 포인트는 자신과 앞뒤 2개 유효값의 평균).
계산 속도는 3σ 정리만 적용합니다(`cleanComputedSpeeds`: 초과값을 이웃 정상값의 보간으로 채움).
휴식 중 기록된 0도 데이터이며 평균에 참여합니다.
차트 뷰: `xMode`(`'distance' | 'time'`), `view`(`{start,end}`, `null` = 전체 트랙),
`plot`(CSS 픽셀 `{x0,y0,w,h}`).
오버레이: `selectedOverlays`(선택 순서), `hiddenOverlays`(임시 숨김 id의 Set).
호버: `hoverDist`, `hoverX`, `hoverOrigin`(`'profile' | 'map' | 'waypoint'`),
`waypointHover`, `pinnedWaypoint`.
터치 프로브: `probe`(활성화 시 `{dist}`, 아니면 `null`) — 모바일판 터치 인스펙터입니다. 트랙
거리에 앵커되고(x는 그리기 / 히트 테스트 때마다 `distToX`로 다시 유도), 팬·줌·축 모드 전환에도
데이터 점에서 벗어나지 않습니다. 활성화 중에는 호버 십자선이 물러나고 읽기는 프로브가 소유합니다
(`showTooltipAt`은 프로브가 아닌 호출을 무시, `hideTooltip`은 `force`를 넘겨야 실제로 숨깁니다).
기타: `waypointsShown`(지도 웨이포인트 토글의 미러).

모듈 전용(`state`로 **옮기지 말 것**): render는 `syncPending`, `hrHoverCurve`, `MARGIN`,
바인딩된 DOM 별칭을 소유. interaction는 `lastSpeedVariant`, `overlaysMenu`, `waypointSnap`,
`lastSnapDist`, toast 타이머, 팬 힌트 플래그와 터치 잡기 플래그(가상 핸들, 프로브 드래그,
tap 판정, 차트 밖 tap 기록)를 소유.

규약:

- 가변 스칼라는 항상 `state.X`로 읽고 씁니다——이 접두사가 리뷰에서 공유 상태를 보이게 하는
  방식입니다.
- 초기화 후 변하지 않는 객체 참조(ctx, canvas, handles…)는 소유 모듈의 init(`initRender`)에서
  한 번만 모듈 레벨 `let`으로 디스트럭처링합니다.
- 렌더러는 `state.plot`(`resizeCanvas` 경유)과 `hrHoverCurve`의 유일한 기록자입니다.

## 그리기 패스(`sync()`)

실제 호출 순서——새 레이어는 올바른 슬롯에 삽입하고, 순서를 함부로 바꾸지 않습니다:

1. x축 눈금(`xMode`에 따라 거리 또는 경과 시간)
2. 클립된 블록: **심박 존 밴드**, 다음은 오버레이 곡선(2패스: 1패스에서 보이는 모든 오버레이를
   샘플링해 스케일 결정, 2패스에서 선 그리기——따라서 밴드는 곡선 **아래**에 위치)
3. `placeMasks()`——구간 베일 DOM 요소를 여기서 배치(표고 브랜치 전)
4. 표고 브랜치: 표고가 없는 트랙은 평평한 점선 참조선. 그렇지 않으면 그리드 + y 레이블,
   오버레이 축 스트립, 표고 밴드(전체 트랙), 구간 하이라이트, 웨이포인트 핀, 구간 경계선
5. `positionHandles()`——핸들 DOM 요소를 여기서 배치(두 브랜치 모두)
6. 호버 십자선(+ 표고 곡선 위의 서페이스 색 채움 · 액센트 테두리 점, + 십자선과 그려진 심박
   곡선의 교점에 있는 채움 점). 터치 프로브가 활성화되어 있으면 프로브가 이를 대신합니다——같은 선과
   점을 프로브의 데이터 위치에 앵커해 그립니다. 읽기는 헤더와 차트 사이의 고정 텔레메트리 밴드
   `#profile-readout`——2행 × 4열 고정 슬롯 그리드(위치 / 표고 / 속도族 / 심박 + 케이던스 / 온도 /
   파워 / 빈 칸): 위치와 표고는 항상 표시됩니다. 센서 슬롯은 오버레이가 활성화되면 값을, 트랙에
   데이터가 있지만 오버레이가 꺼져 있으면 흐린 「선택되지 않음」을 표시하고, 트랙에 그 센서가
   없으면 빈 슬롯으로 남습니다. 활성화되었지만 읽기가 없는 슬롯은 대시를 표시합니다. 심박 슬롯은
   두 단(값 위, 존 아래)이며 모든 슬롯이 내용을 중앙 정렬하므로 단일 행 슬롯은 더 높은 행 안에서
   수직 중앙에 유지됩니다
   (거친 포인터 기기. 정밀 포인터 기기는 기존의 플로팅 박스를
   유지하며 너비는 화면의 절반까지, 오버레이가 많으면 읽기 단위 사이에서 줄을 바꾸며 하나의 읽기가
   분할되지 않음)

이 패스에 내장된 규칙:

- 오버레이는 **전체 트랙** 기준으로 스케일링(전역 y축). 줌은 x축만 늘입니다.
- 속도 패밀리의 축 스트립 상단은 속도 계열의 **포인트별 최댓값**(`seriesExtremes`)입니다. 따라서 상단 라벨은 항상 메트릭 목록의 최대 속도와 같은 값을 나타냅니다. 곡선 자체는 `sampleOverlay`의 열 평균으로 그려집니다. 나머지 오버레이는 패딩을 둔 샘플 상단을 유지합니다.
- 존 밴드와 호버 점의 bpm → y 변환은 **심박 오버레이 자신의 lo/hi 스케일**에 정확히 맞추고 그
  스케일로 클립합니다. 그 스케일이 존재할 때(심박 곡선이 보이고 데이터가 있을 때)만 그려집니다.
  존을 위해 축을 넓히지 않습니다. 두 번째 매핑을 만들지 않습니다. 밴드는 추가로 설정 드로어의
  표시 토글(`showZones`, `js/metrics/heartRateDisplay.js`)의 영향도 받습니다. 십자선의 심박
  교차점은 토글 대상이 아닙니다——교차점은 밴드가 아니라 십자선에 속합니다.
- 호버 중, 또는 터치 프로브가 활성화된 동안에는 현재 심박 값이 속한 밴드를 조금 더 진하게 칠합니다——
  기본 알파의 약 2배로, 그래도
  옅게(`BAND_ALPHA` / `ACTIVE_BAND_ALPHA`). 활성 존의 판정은 툴팁의 존 라벨과 동일한 읽기
  경로를 사용하므로 항상 일치합니다. 검사 대상이 없으면 강조하지 않습니다. 설정 드로어의 하이라이트
  토글이 꺼져 있어도 강조하지 않습니다(`js/metrics/heartRateDisplay.js`): 하이라이트는 표시
  토글이 켜져 있어야 하며, 밴드가 숨어 있는 동안에도 그 체크 상태는 유지됩니다.
- 그리기 순서는 깨뜨릴 수 없습니다: 존 밴드 → 오버레이 곡선 → 표고 밴드 → 구간 하이라이트 → 호버.
- 패스 1 샘플링은 캐시됩니다: 오버레이별 열 평균과 스피드 계열의 점별 최댓값은 트랙, x축 모드, 플롯 폭, 오버레이 선택이 바뀔 때만 다시 계산합니다. 호버·터치 프로브·핸들 조작 프레임은 저장된 샘플에서 그대로 다시 그립니다(`profile-render.js`의 `sampleVisibleOverlays`/`overlaySamples`).
- `sync()`는 차트 상태를 읽기만 하고 수정하지 않습니다. render가 소유한 유일한 쓰기는
  `hrHoverCurve`입니다. 출력은 `state`, `sectorStore`, 현재 테마 토큰(`getComputedStyle`)으로
  결정되며, 쓰기 대상은 canvas와 render 소유 DOM(마스크, 핸들), 그리고 `showTooltipAt` 경유의
  tooltip으로 한정됩니다. 프레임별로 결정론적이지만 **순수 함수는 아닙니다**——그리기 때문입니다.

## 좌표 변환

`distToX` / `xToDist`(데이터 ↔ x 도메인, 축 모드 인식)과 `clientXtoX`(커서 px → 줌 윈도우를
거친 x)은 `profile-data.js`에 있으며, **단일 진실 공급원**입니다. 모든 커서 경로(호버, 드래그
선택, 핸들 드래그, 터치 프로브의 탭과 드래그, 휠 줌)와 그려지는 모든 요소는 이들을 거쳐야 합니다. 그렇지 않으면 줌 상태에서
핸들이 커서에서 벗어납니다. 새 변환이 필요하면 명시적 파라미터의 순수 함수로 여기에 추가하세요.

## 자주 하는 유지보수 작업

### 오버레이 지표 추가(예: 새 센서)

1. `OVERLAY_METRICS`에 정의 추가(`id`, `colorToken`, `labelKey`, `axis`).
2. 파서가 트랙에 `hasX` 플래그를 갖게 하고 `overlayAvailability`에 연결.
3. `overlayValueAt`에 포인트별 리더 추가.
4. **다섯 개 모두**의 언어 팩에 `labelKey` 추가(`js/language/`——key 일관성은 테스트로 강제).
5. 슬롯 상한: 슬롯이 필요하면 `profile-interaction.js`의 `maxOverlays()` 확장.

### 그리기 레이어 추가

- 샘플링은 `profile-data.js` 경유(`sampleOverlay` / `sampleElevation`). 기존 호버 경로를 제외하면
  렌더러가 `track.points[]`를 직접 읽지 않습니다.
- 색은 CSS 디자인 토큰(`--series-*`, `--hr-zone-*`)에서. 테마 전환 대응을 위해 매 프레임 다시 읽음.
- `sync()`의 올바른 z 순서 슬롯에 삽입하고, 이 README의 레이어 목록도 갱신.

### 인터랙티브 컨트롤 추가

- `profile-interaction.js`에서 배선(헤더 컨트롤 → `wireControls`, 캔버스 제스처 → `wirePointer`,
  구간 핸들 → `wireHandles`).
- `state`를 변경한 뒤 `scheduleSync()` 호출. interaction 코드는 **그리지 않고**, `ctx`를
  만지지 않습니다.

### 심박 존 데이터 다루기

- 읽기 전용: `js/metrics/`의 `loadHeartRateSettings()` + `computeZoneBounds()` 사용. 이 기능이
  사용자의 존을 재계산하거나 수정하지 않습니다.
- 존은 모드별 bpm 하한. 존 5는 상한 없음(스케일로 클립).
- `hrzones:changed`를 구독하지 않으면 설정 대화상자에서 편집한 뒤 그리기가 낡습니다.
- 밴드 표시와 호버 하이라이트는 사용자의 표시 설정입니다(`js/metrics/heartRateDisplay.js`:
  `getHeartRateDisplay` / `setHeartRateDisplay`, localStorage `wayslice-hr-display`).
  `showZones`는 밴드 전체를 숨기고, `highlight`는 호버 시 진하게 칠하는 동작을 제어합니다.
  읽기의 존 라벨도 같은 두 토글을 따릅니다——`showZones`가 켜져 있을 때만 표시되고, `highlight`가
  켜지면 `--hr-zone-N` 색으로 강조됩니다.
  `hrzones:display`(변경될 때마다 발행)를 구독하지 않으면 설정 드로어에서 토글한 뒤 그리기가
  낡습니다.

### 상태 변경

- 두 모듈이 모두 봐야 하는 것 → `state` 객체, 그리고 이 README 갱신.
- 단일 모듈 내부의 것 → 모듈 전용 `let`. 기본으로 `state`를 늘리지 않습니다.

## 아키텍처를 유지하는 규칙

1. `profile-data.js`는 순수 함수 유지: 명시적 파라미터, DOM 없음, `state` import 없음. 함수에
   상태가 필요하면 다른 곳에 속합니다(또는 상태를 인자로 전달).
2. `profile-render.js`는 `profile-interaction.js`를 import하지 않습니다. interaction는 그리지
   않습니다. 렌더러가 만지는 것은 자신의 DOM 자산(canvas, 마스크, 핸들)뿐입니다. 다른 모듈의
   DOM에 대한 유일한 호출은 `drawHover → showTooltipAt`(tooltip)입니다.
3. 오버레이 패밀리 규칙: 속도 / 페이스 / GAP은 하나의 시리즈, 하나의 슬롯. `applyOverlayToggle`에서
   형제 변형은 슬롯이 가득해도 **대체**합니다(sibling 검사가 슬롯 상한 검사보다 먼저여야 함).
   `toggleOverlay`가 반환값 `{selected, unhide}`를 `state`에 적용하고 `lastSpeedVariant`를
   관리합니다.
4. import 깊이: 모듈은 예전의 평면 파일보다 한 단계 깊습니다——`menus.js`는 `../../ui/menus.js`,
   stores는 `../../core/…`. `../…`이 **아닙니다**.
5. 새 라이브러리 · 전역 변수 도입 금지: 프로젝트의 나머지 부분과 같이 ES module만 사용.
6. Canvas 캐시: 개발 중 브라우저가 오래된 모듈을 반환할 수 있습니다——프로젝트에 빌드 단계가 없고
   개발 서버는 명시적 캐시 디렉티브를 보내지 않아 브라우저가 휴리스틱 캐싱을 적용할 수 있습니다.
   변경이 반영되지 않았다고 의심되기 전에 CDP `Page.reload {ignoreCache: true}`로 강제 리로드.

7. 뷰포트 제스처는 공유하며 갈라지지 않습니다. 핀치 / 이동 / 탭 / 두 번 탭 상태 머신은
   `js/charts/viewport-gestures.js`에 있고 이변수 차트도 같은 것을 씁니다. 프로필은 x축
   어댑터 하나(도메인, 확대 하한, 플롯 지오메트리, `state.view` 접근자)만 넘기며, 휠 줌이
   `zoomStep`을 거치는 이유도 같습니다. 창 계산(`zoomWindow` / `panWindow`)이나 클램프를
   로컬에서 다시 구현하지 마세요. 두 벌이 되면 가장자리에서 반드시 어긋납니다.

## 테스트

**자동** — `tests/index.html`(저장소 루트를 serve, 예: `python -m http.server`). 스위트는 이
모듈을 직접 import하지 않습니다(Canvas/DOM 작업이므로). 공유 수학(`metrics/`, `geo/`)의 회귀
안전망이며, 공용 `tests/suite-viewport.js`(확대/이동 창 계산과 두 번 탭 규칙)의 회귀 안전망입니다. 기대값: 전부 통과.

**수동** — `sample/telemetry.gpx`(온도와 파워를 제외한 전체 텔레메트리)를 로드한 뒤 최소한 다음을
재생:

- 오버레이 메뉴: 심박 ON/OFF → 존 밴드 나타남/사라짐; 속도 → 페이스 → GAP이 서로 대체; 슬롯이
  가득하면 케이던스 거부
- 호버: 십자선, 표고 점, 심박 교차점, 툴팁 읽기(심박 존 라벨은 drawer의 「존 표시」 토글이
  켜져 있을 때만 나타나고, 「하이라이트」 토글도 켜져 있으면 존 색으로 강조됨)
- 터치 프로브(모바일 / 터치): 차트 탭 → 십자선 + 헤더와 차트 사이 고정 밴드——2행 × 4열 고정 슬롯
  그리드: [위치] [표고] [속도/페이스] [심박] / [케이던스] [온도] [파워] [빈 칸]. 각 슬롯은 독립적으로
  중앙 정렬되며 절대 움직이지 않는다. 위치와 표고는 항상 표시된다. 센서 슬롯은 오버레이가 활성화되면
  값을, 트랙에 데이터가 있지만 오버레이가 꺼져 있으면 흐린 「선택되지 않음」을 표시하고, 트랙에 그
  센서가 없으면 빈 슬롯으로 남는다. 활성화되었지만 읽기가 없는 슬롯은 대시를 표시한다. 심박 셀은
  값 아래에 존을 겹쳐 두 단으로 표시한다——존 라벨은 「존 표시」 토글이 켜져 있을 때만 나타나고,
  「하이라이트」가 켜지면 존 색으로 강조된다——모든 셀이 내용을 중앙 정렬하므로 단일 행 셀은 더 높은 행
  안에서 수직 중앙에 유지된다. 점을 선택하지
  않으면 흐린 안내문이 나옴.
  프로브를 x축을 따라 드래그하면 값이 제자리에서 갱신된다(슬롯 기하 불변).
  다른 곳 탭 → 재배치(파괴하지 않음). 차트 밖 탭 → 프로브 소멸, 밴드는 안내문으로 복귀. 한 손가락 드래그 팬(줌 상태에서)과
  두 손가락 핀치 줌이 프로브를 만들거나, 옮기거나, 없애서는 안 됨. 구간 핸들이 최우선
- 구간: 드래그 선택, 핸들 드래그 + 웨이포인트 스냅, 키보드 화살표 / Home / End
- 줌: 휠(정밀 포인터만), Shift + 드래그 팬, 더블클릭 / 더블탭 리셋
- x축 모드: 거리 ↔ 시간
- 라이브 전환: 언어, 테마, 단위, 차트가 열린 상태에서의 심박 존 편집, 설정 드로어의 두 심박 표시
  토글(밴드 ON/OFF, 호버 하이라이트)
- 모바일 뷰포트(약 390px): 가로 오버플로 없음, 레이어 유지

**Canvas 어설션** — 픽셀 프로브(`ctx.getImageData`)가 Canvas 기능을 검증하는 실용적 방법입니다:
고정 열에서 착색 행 수를 세고(존 밴드 ON/OFF), 십자선 열에서 시리즈 색 픽셀의 수직 연속 구간을
측정합니다(점의 크기 / 위치). 존 밴드 착색의 RGB 변화는 몇 단위에 불과합니다——임계값을 타이트하게
잡고 곡선 픽셀은 제외하세요.

## 이 README를 갱신해야 하는 시점

- 모듈의 담당 범위나 내보내기가 바뀔 때
- 상태 필드가 `state`와 모듈 전용 사이를 이동하거나 추가될 때
- 그리기 순서가 바뀌거나 새 레이어가 추가될 때
- 외부 이벤트 구독 / 발행이 추가되거나 제거될 때
- 「아키텍처를 유지하는 규칙」의 항목이 바뀔 때
