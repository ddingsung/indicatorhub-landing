# 청산 히트맵 대시보드 설계서

## 개요

바이낸스 선물(BTCUSDT) 실시간 청산 데이터를 수집하여 히트맵으로 시각화하는 대시보드.
Node.js 백엔드에서 WebSocket으로 데이터를 수집·집계하고, 프론트엔드에서 Canvas로 렌더링한다.

## 아키텍처

```
바이낸스 WebSocket API
  ├─ btcusdt@forceOrder (청산)
  └─ btcusdt@kline_1m  (실시간 캔들)
        │
        ▼
┌───────────────────┐
│  Node.js Server   │
│  (Express + WS)   │
│                   │
│  - 청산 이벤트 수신  │
│  - 가격대별 집계     │
│  - 타임프레임별 버킷  │
│  - 메모리 저장       │
│  - static 파일 서빙  │
└────────┬──────────┘
         │ WebSocket
         ▼
┌───────────────────┐
│  Frontend         │
│  (HTML + Canvas)  │
│                   │
│  - 히트맵 렌더링    │
│  - 캔들차트 오버레이 │
│  - 롱/숏 분리 뷰    │
│  - 타임프레임 전환   │
└───────────────────┘
```

## 백엔드 설계

### 디렉토리 구조

```
server/
├── index.js              # Express + WebSocket 서버 진입점 (static 파일 서빙 포함)
├── services/
│   ├── binance-ws.js     # 바이낸스 WebSocket 연결 및 청산/캔들 이벤트 수신
│   ├── aggregator.js     # 가격대별·타임프레임별 청산 데이터 집계
│   └── candle-feed.js    # 바이낸스 REST API로 캔들 히스토리 조회
└── package.json
```

### 바이낸스 데이터 수신 (binance-ws.js)

**청산 이벤트 스트림**: `wss://fstream.binance.com/ws/btcusdt@forceOrder`

실제 페이로드 필드 매핑:
```js
// 바이낸스 forceOrder 이벤트 구조
{
  e: 'forceOrder',
  E: 1710000000000,        // 이벤트 타임스탬프
  o: {
    s: 'BTCUSDT',          // 심볼
    S: 'SELL',             // side — SELL=롱 청산, BUY=숏 청산
    // ※ 롱 포지션이 강제 청산되면 거래소가 매도(SELL)하므로 반대
    o: 'LIMIT',            // 주문 타입
    f: 'IOC',              // Time in force
    q: '0.014',            // 원래 주문 수량
    p: '67234.50',         // 주문 가격
    ap: '67230.20',        // 평균 체결 가격 ← 이것을 사용
    X: 'FILLED',           // 주문 상태
    l: '0.014',            // 마지막 체결 수량
    z: '0.014',            // 총 체결 수량 ← 이것을 사용
    T: 1710000000123       // 체결 시간 ← 이것을 사용
  }
}

// 추출 필드 정리:
// - side:      event.o.S  (SELL=롱 청산, BUY=숏 청산)
// - price:     event.o.ap (평균 체결가, 실제 체결 기준이므로 p보다 정확)
// - quantity:  event.o.z  (총 체결 수량, 실제 체결된 양)
// - timestamp: event.o.T  (체결 시간)
```

**실시간 캔들 스트림**: `wss://fstream.binance.com/ws/btcusdt@kline_1m`
- 1분봉 실시간 데이터 수신, 더 긴 타임프레임 캔들은 1분봉으로부터 집계
- REST API(`/fapi/v1/klines`)는 서버 시작 시 히스토리 백필 용도로만 사용

**연결 관리**:
- 바이낸스 WebSocket은 24시간 후 자동 종료됨 → 23시간 시점에 선제적 재연결
- 바이낸스 서버가 3분마다 ping 전송 → `ws` 라이브러리가 pong 자동 응답 (확인 필요)
- 연결 끊김 시 지수 백오프로 재시도 (1초 → 2초 → 4초 → ... 최대 30초)
- 재연결 최대 시도: 무제한 (서버는 항상 복구 시도)

**데이터 제약 사항**:
- 바이낸스는 1000ms 내 최신 1건의 청산만 전송 (스냅샷 방식)
- 연쇄 청산 시 실제 물량보다 과소 집계될 수 있음
- 프론트엔드에 이 제약을 안내: "데이터는 거래소 제공 기준이며, 고변동 구간에서 일부 누락될 수 있습니다"

