# ADR-002: Logging Module Performance Optimization

## Status
Accepted

## Date
2026-02-02

## Context

로깅 모듈의 성능 병목 지점을 분석하고 개선하여 고부하 환경에서도 안정적으로 동작하도록 합니다.

### 식별된 병목 지점

1. **MongoDB 동기 Insert**: 매 요청마다 개별 insert 수행
2. **Reflector 반복 조회**: 동일 핸들러에 대해 매 요청마다 메타데이터 조회
3. **Set 기반 중복 방지**: FIFO가 보장되지 않아 메모리 누수 가능
4. **무제한 동시 finalize**: 고부하 시 시스템 과부하 가능

---

## Decision

### 1. MongoDB 배치 쓰기 (Batch Write)

**파일**: `libs/logging/infrastructure/mongodb/mongo.logger.ts`

#### Before

```typescript
async log(event: WideEvent, ...): Promise<void> {
  await this.mongoConnectionClient
    .getCollection(this.collectionName)
    .insertOne(document);
}
```

- 매 요청마다 MongoDB에 개별 insert
- I/O 오버헤드 높음
- 네트워크 라운드트립 비용

#### After

```typescript
private readonly buffer: Document[] = [];
private readonly batchSize: number;        // default: 50
private readonly flushIntervalMs: number;  // default: 1000ms

async log(event: WideEvent, ...): Promise<void> {
  this.buffer.push(document);
  
  if (this.buffer.length >= this.batchSize) {
    await this.flush();
  }
}

private async flush(): Promise<void> {
  const toWrite = this.buffer.splice(0, this.buffer.length);
  await collection.insertMany(toWrite, { ordered: false });
}
```

**개선 효과**:
| 지표 | Before | After |
|------|--------|-------|
| MongoDB 호출 수 (100 req) | 100회 | 2회 |
| 네트워크 라운드트립 | O(n) | O(n/batchSize) |
| 쓰기 지연 | 0ms | 최대 1000ms |

**설정 옵션**:
- `LOG_BATCH_SIZE`: 배치 크기 (default: 50)
- `LOG_FLUSH_INTERVAL_MS`: 주기적 플러시 간격 (default: 1000ms)

---

### 2. Reflector 메타데이터 캐싱

**파일**: `libs/logging/presentation/logging.interceptor.ts`

#### Before

```typescript
intercept(context: ExecutionContext, next: CallHandler) {
  // 매 요청마다 6+ 번의 Reflector 조회
  const noLog = this.reflector.get(NO_LOG_KEY, handler) || 
                this.reflector.get(NO_LOG_KEY, controller);
  const serviceName = this.reflector.get(SERVICE_KEY, handler) || ...;
  const userConfig = this.reflector.get(LOG_USER_KEY, handler) || ...;
  // ... 계속 반복
}
```

- 동일 핸들러에 대해 매번 Map lookup 수행
- 요청 수에 비례하여 조회 횟수 증가

#### After

```typescript
interface HandlerMetadata {
  noLog: boolean;
  serviceName: string | null;
  userConfig: LogUserConfig | null;
  // ... 모든 메타데이터
}

private readonly metadataCache = new WeakMap<Function, HandlerMetadata>();

private getHandlerMetadata(handler: Function, controller: Function): HandlerMetadata {
  let cached = this.metadataCache.get(handler);
  if (!cached) {
    cached = { /* 모든 Reflector 조회 한 번에 수행 */ };
    this.metadataCache.set(handler, cached);
  }
  return cached;
}
```

**개선 효과**:
| 지표 | Before | After |
|------|--------|-------|
| Reflector 조회 (첫 요청) | 12+ 회 | 12+ 회 |
| Reflector 조회 (이후 요청) | 12+ 회 | 0 회 |
| 메모리 | - | WeakMap (GC 가능) |

---

### 3. LRU 캐시로 중복 방지

**파일**: `libs/logging/service/logging.service.ts`

#### Before

```typescript
private finalizedRequestIds = new Set<string>();

// 1000개 초과 시 앞에서 100개 삭제 (FIFO 보장 안됨)
if (this.finalizedRequestIds.size > 1000) {
  const idsToRemove = Array.from(this.finalizedRequestIds).slice(0, 100);
  idsToRemove.forEach((id) => this.finalizedRequestIds.delete(id));
}
```

- Set 순회 순서는 삽입 순서지만 명시적 FIFO 아님
- `slice(0, 100)`은 가장 오래된 것을 삭제한다는 보장 없음
- 불규칙한 메모리 관리

#### After

