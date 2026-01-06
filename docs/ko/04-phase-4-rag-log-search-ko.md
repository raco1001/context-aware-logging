# Phase 4 — RAG 기반 로그 검색: 검색에서 설명으로 (Search -> Explain)

## 목표

RAG의 핵심 가치 제안인 **"검색 → 설명(Search → Explain)"**에 집중합니다. 시스템은 가공되지 않은 로그 데이터를 근거 기반의 자연어 요약으로 변환해야 합니다. **시맨틱 검색(Path B)**을 주 엔진으로 우선순위를 두며, 신뢰성을 위해 **규칙 기반 라우팅**을 사용합니다.

## 1. 멀티모달 엔진 전략 (우선순위 기반)

### Path B: 시맨틱 엔진 (주 엔진 - 높은 우선순위)

Phase 4의 핵심입니다. 관련 맥락을 찾고 이를 요약하여 합성하는 데 집중합니다.

- **워크플로우**:
  1. 자연어 질의 → **질의 전처리** (`_summary` 형식에 맞게 구조화된 형식으로 변환).
  2. 구조화된 질의 → Voyage AI 임베딩.
  3. MongoDB Atlas 벡터 검색 (`wide_events_embedded`).
  4. **Voyage AI Rerank** (`rerank-2`): 관련성을 극대화하기 위해 상위 후보들의 순위를 재조정합니다.
  5. **그라운딩 팩 (Grounding Pack)**: `requestId`를 통해 `wide_events`에서 전체 맥락을 가져옵니다.
  6. **Gemini 1.5 Flash 합성**: 제공된 그라운딩 팩을 엄격히 준수하여 답변을 생성합니다.

### Path A: 구조화된 엔진 (보조 엔진 - 템플릿 기반)

완전한 NL-to-Aggregation(자연어-집계 변환) 대신, 신뢰성을 위해 **사전 정의된 템플릿**을 사용합니다.

- **메커니즘**: 키워드(예: "p95", "count", "몇 개")를 식별하고 최적화된 MongoDB 집계(Aggregation) 템플릿에 매핑합니다.
- **가드레일**: LLM은 템플릿의 파라미터를 채우는 용도로만 사용되며, 직접 코드를 생성하지 않습니다.

### Path C: 하이브리드 엔진 (개념 증명)

- **메커니즘**: 시맨틱 검색을 통해 에러 패턴(Signature)을 식별한 후, 수동 또는 템플릿 기반으로 수치를 산출합니다.

## 2. 지능형 아키텍처: 규칙 기반 라우터 (Rule-based Router)

높은 신뢰성을 보장하기 위해 완전 자율 분류 대신 **규칙 + 폴백(Fallback)** 라우터를 채택합니다.

- **질의 모드 (QueryMode)**:
  - `SEMANTIC`: 탐색적 질문("왜...", "무슨 일이...")에 대한 기본 모드입니다.
  - `STRUCTURED`: 특정 지표 키워드("몇 개", "count", "p95", "지연 시간")에 의해 트리거됩니다.
- **우아한 성능 저하 (Graceful Degradation)**:
  > "의도 파악의 확신도가 낮을 때, 시스템은 환각(Hallucination) 섞인 답변을 내놓는 대신 가공되지 않은 로그 탐색 모드로 안전하게 전환합니다."

## 3. 그라운딩 및 합성 (Grounding & Synthesis - "Clean" Pack)

환각을 방지하기 위해 Gemini 1.5 Flash에 제공되는 맥락은 엄격하게 구조화됩니다.

```json
{
  "question": "왜 프리미엄 사용자의 결제가 실패했어?",
  "grounding_context": [
    {
      "requestId": "uuid-123",
      "summary": "Outcome: FAILED, Error: GATEWAY_TIMEOUT",
      "timestamp": "2025-12-30T..."
    }
  ],
  "instruction": "제공된 맥락에만 기반하여 답변하세요. 근거가 부족하면 '근거가 부족합니다'라고 답변하세요."
}
```

