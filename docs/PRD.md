# 트레이딩 지표 큐레이션 마켓플레이스 PRD

## 1. 개요

### 1.1 제품명
IndicatorHub (가칭)

### 1.2 비전
암호화폐, 주식 등 트레이딩에 활용되는 차트 지표·전략·시그널을 큐레이션하고 판매하는 디지털 상품 마켓플레이스. 검증된 지표를 쉽게 발견하고 구매할 수 있는 플랫폼을 제공한다.

### 1.3 목표
- 트레이딩 지표 판매자(제작자)와 구매자를 연결하는 마켓플레이스 구축
- 지표 성과 데이터 기반의 신뢰할 수 있는 큐레이션 시스템 제공
- 카테고리·수익률·전략 유형별 맞춤 추천으로 구매 전환율 극대화

### 1.4 대상 사용자

| 페르소나 | 설명 |
|---------|------|
| 초보 트레이더 | 매매 경험이 적고, 검증된 지표/전략을 구매해 활용하고 싶은 사용자 |
| 중급 트레이더 | 자체 전략에 보조 지표를 추가하거나 새로운 시그널을 탐색하는 사용자 |
| 전업 트레이더 | 고급 퀀트 지표, 백테스트 결과가 검증된 프리미엄 전략을 찾는 사용자 |
| 지표 제작자 (판매자) | TradingView Pine Script, 바이낸스 봇 등 자체 지표를 제작·판매하려는 개발자/트레이더 |

---

## 2. 핵심 기능

### 2.1 지표 마켓플레이스
- **상품 카테고리**: 차트 지표, 매매 전략, 시그널 알림, 자동매매 봇, 교육 자료
- **자산 분류**: 암호화폐, 국내주식, 해외주식, 선물/옵션, 외환(FX)
- **지표 유형 태그**: 추세 추종, 역추세, 스캘핑, 스윙, 장기투자, 변동성, 거래량 등
- **검색 및 필터**: 카테고리, 가격대, 평점, 수익률, 지원 플랫폼별 필터링
- **정렬**: 인기순, 최신순, 평점순, 수익률순

### 2.2 상품 상세 페이지
- **지표 소개**: 설명, 스크린샷, 데모 영상
- **성과 데이터**: 백테스트 결과, 승률, 손익비, MDD, 샤프 비율 (판매자 제공)
- **지원 플랫폼**: TradingView, 바이낸스, 업비트, 키움증권 등 호환 플랫폼 표시
- **가격 및 라이선스**: 1회 구매, 월 구독, 평생 라이선스 옵션
- **리뷰 및 평점**: 구매자 리뷰, 별점, 실제 사용 후기
- **FAQ / Q&A**: 판매자-구매자 간 질의응답

### 2.3 큐레이션 시스템
- **에디터 픽**: 운영팀이 선정한 추천 지표
- **테마 컬렉션**: "비트코인 스캘핑 TOP 5", "배당주 스윙 전략 모음" 등
- **트렌드 큐레이션**: 시장 상황(상승장/하락장/횡보장)별 추천 지표
- **성과 기반 랭킹**: 최근 수익률, 구매자 만족도 기반 자동 랭킹

### 2.4 판매자 기능
- **판매자 대시보드**: 매출 현황, 판매 통계, 정산 내역
- **상품 등록**: 지표 파일 업로드, 설명 작성, 가격 설정, 미리보기 이미지/영상
- **버전 관리**: 지표 업데이트 시 기존 구매자 자동 제공
- **판매자 프로필**: 포트폴리오, 판매 실적, 구매자 평점
- **정산**: 월 단위 정산, 수수료 차감 후 출금

### 2.5 구매자 기능
- **구매 내역 관리**: 구매한 지표 목록, 다운로드, 라이선스 상태 확인
- **찜 / 위시리스트**: 관심 지표 저장
- **알림**: 찜한 지표 할인, 새 버전 출시, 신규 지표 알림
- **환불 요청**: 조건부 환불 (구매 후 7일 이내, 다운로드 미사용 시)

