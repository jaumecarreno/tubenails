import { google } from 'googleapis';
import { pool } from './db';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function getOauthStateSecret(): string {
    const secret = process.env.OAUTH_STATE_SECRET || process.env.GOOGLE_CLIENT_SECRET;
    if (!secret) {
        throw new Error('Missing OAUTH_STATE_SECRET (or GOOGLE_CLIENT_SECRET fallback)');
    }
    return secret;
}

function signStatePayload(encodedPayload: string): string {
    return crypto
        .createHmac('sha256', getOauthStateSecret())
        .update(encodedPayload)
        .digest('base64url');
}

function parseAndVerifyState(state: string): { userId: string; nonce: string; expiresAtMs: number } {
    const [encodedPayload, receivedSignature] = state.split('.');
    if (!encodedPayload || !receivedSignature) {
        throw new Error('Malformed OAuth state');
    }

    const expectedSignature = signStatePayload(encodedPayload);
    const expectedBuffer = Buffer.from(expectedSignature);
    const receivedBuffer = Buffer.from(receivedSignature);

    if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
        throw new Error('Invalid OAuth state signature');
    }

    let payload: { u?: string; n?: string; e?: number } = {};
    try {
        payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    } catch {
        throw new Error('Invalid OAuth state payload');
    }

    if (!payload.u || !payload.n || !payload.e) {
        throw new Error('OAuth state payload is incomplete');
    }

    if (Date.now() > payload.e) {
        throw new Error('OAuth state has expired');
    }

    return {
        userId: payload.u,
        nonce: payload.n,
        expiresAtMs: payload.e
    };
}

async function createSignedStateForUser(userId: string): Promise<string> {
    const nonce = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);

    await pool.query(
        'INSERT INTO oauth_states (nonce, user_id, expires_at) VALUES ($1, $2, $3)',
        [nonce, userId, expiresAt]
    );

    const payload = {
        u: userId,
        n: nonce,
        e: expiresAt.getTime()
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = signStatePayload(encodedPayload);
    return `${encodedPayload}.${signature}`;
}

async function consumeSignedState(state: string): Promise<string> {
    const { userId, nonce, expiresAtMs } = parseAndVerifyState(state);
    if (Date.now() > expiresAtMs) {
        throw new Error('OAuth state has expired');
    }

    const consumeRes = await pool.query(
        `
        UPDATE oauth_states
        SET used_at = NOW()
        WHERE nonce = $1
          AND user_id = $2
          AND used_at IS NULL
          AND expires_at > NOW()
    `,
        [nonce, userId]
    );

    if (consumeRes.rowCount === 0) {
        throw new Error('OAuth state is invalid or already used');
    }

    return userId;
}

// Scopes required for reading metrics and updating thumbnails/titles
const SCOPES = [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
];

export async function getAuthUrlForUser(userId: string): Promise<string> {
    const state = await createSignedStateForUser(userId);
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
        state
    });
}

export async function handleGoogleCallback(code: string, state: string) {
    const userId = await consumeSignedState(state);

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email || 'user@example.com';

    const client = await pool.connect();
    try {
        const updateRes = await client.query(
            `UPDATE Users SET yt_access_token = $1, yt_refresh_token = COALESCE($2, yt_refresh_token) WHERE id = $3`,
            [tokens.access_token, tokens.refresh_token, userId]
        );

        if (updateRes.rowCount === 0) {
            await client.query(`DELETE FROM Users WHERE email = $1 AND id != $2`, [email, userId]);
            await client.query(
                `INSERT INTO Users (id, email, yt_access_token, yt_refresh_token) VALUES ($1, $2, $3, $4)`,
                [userId, email, tokens.access_token, tokens.refresh_token]
            );
        }

        return userId;
    } finally {
        client.release();
    }
}

export async function getClientForUser(userId: string) {
    const result = await pool.query('SELECT yt_access_token, yt_refresh_token FROM Users WHERE id = $1', [userId]);
    if (result.rows.length === 0) throw new Error('User not found');

    const user = result.rows[0];
    const client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );

    client.setCredentials({
        access_token: user.yt_access_token,
        refresh_token: user.yt_refresh_token
    });

    return client;
}
