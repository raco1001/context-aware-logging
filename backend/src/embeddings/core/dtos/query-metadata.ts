export interface QueryMetadata {
  startTime: Date | null;
  endTime: Date | null;
  service: string | null;
  route: string | null;
  errorCode: string | null;
  hasError: boolean;
}
