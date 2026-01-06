# Phase 3 — 와이드 이벤트를 위한 결정론적 시맨틱 보강 (Semantic Enrichment)

## 목표

무손실 수집(Ingestion)을 유지하고 운영 리스크를 최소화하면서, 와이드 이벤트로부터 **결정론적(Deterministic)**이고 설명 가능하며, 임베딩에 친화적인 시맨틱(Semantic) 표현을 생성합니다.

이 단계에서는 추론 시점의 지능(Inference-time Intelligence)보다는, 안정적으로 인덱싱, 임베딩 및 조회가 가능한 **안정적인 시맨틱 산출물**을 생성하는 데 집중합니다.

## 핵심 아이디어

- **와이드 이벤트가 표준 맥락입니다**: 가공되지 않은 노이즈 섞인 로그나 일시적인 런타임 데이터를 임베딩하지 마세요. 모든 시맨틱 처리는 단일 진실 공급원인 구조화된 **WideEvent**로부터 파생되어야 합니다.
- **지능보다는 결정론 중시**: 이 단계의 시맨틱 보강은 결정론적이고 재현 가능하며 설명 가능해야 합니다. 수집 시점에는 추측성 추론, 해석 또는 원인 분석을 수행하지 않습니다.
- **관심사 분리**: 수집 경로는 내구성, 속도, 무손실에 집중합니다. 시맨틱 보강은 비동기적이고 재시도 가능하며 교체 가능한 방식으로 이루어집니다.

## 시맨틱 보강 전략

### 수행하는 작업

- 구조화된 로그 맥락을 표준 시맨틱 텍스트로 직렬화합니다.
- LLM을 사용하지 않고 `_summary` 필드를 생성합니다.
- 시간과 환경에 관계없이 안정적인 임베딩용 텍스트를 준비합니다.

### 명확히 수행하지 않는 작업

- 근본 원인 분석 (Root cause analysis)
- 의도 추론 (Intent inference)
- 이벤트 간 추론 (Cross-event reasoning)
- LLM 기반 요약 (LLM-based summarization)
  (이러한 작업들은 조회 시점이나 이후 단계의 역할입니다.)

## 시맨틱 직렬화 (`_summary`)

기존의 Wide Event 데이터를 사용하여 결정론적인 `_summary` 필드를 생성합니다. Phase 4로 확장되면서 재현성과 자연어 회상력(Recall)의 균형을 맞추기 위해, 결정론적 표준 신호와 가벼운 서술형 문장을 결합하는 **이중 레이어 요약(Dual-layer Summary)** 전략을 구현합니다.

### 이중 레이어 요약 구조

시맨틱 요약은 재현성과 자연어 질의 성능을 모두 잡기 위해 의도적으로 결정론적 신호 레이어와 가벼운 서술 레이어를 결합합니다.

**서술 레이어 (Narrative Layer - 자연어 표현)**:
- 템플릿 기반의 문장 생성 (결정론적, LLM 미사용)
* 자연어 질의 매칭을 위한 "언어적 표면"을 제공합니다.
* 예시: "A premium user experienced a payment failure during checkout due to GATEWAY_TIMEOUT." (프리미엄 사용자가 체크아웃 중 GATEWAY_TIMEOUT으로 인해 결제 실패를 경험했습니다.)

**표준 레이어 (Canonical Layer - 구조화된 신호)**:
- 필드 기반의 구조화된 형식
- 통계, 집계 및 필터링을 위한 안정적인 시맨틱 축을 제공합니다.
- 예시: "Outcome: FAILED, Service: payments, Route: /payments/checkout, Error: GATEWAY_TIMEOUT, ..."

**결합된 형식**:
```
{narrative}

{canonical}
```

### 요약 구성 예시

```ts
// 서술 레이어 (템플릿 기반, 결정론적)
const narrative = `A ${roleName} user experienced a ${serviceName} failure during ${routeName} due to ${errorDesc}.`;

// 표준 레이어 (구조화된 필드)
const canonical = `Outcome: ${outcome}, Service: ${service}, Route: ${route}, Error: ${errorCode}, ErrorMessage: ${errorMessage}, UserRole: ${userRole}, LatencyBucket: ${latencyBucket}`;

// 이중 레이어 요약 결합
const summary = `${narrative}\n\n${canonical}`;
```

### 설계 참고 사항

- **고정된 필드 순서**: 임베딩 모델의 일관성을 보장합니다.
- **통제된 어휘 (Controlled Vocabulary)**: 자유 형식 텍스트 대신 안정적인 용어를 사용합니다.
- **구조적 안정성**: 값은 변할 수 있지만 구조는 변하지 않습니다.
- **버케팅 (Bucketing)**: 지연 시간(duration)과 같은 숫자 값은 시맨틱 안정성을 높이기 위해 구간별로 나눕니다(Bucket).
- **결정론적 서술**: 템플릿 기반 생성을 통해 재현성을 보장합니다 (수집 시점에 LLM 추론 없음).
- **언어적 표면**: 서술 레이어는 자연어 질의에 대한 직접적인 키워드 매칭을 제공합니다.

## 구현 참고 사항

### 개선된 하이브리드 수집 파이프라인

- **구조화된 수집 (Structured Ingestion)**: 쓰기 경로에서 외부 의존성 없이 WideEvent를 즉시 안전하게 저장합니다.
- **결정론적 시맨틱 직렬화**: 저장된 Wide Event로부터 `_summary`를 생성합니다 (LLM 없음, 추론 없음).
- **임베딩 준비 (지연 처리)**: `_summary`는 표준 임베딩 입력 역할을 하며, 실제 벡터 생성은 Phase 4에서 비동기적으로 수행됩니다.

### 보안 및 무결성

- **PII 스크러빙 (Scrubbing)**: 요약 생성 전 민감한 필드는 제거하거나 마스킹합니다. `_summary`에는 가공되지 않은 PII가 포함되지 않습니다.
- **근거 무결성 (Grounding Integrity)**: 시맨틱 결과에서 원래의 구조화된 이벤트로 추적할 수 있도록 `requestId`를 항상 보존합니다.
- **결정론적 시맨틱**: 수집 시점에 추론이나 확률적 콘텐츠가 도입되지 않으므로 감사 가능성(Auditability)을 지원합니다.

## 성공 기준

1. 영속화된 모든 Wide Event에 결정론적인 `_summary`가 포함됨.
2. LLM이나 외부 추론 없이 `_summary`가 생성됨.
3. 임베딩 입력값이 안정적이고 표준적이며 재현 가능함.
4. 시맨틱 검색 결과가 설명 가능하고 추적 가능함.
5. 시맨틱 처리가 수집 지연 시간이나 신뢰성에 영향을 주지 않음.
6. 시계열 컬렉션은 불변으로 유지됨. 임베딩 진행 상태는 하이워터마크(High-watermark) 전략과 파생 컬렉션을 사용하여 외부에서 추적됨.

## 단계 간 경계 확인

Phase 3은 시맨틱의 **형태(Form)**를 정의하는 단계이지, 의미(Meaning) 자체를 정의하는 단계가 아닙니다. 의미 추출, 클러스터링 및 인사이트 생성은 의도적으로 조회 시점(Phase 4 이상)으로 미룹니다. 이를 통해 수집 과정을 단순하고 신뢰할 수 있으며 미래 지향적으로 유지합니다.

