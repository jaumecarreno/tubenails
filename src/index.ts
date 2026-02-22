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
import {
    acceptTeamInviteSchema,
    applyWinnerSchema,
    createTeamInviteSchema,
    createTestSchema,
    formatZodError,
    teamInviteIdParamSchema,
    teamMemberUserIdParamSchema,
    testIdParamSchema,
    updateTeamMemberRoleSchema
} from './validation';
import { getChannelVideos, getDailyAnalytics, getVideoDetails, updateVideoThumbnail, updateVideoTitle } from './youtube';
import {
    buildInviteExpiryDate,
    buildInviteUrl,
    canChangeMemberRole,
    canManageInvites,
    canRemoveMember,
    defaultWorkspaceNameFromEmail,
    generateInviteToken,
    getSeatLimitForPlan,
    hashInviteToken,
    isWorkspaceRole,
    normalizeInviteEmail,
    normalizePlan,
    PlanTier,
    planSupportsCollaboration,
    WorkspaceRole
} from './team';

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

interface WorkspaceContext {
    workspaceId: string;
    workspaceName: string;
    role: WorkspaceRole;
    ownerUserId: string;
    ownerEmail: string;
    ownerPlan: PlanTier;
    seatLimit: number;
    collaborationEnabled: boolean;
}

interface WorkspaceMemberRow {
    workspace_id: string;
    workspace_name: string;
    role: string;
    owner_user_id: string;
    owner_email: string;
    owner_plan: string;
}

interface TeamMemberRecord {
    user_id: string;
    email: string;
    role: WorkspaceRole;
    created_at: string;
}

interface PendingInviteRecord {
    id: string;
    email: string;
    role: 'admin' | 'member';
    status: 'pending' | 'accepted' | 'cancelled' | 'expired';
    expires_at: string;
    created_at: string;
}

function workspaceContextFromRow(row: WorkspaceMemberRow): WorkspaceContext {
    const role: WorkspaceRole = isWorkspaceRole(row.role) ? row.role : 'member';
    const ownerPlan = normalizePlan(row.owner_plan);
    return {
        workspaceId: row.workspace_id,
        workspaceName: row.workspace_name,
        role,
        ownerUserId: row.owner_user_id,
        ownerEmail: row.owner_email,
        ownerPlan,
        seatLimit: getSeatLimitForPlan(ownerPlan),
        collaborationEnabled: planSupportsCollaboration(ownerPlan)
    };
}

async function ensureOwnedWorkspaceForUser(userId: string, email: string): Promise<void> {
    const workspaceName = defaultWorkspaceNameFromEmail(email);
    const workspaceRes = await pool.query<{ id: string }>(
        `
        INSERT INTO workspaces (owner_user_id, name)
        VALUES ($1, $2)
        ON CONFLICT (owner_user_id) DO UPDATE SET name = workspaces.name
        RETURNING id
    `,
        [userId, workspaceName]
    );

    const workspaceId = workspaceRes.rows[0]?.id;
    if (!workspaceId) {
        return;
    }

    await pool.query(
        `
        INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES ($1, $2, 'owner')
        ON CONFLICT (workspace_id, user_id) DO NOTHING
    `,
        [workspaceId, userId]
    );

    await pool.query(
        `
        UPDATE users
        SET current_workspace_id = COALESCE(current_workspace_id, $1)
        WHERE id = $2
    `,
        [workspaceId, userId]
    );
}

