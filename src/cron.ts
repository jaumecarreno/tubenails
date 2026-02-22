import cron from 'node-cron';
import { pool } from './db';
import { updateVideoThumbnail, updateVideoTitle, getDailyAnalytics } from './youtube';

// Ejecutar todos los días a las 00:01 AM (Pacific Time)
export function startCronJobs() {
    cron.schedule('1 0 * * *', async () => {
        console.log(`[${new Date().toISOString()}] Running daily variant alternation job...`);
        const client = await pool.connect();

        try {
            // Find active tests
            const result = await client.query("SELECT * FROM Tests WHERE status = 'active'");
            const tests = result.rows;

            for (const test of tests) {
                try {
                    const {
                        id, user_id, video_id, current_variant,
                        title_a, title_b, thumbnail_url_a, thumbnail_url_b
                    } = test;

                    // 1. Fetch Analytics for yesterday
                    const yesterday = new Date();
                    yesterday.setDate(yesterday.getDate() - 1);
                    const dateStr = yesterday.toISOString().split('T')[0];

                    try {
                        const metrics = await getDailyAnalytics(user_id, video_id, dateStr);
                        console.log(`Metrics for test ${id} on ${dateStr}:`, metrics.rows);

                        // Si metrics.rows tiene datos, insertamos (simplificado)
                        // En un caso real, extraerías el índice exacto de 'views' o 'impressions'
                        if (metrics.rows && metrics.rows.length > 0) {
                            const row = metrics.rows[0];
                            // Assuming row[2] = views, row[3] = CTR based on dimension/metric order
                            const views = row[2] || 0;
                            const ctr = row[3] || 0;
                            const estimatedClicks = Math.round(views * ctr);

                            await client.query(
                                'INSERT INTO Daily_Results (test_id, date, impressions, clicks) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
                                [id, dateStr, views, estimatedClicks]
                            );
                        }
                    } catch (e: any) {
                        console.error(`Failed to fetch analytics for test ${id}: ${e.message}`);
                    }

                    // 2. Comprobar si el test ha terminado
                    const startDate = new Date(test.start_date);
                    const todayDate = new Date();
                    const diffTime = Math.abs(todayDate.getTime() - startDate.getTime());
                    const daysPassed = Math.floor(diffTime / (1000 * 60 * 60 * 24));

                    if (daysPassed >= test.duration_days) {
                        console.log(`Test ${id} has finished (${daysPassed} days). Calculating winner...`);

                        // Query all daily results to find winner
                        const resultsRes = await client.query('SELECT * FROM daily_results WHERE test_id = $1 ORDER BY date ASC', [id]);
                        let impA = 0, clicksA = 0, impB = 0, clicksB = 0;

                        // Re-use logic to split A and B by day index
                        resultsRes.rows.forEach(row => {
                            const rowDate = new Date(row.date);
                            rowDate.setHours(0, 0, 0, 0);
                            const startD = new Date(startDate);
                            startD.setHours(0, 0, 0, 0);
                            const dayDiff = Math.floor(Math.abs(rowDate.getTime() - startD.getTime()) / (1000 * 60 * 60 * 24));

                            if (dayDiff % 2 === 0) { impA += row.impressions; clicksA += row.clicks; }
                            else { impB += row.impressions; clicksB += row.clicks; }
                        });

                        const ctrA = impA > 0 ? (clicksA / impA) : 0;
                        const ctrB = impB > 0 ? (clicksB / impB) : 0;

                        const winnerVariant = ctrB > ctrA ? 'B' : 'A';
                        const finalTitle = winnerVariant === 'A' ? title_a : title_b;
                        const finalThumb = winnerVariant === 'A' ? thumbnail_url_a : thumbnail_url_b;

                        console.log(`Test ${id} winner is Variant ${winnerVariant}. Applying final metadata.`);
                        await updateVideoTitle(user_id, video_id, finalTitle);
                        await updateVideoThumbnail(user_id, video_id, finalThumb);

                        await client.query("UPDATE tests SET status = 'finished', current_variant = $1 WHERE id = $2", [winnerVariant, id]);

                    } else {
                        // 3. Alternar Variante normal
                        const nextVariant = current_variant === 'A' ? 'B' : 'A';
                        const nextTitle = nextVariant === 'A' ? title_a : title_b;
                        const nextThumb = nextVariant === 'A' ? thumbnail_url_a : thumbnail_url_b;

                        console.log(`Test ${id}: Changing from ${current_variant} to ${nextVariant}`);

                        await updateVideoTitle(user_id, video_id, nextTitle);
                        await updateVideoThumbnail(user_id, video_id, nextThumb);

                        await client.query('UPDATE tests SET current_variant = $1 WHERE id = $2', [nextVariant, id]);
                    }

                    // Sleep 2 seconds to avoid YouTube API rate limits
                    await new Promise(r => setTimeout(r, 2000));

                } catch (err: any) {
                    console.error(`Error processing test ${test.id}:`, err.message);
                }
            }
        } catch (error) {
            console.error('Error in daily cron job:', error);
        } finally {
            client.release();
        }
    }, {
        scheduled: true,
        timezone: "America/Los_Angeles"
    });

    console.log('Cron job scheduled for 00:01 AM PT.');
}
