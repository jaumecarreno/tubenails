import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { setupDatabase, pool } from './db';
import { getAuthUrl, handleGoogleCallback } from './auth';
import { startCronJobs } from './cron';
import { getVideoDetails, getDailyAnalytics, getChannelVideos } from './youtube';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supersonicUrl = process.env.SUPABASE_URL!;
const supersonicKey = process.env.SUPABASE_ANON_KEY!;
const supabaseAuth = createClient(supersonicUrl, supersonicKey);

const app = express();
app.set('trust proxy', 1); // Crucial for Dokploy/Nginx reverse proxy to read HTTPS headers
app.use(cors());
app.use(express.json());

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const PORT = process.env.PORT || 3000;

app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok' });
});

// OAuth Initialization Route
app.get('/api/auth/google', (req: Request, res: Response) => {
    const userId = req.query.userId as string;
    const url = getAuthUrl(userId);
    console.log('Redirecting to Google Auth for user:', userId);
    res.redirect(url);
});

// OAuth Callback Route
app.get('/api/auth/google/callback', async (req: Request, res: Response) => {
    const code = req.query.code as string;
    const state = req.query.state as string; // This is the userId
    console.log('[OAuth Callback] Received. code exists:', !!code, ', state/userId:', state);
    try {
        await handleGoogleCallback(code, state);
        console.log('[OAuth Callback] Success! Redirecting to', `${FRONTEND_URL}/settings`);
        // Correctly redirect the user back to the Single Page App (supporting production domains)
        res.redirect(`${FRONTEND_URL}/settings`);
    } catch (error: any) {
        console.error('[OAuth Callback] FULL ERROR:', error?.message || error);
        console.error('[OAuth Callback] Error details:', JSON.stringify(error?.response?.data || error?.code || 'no details'));
        res.redirect(`${FRONTEND_URL}/settings?error=oauth_failed`);
    }
});

