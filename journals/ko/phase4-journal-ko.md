# Phase 4 회고: RAG-Powered Log Search - Search → Explain

## 1. 개요 (Overview)

Phase 4의 핵심 목표는 **"Search → Explain"**를 실현하는 것이었습니다. Phase 3에서 구축한 결정론적 의미 표현 기반으로, 자연어 질문에 대한 증거 기반 답변을 생성하는 RAG 파이프라인을 완성하고, 통계적 분석 기능까지 고도화하는 것이 목표였습니다.

총 5개의 주요 Step을 통해:

- End-to-End RAG 파이프라인 구축
- Metadata-Aware Retrieval 구현
- Conversational RAG 지원
- 통계 질문 처리 (Metric Engine)
- 신뢰성 및 성능 강화 (Grounding Verification, Semantic Caching)

를 단계적으로 완성했습니다.

---

## 2. 주요 주제 및 해결 과제 (Key Themes & Challenges)

### 2.1 자연어 쿼리와 구조화된 문서 간 매칭 문제

**문제점:**

- 자연어 쿼리 "failed cases"와 구조화된 "Outcome: FAILED" 간 의미적 매칭 어려움
- Service 필터 불일치: "payment" vs "payments" 단수/복수 불일치
- 벡터 검색 결과가 SUCCESS 케이스만 반환되고 FAILED 케이스가 매칭되지 않음

**해결 방향:**

- **Dual-layer Summary 전략**: Narrative Layer(자연어) + Canonical Layer(구조화) 결합
- **Query Preprocessing**: 자연어 쿼리를 구조화된 형식으로 변환하여 문서와 형식 일치
- Service 정규화 로직으로 단수/복수 불일치 해결

### 2.2 통계 질문 처리의 복잡성

**문제점:**

- "how many", "count", "p95" 등의 메트릭 질문에 대한 답변 필요
- 하드코딩된 집계 로직으로 인한 확장성 부족
- 자연어 질문에서 템플릿 변수 추출의 어려움

**해결 방향:**

- **Metric Template Registry**: 설정 기반으로 MongoDB Aggregation 파이프라인 관리
- **LLM 기반 Parameter Mapping**: 자연어 질문에서 템플릿 ID와 파라미터 자동 추출
- Intent-based Routing으로 SEMANTIC vs STATISTICAL 자동 분기

### 2.3 Hallucination 방지 및 증거 기반 답변 보장

**문제점:**

- LLM이 생성한 답변이 Grounding Pack에 근거하지 않은 정보를 포함할 수 있음
- Success Criteria의 "Hallucination Control" 달성 필요

**해결 방향:**

- **Grounding Verification**: Synthesis 후 LLM이 자신의 답변을 검증하는 단계 추가
- 검증 실패 시 Confidence 조정 또는 답변 거부
- 검증되지 않은 주장 명시

### 2.4 성능 최적화 및 비용 절감

**문제점:**

- 동일/유사 질문 반복 시 불필요한 API 호출로 인한 비용 증가
- 벡터 검색 지연 시간

**해결 방향:**

- **Semantic Caching**: 유사도 기반 벡터 쿼리 결과 캐싱
- 코사인 유사도 임계값(0.95) 기반 캐시 히트 판단
- TTL 기반 캐시 만료 관리

---

## 3. 주요 결정 및 근거 (Key Decisions & Rationale)

### 3.1 Dual-layer Summary 전략

**결정:**
Narrative Layer(자연어 서술)와 Canonical Layer(구조화된 필드)를 결합한 Dual-layer Summary 전략 채택.

**근거:**

- 자연어 쿼리 매칭 개선: "failed", "payment", "premium" 등 키워드가 직접 포함되어 검색 정확도 향상
- 구조화 정보 보존: 통계/집계/필터링에 활용 가능한 Canonical Layer 유지
- 결정론적 원칙 유지: LLM 없이 템플릿 기반 생성으로 재현성 확보

**결과:**

- 자연어 쿼리와 구조화된 문서 간 매칭 정확도 향상
- 검색 결과의 설명 가능성 확보

### 3.2 Query Preprocessing 전략

**결정:**
자연어 쿼리를 `_summary` 형식과 유사한 구조화 형식으로 변환하는 QueryPreprocessorService 구현.

**근거:**

- 쿼리-문서 형식 일치도 향상: 벡터 공간에서 쿼리와 문서가 유사한 표현으로 임베딩됨
- 임베딩 정합성 확보: 모델/벡터 공간 일관성 유지

**결과:**

- 벡터 검색 정확도 개선
- Route, Service 필드 기반 검색 가능

### 3.3 Template-based Metric Engine

**결정:**
하드코딩된 집계 로직 대신 설정 기반 Metric Template Registry 구축.

