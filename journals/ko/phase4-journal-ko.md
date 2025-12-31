## memo

---

### 2025-12-30

- plan

  ```json
  {
    "merge": false,
    "todos": [
      {
        "id": "p4-cleanup",
        "content": "analysis 모듈 삭제 및 AppModule 의존성 제거",
        "status": "in_progress"
      },
      {
        "id": "p4-embedding-expansion",
        "content": "embeddings 모듈에 RAG(Search, Rerank, Synthesis) 포트 추가",
        "status": "pending"
      },
      {
        "id": "p4-voyage-rerank",
        "content": "Voyage AI Rerank API 연동 및 구현",
        "status": "pending"
      },
      {
        "id": "p4-gemini-integration",
        "content": "Gemini 2.5 Flash 연동 및 답변 합성 구현",
        "status": "pending"
      },
      {
        "id": "p4-rag-end-to-end",
        "content": "End-to-End RAG (Search-Rerank-Synthesis) 파이프라인 완성",
        "status": "pending"
      }
    ]
  }
  ```

---

- core

  ```bash
    자연어 질문
        → Voyage Embedding
        → MongoDB Vector Search
        → Voyage Rerank
        → Grounding Pack
        → LLM Synthesis
        → 자연어 답변 + 출처

  ```

---

- 오늘 진행한 작업
  - vector search: 자연어 쿼리 임베딩 모듈 생성
  - 프로젝트 path alias 설정
  - 위에서 명시한 초기 작업 스텝 모두
  - 코드 객체 관심사 분리 (전반적으로 모두),DI 오류 디버깅
  - path를 간결하게 정리하고자 리소스 별 로 index.ts 를 만들었음.

---

문제점:

- vector search 자체는 가능하지만 쿼리 전처리/임베딩 전략이 수정이 필요해 보인다.
- 데이터를 임베딩하는 과정부터 다시 해봐야겠다. (MongoDB 공식 튜토리얼 목차 3)
- 이후 쿼리도 chunking 한 문자열을 임베딩하여 쿼리 벡터로 이용한다면 어떻게든 유사한 결과가 나올 듯

```bash
curl -G "http://localhost:3000/search/ask"      --data-urlencode "q=are there any failed cases of the service 'payment' today?"      --data-urlencode "sessionId=test-session" | jq
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100   179  100   179    0     0    119      0  0:00:01  0:00:01 --:--:--   119
{
  "question": "are there any failed cases of the service 'payment' today?",
  "intent": "UNKNOWN",
  "answer": "Not enough evidence.",
  "sources": [],
  "sessionId": "test-session",
  "confidence": 0
}
```

---

- 참고:
  - https://rimo.tistory.com/44

- MongoDB 공식 RAG repository 구현 순서
  - Step 1: Setup prerequisites
  - Step 2: Load the dataset
  - Step 3: Chunk and embed the data
  - Step 4: Ingest data into MongoDB
  - Step 5: Create a vector search index
  - Step 6: Perform vector search on your data
  - Step 7: Build the RAG application
  - Step 8: Add memory to the RAG application

---

요약(2025/12/30)

