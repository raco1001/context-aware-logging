# Phase 3 회고: 결정론적 의미 강화 및 벡터 검색 구현

## 1. 개요 (Overview)

Phase 3의 핵심 목표는 Wide Event로부터
**“결정론적이고 설명 가능한 의미 표현(Deterministic Semantic Representation)”**을 생성하고,
이를 기반으로 벡터 임베딩 및 의미 검색(Semantic Search) 환경을 구축하는 것이었습니다.

단순히 벡터 검색을 ‘되게 만드는 것’이 아니라,

- 로그가 **왜 그렇게 검색되었는지 설명 가능하고**
- 동일한 입력에 대해 **항상 같은 결과를 보장하며**
- 이후 RAG 단계에서도 **안정적인 근거 데이터로 재사용 가능한 형태**

를 갖추는 것을 목표로 아키텍처를 설계했습니다.

---

## 2. 주요 주제 및 해결 과제 (Key Themes & Challenges)

- **Semantic Serialization**  
  구조화된 로그를 임베딩에 최적화된 `_summary` 필드로 직렬화하여,
  자연어 기반 검색과 벡터 공간 내 의미 유사도를 동시에 만족시키는 표현을 설계.

- **Time-Series 컬렉션의 한계 극복**  
  MongoDB Time-Series 컬렉션의 _개별 문서 업데이트 불가_ 제약을 체감하며,
  로그의 불변성(immutability)을 전제로 한 처리 모델로 사고 전환이 필요했음.

- **Vector Search 인덱싱 전략**  
  MongoDB Atlas M0 티어의 제한(Search Index 최대 3개) 하에서
  의미 검색에 실질적으로 필요한 필드만을 대상으로 벡터 인덱스를 구성.

- **SDK 전환 및 안정성 확보**  
  `fetch` 기반 직접 API 호출에서 Voyage AI 공식 SDK로 전환하여,
  재시도·에러 처리·타입 안정성을 개선.

---

## 3. 주요 결정 및 근거 (Key Decisions & Rationale)

### 3.1 High-Watermark & 파생 컬렉션 전략

Time-Series 컬렉션(`wide_events`)을 **완전한 불변 로그 저장소**로 유지하고,
임베딩 결과는 별도의 파생 컬렉션(`wide_events_embedded`)에 저장.

처리 진행 상태는 `embedding_progress` 컬렉션에서
**timestamp + ObjectId 기반 dual high-watermark**로 관리하여,

- 중복 처리 방지
- 누락 없는 batch 처리
- 장애 발생 시 재처리 가능성

을 동시에 확보.

> 로그는 상태가 아니라 “사실”이라는 관점을 명시적으로 구조에 반영한 결정이었습니다.

---

### 3.2 Deterministic Summary over LLM-based Summarization

로그 인입 시점에 LLM을 사용한 요약을 생성하는 방식도 고려했으나,
Phase 3에서는 이를 의도적으로 배제했습니다.

대신,

- Outcome
- Error Code
- User Role
- Latency Bucket

과 같이 **의미 축이 명확한 필드 조합**으로 `_summary`를 구성하여,

- 임베딩 비용 절감
- 검색 결과의 재현성(Reproducibility) 확보
- “왜 이 결과가 나왔는지”에 대한 설명 가능성

을 우선시했습니다.

이는 Phase 4에서 RAG를 도입할 때,
LLM이 해석해야 할 입력을 **최대한 안정적인 형태로 제공하기 위한 사전 작업**이기도 합니다.

---

### 3.3 Hexagonal Architecture의 확장성 검증

기존 Hexagonal Architecture를 유지한 채,

- `EmbeddingUseCase`
- `LogStoragePort`

에 검색 기능을 확장하는 것만으로
전체 의미 검색 파이프라인을 구성할 수 있었습니다.

이는 초기 설계가 **기능 확장을 전제로 충분히 분리되어 있었음**을
간접적으로 검증하는 계기가 되었습니다.

---

### 3.4 Cost-Aware Sampling 전략

모든 로그를 동일하게 임베딩하는 방식은
비용 대비 효용이 낮다고 판단했습니다.

따라서 Phase 3에서는:

- 에러 로그: 100%
- 프리미엄 사용자 로그: 100%
- 일반 성공 로그: 선택적

이라는 명시적인 샘플링 기준을 도입하여,
임베딩 비용과 분석 가치 사이의 균형을 맞추고자 했습니다.

---

## 4. Retrospective: KPT

### Keep (의미있었던 점)

- **의미 검색의 실질적 유효성 검증**  
  “프리미엄 사용자의 결제 실패”와 같은 자연어 질문에 대해,
  유사도 점수와 함께 합리적인 로그 후보를 반환하는 흐름을 end-to-end로 확인.

- **아키텍처 변화에 대한 내구성**  
  SDK 교체, 업데이트 전략 변경 등 비교적 큰 설계 수정이 있었으나,
  도메인 로직을 거의 건드리지 않고 인프라 계층에서 흡수 가능했음.

- **의미 축 중심 데이터 모델링**  
  `durationMs`를 `LatencyBucket`으로 변환함으로써,
  숫자 값보다 의미 중심의 유사도 비교가 가능해졌음.

---

### Problem (개선 필요 사항 / 아쉬운 점)

- **Time-Series 업데이트 제약에 대한 초기 인식 부족**  
  Time-Series 컬렉션의 update 제약을 충분히 고려하지 못해
  임베딩 상태 관리 전략을 재설계해야 했음.

  → 결과적으로 로그의 불변성을 더 명확히 인식하는 계기가 되었음.

- **환경 변수 관리의 취약성**  
  초기 구현에서 `process.env` 직접 참조로 인한 누락 가능성이 존재했으며,
  이후 NestJS `ConfigModule`로 일원화하여 해결.

---

### Try (향후 시도해볼 만한 점)

- **PII 보호 강화**  
  `_summary` 생성 시 개인정보 자동 마스킹 규칙 정교화 및
  PII 제거 전용 View 설계 검토.

- **고급 검색 품질 개선**  
  Voyage AI의 Rerank 기능을 활용한
  검색 결과 재정렬 실험.

- **집계 쿼리와 의미 검색의 결합**  
  PII 제거 View를 기반으로 Aggregation 결과와
  벡터 검색이 함께 활용될 수 있는 구조 탐색.

---

## 5. 추가 인사이트

- **결정론의 가치**  
  로그 처리 시점에서는 “똑똑한 요약”보다
  “다시 설명 가능한 요약”이 훨씬 중요하다는 점을 체감했습니다.

- **Grounding의 중요성**  
  임베딩 컬렉션에 `eventId`를 보존함으로써,
  AI 기반 분석 결과가 항상 원본 로그라는 팩트로 되돌아갈 수 있는
  강한 연결 고리를 확보했습니다.

---

## 결과

Phase 3을 통해,
한글 자연어 질문으로도 시스템의 상태와 오류 맥락을 탐색할 수 있는
**Phase 4(RAG 기반 인사이트 생성)**구현을 위한 환경이 완성되었습니다.

- 참고 자료:
  - https://medium.com/mongodb/versioning-pattern-with-time-series-data-in-mongodb-595b5e8cdac4
  - https://www.mongodb.com/solutions/customer-case-studies/zf?utm_campaign=devrel&utm_source=third-party-content&utm_medium=cta&utm_content=Versioning+Pattern+With+Time+Series+Data+in+MongoDB&utm_term=nicolas.raboy#introduction
  - https://www.mongodb.com/docs/manual/core/timeseries/timeseries-limitations
  - https://boostbrothers.github.io/2024-02-20-mongo-timeseries
