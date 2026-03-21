# 맥락 기반 로깅 및 RAG 를 이용한 데이터 조회 시스템

([영문: README.md](README.md))
이 프로젝트는 동일한 맥락을 가진 이벤트들을 포함한 로그데이터를 자연어로 직접 검색할 수 있도록 구현한 프로젝트 입니다.

전통적인 로깅 파이프라인을

- **맥락 기반(Context-aware)의 요청 단위 이벤트 로그(Wide-event)**
- **보안 우선(Security-first)**
- **RAG 기반 분석 플랫폼**으로 점진적으로 발전시키는 (Phase 1 ~ 5) 과정을 담은 로그 관측 시스템을 목표로 구현했습니다.

단순히 디버깅을 위한 텍스트 로그를 남기는 것에 그치지 않고,

- 각 요청을 풍부한 맥락을 가진 1급 이벤트(First-class Event, Wide Event/Canonical Log Line)로 취급했습니다. \
  이를 통해 신뢰성과 감사 가능성을 유지하면서도 분석 수준의 디버깅, 안전한 데이터 조회, 그리고 AI 지원 추론이 가능한 구조를 구현하고자 했습니다.

- 전통적인 텍스트 기반 로깅의 한계를 극복하기 위해, 하나의 요청을 하나의 '와이드 이벤트(Wide Event)'로 취급하고 \
  이를 RAG(Retrieval-Augmented Generation) 파이프라인과 결합하여 점진적으로 발전시키는 과정을 담고 있습니다.

저장소에는 Phase 4~5 검색 API와 연동하는 **LogLens** 웹 클라이언트(React / Vite)가 포함되어 있습니다. 세션 단위 대화, 자연어 질의, 그리고 집계 로그에 기반한 **실시간 통계 패널**(에러율·지연 백분위수·시간대별 요청량·반창 에러 추세 등)을 제공합니다. 아래 **클라이언트 UI (LogLens)** 를 참고하세요.

---

## 📖 문서 안내

이 프로젝트의 **기술적 배경, 아키텍처 철학, 개발 동기**에 대한 자세한 내용은 아래 문서를 참조해주세요.

- [**Overview-ko.md (프로젝트 동기 및 배경)**](./OVERVIEW-ko.md)

---

## 🏗️ 프로젝트 구조

```text
.
├── backend/                 # NestJS API (Payments, Embeddings / 검색 등)
│   ├── src/
│   ├── libs/config/
│   ├── libs/logging/        # 와이드 이벤트 로깅 (Phase 1~5 공통)
│   └── prompts/             # LLM 프롬프트 (분류, 합성, 근거 검증 등)
├── frontend/                # LogLens UI — React, Vite, FSD
├── docker/                  # Docker Compose (MongoDB, Kafka, Redis 등)
├── docs/                    # 설계 메모·스크린샷
├── journals/                # Phase 회고
├── notes/                   # 짧은 결정 로그·태스크 노트
├── test_data/               # 부하 테스트·목 트래픽 유틸
├── OVERVIEW.md              # 동기·배경 (영문)
└── OVERVIEW-ko.md           # 동일 (한국어)
```

---

## 🖥️ 클라이언트 UI (LogLens)

![LogLens — 세션 채팅과 실시간 통계](./docs/images/client-interface.png)

**LogLens RAG** 인터페이스([`frontend/`](./frontend/))는 다음을 제공합니다.

- **세션**: 세션 검색·선택, 새 분석 스레드 시작.
- **자연어 질의**: 에러율·지연·실패 등 질문; **좁은 시간 범위**(명시적 시작·종료 시각 포함)는 쿼리 분류 단계에서 메타데이터로 전달되어 통계가 요청 구간과 일치하도록 동작합니다.
- **Live updates**(우측 패널): 요약 카드(총 요청 수, 에러율, 평균·P99 지연, 성공률), **에러 추세**(구간 전반 vs 후반), **지연 백분위수**(P50 / P95 / P99), **요청량** 시계열(시간대별 요청·오류).