**근거:**

- 확장성: 새로운 메트릭 추가 시 코드 수정 없이 템플릿 추가만으로 대응 가능
- 유지보수성: 비즈니스 로직과 데이터 추출 쿼리 분리
- 지능형 분석: LLM이 자연어 질문에서 템플릿 파라미터를 정확히 추출

**결과:**

- 설정 기반 확장성 확보
- SRE 분석 역량 강화 (P95, P99 등 고급 메트릭 지원)

### 3.4 In-memory Caching (Phase 4) vs Redis (Phase 5)

**결정:**
Phase 4에서는 인메모리 캐싱(SessionCacheService, SemanticCacheService)만 구현하고, 분산 환경 지원은 Phase 5로 미룸.

**근거:**

- Phase 4 목표: Backend 내부 최적화, 외부 인프라 의존성 없음
- Phase 5 목표: 분산 환경 지원, 프로덕션 안정성/확장성 개선
- 단일 애플리케이션 인스턴스 내에서 동작하는 기능은 Phase 4 범위

**결과:**

- 핵심 기능 완성에 집중
- Phase 5에서 Redis로 확장 가능한 구조 확보

### 3.5 Grounding Verification 우선 구현

**결정:**
Step 5에서 Grounding Verification을 Semantic Caching보다 우선하여 구현.

**근거:**

- 핵심 가치: "Evidence-based" 답변 보장
- Success Criteria와 직접 연관: "Hallucination Control" 달성
- 프로덕션 배포 전 필수 기능

**결과:**

- Hallucination 방지 메커니즘 확보
- 검증 실패 케이스 모니터링 가능

---

## 4. 구현 세부사항 (Implementation Details)

### 4.1 Step 1: Semantic End-to-End

**구현 내용:**

- Voyage AI Embedding → MongoDB Vector Search → Voyage Rerank → Gemini Synthesis 파이프라인 완성
- Grounding Pack을 통한 증거 기반 답변 생성

**주요 컴포넌트:**

- `VoyageAdapter`: Embedding 및 Rerank 처리
- `GeminiAdapter`: Synthesis 처리
- `MongoLogStorageAdapter`: Vector Search 및 Grounding Pack 조회

### 4.2 Step 2: Metadata-Aware Retrieval

**구현 내용:**

- LLM 기반 메타데이터 추출 (시간 범위, 서비스, 에러 코드 등)
- Pre-filtering (Vector Search 단계)
- Post-filtering (Grounding 단계)

**주요 컴포넌트:**

- `QueryMetadataSynthesisPrompt`: 메타데이터 추출 프롬프트
- `MongoLogStorageAdapter.vectorSearch()`: 메타데이터 기반 필터링

### 4.3 Step 2.5 & 2.6: Query Preprocessing & Dual-layer Summary

**구현 내용:**

- `QueryPreprocessorService`: 자연어 쿼리를 구조화된 형식으로 변환
- `LoggingService.generateSummary()`: Dual-layer Summary 생성
  - Narrative Layer: 템플릿 기반 자연어 서술
  - Canonical Layer: 구조화된 필드 형식

**주요 개선:**

- `wide_events_embedded`에 `requestId`, `timestamp` 필드 추가
- Grounding 단계에서 원본 로그 추적 가능

### 4.4 Step 3: Conversational RAG

**구현 내용:**

- `SessionCacheService`: 인메모리 세션 히스토리 캐싱 (TTL 30분)
- `QueryReformulationService`: LLM 기반 질문 재구성
- `ContextCompressionService`: 긴 히스토리 압축 (10턴 이상 시)

**주요 컴포넌트:**

- `SynthesisPort.reformulateQuery()`: 질문 재구성 인터페이스
- `SynthesisPort.summarizeHistory()`: 히스토리 요약 인터페이스

### 4.5 Step 4: Metric Engine & Templates

**구현 내용:**

- `MetricTemplate` 인터페이스 및 `METRIC_TEMPLATES` 레지스트리
- `AggregationService.executeTemplate()`: 템플릿 기반 동적 파이프라인 실행
- `GeminiAdapter.analyzeStatisticalQuery()`: LLM 기반 템플릿 선택 및 파라미터 추출

**주요 템플릿:**

- `TOP_ERROR_CODES`: 에러 코드별 집계
- `LATENCY_PERCENTILE`: P50, P95, P99 지연 시간 분석

### 4.6 Step 5: Reliability & Performance Hardening

**Grounding Verification 구현:**

- `SynthesisPort.verifyGrounding()`: 검증 인터페이스 추가
- `GroundingVerificationPrompt`: 검증 프롬프트 템플릿
- `SearchService`에 검증 단계 통합 (Semantic 및 Statistical 쿼리 모두)