## 4. 기술 구현 단계

### 1단계: 시맨틱 엔드투엔드 (The "Big Win") - [완료]

- **파이프라인 구현**: 임베딩 -> 벡터 검색 -> **Voyage Rerank**.
- **LLM 통합 (자연어 답변용)**: 검색된 로그 그라운딩 팩을 사용한 맥락 기반 합성 (Gemini 2.5 Flash).

### 2단계: 메타데이터 기반 검색 (전처리 필터링 + 후처리 필터링) - [완료]

- **의도 기반 추출**: LLM이 질의에서 시간 범위(예: "최근 1시간", "어제"), 서비스 이름, 에러 코드, 에러 존재 여부 등을 추출합니다.
- **MongoDB 전처리 필터링 (Pre-filtering)**: 추출된 메타데이터(시간, 서비스)를 `$vectorSearch` 필터에 적용하여 노이즈를 제거하고 정확도를 높입니다.
- **후처리 필터링 (그라운딩 단계)**: 전체 로그 문서를 가져온 후, 에러 관련 필터(`hasError`, `errorCode`)를 적용하여 합성 맥락에 관련 로그만 포함되도록 합니다.

### 2.5단계: 질의 전처리 및 임베딩 전략 개선 - [완료]

- **질의 전처리**: 자연어 질의를 로그 임베딩에 사용된 `_summary` 형식과 유사한 구조화된 형식으로 변환합니다.
  - 예시: `"오늘 'payment' 서비스에서 실패한 케이스가 있어?"` → `"Outcome: FAILED, Service: payment, Error: ANY, ErrorMessage: ANY, UserRole: ANY, LatencyBucket: ANY"`
  - 이를 통해 질의와 문서가 임베딩 공간에서 유사한 구조적 표현을 갖게 되어 시맨틱 매칭 성능이 향상됩니다.
- **청킹(Chunking) 유틸리티**: 길거나 복잡한 로그 요약을 더 작고 의미 있는 단위로 나누기 위한 유틸리티를 추가했습니다 (MongoDB RAG 튜토리얼 3단계 기반).
  - 지원 전략: `chunkSummary()`, `createOverlappingChunks()`, `chunkByFields()`
  - 현재는 단일 청크 전략을 사용 중이지만(현재 `_summary` 형식이 간결함), 향후 확장을 위한 기반을 마련했습니다.

### 2.6단계: 이중 레이어 요약 전략 - [완료]

- **이중 레이어 요약**: 결정론적 표준 신호와 가벼운 서술형 문장을 결합하는 업계 표준 접근 방식을 구현합니다.
  - **서술 레이어 (Narrative Layer)**: 템플릿 기반의 자연어 문장 (예: "A premium user experienced a payment failure during checkout due to GATEWAY_TIMEOUT.")
    - 자연어 질의 매칭을 위한 "언어적 표면" 제공
    - LLM 없이 결정론적으로 생성 (재현성 유지)
  - **표준 레이어 (Canonical Layer)**: 구조화된 필드 기반 형식 (예: "Outcome: FAILED, Service: payments, Route: /payments/checkout, ...")
    - 통계, 집계 및 필터링을 위한 안정적인 시맨틱 축 제공
  - **결합 형식**: `{narrative}\n\n{canonical}` - 두 레이어를 함께 임베딩
  - **이점**:
    - 자연어 질의 매칭 성능 향상 ("실패", "결제", "프리미엄" 등의 키워드가 직접 노출됨)
    - 필터링 및 집계를 위한 구조화된 정보 보존
    - 결정론적이며 재현 가능함 (수집 시 추론 없음)
- **그라운딩 필드**: 정확한 출처 조회를 위해 `wide_events_embedded` 컬렉션에 `requestId`와 `timestamp`를 추가했습니다.
  - 원본 `wide_events` 문서로의 정밀한 연결 가능
  - 추적 가능성 및 근거 기반 답변 지원