async function getWorkspaceContextForUser(userId: string): Promise<WorkspaceContext> {
    const currentWorkspaceRes = await pool.query<WorkspaceMemberRow>(
        `
        SELECT
            wm.workspace_id,
            wm.role,
            w.name AS workspace_name,
            w.owner_user_id,
            owner.email AS owner_email,
            owner.stripe_plan AS owner_plan
        FROM users u
        JOIN workspace_members wm ON wm.workspace_id = u.current_workspace_id AND wm.user_id = u.id
        JOIN workspaces w ON w.id = wm.workspace_id
        JOIN users owner ON owner.id = w.owner_user_id
        WHERE u.id = $1
        LIMIT 1
    `,
        [userId]
    );

    if ((currentWorkspaceRes.rowCount ?? 0) > 0) {
        return workspaceContextFromRow(currentWorkspaceRes.rows[0]);
    }

    const membershipRes = await pool.query<WorkspaceMemberRow>(
        `
        SELECT
            wm.workspace_id,
            wm.role,
            w.name AS workspace_name,
            w.owner_user_id,
            owner.email AS owner_email,
            owner.stripe_plan AS owner_plan
        FROM workspace_members wm
        JOIN workspaces w ON w.id = wm.workspace_id
        JOIN users owner ON owner.id = w.owner_user_id
        WHERE wm.user_id = $1
        ORDER BY wm.created_at DESC
        LIMIT 1
    `,
        [userId]
    );

    if ((membershipRes.rowCount ?? 0) > 0) {
        const row = membershipRes.rows[0];
        await pool.query(
            `
            UPDATE users
            SET current_workspace_id = $1
            WHERE id = $2
        `,
            [row.workspace_id, userId]
        );
        return workspaceContextFromRow(row);
    }

    const userRes = await pool.query<{ email: string }>(
        'SELECT email FROM users WHERE id = $1',
        [userId]
    );
    const userEmail = userRes.rows[0]?.email ?? `${userId}@unknown.local`;
    await ensureOwnedWorkspaceForUser(userId, userEmail);

    const createdWorkspaceRes = await pool.query<WorkspaceMemberRow>(
        `
        SELECT
            wm.workspace_id,
            wm.role,
            w.name AS workspace_name,
            w.owner_user_id,
            owner.email AS owner_email,
            owner.stripe_plan AS owner_plan
        FROM workspace_members wm
        JOIN workspaces w ON w.id = wm.workspace_id
        JOIN users owner ON owner.id = w.owner_user_id
        WHERE wm.user_id = $1
        ORDER BY wm.created_at DESC
        LIMIT 1
    `,
        [userId]
    );

    if ((createdWorkspaceRes.rowCount ?? 0) === 0) {
        throw new Error('Could not resolve workspace context');
    }

    return workspaceContextFromRow(createdWorkspaceRes.rows[0]);
}

async function getWorkspaceMembers(workspaceId: string): Promise<TeamMemberRecord[]> {
    const membersRes = await pool.query<TeamMemberRecord>(
        `
        SELECT
            wm.user_id,
            u.email,
            wm.role::text AS role,
            wm.created_at
        FROM workspace_members wm
        JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = $1
        ORDER BY
            CASE wm.role
                WHEN 'owner' THEN 0
                WHEN 'admin' THEN 1
                ELSE 2
            END,
            wm.created_at ASC
    `,
        [workspaceId]
    );
    return membersRes.rows.map((member) => ({
        ...member,
        role: isWorkspaceRole(member.role) ? member.role : 'member'
    }));
}

async function getPendingWorkspaceInvites(workspaceId: string): Promise<PendingInviteRecord[]> {
    await pool.query(
        `
        UPDATE workspace_invites
        SET status = 'expired'
        WHERE workspace_id = $1
          AND status = 'pending'
          AND expires_at <= NOW()
    `,
        [workspaceId]
    );

    const invitesRes = await pool.query<PendingInviteRecord>(
        `
        SELECT
            id,
            email,
            role::text AS role,
            status::text AS status,
            expires_at,
            created_at
        FROM workspace_invites
        WHERE workspace_id = $1
          AND status = 'pending'
          AND expires_at > NOW()
        ORDER BY created_at DESC
    `,
        [workspaceId]
    );

    return invitesRes.rows;
}

async function getWorkspaceMemberCount(workspaceId: string): Promise<number> {
    const countRes = await pool.query<{ member_count: string }>(
        `
        SELECT COUNT(*)::int AS member_count
        FROM workspace_members
        WHERE workspace_id = $1
    `,
        [workspaceId]
    );
    return Number(countRes.rows[0]?.member_count ?? 0);
}

interface AccessibleTestRecord {
    id: string;
    user_id: string;
    workspace_id: string;
    video_id: string;
    title_a: string;
    title_b: string;
    thumbnail_url_a: string;
    thumbnail_url_b: string;
    start_date: string;
    duration_days: number;
    status: string;
    current_variant: VariantId;
    winner_variant: VariantId | null;
    winner_mode: string | null;
    winner_confidence: number | null;
    winner_score_a: number | null;
    winner_score_b: number | null;
    decision_reason: string | null;
    review_required: boolean | null;
}