### 2.6 리뷰 및 신뢰 시스템
- **구매 인증 리뷰**: 실제 구매자만 리뷰 작성 가능
- **성과 인증 뱃지**: 백테스트/실거래 성과가 검증된 지표에 뱃지 부여
- **판매자 등급**: 판매량, 평점, 활동 기반 등급 시스템 (신규 → 인증 → 프리미엄)
- **신고/분쟁 처리**: 허위 성과 신고, 저작권 분쟁 처리 프로세스

---

## 3. 시스템 아키텍처

### 3.1 기술 스택

| 구분 | 기술 |
|------|------|
| Frontend (Web) | Next.js, TypeScript, Tailwind CSS |
| Backend API | NestJS, TypeScript |
| Database | PostgreSQL (메인), Redis (캐시/세션) |
| 검색 엔진 | Elasticsearch |
| 파일 저장소 | AWS S3 (지표 파일, 이미지, 영상) |
| 결제 | Toss Payments / Stripe |
| 인프라 | AWS (ECS, RDS, CloudFront) |
| CI/CD | GitHub Actions |
| 모니터링 | Datadog, Sentry |

### 3.2 시스템 구성도

```
┌─────────────────────────────────┐
│           Web App (Next.js)     │
└───────────────┬─────────────────┘
                │
         ┌──────▼──────┐
         │  API Gateway │
         │ (CloudFront) │
         └──────┬──────┘
                │
    ┌───────────┼───────────────┐
    │           │               │
┌───▼───┐ ┌────▼────┐   ┌──────▼──────┐
│ Auth  │ │  Main   │   │  Payment    │
│Service│ │  API    │   │  Service    │
└───┬───┘ └────┬────┘   └──────┬──────┘
    │          │               │
    └──────────┼───────────────┘
               │
    ┌──────────┼──────────┬──────────┐
    │          │          │          │
┌───▼────┐ ┌──▼──┐ ┌────▼────┐ ┌───▼───┐
│PostgreSQL│Redis │ │   S3    │ │ Toss  │
│        │ │     │ │ (files) │ │Payments│
└────────┘ └─────┘ └─────────┘ └───────┘
```

### 3.3 주요 API 엔드포인트

```
# 인증
POST   /api/v1/auth/signup
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh

# 사용자
GET    /api/v1/users/me
PUT    /api/v1/users/me/profile
GET    /api/v1/users/me/purchases
GET    /api/v1/users/me/wishlist

# 상품 (지표)
GET    /api/v1/products                     # 목록 (필터, 정렬, 페이지네이션)
GET    /api/v1/products/:id                 # 상세
GET    /api/v1/products/:id/reviews         # 리뷰 목록
POST   /api/v1/products/:id/reviews         # 리뷰 작성
GET    /api/v1/products/:id/download        # 다운로드 (구매자 전용)

# 큐레이션
GET    /api/v1/collections                  # 큐레이션 컬렉션 목록
GET    /api/v1/collections/:id              # 컬렉션 상세
GET    /api/v1/rankings                     # 랭킹 (카테고리별)

# 판매자
POST   /api/v1/seller/products              # 상품 등록
PUT    /api/v1/seller/products/:id          # 상품 수정
GET    /api/v1/seller/dashboard             # 판매 대시보드
GET    /api/v1/seller/settlements           # 정산 내역
PUT    /api/v1/seller/products/:id/version  # 버전 업데이트

# 결제
POST   /api/v1/payments/prepare             # 결제 준비
POST   /api/v1/payments/confirm             # 결제 승인
POST   /api/v1/payments/refund              # 환불 요청

# 위시리스트
POST   /api/v1/wishlist/:productId          # 찜 추가
DELETE /api/v1/wishlist/:productId          # 찜 삭제

# 검색
GET    /api/v1/search?q=&category=&asset=   # 통합 검색
```

---

## 4. 데이터 모델

### 4.1 핵심 엔티티

