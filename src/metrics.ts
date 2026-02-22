const DAY_MS = 24 * 60 * 60 * 1000;

export interface DailyResultPoint {
    date: string | Date;
    impressions: number | null;
    clicks: number | null;
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

function normalizeUtcDate(input: string | Date): Date {
    const date = new Date(input);
    date.setHours(0, 0, 0, 0);
    return date;
}

function roundToTwo(value: number): number {
    return Math.round(value * 100) / 100;
}

function computeCtrPercent(impressions: number, clicks: number): number {
    if (impressions <= 0) {
        return 0;
    }
    return roundToTwo((clicks / impressions) * 100);
}

export function computeEstimatedClicks(impressions: number, ctrPercent: number): number {
    const safeImpressions = Number.isFinite(impressions) ? Math.max(0, impressions) : 0;
    const safeCtrPercent = Number.isFinite(ctrPercent) ? Math.max(0, ctrPercent) : 0;
    return Math.round(safeImpressions * (safeCtrPercent / 100));
}

export function splitDailyResultsByVariant(
    dailyResults: DailyResultPoint[],
    startDate: string | Date
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

        const impressions = row.impressions ?? 0;
        const clicks = row.clicks ?? 0;
        const bucket = diffDays % 2 === 0 ? totals.a : totals.b;

        bucket.impressions += impressions;
        bucket.clicks += clicks;
    }

    totals.a.ctr = computeCtrPercent(totals.a.impressions, totals.a.clicks);
    totals.b.ctr = computeCtrPercent(totals.b.impressions, totals.b.clicks);

    return totals;
}

interface FinishedTestSummaryInput {
    id: string;
    start_date: string | Date;
}

interface DailyResultWithTestId extends DailyResultPoint {
    test_id: string;
}

export interface DashboardFinishedMetrics {
    avgCtrLift: number;
    extraClicks: number;
}

export function summarizeFinishedTestMetrics(
    finishedTests: FinishedTestSummaryInput[],
    dailyResults: DailyResultWithTestId[]
): DashboardFinishedMetrics {
    if (finishedTests.length === 0 || dailyResults.length === 0) {
        return { avgCtrLift: 0, extraClicks: 0 };
    }

    const rowsByTestId = new Map<string, DailyResultWithTestId[]>();
    for (const row of dailyResults) {
        const rows = rowsByTestId.get(row.test_id) ?? [];
        rows.push(row);
        rowsByTestId.set(row.test_id, rows);
    }

    const ctrLifts: number[] = [];
    let extraClicks = 0;

    for (const test of finishedTests) {
        const testRows = rowsByTestId.get(test.id) ?? [];
        const split = splitDailyResultsByVariant(testRows, test.start_date);
        const winner = split.a.ctr >= split.b.ctr ? split.a : split.b;
        const loser = split.a.ctr >= split.b.ctr ? split.b : split.a;

        if (winner.clicks > loser.clicks) {
            extraClicks += winner.clicks - loser.clicks;
        }

        if (loser.impressions > 0) {
            const lift = loser.ctr > 0 ? ((winner.ctr - loser.ctr) / loser.ctr) * 100 : 100;
            ctrLifts.push(lift);
        }
    }

    const avgCtrLift = ctrLifts.length > 0
        ? roundToTwo(ctrLifts.reduce((acc, curr) => acc + curr, 0) / ctrLifts.length)
        : 0;

    return {
        avgCtrLift,
        extraClicks
    };
}