### 데이터 집계 (aggregator.js)

**인터페이스** (Phase 2에서 DB 구현체로 교체 가능):
```js
// 추상 인터페이스
addLiquidation(symbol, { side, price, quantity, timestamp })
getHeatmapData(symbol, timeframe, startTime, endTime) → buckets[]
getCandleData(symbol, timeframe, startTime, endTime) → candles[]
```

**가격 버킷 전략**:
- 버킷 폭: 현재가의 0.05% (예: BTC $67,000 → $33.5 → 반올림하여 $35 단위)
- 표시 범위: 현재가 기준 ±2% (약 80개 가격 레벨)
- 가격이 범위 밖으로 이동 시: 현재가 기준으로 범위를 슬라이딩 (기존 데이터 유지, 뷰만 이동)
- 범위 밖 가격대의 청산도 저장은 하되 렌더링에서 제외

**시간 버킷 & 보관 정책**:

| 타임프레임 | 최대 버킷 수 | 보관 기간 |
|----------|-----------|---------|
| 5m | 288 | 24시간 |
| 15m | 192 | 48시간 |
| 1h | 168 | 7일 |
| 4h | 180 | 30일 |
| 1d | 30 | 30일 |

**집계 방식**: 각 타임프레임이 raw 이벤트로부터 독립적으로 집계. 1개 청산 이벤트가 5개 타임프레임 버킷에 각각 기록됨. 단순하고 정확함.

**가격 레벨 메모리 제한**: 각 시간 버킷 내 가격 레벨은 최대 200개. 초과 시 물량이 가장 적은 레벨부터 제거.

**저장 구조**:
```js
{
  symbol: 'BTCUSDT',
  timeframe: '1h',
  buckets: [
    {
      time: 1710000000000,
      priceLevels: {
        '67000': { long: 12.5, short: 3.2 },
        '67050': { long: 0.8, short: 15.3 },
      }
    },
  ]
}
```

**서버 콜드 스타트 시**: 히트맵은 빈 상태로 시작, "데이터 수집 시작: [timestamp]" 메시지를 프론트에 전달. 바이낸스에는 과거 청산 REST API가 없으므로 백필 불가.

### WebSocket 프로토콜

모든 메시지에 `version` 필드 포함 (향후 프로토콜 변경 대응):

**서버 → 클라이언트**:
```js
// 초기 스냅샷
{ version: 1, type: 'snapshot', timeframe: '1h', heatmap: [...], candles: [...], collectingSince: timestamp }

// 실시간 청산 이벤트
{ version: 1, type: 'liquidation', side: 'long', price: 67234.5, quantity: 2.5, timestamp: ... }

// 캔들 업데이트
{ version: 1, type: 'candle_update', candle: { open, high, low, close, volume, time } }

// 서버 상태
{ version: 1, type: 'status', binanceConnected: true, collectingSince: timestamp }
```

**클라이언트 → 서버**:
```js
// 타임프레임 변경
{ type: 'subscribe', timeframe: '4h' }

// 연결 확인 (5초 간격)
{ type: 'ping' }
```

서버는 `subscribe` 메시지 수신 시 해당 타임프레임의 스냅샷을 재전송.

## 프론트엔드 설계

### 디렉토리 구조

```
client/
├── index.html            # 대시보드 페이지
├── js/
│   ├── app.js            # 진입점, WebSocket 연결
│   ├── heatmap.js        # 히트맵 Canvas 렌더러
│   ├── candlestick.js    # 캔들차트 Canvas 렌더러 (신규 작성)
│   └── controls.js       # UI 컨트롤 (타임프레임, 뷰 전환)
└── css/
    └── dashboard.css     # 스타일
```

### 화면 구성