짧은 구간(수 분 단위) 질의에서는 백엔드가 **더 잘게 쪼인 시간 버킷**을 선택해, 해당 구간에 데이터가 퍼져 있으면 차트에 여러 포인트가 나타나도록 합니다.

---

## 🚀 빠른 시작

### 1. 요구 사항

- Node.js (v20 이상 권장)
- pnpm
- Docker & Docker Compose (Phase 2~5 인프라용)

### 2. 설치 및 환경 설정

```bash
# 백엔드(API) — 프로젝트 루트에서
cd backend
pnpm install

# 환경 변수: backend/.env.example 을 참고해 .env 를 만듭니다.
# Phase 3부터 Gemini, Voyage AI 키가 필요합니다.

# 프론트엔드(LogLens UI) — 선택; API 베이스 URL은 frontend 설정·환경 변수 참고
cd ../frontend
pnpm install
```

### 3. 인프라 실행 (Docker)

```bash
cd docker
docker-compose up -d
```

### 4. 애플리케이션 실행 (개발)

```bash
# 터미널 1 — API (기본 http://localhost:3000)
cd backend
pnpm run start:dev

# 터미널 2 — LogLens UI (개발 서버 URL은 frontend/README.md 참고)
cd frontend
pnpm run dev
```

---

## 🛠️ Phase별 활용 가이드 (1단계 ~ 5단계)

이 프로젝트는 총 5단계의 페이즈를 거쳐 완성됩니다. 각 단계를 직접 테스트하며 프로젝트의 개선과정을 경험해볼 수 있습니다.

### Phase 1: 와이드 이벤트 로깅 (Local JSON)

![Phase 1 Architecture](./docs/images/phase1.png)

하나의 요청이 어떻게 풍부한 맥락(Context)을 가진 JSON 데이터로 남는지 확인합니다.

- **환경 변수 설정** (.env)

  ```bash
    PORT=3000
    LOG_FILE_PATH=logs/app.log
    # ...(제외)
    STORAGE_TYPE=file
    # ...(제외)
    MQ_ENABLED=false
    # ...(제외)
    SESSION_CACHE_TYPE=memory #인메모리
  ```

- **테스트**: `POST /payments` 엔드포인트로 요청을 보냅니다.

  - 테스트 방법:

    ```bash
      # test_data 디렉토리에 mock 데이터가 담긴 JSON 파일을 생성합니다.

      node <프로젝트 Root>/test_data/generator.js

      # backend 가 동작 중인 상태에서 mock 데이터를 기반으로 한 `POST /payments` 요청을 2,000 번 (기본) 생성합니다.

      bash <프로젝트 Root>/test_data/run_load_test.sh
    ```

- **결과 확인**: `backend/logs/app.log` 파일에 한 줄의 JSON(Wide Event)이 기록됩니다.

### Phase 2: MongoDB 영속화 및 쿼리

![Phase2 Architecture](./docs/images/phase2.png)

로컬 파일에 저장되던 로그를 MongoDB 시계열 컬렉션에 저장하여 쿼리 가능한 데이터로 전환합니다.

- **환경 변수 설정** (.env)

  ```bash
    PORT=3000
    LOG_FILE_PATH=logs/app.log

    MONGODB_URI=<mongodb 연결 uri)>
    # ...(제외)
    STORAGE_TYPE=mongodb
    # ...(제외)
    MQ_ENABLED=false
    # ...(제외)
    SESSION_CACHE_TYPE=memory #인메모리
    # ...(제외)
  ```

- **사전 준비**:
  - Docker Compose 또는 외부 MongoDB 가 어플리케이션과 연결되어 있어야 합니다.
  - 외부 MongoDB를 사용중이라면 <프로젝트 Root>/docker/mongo/mongodb-init.js 에 Phase 2 단계 까지의 MongoDB 오브젝트가 생성되어 있어야 합니다.