// Apply Auth Middleware to all API routes except public/OAuth
app.use(async (req, res, next) => {
    // Exclude generic/OAuth routes
    if (!req.path.startsWith('/api/') || req.path.startsWith('/api/auth/')) {
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabaseAuth.auth.getUser(token);

    if (error || !user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Attach user to request for downstream use
    (req as any).user = user;

    // Ensure the user exists in our local Users table. 
    // Usually done via Supabase triggers, but we can safely upsert here.
    try {
        await pool.query(
            `INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
            [user.id, user.email]
        );
    } catch (e) {
        console.error('Error auto-creating user via middleware:', e);
    }

    next();
});

// Dashboard Data API
app.get('/api/dashboard', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        // Check if user is connected to YouTube
        const userRes = await pool.query('SELECT yt_access_token FROM users WHERE id = $1', [userId]);
        if (userRes.rowCount === 0) { // This condition should ideally not be met if user is authenticated
            return res.status(404).json({ error: 'User not found in local DB' });
        }
        // If yt_access_token is NULL, it means YouTube is not connected.
        // We still return an empty dashboard, but the user is authenticated.
        if (!userRes.rows[0].yt_access_token) {
            return res.json({ activeTests: [], finishedTests: [], metrics: { activeCount: 0, clickGain: 0, totalClicks: 0 } });
        }

        // Tests Activos
        const activeRes = await pool.query(`
            SELECT * FROM tests
            WHERE user_id = $1 AND status = 'active'
            ORDER BY start_date DESC
        `, [userId]);

        // Tests Finalizados
        const finishedRes = await pool.query(`
            SELECT * FROM tests
            WHERE user_id = $1 AND status = 'completed'
            ORDER BY start_date DESC
            LIMIT 5
        `, [userId]);

        res.json({
            activeTests: activeRes.rows,
            finishedTests: finishedRes.rows,
            metrics: {
                activeCount: activeRes.rowCount,
                clickGain: 24, // Mock until real metric aggregation
                totalClicks: 1250 // Mock until real metric aggregation
            }
        });
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard' });
    }
});

// User Settings API (GET)
app.get('/api/user/settings', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const userId = user.id;

        const userRes = await pool.query(
            'SELECT id, email, stripe_plan, yt_access_token, yt_refresh_token, created_at FROM users WHERE id = $1',
            [userId]
        );

        if (userRes.rowCount === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const dbUser = userRes.rows[0];

        res.json({
            user: {
                id: dbUser.id,
                email: dbUser.email,
                plan: dbUser.stripe_plan || 'free',
                youtubeConnected: !!dbUser.yt_access_token,
                createdAt: dbUser.created_at
            }
        });
    } catch (error) {
        console.error('Error fetching user settings:', error);
        res.status(500).json({ error: 'Failed to fetch user settings' });
    }
});

// Tests API (Create)
app.post('/api/tests', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;

        const { videoId, titleA, titleB, thumbnailA, thumbnailB, durationDays } = req.body;

        const result = await pool.query(`
            INSERT INTO tests (user_id, video_id, title_a, title_b, thumbnail_url_a, thumbnail_url_b, duration_days, start_date)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            RETURNING *
        `, [userId, videoId, titleA, titleB, thumbnailA, thumbnailB, durationDays]);

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error creating test:', error);
        res.status(500).json({ error: 'Failed to create test' });
    }
});

// Results API (GET)
app.get('/api/tests/:id/results', async (req: Request, res: Response) => {
    try {
        const testId = req.params.id;
        const userId = (req as any).user.id; // Ensure the user owns the test
        const testRes = await pool.query('SELECT * FROM tests WHERE id = $1 AND user_id = $2', [testId, userId]);

        if (testRes.rowCount === 0) return res.status(404).json({ error: 'Test not found or not owned by user' });

        const resultsRes = await pool.query(`
            SELECT * FROM daily_results
            WHERE test_id = $1
            ORDER BY date ASC
        `, [testId]);

        const dailyResults = resultsRes.rows;

        // Aggregate results based on start_date
        const startDate = new Date(testRes.rows[0].start_date);
        startDate.setHours(0, 0, 0, 0);

        let impA = 0, clicksA = 0;
        let impB = 0, clicksB = 0;

        dailyResults.forEach(row => {
            const rowDate = new Date(row.date);
            rowDate.setHours(0, 0, 0, 0);
            const diffTime = Math.abs(rowDate.getTime() - startDate.getTime());
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays % 2 === 0) {
                // Even days: Variant A
                impA += row.impressions;
                clicksA += row.clicks;
            } else {
                // Odd days: Variant B
                impB += row.impressions;
                clicksB += row.clicks;
            }
        });

        const ctrA = impA > 0 ? ((clicksA / impA) * 100).toFixed(2) : "0.00";
        const ctrB = impB > 0 ? ((clicksB / impB) * 100).toFixed(2) : "0.00";

        res.json({
            test: testRes.rows[0],
            dailyResults: dailyResults,
            results_a: { impressions: impA, clicks: clicksA, ctr: ctrA },
            results_b: { impressions: impB, clicks: clicksB, ctr: ctrB }
        });
    } catch (error) {
        console.error('Error fetching results:', error);
        res.status(500).json({ error: 'Failed to fetch results' });
    }
});

// Fetch Recent Channel Videos API (GET)
app.get('/api/youtube/videos', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const userRes = await pool.query('SELECT id FROM users WHERE id = $1 AND yt_access_token IS NOT NULL', [userId]);
        if (userRes.rowCount === 0) return res.status(404).json({ error: 'User not found or YouTube not connected' });

        const videos = await getChannelVideos(userId, 12);
        res.json(videos);
    } catch (error: any) {
        console.error('Error fetching channel videos:', error);
        res.status(500).json({ error: 'Failed to fetch channel videos' });
    }
});

// Fetch Video Details API (GET)
app.get('/api/youtube/video/:id', async (req: Request, res: Response) => {
    try {
        const videoId = req.params.id;
        const userId = (req as any).user.id;
        const userRes = await pool.query('SELECT id FROM users WHERE id = $1 AND yt_access_token IS NOT NULL', [userId]);
        if (userRes.rowCount === 0) return res.status(404).json({ error: 'User not found or YouTube not connected' });

        const details = await getVideoDetails(userId, videoId);
        res.json(details);
    } catch (error: any) {
        console.error('Error fetching video metadata:', error);
        res.status(500).json({ error: 'Failed to fetch video metadata' });
    }
});

// Sync Analytics API (POST)
app.post('/api/tests/:id/sync', async (req: Request, res: Response) => {
    try {
        const testId = req.params.id;
        const userId = (req as any).user.id;
        const testRes = await pool.query('SELECT * FROM tests WHERE id = $1 AND user_id = $2', [testId, userId]);
        if (testRes.rowCount === 0) return res.status(404).json({ error: 'Test not found' });

        const test = testRes.rows[0];
        const { user_id, video_id, start_date } = test;

        const start = new Date(start_date);
        start.setHours(0, 0, 0, 0);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Fetch existing dates to avoid re-fetching
        const currRes = await pool.query('SELECT date FROM daily_results WHERE test_id = $1', [testId]);
        const existingDates = currRes.rows.map(r => new Date(r.date).toISOString().split('T')[0]);

        for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
            const tempDate = new Date(d);
            const dateStr = tempDate.toISOString().split('T')[0];

            if (existingDates.includes(dateStr)) continue; // skip already fetched

            try {
                const metrics = await getDailyAnalytics(user_id, video_id, dateStr);
                if (metrics.rows && metrics.rows.length > 0) {
                    const row = metrics.rows[0];
                    const actualViews = row[2] || 0;
                    const ctr = row[3] || 0;
                    const estimatedClicks = Math.round(actualViews * ctr);

                    await pool.query(
                        'INSERT INTO daily_results (test_id, date, impressions, clicks) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
                        [testId, dateStr, actualViews, estimatedClicks]
                    );
                }
            } catch (err: any) {
                console.error(`Failed to fetch analytics for ${dateStr}:`, err.message);
            }
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error syncing test:', error);
        res.status(500).json({ error: 'Failed to sync test' });
    }
});

// User Settings API (GET)
app.get('/api/user/settings', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const userRes = await pool.query('SELECT id, email, stripe_plan, yt_access_token FROM users WHERE id = $1', [userId]);

        if (userRes.rowCount === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = userRes.rows[0];
        res.json({
            user: {
                id: user.id,
                email: user.email,
                plan: user.stripe_plan
            },
            isYoutubeConnected: !!user.yt_access_token
        });
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

// Disconnect YouTube API (DELETE)
app.delete('/api/user/youtube', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        await pool.query('UPDATE users SET yt_access_token = NULL, yt_refresh_token = NULL WHERE id = $1', [userId]);
        res.json({ success: true, message: 'YouTube account disconnected' });
    } catch (error) {
        console.error('Error disconnecting YouTube:', error);
        res.status(500).json({ error: 'Failed to disconnect YouTube account' });
    }
});

app.listen(PORT, async () => {
    console.log(`🚀 CTR Sniper Backend running on port ${PORT}`);
    await setupDatabase();
    startCronJobs();
});
