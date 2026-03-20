# ADR-005: Intent Classification Architecture & Module Structure

## Status
Accepted

## Date
2026-03-19

## Context

Phase 5.1 3.6 E2E 스모크 테스트에서 **D 시나리오가 실패**했습니다.

```
Query: "에러율이 어떻게 돼?"
Expected: STATISTICAL intent → statsPayload.overview populated
Actual:   SEMANTIC intent → statsPayload.overview empty
```

### 근본 원인: 키워드 기반 의도 분류의 구조적 한계

현재 각 `QueryStrategy`의 `canHandle()`은 `lowerQuery.includes(keyword)` 방식으로 동작합니다.

```typescript
// StatisticalQueryStrategy.canHandle()
canHandle(query: string): boolean {
  const lowerQuery = query.toLowerCase();
  return (
    AGGREGATION_KEYWORDS.some((k) => lowerQuery.includes(k)) ||
    STATISTIC_KEYWORDS.some((k) => lowerQuery.includes(k))
  );
}
```

`"에러율이 어떻게 돼?"` 분류 과정:

| 순서 | 전략 | 결과 | 이유 |
|------|------|------|------|
| 1 | Conversational (100) | false | 대화 키워드 없음 |
| 2 | Statistical (20) | **false** | `"에러율"` ∉ `STATISTIC_KEYWORDS`. `"비율"` ∈ keywords이지만 `"에러율".includes("비율")` = false (복합어) |
| 3 | Semantic (10) | **true** | `"어떻게"` ∈ `SEMANTIC_KEYWORDS` |

이것은 단발성 누락이 아니라 구조적 문제입니다:

1. **복합어 분해 불가**: 한국어의 조사·복합어 결합("에러율", "성공률", "지연율", "처리율")을 열거할 수 없음
2. **의미 중첩(semantic overlap)**: `"어떻게"`는 통계적 질문에도, 원인 분석 질문에도 사용됨. 문맥 없이 단일 키워드로는 구분 불가
3. **유지보수 비용의 지수적 증가**: 새로운 통계 용어가 나올 때마다 키워드 목록에 한국어·영어 변형을 모두 추가해야 함

### 부차적 문제: 분류와 실행의 결합

현재 `QueryStrategy` 인터페이스는 두 가지 책임을 동시에 가집니다:

```typescript
interface QueryStrategy {
  canHandle(query, history): boolean;  // 의도 분류 (classification)
  execute(context): Promise<AnalysisResult>;  // 처리 실행 (execution)
}
```

- 분류 로직을 교체하려면 **모든 전략 클래스의 `canHandle()`을 수정**해야 함
- 키워드 → LLM → 하이브리드 전환 시 3개 전략 모두 변경 필요
- Single Responsibility Principle 위반

### 부차적 문제: 디렉토리 구조의 컨벤션 괴리

```
service/
├── strategies/
│   ├── query-strategy.interface.ts  ← 인터페이스가 구현체와 동거
│   └── ...implementations...
└── sub-services/                    ← 비표준 명칭, 이질적 관심사 혼재
    ├── query-preprocessor.service.ts
    ├── session-cache.service.ts      ← 인프라 관심사
    └── ...
```

- `QueryStrategy` **인터페이스**는 도메인 추상화인데 `service/strategies/`에 구현체와 함께 위치 → Dependency Inversion 위반
- `sub-services/`는 백엔드 컨벤션에서 비표준 용어. "sub"가 계층 종속을 암시하지만, 실제로는 독립적인 도메인 서비스들임
- `SessionCacheService`, `SemanticCacheService`는 캐시 인프라인데 service 레이어에 위치

---

## Decision

### 1) IntentClassifier 추상화 분리

`canHandle()`의 분류 로직을 전략에서 분리하여 독립 인터페이스로 추출합니다.

```
AS-IS:
  SearchService → strategy.canHandle() → strategy.execute()
  (분류와 실행이 전략 내부에 결합)

TO-BE:
  SearchService → classifier.classify() → intent로 전략 lookup → strategy.execute()
  (분류와 실행이 분리)
```

#### 인터페이스 설계

```typescript
// core/ports/in/intent-classifier.port.ts
interface IntentClassifier {
  classify(
    query: string,
    history: AnalysisResult[],
  ): Promise<ClassificationResult>;
}

interface ClassificationResult {
  intent: AnalysisIntent;
  confidence: number;  // 0.0–1.0
  reasoning?: string;  // LLM 사용 시 판단 근거
}
```

#### QueryStrategy에서 canHandle() 제거

```typescript
// 변경 후
interface QueryStrategy {
  readonly intent: AnalysisIntent;
  execute(context: QueryContext): Promise<AnalysisResult>;
}
```

`priority` 필드도 제거합니다. 전략 선택이 intent 기반 lookup으로 바뀌므로 우선순위가 불필요합니다.