async function getAccessibleTestForUser(testId: string, userId: string): Promise<AccessibleTestRecord | null> {
    const testRes = await pool.query<AccessibleTestRecord>(
        `
        SELECT t.*
        FROM tests t
        JOIN workspace_members wm ON wm.workspace_id = t.workspace_id
        WHERE t.id = $1
          AND wm.user_id = $2
        LIMIT 1
    `,
        [testId, userId]
    );

    return (testRes.rowCount ?? 0) > 0 ? testRes.rows[0] : null;
}

async function setFallbackCurrentWorkspaceForUser(userId: string): Promise<void> {
    const fallbackRes = await pool.query<{ workspace_id: string }>(
        `
        SELECT workspace_id
        FROM workspace_members
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 1
    `,
        [userId]
    );

    const fallbackWorkspaceId = fallbackRes.rows[0]?.workspace_id ?? null;
    await pool.query(
        `
        UPDATE users
        SET current_workspace_id = $1
        WHERE id = $2
    `,
        [fallbackWorkspaceId, userId]
    );
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

app.get('/api/team', async (req: Request, res: Response) => {
    try {
        const user = getAuthenticatedUser(req);
        const context = await getWorkspaceContextForUser(user.id);
        const members = await getWorkspaceMembers(context.workspaceId);
        const pendingInvites = await getPendingWorkspaceInvites(context.workspaceId);
        const memberCount = members.length;

        const effectiveMembers = context.collaborationEnabled
            ? members
            : members.filter((member) => member.user_id === user.id);
        const effectiveInvites = context.collaborationEnabled ? pendingInvites : [];

        return res.json({
            workspace: {
                id: context.workspaceId,
                name: context.workspaceName,
                role: context.role,
                ownerUserId: context.ownerUserId,
                ownerEmail: context.ownerEmail,
                plan: context.ownerPlan,
                seatLimit: context.seatLimit,
                memberCount,
                collaborationEnabled: context.collaborationEnabled
            },
            permissions: {
                canManageInvites: context.collaborationEnabled && canManageInvites(context.role),
                canChangeMemberRole: context.collaborationEnabled && canChangeMemberRole(context.role),
                canRemoveMembers: context.collaborationEnabled && (context.role === 'owner' || context.role === 'admin')
            },
            members: effectiveMembers,
            pendingInvites: effectiveInvites
        });
    } catch (error) {
        console.error('Error fetching team data:', error);
        return res.status(500).json({ error: 'Failed to fetch team data' });
    }
});

app.post('/api/team/invites', async (req: Request, res: Response) => {
    const parsedBody = createTeamInviteSchema.safeParse(req.body);
    if (!parsedBody.success) {
        return res.status(400).json({ error: 'Invalid request payload', details: formatZodError(parsedBody.error) });
    }

    try {
        const user = getAuthenticatedUser(req);
        const context = await getWorkspaceContextForUser(user.id);

        if (!context.collaborationEnabled) {
            return res.status(403).json({ error: 'Plan does not support team collaboration' });
        }
        if (!canManageInvites(context.role)) {
            return res.status(403).json({ error: 'Insufficient permissions to manage team invites' });
        }

        const normalizedEmail = normalizeInviteEmail(parsedBody.data.email);
        const existingMemberRes = await pool.query(
            `
            SELECT wm.user_id
            FROM workspace_members wm
            JOIN users u ON u.id = wm.user_id
            WHERE wm.workspace_id = $1
              AND LOWER(u.email) = $2
            LIMIT 1
        `,
            [context.workspaceId, normalizedEmail]
        );
        if ((existingMemberRes.rowCount ?? 0) > 0) {
            return res.status(409).json({ error: 'User is already a member of this workspace' });
        }

        const memberCount = await getWorkspaceMemberCount(context.workspaceId);
        if (memberCount >= context.seatLimit) {
            return res.status(409).json({ error: 'Seat limit reached for current plan' });
        }

        const inviteToken = generateInviteToken();
        const inviteTokenHash = hashInviteToken(inviteToken);
        const expiresAt = buildInviteExpiryDate();

        try {
            const inviteInsertRes = await pool.query<{ id: string; expires_at: string }>(
                `
                INSERT INTO workspace_invites (
                    workspace_id,
                    email,
                    email_norm,
                    role,
                    token_hash,
                    status,
                    invited_by_user_id,
                    expires_at
                )
                VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
                RETURNING id, expires_at
            `,
                [
                    context.workspaceId,
                    parsedBody.data.email.trim(),
                    normalizedEmail,
                    parsedBody.data.role,
                    inviteTokenHash,
                    user.id,
                    expiresAt.toISOString()
                ]
            );

            const inviteId = inviteInsertRes.rows[0].id;
            const inviteExpiresAt = inviteInsertRes.rows[0].expires_at;
            return res.json({
                inviteId,
                inviteUrl: buildInviteUrl(FRONTEND_URL, inviteToken),
                expiresAt: inviteExpiresAt
            });
        } catch (insertError) {
            const maybeDbError = insertError as { code?: string };
            if (maybeDbError.code === '23505') {
                return res.status(409).json({ error: 'A pending invite already exists for this email' });
            }
            throw insertError;
        }
    } catch (error) {
        console.error('Error creating team invite:', error);
        return res.status(500).json({ error: 'Failed to create team invite' });
    }
});

app.post('/api/team/invites/accept', async (req: Request, res: Response) => {
    const parsedBody = acceptTeamInviteSchema.safeParse(req.body);
    if (!parsedBody.success) {
        return res.status(400).json({ error: 'Invalid request payload', details: formatZodError(parsedBody.error) });
    }

    const user = getAuthenticatedUser(req);
    const userEmail = user.email ? normalizeInviteEmail(user.email) : '';
    if (!userEmail) {
        return res.status(400).json({ error: 'Authenticated user email is required to accept invites' });
    }

    const tokenHash = hashInviteToken(parsedBody.data.token);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const inviteRes = await client.query<{
            id: string;
            workspace_id: string;
            email_norm: string;
            role: 'admin' | 'member';
            status: 'pending' | 'accepted' | 'cancelled' | 'expired';
            expires_at: string;
            owner_plan: string;
        }>(
            `
            SELECT
                wi.id,
                wi.workspace_id,
                wi.email_norm,
                wi.role::text AS role,
                wi.status::text AS status,
                wi.expires_at,
                owner.stripe_plan AS owner_plan
            FROM workspace_invites wi
            JOIN workspaces w ON w.id = wi.workspace_id
            JOIN users owner ON owner.id = w.owner_user_id
            WHERE wi.token_hash = $1
            FOR UPDATE
        `,
            [tokenHash]
        );

        if ((inviteRes.rowCount ?? 0) === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Invite not found' });
        }

        const invite = inviteRes.rows[0];
        if (invite.status !== 'pending') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Invite is no longer pending' });
        }

        if (new Date(invite.expires_at).getTime() <= Date.now()) {
            await client.query(
                `
                UPDATE workspace_invites
                SET status = 'expired'
                WHERE id = $1
            `,
                [invite.id]
            );
            await client.query('COMMIT');
            return res.status(410).json({ error: 'Invite has expired' });
        }

        if (invite.email_norm !== userEmail) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Invite email does not match authenticated user' });
        }

        const ownerPlan = normalizePlan(invite.owner_plan);
        if (!planSupportsCollaboration(ownerPlan)) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Workspace plan does not support team collaboration' });
        }

        const existingMemberRes = await client.query(
            `
            SELECT role
            FROM workspace_members
            WHERE workspace_id = $1
              AND user_id = $2
            LIMIT 1
        `,
            [invite.workspace_id, user.id]
        );

        if ((existingMemberRes.rowCount ?? 0) === 0) {
            const countRes = await client.query<{ member_count: string }>(
                `
                SELECT COUNT(*)::int AS member_count
                FROM workspace_members
                WHERE workspace_id = $1
            `,
                [invite.workspace_id]
            );
            const memberCount = Number(countRes.rows[0]?.member_count ?? 0);
            const seatLimit = getSeatLimitForPlan(ownerPlan);
            if (memberCount >= seatLimit) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'Seat limit reached for current plan' });
            }

            await client.query(
                `
                INSERT INTO workspace_members (workspace_id, user_id, role)
                VALUES ($1, $2, $3)
                ON CONFLICT (workspace_id, user_id) DO NOTHING
            `,
                [invite.workspace_id, user.id, invite.role]
            );
        }

        await client.query(
            `
            UPDATE workspace_invites
            SET
                status = 'accepted',
                accepted_by_user_id = $1,
                accepted_at = NOW()
            WHERE id = $2
        `,
            [user.id, invite.id]
        );

        await client.query(
            `
            UPDATE users
            SET current_workspace_id = $1
            WHERE id = $2
        `,
            [invite.workspace_id, user.id]
        );

        await client.query('COMMIT');
        return res.json({ success: true, workspaceId: invite.workspace_id });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error accepting team invite:', error);
        return res.status(500).json({ error: 'Failed to accept invite' });
    } finally {
        client.release();
    }
});