```markdown
1. 아키텍처 통합 및 모듈 재구성
   analysis 모듈 삭제 및 embeddings 모듈로 기능 통합
   Hexagonal Architecture 기반 RAG 파이프라인 구조 설계
   tsconfig.paths.json 설정으로 경로 alias 구성
2. RAG 파이프라인 구현 (End-to-End)
   Semantic Search: Voyage AI Embedding → MongoDB Vector Search
   Rerank: Voyage AI Rerank API 연동 (rerank-2 모델)
   Synthesis: Gemini 1.5 Flash 연동 및 자연어 답변 생성
   Grounding: 검색 결과를 원본 wide_events 컬렉션과 연결하여 근거 제공
3. Metadata-Aware Retrieval (Step 2)
   LLM 기반 메타데이터 추출 (QueryMetadata): 시간 범위, 서비스명, 에러 코드, 에러 존재 여부
   MongoDB Vector Search Pre-filtering: 시간/서비스 필터 적용
   Post-filtering (Grounding 단계): 에러 관련 필터링으로 검색 정확도 향상
4. MongoDB 인프라 개선
   wide_events_embedded Search Index에 service 필드 추가 (filter 타입)
   chat_history 컬렉션 인덱스 설정 (세션 기반 조회 최적화)
   wide_events 복합 인덱스 최적화 (Time-series 컬렉션)
5. 모듈별 서비스 식별 기능
   @Service() 데코레이터 구현 (LoggingInterceptor에서 메타데이터 읽기)
   각 컨트롤러에 모듈명 지정 (payments, embeddings)
   로그의 service 필드에 모듈별 식별자 자동 기록
6. 클라이언트/어댑터 분리 (관심사 분리)
   VoyageClient: Voyage AI SDK 클라이언트 초기화 전용
   VoyageAdapter: 초기화된 클라이언트를 사용하여 실제 API 작업 수행
   GeminiClient: Google Generative AI SDK 클라이언트 초기화 전용
   GeminiAdapter: 초기화된 클라이언트를 사용하여 실제 API 작업 수행
7. 문서 업데이트
   04-phase-4-rag-log-search.md에 Step 2 확장 내용 반영
   기술 구현 단계 및 성공 기준 명시
```

---

### 2025-12-31

- 문제점

