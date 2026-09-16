# 이변량 분석 — 유지 관리 가이드

[English](README.md) | [日本語](README.ja.md) | 한국어

> **This document is machine-generated and may contain errors or differences in technical terminology.**
> **The English version is the canonical source.**
> **If you find an error, please submit a PR or refer to the English version.**

> 이 문서는 기계 생성이므로 오류나 전문 용어의 불일치가 있을 수 있습니다.
> 영어 버전이 정식 소스입니다.
> 오류를 발견하면 PR을 제출하거나 영어 버전을 참조하세요.

이 가이드는 이변량 분석 대화상자의 유지 관리 방법을 설명합니다. 각 모듈의 담당 범위, 새 코드의 위치, 아키텍처를 지키는 규칙, 변경 사항의 검증 방법입니다.

## 이 디렉터리에 대하여

이변량 분석은 프로필 컨트롤 행에서 열리는 2차원 밀도 히트맵입니다(`#btn-dual-variable`. '겹쳐 보기' 버튼과 마찬가지로 넓은 화면에서는 텍스트 레이블로 표시되고, 720 px 이하에서는 `chart-scatter` 아이콘으로 축소됩니다). X 물리량과 Y 물리량을 하나씩 고르면, 필터를 통과한 트랙의 샘플이 2차원 그리드에 빈닝되고 셀 색이 국소 점 밀도(가장 밀도가 높은 셀 기준)를 나타냅니다. 고도 프로필과 시각 언어는 공유하지만 별개의 차트 시스템입니다. 명세(§22)는 전용 모듈 디렉터리를 요구했으며, 공유 속도 파이프라인을 제외하고 고도 프로필 모듈로의 import을 늘려서는 안 됩니다.

**공개 API는 함수 하나뿐**입니다:

```js
import { initDualVariableAnalysis } from './charts/dual-variable-analysis/index.js';
initDualVariableAnalysis({
  button: document.getElementById('btn-dual-variable'),
  dialog: document.getElementById('dual-variable-dialog'),
}); // main.js, 부팅 시 호출
```

DOM 계약: `.profile-controls` 안의 `#btn-dual-variable`. `#dual-variable-dialog`(class `sheet dualvar`) 안에 `#dualvar-close`, `#dualvar-body`(tooltip의 안전 영역), `#dualvar-select-view`(`#dualvar-x`, `#dualvar-y`, `#dualvar-select-note`, `#dualvar-analyze`), `#dualvar-result-view`(`#dualvar-summary`, `#dualvar-reselect`, `#dualvar-chart` > `#dualvar-canvas`, `#dualvar-empty`, `#dualvar-loading`). 이 id들의 이름은 바꾸지 마세요.

## 모듈 목록

| 파일 | 담당 | 내보내기 |
|---|---|---|
| `index.js` | 오케스트레이터: 버튼·대화상자 연결, 선택 → 분석 → 결과/빈 상태의 상태 머신, 셀렉트 동적 제약, 이벤트 면(언어 / 단위 / 테마 / 트랙 스토어) | `initDualVariableAnalysis` |
| `metrics.js` | 순수 지표 레지스트리: id, 레이블 키, 단위 게터, 공용 포매터, 표시↔원본 눈금 변환, 유효 조합 테이블 | `METRICS`, `getMetric`, `isPairAllowed`, `partnersOf` |
| `samples.js` | 순수 데이터 계층: 트랙별로 하나의 필터링된 샘플 테이블(일시 정지 → 무효 파워 → 무효 케이던스의 3단 필터), 가용성, 유한값 쌍 추출 | `buildAnalysisSamples`, `metricAvailability`, `extractPair` |
| `densityCalculator.js` | 순수 밀도 계산: 강건한 분위수 도메인, 고정 그리드 2D 빈닝, 상대 밀도 정규화 | `computeDensity`, `relativeDensity`(상수 `X_BINS`, `Y_BINS`, `MIN_PAIR_SAMPLES`, `DOMAIN_QUANTILE`, `DOMAIN_PAD`) |
| `densityRenderer.js` | 캔버스 그리기 전부: 플롯 + 눈금 그리드 + 늘려 그리는 밀도 비트맵 + 호버 강조 + 축 제목. 테마 색 LUT. 히트 테스트 지오메트리. 축별 가시 창(확대/이동 뷰포트) | `initRenderer`, `setData`, `clearData`, `refresh`, `resize`, `render`, `hitTest`, `setHover`, `viewportAxes`, `getViewport`, `isViewportZoomed`, `resetViewport` |
| `interaction.js` | 통합된 Pointer Events 경로(호버, 터치 탭/길게 누르기, 터치 읽기 고정) + **공용** 터치 제스처를 'two-finger' 이동 모드로(한 손가락은 읽기, 두 손가락은 핀치와 이동, 두 번 탭은 초기화 — `../viewport-gestures.js`에서). 그리지 않음 | `wireInteraction`, `clearInteraction` |
| `tooltip.js` | tooltip DOM 노드, 3행 내용(X / Y / 상대 밀도), 터치·마우스 두 가지 배치 사다리(순수 함수 `computeTooltipPlacement`) | `initTooltip`, `computeTooltipPlacement`, `showTooltipAt`, `hideTooltip` |

