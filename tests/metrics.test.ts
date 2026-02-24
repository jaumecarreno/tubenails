import { describe, expect, it } from 'vitest';
import {
    computeVariantPerformance,
    computeEstimatedClicks,
    evaluateWinnerDecision,
    splitDailyResultsByVariant,
    VariantPerformance,
    summarizeFinishedTestMetrics
} from '../src/metrics';

describe('metrics helpers', () => {
    const defaultWeights = { ctrWeight: 0.7, qualityWeight: 0.3 };

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

    it('supports starting in variant B for day parity split', () => {
        const split = splitDailyResultsByVariant(
            [
                { date: '2026-01-01', impressions: 100, clicks: 10 },
                { date: '2026-01-02', impressions: 120, clicks: 12 },
                { date: '2026-01-03', impressions: 80, clicks: 8 }
            ],
            '2026-01-01',
            'B'
        );

        expect(split.a.impressions).toBe(120);
        expect(split.a.clicks).toBe(12);
        expect(split.b.impressions).toBe(180);
        expect(split.b.clicks).toBe(18);
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
            ],
            defaultWeights
        );

        expect(summary.extraClicks).toBe(15);
        expect(summary.avgCtrLift).toBe(75);
        expect(summary.avgWtpiLift).toBe(0);
        expect(summary.extraWatchMinutes).toBe(0);
        expect(summary.inconclusiveCount).toBe(0);
    });

    it('computes 70/30 score using CTR + watch-time per impression', () => {
        const performance = computeVariantPerformance(
            [
                {
                    date: '2026-01-01',
                    impressions: 100,
                    clicks: 10,
                    views: 10,
                    estimated_minutes_watched: 10,
                    average_view_duration_seconds: 60,
                    impressions_ctr: 10
                },
                {
                    date: '2026-01-02',
                    impressions: 100,
                    clicks: 12,
                    views: 12,
                    estimated_minutes_watched: 8,
                    average_view_duration_seconds: 40,
                    impressions_ctr: 12
                }
            ],
            '2026-01-01',
            defaultWeights
        );

        expect(performance.qualityAvailable).toBe(true);
        expect(performance.a.ctr).toBe(10);
        expect(performance.b.ctr).toBe(12);
        expect(performance.a.wtpi).toBe(0.1);
        expect(performance.b.wtpi).toBe(0.08);
        expect(performance.a.score).toBeCloseTo(0.883333, 5);
        expect(performance.b.score).toBeCloseTo(0.94, 5);
    });

    it('degrades to CTR-only score when quality metrics are unavailable', () => {
        const performance = computeVariantPerformance(
            [
                {
                    date: '2026-01-01',
                    impressions: 100,
                    clicks: 10,
                    views: 10,
                    estimated_minutes_watched: 0,
                    average_view_duration_seconds: 0,
                    impressions_ctr: 10
                },
                {
                    date: '2026-01-02',
                    impressions: 100,
                    clicks: 12,
                    views: 12,
                    estimated_minutes_watched: 0,
                    average_view_duration_seconds: 0,
                    impressions_ctr: 12
                }
            ],
            '2026-01-01',
            defaultWeights
        );

        expect(performance.qualityAvailable).toBe(false);
        expect(performance.a.score).toBe(performance.a.ctrNorm);
        expect(performance.b.score).toBe(performance.b.ctrNorm);
    });

    it('returns auto winner only when strict confidence and deltas are met', () => {
        const buildVariant = (
            variant: 'A' | 'B',
            overrides: Partial<VariantPerformance>
        ): VariantPerformance => ({
            variant,
            exposureDays: 7,
            impressions: 5000,
            estimatedClicks: variant === 'A' ? 250 : 200,
            ctr: variant === 'A' ? 5 : 4,
            impressionsCtr: variant === 'A' ? 5 : 4,
            views: variant === 'A' ? 250 : 200,
            estimatedMinutesWatched: variant === 'A' ? 600 : 450,
            averageViewDurationSeconds: variant === 'A' ? 144 : 135,
            wtpi: variant === 'A' ? 0.12 : 0.09,
            score: variant === 'A' ? 1 : 0.86,
            ctrNorm: variant === 'A' ? 1 : 0.8,
            wtpiNorm: variant === 'A' ? 1 : 0.75,
            ...overrides
        });

        const decision = evaluateWinnerDecision(
            {
                a: buildVariant('A', {}),
                b: buildVariant('B', {}),
                qualityAvailable: true
            },
            14,
            {
                minImpressionsPerVariant: 1500,
                minConfidence: 0.95,
                minCtrDeltaPctPoints: 0.2,
                minScoreDelta: 0.02,
                weights: defaultWeights
            },
            true
        );

        expect(decision.winnerMode).toBe('auto');
        expect(decision.winnerVariant).toBe('A');
        expect(decision.reviewRequired).toBe(false);
        expect(decision.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it('marks completed tests as inconclusive when guardrails are not met', () => {
        const decision = evaluateWinnerDecision(
            {
                a: {
                    variant: 'A',
                    exposureDays: 1,
                    impressions: 400,
                    estimatedClicks: 20,
                    ctr: 5,
                    impressionsCtr: 5,
                    views: 20,
                    estimatedMinutesWatched: 3,
                    averageViewDurationSeconds: 9,
                    wtpi: 0.0075,
                    score: 0.95,
                    ctrNorm: 1,
                    wtpiNorm: 0.5
                },
                b: {
                    variant: 'B',
                    exposureDays: 1,
                    impressions: 380,
                    estimatedClicks: 18,
                    ctr: 4.7368,
                    impressionsCtr: 4.7368,
                    views: 18,
                    estimatedMinutesWatched: 2,
                    averageViewDurationSeconds: 6.666,
                    wtpi: 0.0052,
                    score: 0.9,
                    ctrNorm: 0.9473,
                    wtpiNorm: 0.6933
                },
                qualityAvailable: true
            },
            14,
            {
                minImpressionsPerVariant: 1500,
                minConfidence: 0.95,
                minCtrDeltaPctPoints: 0.2,
                minScoreDelta: 0.02,
                weights: defaultWeights
            },
            true
        );

        expect(decision.winnerMode).toBe('inconclusive');
        expect(decision.winnerVariant).toBeNull();
        expect(decision.reviewRequired).toBe(true);
        expect(decision.reason).toContain('insufficient_exposure_days');
    });

    it('keeps pending mode while test is still running', () => {
        const decision = evaluateWinnerDecision(
            {
                a: {
                    variant: 'A',
                    exposureDays: 1,
                    impressions: 400,
                    estimatedClicks: 20,
                    ctr: 5,
                    impressionsCtr: 5,
                    views: 20,
                    estimatedMinutesWatched: 3,
                    averageViewDurationSeconds: 9,
                    wtpi: 0.0075,
                    score: 0.95,
                    ctrNorm: 1,
                    wtpiNorm: 0.5
                },
                b: {
                    variant: 'B',
                    exposureDays: 1,
                    impressions: 380,
                    estimatedClicks: 18,
                    ctr: 4.7368,
                    impressionsCtr: 4.7368,
                    views: 18,
                    estimatedMinutesWatched: 2,
                    averageViewDurationSeconds: 6.666,
                    wtpi: 0.0052,
                    score: 0.9,
                    ctrNorm: 0.9473,
                    wtpiNorm: 0.6933
                },
                qualityAvailable: true
            },
            14,
            {
                minImpressionsPerVariant: 1500,
                minConfidence: 0.95,
                minCtrDeltaPctPoints: 0.2,
                minScoreDelta: 0.02,
                weights: defaultWeights
            },
            false
        );

        expect(decision.winnerMode).toBe('pending');
        expect(decision.reviewRequired).toBe(false);
    });

    it('keeps pending mode even when thresholds are met before test ends', () => {
        const decision = evaluateWinnerDecision(
            {
                a: {
                    variant: 'A',
                    exposureDays: 7,
                    impressions: 5000,
                    estimatedClicks: 250,
                    ctr: 5,
                    impressionsCtr: 5,
                    views: 250,
                    estimatedMinutesWatched: 600,
                    averageViewDurationSeconds: 144,
                    wtpi: 0.12,
                    score: 1,
                    ctrNorm: 1,
                    wtpiNorm: 1
                },
                b: {
                    variant: 'B',
                    exposureDays: 7,
                    impressions: 5000,
                    estimatedClicks: 200,
                    ctr: 4,
                    impressionsCtr: 4,
                    views: 200,
                    estimatedMinutesWatched: 450,
                    averageViewDurationSeconds: 135,
                    wtpi: 0.09,
                    score: 0.86,
                    ctrNorm: 0.8,
                    wtpiNorm: 0.75
                },
                qualityAvailable: true
            },
            14,
            {
                minImpressionsPerVariant: 1500,
                minConfidence: 0.95,
                minCtrDeltaPctPoints: 0.2,
                minScoreDelta: 0.02,
                weights: defaultWeights
            },
            false
        );

        expect(decision.winnerMode).toBe('pending');
        expect(decision.reason).toBe('criteria_met_waiting_test_end');
    });
});