**Semantic Caching 구현:**

- `SemanticCacheService`: 벡터 검색 결과 캐싱
- 코사인 유사도 기반 캐시 히트 판단 (임계값: 0.95)
- TTL 관리: 기본 1시간, 시간 범위 쿼리 15분
- 주기적 만료 항목 정리 (10분마다)

---

## 5. 문제 해결 과정 (Problem-Solving Process)

### 5.1 Service 필터 불일치 문제

**문제:**
쿼리에서 추출한 "payment"와 문서의 "payments" 불일치로 인한 검색 실패.

**해결 과정:**

1. Service 정규화 로직 구현 (`normalizeService()`)
2. Fallback 로직 추가: Service 필터 결과 없으면 필터 없이 재시도
3. 로깅 개선: 필터 적용 및 Fallback 과정 상세 기록

**결과:**

- Service 매칭 정확도 향상
- 검색 실패 케이스 감소

### 5.2 통계 질문 처리 개선

**문제:**
하드코딩된 집계 로직으로 인한 확장성 부족 및 복잡한 질문 처리 한계.

**해결 과정:**

1. Session 3: AggregationService 생성 및 기본 집계 구현
2. Session 5: Template Registry 도입 및 LLM 기반 Parameter Mapping 구현
3. 고급 메트릭 템플릿 추가 (P95, P99 등)

**결과:**

- 설정 기반 확장성 확보
- 복잡한 통계 질문 처리 가능

### 5.3 프롬프트 관리 체계화

**문제:**
하드코딩된 프롬프트로 인한 유지보수 어려움 및 Git diff 불가.

**해결 과정:**

1. `PromptTemplate` 추상 클래스 생성 (Value Object)
2. JSON → 마크다운 전환 (YAML frontmatter 포함)
3. `PromptTemplateRegistry`에 마크다운 파서 및 핫 리로드 구현

**결과:**

- Git 친화적 프롬프트 관리
- 개발 환경 핫 리로드 지원
- Phase 5 프롬프트 추적/모니터링 준비 완료

---

## 6. 성과 및 평가 (Outcomes & Evaluation)

### 6.1 완성된 주요 기능

1. **End-to-End RAG 파이프라인** ✅
   - Semantic Search (Voyage Embedding → MongoDB Vector Search)
   - Rerank (Voyage AI Rerank API)
   - Synthesis (Gemini 1.5 Flash)
   - Grounding (원본 로그 추적)

2. **Metadata-Aware Retrieval** ✅
   - QueryMetadata 추출 (시간 범위, 서비스명, 에러 코드 등)
   - Pre-filtering (MongoDB Vector Search)
   - Post-filtering (Grounding 단계)

3. **Dual-layer Summary 전략** ✅
   - Narrative Layer: 자연어 서술 (템플릿 기반)
   - Canonical Layer: 구조화된 필드 형식
   - 자연어 쿼리 매칭 개선

4. **Query Preprocessing** ✅
   - 자연어 쿼리를 구조화된 형식으로 변환
   - 쿼리-문서 형식 일치도 향상

5. **Conversational RAG (Step 3)** ✅
   - SessionCacheService: 인메모리 캐싱
   - QueryReformulationService: 질문 재구성
   - ContextCompressionService: 히스토리 압축

6. **통계 질문 지원 (Step 4)** ✅
   - Metric Template Registry: 설정 기반 집계 관리
   - LLM 기반 Parameter Mapping: 자연어 → 템플릿 파라미터 변환
   - 고급 메트릭: P50, P95, P99 Latency 분석 지원

7. **프롬프트 관리 체계화** ✅
   - 마크다운 기반 프롬프트 관리
   - PromptTemplate 추상화 및 핫 리로드 지원

8. **Reliability & Performance Hardening (Step 5)** ✅
   - Grounding Verification: Hallucination 방지 메커니즘
   - Semantic Caching: 성능 최적화 및 비용 절감

### 6.2 아키텍처 개선 사항

1. **Hexagonal Architecture 확장**
   - 포트 기반 설계로 인프라 독립성 및 테스트 용이성 극대화
   - SynthesisPort, LogStoragePort 등 인터페이스 확장

2. **관심사 분리 및 추상화**
   - 템플릿 기반 집계 엔진 도입으로 비즈니스 로직과 데이터 추출 쿼리 분리
   - 프롬프트 관리 체계화로 Infrastructure 독립성 유지

3. **지능형 라우팅**
   - 질문의 성격(의미 vs 통계)에 따라 최적화된 경로(Path A/B) 자동 선택

### 6.3 성과