의존 관계(화살표 = import. 순환이 없어야 합니다):

```text
index        → metrics, samples, densityCalculator, densityRenderer, interaction, tooltip
interaction  → densityRenderer (hitTest, setHover, viewport), tooltip, ../viewport-gestures
densityRenderer → language (axis titles)
tooltip      → language, format
metrics      → units, format
samples      → elevation-profile/profile-data (buildCaches, speedToPace), sectorMetrics (createPauseTracker)
densityCalculator → nothing in this directory
```

`metrics.js`, `samples.js`, `densityCalculator.js`는 테스트 가능한 최하위 계층입니다. DOM도 대화상자도 다루지 않습니다. `samples.js`만이 고도 프로필(공유 속도 파이프라인)에서 import하는 것이 허용됩니다. 렌더러 계층과 인터랙션 계층은 허용되지 않습니다.

## 데이터 규칙(함부로 느슨하게 하지 말 것)

명세가 고정한 모듈의 계약입니다. 모두 트랙 전체에 적용되고(현재 구간이 아님), 이 순서로 실행됩니다:

1. **일시 정지 필터** — 타임스탬프가 확정된 일시 정지 구간 안에 들어가는 점은 버려집니다(마지막 이동 시점은 제외, 정지 종료 시점은 포함 — `pauseFreeSamples`와 같은 판정). 구간은 공용 `createPauseTracker`에서 가져오며, 모듈 고유의 감지기는 쓰지 않습니다.
2. **무효 파워** — 파워 미터가 있는 트랙에서, 이동 중인 점(정리된 속도 > 0)에 양의 유한 파워 판독값이 없으면 버려집니다. 미터가 없는 트랙은 이 규칙을 건너뜁니다.
3. **무효 케이던스** — 케이던스 센서에 같은 규칙을 적용합니다.
4. **결측값** — X나 Y가 유한하지 않은 쌍은 빈닝에 들어가지 않습니다(0 채우기, 이전 값 복사, 보간 모두 없음).

속도 / 페이스 / GAP는 `buildCaches`(고도 프로필의 공유 파이프라인: 기록값 → dd/dt 교차 검증 → 5점 윈도우. 계산값 → 3σ)에서 옵니다. 경사는 날것 그대로의 구간별 승강비입니다. 명세의 첫 버전은 규칙 1–3 외의 이상값 제거를 일부러 추가하지 않았습니다.

그려지는 도메인은 0.2%–99.8% 분위수 범위에 약 4% 패딩을 더한 것입니다. 드문 센서 스파이크가 데이터 본체를 압축하지 않습니다(§21). 도메인 밖의 점은 샘플 테이블에 남고, 그려지는 그리드 밖으로 나갈 뿐입니다. 유효한 쌍이 `MIN_PAIR_SAMPLES` 미만이면 → 빈 상태를 표시하고, 텅 빈 캔버스를 그리지 않습니다(§19).

