import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient, User } from '@supabase/supabase-js';
import { ZodError } from 'zod';
import { getAuthUrlForUser, handleGoogleCallback } from './auth';
import { pool, setupDatabase } from './db';
import { startCronJobs } from './cron';
import {
    computeEstimatedClicks,
    computeVariantPerformance,
    evaluateWinnerDecision,
    ScoringConfig,
    ScoreWeights,
    summarizeFinishedTestMetrics,
    VariantId
} from './metrics';
import { applyWinnerSchema, createTestSchema, formatZodError, testIdParamSchema } from './validation';
import { getChannelVideos, getDailyAnalytics, getVideoDetails, updateVideoThumbnail, updateVideoTitle } from './youtube';

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

function getEnvNumber(name: string, fallback: number): number {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getEnvBoolean(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (!raw) {
        return fallback;
    }
    return raw.toLowerCase() === 'true';
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

function getScoringConfig(): ScoringConfig {
    const weights: ScoreWeights = {
        ctrWeight: getEnvNumber('SCORING_CTR_WEIGHT', 0.70),
        qualityWeight: getEnvNumber('SCORING_QUALITY_WEIGHT', 0.30)
    };

    return {
        minImpressionsPerVariant: getEnvNumber('MIN_IMPRESSIONS_PER_VARIANT', 1500),
        minConfidence: getEnvNumber('MIN_CONFIDENCE', 0.95),
        minCtrDeltaPctPoints: getEnvNumber('MIN_CTR_DELTA_PCT_POINTS', 0.20),
        minScoreDelta: getEnvNumber('MIN_SCORE_DELTA', 0.02),
        weights
    };
}

function toVariantId(value: unknown): VariantId | null {
    if (value === 'A' || value === 'B') {
        return value;
    }
    return null;
}

interface AuthenticatedRequest extends Request {
    user: User;
}

function getAuthenticatedUser(req: Request): User {
    return (req as AuthenticatedRequest).user;
}

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001';
const PORT = Number(process.env.PORT || 3000);
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '6mb';
const allowedOrigins = buildAllowedOrigins(process.env.FRONTEND_URL);
const scoringConfig = getScoringConfig();
const scoringEngineV2Enabled = getEnvBoolean('SCORING_ENGINE_V2_ENABLED', false);

const supabaseAuth = createClient(
    getRequiredEnv('SUPABASE_URL'),
    getRequiredEnv('SUPABASE_ANON_KEY')
);

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

function buildManualVariantAssets(
    variant: VariantId,
    titleA: string,
    titleB: string,
    thumbnailA: string,
    thumbnailB: string
) {
    return variant === 'A'
        ? { title: titleA, thumbnail: thumbnailA }
        : { title: titleB, thumbnail: thumbnailB };
}

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
app.use(express.json({ limit: JSON_BODY_LIMIT }));

app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', scoringV2Enabled: scoringEngineV2Enabled });
});

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
            SELECT id, start_date, winner_variant, winner_mode, review_required
            FROM tests
            WHERE user_id = $1 AND status = 'finished'
        `,
            [userId]
        );

        const finishedDailyRes = await pool.query(
            `
            SELECT
                dr.test_id,
                dr.date,
                dr.impressions,
                dr.clicks,
                dr.views,
                dr.estimated_minutes_watched,
                dr.average_view_duration_seconds,
                dr.impressions_ctr
            FROM daily_results dr
            JOIN tests t ON t.id = dr.test_id
            WHERE t.user_id = $1 AND t.status = 'finished'
            ORDER BY dr.date ASC
        `,
            [userId]
        );

        const finishedMetrics = summarizeFinishedTestMetrics(
            finishedAllRes.rows,
            finishedDailyRes.rows,
            scoringConfig.weights
        );

        return res.json({
            activeTests: activeRes.rows,
            finishedTests: finishedRes.rows,
            metrics: {
                activeCount: activeRes.rowCount,
                avgCtrLift: finishedMetrics.avgCtrLift,
                extraClicks: finishedMetrics.extraClicks,
                avgWtpiLift: finishedMetrics.avgWtpiLift,
                extraWatchMinutes: finishedMetrics.extraWatchMinutes,
                inconclusiveCount: finishedMetrics.inconclusiveCount
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
            [testId]
        );

        const test = testRes.rows[0];
        const dailyResults = resultsRes.rows;
        const performance = computeVariantPerformance(dailyResults, test.start_date, scoringConfig.weights);
        const computedDecision = evaluateWinnerDecision(
            performance,
            test.duration_days,
            scoringConfig,
            test.status === 'finished'
        );

        const winnerVariant = toVariantId(test.winner_variant) ?? computedDecision.winnerVariant;
        const winnerMode = (test.winner_mode as string | null) ?? computedDecision.winnerMode;
        const winnerConfidence = test.winner_confidence !== null && test.winner_confidence !== undefined
            ? Number(test.winner_confidence)
            : computedDecision.confidence;

        return res.json({
            test,
            dailyResults,
            results_a: {
                impressions: performance.a.impressions,
                clicks: performance.a.estimatedClicks,
                ctr: performance.a.ctr
            },
            results_b: {
                impressions: performance.b.impressions,
                clicks: performance.b.estimatedClicks,
                ctr: performance.b.ctr
            },
            variant_stats: {
                a: performance.a,
                b: performance.b
            },
            decision: {
                winnerVariant,
                winnerMode,
                confidence: winnerConfidence,
                pValue: computedDecision.pValue,
                reviewRequired: Boolean(test.review_required ?? computedDecision.reviewRequired),
                reason: test.decision_reason || computedDecision.reason,
            }
        });
    } catch (error) {
        console.error('Error fetching results:', error);
        return res.status(500).json({ error: 'Failed to fetch results' });
    }
});

app.post('/api/tests/:id/apply-winner', async (req: Request, res: Response) => {
    const parsedParams = testIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res.status(400).json({ error: 'Invalid test id' });
    }

    const parsedBody = applyWinnerSchema.safeParse(req.body);
    if (!parsedBody.success) {
        return res.status(400).json({ error: 'Invalid request payload', details: formatZodError(parsedBody.error) });
    }

    try {
        const user = getAuthenticatedUser(req);
        const userId = user.id;
        const testId = parsedParams.data.id;
        const variant = parsedBody.data.variant;

        const testRes = await pool.query('SELECT * FROM tests WHERE id = $1 AND user_id = $2', [testId, userId]);
        if (testRes.rowCount === 0) {
            return res.status(404).json({ error: 'Test not found or not owned by user' });
        }

        const test = testRes.rows[0];
        const selectedAssets = buildManualVariantAssets(
            variant,
            test.title_a,
            test.title_b,
            test.thumbnail_url_a,
            test.thumbnail_url_b
        );

        await updateVideoTitle(test.user_id, test.video_id, selectedAssets.title);
        await updateVideoThumbnail(test.user_id, test.video_id, selectedAssets.thumbnail);

        const resultsRes = await pool.query(
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
            [testId]
        );
        const performance = computeVariantPerformance(resultsRes.rows, test.start_date, scoringConfig.weights);

        const updateRes = await pool.query(
            `
            UPDATE tests
            SET
                status = 'finished',
                current_variant = $1,
                winner_variant = $1,
                winner_mode = 'manual',
                winner_confidence = NULL,
                winner_score_a = $2,
                winner_score_b = $3,
                decision_reason = 'manual_override',
                review_required = FALSE,
                finished_at = NOW()
            WHERE id = $4
            RETURNING *
        `,
            [variant, performance.a.score, performance.b.score, testId]
        );

        return res.json({ success: true, test: updateRes.rows[0] });
    } catch (error) {
        console.error('Error applying manual winner:', error);
        return res.status(500).json({ error: 'Failed to apply manual winner' });
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
                await persistDailyAnalyticsForDate(testId, test.user_id, test.video_id, dateStr);
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

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    const maybeError = error as { type?: string };
    if (maybeError?.type === 'entity.too.large') {
        return res.status(413).json({
            error: 'Payload too large',
            details: 'Uploaded thumbnail is too large for request body. Please use a smaller image.'
        });
    }
    return next(error);
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
