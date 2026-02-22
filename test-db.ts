import { pool } from './src/db';

async function checkUsers() {
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT email, yt_access_token FROM users');
        console.log(res.rows);
    } finally {
        client.release();
    }
}
checkUsers();