### 2) Intent 분류 방식: Hybrid (LLM 우선 + 키워드 fallback)

세 가지 방식을 비교한 결과 **Option C (Hybrid)**를 선택합니다.

#### 대안 비교

| 기준 | Option A: 키워드 확장 | Option B: LLM 단독 | Option C: Hybrid |
|------|----------------------|--------------------|--------------------|
| **구현 난이도** | 낮음 | 중간 | 중간 |
| **한국어 복합어** | 근본 미해결 (열거 방식) | 해결 | 해결 |
| **의미 중첩 해소** | 불가 | 해결 | 해결 |
| **레이턴시** | ~0ms | 200–500ms 추가 | 추가 비용 없음 (기존 LLM call에 piggyback) |
| **비용** | 0 | 쿼리당 1 LLM call 추가 | 추가 비용 없음 |
| **LLM 장애 시** | 영향 없음 | 전체 분류 불가 | 키워드 fallback으로 graceful degradation |
| **유지보수** | 키워드 목록 지수적 증가 | 프롬프트 1곳 관리 | 프롬프트 + 키워드 (키워드는 fallback용으로 최소 유지) |

#### Option A 기각 이유

`STATISTIC_KEYWORDS`에 `"에러율"`, `"성공률"`, `"실패율"` 등을 추가하면 D 시나리오는 통과하지만:
- 새로운 한국어 표현이 나올 때마다 동일 작업 반복
- "어떻게"처럼 여러 의도에 걸치는 키워드를 처리할 수 없음
- 미봉책이며 근본 해결이 아님

#### Option C 선택 이유

1. **추가 LLM 호출 비용 없음**: 현재 `buildQueryContext()`에서 이미 `extractMetadata()`를 호출하고 있음. 이 프롬프트에 `intent` 필드를 추가하면 동일 호출에서 의도 분류까지 수행 가능
2. **Graceful degradation**: LLM이 intent를 반환하지 못하거나 응답 파싱 실패 시, 기존 키워드 로직으로 fallback
3. **점진적 전환**: 기존 키워드 로직을 `KeywordIntentClassifier`로 래핑 → `LLMIntentClassifier` 추가 → `HybridIntentClassifier`로 조합. 기존 동작을 깨지 않으면서 단계적 이전 가능

#### 실행 흐름 (Hybrid)

```
                           ┌──────────────────────────┐
  "에러율이 어떻게 돼?" ──→ │  HybridIntentClassifier   │
                           │                          │
                           │  1. LLM: extractMetadata  │
                           │     → intent: STATISTICAL │
                           │     → confidence: 0.92    │
                           │                          │
                           │  2. confidence ≥ 0.7?     │
                           │     → YES: use LLM result │
                           │                          │
                           │  (if LLM fails or < 0.7:  │
                           │   → keyword fallback)     │
                           └──────────┬───────────────┘
                                      │ STATISTICAL
                                      ▼
                           ┌──────────────────────────┐
                           │ StatisticalQueryStrategy  │
                           │   .execute(context)       │
                           └──────────────────────────┘
```

### 3) SearchService 흐름 변경

현재 흐름의 문제: **전략 선택이 context 빌드보다 앞**에 일어납니다.

```
AS-IS:
  1. loadHistory()
  2. selectStrategy(query, history)  ← 키워드 분류 (context 없이)
  3. buildQueryContext()             ← LLM extractMetadata (전략 선택 후)
  4. strategy.execute(context)
```

LLM 기반 분류를 도입하면, **extractMetadata()가 intent도 함께 반환**하므로 흐름이 자연스럽게 정리됩니다:

```
TO-BE:
  1. loadHistory()
  2. buildQueryContext()              ← extractMetadata + intent 동시 추출
  3. classifyIntent(context.metadata) ← metadata에서 intent 확정
  4. selectStrategy(intent)           ← intent 기반 lookup
  5. strategy.execute(context)
```

Conversational은 여전히 early return 경로로 유지합니다 (reformulation/metadata 불필요하므로). 키워드 fallback이 이 경로를 커버합니다.

### 4) QueryMetadata 확장

```typescript
// 변경 후
interface QueryMetadata {
  startTime: Date | null;
  endTime: Date | null;
  service: string | null;
  route: string | null;
  errorCode: string | null;
  hasError: boolean;
  intent?: AnalysisIntent;       // LLM이 판별한 의도
  intentConfidence?: number;     // 판별 신뢰도 (0.0–1.0)
}
```

`intent`와 `intentConfidence`는 optional로 추가합니다. LLM이 이 필드를 반환하지 않으면 `undefined`이며, HybridClassifier가 키워드 fallback을 사용합니다.

### 5) 디렉토리 구조 정규화

