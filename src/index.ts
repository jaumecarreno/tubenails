import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient, User } from '@supabase/supabase-js';
import { ZodError } from 'zod';
import { getAuthUrlForUser, handleGoogleCallback } from './auth';
import { pool, setupDatabase } from './db';
import { startCronJobs } from './cron';
import { splitDailyResultsByVariant, summarizeFinishedTestMetrics, computeEstimatedClicks } from './metrics';
import { createTestSchema, formatZodError, testIdParamSchema } from './validation';
import { getChannelVideos, getDailyAnalytics, getVideoDetails } from './youtube';

dotenv.config();

function getRequiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required env var: ${name}`);
    }
    return value;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function normalizeOrigin(origin: string): string | null {
    try {
        return new URL(origin).origin;
    } catch {
        return null;
    }
}

function buildAllowedOrigins(frontendUrlEnv: string | undefined): Set<string> {
    const configuredOrigins = (frontendUrlEnv ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => normalizeOrigin(value))
        .filter((value): value is string => Boolean(value));

    const defaults = ['http://localhost:3000', 'http://localhost:3001']
        .map((value) => normalizeOrigin(value))
        .filter((value): value is string => Boolean(value));

    return new Set([...configuredOrigins, ...defaults]);
}

interface AuthenticatedRequest extends Request {
    user: User;
}

function getAuthenticatedUser(req: Request): User {
    return (req as AuthenticatedRequest).user;
}

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001';
const PORT = Number(process.env.PORT || 3000);
const allowedOrigins = buildAllowedOrigins(process.env.FRONTEND_URL);

const supabaseAuth = createClient(
    getRequiredEnv('SUPABASE_URL'),
    getRequiredEnv('SUPABASE_ANON_KEY')
);

export const app = express();
app.set('trust proxy', 1);
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) {
            callback(null, true);
            return;
        }

        const normalizedOrigin = normalizeOrigin(origin);
        if (normalizedOrigin && allowedOrigins.has(normalizedOrigin)) {
            callback(null, true);
            return;
        }

        callback(new Error('CORS origin not allowed'));
    },
    credentials: true
}));
app.use(express.json());

app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
});

// Public callback endpoint used by Google OAuth redirect.
app.get('/api/auth/google/callback', async (req: Request, res: Response) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;

    if (!code || !state) {
        return res.status(400).json({ error: 'Missing code or state' });
    }

    try {
        await handleGoogleCallback(code, state);
        return res.redirect(`${FRONTEND_URL}/settings`);
    } catch (error) {
        const message = getErrorMessage(error).toLowerCase();
        if (message.includes('state')) {
            return res.status(400).json({ error: 'Invalid OAuth state' });
        }
        console.error('[OAuth Callback] Error:', error);
        return res.redirect(`${FRONTEND_URL}/settings?error=oauth_failed`);
    }
});

app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api/') || req.path === '/api/health' || req.path.startsWith('/api/auth/')) {
        return next();
    }

    const testBypassEnabled = process.env.NODE_ENV === 'test' && process.env.TEST_BYPASS_AUTH === 'true';
    if (testBypassEnabled) {
        const testUserIdHeader = req.headers['x-test-user-id'];
        if (typeof testUserIdHeader === 'string' && testUserIdHeader.length > 0) {
            const testUserEmailHeader = req.headers['x-test-user-email'];
            const testUserEmail = typeof testUserEmailHeader === 'string' && testUserEmailHeader.length > 0
                ? testUserEmailHeader
                : `${testUserIdHeader}@test.local`;

            (req as AuthenticatedRequest).user = {
                id: testUserIdHeader,
                email: testUserEmail,
                aud: 'authenticated',
                app_metadata: {},
                user_metadata: {},
                created_at: new Date().toISOString()
            } as unknown as User;

            return next();
        }
    }

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or malformed Authorization header' });
        }

        const token = authHeader.slice('Bearer '.length);
        const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
        if (error || !user) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        (req as AuthenticatedRequest).user = user;

        const userEmail = user.email ?? `${user.id}@unknown.local`;
        try {
            await pool.query(
                `
                INSERT INTO users (id, email)
                VALUES ($1, $2)
                ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
            `,
                [user.id, userEmail]
            );
        } catch (insertError) {
            console.error('Error upserting authenticated user:', insertError);
        }

        return next();
    } catch (authError) {
        console.error('Auth middleware failure:', authError);
        return res.status(500).json({ error: 'Authentication service unavailable' });
    }
});

app.get('/api/user/youtube/connect-url', async (req: Request, res: Response) => {
    try {
        const user = getAuthenticatedUser(req);
        const url = await getAuthUrlForUser(user.id);
        return res.json({ url });
    } catch (error) {
        console.error('Error generating YouTube OAuth URL:', error);
        return res.status(500).json({ error: 'Failed to start OAuth flow' });
    }
});

app.get('/api/dashboard', async (req: Request, res: Response) => {
    try {
        const user = getAuthenticatedUser(req);
        const userId = user.id;

        const activeRes = await pool.query(
            `
            SELECT * FROM tests
            WHERE user_id = $1 AND status = 'active'
            ORDER BY start_date DESC
        `,
            [userId]
        );

        const finishedRes = await pool.query(
            `
            SELECT * FROM tests
            WHERE user_id = $1 AND status = 'finished'
            ORDER BY start_date DESC
            LIMIT 5
        `,
            [userId]
        );

        const finishedAllRes = await pool.query(
            `
            SELECT id, start_date
            FROM tests
            WHERE user_id = $1 AND status = 'finished'
        `,
            [userId]
        );

        const finishedDailyRes = await pool.query(
            `
            SELECT dr.test_id, dr.date, dr.impressions, dr.clicks
            FROM daily_results dr
            JOIN tests t ON t.id = dr.test_id
            WHERE t.user_id = $1 AND t.status = 'finished'
            ORDER BY dr.date ASC
        `,
            [userId]
        );

        const finishedMetrics = summarizeFinishedTestMetrics(
            finishedAllRes.rows,
            finishedDailyRes.rows
        );

        return res.json({
            activeTests: activeRes.rows,
            finishedTests: finishedRes.rows,
            metrics: {
                activeCount: activeRes.rowCount,
                avgCtrLift: finishedMetrics.avgCtrLift,
                extraClicks: finishedMetrics.extraClicks
            }
        });
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        return res.status(500).json({ error: 'Failed to fetch dashboard' });
    }
});

app.get('/api/user/settings', async (req: Request, res: Response) => {
    try {
        const user = getAuthenticatedUser(req);
        const userId = user.id;

        const userRes = await pool.query(
            `
            SELECT id, email, stripe_plan, yt_access_token, yt_refresh_token, created_at
            FROM users
            WHERE id = $1
        `,
            [userId]
        );

        if (userRes.rowCount === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const usageRes = await pool.query(
            `
            SELECT
                COUNT(*)::int AS total_tests,
                COUNT(*) FILTER (WHERE status = 'active')::int AS active_tests
            FROM tests
            WHERE user_id = $1
        `,
            [userId]
        );

        const dbUser = userRes.rows[0];
        const usageRow = usageRes.rows[0] ?? { total_tests: 0, active_tests: 0 };

        let channelId = '';
        if (dbUser.yt_access_token) {
            try {
                const channelResponse = await getChannelVideos(userId, 1);
                channelId = channelResponse.channelId;
            } catch {
                channelId = '';
            }
        }

        return res.json({
            user: {
                id: dbUser.id,
                email: dbUser.email,
                plan: dbUser.stripe_plan || 'free',
                createdAt: dbUser.created_at
            },
            plan: dbUser.stripe_plan || 'free',
            isYoutubeConnected: Boolean(dbUser.yt_access_token),
            channelId,
            usage: {
                activeTests: Number(usageRow.active_tests || 0),
                totalTests: Number(usageRow.total_tests || 0)
            }
        });
    } catch (error) {
        console.error('Error fetching user settings:', error);
        return res.status(500).json({ error: 'Failed to fetch user settings' });
    }
});

app.post('/api/tests', async (req: Request, res: Response) => {
    try {
        const payload = createTestSchema.parse(req.body);
        const user = getAuthenticatedUser(req);
        const userId = user.id;

        const result = await pool.query(
            `
            INSERT INTO tests (
                user_id,
                video_id,
                title_a,
                title_b,
                thumbnail_url_a,
                thumbnail_url_b,
                duration_days,
                start_date
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            RETURNING *
        `,
            [
                userId,
                payload.videoId,
                payload.titleA,
                payload.titleB,
                payload.thumbnailA,
                payload.thumbnailB,
                payload.durationDays
            ]
        );

        return res.json(result.rows[0]);
    } catch (error) {
        if (error instanceof ZodError) {
            return res.status(400).json({
                error: 'Invalid request payload',
                details: formatZodError(error)
            });
        }
        console.error('Error creating test:', error);
        return res.status(500).json({ error: 'Failed to create test' });
    }
});

app.get('/api/tests/:id/results', async (req: Request, res: Response) => {
    const parsedParams = testIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res.status(400).json({ error: 'Invalid test id' });
    }

    try {
        const user = getAuthenticatedUser(req);
        const userId = user.id;
        const testId = parsedParams.data.id;

        const testRes = await pool.query(
            'SELECT * FROM tests WHERE id = $1 AND user_id = $2',
            [testId, userId]
        );
        if (testRes.rowCount === 0) {
            return res.status(404).json({ error: 'Test not found or not owned by user' });
        }

        const resultsRes = await pool.query(
            `
            SELECT date, impressions, clicks
            FROM daily_results
            WHERE test_id = $1
            ORDER BY date ASC
        `,
            [testId]
        );

        const test = testRes.rows[0];
        const dailyResults = resultsRes.rows;
        const splitResults = splitDailyResultsByVariant(dailyResults, test.start_date);

        return res.json({
            test,
            dailyResults,
            results_a: splitResults.a,
            results_b: splitResults.b
        });
    } catch (error) {
        console.error('Error fetching results:', error);
        return res.status(500).json({ error: 'Failed to fetch results' });
    }
});

app.get('/api/youtube/videos', async (req: Request, res: Response) => {
    try {
        const user = getAuthenticatedUser(req);
        const userId = user.id;

        const userRes = await pool.query(
            'SELECT id FROM users WHERE id = $1 AND yt_access_token IS NOT NULL',
            [userId]
        );
        if (userRes.rowCount === 0) {
            return res.status(404).json({ error: 'User not found or YouTube not connected' });
        }

        const { channelId, videos } = await getChannelVideos(userId, 12);
        return res.json({ channelId, videos });
    } catch (error) {
        console.error('Error fetching channel videos:', error);
        return res.status(500).json({ error: 'Failed to fetch channel videos' });
    }
});

app.get('/api/youtube/video/:id', async (req: Request, res: Response) => {
    try {
        const user = getAuthenticatedUser(req);
        const userId = user.id;
        const videoId = req.params.id;

        const userRes = await pool.query(
            'SELECT id FROM users WHERE id = $1 AND yt_access_token IS NOT NULL',
            [userId]
        );
        if (userRes.rowCount === 0) {
            return res.status(404).json({ error: 'User not found or YouTube not connected' });
        }

        const details = await getVideoDetails(userId, videoId);
        return res.json(details);
    } catch (error) {
        console.error('Error fetching video metadata:', error);
        return res.status(500).json({ error: 'Failed to fetch video metadata' });
    }
});

app.post('/api/tests/:id/sync', async (req: Request, res: Response) => {
    const parsedParams = testIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res.status(400).json({ error: 'Invalid test id' });
    }

    try {
        const user = getAuthenticatedUser(req);
        const userId = user.id;
        const testId = parsedParams.data.id;

        const testRes = await pool.query(
            'SELECT * FROM tests WHERE id = $1 AND user_id = $2',
            [testId, userId]
        );
        if (testRes.rowCount === 0) {
            return res.status(404).json({ error: 'Test not found' });
        }

        const test = testRes.rows[0];
        const startDate = new Date(test.start_date);
        startDate.setHours(0, 0, 0, 0);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const currRes = await pool.query('SELECT date FROM daily_results WHERE test_id = $1', [testId]);
        const existingDates = new Set(
            currRes.rows.map((row) => new Date(row.date).toISOString().split('T')[0])
        );

        for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
            const dateStr = new Date(d).toISOString().split('T')[0];
            if (existingDates.has(dateStr)) {
                continue;
            }

            try {
                const metrics = await getDailyAnalytics(test.user_id, test.video_id, dateStr);
                if (metrics.rows && metrics.rows.length > 0) {
                    const row = metrics.rows[0];
                    const impressions = Number(row[2] || 0);
                    const ctrPercent = Number(row[3] || 0);
                    const estimatedClicks = computeEstimatedClicks(impressions, ctrPercent);

                    await pool.query(
                        `
                        INSERT INTO daily_results (test_id, date, impressions, clicks)
                        VALUES ($1, $2, $3, $4)
                        ON CONFLICT DO NOTHING
                    `,
                        [testId, dateStr, impressions, estimatedClicks]
                    );
                }
            } catch (syncError) {
                console.error(`Failed to fetch analytics for ${dateStr}:`, getErrorMessage(syncError));
            }
        }

        return res.json({ success: true });
    } catch (error) {
        console.error('Error syncing test:', error);
        return res.status(500).json({ error: 'Failed to sync test' });
    }
});

app.delete('/api/user/youtube', async (req: Request, res: Response) => {
    try {
        const user = getAuthenticatedUser(req);
        const userId = user.id;

        await pool.query(
            'UPDATE users SET yt_access_token = NULL, yt_refresh_token = NULL WHERE id = $1',
            [userId]
        );
        return res.json({ success: true, message: 'YouTube account disconnected' });
    } catch (error) {
        console.error('Error disconnecting YouTube:', error);
        return res.status(500).json({ error: 'Failed to disconnect YouTube account' });
    }
});

export async function startServer() {
    await setupDatabase();
    startCronJobs();
    app.listen(PORT, () => {
        console.log(`CTR Sniper Backend running on port ${PORT}`);
    });
}

if (typeof require !== 'undefined' && require.main === module) {
    void startServer();
}
