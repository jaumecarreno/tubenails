const DAY_MS = 24 * 60 * 60 * 1000;

export type VariantId = 'A' | 'B';

export interface DailyResultPoint {
    date: string | Date;
    impressions: number | string | null;
    clicks: number | string | null;
    views?: number | string | null;
    estimated_minutes_watched?: number | string | null;
    average_view_duration_seconds?: number | string | null;
    impressions_ctr?: number | string | null;
}

export interface VariantTotals {
    impressions: number;
    clicks: number;
    ctr: number;
}

export interface SplitVariantTotals {
    a: VariantTotals;
    b: VariantTotals;
}

export interface ScoreWeights {
    ctrWeight: number;
    qualityWeight: number;
}

export interface ScoringConfig {
    minImpressionsPerVariant: number;
    minConfidence: number;
    minCtrDeltaPctPoints: number;
    minScoreDelta: number;
    weights: ScoreWeights;
}

export interface VariantPerformance {
    variant: VariantId;
    exposureDays: number;
    impressions: number;
    estimatedClicks: number;
    ctr: number;
    impressionsCtr: number;
    views: number;
    estimatedMinutesWatched: number;
    averageViewDurationSeconds: number;
    wtpi: number;
    score: number;
    ctrNorm: number;
    wtpiNorm: number;
}

export interface SplitVariantPerformance {
    a: VariantPerformance;
    b: VariantPerformance;
    qualityAvailable: boolean;
}

export interface WinnerDecision {
    winnerVariant: VariantId | null;
    winnerMode: 'auto' | 'inconclusive' | 'pending';
    confidence: number;
    pValue: number;
    reviewRequired: boolean;
    reason: string;
    minExposureDaysPerVariant: number;
    guardrailsPassed: boolean;
    ctrDeltaPctPoints: number;
    scoreDelta: number;
}

interface FinishedTestSummaryInput {
    id: string;
    start_date: string | Date;
    initial_variant?: VariantId | null;
    winner_variant?: VariantId | null;
    winner_mode?: string | null;
    review_required?: boolean | null;
}

interface DailyResultWithTestId extends DailyResultPoint {
    test_id: string;
}

export interface DashboardFinishedMetrics {
    avgCtrLift: number;
    extraClicks: number;
    avgWtpiLift: number;
    extraWatchMinutes: number;
    inconclusiveCount: number;
}

function normalizeUtcDate(input: string | Date): Date {
    const date = new Date(input);
    date.setHours(0, 0, 0, 0);
    return date;
}

function round(value: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}

function safeNumber(value: number | string | null | undefined): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeWeightPair(weights: ScoreWeights): ScoreWeights {
    const ctr = Math.max(0, weights.ctrWeight);
    const quality = Math.max(0, weights.qualityWeight);
    const total = ctr + quality;
    if (total === 0) {
        return { ctrWeight: 1, qualityWeight: 0 };
    }
    return {
        ctrWeight: ctr / total,
        qualityWeight: quality / total
    };
}

function erf(x: number): number {
    const sign = x >= 0 ? 1 : -1;
    const absX = Math.abs(x);

    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const t = 1 / (1 + p * absX);
    const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX));
    return sign * y;
}

function normalCdf(x: number): number {
    return 0.5 * (1 + erf(x / Math.SQRT2));
}

function computeTwoProportionPValue(clicksA: number, impressionsA: number, clicksB: number, impressionsB: number): number {
    if (impressionsA <= 0 || impressionsB <= 0) {
        return 1;
    }

    const p1 = clicksA / impressionsA;
    const p2 = clicksB / impressionsB;
    const pooled = (clicksA + clicksB) / (impressionsA + impressionsB);
    const denominator = Math.sqrt(pooled * (1 - pooled) * ((1 / impressionsA) + (1 / impressionsB)));

    if (!Number.isFinite(denominator) || denominator === 0) {
        return 1;
    }

    const z = (p1 - p2) / denominator;
    const pValue = 2 * (1 - normalCdf(Math.abs(z)));
    if (!Number.isFinite(pValue)) {
        return 1;
    }
    return Math.min(1, Math.max(0, pValue));
}

