import { VariantId } from './metrics';

const DAY_MS = 24 * 60 * 60 * 1000;

export type VariantEventSource =
    | 'test_created'
    | 'daily_rotation'
    | 'auto_winner'
    | 'manual_winner'
    | 'inconclusive_revert';

export type DailyVariantSource = 'exact' | 'inferred';

export interface TestVariantEventRecord {
    id: string;
    variant: VariantId;
    source: VariantEventSource;
    changed_at: string | Date;
    changed_by_user_id: string | null;
}

export interface TestHistoryTestRecord {
    start_date: string | Date;
    initial_variant: VariantId;
    current_variant: VariantId;
    title_a: string;
    title_b: string;
    thumbnail_url_a: string;
    thumbnail_url_b: string;
}

export interface TestHistoryDailyResultRecord {
    date: string | Date;
    impressions: number | string | null;
    clicks: number | string | null;
    views: number | string | null;
    estimated_minutes_watched: number | string | null;
    average_view_duration_seconds: number | string | null;
    impressions_ctr: number | string | null;
}

export interface CurrentInternalState {
    variant: VariantId;
    title: string;
    thumbnailUrl: string;
    since: string;
    sinceSource: DailyVariantSource;
}

export interface DailyVariantResult {
    date: string;
    variant: VariantId;
    source: DailyVariantSource;
    title: string;
    thumbnailUrl: string;
    impressions: number;
    clicks: number;
    views: number;
    estimated_minutes_watched: number;
    average_view_duration_seconds: number;
    impressions_ctr: number;
    ctr: number;
}

function toSafeNumber(value: number | string | null | undefined): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeUtcDate(input: string | Date): Date {
    const date = new Date(input);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDate(input: string | Date): Date {
    const start = normalizeUtcDate(input);
    return new Date(start.getTime() + DAY_MS - 1);
}

function toIsoDateKey(input: string | Date): string {
    return normalizeUtcDate(input).toISOString().slice(0, 10);
}

function inferVariantForDate(day: string | Date, startDate: string | Date, startVariant: VariantId): VariantId {
    const diffDays = Math.floor((normalizeUtcDate(day).getTime() - normalizeUtcDate(startDate).getTime()) / DAY_MS);
    if (diffDays % 2 === 0) {
        return startVariant;
    }
    return startVariant === 'A' ? 'B' : 'A';
}

function assetsForVariant(test: TestHistoryTestRecord, variant: VariantId): { title: string; thumbnailUrl: string } {
    return variant === 'A'
        ? { title: test.title_a, thumbnailUrl: test.thumbnail_url_a }
        : { title: test.title_b, thumbnailUrl: test.thumbnail_url_b };
}

export function isVariantEventSource(value: string): value is VariantEventSource {
    return value === 'test_created' ||
        value === 'daily_rotation' ||
        value === 'auto_winner' ||
        value === 'manual_winner' ||
        value === 'inconclusive_revert';
}

export function getCurrentInternalState(
    test: TestHistoryTestRecord,
    events: TestVariantEventRecord[]
): CurrentInternalState {
    const sortedEvents = [...events].sort(
        (a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime()
    );
    const latestEvent = sortedEvents[0];
    const activeVariant = latestEvent?.variant ?? test.current_variant;
    const assets = assetsForVariant(test, activeVariant);

    return {
        variant: activeVariant,
        title: assets.title,
        thumbnailUrl: assets.thumbnailUrl,
        since: new Date(latestEvent?.changed_at ?? test.start_date).toISOString(),
        sinceSource: latestEvent ? 'exact' : 'inferred'
    };
}

export function buildDailyVariantResults(
    test: TestHistoryTestRecord,
    dailyResults: TestHistoryDailyResultRecord[],
    events: TestVariantEventRecord[]
): DailyVariantResult[] {
    const sortedEvents = [...events].sort(
        (a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime()
    );
    const sortedDaily = [...dailyResults].sort(
        (a, b) => normalizeUtcDate(a.date).getTime() - normalizeUtcDate(b.date).getTime()
    );

    const response: DailyVariantResult[] = [];
    let activeEvent: TestVariantEventRecord | null = null;
    let eventIndex = 0;

    for (const row of sortedDaily) {
        const dayEnd = endOfUtcDate(row.date).getTime();
        while (
            eventIndex < sortedEvents.length &&
            new Date(sortedEvents[eventIndex].changed_at).getTime() <= dayEnd
        ) {
            activeEvent = sortedEvents[eventIndex];
            eventIndex += 1;
        }

        const variant = activeEvent?.variant ?? inferVariantForDate(row.date, test.start_date, test.initial_variant);
        const source: DailyVariantSource = activeEvent ? 'exact' : 'inferred';
        const assets = assetsForVariant(test, variant);
        const impressions = toSafeNumber(row.impressions);
        const clicks = toSafeNumber(row.clicks);
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;

        response.push({
            date: toIsoDateKey(row.date),
            variant,
            source,
            title: assets.title,
            thumbnailUrl: assets.thumbnailUrl,
            impressions,
            clicks,
            views: toSafeNumber(row.views),
            estimated_minutes_watched: toSafeNumber(row.estimated_minutes_watched),
            average_view_duration_seconds: toSafeNumber(row.average_view_duration_seconds),
            impressions_ctr: toSafeNumber(row.impressions_ctr),
            ctr
        });
    }

    return response;
}
