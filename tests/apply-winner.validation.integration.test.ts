import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
    process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-client-secret';
    process.env.GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';
    process.env.TEST_BYPASS_AUTH = 'true';

    const server = await import('../src/index');
    app = server.app;
});

describe('POST /api/tests/:id/apply-winner validation', () => {
    it('returns typed 400 on invalid variant payload', async () => {
        const response = await request(app)
            .post('/api/tests/11111111-1111-1111-1111-111111111111/apply-winner')
            .set('x-test-user-id', '00000000-0000-0000-0000-000000000001')
            .send({ variant: 'C' });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Invalid request payload');
        expect(typeof response.body.details).toBe('string');
        expect(response.body.details.length).toBeGreaterThan(0);
    });

    it('returns 400 on invalid test id param', async () => {
        const response = await request(app)
            .post('/api/tests/not-a-uuid/apply-winner')
            .set('x-test-user-id', '00000000-0000-0000-0000-000000000001')
            .send({ variant: 'A' });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Invalid test id');
    });
});

