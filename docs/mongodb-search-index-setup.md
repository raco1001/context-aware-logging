# MongoDB Vector Search Index 설정 가이드

## 문제 상황

`wide_events_embedded` 컬렉션에 Search Index가 없어서 `$vectorSearch`가 작동하지 않습니다.

## 해결 방법

### 방법 1: MongoDB Atlas UI에서 생성 (권장)

1. MongoDB Atlas 콘솔에 접속
2. Database → Browse Collections → `wide_events_embedded` 선택
3. "Search Indexes" 탭 클릭
4. "Create Search Index" 클릭
5. "JSON Editor" 선택
6. 다음 JSON 입력:

```json
{
  "name": "embedding_index",
  "type": "vectorSearch",
  "definition": {
    "fields": [
      {
        "type": "vector",
        "path": "embedding",
        "numDimensions": 512,
        "similarity": "cosine"
      },
      {
        "type": "filter",
        "path": "eventId"
      },
      {
        "type": "filter",
        "path": "timestamp"
      },
      {
        "type": "filter",
        "path": "createdAt"
      },
      {
        "type": "filter",
        "path": "service"
      }
    ]
  }
}
```

7. "Next" → "Create Search Index" 클릭
8. 인덱스가 "Ready" 상태가 될 때까지 대기 (보통 몇 분 소요)

### 방법 2: MongoDB Shell에서 생성

```javascript
use wide_events;

db.wide_events_embedded.createSearchIndex({
  name: "embedding_index",
  type: "vectorSearch",
  definition: {
    fields: [
      {
        type: "vector",
        path: "embedding",
        numDimensions: 512,
        similarity: "cosine"
      },
      {
        type: "filter",
        path: "eventId"
      },
      {
        type: "filter",
        path: "createdAt"
      },
      {
        type: "filter",
        path: "service"
      }
    ]
  }
});
```

### 방법 3: 초기화 스크립트 재실행

초기화 스크립트(`docker/mongo/mongodb-init.js`)에 인덱스 생성 코드가 있습니다.
컨테이너를 재시작하면 자동으로 생성됩니다:

```bash
docker-compose restart mongodb
```

또는 MongoDB Shell에서 직접 실행:

```bash
docker exec -i <mongodb-container-name> mongosh -u eventsAdmin -p eventsAdmin --authenticationDatabase wide_events < docker/mongo/mongodb-init.js
```

## 인덱스 상태 확인

```javascript
use wide_events;

// Search Index 목록 확인
db.wide_events_embedded.listSearchIndexes();

// 특정 인덱스 상태 확인
db.wide_events_embedded.getSearchIndex("embedding_index");
```

## 중요 사항

⚠️ **MongoDB Atlas만 지원**: Vector Search는 MongoDB Atlas에서만 사용 가능합니다.

- 로컬 MongoDB (Community Edition)에서는 작동하지 않습니다.
- MongoDB Atlas M0 (Free Tier) 이상이 필요합니다.

⚠️ **인덱스 생성 시간**: Search Index 생성은 몇 분에서 수십 분이 걸릴 수 있습니다.

- 인덱스가 "Ready" 상태가 되어야 사용 가능합니다.
- "Building" 상태에서는 사용할 수 없습니다.

⚠️ **임베딩 차원 확인**: `numDimensions: 512`는 Voyage AI 모델의 기본 차원입니다.

- 다른 모델을 사용한다면 차원 수를 확인하고 수정해야 합니다.

## 문제 해결

### 인덱스가 생성되지 않는 경우

1. MongoDB Atlas 계정 확인
2. 클러스터가 M0 이상인지 확인
3. 네트워크 연결 확인
4. 권한 확인 (readWrite 권한 필요)

### 인덱스는 있지만 검색이 안 되는 경우

1. 인덱스 상태가 "Ready"인지 확인
2. 임베딩 데이터가 실제로 있는지 확인: `db.wide_events_embedded.countDocuments()`
3. 임베딩 차원이 인덱스 설정과 일치하는지 확인
4. 로그에서 에러 메시지 확인