```
┌──────────────────────────────────────────────┐
│  INDICATORHUB  청산 히트맵    BTCUSDT          │
│                                              │
│  [5m] [15m] [1h] [4h] [1d]                   │
│  차트: [히트맵|캔들+히트맵]   뷰: [전체|롱|숏]    │
│  ────────────────────────────────────────     │
│                                              │
│  67,500 ┤█████████░░░██████████░░░░░░░░      │
│  67,400 ┤██░░░░░░████████████████░░░░░░      │
│  67,300 ┤░░░░████████████████████████░░      │
│  67,200 ┤░░░░░░░░░░░████████████████░░  ← 현재가│
│  67,100 ┤░░░░████████████░░░░░░░░░░░░░      │
│  67,000 ┤██████████░░░░░░░░░░░░░░░░░░░      │
│         └──────────────────────────────      │
│          12:00  13:00  14:00  15:00  16:00   │
│                                              │
│  ────────────────────────────────────────     │
│  최근 청산  | 67,234 LONG  2.5 BTC  3초 전     │
│            | 67,189 SHORT 0.8 BTC  5초 전     │
│                                              │
│  ⓘ 데이터 수집 시작: 2026-03-12 14:00 KST     │
└──────────────────────────────────────────────┘
```

### 뷰 모드

1. **히트맵 단독**: 히트맵만 표시
2. **캔들차트 + 히트맵 오버레이**: 캔들차트 위에 히트맵을 `globalAlpha`로 중첩
3. **토글로 전환**: 상단 버튼으로 모드 전환

### 롱/숏 뷰

- **전체**: 롱+숏 합산, 단일 색상 그라디언트 (파랑→노랑→빨강)
- **롱 청산**: 롱 청산만 표시, 빨강 계열
- **숏 청산**: 숏 청산만 표시, 초록 계열

### 히트맵 렌더링

- Canvas 2D API 사용
- `requestAnimationFrame`으로 렌더링 루프 관리 (최대 30fps 제한)
- 색상 그라디언트:
  - 전체 뷰: `#0a0e1c` → `#1a3a5c` → `#f0c040` → `#ff3d3d`
  - 롱 뷰: `#1a0a0a` → `#ff3d3d`
  - 숏 뷰: `#0a1a0a` → `#00ff87`
- **색상 스케일**: 로그 스케일 사용 (`Math.log1p(volume)`)
  - 청산 물량은 멱법칙 분포를 따르므로 선형 스케일로는 대부분 셀이 어둡게 보임
  - 로그 스케일로 변환 후 현재 뷰포트의 min~max 범위로 정규화
- X축: 시간 (타임프레임에 맞춤)
- Y축: 가격대 (현재가 ±2%)
- 예상 셀 그리드: 약 80(가격) x 타임프레임별 버킷 수 → 최대 ~23,000셀
- `ImageData` 직접 조작으로 렌더링 (fillRect보다 빠름)

### 캔들차트 렌더링

- 신규 작성 (랜딩 페이지 캔들 렌더러와는 별도)
- 히트맵과 동일한 X축(시간), Y축(가격) 스케일 공유
- 오버레이 모드: 캔들 먼저 그리고, 히트맵을 `globalAlpha: 0.6`으로 위에 중첩

## 확장 포인트

이후 풀스택으로 확장 시:

| 현재 (Phase 1) | 확장 (Phase 2+) |
|---------------|----------------|
| 메모리 저장 | PostgreSQL/TimescaleDB 저장 |
| BTCUSDT 단일 | 멀티 심볼 (ETH, SOL 등) |
| HTML + Canvas | Next.js + React 전환 |
| 실시간만 | 히스토리 조회 |
| 뷰 전환만 | 가격 알림, 텔레그램 연동 |

확장 대비 설계:
- aggregator 인터페이스를 추상화 → DB 구현체로 교체 가능
- 데이터 구조에 `symbol` 필드 이미 포함 → 멀티 심볼 시 키만 추가
- WebSocket 프로토콜에 `version` 필드 → 하위 호환성 유지

## 기술 스택

| 구분 | 기술 |
|------|------|
| 런타임 | Node.js |
| HTTP 서버 | Express (static 서빙 + 향후 REST API 확장용) |
| WebSocket (서버) | ws |
| WebSocket (클라이언트) | 브라우저 내장 WebSocket |
| 시각화 | Canvas 2D API |
| 바이낸스 API | WebSocket (forceOrder, kline_1m), REST (klines) |
| 스타일 | CSS (다크 테마, 기존 랜딩 페이지 Cyber 버전 디자인 톤 활용) |
