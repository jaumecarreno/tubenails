import { describe, expect, it } from 'vitest';
import {
    computeEstimatedClicks,
    splitDailyResultsByVariant,
    summarizeFinishedTestMetrics
} from '../src/metrics';

describe('metrics helpers', () => {
    it('computes estimated clicks from impression CTR percentage', () => {
        expect(computeEstimatedClicks(1000, 5)).toBe(50);
        expect(computeEstimatedClicks(1000, 0.5)).toBe(5);
        expect(computeEstimatedClicks(1000, 0)).toBe(0);
    });

    it('splits daily rows into variant A/B buckets based on day parity', () => {
        const split = splitDailyResultsByVariant(
            [
                { date: '2026-01-01', impressions: 100, clicks: 10 },
                { date: '2026-01-02', impressions: 120, clicks: 12 },
                { date: '2026-01-03', impressions: 80, clicks: 8 }
            ],
            '2026-01-01'
        );

        expect(split.a.impressions).toBe(180);
        expect(split.a.clicks).toBe(18);
        expect(split.a.ctr).toBe(10);
        expect(split.b.impressions).toBe(120);
        expect(split.b.clicks).toBe(12);
        expect(split.b.ctr).toBe(10);
    });

    it('summarizes finished-test lift and extra clicks', () => {
        const summary = summarizeFinishedTestMetrics(
            [
                { id: 'test-1', start_date: '2026-01-01' },
                { id: 'test-2', start_date: '2026-01-01' }
            ],
            [
                { test_id: 'test-1', date: '2026-01-01', impressions: 100, clicks: 10 },
                { test_id: 'test-1', date: '2026-01-02', impressions: 100, clicks: 15 },
                { test_id: 'test-2', date: '2026-01-01', impressions: 200, clicks: 20 },
                { test_id: 'test-2', date: '2026-01-02', impressions: 200, clicks: 10 }
            ]
        );

        expect(summary.extraClicks).toBe(15);
        expect(summary.avgCtrLift).toBe(75);
    });
});
