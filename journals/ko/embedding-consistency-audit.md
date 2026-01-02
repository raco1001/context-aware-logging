# 임베딩-쿼리 정합성 검수 리포트

## 검수 일시

2025-01-01

## 검수 목적

임베딩 단계에서 생성한 벡터와 쿼리 단계에서 변환한 벡터가 vector search에서 정합성이 있는지 확인

---

## 1. 모델 일관성 검증

### ✅ 모델 사용 일관성

- **문서 임베딩**: `VoyageAdapter.createBatchEmbeddings()` → `voyageClient.getModelName()` 사용
- **쿼리 임베딩**: `VoyageAdapter.createEmbedding()` → `voyageClient.getModelName()` 사용
- **결과**: ✅ **동일한 모델 사용** (기본값: `voyage-3-lite`)

### 모델 설정

```typescript
// VoyageClient에서 단일 모델 인스턴스 사용
this.model = configService.get<string>("EMBEDDING_MODEL") || "voyage-3-lite";
```

**결론**: 모델 일관성 ✅ **양호**

---

## 2. 형식 일관성 검증

### 문서 형식 (\_summary)

```typescript
// LoggingService.generateSummary()
`Outcome: ${outcome}, Service: ${service}, Route: ${route}, Error: ${errorCode}, ErrorMessage: ${errorMessage}, UserRole: ${userRole}, LatencyBucket: ${latencyBucket}`;
```

**예시**:

```
Outcome: FAILED, Service: payments, Route: /payments/checkout, Error: GATEWAY_TIMEOUT, ErrorMessage: Connection timeout, UserRole: PREMIUM, LatencyBucket: P_OVER_1000MS
```

### 쿼리 형식 (전처리된 쿼리)

```typescript
// QueryPreprocessorService.preprocessQuery()
`Outcome: ${outcome}, Service: ${service}, Route: ANY, Error: ${errorCode}, ErrorMessage: ${errorMessage}, UserRole: ${userRole}, LatencyBucket: ${latencyBucket}`;
```

**예시**:

```
Outcome: FAILED, Service: payment, Route: ANY, Error: ANY, ErrorMessage: ANY, UserRole: ANY, LatencyBucket: ANY
```

### 필드 순서 비교

| 순서 | 문서 필드     | 쿼리 필드     | 일치 여부 |
| ---- | ------------- | ------------- | --------- |
| 1    | Outcome       | Outcome       | ✅        |
| 2    | Service       | Service       | ✅        |
| 3    | Route         | Route         | ✅        |
| 4    | Error         | Error         | ✅        |
| 5    | ErrorMessage  | ErrorMessage  | ✅        |
| 6    | UserRole      | UserRole      | ✅        |
| 7    | LatencyBucket | LatencyBucket | ✅        |

**결론**: 필드 순서 ✅ **일치**

---

## 3. 필드 값 매핑 분석

### ⚠️ 발견된 문제점

#### 1. Route 필드 불일치

- **문서**: 실제 route 값 (`/payments/checkout`)
- **쿼리**: 항상 `ANY`
- **영향**: Route 기반 검색이 작동하지 않음
- **예시**:
  - 문서: `Route: /payments/checkout`
  - 쿼리: `Route: ANY`
  - 결과: Route 정보가 검색에 활용되지 않음

#### 2. Service 필드 값 변환

- **문서**: 실제 service 값 (`payments`)
- **쿼리**: 메타데이터에서 추출한 값 (`payment` vs `payments`)
- **영향**: 단수/복수 불일치 가능성
- **예시**:
  - 문서: `Service: payments`
  - 쿼리: `Service: payment` (메타데이터 추출 시)
  - 결과: 정확한 매칭이 어려울 수 있음

#### 3. Error 필드 와일드카드 사용

- **문서**: 실제 error 코드 (`GATEWAY_TIMEOUT`)
- **쿼리**: `ANY` 또는 `NONE`
- **영향**: 의도적 와일드카드이므로 문제 없음 (설계 의도)

#### 4. ErrorMessage 필드

- **문서**: 실제 error message (`Connection timeout`)
- **쿼리**: `ANY` 또는 `NONE`
- **영향**: 의도적 와일드카드이므로 문제 없음 (설계 의도)

---

## 4. 벡터 공간 정합성 분석

### 임베딩 프로세스

#### 문서 임베딩

```typescript
// EmbeddingService.processPendingLogs()
const summaries = chunksToEmbed.map((item) => item.chunk.text);
const results = await this.embeddingPort.createBatchEmbeddings(summaries);
// → VoyageAdapter.createBatchEmbeddings()
// → voyageClient.getClient().embed({ input: summaries, model: model })
```

