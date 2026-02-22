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

    const server = await import('../src/index');
    app = server.app;
});

describe('OAuth callback endpoint', () => {
    it('returns 400 when state is missing', async () => {
        const response = await request(app).get('/api/auth/google/callback?code=sample-code');
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Missing code or state');
    });

    it('returns 400 when OAuth state signature is invalid', async () => {
        const response = await request(app).get('/api/auth/google/callback?code=sample-code&state=invalid.state');
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Invalid OAuth state');
    });
});