```bash

[Nest] 48412  - 12/31/2025, 6:06:51 PM     LOG [SearchService] Performing vector search with embedding (dimension: 512), metadata: {"startTime":"2025-11-30T00:00:00.000Z","endTime":"2025-12-31T00:00:00.000Z","service":"payment","route":null,"errorCode":null,"hasError":true}
[Nest] 48412  - 12/31/2025, 6:06:51 PM     LOG [MongoLogAdapter] Vector search: Collection "wide_events_embedded" has 229 documents
[Nest] 48412  - 12/31/2025, 6:06:51 PM   DEBUG [MongoLogAdapter] Applying service filter: "payment"
[Nest] 48412  - 12/31/2025, 6:06:51 PM   DEBUG [MongoLogAdapter] Vector search filter: {"createdAt":{"$gte":"2025-11-30T00:00:00.000Z","$lte":"2025-12-31T00:00:00.000Z"},"service":"payment"}
[Nest] 48412  - 12/31/2025, 6:06:51 PM     LOG [MongoLogAdapter] Vector search completed: 0 results (requested: 10)
[Nest] 48412  - 12/31/2025, 6:06:51 PM    WARN [MongoLogAdapter] No results with service filter "payment". Trying without service filter...
[Nest] 48412  - 12/31/2025, 6:06:51 PM     LOG [MongoLogAdapter] Fallback search (without service filter) returned 10 results
[Nest] 48412  - 12/31/2025, 6:06:51 PM     LOG [SearchService] Vector search returned 10 results
[Nest] 48412  - 12/31/2025, 6:06:51 PM     LOG [SearchService] Top 3 vector search results:
  1. Score: 0.9239, Summary: Outcome: SUCCESS, Service: payments, Route: POST /payments, Error: NONE, ErrorMessage: NONE, UserRol
  2. Score: 0.9239, Summary: Outcome: SUCCESS, Service: payments, Route: POST /payments, Error: NONE, ErrorMessage: NONE, UserRol
  3. Score: 0.9239, Summary: Outcome: SUCCESS, Service: payments, Route: POST /payments, Error: NONE, ErrorMessage: NONE, UserRol
[Nest] 48412  - 12/31/2025, 6:06:51 PM     LOG [SearchService] Reranked indices: [
  {
    "index": 0,
    "relevance_score": 0.57421875
  },
  {
    "index": 1,
    "relevance_score": 0.57421875
  },
  {
    "index": 2,
    "relevance_score": 0.57421875
  },
  {
    "index": 3,
    "relevance_score": 0.57421875
  },
  {
    "index": 4,
    "relevance_score": 0.57421875
  }
]
[Nest] 48412  - 12/31/2025, 6:06:51 PM     LOG [SearchService] Top results: [
  {
    "eventId": "6953c4cc758c23bce07d9639",
    "summary": "Outcome: SUCCESS, Service: payments, Route: POST /payments, Error: NONE, ErrorMessage: NONE, UserRole: admin, LatencyBucket: P_50_200MS",
    "score": 0.9238767623901367
  },
  {
    "eventId": "6953c4cb758c23bce07d9633",
    "summary": "Outcome: SUCCESS, Service: payments, Route: POST /payments, Error: NONE, ErrorMessage: NONE, UserRole: admin, LatencyBucket: P_50_200MS",
    "score": 0.9238767623901367
  },
  {
    "eventId": "6953c4cb758c23bce07d962b",
    "summary": "Outcome: SUCCESS, Service: payments, Route: POST /payments, Error: NONE, ErrorMessage: NONE, UserRole: admin, LatencyBucket: P_50_200MS",
    "score": 0.9238767623901367
  },
  {
    "eventId": "6953c4cb758c23bce07d9628",
    "summary": "Outcome: SUCCESS, Service: payments, Route: POST /payments, Error: NONE, ErrorMessage: NONE, UserRole: admin, LatencyBucket: P_50_200MS",
    "score": 0.9238767623901367
  },
  {
    "eventId": "6953c4cb758c23bce07d9627",
    "summary": "Outcome: SUCCESS, Service: payments, Route: POST /payments, Error: NONE, ErrorMessage: NONE, UserRole: admin, LatencyBucket: P_50_200MS",
    "score": 0.9238767623901367
  }
]
[Nest] 48412  - 12/31/2025, 6:06:51 PM     LOG [SearchService] Full logs: [
  {
    "timestamp": "2025-12-30T12:25:47.210Z",
    "service": "payments",
    "performance": {
      "durationMs": 101
    },
    "_id": "6953c4cb758c23bce07d9627",
    "requestId": "4090cb64-cef7-4042-94f7-c2c9441d10e2",
    "error": null,
    "route": "POST /payments",
    "metadata": null,
    "user": {
      "id": "user-6720",
      "role": "admin"
    },
    "_summary": "Outcome: SUCCESS, Service: payments, Route: POST /payments, Error: NONE, ErrorMessage: NONE, UserRole: admin, LatencyBucket: P_50_200MS"
  },
  {
    "timestamp": "2025-12-30T12:25:47.413Z",
    "service": "payments",
    "performance": {
      "durationMs": 101
    },
    "_id": "6953c4cb758c23bce07d9628",
    "requestId": "03424002-7e2f-4481-9412-710936c0d7f9",
    "error": null,
    "route": "POST /payments",
    "metadata": null,
    "user": {
      "id": "user-3040",
      "role": "admin"
    },
    "_summary": "Outcome: SUCCESS, Service: payments, Route: POST /payments, Error: NONE, ErrorMessage: NONE, UserRole: admin, LatencyBucket: P_50_200MS"
  },
  {
    "timestamp": "2025-12-30T12:25:47.414Z",
    "service": "payments",
    "performance": {
      "durationMs": 103
    },
    "_id": "6953c4cb758c23bce07d962b",
    "requestId": "57fa395b-f6f7-449b-8145-c38ac6d59dd6",
    "error": null,
    "route": "POST /payments",
    "metadata": null,
    "user": {
      "id": "user-2798",
      "role": "admin"
    },
    "_summary": "Outcome: SUCCESS, Service: payments, Route: POST /payments, Error: NONE, ErrorMessage: NONE, UserRole: admin, LatencyBucket: P_50_200MS"
  },
  {
    "timestamp": "2025-12-30T12:25:47.824Z",
    "service": "payments",
    "metadata": null,
    "_id": "6953c4cb758c23bce07d9633",
    "_summary": "Outcome: SUCCESS, Service: payments, Route: POST /payments, Error: NONE, ErrorMessage: NONE, UserRole: admin, LatencyBucket: P_50_200MS",
    "user": {
      "id": "user-2011",
      "role": "admin"
    },
    "error": null,
    "requestId": "eb52865b-0e4c-4c8f-b716-5b2cf9e26317",
    "performance": {
      "durationMs": 100
    },
    "route": "POST /payments"
  },
  {
    "timestamp": "2025-12-30T12:25:48.027Z",
    "service": "payments",
    "metadata": null,
    "_id": "6953c4cc758c23bce07d9639",
    "_summary": "Outcome: SUCCESS, Service: payments, Route: POST /payments, Error: NONE, ErrorMessage: NONE, UserRole: admin, LatencyBucket: P_50_200MS",
    "user": {
      "id": "user-0050",
      "role": "admin"
    },
    "error": null,
    "requestId": "81fcd6ba-2e63-4340-ab98-f01ce520ec88",
    "performance": {
      "durationMs": 101
    },
    "route": "POST /payments"
  }
]
```