app.delete('/api/team/invites/:inviteId', async (req: Request, res: Response) => {
    const parsedParams = teamInviteIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res.status(400).json({ error: 'Invalid invite id' });
    }

    try {
        const user = getAuthenticatedUser(req);
        const context = await getWorkspaceContextForUser(user.id);
        if (!context.collaborationEnabled) {
            return res.status(403).json({ error: 'Plan does not support team collaboration' });
        }
        if (!canManageInvites(context.role)) {
            return res.status(403).json({ error: 'Insufficient permissions to cancel invites' });
        }

        const cancelRes = await pool.query(
            `
            UPDATE workspace_invites
            SET status = 'cancelled'
            WHERE id = $1
              AND workspace_id = $2
              AND status = 'pending'
            RETURNING id
        `,
            [parsedParams.data.inviteId, context.workspaceId]
        );

        if ((cancelRes.rowCount ?? 0) === 0) {
            return res.status(404).json({ error: 'Pending invite not found' });
        }

        return res.json({ success: true });
    } catch (error) {
        console.error('Error cancelling invite:', error);
        return res.status(500).json({ error: 'Failed to cancel invite' });
    }
});

app.patch('/api/team/members/:memberUserId', async (req: Request, res: Response) => {
    const parsedParams = teamMemberUserIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res.status(400).json({ error: 'Invalid member user id' });
    }

    const parsedBody = updateTeamMemberRoleSchema.safeParse(req.body);
    if (!parsedBody.success) {
        return res.status(400).json({ error: 'Invalid request payload', details: formatZodError(parsedBody.error) });
    }

    try {
        const user = getAuthenticatedUser(req);
        const context = await getWorkspaceContextForUser(user.id);
        if (!context.collaborationEnabled) {
            return res.status(403).json({ error: 'Plan does not support team collaboration' });
        }
        if (!canChangeMemberRole(context.role)) {
            return res.status(403).json({ error: 'Insufficient permissions to change member roles' });
        }
        if (parsedParams.data.memberUserId === user.id) {
            return res.status(403).json({ error: 'Owner role cannot be changed' });
        }

        const targetMemberRes = await pool.query<{ role: string }>(
            `
            SELECT role::text AS role
            FROM workspace_members
            WHERE workspace_id = $1
              AND user_id = $2
            LIMIT 1
        `,
            [context.workspaceId, parsedParams.data.memberUserId]
        );
        if ((targetMemberRes.rowCount ?? 0) === 0) {
            return res.status(404).json({ error: 'Workspace member not found' });
        }

        const targetRole = targetMemberRes.rows[0].role;
        if (targetRole === 'owner') {
            return res.status(403).json({ error: 'Owner role cannot be changed' });
        }

        const updateRes = await pool.query<{ user_id: string; role: string }>(
            `
            UPDATE workspace_members
            SET role = $1
            WHERE workspace_id = $2
              AND user_id = $3
            RETURNING user_id, role::text AS role
        `,
            [parsedBody.data.role, context.workspaceId, parsedParams.data.memberUserId]
        );

        return res.json({
            success: true,
            member: updateRes.rows[0]
        });
    } catch (error) {
        console.error('Error updating member role:', error);
        return res.status(500).json({ error: 'Failed to update member role' });
    }
});

