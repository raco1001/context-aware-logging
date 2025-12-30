## memo

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