쿼리 전처리 이후 유사도 검색에서 error 케이스를 구분하는게 쉽지 않아보임. knowledge 컬렉션의 수정이 필요해 보임 (샘플링 전략도 수정이 필요)

수정/추가 계획

```bash

Step 1: AggregationService 생성
- aggregateErrorCodesByCount() 구현
- aggregateErrorsByRoute() 구현
- aggregateErrorsByService() 구현
Step 2: SearchService 확장
- handleStatisticalQuery() 메서드 추가
- Intent detection 강화
- Aggregation type 파싱 로직 추가
Step 3: MongoLogAdapter 확장
- executeAggregation() 메서드 구현
- wide_events 컬렉션 직접 접근
Step 4: Gemini Synthesis 프롬프트 개선
- 집계 결과를 자연어로 변환하는 프롬프트 추가
- 표 형식 출력 지원

```

- 스텝 1,2,4 완료 후

```bash
{
  "question": "프리미엄 유저가 결제 요청에 실패하는 주요 이유가 뭐야?",
  "intent": "STATISTICAL",
  "answer": "프리미엄 유저가 결제 요청에 실패하는 주요 이유는 제공된 로그에 따르면 다음과 같습니다.\n\n1.  **INSUFFICIENT_FUNDS**: 26건의 실패가 이 오류 코드로 기록되었으며, 이는 사용자의 계정에 거래를 완료할 자금이 부족함을 의미합니다.\n2.  **INSUFFICIENT_BALANCE**: 14건의 실패가 이 오류 코드로 기록되었으며, 이는 잔액이 부족함을 나타냅니다.\n3.  **GATEWAY_TIMEOUT**: 13건의 실패가 이 오류 코드로 기록되었으며, 이는 결제 게이트웨이와의 연결 시간 초과를 의미합니다.\n4.  **GATEWAY_REJECTED**: 12건의 실패가 이 오류 코드로 기록되었으며, 이는 외부 결제 게이트웨이가 잘못된 매개변수 또는 은행 정책으로 인해 요청을 거부했음을 의미합니다.\n5.  **CARD_EXPIRED**: 9건의 실패가 이 오류 코드로 기록되었으며, 이는 제공된 결제 수단이 만료되었음을 의미합니다.\n\n또한, \"contextLogs\"에 따르면 프리미엄 유저의 결제 실패가 \"INSUFFICIENT_BALANCE\" (잔액 부족)으로 인해 발생한 사례가 여러 건 확인되었습니다.",
  "sources": [
    "26189969-02de-42aa-9a02-da3904e97114",
    "7d505e7c-e47f-499d-8315-0851f63b6cb4",
    "8400f32f-4bc3-43c7-b32d-86dced662c80",
    ...
  ],
  "confidence": 1,
  "sessionId": "test-session"
}


curl -G "http://localhost:3000/search/ask"   --data-urlencode "q=최근 3일 동안 발생한 가장 심각한 결제 오류는 뭐야?"   --data-urlencode "sessionId=test-session" | jq
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100   456  100   456    0     0    160      0  0:00:02  0:00:02 --:--:--   160
{
  "question": "최근 3일 동안 발생한 가장 심각한 결제 오류는 뭐야?",
  "intent": "SEMANTIC",
  "answer": "최근 3일 동안 발생한 가장 심각한 결제 오류는 'GATEWAY_TIMEOUT'이며, 이는 결제 게이트웨이 연결 시간 초과로 인해 발생했습니다.",
  "sources": [
    "0ffccee3-bf9d-4736-a710-1ca782760b12",
    "959e3db6-d5ec-4c81-a9c7-2ad00f24b874",
    "bfcf0b45-0fc8-4c87-9fb6-fbf1992eeccd"
  ],
  "confidence": 1,
  "sessionId": "test-session"
}


```

