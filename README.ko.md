> The README is machine-generated, if you find issues please submit a PR.
>
> 이 README는 기계로 생성되었습니다. 문제를 발견하면 풀 리퀘스트를 보내 주세요.

<p align="center">
  <img src="./icons/android-chrome-512x512.png" alt="WaySlice">
</p>

<h1 align="center">WaySlice</h1>

<p align="center">
  <strong>Telemetry for every way. Sliced.</strong><br><strong>걸어온 길은 모두 텔레메트리가 되고, 그 텔레메트리는 모두 잘라 분석합니다.</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.ja.md">日本語</a> | 한국어<br><a href="README.fr.md">Français</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.it.md">Italiano</a>
</p>

WaySlice는 오픈 소스 순수 프런트엔드 GPX/FIT/TCX/KML/KMZ 트랙 분석기입니다. 전체 트랙 통계로는 알 수 없습니다. 알고 싶은 것은 그 긴 오르막이 얼마나 걸렸는지, 테크니컬한 내리막을 얼마나 과감히 내려갔는지, 레이스 마지막 5 km에서 페이스가 무너졌는지입니다. WaySlice는 임의의 구간을 잘라내어 레이싱 텔레메트리나 항공 QAR(퀵 액세스 레코더) 데이터를 읽듯 따로 분석하게 해 줍니다:

```text
트랙 → 구간 선택 → 구간 분석
```

<p align="center"><img src="./screenshots/overview.jpg" alt="image"></p>

<p align="center"><a href="./screenshots/README.ko.md">스크린샷 더 보기</a></p>