#### 쿼리 임베딩

```typescript
// SearchService.ask()
const structuredQuery = this.queryPreprocessor.preprocessQuery(query, metadata);
const { embedding } = await this.embeddingPort.createEmbedding(structuredQuery);
// → VoyageAdapter.createEmbedding()
// → voyageClient.getClient().embed({ input: [structuredQuery], model: model })
```

### 정합성 확인

- ✅ **동일한 API 사용**: `voyageClient.getClient().embed()`
- ✅ **동일한 모델 사용**: `voyageClient.getModelName()`
- ✅ **동일한 벡터 차원**: Voyage 모델의 기본 차원 (512차원)
- ✅ **동일한 임베딩 공간**: 같은 모델이므로 같은 벡터 공간

**결론**: 벡터 공간 정합성 ✅ **양호**

---

## 5. 검색 정확도에 미치는 영향

### ✅ 정합성 있는 부분

1. **모델 일관성**: 같은 Voyage 모델 사용
2. **필드 순서**: 문서와 쿼리 형식 일치
3. **구조화된 형식**: 둘 다 구조화된 필드 기반 형식 사용
4. **벡터 공간**: 같은 임베딩 모델이므로 같은 벡터 공간

### ⚠️ 잠재적 문제점

1. **Route 필드**: 쿼리에서 항상 `ANY` 사용 → Route 기반 검색 불가
2. **Service 필드**: 단수/복수 불일치 가능성
3. **와일드카드 사용**: `ANY` 값이 많을수록 검색 정확도 감소 가능

---

## 6. 개선 권장사항

### 우선순위 높음

#### 1. Route 필드 추출 개선

```typescript
// QueryPreprocessorService에 route 추출 로직 추가
private extractRoute(query: string, metadata: QueryMetadata): string {
  // LLM 메타데이터 추출에 route 추가하거나
  // 키워드 기반 추출 로직 추가
  // 예: "checkout", "/payments/checkout" 등
}
```

#### 2. Service 필드 정규화

```typescript
// Service 값 정규화 (단수/복수 통일)
private normalizeService(service: string): string {
  // "payment" → "payments" 또는 반대로 정규화
}
```

### 우선순위 중간

#### 3. 필드별 가중치 적용

- 중요한 필드(Outcome, Service)에 더 높은 가중치
- 와일드카드(`ANY`) 필드는 낮은 가중치

#### 4. 쿼리 변형 전략

- `createQueryVariations() 메`서드 활용
- 여러 쿼리 변형을 생성하여 검색 정확도 향상

---

## 7. 테스트 시나리오

### 시나리오 1: 정확한 매칭

```
문서: Outcome: FAILED, Service: payments, Route: /payments/checkout, Error: GATEWAY_TIMEOUT
쿼리: "are there any failed cases of the service 'payment' today?"
전처리: Outcome: FAILED, Service: payment, Route: ANY, Error: ANY
예상: ✅ 매칭 가능 (Outcome, Service 일치)
```

### 시나리오 2: Route 기반 검색

```
문서: Outcome: SUCCESS, Service: payments, Route: /payments/checkout
쿼리: "show me successful checkout requests"
전처리: Outcome: SUCCESS, Service: payments, Route: ANY
예상: ⚠️ Route 정보 손실로 인한 정확도 감소 가능
```

### 시나리오 3: 부분 매칭

```
문서: Outcome: FAILED, Service: payments, Error: GATEWAY_TIMEOUT
쿼리: "what errors occurred in payments?"
전처리: Outcome: ANY, Service: payments, Error: ANY
예상: ✅ 매칭 가능 (Service 일치, 와일드카드 활용)
```

---

## 8. 최종 결론

### ✅ 정합성 있는 부분

- 모델 일관성: 동일한 Voyage 모델 사용
- 벡터 공간: 같은 임베딩 모델이므로 같은 벡터 공간
- 필드 순서: 문서와 쿼리 형식 일치
- 구조화된 형식: 둘 다 구조화된 필드 기반 형식 사용

### ⚠️ 개선 필요 부분

- Route 필드: 쿼리에서 항상 `ANY` 사용
- Service 필드: 단수/복수 불일치 가능성
- 와일드카드 과다 사용: 검색 정확도에 영향 가능

### 종합 평가

**정합성 점수: 8/10**

전반적으로 정합성이 양호하지만, Route 필드 추출과 Service 정규화 개선이 필요합니다.
