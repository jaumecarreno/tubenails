import crypto from 'crypto';

export type PlanTier = 'basic' | 'premium' | 'teams';
export type WorkspaceRole = 'owner' | 'admin' | 'member';

const PLAN_SEAT_LIMITS: Record<PlanTier, number> = {
    basic: 1,
    premium: 3,
    teams: 10
};

const WORKSPACE_ROLE_ORDER: Record<WorkspaceRole, number> = {
    owner: 0,
    admin: 1,
    member: 2
};

const INVITE_TOKEN_BYTES = 32;
const DEFAULT_INVITE_TTL_DAYS = 7;

export function normalizePlan(plan: string | null | undefined): PlanTier {
    const normalized = (plan ?? '').trim().toLowerCase();
    if (normalized === 'teams') {
        return 'teams';
    }
    if (normalized === 'premium' || normalized === 'pro') {
        return 'premium';
    }
    return 'basic';
}

export function getSeatLimitForPlan(plan: PlanTier): number {
    return PLAN_SEAT_LIMITS[plan];
}

export function planSupportsCollaboration(plan: PlanTier): boolean {
    return plan !== 'basic';
}

export function normalizeInviteEmail(email: string): string {
    return email.trim().toLowerCase();
}

export function generateInviteToken(): string {
    return crypto.randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
}

export function hashInviteToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

export function getInviteTtlDays(): number {
    const raw = Number(process.env.TEAM_INVITE_TTL_DAYS);
    if (Number.isFinite(raw) && raw > 0 && raw <= 30) {
        return Math.floor(raw);
    }
    return DEFAULT_INVITE_TTL_DAYS;
}

export function buildInviteExpiryDate(from: Date = new Date()): Date {
    const expiresAt = new Date(from);
    expiresAt.setDate(expiresAt.getDate() + getInviteTtlDays());
    return expiresAt;
}

export function buildInviteUrl(baseFrontendUrl: string, token: string): string {
    const url = new URL('/settings', baseFrontendUrl);
    url.searchParams.set('inviteToken', token);
    return url.toString();
}

export function isWorkspaceRole(value: string): value is WorkspaceRole {
    return value === 'owner' || value === 'admin' || value === 'member';
}

export function compareRoles(a: WorkspaceRole, b: WorkspaceRole): number {
    return WORKSPACE_ROLE_ORDER[a] - WORKSPACE_ROLE_ORDER[b];
}

export function canManageInvites(role: WorkspaceRole): boolean {
    return role === 'owner' || role === 'admin';
}

export function canChangeMemberRole(actorRole: WorkspaceRole): boolean {
    return actorRole === 'owner';
}

export function canRemoveMember(
    actorRole: WorkspaceRole,
    targetRole: WorkspaceRole,
    actorUserId: string,
    targetUserId: string
): boolean {
    if (actorUserId === targetUserId) {
        return false;
    }
    if (targetRole === 'owner') {
        return false;
    }
    if (actorRole === 'owner') {
        return true;
    }
    if (actorRole === 'admin') {
        return targetRole === 'member';
    }
    return false;
}

export function defaultWorkspaceNameFromEmail(email: string): string {
    const localPart = email.split('@')[0]?.trim() || 'Workspace';
    const safeLocalPart = localPart.length > 0 ? localPart : 'Workspace';
    return `${safeLocalPart}'s Workspace`;
}