function emptyVariantPerformance(variant: VariantId): VariantPerformance {
    return {
        variant,
        exposureDays: 0,
        impressions: 0,
        estimatedClicks: 0,
        ctr: 0,
        impressionsCtr: 0,
        views: 0,
        estimatedMinutesWatched: 0,
        averageViewDurationSeconds: 0,
        wtpi: 0,
        score: 0,
        ctrNorm: 0,
        wtpiNorm: 0
    };
}

function variantForDiffDays(diffDays: number, startVariant: VariantId): VariantId {
    if (diffDays % 2 === 0) {
        return startVariant;
    }
    return startVariant === 'A' ? 'B' : 'A';
}

function isRowVariantA(rowDate: Date, normalizedStartDate: Date, startVariant: VariantId): boolean {
    const diffDays = Math.floor((rowDate.getTime() - normalizedStartDate.getTime()) / DAY_MS);
    return variantForDiffDays(diffDays, startVariant) === 'A';
}

export function computeEstimatedClicks(impressions: number, ctrPercent: number): number {
    const safeImpressions = Number.isFinite(impressions) ? Math.max(0, impressions) : 0;
    const safeCtrPercent = Number.isFinite(ctrPercent) ? Math.max(0, ctrPercent) : 0;
    return Math.round(safeImpressions * (safeCtrPercent / 100));
}

export function splitDailyResultsByVariant(
    dailyResults: DailyResultPoint[],
    startDate: string | Date,
    startVariant: VariantId = 'A'
): SplitVariantTotals {
    const normalizedStartDate = normalizeUtcDate(startDate);
    const totals = {
        a: { impressions: 0, clicks: 0, ctr: 0 },
        b: { impressions: 0, clicks: 0, ctr: 0 }
    };

    for (const row of dailyResults) {
        const rowDate = normalizeUtcDate(row.date);
        const diffDays = Math.floor((rowDate.getTime() - normalizedStartDate.getTime()) / DAY_MS);
        if (diffDays < 0) {
            continue;
        }

        const impressions = safeNumber(row.impressions);
        const clicks = safeNumber(row.clicks);
        const bucket = variantForDiffDays(diffDays, startVariant) === 'A' ? totals.a : totals.b;

        bucket.impressions += impressions;
        bucket.clicks += clicks;
    }

    totals.a.ctr = totals.a.impressions > 0 ? round((totals.a.clicks / totals.a.impressions) * 100, 2) : 0;
    totals.b.ctr = totals.b.impressions > 0 ? round((totals.b.clicks / totals.b.impressions) * 100, 2) : 0;
    return totals;
}