```
User
├── id (UUID)
├── email
├── nickname
├── profile_image_url
├── role (enum: buyer/seller/admin)
├── created_at
└── updated_at

SellerProfile
├── id (UUID)
├── user_id (FK → User)
├── display_name
├── bio
├── tier (enum: new/verified/premium)
├── total_sales
├── average_rating
├── bank_account (encrypted)
└── created_at

Product
├── id (UUID)
├── seller_id (FK → User)
├── title
├── description
├── category (enum: indicator/strategy/signal/bot/education)
├── asset_type (enum: crypto/domestic_stock/foreign_stock/futures/fx)
├── tags (string[])
├── thumbnail_url
├── preview_images (string[])
├── demo_video_url
├── file_url (S3, 암호화)
├── price
├── license_type (enum: onetime/monthly/lifetime)
├── supported_platforms (string[])  # tradingview, binance, upbit 등
├── backtest_data (JSON)            # 승률, 손익비, MDD, 샤프비율
├── version
├── status (enum: draft/pending_review/active/suspended)
├── download_count
├── created_at
└── updated_at

Purchase
├── id (UUID)
├── buyer_id (FK → User)
├── product_id (FK → Product)
├── payment_id (FK → Payment)
├── license_expires_at (nullable)
├── status (enum: active/expired/refunded)
└── created_at

Payment
├── id (UUID)
├── buyer_id (FK → User)
├── product_id (FK → Product)
├── amount
├── payment_method
├── pg_transaction_id
├── status (enum: pending/completed/refunded/failed)
└── created_at

Review
├── id (UUID)
├── user_id (FK → User)
├── product_id (FK → Product)
├── purchase_id (FK → Purchase)
├── rating (1-5)
├── content
└── created_at

Collection
├── id (UUID)
├── title
├── description
├── cover_image_url
├── type (enum: editor_pick/theme/trend/ranking)
├── products (FK[] → Product)
├── is_active (boolean)
└── created_at

Settlement
├── id (UUID)
├── seller_id (FK → User)
├── period_start
├── period_end
├── total_sales_amount
├── commission_amount
├── payout_amount
├── status (enum: pending/processing/completed)
└── paid_at
```

---

## 5. 비즈니스 모델

### 5.1 수익 구조

| 모델 | 설명 |
|------|------|
| 판매 수수료 | 상품 판매 금액의 20~30% 플랫폼 수수료 |
| 프리미엄 판매자 구독 | 월 29,900원 — 수수료 할인(15%), 상위 노출, 상세 분석 리포트 |
| 광고/프로모션 | 판매자 상품 상위 노출 광고 (CPC/CPM) |
| 프리미엄 구매자 구독 | 월 9,900원 — 독점 큐레이션, 할인 쿠폰, 조기 접근 |

### 5.2 수수료 구조

| 판매자 등급 | 기본 수수료 | 프리미엄 구독 시 |
|------------|-----------|----------------|
| 신규 | 30% | 20% |
| 인증 | 25% | 17% |
| 프리미엄 | 20% | 15% |

### 5.3 가격 가이드라인

| 상품 유형 | 가격 범위 (권장) |
|----------|----------------|
| 단순 지표 (1개) | 5,000 ~ 30,000원 |
| 전략 패키지 | 30,000 ~ 100,000원 |
| 시그널 구독 (월) | 10,000 ~ 50,000원 /월 |
| 자동매매 봇 | 50,000 ~ 300,000원 |
| 교육 자료 | 10,000 ~ 100,000원 |

---

## 6. 핵심 지표 (KPI)

### 6.1 성장 지표
- **MAU**: 월간 활성 사용자 수
- **신규 가입자 수**: 월별 회원가입 수
- **등록 상품 수**: 플랫폼 내 판매 중인 지표/전략 수
- **신규 판매자 수**: 월별 판매자 등록 수

### 6.2 거래 지표
- **GMV** (Gross Merchandise Volume): 월간 총 거래액
- **구매 전환율**: 상품 상세 페이지 방문 → 구매 전환 비율 (목표: 3% 이상)
- **재구매율**: 기존 구매자의 재구매 비율 (목표: 25% 이상)
- **평균 객단가**: 건당 평균 결제 금액

### 6.3 플랫폼 지표
- **판매자 활성률**: 상품 등록 후 월 1건 이상 판매가 발생하는 판매자 비율
- **리뷰 작성률**: 구매 후 리뷰 작성 비율 (목표: 15% 이상)
- **환불률**: 전체 거래 대비 환불 비율 (목표: 5% 이하)
- **평균 평점**: 전체 상품 평균 평점 (목표: 4.0 이상)

