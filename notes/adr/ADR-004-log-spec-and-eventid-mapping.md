# ADR-004: Log Spec (Single Source of Truth) & eventId Mapping

## Status
Accepted

## Date
2026-03-18

## Context

Phase 5.1의 목표는 semantic log search 파이프라인 전체에서 **데이터 일관성**을 보장하는 것입니다.

현재는 동일한 “로그 스키마”가 여러 곳에 중복 정의되어 drift가 발생할 수 있습니다.

- 도메인 모델: `WideEvent` (`backend/libs/logging/core/domain/wide-event.ts`)
- DB validators / index: `mongodb-init.js` (`docker/mongo/mongodb-init.js`)
- Embedding 저장/검색: `MongoLogStorageAdapter` (`backend/src/embeddings/infrastructure/repository/mongodb/mongo-log-storage.adapter.ts`)

또한, embedding 문서의 `eventId`가 raw 로그와 어떻게 join 되는지(어떤 필드를 기준으로 삼는지)가 명확히 고정되어야 합니다.

## Decision

### 1) Canonical Log Spec의 단일 기준

**단일 기준(Log Spec)은 contracts로 관리**합니다.

- Canonical source: `backend/src/contracts/log-spec.ts`
- 원칙: contracts는 **순수 TypeScript**(decorator/프레임워크 의존 없음)로 유지합니다.
- DB validators(`mongodb-init.js`)는 **secondary**이며, 현 스케일에서는 contracts와의 동기화를 **수동**으로 유지합니다.

### 2) Canonical timestamp 타입

`timestamp`의 canonical 타입은 **`Date`**로 고정합니다.

- 이유: `wide_events`는 MongoDB time-series이며 `timeField: "timestamp"`로 운영됩니다.
- 결과: 로그 생성/전송/저장 파이프라인에서 `timestamp`를 string로 취급하며 발생하는 혼용을 제거합니다.

### 3) eventId 매핑 규약 (Primary Join Key)

Embedding 문서의 `eventId`는 다음과 같이 고정합니다.

- **`wide_events._id (ObjectId)` ↔ `wide_events_embedded.eventId (ObjectId)`**

즉,

- Raw logs: `wide_events` 컬렉션에서 각 문서의 primary identifier는 `_id`(ObjectId)
- Embeddings: `wide_events_embedded.eventId`는 raw `_id`를 그대로 복사하여 저장

#### requestId의 역할

`requestId`는 join의 보조 키(grounding / convenience)로 유지합니다.

- embedding 문서에 `requestId`를 저장할 수는 있지만, **정합성의 기준(primary join key)** 은 `eventId`입니다.

### 4) Error code taxonomy (현재 단계 규약)

현 단계에서는 error code를 단일 enum으로 강제하기보다, **문자열 기반 규약**을 채택합니다.

- Canonical type: `LogErrorCode = string`
- 권장 규칙:
  - 전역 오류: `AUTH_*`, `SYSTEM_*` 등 prefix 기반
  - 도메인 오류: `PAYMENT_*` 등 도메인 prefix 기반
  - 외부 시스템 코드가 존재하면 그대로 저장 가능(단, casing/format 규칙은 후속 단계에서 정규화)

### 5) Wide Event 구조: Pattern A (Enriched Flat Event)

하나의 HTTP 요청이 내부적으로 여러 단계(balanceCheck → gateway → orderConfirmation)를 거칠 때, 그 맥락을 어떻게 로그에 담을지 세 가지 패턴을 검토하고 **Pattern A**를 선택했습니다.

#### 검토한 패턴 비교

| 기준 | Pattern A: Enriched Flat | Pattern B: Per-hop Spans | Pattern C: Embedded Arrays |
|------|--------------------------|--------------------------|---------------------------|
| **구조** | 1 요청 = 1 이벤트, step 정보를 flat 필드로 | 1 step = 1 이벤트, traceId로 연결 | 1 요청 = 1 이벤트, `events: []`, `errors: []` 배열 |
| **쿼리 성능** | 최고 — 단순 인덱스 조회 | 좋음 — traceId join 필요 | 나쁨 — `$elemMatch` / `$unwind` 필요 |
| **임베딩 호환성** | 좋음 — `toSummary()`가 결정론적 | 중간 — span별 summary 필요 | 나쁨 — 가변 길이 배열로 summary 불안정 |
| **time-series 효율** | 최고 — 문서 크기 일정 | 좋음 — span당 일정 | 나쁨 — 문서 크기가 step 수에 비례 |
| **집계/대시보드** | 단순 — `$match` + `$group` | join 필요 — `$lookup` | 복잡 — `$unwind` → `$match` → `$group` |
| **적합 규모** | 모놀리스, 소규모 | 실제 MSA (서비스 분리 배포) | 거의 사용되지 않음 |
| **실무 채택** | Honeycomb, Datadog 표준 | OpenTelemetry / Jaeger 표준 | 거의 안 씀 |