app.delete('/api/team/members/:memberUserId', async (req: Request, res: Response) => {
    const parsedParams = teamMemberUserIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res.status(400).json({ error: 'Invalid member user id' });
    }

    try {
        const user = getAuthenticatedUser(req);
        const context = await getWorkspaceContextForUser(user.id);
        if (!context.collaborationEnabled) {
            return res.status(403).json({ error: 'Plan does not support team collaboration' });
        }

        const targetMemberRes = await pool.query<{ role: string }>(
            `
            SELECT role::text AS role
            FROM workspace_members
            WHERE workspace_id = $1
              AND user_id = $2
            LIMIT 1
        `,
            [context.workspaceId, parsedParams.data.memberUserId]
        );
        if ((targetMemberRes.rowCount ?? 0) === 0) {
            return res.status(404).json({ error: 'Workspace member not found' });
        }

        const targetRoleRaw = targetMemberRes.rows[0].role;
        const targetRole: WorkspaceRole = isWorkspaceRole(targetRoleRaw) ? targetRoleRaw : 'member';
        if (!canRemoveMember(context.role, targetRole, user.id, parsedParams.data.memberUserId)) {
            return res.status(403).json({ error: 'Insufficient permissions to remove this member' });
        }

        await pool.query(
            `
            DELETE FROM workspace_members
            WHERE workspace_id = $1
              AND user_id = $2
        `,
            [context.workspaceId, parsedParams.data.memberUserId]
        );

        await setFallbackCurrentWorkspaceForUser(parsedParams.data.memberUserId);

        return res.json({ success: true });
    } catch (error) {
        console.error('Error removing workspace member:', error);
        return res.status(500).json({ error: 'Failed to remove workspace member' });
    }
});