export function computeVariantPerformance(
    dailyResults: DailyResultPoint[],
    startDate: string | Date,
    weights: ScoreWeights,
    startVariant: VariantId = 'A'
): SplitVariantPerformance {
    const normalizedStartDate = normalizeUtcDate(startDate);
    const normalizedWeights = normalizeWeightPair(weights);

    const a = emptyVariantPerformance('A');
    const b = emptyVariantPerformance('B');
    let hasQualitySignal = false;
    let aWeightedDurationAccumulator = 0;
    let bWeightedDurationAccumulator = 0;

    for (const row of dailyResults) {
        const rowDate = normalizeUtcDate(row.date);
        const diffDays = Math.floor((rowDate.getTime() - normalizedStartDate.getTime()) / DAY_MS);
        if (diffDays < 0) {
            continue;
        }

        const target = isRowVariantA(rowDate, normalizedStartDate, startVariant) ? a : b;
        target.exposureDays += 1;

        const impressions = safeNumber(row.impressions);
        const estimatedClicks = safeNumber(row.clicks);
        const views = safeNumber(row.views ?? row.clicks);
        const estimatedMinutesWatched = safeNumber(row.estimated_minutes_watched);
        const averageViewDurationSeconds = safeNumber(row.average_view_duration_seconds);
        const impressionsCtr = safeNumber(row.impressions_ctr);

        target.impressions += impressions;
        target.estimatedClicks += estimatedClicks;
        target.views += views;
        target.estimatedMinutesWatched += estimatedMinutesWatched;
        target.impressionsCtr += impressionsCtr;

        if (averageViewDurationSeconds > 0 && views > 0) {
            if (target.variant === 'A') {
                aWeightedDurationAccumulator += averageViewDurationSeconds * views;
            } else {
                bWeightedDurationAccumulator += averageViewDurationSeconds * views;
            }
        }

        if (estimatedMinutesWatched > 0) {
            hasQualitySignal = true;
        }
    }

    const all = [a, b];
    for (const variant of all) {
        variant.ctr = variant.impressions > 0
            ? round((variant.estimatedClicks / variant.impressions) * 100, 4)
            : 0;
        variant.impressionsCtr = variant.exposureDays > 0 ? round(variant.impressionsCtr / variant.exposureDays, 4) : 0;
        variant.wtpi = variant.impressions > 0
            ? round(variant.estimatedMinutesWatched / variant.impressions, 6)
            : 0;
    }

    if (a.views > 0) {
        a.averageViewDurationSeconds = round(aWeightedDurationAccumulator / a.views, 3);
    }
    if (b.views > 0) {
        b.averageViewDurationSeconds = round(bWeightedDurationAccumulator / b.views, 3);
    }

    const maxCtr = Math.max(a.ctr, b.ctr);
    const maxWtpi = Math.max(a.wtpi, b.wtpi);

    for (const variant of all) {
        variant.ctrNorm = maxCtr > 0 ? round(variant.ctr / maxCtr, 6) : 0;
        variant.wtpiNorm = maxWtpi > 0 ? round(variant.wtpi / maxWtpi, 6) : 0;

        if (hasQualitySignal && maxWtpi > 0) {
            variant.score = round(
                normalizedWeights.ctrWeight * variant.ctrNorm +
                normalizedWeights.qualityWeight * variant.wtpiNorm,
                6
            );
        } else {
            variant.score = round(variant.ctrNorm, 6);
        }
    }

    return {
        a,
        b,
        qualityAvailable: hasQualitySignal && maxWtpi > 0
    };
}

function chooseWinner(performance: SplitVariantPerformance): VariantId {
    if (performance.a.score > performance.b.score) {
        return 'A';
    }
    if (performance.b.score > performance.a.score) {
        return 'B';
    }
    if (performance.a.ctr > performance.b.ctr) {
        return 'A';
    }
    if (performance.b.ctr > performance.a.ctr) {
        return 'B';
    }
    return 'A';
}

export function evaluateWinnerDecision(
    performance: SplitVariantPerformance,
    durationDays: number,
    config: ScoringConfig,
    testCompleted: boolean
): WinnerDecision {
    const minExposureDaysPerVariant = Math.max(2, Math.floor(durationDays / 2));
    const pValue = computeTwoProportionPValue(
        performance.a.estimatedClicks,
        performance.a.impressions,
        performance.b.estimatedClicks,
        performance.b.impressions
    );
    const confidence = round(1 - pValue, 6);
    const ctrDeltaPctPoints = round(Math.abs(performance.a.ctr - performance.b.ctr), 4);
    const scoreDelta = round(Math.abs(performance.a.score - performance.b.score), 6);

    const hasExposure = performance.a.exposureDays >= minExposureDaysPerVariant &&
        performance.b.exposureDays >= minExposureDaysPerVariant;
    const hasImpressions = performance.a.impressions >= config.minImpressionsPerVariant &&
        performance.b.impressions >= config.minImpressionsPerVariant;
    const hasConfidence = confidence >= config.minConfidence;
    const hasCtrDelta = ctrDeltaPctPoints >= config.minCtrDeltaPctPoints;
    const hasScoreDelta = scoreDelta >= config.minScoreDelta;
    const guardrailsPassed = hasExposure && hasImpressions;

    const winnerVariant = chooseWinner(performance);
    const autoEligible = guardrailsPassed && hasConfidence && hasCtrDelta && hasScoreDelta;

    if (!testCompleted) {
        return {
            winnerVariant,
            winnerMode: 'pending',
            confidence,
            pValue: round(pValue, 6),
            reviewRequired: false,
            reason: autoEligible ? 'criteria_met_waiting_test_end' : 'test_in_progress',
            minExposureDaysPerVariant,
            guardrailsPassed,
            ctrDeltaPctPoints,
            scoreDelta
        };
    }

    if (autoEligible) {
        return {
            winnerVariant,
            winnerMode: 'auto',
            confidence,
            pValue: round(pValue, 6),
            reviewRequired: false,
            reason: 'auto_criteria_met',
            minExposureDaysPerVariant,
            guardrailsPassed,
            ctrDeltaPctPoints,
            scoreDelta
        };
    }

    const failures: string[] = [];
    if (!hasExposure) failures.push('insufficient_exposure_days');
    if (!hasImpressions) failures.push('insufficient_impressions');
    if (!hasConfidence) failures.push('insufficient_confidence');
    if (!hasCtrDelta) failures.push('insufficient_ctr_delta');
    if (!hasScoreDelta) failures.push('insufficient_score_delta');

    return {
        winnerVariant: null,
        winnerMode: 'inconclusive',
        confidence,
        pValue: round(pValue, 6),
        reviewRequired: true,
        reason: failures.join(','),
        minExposureDaysPerVariant,
        guardrailsPassed,
        ctrDeltaPctPoints,
        scoreDelta
    };
}