- **테스트 방법**: Phase 1과 동일하게 요청을 발생시킵니다.
- **결과 확인**: MongoDB의 `logs` 컬렉션에 데이터가 적재되었는지 확인합니다.

### Phase 3: RAG 기반 시맨틱 저장 (Vector DB)

![Phase3 Architecture](./docs/images/phase3-ko.png)

로그 데이터를 요약(Summarization)하고 벡터화하여 의미 검색이 가능한 형태로 저장합니다.

- **환경 변수 설정** (.env)

  ```bash
    PORT=3000
    LOG_FILE_PATH=logs/app.log

    MONGODB_URI=<mongodb 연결 uri)>

    # 임베딩 모델 (voyage ai)

    EMBEDDING_MODEL=voyage-3-lite
    EMBEDDING_MODEL_URI=https://api.voyageai.com/v1/embeddings
    EMBEDDING_MODEL_KEY=<voyage ai api 키>
    EMBEDDING_BATCH_CHUNK_SIZE=50 ## For Chunking Texts to Tokens Before Embedding.(If it's needed)

    # 나머진 3 과 동일
  ```

- **사전 준비**:
  - VoyageAI의 API키를 환경변수에 등록해야 합니다.
  - 외부 MongoDB를 사용중이라면 <프로젝트 Root>/docker/mongo/mongodb-init.js 에 Phase 3 단계 까지의 MongoDB 오브젝트가 생성되어 있어야 합니다.
- **테스트 방법**:
  ```bash
  POST /embeddings/batch?limit=<임베딩을 진행할 로그 갯수(정수)>
  ```
- **결과 확인**: Vector DB(Pinecone 또는 Atlas)에 로그의 의미적 벡터가 저장됩니다.

### Phase 4: 지능형 로그 분석 (RAG Search)

![Phase4 Architecture](./docs/images/phase4-ko.png)

자연어로 로그 데이터에 대해 질문하고 AI의 분석 답변을 받습니다.

- **환경 변수 설정** (.env)

  ```bash
    PORT=3000
    LOG_FILE_PATH=logs/app.log

    MONGODB_URI=<mongodb 연결 uri)>

    # 임베딩 모델 (voyage ai)

    EMBEDDING_MODEL=voyage-3-lite
    EMBEDDING_MODEL_URI=https://api.voyageai.com/v1/embeddings
    EMBEDDING_MODEL_KEY=<voyage ai api 키>
    EMBEDDING_BATCH_CHUNK_SIZE=50 ## For Chunking Texts to Tokens Before Embedding.(If it's needed)

    # 자연어 응답 모델 (gemini)
    RETRIEVING_MODEL=gemini-2.5-flash-lite
    RETRIEVING_MODEL_KEY=<gemini 2.5 flash api 키>
    RETRIEVING_MODEL_URI=<gemini 2.5 flash api url>

    # 나머진 3 과 동일
  ```

- **사전 준비**:
  - VoyageAI의 API키를 환경변수에 등록해야 합니다.
  - Gemini flash 2.0의 API키를 환경변수에 등록해야 합니다.
  - 외부 MongoDB를 사용중이라면 <프로젝트 Root>/docker/mongo/mongodb-init.js 에 Phase 4 단계 까지의 MongoDB 오브젝트가 생성되어 있어야 합니다.
- **테스트 방법(예시)**:

  - 의미 검색:

    ```bash
          curl -G "http://localhost:3000/search/ask" \
          --data-urlencode "q=최근에 결제 요청에서 에러가 난 적이 있어?" \
          --data-urlencode "sessionId=test-session"
    ```

  - 세션 영속성 확인(Phase 4 에선 백엔드의 메모리를, Phase 5에선 Redis를 캐시 저장소로 사용합니다.):\

    ```bash
        curl -G "http://localhost:3000/search/ask" \
        --data-urlencode "q=내가 방금 뭐라고 물어봤어?" \
        --data-urlencode "sessionId=test-session"
    ```

  - 통계·집계 질의 (에러율, 빈도 등 — LogLens 우측 패널에 차트·요약 반영)
    ```bash
        curl -G "http://localhost:3000/search/ask" \
        --data-urlencode "q=최근 24 시간동안 발생한 결제 요청 에러의 빈도를 알려줘" \
        --data-urlencode "sessionId=test-session"
    ```

