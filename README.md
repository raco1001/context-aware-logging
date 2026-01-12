# Context-Aware Logging & RAG Observability System

([Korean: README-ko.md](README-ko.md)) \
This project implements an observability system that enables direct natural language search of log data by preserving and grouping events within the same request context.

It aims to demonstrate the incremental evolution of a traditional logging pipeline into a:

- **Context-aware Wide-event logging system**
- **Security-first platform**
- **RAG-powered analysis platform** (Phases 1 ~ 5).

Beyond simple text-based debugging, this system:

- Treats each request as a **First-class Event (Wide Event / Canonical Log Line)** with rich context, enabling analytics-grade debugging, secure retrieval, and AI-assisted reasoning.
- Combines a **Wide Event** approach with a **RAG (Retrieval-Augmented Generation)** pipeline to overcome the limitations of traditional fragmented logging.

---

## 📖 Documentation

For detailed information on the **technical background, architectural philosophy, and motivation**, please refer to the following document:

- [**OVERVIEW.md (Motivation & Background)**](./OVERVIEW.md)

---

## 🏗️ Project Structure

```bash
.
├── backend/            # NestJS server source code
│   ├── src/            # Business logic (Payments, Embeddings, etc.)
│   ├── libs/config/    # Initialization and configuration
│   └── libs/logging/   # Core logging library (Shared across Phases 1-5)
├── prompts/            # Prompts for LLM retrieval
├── docker/             # Infrastructure configuration (Docker Compose)
├── docs/               # Detailed design documents per Phase (WIP)
├── journals/           # Retrospective journals per Phase
├── test_data/          # Generation utils of test data and mock business requests
└── OVERVIEW.md         # Architectural philosophy and background
```

---

## 🚀 Quick Start

### 1. Requirements

- Node.js (v20+ recommended)
- pnpm
- Docker & Docker Compose (Required for Phases 2~5)

### 2. Installation & Environment Setup

```bash
# Navigate to the project backend
cd backend

# Install dependencies
pnpm install

# Environment Variables
# Refer to backend/.env.example to create your .env file.
# API keys for Gemini and Voyage AI are required from Phase 3 onwards.
```

### 3. Run Infrastructure (Docker)

```bash
cd docker
docker-compose up -d
```

---

## 🛠️ Phase-by-Phase Usage Guide (Phase 1 ~ 5)

This project is built across 5 distinct phases. You can experience the system's evolution by testing each phase sequentially.

### Phase 1: Wide Event Logging (Local JSON)

![Phase 1 Architecture](./docs/images/phase1.png)

Observe how a single request is captured as a context-rich JSON "Wide Event".

- **Environment Variables** (.env):

  ```bash
  PORT=3000
  LOG_FILE_PATH=logs/app.log
  # ... (other config)
  STORAGE_TYPE=file
  # ... (other config)
  MQ_ENABLED=false
  # ... (other config)
  SESSION_CACHE_TYPE=memory # In-memory
  ```

- **Test**: Generate traffic to the `POST /payments` endpoint.
  - **Execution**:

    ```bash
    # Generate mock data in the test_data directory
    node <Project Root>/test_data/generator.js

    # Generate 2,000 (default) payment requests using the mock data
    bash <Project Root>/test_data/run_load_test.sh
    ```

- **Verification**: Check `backend/logs/app.log` for a single-line JSON event per request.

### Phase 2: MongoDB Persistence & Querying

![Phase2 Architecture](./docs/images/phase2.png)

Transition from local file logs to a queryable MongoDB Time-series collection.

- **Environment Variables** (.env):

  ```bash
  PORT=3000
  LOG_FILE_PATH=logs/app.log

  MONGODB_URI=<your_mongodb_uri>
  # ... (other config)
  STORAGE_TYPE=mongodb
  # ... (other config)
  MQ_ENABLED=false
  # ... (other config)
  SESSION_CACHE_TYPE=memory # In-memory
  # ...
  ```

- **Prerequisites**:
  - Ensure Docker containers or an external MongoDB instance is connected.
  - If using an external DB, ensure schemas for Phase 2 are initialized in `<Project Root>/docker/mongo/mongodb-init.js`.
- **Testing**: Follow the same steps as Phase 1.
- **Verification**: Confirm that log data is populated in the `logs` collection in MongoDB.

### Phase 3: RAG-based Semantic Storage (Vector DB)

![Phase3 Architecture](./docs/images/phase3.png)

Summarize and vectorize log data for semantic search capabilities.

- **Environment Variables** (.env):

  ```bash
  PORT=3000
  LOG_FILE_PATH=logs/app.log

  MONGODB_URI=<your_mongodb_uri>

  # Embedding Model (Voyage AI)
  EMBEDDING_MODEL=voyage-3-lite
  EMBEDDING_MODEL_URI=https://api.voyageai.com/v1/embeddings
  EMBEDDING_MODEL_KEY=<your_voyage_ai_key>
  EMBEDDING_BATCH_CHUNK_SIZE=50 # Chunk size for text processing

  # Other settings same as Phase 2
  ```

