# ADR-003: Query Strategy Pattern for SearchService

## Status
Accepted

## Date
2026-02-02

## Context

`SearchService`는 RAG(Retrieval-Augmented Generation) 검색의 핵심 서비스로, 쿼리 유형에 따라 다른 처리 파이프라인을 실행합니다.

### 기존 문제점

```typescript
// 기존 SearchService.ask() - 600+ lines
async ask(query: string, sessionId?: string): Promise<AnalysisResult> {
  const intent = this.classifyIntent(query);
  
  if (intent === AnalysisIntent.CONVERSATIONAL) {
    // 50+ lines of conversational handling
  }
  
  if (intent === AnalysisIntent.STATISTICAL) {
    return await this.handleStatisticalQuery(...);  // 150+ lines
  }
  
  return await this.handleSemanticQuery(...);  // 200+ lines
}
```

**문제점**:

1. **OCP 위반**: 새로운 Intent 추가 시 `ask()` 메서드 수정 필요
2. **단일 책임 위반**: SearchService가 조율과 처리 로직 모두 담당
3. **테스트 어려움**: 전략별 독립 테스트 불가능
4. **코드 복잡도**: 600+ lines의 거대 클래스

### 대안 검토

| 대안 | 장점 | 단점 |
|------|------|------|
| if-else 유지 | 단순함 | OCP 위반, 확장 어려움 |
| Strategy 패턴 | OCP 준수, 테스트 용이 | 초기 구조 복잡 |
| State 패턴 | 상태 전이 명확 | 이 문제에 부적합 (상태 전이 없음) |

**Strategy 선택 이유**: 쿼리 처리는 "입력에 따른 알고리즘 선택" 문제이며, 상태 전이가 없음.

## Decision

### Strategy 패턴 적용

```
┌─────────────────────────────────────────────────────────────┐
│                      SearchService                           │
│                    (Orchestrator)                            │
├─────────────────────────────────────────────────────────────┤
│  ask(query, sessionId)                                       │
│    ├── loadHistory()                                         │
│    ├── selectStrategy()  ← 우선순위 기반 선택                │
│    ├── buildQueryContext()                                   │
│    └── strategy.execute(context)  ← 위임                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     QueryStrategy[]                          │
├─────────────────────────────────────────────────────────────┤
│  ConversationalQueryStrategy  (priority: 100)                │
│  StatisticalQueryStrategy     (priority: 20)                 │
│  SemanticQueryStrategy        (priority: 10)                 │
└─────────────────────────────────────────────────────────────┘
```

### 핵심 인터페이스

```typescript
// service/strategies/query-strategy.interface.ts

interface QueryContext {
  readonly originalQuery: string;
  readonly reformulatedQuery: string;
  readonly isStandalone: boolean;
  readonly metadata: QueryMetadata;
  readonly history: AnalysisResult[];
  readonly sessionId?: string;
  readonly targetLanguage: 'Korean' | 'English';
}

interface QueryStrategy {
  readonly intent: AnalysisIntent;
  readonly priority: number;
  
  canHandle(query: string, history: AnalysisResult[]): boolean;
  execute(context: QueryContext): Promise<AnalysisResult>;
}
```

### 파일 구조

```
src/embeddings/service/
├── search.service.ts          # 조율만 담당 (~250 lines)
├── strategies/
│   ├── index.ts
│   ├── query-strategy.interface.ts
│   ├── semantic-query.strategy.ts
│   ├── statistical-query.strategy.ts
│   └── conversational-query.strategy.ts
└── sub-services/              # 기존 유지
```

### 전략 선택 로직

```typescript
// SearchService
private selectStrategy(query: string, history: AnalysisResult[]): QueryStrategy {
  // 우선순위 순으로 정렬된 전략 배열에서 첫 번째 매칭 선택
  for (const strategy of this.sortedStrategies) {
    if (strategy.canHandle(query, history)) {
      return strategy;
    }
  }
  return this.defaultStrategy;  // SemanticQueryStrategy
}
```

### DI 구성

```typescript
// embeddings.module.ts
{
  provide: QUERY_STRATEGIES,
  useFactory: (
    semantic: SemanticQueryStrategy,
    statistical: StatisticalQueryStrategy,
    conversational: ConversationalQueryStrategy,
  ) => [semantic, statistical, conversational],
  inject: [
    SemanticQueryStrategy,
    StatisticalQueryStrategy,
    ConversationalQueryStrategy,
  ],
}
```