### 6.4 비즈니스 지표
- **Revenue**: 월간 수수료 수익
- **Take Rate**: GMV 대비 플랫폼 수익 비율
- **CAC**: 고객 획득 비용
- **LTV**: 고객 생애 가치

---

## 7. 마일스톤

### Phase 1: MVP (3개월)
- [ ] 사용자 인증 (회원가입/로그인/소셜 로그인)
- [ ] 상품 등록 및 관리 (판매자)
- [ ] 상품 목록 및 상세 페이지 (검색, 필터, 정렬)
- [ ] 결제 시스템 연동 (Toss Payments)
- [ ] 상품 다운로드 (구매 후)
- [ ] 기본 리뷰/평점 시스템
- [ ] 관리자 페이지 (상품 심사, 사용자 관리)

### Phase 2: 큐레이션 & 신뢰 (2개월)
- [ ] 에디터 픽 / 테마 컬렉션 큐레이션
- [ ] 판매자 등급 시스템
- [ ] 성과 인증 뱃지
- [ ] 정산 시스템 (판매자 출금)
- [ ] 위시리스트 및 알림 기능

### Phase 3: 성장 (2개월)
- [ ] 추천 엔진 (구매 이력 기반 개인화 추천)
- [ ] 판매자 프로모션 / 광고 시스템
- [ ] 트렌드 기반 자동 큐레이션
- [ ] 쿠폰/할인 시스템
- [ ] 판매자 분석 대시보드 고도화

### Phase 4: 확장 (2개월)
- [ ] 시그널 구독 상품 지원 (실시간 알림 연동)
- [ ] 커뮤니티 / Q&A 포럼
- [ ] 모바일 반응형 최적화
- [ ] 글로벌 진출 (영문 지원, Stripe 결제)
- [ ] 판매자 API (외부 연동)

---

## 8. 리스크 및 대응

| 리스크 | 영향도 | 대응 방안 |
|--------|--------|----------|
| 허위 성과 지표 등록 | 높음 | 성과 데이터 검증 프로세스 도입, 백테스트 결과 표준화, 신고 시스템 |
| 초기 판매자/상품 부족 | 높음 | 초기 판매자 수수료 면제 이벤트, 인플루언서 트레이더 섭외 |
| 저작권/지식재산 분쟁 | 중간 | 상품 등록 시 원본 확인 절차, 분쟁 처리 정책 수립 |
| 결제/환불 분쟁 | 중간 | 명확한 환불 정책 수립, 에스크로 방식 정산 |
| 금융 규제 리스크 | 높음 | 투자 자문 아닌 도구 판매로 포지셔닝, 법률 자문 확보, 면책 고지 |
| 경쟁 서비스 (해외) | 중간 | 국내 시장 특화 (국내 증권사 연동, 원화 결제), 한국어 큐레이션 차별화 |

---

## 9. 법적 고려사항

- **투자 권유 면책**: 플랫폼은 투자 자문이 아닌 도구 판매 마켓플레이스임을 명확히 고지
- **면책 조항**: 모든 상품 페이지에 "투자 손실에 대한 책임은 본인에게 있음" 고지
- **판매자 약관**: 허위 성과 데이터 게시 시 계정 정지 및 법적 책임 고지
- **개인정보 처리**: 개인정보 처리 방침 수립, 결제 정보 암호화 저장
- **전자상거래법 준수**: 통신판매업 신고, 청약 철회(환불) 정책 수립

---

## 10. 성공 기준

| 기간 | 목표 |
|------|------|
| 출시 후 3개월 | 등록 상품 200개, MAU 5,000명, 월 GMV 1,000만원 |
| 출시 후 6개월 | 등록 상품 500개, MAU 20,000명, 월 GMV 5,000만원, 활성 판매자 100명 |
| 출시 후 12개월 | 등록 상품 1,500개, MAU 80,000명, 월 GMV 2억원, 월 수수료 수익 5,000만원 |