### 3단계: 대화형 RAG (멀티턴 맥락 유지) - [완료]

- **질의 재구성 (Query Reformulation)**: LLM이 대화 기록을 바탕으로 사용자의 최신 질문을 다시 작성합니다 (예: "왜 실패했어?" -> "사용자 user-123의 결제가 왜 실패했어?").
- **세션 관리**: 여러 상호작용 간에 상태를 유지하기 위해 `chat_history` 컬렉션을 활용합니다.
- **SessionCacheService**: TTL(기본 30분)이 설정된 인메모리 세션 기록 캐싱.
- **ContextCompressionService**: 중요한 맥락을 보존하면서 토큰 사용량을 줄이기 위해 긴 대화 기록을 압축합니다.

### 4단계: 지표 엔진 및 템플릿 (Path A 완성) - [완료]

- **템플릿 레지스트리**: 일반적인 지표(P95 지연 시간, 경로별 에러 수 등)를 위해 최적화된 MongoDB 집계 파이프라인 라이브러리를 구축합니다.
- **파라미터 매핑**: LLM을 사용하여 자연어 엔티티를 템플릿 파라미터에 매핑합니다 (예: "체크아웃" -> `{ route: "/payments/checkout" }`).
  - `route-pattern-constants.ts` 활용
- **LLM 기반 통계 분석**: `analyzeStatisticalQuery()` 메서드를 통해 자연어 질의에서 템플릿 ID와 파라미터를 추출합니다.
- **고급 지표**: P50, P95, P99 지연 시간 분석 템플릿을 지원합니다.

### 5단계: 신뢰성 및 성능 강화 - [완료]

- **그라운딩 검증 (Grounding Verification)**: 최종 출력 전 LLM이 자신의 답변을 그라운딩 팩과 대조하여 검증하는 "팩트 체크" 단계를 구현합니다.
  - `SynthesisPort` 인터페이스의 `verifyGrounding()` 메서드
  - 검증 상태: `VERIFIED`(검증됨), `PARTIALLY_VERIFIED`(부분 검증됨), `NOT_VERIFIED`(검증되지 않음)
  - 액션 처리: `REJECT_ANSWER`(답변 거부), `ADJUST_CONFIDENCE`(신뢰도 조정), `KEEP_ANSWER`(답변 유지)
  - 검증 결과에 따른 신뢰도 조정 및 모니터링을 위한 미검증 주장 로깅
- **시맨틱 캐싱 (Semantic Caching)**: 유사한 질문에 즉시 답변하기 위해 벡터 질의 결과를 캐싱하여 API 비용과 지연 시간을 줄입니다.
  - 코사인 유사도 기반의 캐시 히트 감지를 수행하는 `SemanticCacheService` (임계값: 0.95)
  - TTL 관리: 기본 1시간, 시간 범위 질의의 경우 15분
  - 시간 정규화를 포함한 메타데이터 기반 캐시 키 생성
  - 만료된 항목의 주기적 정리 (10분마다)

## 5. 성공 기준

1. **근거 기반**: 모든 답변에는 원본 로그에 대한 직접적인 인용이 최소 2-3개 포함되어야 합니다.
2. **환각 제어**: 로그 맥락을 벗어난 질의에 대해 시스템이 "정보 부족"을 올바르게 식별해야 합니다.
3. **추적 가능성**: 사용자가 AI 답변에서 직접 `requestId`를 클릭하거나 참조할 수 있어야 합니다.
4. **모듈성**:
   > "Voyage AI는 검색 및 재순위화(Reranking)에만 집중적으로 사용됩니다. 합성(Synthesis)은 모듈성 유지를 위해 별도의 LLM(Gemini)이 담당합니다."

---

## 단계 간 경계: Phase 5로 이동

Phase 4는 **사후 대응적 통찰 (Reactive Insight)** (인간의 질문에 사실로 답변)을 제공합니다.

