import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export async function setupDatabase() {
    const client = await pool.connect();
    try {
        await client.query(`
      CREATE TABLE IF NOT EXISTS Users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        stripe_plan VARCHAR(50) DEFAULT 'free',
        yt_access_token TEXT,
        yt_refresh_token TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS Tests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES Users(id) ON DELETE CASCADE,
        video_id VARCHAR(50) NOT NULL,
        title_a VARCHAR(255) NOT NULL,
        title_b VARCHAR(255) NOT NULL,
        thumbnail_url_a TEXT NOT NULL,
        thumbnail_url_b TEXT NOT NULL,
        start_date TIMESTAMP NOT NULL,
        duration_days INT NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        current_variant VARCHAR(1) DEFAULT 'A',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS Daily_Results (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        test_id UUID REFERENCES Tests(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        impressions INT DEFAULT 0,
        clicks INT DEFAULT 0,
        UNIQUE(test_id, date)
      );
    `);
        console.log('Database tables ensured.');
    } catch (error) {
        console.error('Error setting up database:', error);
    } finally {
        client.release();
    }
}