밀도는 `binCount / maxBinCount`입니다(§14). tooltip은 이 선형 값을 보고합니다. 비트맵은 중간 밀도를 보이게 하려고 보기 위한 사각근 감마를 적용합니다. 둘을 '일치시키려' 하지 마세요.

## 렌더링 규약

- 밀도 그리드는 작은 오프스크린 비트맵(bin당 픽셀 하나)에 있고, 이미지 스무딩으로 늘어납니다. 점 단위 그리기도, 셀 단위 DOM도 하지 않습니다.
- 색은 256항 LUT에서 옵니다. 테마 토큰 `--density-zero` / `--density-max`(tokens.css, 테마별 한 쌍)의 2단 그라디언트를 샘플링한 것입니다. 테마 전환은 LUT 재구축 + 다시 그리기이며, 카운트는 다시 계산하지 않습니다.
- 눈금은 지표 표시 공간의 1/2/5 × 10ᵏ 보기 좋은 수입니다(toDisplay/fromDisplay는 `metrics.js` 담당). 레이블은 공용 포매터를 통하므로, 축의 읽기가 UI의 다른 부분과 어긋나지 않습니다. 축 제목은 `t(labelKey) + 단위`입니다. 단위가 tooltip 전용 지식이 되는 일은 없습니다.
- **페이스 계열의 축은 두 방향 모두 거꾸로 읽습니다**(`pace`/`gap`에 `reversed: true`). 페이스 값이 작을수록 빠르므로, 세로축의 빠른 쪽이 위(15:00 /km 위에 5:00 /km), 가로축의 빠른 쪽이 오른쪽에 옵니다. 모든 매핑 —— 그리드선, 눈금 레이블, 비트맵의 행과 열(`rebuildBitmap`), 호버 테두리(`render`), 히트 테스트(`hitTest`) —— 는 같은 반전 판정을 거쳐야 합니다. 축을 직접 매핑하는 새 그리기 경로는 tooltip과 조용히 어긋납니다.
- **데스크톱 대화상자 높이는 `.sheet`의 공용 상한에 고정**(`min(76vh, 720px)`, components.css, ≥721px만): 구간 분할 목록과 이변량 분석 대화상자는 모든 트랙에서 높이가 정확히 같습니다. 그렇지 않으면 둘 다 내용에 따라 늘어나고 세그먼트 수에 따라 흔들립니다. 차트는 요약 행 아래의 공간을 flex로 채웁니다(clamp 높이를 덮어씀). 차트의 ResizeObserver가 크기 변화 후 다시 그립니다. '모든 지표' 패널(같은 `#sheet` 요소, `.seg-list` 없음)과 모든 좁은 화면의 바텀 시트는 내용에 맞는 크기의 그대로입니다.
- 왼쪽 여백은 가장 넓은 y 눈금 레이블에 맞춰 늘어납니다. 캔버스 가장자리에서 잘릴 x 눈금 레이블은 그리드선에서 벗어나게 옮기지 않고 버립니다.

## 인터랙션 계약

Pointer Events 경로는 하나입니다(§16). 얇은 포인터는 호버. 터치는 탭 또는 길게 누르기이며, 읽기는 손가락이 떠난 위치에 고정됩니다(읽기에 두 번 탭은 필요하지 않습니다). 플롯 영역은 데이터 좌표 해석만 담당합니다(`hitTest`가 client→데이터 변환의 유일한 통로이므로, 강조와 tooltip이 어긋나지 않습니다). tooltip의 배치는 별개의 관심사입니다(`tooltip.js`의 `computeTooltipPlacement`. 순수 함수이며 유닛 테스트 있음). 터치는 '터치점 바로 위' 전략을 씁니다 —— 바로 위 8–12 px 간격, 수평으로 정렬, 경계는 **화면 전체**뿐입니다(상자는 차트 카드와 대화상자 본체를 벗어날 수 있습니다. 터치점이 높으면 화면 상단에 클램프) —— 아래로 뒤집기도, 옆 탐색도 하지 않으며, 플롯 영역의 가장자리는 아무 역할도 하지 않습니다. 마우스는 위 → 아래 → 옆 → 클램프 사다리(간격 14 px)를 대화상자 본체 안에서 유지합니다(모달 계층과 뷰포트를 피하며, 포인터의 위·아래·왼쪽·오른쪽 어디든 나타날 수 있습니다). 컨테이너 스크롤이나 창 크기 조정에서는, 상자가 오래된 위치에 떠다니게 두는 대신 숨깁니다.