app.get('/api/user/youtube/connect-url', async (req: Request, res: Response) => {
    try {
        const user = getAuthenticatedUser(req);
        const context = await getWorkspaceContextForUser(user.id);
        if (context.role !== 'owner' || context.ownerUserId !== user.id) {
            return res.status(403).json({ error: 'Only workspace owner can manage YouTube connection' });
        }
        const url = await getAuthUrlForUser(context.ownerUserId);
        return res.json({ url });
    } catch (error) {
        console.error('Error generating YouTube OAuth URL:', error);
        return res.status(500).json({ error: 'Failed to start OAuth flow' });
    }
});

app.get('/api/dashboard', async (req: Request, res: Response) => {
    try {
        const user = getAuthenticatedUser(req);
        const context = await getWorkspaceContextForUser(user.id);

        const activeRes = await pool.query(
            `
            SELECT * FROM tests
            WHERE workspace_id = $1 AND status = 'active'
            ORDER BY start_date DESC
        `,
            [context.workspaceId]
        );

        const finishedRes = await pool.query(
            `
            SELECT * FROM tests
            WHERE workspace_id = $1 AND status = 'finished'
            ORDER BY start_date DESC
            LIMIT 5
        `,
            [context.workspaceId]
        );

        const finishedAllRes = await pool.query(
            `
            SELECT id, start_date, winner_variant, winner_mode, review_required
            FROM tests
            WHERE workspace_id = $1 AND status = 'finished'
        `,
            [context.workspaceId]
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
            WHERE t.workspace_id = $1 AND t.status = 'finished'
            ORDER BY dr.date ASC
        `,
            [context.workspaceId]
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
                activeCount: Number(activeRes.rowCount ?? 0),
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
        const context = await getWorkspaceContextForUser(userId);

        const userRes = await pool.query(
            `
            SELECT id, email, created_at
            FROM users
            WHERE id = $1
        `,
            [userId]
        );

        if ((userRes.rowCount ?? 0) === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const usageRes = await pool.query(
            `
            SELECT
                COUNT(*)::int AS total_tests,
                COUNT(*) FILTER (WHERE status = 'active')::int AS active_tests
            FROM tests
            WHERE workspace_id = $1
        `,
            [context.workspaceId]
        );

        await pool.query(
            `
            UPDATE workspace_invites
            SET status = 'expired'
            WHERE workspace_id = $1
              AND status = 'pending'
              AND expires_at <= NOW()
        `,
            [context.workspaceId]
        );

        const pendingInvitesRes = await pool.query<{ pending_count: string }>(
            `
            SELECT COUNT(*)::int AS pending_count
            FROM workspace_invites
            WHERE workspace_id = $1
              AND status = 'pending'
              AND expires_at > NOW()
        `,
            [context.workspaceId]
        );

        const ownerRes = await pool.query<{
            yt_access_token: string | null;
            yt_refresh_token: string | null;
        }>(
            `
            SELECT yt_access_token, yt_refresh_token
            FROM users
            WHERE id = $1
        `,
            [context.ownerUserId]
        );

        const dbUser = userRes.rows[0];
        const usageRow = usageRes.rows[0] ?? { total_tests: 0, active_tests: 0 };
        const ownerRow = ownerRes.rows[0] ?? { yt_access_token: null, yt_refresh_token: null };
        const memberCount = await getWorkspaceMemberCount(context.workspaceId);
        const pendingInvitesCount = Number(pendingInvitesRes.rows[0]?.pending_count ?? 0);

        let channelId = '';
        if (ownerRow.yt_access_token) {
            try {
                const channelResponse = await getChannelVideos(context.ownerUserId, 1);
                channelId = channelResponse.channelId;
            } catch {
                channelId = '';
            }
        }

        return res.json({
            user: {
                id: dbUser.id,
                email: dbUser.email,
                plan: context.ownerPlan,
                createdAt: dbUser.created_at
            },
            plan: context.ownerPlan,
            isYoutubeConnected: Boolean(ownerRow.yt_access_token),
            channelId,
            usage: {
                activeTests: Number(usageRow.active_tests || 0),
                totalTests: Number(usageRow.total_tests || 0)
            },
            workspace: {
                id: context.workspaceId,
                name: context.workspaceName,
                role: context.role,
                ownerUserId: context.ownerUserId,
                ownerEmail: context.ownerEmail,
                collaborationEnabled: context.collaborationEnabled,
                seatLimit: context.seatLimit,
                memberCount,
                pendingInvitesCount,
                canManageInvites: context.collaborationEnabled && canManageInvites(context.role),
                canManageMembers: context.collaborationEnabled && (context.role === 'owner' || context.role === 'admin')
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
        const context = await getWorkspaceContextForUser(user.id);

        const result = await pool.query(
            `
            INSERT INTO tests (
                user_id,
                workspace_id,
                created_by_user_id,
                video_id,
                title_a,
                title_b,
                thumbnail_url_a,
                thumbnail_url_b,
                duration_days,
                start_date
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            RETURNING *
        `,
            [
                context.ownerUserId,
                context.workspaceId,
                user.id,
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
        const testId = parsedParams.data.id;

        const test = await getAccessibleTestForUser(testId, user.id);
        if (!test) {
            return res.status(404).json({ error: 'Test not found or not accessible to user' });
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
        const testId = parsedParams.data.id;
        const variant = parsedBody.data.variant;

        const test = await getAccessibleTestForUser(testId, user.id);
        if (!test) {
            return res.status(404).json({ error: 'Test not found or not accessible to user' });
        }

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
        const context = await getWorkspaceContextForUser(user.id);
        const ownerUserId = context.ownerUserId;

        const userRes = await pool.query(
            'SELECT id FROM users WHERE id = $1 AND yt_access_token IS NOT NULL',
            [ownerUserId]
        );
        if ((userRes.rowCount ?? 0) === 0) {
            return res.status(404).json({ error: 'Workspace YouTube account is not connected' });
        }

        const { channelId, videos } = await getChannelVideos(ownerUserId, 12);
        return res.json({ channelId, videos });
    } catch (error) {
        console.error('Error fetching channel videos:', error);
        return res.status(500).json({ error: 'Failed to fetch channel videos' });
    }
});

app.get('/api/youtube/video/:id', async (req: Request, res: Response) => {
    try {
        const user = getAuthenticatedUser(req);
        const context = await getWorkspaceContextForUser(user.id);
        const ownerUserId = context.ownerUserId;
        const videoId = req.params.id;

        const userRes = await pool.query(
            'SELECT id FROM users WHERE id = $1 AND yt_access_token IS NOT NULL',
            [ownerUserId]
        );
        if ((userRes.rowCount ?? 0) === 0) {
            return res.status(404).json({ error: 'Workspace YouTube account is not connected' });
        }

        const details = await getVideoDetails(ownerUserId, videoId);
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
        const testId = parsedParams.data.id;

        const test = await getAccessibleTestForUser(testId, user.id);
        if (!test) {
            return res.status(404).json({ error: 'Test not found or not accessible to user' });
        }

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
        const context = await getWorkspaceContextForUser(user.id);
        if (context.role !== 'owner' || context.ownerUserId !== user.id) {
            return res.status(403).json({ error: 'Only workspace owner can disconnect YouTube account' });
        }

        await pool.query(
            'UPDATE users SET yt_access_token = NULL, yt_refresh_token = NULL WHERE id = $1',
            [context.ownerUserId]
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