- **결과 확인**: AI가 실제 로그 데이터 / 캐시에 저장된 세션의 대화내역을 근거로 분석한 답변을 반환합니다. **LogLens** UI를 띄우면 동일한 흐름을 브라우저에서 실행하고, 통계 응답에 대한 차트·요약 카드를 함께 확인할 수 있습니다.

### Phase 5: 운영 안정화 (Hardening)

![Phase5 Architecture](./docs/images/phase5-ko.png)

Kafka를 통한 로그 수집 디커플링, Redis 캐싱, 샘플링 전략을 통해 시스템을 견고하게 만듭니다.

- **환경 변수 설정** (.env)

  ```bash
    PORT=3000
    LOG_FILE_PATH=logs/app.log

    MONGODB_URI=<mongodb 연결 uri)>


    # 임베딩 모델 (voyage ai)

    EMBEDDING_MODEL=voyage-3-lite
    EMBEDDING_MODEL_URI=https://api.voyageai.com/v1/embeddings
    EMBEDDING_MODEL_KEY=<voyage ai api 키>
    EMBEDDING_BATCH_CHUNK_SIZE=50 ## For Chunking Texts to Tokens Before Embedding.(If it's needed)

    # 자연어 응답 모델 (gemini)
    RETRIEVING_MODEL=gemini-2.5-flash-lite
    RETRIEVING_MODEL_KEY=<gemini 2.5 flash api 키>
    RETRIEVING_MODEL_URI=<gemini 2.5 flash api url>


    # 저장소 설정
    STORAGE_TYPE=kafka ## file, mongodb, kafka

    # Docker Compose: 13
    # MQ 설정
    ## MQ Connection Configurations
    MQ_ENABLED=true
    MQ_TYPE=kafka
    MQ_BROKER_ADDRESS=localhost:9092
    MQ_LOG_TOPIC=log-events
    MQ_CONSUMER_GROUP=log-consumer-group (예시)

    ## MQ 배치 단위, 배치 처리 타임아웃
    MQ_BATCH_SIZE=100
    MQ_BATCH_TIMEOUT_MS=1000

    # Cache 저장소 설정
    ## memory or redis
    SESSION_CACHE_TYPE=redis

    ## Redis 설정
    REDIS_HOST=localhost
    REDIS_PORT=6379

    # 로그 샘플링 설정
    LOG_SAMPLING_NORMAL_RATE=0.01
    LOG_SLOW_THRESHOLD_MS=2000
    LOG_CRITICAL_ROUTES=/payments,/auth
  ```

- **테스트 방법**: 대량의 요청을 보내거나 Kafka 인프라를 일시 정지시켜 폴백(Fallback) 로직이 작동하는지 확인합니다.

  - ex. Kafka 컨테이너 중지

  ```bash
  cd <root>/docker

  docker compose stop kafka_local
  ```

- **결과 확인**: 시스템 부하가 조절되고, 장애 상황에서도 로그 유실 없이 안전하게 처리됩니다.

  - 기타 결과 확인:

    - Kafka Topic 확인

      ```bash
      # Kafka 컨테이너에 접속
      docker exec -it kafka_local bash

      # 토픽 목록 확인
      kafka-topics.sh --bootstrap-server localhost:9092 --list

      # 토픽 상세 정보
      kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic log-events

      # Consumer Group 상태 확인
      kafka-consumer-groups.sh --bootstrap-server localhost:9092 --group log-consumer-group --describe
      ```

---

## ✨ 작성자

- **orca1001**