- 스텝 3, 5

```markdown
Phase 구분

## Phase 4 (현재): Backend 내부 최적화

### 인메모리 캐싱 (Node.js Map/Set)

- 단일 프로세스 내에서 동작
- 외부 의존성 없음
- 빠른 구현 가능

### Query Reformulation

- LLM 기반 질문 재구성
- Backend 로직 범위

### Context Compression

- 히스토리 요약 로직
- Backend 로직 범위

## Phase 5: 인프라스트럭처 개선

### Phase 5 문서에 명시된 내용:

- Redis Caching: "Cache common AI-generated query plans and summary results"
- Message Queue (MQ): 로깅 파이프라인 비동기화
- Tail-Based Sampling: 비용 최적화

---

## 구분 기준

### Phase 4에서 구현 (Backend 내부)

- 단일 애플리케이션 인스턴스 내에서 동작
- 외부 인프라 의존성 없음
- 핵심 기능 완성을 위해 필요

### Phase 5로 미루기 (인프라 개선)

- 분산 환경 지원 (여러 인스턴스 간 공유)
- 외부 서비스 의존성 (Redis, MQ)
- 프로덕션 안정성/확장성 개선

---

## Step 3 구현 전략 (수정)

### Phase 4에서 구현할 것

1. SessionCacheService (인메모리) [✅]

- Map<string, SessionData> 사용
- TTL 기반 만료
- 단일 인스턴스에서 동작
- **완료**: SearchService에 통합됨

2. QueryReformulationService [✅]

- LLM 기반 질문 재구성
- Backend 로직
- **완료**: GeminiAdapter에 reformulateQuery 구현, SearchService에 통합됨

3. ContextCompressionService [✅]

- 긴 히스토리 요약
- Backend 로직
- **완료**: SynthesisPort에 summarizeHistory 메서드 추가, GeminiAdapter에 구현, SearchService에 통합됨

### Phase 5로 미룰 것

1. Redis 기반 세션 캐싱

- 분산 환경 지원
- 여러 인스턴스 간 세션 공유

2. Redis 기반 Semantic Caching

- 벡터 쿼리 결과 캐싱
- Phase 5 문서에 명시됨
```

---

### 2025-12-31 (후반)

- Step 3 완료 작업

**완료된 작업:**

1. **ContextCompressionService 개선**
   - `SynthesisPort` 인터페이스에 `summarizeHistory()` 메서드 추가
   - `GeminiAdapter`에 `summarizeHistory()` 구현
   - 직접 클라이언트 접근 제거, 인터페이스 기반으로 리팩토링
   - Fallback 로직을 `GeminiAdapter` 내부로 이동

2. **GeminiAdapter 히스토리 포맷팅 수정**
   - `synthesize()` 메서드에서 히스토리 포맷팅 버그 수정
   - `role`/`content` → `question`/`answer`로 변경하여 `AnalysisResult` 구조와 일치시킴

3. **코드 품질 개선**
   - 모든 린터 오류 해결
   - 인터페이스 기반 설계로 개선 (의존성 역전 원칙 준수)

**Step 3 상태:**

- ✅ SessionCacheService: 완료 및 통합
- ✅ QueryReformulationService: 완료 및 통합
- ✅ ContextCompressionService: 완료 및 통합

**결과**