```typescript
class LRUCache<K, V> {
  private cache = new Map<K, V>();  // Map은 삽입 순서 보장

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);  // 순서 갱신
    }
    this.cache.set(key, value);
    
    // 초과 시 가장 오래된 항목 제거
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }
}

private readonly finalizedRequestIds = new LRUCache<string, true>(2000);
```

**개선 효과**:
| 지표 | Before | After |
|------|--------|-------|
| 최대 메모리 | 무제한 (1000+) | 고정 (configurable) |
| 삭제 정책 | 불규칙 | LRU (가장 오래된 것 먼저) |
| 삭제 시 복잡도 | O(100) | O(1) |

**설정 옵션**:
- `LOG_FINALIZED_CACHE_SIZE`: 캐시 크기 (default: 2000)

---

### 4. Backpressure 메커니즘

**파일**: `libs/logging/service/logging.service.ts`

#### Before

```typescript
// 무제한 동시 finalize 허용
this.loggingUseCase.finalize(loggingContext).catch(() => {});
```

- 고부하 시 메모리에 pending promise 누적
- 시스템 불안정 유발 가능

#### After

```typescript
private pendingFinalizeCount = 0;
private readonly maxPendingFinalizes: number;  // default: 500
private droppedCount = 0;

async finalize(explicitContext?: LoggingContext): Promise<void> {
  // Backpressure: 임계치 초과 시 드롭
  if (this.pendingFinalizeCount >= this.maxPendingFinalizes) {
    this.droppedCount++;
    if (this.droppedCount % 100 === 1) {
      this.serviceLogger.warn(`Backpressure active: dropped ${this.droppedCount} entries`);
    }
    return;
  }

  this.pendingFinalizeCount++;
  try {
    await this.logger.log(event, enrichedMetadata, _summary);
  } finally {
    this.pendingFinalizeCount--;
  }
}
```

**개선 효과**:
| 지표 | Before | After |
|------|--------|-------|
| 최대 pending | 무제한 | 고정 (configurable) |
| 과부하 시 동작 | 시스템 불안정 | 우아한 저하 (graceful degradation) |
| 관측 가능성 | 없음 | droppedCount 메트릭 |

**설정 옵션**:
- `LOG_MAX_PENDING_FINALIZES`: 최대 동시 finalize 수 (default: 500)

---

## Consequences

### 긍정적

- **I/O 효율성**: MongoDB 배치 쓰기로 네트워크 호출 90%+ 감소
- **CPU 효율성**: Reflector 캐싱으로 반복 조회 제거
- **메모리 안정성**: LRU 캐시로 바운딩된 메모리 사용
- **시스템 안정성**: Backpressure로 과부하 시 우아한 저하
- **관측 가능성**: 각 컴포넌트에 모니터링 메트릭 추가
- **성능 개선**: 5 개 단위의 서비스 로직 요청에 로그데이터에 대해
  - 개선 전: 27 ~ 214ms
  - 개선 후: < 1ms


### 부정적

- **쓰기 지연**: 배치 쓰기로 최대 1초 지연 (configurable)
- **데이터 손실 가능**: 서버 크래시 시 버퍼 내 로그 손실
  - 해결책: 짧은 flush 간격 또는 shutdown hook에서 flush
- **로그 드롭**: Backpressure 활성화 시 일부 로그 손실
  - 해결책: 드롭 카운트 모니터링 및 알림 설정

### 중립적

- 새로운 환경변수 추가 (기본값 제공)

---

## Configuration Summary

| 환경변수 | 기본값 | 설명 |
|---------|--------|------|
| `LOG_BATCH_SIZE` | 50 | MongoDB 배치 크기 |
| `LOG_FLUSH_INTERVAL_MS` | 1000 | 주기적 플러시 간격 (ms) |
| `LOG_FINALIZED_CACHE_SIZE` | 2000 | 중복 방지 LRU 캐시 크기 |
| `LOG_MAX_PENDING_FINALIZES` | 500 | 최대 동시 finalize 수 |

---

## Monitoring

각 컴포넌트에서 제공하는 모니터링 메서드:

```typescript
// MongoLogger
mongoLogger.getBufferStats();
// { bufferSize: number, batchSize: number }

// LoggingService
loggingService.getStats();
// { cacheSize, maxCacheSize, pendingFinalizes, maxPendingFinalizes, droppedCount }

// FinalizeMetrics
finalizeMetrics.getStats();
// { successCount, failureCount, lastError, successRate }
```

---

## Related

- `libs/logging/infrastructure/mongodb/mongo.logger.ts`
- `libs/logging/presentation/logging.interceptor.ts`
- `libs/logging/service/logging.service.ts`
- `libs/logging/core/domain/finalize.metrics.ts`
