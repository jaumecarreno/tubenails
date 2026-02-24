import { describe, expect, it } from 'vitest';
import {
    buildDailyVariantResults,
    getCurrentInternalState,
    TestHistoryDailyResultRecord,
    TestHistoryTestRecord,
    TestVariantEventRecord
} from '../src/test-history';

function buildTestRecord(overrides: Partial<TestHistoryTestRecord> = {}): TestHistoryTestRecord {
    return {
        start_date: '2026-01-01T00:00:00.000Z',
        current_variant: 'A',
        title_a: 'Control title',
        title_b: 'Test title',
        thumbnail_url_a: 'https://example.com/a.jpg',
        thumbnail_url_b: 'https://example.com/b.jpg',
        ...overrides
    };
}

function buildDailyRows(): TestHistoryDailyResultRecord[] {
    return [
        {
            date: '2026-01-01',
            impressions: 100,
            clicks: 10,
            views: 10,
            estimated_minutes_watched: 12,
            average_view_duration_seconds: 72,
            impressions_ctr: 10
        },
        {
            date: '2026-01-02',
            impressions: 100,
            clicks: 8,
            views: 8,
            estimated_minutes_watched: 8,
            average_view_duration_seconds: 60,
            impressions_ctr: 8
        },
        {
            date: '2026-01-03',
            impressions: 150,
            clicks: 15,
            views: 15,
            estimated_minutes_watched: 18,
            average_view_duration_seconds: 72,
            impressions_ctr: 10
        }
    ];
}

describe('test history helpers', () => {
    it('builds inferred daily variants when no exact events exist', () => {
        const test = buildTestRecord();
        const rows = buildDailyRows();

        const current = getCurrentInternalState(test, []);
        const daily = buildDailyVariantResults(test, rows, []);

        expect(current.variant).toBe('A');
        expect(current.title).toBe('Control title');
        expect(current.thumbnailUrl).toBe('https://example.com/a.jpg');
        expect(current.sinceSource).toBe('inferred');
        expect(current.since).toBe('2026-01-01T00:00:00.000Z');

        expect(daily).toHaveLength(3);
        expect(daily[0].variant).toBe('A');
        expect(daily[1].variant).toBe('B');
        expect(daily[2].variant).toBe('A');
        expect(daily.every((row) => row.source === 'inferred')).toBe(true);
    });

    it('uses exact events over inferred parity for daily mapping and current state', () => {
        const test = buildTestRecord({ current_variant: 'B' });
        const rows = buildDailyRows();
        const events: TestVariantEventRecord[] = [
            {
                id: 'evt-1',
                variant: 'A',
                source: 'test_created',
                changed_at: '2026-01-01T00:00:00.000Z',
                changed_by_user_id: 'user-1'
            },
            {
                id: 'evt-2',
                variant: 'B',
                source: 'daily_rotation',
                changed_at: '2026-01-02T00:01:00.000Z',
                changed_by_user_id: null
            }
        ];

        const current = getCurrentInternalState(test, events);
        const daily = buildDailyVariantResults(test, rows, events);

        expect(current.variant).toBe('B');
        expect(current.title).toBe('Test title');
        expect(current.since).toBe('2026-01-02T00:01:00.000Z');
        expect(current.sinceSource).toBe('exact');

        expect(daily[0].variant).toBe('A');
        expect(daily[1].variant).toBe('B');
        expect(daily[2].variant).toBe('B');
        expect(daily[0].source).toBe('exact');
        expect(daily[1].source).toBe('exact');
        expect(daily[2].source).toBe('exact');
        expect(daily[2].title).toBe('Test title');
        expect(daily[2].thumbnailUrl).toBe('https://example.com/b.jpg');
    });
});
