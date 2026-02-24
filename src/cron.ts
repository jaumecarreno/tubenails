import cron from 'node-cron';
import { PoolClient } from 'pg';
import { pool } from './db';
import { getDailyAnalytics, updateVideoThumbnail, updateVideoTitle } from './youtube';
import {
    computeEstimatedClicks,
    computeVariantPerformance,
    evaluateWinnerDecision,
    ScoringConfig,
    ScoreWeights,
    VariantId
} from './metrics';
import { VariantEventSource } from './test-history';

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getEnvNumber(name: string, fallback: number): number {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function getEnvBoolean(name: string, fallback: boolean): boolean {
    const value = process.env[name];
    if (!value) {
        return fallback;
    }
    return value.toLowerCase() === 'true';
}

function getScoringConfig(): ScoringConfig {
    const ctrWeight = getEnvNumber('SCORING_CTR_WEIGHT', 0.70);
    const qualityWeight = getEnvNumber('SCORING_QUALITY_WEIGHT', 0.30);
    const weights: ScoreWeights = { ctrWeight, qualityWeight };

    return {
        minImpressionsPerVariant: getEnvNumber('MIN_IMPRESSIONS_PER_VARIANT', 1500),
        minConfidence: getEnvNumber('MIN_CONFIDENCE', 0.95),
        minCtrDeltaPctPoints: getEnvNumber('MIN_CTR_DELTA_PCT_POINTS', 0.20),
        minScoreDelta: getEnvNumber('MIN_SCORE_DELTA', 0.02),
        weights
    };
}

function selectVariantAssets(
    variant: VariantId,
    titleA: string,
    titleB: string,
    thumbnailUrlA: string,
    thumbnailUrlB: string
): { title: string; thumbnail: string } {
    return variant === 'A'
        ? { title: titleA, thumbnail: thumbnailUrlA }
        : { title: titleB, thumbnail: thumbnailUrlB };
}

async function persistDailyAnalyticsForDate(
    testId: string,
    userId: string,
    videoId: string,
    dateStr: string
) {
    const analyticsPoint = await getDailyAnalytics(userId, videoId, dateStr);
    if (!analyticsPoint) {
        return;
    }

    const estimatedClicks = computeEstimatedClicks(analyticsPoint.impressions, analyticsPoint.impressionsCtr);
    await pool.query(
        `
        INSERT INTO daily_results (
            test_id,
            date,
            impressions,
            clicks,
            impressions_ctr,
            views,
            estimated_minutes_watched,
            average_view_duration_seconds,
            metric_version
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (test_id, date)
        DO UPDATE SET
            impressions = EXCLUDED.impressions,
            clicks = EXCLUDED.clicks,
            impressions_ctr = EXCLUDED.impressions_ctr,
            views = EXCLUDED.views,
            estimated_minutes_watched = EXCLUDED.estimated_minutes_watched,
            average_view_duration_seconds = EXCLUDED.average_view_duration_seconds,
            metric_version = EXCLUDED.metric_version
    `,
        [
            testId,
            dateStr,
            analyticsPoint.impressions,
            estimatedClicks,
            analyticsPoint.impressionsCtr,
            analyticsPoint.views,
            analyticsPoint.estimatedMinutesWatched,
            analyticsPoint.averageViewDurationSeconds,
            analyticsPoint.metricVersion
        ]
    );
}

async function insertTestVariantEvent(
    client: PoolClient,
    testId: string,
    variant: VariantId,
    source: VariantEventSource
) {
    await client.query(
        `
        INSERT INTO test_variant_events (
            test_id,
            variant,
            source
        )
        VALUES ($1, $2, $3)
    `,
        [testId, variant, source]
    );
}

export function startCronJobs() {
    const scoringConfig = getScoringConfig();
    const scoringEngineV2Enabled = getEnvBoolean('SCORING_ENGINE_V2_ENABLED', false);
    const revertToControlOnInconclusive = getEnvBoolean('INCONCLUSIVE_REVERT_TO_CONTROL', true);

    cron.schedule('1 0 * * *', async () => {
        console.log(`[${new Date().toISOString()}] Running daily variant alternation job...`);
        const client = await pool.connect();

        try {
            const result = await client.query("SELECT * FROM tests WHERE status = 'active'");
            const tests = result.rows;

            for (const test of tests) {
                try {
                    const {
                        id,
                        user_id: userId,
                        video_id: videoId,
                        initial_variant: initialVariantRaw,
                        current_variant: currentVariant,
                        title_a: titleA,
                        title_b: titleB,
                        thumbnail_url_a: thumbnailUrlA,
                        thumbnail_url_b: thumbnailUrlB
                    } = test;
                    const initialVariant: VariantId = initialVariantRaw === 'B' ? 'B' : 'A';

                    const yesterday = new Date();
                    yesterday.setDate(yesterday.getDate() - 1);
                    const dateStr = yesterday.toISOString().split('T')[0];

                    try {
                        await persistDailyAnalyticsForDate(id, userId, videoId, dateStr);
                    } catch (error) {
                        console.error(`Failed to fetch analytics for test ${id}: ${getErrorMessage(error)}`);
                    }

                    const startDate = new Date(test.start_date);
                    const todayDate = new Date();
                    const daysPassed = Math.floor(
                        Math.abs(todayDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
                    );
                    const testCompleted = daysPassed >= test.duration_days;

                    if (testCompleted) {
                        const resultsRes = await client.query(
                            `
                            SELECT
                                date,
                                impressions,
                                clicks,
                                views,
                                estimated_minutes_watched,
                                average_view_duration_seconds,
                                impressions_ctr
                            FROM daily_results
                            WHERE test_id = $1
                            ORDER BY date ASC
                        `,
                            [id]
                        );

                        const performance = computeVariantPerformance(
                            resultsRes.rows,
                            startDate,
                            scoringConfig.weights,
                            initialVariant
                        );
                        const decision = evaluateWinnerDecision(performance, test.duration_days, scoringConfig, true);

                        const oldWinnerVariant: VariantId = performance.b.ctr > performance.a.ctr ? 'B' : 'A';

                        if (!scoringEngineV2Enabled) {
                            const oldWinnerAssets = selectVariantAssets(
                                oldWinnerVariant,
                                titleA,
                                titleB,
                                thumbnailUrlA,
                                thumbnailUrlB
                            );

                            await updateVideoTitle(userId, videoId, oldWinnerAssets.title);
                            await updateVideoThumbnail(userId, videoId, oldWinnerAssets.thumbnail);

                            await client.query(
                                `
                                UPDATE tests
                                SET
                                    status = 'finished',
                                    current_variant = $1,
                                    winner_variant = $1,
                                    winner_mode = 'auto',
                                    winner_confidence = $2,
                                    winner_score_a = $3,
                                    winner_score_b = $4,
                                    decision_reason = $5,
                                    review_required = FALSE,
                                    finished_at = NOW()
                                WHERE id = $6
                            `,
                                [
                                    oldWinnerVariant,
                                    decision.confidence,
                                    performance.a.score,
                                    performance.b.score,
                                    `shadow_mode_old_ctr_applied|${decision.reason}`,
                                    id
                                ]
                            );
                            await insertTestVariantEvent(client, id, oldWinnerVariant, 'auto_winner');
                            continue;
                        }

                        if (decision.winnerMode === 'auto' && decision.winnerVariant) {
                            const winnerAssets = selectVariantAssets(
                                decision.winnerVariant,
                                titleA,
                                titleB,
                                thumbnailUrlA,
                                thumbnailUrlB
                            );

                            await updateVideoTitle(userId, videoId, winnerAssets.title);
                            await updateVideoThumbnail(userId, videoId, winnerAssets.thumbnail);

                            await client.query(
                                `
                                UPDATE tests
                                SET
                                    status = 'finished',
                                    current_variant = $1,
                                    winner_variant = $1,
                                    winner_mode = 'auto',
                                    winner_confidence = $2,
                                    winner_score_a = $3,
                                    winner_score_b = $4,
                                    decision_reason = $5,
                                    review_required = FALSE,
                                    finished_at = NOW()
                                WHERE id = $6
                            `,
                                [
                                    decision.winnerVariant,
                                    decision.confidence,
                                    performance.a.score,
                                    performance.b.score,
                                    decision.reason,
                                    id
                                ]
                            );
                            await insertTestVariantEvent(client, id, decision.winnerVariant, 'auto_winner');
                        } else {
                            let finalCurrentVariant = currentVariant as VariantId;
                            if (revertToControlOnInconclusive) {
                                await updateVideoTitle(userId, videoId, titleA);
                                await updateVideoThumbnail(userId, videoId, thumbnailUrlA);
                                finalCurrentVariant = 'A';
                            }

                            await client.query(
                                `
                                UPDATE tests
                                SET
                                    status = 'finished',
                                    current_variant = $1,
                                    winner_variant = NULL,
                                    winner_mode = 'inconclusive',
                                    winner_confidence = $2,
                                    winner_score_a = $3,
                                    winner_score_b = $4,
                                    decision_reason = $5,
                                    review_required = TRUE,
                                    finished_at = NOW()
                                WHERE id = $6
                            `,
                                [
                                    finalCurrentVariant,
                                    decision.confidence,
                                    performance.a.score,
                                    performance.b.score,
                                    decision.reason,
                                    id
                                ]
                            );

                            if (revertToControlOnInconclusive) {
                                await insertTestVariantEvent(client, id, finalCurrentVariant, 'inconclusive_revert');
                            }
                        }
                    } else {
                        const nextVariant: VariantId = currentVariant === 'A' ? 'B' : 'A';
                        const nextAssets = selectVariantAssets(nextVariant, titleA, titleB, thumbnailUrlA, thumbnailUrlB);

                        await updateVideoTitle(userId, videoId, nextAssets.title);
                        await updateVideoThumbnail(userId, videoId, nextAssets.thumbnail);
                        await client.query('UPDATE tests SET current_variant = $1 WHERE id = $2', [nextVariant, id]);
                        await insertTestVariantEvent(client, id, nextVariant, 'daily_rotation');
                    }

                    // Space requests to reduce YouTube API rate-limit pressure.
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                } catch (error) {
                    console.error(`Error processing test ${test.id}: ${getErrorMessage(error)}`);
                }
            }
        } catch (error) {
            console.error('Error in daily cron job:', error);
        } finally {
            client.release();
        }
    }, {
        scheduled: true,
        timezone: 'America/Los_Angeles'
    });

    console.log('Cron job scheduled for 00:01 AM PT.');
}