```bash
# 첫 번째 질문
SESSION_ID="test-session-$(date +%s)" && \
curl -G "http://localhost:3000/search/ask" \
  --data-urlencode "q=프리미엄 고객이 결제 요청에 실패하는 주요원인이 있다면 뭐야?" \
  --data-urlencode "sessionId=$SESSION_ID" | jq && \
echo "\n---\n" && \
# 두 번째 질문 (같은 세션)
curl -G "http://localhost:3000/search/ask" \
  --data-urlencode "q=방금 내가 어떤 질문을 했지?" \
  --data-urlencode "sessionId=$SESSION_ID" | jq
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100  1868  100  1868    0     0    562      0  0:00:03  0:00:03 --:--:--   562
{
  "question": "프리미엄 고객이 결제 요청에 실패하는 주요원인이 있다면 뭐야?",
  "intent": "STATISTICAL",
  "answer": "프리미엄 고객의 결제 요청 실패에 대한 주요 원인은 다음과 같습니다.\n1. INSUFFICIENT_FUNDS (잔액 부족): 26건의 요청에서 발생했으며, 사용자가 거래를 완료하기에 계정에 자금이 부족함을 나타냅니다.\n2. INSUFFICIENT_BALANCE (잔액 부족): 14건의 요청에서 발생했으며, 단순히 잔액이 부족하다는 메시지를 포함합니다.\n3. GATEWAY_TIMEOUT (게이트웨이 시간 초과): 13건의 요청에서 발생했으며, 결제 게이트웨이와의 연결 시간이 초과되었습니다.\n4. GATEWAY_REJECTED (게이트웨이 거부): 12건의 요청에서 발생했으며, 외부 결제 게이트웨이가 잘못된 매개변수 또는 은행 정책으로 인해 요청을 거부했습니다.\n5. CARD_EXPIRED (카드 만료): 9건의 요청에서 발생했으며, 제공된 결제 수단이 만료되었습니다.\n\n제공된 로그 컨텍스트에 따르면, 특히 \"INSUFFICIENT_BALANCE\" 오류는 프리미엄 고객의 결제 실패에 기여하는 상당한 요인으로 나타납니다.",
  "sources": [
    "26189969-02de-42aa-9a02-da3904e97114",
    "7d505e7c-e47f-499d-8315-0851f63b6cb4",
    "8400f32f-4bc3-43c7-b32d-86dced662c80",
    "eedb7e95-4fcc-41b2-adcc-d20823530d64",
    "e949d94b-23fa-4bc3-bd1b-3ef1eb0c7db7",
    "4a0b0928-2371-4b1d-873f-7a3b4d8f7802",
    "84dbc6a6-74f1-4e80-887e-49e1a66a5b6e",
    "0ffccee3-bf9d-4736-a710-1ca782760b12",
    "959e3db6-d5ec-4c81-a9c7-2ad00f24b874",
    "fdfaa553-d1ba-4252-b31a-25c817b88121",
    "7fe1de2b-69dd-4550-b05b-7bfe658dc012",
    "1f507dfd-dd37-4387-ba2f-61b5b464b1aa",
    "adfd4ef1-91a5-42dd-bf73-12dc839ee420",
    "19cca39f-eec5-42ad-a945-9995f371ddc9",
    "28d8a06d-8d2d-4a65-822a-85c5bb1badb7"
  ],
  "confidence": 0.9,
  "sessionId": "test-session-1767181108"
}
\n---\n
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100   471  100   471    0     0    213      0  0:00:02  0:00:02 --:--:--   213
{
  "question": "방금 내가 어떤 질문을 했지?",
  "intent": "SEMANTIC",
  "answer": "방금 \"프리미엄 고객이 결제 요청에 실패하는 주요원인이 있다면 뭐야?\"라고 질문하셨습니다.",
  "sources": [
    "08e66010-59d9-45e4-9e1c-fa403fbb63b7",
    "7f6a9cdf-09c9-4a38-aa8a-8d1078c00140",
    "7a8398a8-4986-4998-bf72-3fb58cf2d472",
    "01a8932a-b6b3-4362-af04-97588a185662",
    "16d575ff-8f22-40d8-90b8-b0c45de0c0d1"
  ],
  "confidence": 1,
  "sessionId": "test-session-1767181108"
}
```

**다음 단계:**

- Step 3 기능 테스트 및 검증
- Step 4 (Metric Engine & Templates) 또는 Step 5 (Reliability & Performance Hardening) 진행