차트의 **뷰포트**는 공용 제스처 머신(`js/charts/viewport-gestures.js`)이 구동합니다. 어느 제스처가 이동을 맡는지는 **호스트**가 정하고(`panGesture`), 이 차트는 `two-finger` 모드입니다: 한 손가락은 읽기 전용(tooltip이 손가락을 따라가고 창은 움직이지 않습니다), 두 손가락은 확대와 이동을 함께 하므로 간격을 유지한 두 손가락 드래그는 순수한 이동입니다. 고도 프로필은 `one-finger`를 유지합니다(거기서는 한 손가락이 뷰포트 조작이고, 범위 선택에는 전용 핸들이 있습니다). 빠르게 두 번 탭하면 전체 데이터 범위로 돌아갑니다. 축마다 원본 단위의 창을 따로 가지며 `null`은 '전체 도메인'을 뜻하므로, 초기화는 항상 현재 데이터에 맞춘 자동 fit입니다. 페이스 축은 자기 방향을 유지합니다. 제스처는 창만 움직이며 X/Y 선택, 샘플 테이블, 밀도 그리드는 건드리지 않고, 어느 배율에서도 다시 빈닝하지 않습니다(창은 같은 비트맵의 부분 사각형입니다). 이동이나 핀치는 고정된 읽기를 버립니다(더 이상 같은 데이터를 가리키지 않는 화면 위치에 남기지 않기 위해). 손가락이 움직이지 않으면 그대로 탭입니다. 확대 하한은 각 축 도메인의 5 %입니다.

## 이벤트

`index.js`가 구독하는 것: `language:changed`(열린 뷰 다시 그리기), `units:changed`(눈금 다시 그리기), `theme:changed`(LUT 재구축 + 다시 그리기), `trackStore`(샘플 캐시 무효화, 대화상자 닫기, 버튼 전환). 대화상자는 모달이므로, 이 이벤트들은 대개 열려 있는 동안의 OS 수준 변화(시스템 테마 등)에서 발화합니다. 제거하지 마세요.

## 검증

`tests/suite-dualVariable.js`는 조합 테이블, 3가지 데이터 필터, NaN 처리, 가용성, 쌍 추출, 밀도 그리드(강건한 도메인, 퇴화한 범위, bin 일관성), tooltip 배치 사다리를 다룹니다. 5개 스위트 총 32개 케이스. 로컬 HTTP 서버의 `tests/index.html`에서 전체 스위트를 실행하세요. 전부 통과를 유지하고, 새 데이터 규칙을 추가할 때 함께 확장합니다. 공용 제스처는 따로 검증합니다. `tests/suite-viewport.js`가 창 계산(클램프, 축별 방향 규칙, 앵커 유지, 두 번 탭 규칙)을 고정합니다. 포인터 경로 자체는 **수동** 확인입니다 — 거친 포인터 기기나 기기 에뮬레이션에서(터치 제스처는 거기서만 존재합니다): 핀치와 두 손가락 드래그로 확대/이동, 한 손가락 스와이프로 읽기, 두 번 탭으로 전체 범위 복귀, 그리고 창을 움직이는 제스처가 고정된 읽기를 버리는지(더 이상 같은 데이터를 가리키지 않는 화면 위치에 남기지 않는지)를 확인합니다.