#### Pattern A 선택 이유

1. **현재 아키텍처에 적합**: `payments`, `paymentGateway`, `orders`가 동일 NestJS 프로세스 내에 존재. 네트워크 경계가 없으므로 per-hop span(Pattern B)은 과도함.
2. **벡터 서치/RAG 파이프라인 친화**: `toSummary()`의 결정론적 직렬화가 flat 구조에서만 안정적으로 동작. 배열이 들어가면 길이/순서에 따라 임베딩 품질이 불안정해짐.
3. **쿼리 단순성**: `failedAt = 'paymentGateway'`로 인덱스 한 번에 "게이트웨이에서 실패한 요청" 조회 가능. 배열 구조에서는 `$unwind` 필수.
4. **문서 크기 예측 가능**: time-series 컬렉션은 문서 크기가 일정할 때 압축 효율이 높음. Step 수가 고정이므로 flat 필드 추가는 크기를 일정하게 유지.

#### Pattern B로 전환할 시점

- `paymentGateway`가 별도 서비스로 분리되어 각자 로그를 남길 때
- 네트워크 경계를 넘는 hop이 생길 때
- 한 요청이 10개 이상의 서비스를 거칠 때 (flat 차원이 과도해짐)

#### Pattern A에서 추가할 enrichment 필드

현재 `WideEvent`가 놓치고 있는 multi-step 맥락을 flat 차원으로 승격:

| 필드 | 타입 | 설명 | 파생 원천 |
|------|------|------|-----------|
| `failedAt` | `string?` | 실패가 발생한 처리 단계 | `PaymentResult.errorService` |
| `stepsReached` | `number?` | 전체 단계 중 완료된 단계 수 | Response 구조에서 추론 |
| `performance.balanceCheckMs` | `number?` | 잔고 확인 소요 시간 | Step별 계측 |
| `performance.gatewayMs` | `number?` | 게이트웨이 호출 소요 시간 | `PaymentResult.gatewayProcessingTimeMs` |
| `performance.orderConfirmationMs` | `number?` | 주문 확인 소요 시간 | Step별 계측 |

이 필드들은 `@LogResponseMeta`를 통해 response에서 추출 → interceptor에서 `LoggingContext`로 승격하는 방식으로 구현합니다.

## Consequences

### 긍정적

- **스키마 drift 감소**: 계약(contracts) 중심으로 단일 정의가 생김
- **파이프라인 정합성 강화**: embedding ↔ raw log join 규약이 고정되어, vector search 결과를 안정적으로 원문 로그로 해석 가능
- **time-series 친화성**: `timestamp: Date`로 정리되어 MongoDB time-series 사용 전제와 맞아짐
- **Multi-step 가시성**: `failedAt`, step-level duration 등 flat 차원 추가로 "어떤 단계에서 왜 실패했는지"를 쿼리/임베딩 양쪽에서 활용 가능

### 부정적

- `mongodb-init.js` validator와 contracts는 자동 파생이 아니라 **수동 동기화 부담**이 남음
- Pattern A의 flat 필드는 도메인(payments)에 특화된 이름(`gatewayMs`, `failedAt`)을 가지므로, 새로운 도메인이 추가될 때마다 필드 설계가 필요

### 중립적

- 스케일 증가 시(여러 서비스/여러 개발자)에는 contracts → JSON Schema/DB validator 자동 생성 + CI drift check로 확장할 수 있음
- MSA 전환 시 Pattern B(OpenTelemetry spans)로 마이그레이션하되, Pattern A 이벤트는 span의 root summary로 재활용 가능

## Related

- `backend/src/contracts/log-spec.ts`
- `backend/libs/logging/core/domain/wide-event.ts`
- `backend/libs/logging/presentation/logging.interceptor.ts`
- `backend/libs/logging/infrastructure/mongodb/mongo.logger.ts`
- `backend/src/embeddings/infrastructure/repository/mongodb/mongo-log-storage.adapter.ts`
- `backend/src/payments/service/payments.service.ts`
- `backend/src/payments/core/value-objects/payment-status.vo.ts`
- `docker/mongo/mongodb-init.js`