용어가 낯설다면 [용어집](#용어집)부터 읽어 보세요. 이 문서의 용어는 모두 거기서 정의한 의미로 쓰입니다.

## 목차

- [용어집](#용어집)
- [기능](#기능)
- [지원 형식](#지원-형식)
- [시작하기](#시작하기)
  - [구간 분석 방법](#구간-분석-방법)
- [프라이버시](#프라이버시)
- [단위 체계](#단위-체계)
- [설계 노트](#설계-노트)
- [테스트](#테스트)
- [기여](#기여)
  - [프로젝트 구조](#프로젝트-구조)
  - [UI 언어 추가](#ui-언어-추가)
  - [베이스맵 추가 및 편집](#베이스맵-추가-및-편집)
  - [사이트 아이콘 교체](#사이트-아이콘-교체)
  - [번역 README 추가](#번역-readme-추가)
- [로드맵](#로드맵)
- [라이선스](#라이선스)
- [특별 감사](#특별-감사)
- [후원자](#후원자)

## 용어집

이 문서와 앱 UI에서 다음 용어는 고정된 의미로 쓰입니다. 본문에서 이 단어들이 나오면 반드시 이 정의대로 읽으세요:

| 용어 | 의미 |
|------|---------|
| 트랙(Track) | 하나의 파일에서 읽어 들인 한 개의 기록 경로: 순서대로 나열된 트랙 점. |
| 트랙 점(Track point) | 트랙 위의 하나의 측정점: 위치, 그리고 파일이 담고 있다면 고도·타임스탬프·심박수·케이던스·파워·온도. |
| **구간(Sector)** | WaySlice의 핵심 개념. 트랙 중에서 여러분이 고른 시작점과 끝점 사이의 부분입니다. 경계는 두 트랙 점 사이 어디든 놓일 수 있습니다(보간). 트랙 전체도 기본 구간인 "전체 트랙"입니다. 모든 지표는 현재 구간을 대상으로 계산됩니다. |
| 구간 핸들(Sector handle) | 구간 경계를 정하는 드래그 가능한 동그란 점. 초록 = 시작, 빨강 = 끝. 지도와 고도 프로필 양쪽에 표시되며 실시간으로 동기화됩니다. |
| 누적 상승 / 하강(Elevation gain / loss) | 구간 안에서 상승 / 하강한 총량. 3 m 노이즈 필터를 통과한 값입니다([설계 노트](#설계-노트) 참조). |
| VAM / VDM | 시간당 수직 상승 / 하강 미터 수(Vertical Ascent / Descent Meters per hour). 실제로 상승 / 하강 상태였던 시간만 분모로 씁니다. |
| 이동 시간(Moving time) | 경과 시간에서 정지를 뺀 것. 정지는 속도 0.5 km/h 미만이 10초 이상 이어진 상태입니다. |
| GAP(경사 보정 페이스) | 실측 페이스를 Minetti(2002) 경사 보정 계수로 나눈, 같은 노력에 해당하는 평지 페이스. |
| 등가 거리(Effort distance) | 수평 거리 + 누적 상승 ÷ 100: 고도 100 m 상승을 1 km로 환산합니다. |
| 3D 거리(3D distance) | 지형을 따라가는 거리: 구간별 `√(수평² + 수직²)`을 누적한 값으로, 수평 거리와 별도로 보고됩니다. |
| 경사도(Grade) | 특정 지점 또는 구간의 가파른 정도: 수직 변화 ÷ 수평 거리. 백분율로 표시됩니다(양수 = 오르막, 음수 = 내리막). |
| 페이스(Pace) | 거리 한 단위에 걸리는 시간: min/km 또는 min/mi. |
| 웨이포인트(Waypoint) | 트랙 파일 자체에 저장된 이름 붙은 위치(GPX `<wpt>`, KML `<Point>`). |
| 베이스맵(Basemap) | 트랙 아래에 그려지는 지도 타일 소스. 기본값은 OpenStreetMap입니다. |

## 기능

- **지도 + 고도 프로필.** 어느 쪽에서든 구간 핸들을 드래그해 구간을 선택하세요. 양쪽이 실시간으로 동기화되며, 경계는 두 트랙 점 사이 어디든 놓일 수 있습니다(보간 포함).
- **지도와 프로필 위의 웨이포인트.** GPX(`<wpt>`)와 KML(`<Point>`) 웨이포인트를 지도와 고도 프로필에 핀으로 표시하고, 호버하면 이름이 보입니다. "트랙에 맞추기" 아래 핀 버튼으로 표시/숨김을 전환할 수 있습니다. 지도 핀에 호버하면 프로필의 해당 위치에 표시가 나타납니다. 핀을 클릭하면 배율을 변경하지 않고 그 지점이 지도 중앙에 옵니다.
- **프로필 휠 줌(데스크톱) / 핀치 줌(터치).** 고도 프로필에 마우스를 올리고 휠을 굴리면 커서를 중심으로 거리/시간 축을 확대합니다. Shift를 누른 채 드래그하면 패닝됩니다. 터치 기기는 한 손가락으로 이동하고 두 손가락 핀치로 확대합니다. 프로필 아무 곳이나 두 번 클릭(터치는 두 번 탭)하면 전체 트랙으로 돌아갑니다.
- **자동 분할.** 헤더의 가위 버튼이 트랙 전체의 구간 목록을 만듭니다: 웨이포인트 기준(CP 간), 고정 거리(1 km / 5 km / 사용자 지정, 야드파운드법에서는 마일), 경사(오르막/내리막 구간)로 나눕니다. 각 행은 구간 번호, 거리 범위, 유형 캡슐(고도 변화로 오르막, 내리막, 평지, 혼합 판정), 시간, 페이스, 심박수 순으로 표시되고, 좁은 화면에서는 두 줄로 나뉘어 캡슐에 유형 이름이 들어가고 데이터 줄은 첫 줄 거리 시작점에 왼쪽 맞춤이 되며, 행을 펼치면 해당 구간의 3D 거리, 등가 거리, 상승/하강, GAP, VAM/VDM 상세가 나타나며 기본 구간도 그 구간으로 이동합니다.
- **구간 지표.** 수평 거리, 3D 거리, 등가 거리, 누적 상승/하강, 경사도, 총 시간/이동 시간, 페이스, 속도, GAP. 파일에 심박수, 케이던스, 파워, 온도가 있으면 해당 데이터도 표시됩니다. 입력 데이터가 없으면 0이 아니라 *사용 불가*로 표시됩니다.
- **이변량 분석.** 프로필 컨트롤 옆의 산점도 아이콘으로 2차원 밀도 히트맵을 엽니다. 심박수, 속도, 페이스, GAP, 케이던스, 파워, 온도, 경사, 고도 중 유효한 조합을 분석할 수 있습니다. 분석 범위는 현재 선택한 구간을 따르고, 각 물리량의 값은 지표 패널과 같은 메커니즘에서 옵니다: 심박수·케이던스·파워는 패널과 같이 일시 정지 중 판독값을 제거하고 5점 평활을 적용하며, 온도는 날것 그대로(일시 정지 포함), 경사는 패널의 50 m 경사 창, 속도 계열은 구간에 대한 패널의 '최고 속도' 계열입니다. 셀에 포인터를 올리면 해당 칸의 X·Y·상대 밀도를 읽을 수 있습니다. 테마·단위·언어가 실시간으로 적용되고, 전용 차트 모듈 덕분에 10만 포인트 규모의 트랙도 부드럽게 움직입니다. 터치에서는 두 손가락으로 확대와 이동, 한 손가락은 데이터 읽기, 두 번 탭하면 전체 범위로 돌아갑니다.
- **내보내기.** 현재 구간을 다운로드하세요: 지표는 csv, txt, md로, 트랙 점은 GPX 파일로 저장됩니다. 내보내기는 클릭 시점의 언어와 단위 체계를 따릅니다.
- **미터법 / 야드파운드법.** 표시 단위를 언제든 전환할 수 있습니다. 기본값은 미터법이며 선택은 로컬에 저장됩니다.
- **다국어.** English, Français, 日本語, 한국어, Deutsch, Español, Italiano가 내장되어 있습니다. 언어를 하나 더 추가하는 것은 데이터 파일 하나면 됩니다([기여](#기여) 참조).
- **아키텍처로 지키는 프라이버시.** 업로드 코드가 아예 없습니다. 파일은 File API로 읽은 뒤 브라우저 안에서 해석·분석·렌더링됩니다.
- **빌드 불필요.** 순수 ES 모듈이라 바로 읽고, 실행하고, 고칠 수 있습니다.

## 지원 형식

| 형식 | 지오메트리 | 고도 | 타임스탬프 |
|--------|----------|-----------|------------|
| `.gpx` | `<trk><trkseg><trkpt>`(다중 구간) | ✅ | ✅ |
| `.fit` | Garmin FIT 바이너리 활동 파일 | ✅ | ✅ |
| `.tcx` | TrainingCenterDatabase XML | ✅ | ✅ |
| `.kml` | `LineString` + `gx:Track` | ✅(좌표에서) | ✅(`gx:Track` / `<when>`) |
| `.kmz` | ZIP → KML(네이티브 `DecompressionStream`, 라이브러리 불필요) | ✅ | ✅ |

FIT 해석은 번들된 [fit-parser](https://github.com/jimmykane/fit-parser) 라이브러리(MIT, `vendor/fit-parser/`)가 맡고, TCX는 내장 DOM 파서가 직접 읽습니다. GPX의 일반적인 센서 확장은 localName 기준으로 식별하며 네임스페이스 접두사를 가리지 않습니다: Garmin TrackPointExtension(심박수, 케이던스, 기온, 속도, 거리)과 세 가지 파워 표기(단일 `<power>`, `PowerInWatts`, `ns3:Watts`). 모든 형식은 같은 트랙 점 모델로 들어오므로, 구간 지표는 소스 형식과 무관하게 똑같이 동작합니다.

## 시작하기

**Try it: https://wayslice.com**

정적 파일 서버라면 무엇이든 됩니다. 빌드는 없습니다:

```bash
# Python
python -m http.server 8080

# 또는 Node
npx serve .
```

<http://localhost:8080>을 열고 GPX/FIT/TCX/KML/KMZ 파일을 놓으세요.

> `index.html`을 `file://`로 직접 열면 동작하지 않습니다. 브라우저가 `file://` URL의 ES 모듈 가져오기를 차단하기 때문입니다.

### 구간 분석 방법

1. 트랙을 놓으면 기본적으로 전체 트랙이 선택됩니다.
2. **지도나 고도 프로필에서 초록/빨강 구간 핸들을 드래그**하세요. 트랙이나 프로필을 클릭해 가장 가까운 경계를 옮기거나, 프로필에서 드래그해 새 범위를 지정할 수도 있습니다. 터치 기기에서는 한 손가락으로 확대된 프로필을 이동하고, 핀치로 확대/축소합니다. 범위 변경은 핸들 드래그로만 할 수 있습니다.
3. 조정할 때마다 구간이 즉시 재계산됩니다: 거리, 3D 거리, 상승/하강, 경사도, 페이스/속도, 가장 빠르거나 느린 1 km.
4. 키보드: 핸들에 포커스를 두고 방향키(Shift = ×10, Home/End = 끝으로 이동). `Esc`로 메뉴를 닫습니다.
5. 터치 기기는 협업 제스처를 사용합니다: 한 손가락으로 페이지를 스크롤하고, 두 손가락으로 지도를 이동·확대합니다(지도에 힌트가 표시됨).
6. 바로 쓸 수 있는 구간이 필요하면 헤더의 `자동 분할` 버튼으로 트랙 전체의 구간 목록을 만드세요(웨이포인트·거리·경사 기준).

## 프라이버시

- 트랙은 **브라우저 안에서만** 처리됩니다: 해석 → 분석 → 렌더링, 전부 로컬입니다.
- 네트워크 요청은 선택한 베이스맵의 **지도 타일**뿐입니다. 트랙 데이터는 전송되지 않으며 추적 코드도 없습니다.
- 테마, 언어, 베이스맵, 단위 설정은 기기의 `localStorage`에만 저장됩니다.

## 단위 체계

WaySlice는 기본값으로 **미터법**을 사용하며 **야드파운드법**도 지원합니다. 헤더 오른쪽 위의 톱니 버튼으로 `설정` 창을 열면 단위가 언어·테마와 함께 있습니다:

| 표시 | 미터법 | 야드파운드법 |
|---|---|---|
| 긴 거리 | km | mi |
| 짧은 거리 / 고도 | m | ft |
| 속도 | km/h | mph |
| 페이스 | min/km | min/mi |
| 경사도 | % | % |

모든 해석과 계산은 항상 SI 단위(미터, 미터/초, 초/킬로미터)로 이루어집니다. 단위 전환은 표시 숫자를 다시 포맷할 뿐입니다: 파일을 다시 해석하지 않고, 구간을 다시 계산하지 않고, 트랙 지오메트리도 바뀌지 않습니다. 이 설정은 `wayslice-units` 키로 저장되어 새로고침 후에도 유지됩니다. 언어와 단위는 서로 독립적이라, 어떤 언어든 어느 단위 체계와든 자유롭게 조합할 수 있습니다.

## 설계 노트

- **3D 거리**는 구간별로 `√(수평² + 수직²)`으로 계산되며 수평 거리와 별도로 보고됩니다.
- **등가 거리** = 수평 거리 + 누적 상승 ÷ 100 (고도 100 m 상승을 1 km로 환산).
- **평균 경사도**는 구간의 누적 상승을 수평 거리로 나눈 값이며, 점별 경사도의 평균이 아닙니다. 내리막만 있는 구간은 평균할 상승이 없어 "—"로 표시됩니다. 최대/최소 경사도는 약 50 m 창으로 계산해 GPS 노이즈가 기록 경사를 위조하지 못하게 합니다.
- **누적 상승/하강**은 3 m 히스테리시스 필터를 적용합니다. 고도 변화가 ±3 m를 넘어야 계상하며, 3 m 미만의 노이즈는 총계에 포함되지 않습니다.
- **VAM/VDM**의 분모는 실제로 상승/하강 상태인 시간(필터 후 고도 추세 방향)이며, 구간 전체 시간이 아닙니다.
- **이동 시간**은 정지(속도 0.5 km/h 미만이 10초 이상 지속) 이외의 구간만 계산합니다.
- **평균 속도·평균 페이스**는 구간별 이동 속도로 계산하며 프로필과 같은 규칙으로 정리합니다. 기록 속도가 있으면 5포인트 슬라이딩 윈도로 스파이크를 이웃에 희석하고, 기록 속도가 없으면 3 표준편차 규칙만 적용합니다. **최고 속도**는 프로필 속도 곡선과 일치합니다. 정리 후 포인트별 속도의 최댓값이라 목록과 차트가 항상 같습니다.
- **평균 GAP**은 구간 페이스를 Minetti(2002) 경사 보정 계수(경사는 ±45%로 클램프)로 나눈 값의 평균입니다 — 같은 노력에서의 평지 페이스를 나타냅니다. 프로필에서 속도/페이스/GAP은 하나의 오버레이 슬롯을 공유합니다.
- **프로필 속도 곡선 클리닝**: 속도의 취득원별로 규칙을 선택합니다 — 기록 속도는 각 측정값을 당시 dd/dt와 교차 검증하고(50% 초과 측정값은 제거), 5포인트 슬라이딩 윈도로 평활화합니다(각 플롯값은 자신과 앞뒤 2개의 평균). 계산 속도는 위치 차이에서 구해 3σ 원칙으로 바로 정리합니다(초과값은 인접점 보간). 정지 중의 0 속도도 데이터이며 그대로 윈도 평균에 참여합니다.
- **표시용 단순화**(지도는 Douglas–Peucker, 프로필은 픽셀 열별 최소–최대 샘플링)는 원본 데이터를 건드리지 않습니다. 지표는 항상 전체 데이터로 계산합니다.
- **프로필 확대**는 거리 모드 최소 1 km, 시간 모드 최소 20분 창까지 지원합니다. 터치 기기는 두 손가락 핀치로 프로필을 확대합니다(휠은 없음).
- 10만 점 이상의 큰 트랙도 문제없습니다. 핸들을 드래그하는 동안 경계 탐색은 이전 매치 위치에서 시작해 필요한 만큼 탐색 범위를 넓힙니다.

## 테스트

같은 서버에서 `tests/index.html`을 여세요:

```text
http://localhost:8080/tests/
```

테스트 스위트는 거리 계산, 점 사이 보간, 경사도 창, 시간 지표, GPX/FIT/TCX/KML/KMZ 해석(손상된 파일과 아카이브, 파워/센서 확장 포함), 테마 설정 매트릭스(시스템/수동 × OS 라이트/다크), 언어 폴백 체인, 미터법/야드파운드법 변환(페이스 반올림, VAM/VDM, 지속성, 단위 무관 경사도 포함)을 다룹니다. 구간 내보내기(csv/txt/md/gpx의 내용과 파일 이름)도 검증합니다.

## 기여

### 프로젝트 구조

```text
index.html              페이지 셸 + 테마 부트 스크립트(테마 플래시 없음)
icons/                  사이트 아이콘 자산(favicon.svg 및 각 크기 PNG/ICO, 미리보기 페이지)
site.webmanifest        PWA 설치 메타데이터(이름, 테마 색, 아이콘)
css/                    디자인 토큰(라이트/다크), 베이스, 레이아웃, 컴포넌트
js/
  parsers/              GPX / FIT / TCX / KML / KMZ → 하나의 트랙 점 배열
  geo/                  하버사인 + 3D 거리, 보간, 단순화
  metrics/              구간 지표(순수 함수, 독립 테스트 가능)
  sector/               구간 선택 상태(단일 데이터 소스)
  map/                  MapLibre 뷰, 베이스맵 카탈로그, 구간 핸들
  charts/               Canvas 차트(고도 프로필, 이변량 분석)
  theme/                시스템 / 라이트 / 다크 테마, OS에 실시간 동기화
  language/             언어 코어 + lang-*.js 언어 팩 + 템플릿
  units/                미터법/야드파운드법 설정, SI 표시 변환, 현지화된 단위 레이블
  ui/                   지표 패널, 설정 창, 자동 분할, 메뉴, 시트, 업로드, 아이콘
  core/                 작은 이벤트 버스 + 스토어
  utils/                로케일 인식 포맷팅(Intl)
tests/                  브라우저에서 실행하는 테스트 스위트(tests/index.html)
vendor/fit-parser/      벤더링된 fit-parser 툴킷(FIT 디코딩, MIT) + buffer 심
```

계산 로직은 UI와 분리되어 있습니다: `computeSectorMetrics()` 등 지표 함수는 DOM을 만지지 않으며 테스트 스위트가 이를 검증합니다.

### UI 언어 추가

번역 시스템에는 프레임워크가 없습니다: **하나의 언어 = 하나의 데이터 파일**입니다. JavaScript 파일을 편집할 수 있다면 누구나 이 앱을 번역할 수 있습니다.

1. [`js/language/lang-template.js`](js/language/lang-template.js)를 `lang-xx.js`로 복사하세요
   (`xx`는 `es`, `pt-BR` 같은 BCP 47 코드).
2. 오른쪽 값을 번역하세요. 키와 `{플레이스홀더}`는 그대로 두고, 전문 용어는 일관되게 유지하세요(구간, 3D 거리, 누적 상승/하강, 경사도, 페이스, VAM).
3. [`js/language/langs.js`](js/language/langs.js) 카탈로그에 항목을 하나 추가하세요 — 언어 코드, 자국어 이름, 지연 로더가 전부입니다. 언어 팩은 필요할 때 로드되며, 부팅 시에는 방문자 언어와 영어만 가져옵니다.
4. 앱을 열어 자신의 언어로 바꾸고 콘솔을 확인하세요. WaySlice는 영어 키를 기준으로 로드된 언어 팩을 검증하고 누락되었거나 알 수 없는 키를 경고합니다.
5. 풀 리퀘스트를 보내세요.

누락된 키는 영어로(그래도 없으면 키 이름으로) 폴백되므로 UI에 `undefined`가 표시될 일은 없습니다. 언어, 테마, 베이스맵 선택은 `localStorage`로 새로고침 후에도 유지됩니다.

### 베이스맵 추가 및 편집

베이스맵 목록은 한 파일에 모여 있습니다: [`js/map/sources.js`](js/map/sources.js). 지도 메뉴, 설정 시트, 저장, 타일 레이어 생성이 모두 이 파일을 읽기 때문에, 소스를 추가하거나 고칠 때 UI 코드는 건드릴 필요가 없습니다.

**소스 추가** — `MAP_SOURCES` 배열에 객체를 하나 추가하세요:

```js
{
  id: 'esri-topo',           // 고유 ID이자 저장 키
  labelKey: 'srcEsriTopo',   // 표시 이름의 번역 키
  group: 'outdoor',          // street | outdoor | satellite | minimal
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
  maxZoom: 19,
  attribution: 'Tiles &copy; Esri',
},
```

| 필드 | 의미 |
|---|---|
| `id` | 고유 ID이자 사용자 선택의 저장 키. 값을 바꾸면 새 소스를 추가한 것과 같아집니다(저장된 선택은 기본값으로 폴백). 항목을 삭제해도 같은 방식으로 안전하게 폴백합니다. |
| `labelKey` | 표시 이름의 i18n 키. |
| `group` | `street`, `outdoor`, `satellite`, `minimal` 중 하나. |
| `url` | 타일 템플릿: `{z}` `{x}` `{y}`, 선택적 `{s}`(`subdomains` 필요)와 `{r}`(레티나). 좌표 순서는 제공자마다 다릅니다 — Esri는 `{z}/{y}/{x}`를 씁니다. |
| `overlayUrl` | 선택 사항: 베이스 타일 위에 얹는 투명 라벨 레이어. |
| `maxZoom` | 제공자가 제공하는 최대 줌 레벨. |
| `attribution` | OSM, OpenTopoMap, Thunderforest, Mapy, Stadia Maps, OpenFreeMap, EOX, Esri가 법적으로 요구합니다 — 그대로 두세요. |
| `subdomains`, `crossOrigin`, `hintKey` | 선택 사항: 서브도메인 로테이션 / CORS 헤더를 보내지 않는 제공자는 `crossOrigin: false` / 선택 메뉴의 회색 힌트 줄. |

다음으로 **모든** 언어 팩에 표시 이름을 추가하세요 — `srcEsriTopo: 'Esri 지형도',`를 `lang-en.js`, `lang-fr.js`, `lang-ko.js`, `lang-ja.js`, `lang-de.js`, `lang-es.js`, `lang-it.js`, `lang-template.js`에 넣습니다. 키가 빠져 있는 동안은 언어 완전성 테스트가 계속 실패하는데, 이것은 의도된 설계입니다.

**소스 편집**은 `url`, `maxZoom`, 이름, attribution을 그자리에서 고치는 방식으로 합니다. **새 그룹**을 만들려면 `GROUP_ORDER` 배열에 그룹을 추가하고, 소스에 해당 group을 쓰며, `groupTopo` 같은 `group<이름>` 키를 하나 추가하세요. API 키가 필요한 서비스(Maptiler, Mapbox)는 키를 `url`에 넣으면 동작하지만 자신의 키를 커밋하지는 마세요. 타일은 HTTPS를 권장합니다. HTTPS로 올린 페이지에서는 브라우저가 HTTP 타일을 차단하거나 강제로 HTTPS로 바꿉니다. 확인은 간단합니다: 새로고침 후 `지도` 메뉴를 열어 타일, 최대 줌, 출처 표기를 확인하세요.

### 사이트 아이콘 교체

모든 사이트 아이콘은 하나의 소스 파일 `icons/favicon.svg`에서 나옵니다 — 1024×1024 둥근 타일, 어두운 그라데이션 배경 위 주황색 산 능선 두 개와 흰색 GPX 트랙 선. 선 양 끝의 초록/빨강 점은 앱 내 구간 핸들 색과 같습니다. 이 SVG에서 `favicon.ico`, 16–512 px PNG, `apple-touch-icon.png`, Android Chrome 아이콘, `site.webmanifest`를 다시 생성합니다. 검색 엔진마다 요구 사항이 있습니다(Google에 아이콘을 표시하려면 48 px 이상 PNG, manifest, 크롤링을 막지 않는 robots.txt가 필요 — 저장소 루트의 `robots.txt`가 바로 그 역할을 합니다). `icons/icon-preview.html`에서 모든 크기를 로컬로 확인할 수 있습니다. 앱 내부에서는 헤더와 빈 상태의 브랜드 마크가 `icons/favicon.svg`를 그대로 쓰고, 기능 아이콘은 Lucide 아이콘 라이브러리(ISC 라이선스)의 SVG가 `js/ui/icons.js`에 담겨 있습니다. 헤더의 GitHub 링크만 예외로, `icons/`에 있는 GitHub 로고 파일을 이미지로 불러옵니다(Octocat 마크와 GitHub 워드마크는 GitHub, Inc.의 상표이며, 이 저장소로 연결하는 용도로만 씁니다).

자신의 아이콘으로 바꾸려면 `icons/favicon.svg`를 수정한 뒤 나머지 크기를 다시 생성하고, `index.html`의 링크와 `site.webmanifest`를 동기화하세요.

### 번역 README 추가

기존 번역([English](README.md), [日本語](README.ja.md), [Français](README.fr.md), [Deutsch](README.de.md), [Español](README.es.md), [Italiano](README.it.md))이 그대로 예시입니다. 추가하려면:

1. 이 `README.md`(또는 기존 번역 중 하나)를 `README.xx.md`로 복사하세요
   (`xx`는 BCP 47 코드, 예: `README.es.md`).
2. 본문을 번역하세요. 구조, 섹션 순서, 표, 코드 블록, 파일 경로는 그대로 유지해야 모든 버전을 비교하고 관리하기 쉽습니다. 용어 번역은 각 버전의 용어집을 따르세요.
3. **모든** README의 제목 아래 언어 전환 줄을 업데이트하세요: 다른 버전에는 자신의 언어를 링크로 추가하고 `A | B | C | D` 형식을 유지합니다. 자신의 버전에서는 자신의 언어가 일반 텍스트입니다.
4. 풀 리퀘스트를 보내세요.

## 로드맵

- GPS 드리프트와 희소 샘플링을 고려한 더 나은 속도 데이터 클리닝 알고리즘
- 자동 분할의 더 나은 경사 구간 감지 알고리즘(오르막/내리막/평지/혼합)
- 선택적 외부 DEM 고도 보정(옵트인만 — 기본값은 완전 로컬 유지)

## 라이선스

[MIT 라이선스](LICENSE)로 배포됩니다. 상업적·개인적 사용 모두 자유입니다 — 지도 제공자의 귀속 표기는 유지해 주세요:

- [MapLibre GL JS](https://maplibre.org) (BSD-3-Clause)
- © [OpenStreetMap](https://www.openstreetmap.org/copyright) 기여자 (ODbL)
- [OpenTopoMap](https://opentopomap.org) (CC-BY-SA), [CyclOSM](https://github.com/cyclosm/cyclosm-cartocss-style)
- [Thunderforest](https://www.thunderforest.com), [Mapy.com](https://mapy.com), [Stadia Maps](https://stadiamaps.com), [OpenFreeMap](https://openfreemap.org), [EOX](https://tiles.maps.eox.at), [Esri World Imagery](https://www.esri.com) 베이스맵
- 아이콘: [Lucide](https://lucide.dev) (ISC)

## 특별 감사

- 이 프로젝트는 [Trail Running Movement](https://trailrunningmovement.com/)의 [GPS 데이터 분석](https://trailrunningmovement.com/training/gps-data-analysis/) 기사에서 대략적인 영감을 얻었습니다.
- Bruksleden 100 Miler(스웨덴)의 [GPX 트랙](https://fastestknowntime.com/fkt/ken-zemach-bruksleden-100-miler-sweden-2020-08-02)을 제공해 주신 [Ken Zemach](https://fastestknowntime.com/athlete/ken-zemach) 님께 감사드립니다.
- [FIT 파일](https://github.com/polyvertex/fitdecode/tree/master/tests/files)을 제공해 주신 [polyvertex](https://github.com/polyvertex) 님께 감사드립니다.
- 2020 - 2023 투르 드 프랑스의 [TCX 파일](https://github.com/ToonElewaut/TDF/tree/main/src/Data/Routes)을 제공해 주신 [ToolElewaut](https://github.com/ToonElewaut) 님께 감사드립니다.
- [TCX 파일](https://github.com/tingard/cycling_power_analysis)을 제공해 주신 [tingard](https://github.com/tingard) 님께 감사드립니다.
- 파워가 포함된 장거리 라이딩 [TCX 파일](https://github.com/pherris/IOT-Value-Cycling/tree/master/rides)을 제공해 주신 [pherris](https://github.com/pherris) 님께 감사드립니다.
- 홍콩의 카이쿵렝 - 타이투옌 - 타이모산 하이킹 [GPX 트랙](https://drive.google.com/file/d/1lPVebrcOImAw035d9r0tqP63O-2yZe4E/view)을 제공해 주신 [Tommi](https://www.youtube.com/@bewarethemountainman) 님께 감사드립니다.

## 후원자

WaySlice의 유지보수와 운영을 도와주시는 모든 분께 감사드립니다.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/I8U4273MZK)

### Ko-fi
