import { AggregationHelper, MAX_SERIES_BUCKETS } from './aggregation-helper';

describe('AggregationHelper.resolveSeriesTimeBucket', () => {
  it('defaults to hour when bounds missing', () => {
    expect(AggregationHelper.resolveSeriesTimeBucket(null, null)).toEqual({
      unit: 'hour',
      dateToStringFormat: '%Y-%m-%dT%H:00:00.000Z',
    });
  });

  it('uses second bins with bounded binSize for spans up to 30 minutes', () => {
    const start = new Date('2026-03-21T08:00:00.000Z');
    const end = new Date('2026-03-21T08:30:00.000Z');
    expect(AggregationHelper.resolveSeriesTimeBucket(start, end)).toEqual({
      unit: 'second',
      binSize: 4,
      dateToStringFormat: '%Y-%m-%dT%H:%M:%S.000Z',
    });
  });

  it('uses second with binSize 1 when span is short enough to stay under max buckets', () => {
    const start = new Date('2026-03-21T08:00:00.000Z');
    const end = new Date('2026-03-21T08:05:00.000Z');
    expect(AggregationHelper.resolveSeriesTimeBucket(start, end)).toEqual({
      unit: 'second',
      binSize: 1,
      dateToStringFormat: '%Y-%m-%dT%H:%M:%S.000Z',
    });
  });

  it('uses minute for spans over 30 minutes and up to 2 hours', () => {
    const start = new Date('2026-03-21T08:00:00.000Z');
    const end = new Date('2026-03-21T08:31:00.000Z');
    expect(AggregationHelper.resolveSeriesTimeBucket(start, end)).toEqual({
      unit: 'minute',
      dateToStringFormat: '%Y-%m-%dT%H:%M:00.000Z',
    });
  });

  it('uses minute for spans over 30m and up to 2 hours (wide range)', () => {
    const start = new Date('2026-03-21T08:00:00.000Z');
    const end = new Date('2026-03-21T09:30:00.000Z');
    expect(AggregationHelper.resolveSeriesTimeBucket(start, end)).toEqual({
      unit: 'minute',
      dateToStringFormat: '%Y-%m-%dT%H:%M:00.000Z',
    });
  });

  it('never exceeds MAX_SERIES_BUCKETS implied buckets for second windows', () => {
    const start = new Date('2026-03-21T08:00:00.000Z');
    const end = new Date('2026-03-21T08:30:00.000Z');
    const { unit, binSize } = AggregationHelper.resolveSeriesTimeBucket(start, end);
    const spanSec = (end.getTime() - start.getTime()) / 1000;
    expect(unit).toBe('second');
    expect(binSize).toBeGreaterThanOrEqual(1);
    expect(Math.ceil(spanSec / (binSize ?? 1))).toBeLessThanOrEqual(MAX_SERIES_BUCKETS);
  });

  it('uses hour for spans over 2h and up to 2 days', () => {
    const start = new Date('2026-03-20T09:00:00.000Z');
    const end = new Date('2026-03-21T09:00:00.000Z');
    expect(AggregationHelper.resolveSeriesTimeBucket(start, end)).toEqual({
      unit: 'hour',
      dateToStringFormat: '%Y-%m-%dT%H:00:00.000Z',
    });
  });

  it('uses day for spans over 2 days and up to 60 days', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const end = new Date('2026-01-10T00:00:00.000Z');
    expect(AggregationHelper.resolveSeriesTimeBucket(start, end)).toEqual({
      unit: 'day',
      dateToStringFormat: '%Y-%m-%dT00:00:00.000Z',
    });
  });

  it('uses week for spans over 60 days', () => {
    const start = new Date('2025-01-01T00:00:00.000Z');
    const end = new Date('2026-03-21T00:00:00.000Z');
    expect(AggregationHelper.resolveSeriesTimeBucket(start, end)).toEqual({
      unit: 'week',
      dateToStringFormat: '%Y-%m-%dT00:00:00.000Z',
    });
  });
});
