import { describe, expect, it } from 'vitest';
import {
    acceptTeamInviteSchema,
    createTeamInviteSchema,
    teamInviteIdParamSchema,
    teamMemberUserIdParamSchema,
    updateTeamMemberRoleSchema
} from '../src/validation';

describe('team validation schemas', () => {
    it('accepts valid team invite payload', () => {
        const result = createTeamInviteSchema.safeParse({
            email: 'teammate@example.com',
            role: 'admin'
        });
        expect(result.success).toBe(true);
    });

    it('rejects invalid team invite role', () => {
        const result = createTeamInviteSchema.safeParse({
            email: 'teammate@example.com',
            role: 'owner'
        });
        expect(result.success).toBe(false);
    });

    it('rejects invalid invite acceptance token', () => {
        const result = acceptTeamInviteSchema.safeParse({
            token: 'short'
        });
        expect(result.success).toBe(false);
    });

    it('validates team invite and member route params', () => {
        const inviteParam = teamInviteIdParamSchema.safeParse({
            inviteId: '11111111-1111-1111-1111-111111111111'
        });
        const memberParam = teamMemberUserIdParamSchema.safeParse({
            memberUserId: '22222222-2222-2222-2222-222222222222'
        });
        expect(inviteParam.success).toBe(true);
        expect(memberParam.success).toBe(true);
    });

    it('does not allow promoting to owner in member role updates', () => {
        const result = updateTeamMemberRoleSchema.safeParse({
            role: 'owner'
        });
        expect(result.success).toBe(false);
    });
});
