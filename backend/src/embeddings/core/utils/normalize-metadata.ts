import { QueryMetadata } from '@embeddings/dtos';
import { SERVICE_MAP_CONSTANTS } from '@embeddings/value-objects/constants';

function safeDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeErrorCode(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

function normalizeService(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase();
  return SERVICE_MAP_CONSTANTS[key] ?? trimmed;
}

function stripQueryString(path: string): string {
  const idx = path.indexOf('?');
  return idx === -1 ? path : path.slice(0, idx);
}

function ensureLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function normalizeRoute(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // If already in "METHOD /path" form
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    const method = parts[0].toUpperCase();
    const path = ensureLeadingSlash(stripQueryString(parts.slice(1).join(' ')));
    return `${method} ${path}`;
  }

  // If only "/path" provided
  const pathOnly = ensureLeadingSlash(stripQueryString(trimmed));
  return pathOnly;
}

export function normalizeMetadata(raw: QueryMetadata): QueryMetadata {
  const startTime = safeDateOrNull(raw.startTime);
  const endTime = safeDateOrNull(raw.endTime);

  const service = normalizeService(raw.service);
  const route = normalizeRoute(raw.route);
  const errorCode = normalizeErrorCode(raw.errorCode);

  const hasError = raw.hasError || !!errorCode;

  return {
    startTime,
    endTime,
    service,
    route,
    errorCode,
    hasError,
  };
}

