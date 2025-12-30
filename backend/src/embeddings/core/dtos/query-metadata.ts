export interface QueryMetadata {
  startTime: Date | null;
  endTime: Date | null;
  service: string | null;
  errorCode: string | null;
  hasError: boolean; // "failed cases", "errors" 등의 키워드 감지
}
