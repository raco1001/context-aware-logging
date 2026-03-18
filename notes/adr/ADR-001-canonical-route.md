# ADR-001: Canonical Route Definition

## Status
Accepted

## Date
2026-02-02

## Context

로깅 시스템에서 route 필드는 쿼리, 집계, 대시보드의 핵심 키입니다. 일관된 route 식별이 없으면:

1. **집계 품질 저하**: `/users/123`과 `/users/456`이 별도 route로 집계됨
2. **쿼리 복잡성 증가**: 동일 엔드포인트에 대해 여러 패턴 매칭 필요
3. **모니터링 신뢰도 하락**: 동일 API의 성능/에러율 분산 측정

### 기존 문제점

```typescript
// 기존 코드
`${request.method} ${request.route?.path || request.path}`
```

- `request.route?.path`가 환경/프레임워크 버전에 따라 비어있을 수 있음
- Base path (`/api/v1` 등)가 누락될 수 있음
- 쿼리스트링 포함 여부 불일치

## Decision

### Canonical Route 정의

**형식**: `METHOD /path`

**규칙**:
1. **Method**: 항상 대문자 (`GET`, `POST`, `PUT`, `DELETE`, ...)
2. **Path 우선순위**:
   - 1순위: Template path (`request.route?.path`) - 파라미터가 `:id` 형태로 유지됨
   - 2순위: Actual path (`request.path`) - 쿼리스트링 제외
3. **Base path**: `API_BASE_PATH` 환경변수로 정규화
4. **쿼리스트링**: 항상 제외

### 예시

| Request | Canonical Route |
|---------|-----------------|
| `GET /users/123?include=profile` | `GET /users/:id` (template 사용 시) |
| `POST /payments` | `POST /payments` |
| `GET /api/v1/orders/456` | `GET /api/v1/orders/:id` |

### 구현

`RouteNormalizer.normalize(request)` 함수가 위 규칙을 적용합니다.

```typescript
// backend/libs/logging/core/domain/route.normalizer.ts
export class RouteNormalizer {
  static normalize(request: Request): string {
    const method = request.method.toUpperCase();
    const templatePath = request.route?.path;
    const actualPath = request.path.split('?')[0];
    const basePath = process.env.API_BASE_PATH || '';
    
    const path = templatePath || actualPath;
    // ... base path 정규화
    
    return `${method} ${normalizedPath}`;
  }
}
```

## Consequences

### 긍정적

- **집계 품질 향상**: 동일 엔드포인트가 단일 route로 집계됨
- **쿼리 단순화**: route 필드로 직접 필터링 가능
- **일관성**: 모든 환경에서 동일한 route 식별자 생성
- **SamplingPolicy 호환**: `CRITICAL_ROUTES` 설정이 정확히 동작

### 부정적

- Template path를 사용할 수 없는 환경에서는 actual path fallback
  - 이 경우 `/users/123`과 `/users/456`이 별도로 집계됨
  - 해결책: NestJS 표준 사용 권장

### 중립적

- `API_BASE_PATH` 환경변수 설정 필요 (선택적)

## Related

- `backend/libs/logging/core/domain/route.normalizer.ts`
- `backend/libs/logging/core/domain/sampling.policy.ts` (CRITICAL_ROUTES)
- `backend/libs/logging/presentation/logging.interceptor.ts`