1. **기능적 완성도**: 단순 검색을 넘어 자연스러운 대화와 정교한 통계 분석이 가능한 수준으로 진화
2. **유지보수성**: 프롬프트와 메트릭 템플릿이 코드와 분리되어 관리가 용이함
3. **성능 및 사용자 경험**: 세션 캐싱과 지능형 질문 재구성으로 응답 정확도와 속도 향상
4. **신뢰성**: Grounding Verification으로 Hallucination 방지 메커니즘 확보

---

## 7. 회고 및 교훈 (Reflection & Lessons Learned)

### 7.1 Keep (의미있었던 점)

- **의미 검색의 실질적 유용성 검증**
  - "프리미엄 사용자의 결제 실패"와 같은 자연어 질문에 대해 합리적인 로그 후보를 반환하는 흐름을 end-to-end로 확인

- **아키텍처 변화에 대한 내구성**
  - 프롬프트 관리 방식 변경, 캐싱 전략 도입 등 비교적 큰 설계 수정이 있었으나, 도메인 로직을 거의 건드리지 않고 인프라 계층에서 흡수 가능했음

- **결정론적 원칙 유지**
  - Dual-layer Summary에서 Narrative Layer를 템플릿 기반으로 생성하여 재현성 확보
  - LLM 없이도 자연어 쿼리 매칭이 가능한 구조 설계

- **단계적 접근의 효과**
  - Step 1부터 Step 5까지 단계적으로 기능을 확장하면서 각 단계에서 검증하고 개선하는 방식이 효과적이었음

### 7.2 Problem (개선 필요 사항 / 아쉬운 점)

- **Query Preprocessing의 한계**
  - 키워드 기반 전처리로 인해 복잡한 자연어 쿼리 처리에 한계
  - 향후 LLM 기반 Query Preprocessing 고려 필요

- **ContextCompressionService의 단순함**
  - 현재 요약 로직이 단순하여 더 정교한 요약(주제별 그룹화 등) 필요

- **분산 환경 미지원**
  - 인메모리 캐싱으로 인해 단일 인스턴스만 지원 (Phase 5에서 Redis로 확장 예정)

- **복잡한 상관관계 분석 한계**
  - 여러 통계 지표를 결합한 복합 추론 기능은 아직 미지원

### 7.3 Try (향후 시도해볼 만한 점)

- **LLM 기반 Query Preprocessing**
  - 복잡한 자연어 쿼리를 더 정확하게 구조화된 형식으로 변환

- **Multi-step Aggregation**
  - 여러 템플릿 결과를 결합하여 복합적인 통찰 제공

- **Redis 기반 캐싱 (Phase 5)**
  - 분산 환경 지원 및 세션 공유

---

## 8. 추가 인사이트

### 8.1 Grounding의 중요성

Phase 3에서 `requestId`를 보존한 결정이 Phase 4에서 Grounding Verification 구현 시 핵심이 되었습니다. AI 기반 분석 결과가 항상 원본 로그라는 팩트로 되돌아갈 수 있는 강한 연결 고리를 확보한 것이 중요했습니다.

### 8.2 Template-driven 접근의 가치

Metric Template Registry를 통해 설정 기반으로 확장 가능한 구조를 만든 것이, 향후 새로운 메트릭 추가 시 큰 유연성을 제공할 것입니다. 코드 수정 없이 템플릿 추가만으로 대응 가능한 구조는 유지보수성을 크게 향상시켰습니다.

### 8.3 단계적 검증의 중요성

각 Step을 완성할 때마다 실제 쿼리로 테스트하고 문제를 발견하여 개선하는 과정이 중요했습니다. 특히 Step 2에서 발견한 Service 필터 불일치 문제는 이후 단계에서 계속 개선되면서 최종적으로는 정규화 로직과 Fallback 전략으로 해결되었습니다.

---

## 9. 결과

Phase 4를 통해 핵심 목표인 **"Search → Explain"**를 완벽하게 달성하고, 통계 분석 영역까지 성공적으로 확장했습니다.

단순히 로그를 찾아주는 에이전트에서, 로그의 의미를 이해하고 통계적 수치를 바탕으로 시스템의 상태를 설명해주는 지능형 관찰성 도구로 도약했습니다. 특히 Step 5를 통해 구축한 **Grounding Verification**과 **Semantic Caching**은 프로덕션 수준의 안정성과 성능을 확보하는 데 중요한 기반이 될 것입니다.

**전체적으로 Phase 4 프로젝트는 성공적이었으며, 이제 프로덕션 수준의 안정성과 확장성을 확보하는 Phase 5로 나아갈 준비가 되었습니다.**

---

## 참고 자료

- MongoDB RAG Tutorial: https://www.mongodb.com/developer/products/atlas/rag-atlas-vector-search-vercel-ai-sdk/
- Voyage AI Documentation: https://docs.voyageai.com/
- Google Gemini API: https://ai.google.dev/docs