export function summarizeFinishedTestMetrics(
    finishedTests: FinishedTestSummaryInput[],
    dailyResults: DailyResultWithTestId[],
    weights: ScoreWeights
): DashboardFinishedMetrics {
    if (finishedTests.length === 0 || dailyResults.length === 0) {
        return { avgCtrLift: 0, extraClicks: 0, avgWtpiLift: 0, extraWatchMinutes: 0, inconclusiveCount: 0 };
    }

    const rowsByTestId = new Map<string, DailyResultWithTestId[]>();
    for (const row of dailyResults) {
        const rows = rowsByTestId.get(row.test_id) ?? [];
        rows.push(row);
        rowsByTestId.set(row.test_id, rows);
    }

    const ctrLifts: number[] = [];
    const wtpiLifts: number[] = [];
    let extraClicks = 0;
    let extraWatchMinutes = 0;
    let inconclusiveCount = 0;

    for (const test of finishedTests) {
        if (test.winner_mode === 'inconclusive' || test.review_required) {
            inconclusiveCount += 1;
        }

        const testRows = rowsByTestId.get(test.id) ?? [];
        const performance = computeVariantPerformance(
            testRows,
            test.start_date,
            weights,
            test.initial_variant ?? 'A'
        );

        let winner: VariantPerformance;
        let loser: VariantPerformance;

        if (test.winner_variant === 'A') {
            winner = performance.a;
            loser = performance.b;
        } else if (test.winner_variant === 'B') {
            winner = performance.b;
            loser = performance.a;
        } else {
            winner = chooseWinner(performance) === 'A' ? performance.a : performance.b;
            loser = winner.variant === 'A' ? performance.b : performance.a;
        }

        if (winner.estimatedClicks > loser.estimatedClicks) {
            extraClicks += winner.estimatedClicks - loser.estimatedClicks;
        }
        if (winner.estimatedMinutesWatched > loser.estimatedMinutesWatched) {
            extraWatchMinutes += winner.estimatedMinutesWatched - loser.estimatedMinutesWatched;
        }

        if (loser.impressions > 0 && loser.ctr > 0) {
            ctrLifts.push(((winner.ctr - loser.ctr) / loser.ctr) * 100);
        }
        if (loser.impressions > 0 && loser.wtpi > 0) {
            wtpiLifts.push(((winner.wtpi - loser.wtpi) / loser.wtpi) * 100);
        }
    }

    const avgCtrLift = ctrLifts.length > 0
        ? round(ctrLifts.reduce((acc, curr) => acc + curr, 0) / ctrLifts.length, 2)
        : 0;
    const avgWtpiLift = wtpiLifts.length > 0
        ? round(wtpiLifts.reduce((acc, curr) => acc + curr, 0) / wtpiLifts.length, 2)
        : 0;

    return {
        avgCtrLift,
        extraClicks: Math.round(extraClicks),
        avgWtpiLift,
        extraWatchMinutes: round(extraWatchMinutes, 2),
        inconclusiveCount
    };
}
