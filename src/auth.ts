import { google } from 'googleapis';
import { pool } from './db';
import dotenv from 'dotenv';

dotenv.config();

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

// Scopes required for reading metrics and uploading thumbnails
const SCOPES = [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
];

export function getAuthUrl(state?: string) {
    return oauth2Client.generateAuthUrl({
        access_type: 'offline', // Crucial: gives us the refresh_token
        scope: SCOPES,
        prompt: 'consent', // Forces Google to resend the refresh token if already authorized
        state: state
    });
}

export async function handleGoogleCallback(code: string, userId?: string) {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Obtain email just in case we need to fallback
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email || 'user@example.com';

    const client = await pool.connect();
    try {
        if (userId) {
            // Securely link tokens to the logged-in user via state passing
            await client.query(
                `INSERT INTO Users (id, email, yt_access_token, yt_refresh_token) 
                 VALUES ($1, $2, $3, $4) 
                 ON CONFLICT (id) DO UPDATE 
                 SET yt_access_token = EXCLUDED.yt_access_token, 
                     yt_refresh_token = COALESCE(EXCLUDED.yt_refresh_token, Users.yt_refresh_token)`,
                [userId, email, tokens.access_token, tokens.refresh_token]
            );
            return userId;
        } else {
            // Fallback for legacy flows without state (not recommended)
            let result = await client.query('SELECT id FROM Users WHERE email = $1', [email]);
            if (result.rows.length === 0) {
                result = await client.query(
                    'INSERT INTO Users (email, yt_access_token, yt_refresh_token) VALUES ($1, $2, $3) RETURNING id',
                    [email, tokens.access_token, tokens.refresh_token]
                );
            } else {
                await client.query(
                    'UPDATE Users SET yt_access_token = $1, yt_refresh_token = COALESCE($2, yt_refresh_token) WHERE email = $3',
                    [tokens.access_token, tokens.refresh_token, email]
                );
            }
            return result.rows[0].id;
        }
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

    // By passing the refresh_token, googleapis will automatically refresh 
    // the access_token under the hood when it expires
    client.setCredentials({
        access_token: user.yt_access_token,
        refresh_token: user.yt_refresh_token
    });

    return client;
}