```
AS-IS:                              TO-BE:
service/                            service/
├── strategies/                     ├── strategies/
│   ├── query-strategy.interface.ts │   ├── semantic-query.strategy.ts
│   ├── semantic-query.strategy.ts  │   ├── statistical-query.strategy.ts
│   ├── statistical-query.strategy  │   └── conversational-query.strategy.ts
│   └── conversational-query.strat  ├── classifiers/
└── sub-services/                   │   ├── keyword-intent.classifier.ts
    ├── query-preprocessor.service  │   ├── llm-intent.classifier.ts
    ├── query-reformulation.service │   └── hybrid-intent.classifier.ts
    ├── context-compression.service └── preprocessing/
    ├── summary-enrichment.service      ├── query-preprocessor.service.ts
    ├── aggregation.service.ts          ├── query-reformulation.service.ts
    ├── session-cache.service.ts        └── context-compression.service.ts
    └── semantic-cache.service.ts
                                    core/ports/in/
                                    ├── query-strategy.port.ts   ← 인터페이스 승격
                                    └── intent-classifier.port.ts

                                    (aggregation, summary-enrichment
                                     → service/ 루트 레벨 유지)

                                    infrastructure/cache/
                                    ├── session-cache.service.ts  ← 인프라로 이동
                                    └── semantic-cache.service.ts
```

변경 원칙:

| 변경 | 이유 |
|------|------|
| `QueryStrategy` 인터페이스 → `core/ports/in/` | 추상화는 도메인 계층에 위치 (DIP) |
| `IntentClassifier` → `core/ports/in/` | 동일 원칙 |
| `sub-services/` → `preprocessing/` | 역할 기반 명명, "sub" 제거 |
| 캐시 서비스 → `infrastructure/cache/` | 캐시는 인프라 관심사 |
| `classifiers/` 신규 | 분류기 구현체 그룹핑 |

## Consequences

### 긍정적

- **D 시나리오 해결**: `"에러율이 어떻게 돼?"`가 LLM에 의해 STATISTICAL로 정확히 분류됨
- **키워드 유지보수 부담 제거**: 한국어 복합어·신조어에 대한 키워드 열거가 불필요해짐
- **SRP 달성**: 전략은 실행만, 분류기는 분류만 담당
- **교체 용이성**: `IntentClassifier` 구현체만 교체하면 분류 방식 전환 가능 (A/B 테스트, 모델 업그레이드)
- **추가 LLM 비용 없음**: 기존 `extractMetadata()` 호출에 piggyback하므로 API 호출 수 동일
- **디렉토리가 의도를 드러냄**: `classifiers/`, `preprocessing/`, `infrastructure/cache/`가 각각의 역할을 명시

### 부정적

- **파일 이동에 따른 import 경로 변경**: 기존 barrel exports(`index.ts`) 업데이트 필요. 빌드 확인 필수
- **프롬프트 의존성 증가**: intent 분류 품질이 LLM 프롬프트에 의존. 프롬프트 변경 시 분류 행동이 바뀔 수 있음
- **리팩토링 범위**: 캐시 서비스 이동, 인터페이스 이동 등 여러 파일에 걸친 변경

### 중립적

- 키워드 목록은 삭제하지 않고 `KeywordIntentClassifier`로 래핑하여 fallback으로 유지. 향후 LLM 분류가 충분히 안정되면 제거 가능
- `QueryStrategy.priority` 필드 제거는 breaking change이지만 내부 인터페이스이므로 외부 영향 없음
- 규모 증가 시 `IntentClassifier`를 별도 마이크로서비스로 추출하거나, fine-tuned 소형 모델로 교체하는 경로가 열림

### 현재 규모 적합성

| 판단 기준 | 평가 |
|-----------|------|
| 인지 부하 | 중간 — 파일 수 증가하지만 각 파일의 역할이 명확해짐 |
| 구현 비용 | 낮음 — 핵심 변경은 프롬프트 확장 + SearchService 흐름 변경 |
| 과도 설계 위험 | 낮음 — 이미 존재하는 LLM 호출에 필드 추가이며, 새로운 외부 의존 없음 |

### 규모 증가 시 변경점

- **2–3인**: `HybridIntentClassifier`의 confidence threshold 조정을 config로 외부화
- **팀 규모**: Intent 분류 전용 경량 모델 도입 (Gemma, Phi 등), `LLMIntentClassifier`의 adapter만 교체
- **MSA 전환**: Classifier를 독립 서비스로 추출, gRPC 인터페이스 제공

## Related

- ADR-003: Query Strategy Pattern for SearchService (이 ADR의 전략 패턴에서 `canHandle()` 분리)
- `backend/src/embeddings/service/search.service.ts`
- `backend/src/embeddings/service/strategies/`
- `backend/src/embeddings/core/ports/out/synthesis.port.ts`
- `backend/src/embeddings/core/dtos/query-metadata.ts`
- `backend/src/embeddings/core/value-objects/filter/statistic-keywords.ts`
- `backend/src/embeddings/core/value-objects/filter/sementic-keywords.ts`
