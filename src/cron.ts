import cron from 'node-cron';
import { pool } from './db';
import { getDailyAnalytics, updateVideoThumbnail, updateVideoTitle } from './youtube';
import { computeEstimatedClicks, splitDailyResultsByVariant } from './metrics';

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function startCronJobs() {
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
                        current_variant: currentVariant,
                        title_a: titleA,
                        title_b: titleB,
                        thumbnail_url_a: thumbnailUrlA,
                        thumbnail_url_b: thumbnailUrlB
                    } = test;

                    const yesterday = new Date();
                    yesterday.setDate(yesterday.getDate() - 1);
                    const dateStr = yesterday.toISOString().split('T')[0];

                    try {
                        const metrics = await getDailyAnalytics(userId, videoId, dateStr);
                        if (metrics.rows && metrics.rows.length > 0) {
                            const row = metrics.rows[0];
                            // With dimensions day,video => [day, video, impressions, impressionsCtr]
                            const impressions = Number(row[2] || 0);
                            const ctrPercent = Number(row[3] || 0);
                            const estimatedClicks = computeEstimatedClicks(impressions, ctrPercent);

                            await client.query(
                                `
                                INSERT INTO daily_results (test_id, date, impressions, clicks)
                                VALUES ($1, $2, $3, $4)
                                ON CONFLICT DO NOTHING
                            `,
                                [id, dateStr, impressions, estimatedClicks]
                            );
                        }
                    } catch (error) {
                        console.error(`Failed to fetch analytics for test ${id}: ${getErrorMessage(error)}`);
                    }

                    const startDate = new Date(test.start_date);
                    const todayDate = new Date();
                    const daysPassed = Math.floor(
                        Math.abs(todayDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
                    );

                    if (daysPassed >= test.duration_days) {
                        const resultsRes = await client.query(
                            'SELECT date, impressions, clicks FROM daily_results WHERE test_id = $1 ORDER BY date ASC',
                            [id]
                        );
                        const split = splitDailyResultsByVariant(resultsRes.rows, startDate);
                        const ctrA = split.a.impressions > 0 ? split.a.clicks / split.a.impressions : 0;
                        const ctrB = split.b.impressions > 0 ? split.b.clicks / split.b.impressions : 0;

                        const winnerVariant = ctrB > ctrA ? 'B' : 'A';
                        const finalTitle = winnerVariant === 'A' ? titleA : titleB;
                        const finalThumb = winnerVariant === 'A' ? thumbnailUrlA : thumbnailUrlB;

                        await updateVideoTitle(userId, videoId, finalTitle);
                        await updateVideoThumbnail(userId, videoId, finalThumb);
                        await client.query(
                            "UPDATE tests SET status = 'finished', current_variant = $1 WHERE id = $2",
                            [winnerVariant, id]
                        );
                    } else {
                        const nextVariant = currentVariant === 'A' ? 'B' : 'A';
                        const nextTitle = nextVariant === 'A' ? titleA : titleB;
                        const nextThumb = nextVariant === 'A' ? thumbnailUrlA : thumbnailUrlB;

                        await updateVideoTitle(userId, videoId, nextTitle);
                        await updateVideoThumbnail(userId, videoId, nextThumb);
                        await client.query('UPDATE tests SET current_variant = $1 WHERE id = $2', [nextVariant, id]);
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