## Consequences

### 긍정적

- **OCP 준수**: 새 Intent 추가 시 Strategy 클래스만 생성
  ```typescript
  // 새 Intent 추가 예시
  @Injectable()
  export class SequentialQueryStrategy implements QueryStrategy {
    readonly intent = AnalysisIntent.SEQUENTIAL;
    readonly priority = 15;
    // ...
  }
  // SearchService 수정 불필요!
  ```

- **테스트 용이**: 각 전략 독립 단위 테스트 가능
  ```typescript
  describe('SemanticQueryStrategy', () => {
    it('should handle semantic keywords', () => {
      expect(strategy.canHandle('why did this fail?', [])).toBe(true);
    });
  });
  ```

- **코드 분리**: SearchService 600+ → 250 lines

- **A/B 테스트 가능**: 런타임 전략 교체 용이

### 부정적

- **초기 복잡도**: 파일 수 증가 (1개 → 5개)
- **학습 곡선**: Strategy 패턴 이해 필요

### 중립적

- **인터페이스 vs 클래스**: 런타임 검증 불필요하여 interface 사용
  - YAGNI 원칙에 따라 class-validator 미적용
  - 필요 시 class로 전환 가능

## Before/After 비교

### Before: if-else 분기

```typescript
// SearchService.ask() - 단일 거대 메서드
async ask(query: string, sessionId?: string): Promise<AnalysisResult> {
  const intent = this.classifyIntent(query);
  
  if (intent === AnalysisIntent.CONVERSATIONAL) {
    // 인라인 처리 로직 50+ lines
    if (history.length === 0) {
      return { answer: "No history", ... };
    }
    const { answer } = await this.synthesisPort.synthesize(...);
    return { ... };
  }
  
  // 공통 전처리
  const reformulatedQuery = await this.queryReformulation.reformulateQuery(...);
  const metadata = await this.synthesisPort.extractMetadata(...);
  
  if (intent === AnalysisIntent.STATISTICAL) {
    return await this.handleStatisticalQuery(...);  // private 메서드
  }
  
  return await this.handleSemanticQuery(...);  // private 메서드
}

private async handleSemanticQuery(...): Promise<AnalysisResult> {
  // 200+ lines
}

private async handleStatisticalQuery(...): Promise<AnalysisResult> {
  // 150+ lines
}
```

**특징**:
- 모든 로직이 한 클래스에 집중
- Intent 추가 시 ask() 수정 필요
- 전략별 독립 테스트 불가

### After: Strategy 패턴

```typescript
// SearchService.ask() - 조율만 담당
async ask(query: string, sessionId?: string): Promise<AnalysisResult> {
  const history = await this.loadHistory(sessionId);
  const strategy = this.selectStrategy(query, history);
  
  if (strategy.intent === AnalysisIntent.CONVERSATIONAL) {
    const context = this.buildConversationalContext(query, history, sessionId);
    return strategy.execute(context);
  }
  
  const context = await this.buildQueryContext(query, history, sessionId);
  return strategy.execute(context);
}

// 각 전략이 자신의 로직을 캡슐화
@Injectable()
export class SemanticQueryStrategy implements QueryStrategy {
  async execute(context: QueryContext): Promise<AnalysisResult> {
    // 해당 전략의 전체 파이프라인
  }
}
```

**특징**:
- SearchService는 조율만 담당
- 각 전략이 독립적으로 캡슐화
- 새 Intent 추가 시 SearchService 수정 불필요

### 정량적 비교

| 지표 | Before | After |
|------|--------|-------|
| SearchService LOC | 632 | 255 |
| 파일 수 | 1 | 5 |
| 새 Intent 추가 시 수정 파일 | 1 (SearchService) | 1 (새 Strategy) + 1 (Module) |
| 단위 테스트 독립성 | 낮음 | 높음 |
| OCP 준수 | ❌ | ✅ |

## Related

- `backend/src/embeddings/service/search.service.ts`
- `backend/src/embeddings/service/strategies/`
- `backend/src/embeddings/embeddings.module.ts`
- `backend/src/embeddings/core/value-objects/filter/analysis-intent-keyword.ts`