- **Prerequisites**:
  - Add your **VoyageAI API Key** to the environment variables.
  - Ensure MongoDB objects for Phase 3 are initialized.
- **Testing**: Trigger the batch embedding process via

  ```bash
  POST /embeddings/batch?limit=<number_of_logs>
  ```

- **Verification**: Verify that semantic vectors are stored in the Vector DB (Pinecone or Atlas).

### Phase 4: Intelligent Log Analysis (RAG Search)

![Phase4 Architecture](./docs/images/phase4.png)

Query your logs using natural language and receive AI-driven insights.

- **Environment Variables** (.env):

  ```bash
  PORT=3000
  LOG_FILE_PATH=logs/app.log

  MONGODB_URI=<your_mongodb_uri>

  # Embedding Model (Voyage AI)
  EMBEDDING_MODEL=voyage-3-lite
  EMBEDDING_MODEL_URI=https://api.voyageai.com/v1/embeddings
  EMBEDDING_MODEL_KEY=<your_voyage_ai_key>
  EMBEDDING_BATCH_CHUNK_SIZE=50

  # LLM (Gemini)
  RETRIEVING_MODEL=gemini-2.5-flash-lite
  RETRIEVING_MODEL_KEY=<your_gemini_api_key>
  RETRIEVING_MODEL_URI=<your_gemini_api_url>

  # Other settings same as Phase 3
  ```

- **Prerequisites**:
  - Add **VoyageAI** and **Gemini Flash 2.0** API Keys to the environment variables.
  - Ensure MongoDB objects for Phase 4 are initialized.
- **Testing**:
  - **Semantic Search**:
    ```bash
      curl -G "http://localhost:3000/search/ask" \
      --data-urlencode "q=What caused the recent payment failures?" \
      --data-urlencode "sessionId=<your-test-session-ID>"
    ```
  - **Session Persistence**: (Note: Phase 4 uses In-memory cache; Phase 5 uses Redis).
    ```bash
      curl -G "http://localhost:3000/search/ask" \
      --data-urlencode "q=What did I just asked you?" \
      --data-urlencode "sessionId=<your-test-session-ID>"
    ```
  - **Statistical Search**
    ```bash
      curl -G "http://localhost:3000/search/ask" \
      --data-urlencode "q=How many failures are happened within 48 hours?" \
      --data-urlencode "sessionId=<your-test-session-ID>"
    ```
- **Verification**: AI returns responses grounded in actual log data and session history.

### Phase 5: Production Hardening

![Phase5 Architecture](./docs/images/phase5.png)

Enhance system resilience using Kafka for decoupling, Redis for caching, and sampling strategies.

- **Environment Variables** (.env):

  ```bash
  PORT=3000
  LOG_FILE_PATH=logs/app.log

  MONGODB_URI=<your_mongodb_uri>

  # Embedding Model (Voyage AI)
  EMBEDDING_MODEL=voyage-3-lite
  EMBEDDING_MODEL_URI=https://api.voyageai.com/v1/embeddings
  EMBEDDING_MODEL_KEY=<your_voyage_ai_key>
  EMBEDDING_BATCH_CHUNK_SIZE=50

  # LLM (Gemini)
  RETRIEVING_MODEL=gemini-2.5-flash-lite
  RETRIEVING_MODEL_KEY=<your_gemini_api_key>
  RETRIEVING_MODEL_URI=<your_gemini_api_url>

  # Storage Strategy
  STORAGE_TYPE=kafka # Options: file, mongodb, kafka

  # Docker Compose
  # MQ (Kafka) Configuration
  MQ_ENABLED=true
  MQ_TYPE=kafka
  MQ_BROKER_ADDRESS=localhost:9092
  MQ_LOG_TOPIC=log-events
  MQ_CONSUMER_GROUP=log-consumer-group

  # Batch Processing
  MQ_BATCH_SIZE=100
  MQ_BATCH_TIMEOUT_MS=1000

  # Cache Strategy
  SESSION_CACHE_TYPE=redis # Options: memory, redis

  # Redis Configuration
  REDIS_HOST=localhost
  REDIS_PORT=6379

  # Log Sampling Configuration
  LOG_SAMPLING_NORMAL_RATE=0.01
  LOG_SLOW_THRESHOLD_MS=2000
  LOG_CRITICAL_ROUTES=/payments
  ```

- **Testing**: Simulate high-load scenarios or Kafka downtime to verify the **Direct-to-DB fallback** logic.
- **Verification**: Observe stable load management and zero-data-loss even during infrastructure interruptions.

---

## ✨ Author

- **orca1001**
