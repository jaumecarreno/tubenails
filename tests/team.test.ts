import { describe, expect, it } from 'vitest';
import {
    buildInviteUrl,
    canManageInvites,
    canRemoveMember,
    getSeatLimitForPlan,
    hashInviteToken,
    normalizeInviteEmail,
    normalizePlan,
    planSupportsCollaboration
} from '../src/team';

describe('team helpers', () => {
    it('normalizes plan names from legacy values', () => {
        expect(normalizePlan('free')).toBe('basic');
        expect(normalizePlan('pro')).toBe('premium');
        expect(normalizePlan('premium')).toBe('premium');
        expect(normalizePlan('teams')).toBe('teams');
        expect(normalizePlan('unknown')).toBe('basic');
    });

    it('returns seat limits by plan tier', () => {
        expect(getSeatLimitForPlan('basic')).toBe(1);
        expect(getSeatLimitForPlan('premium')).toBe(3);
        expect(getSeatLimitForPlan('teams')).toBe(10);
    });

    it('supports collaboration only for premium and teams', () => {
        expect(planSupportsCollaboration('basic')).toBe(false);
        expect(planSupportsCollaboration('premium')).toBe(true);
        expect(planSupportsCollaboration('teams')).toBe(true);
    });

    it('allows invite management only for owner/admin', () => {
        expect(canManageInvites('owner')).toBe(true);
        expect(canManageInvites('admin')).toBe(true);
        expect(canManageInvites('member')).toBe(false);
    });

    it('enforces remove-member role rules', () => {
        expect(canRemoveMember('owner', 'admin', 'a', 'b')).toBe(true);
        expect(canRemoveMember('owner', 'owner', 'a', 'b')).toBe(false);
        expect(canRemoveMember('admin', 'member', 'a', 'b')).toBe(true);
        expect(canRemoveMember('admin', 'admin', 'a', 'b')).toBe(false);
        expect(canRemoveMember('member', 'member', 'a', 'b')).toBe(false);
        expect(canRemoveMember('owner', 'member', 'a', 'a')).toBe(false);
    });

    it('builds deterministic token hashes and invite URLs', () => {
        const hashA = hashInviteToken('token-value');
        const hashB = hashInviteToken('token-value');
        expect(hashA).toBe(hashB);
        expect(hashA.length).toBe(64);

        const inviteUrl = buildInviteUrl('https://app.example.com', 'abc123');
        expect(inviteUrl).toContain('/settings');
        expect(inviteUrl).toContain('inviteToken=abc123');
    });

    it('normalizes invite emails to lower case', () => {
        expect(normalizeInviteEmail('  TeAm@Example.COM  ')).toBe('team@example.com');
    });
});
