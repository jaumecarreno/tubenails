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
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

      CREATE TABLE IF NOT EXISTS Oauth_States (
        nonce VARCHAR(64) PRIMARY KEY,
        user_id UUID REFERENCES Users(id) ON DELETE CASCADE,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

        await client.query(`
      ALTER TABLE daily_results
      ADD COLUMN IF NOT EXISTS impressions_ctr NUMERIC(8,5) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS views INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS estimated_minutes_watched NUMERIC(12,3) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS average_view_duration_seconds NUMERIC(10,3) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS metric_version SMALLINT NOT NULL DEFAULT 2
    `);

        await client.query(`
      ALTER TABLE tests
      ADD COLUMN IF NOT EXISTS winner_variant CHAR(1),
      ADD COLUMN IF NOT EXISTS winner_mode VARCHAR(20),
      ADD COLUMN IF NOT EXISTS winner_confidence NUMERIC(6,5),
      ADD COLUMN IF NOT EXISTS winner_score_a NUMERIC(8,5),
      ADD COLUMN IF NOT EXISTS winner_score_b NUMERIC(8,5),
      ADD COLUMN IF NOT EXISTS decision_reason TEXT,
      ADD COLUMN IF NOT EXISTS review_required BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP
    `);

        await client.query(`
      ALTER TABLE tests
      DROP CONSTRAINT IF EXISTS tests_winner_variant_check
    `);
        await client.query(`
      ALTER TABLE tests
      ADD CONSTRAINT tests_winner_variant_check CHECK (winner_variant IN ('A','B') OR winner_variant IS NULL)
    `);

        await client.query(`
      ALTER TABLE tests
      DROP CONSTRAINT IF EXISTS tests_winner_mode_check
    `);
        await client.query(`
      ALTER TABLE tests
      ADD CONSTRAINT tests_winner_mode_check CHECK (winner_mode IN ('auto','manual','inconclusive') OR winner_mode IS NULL)
    `);

        await client.query(`
      UPDATE tests
      SET status = 'finished'
      WHERE status = 'completed'
    `);

        await client.query(`
      UPDATE daily_results
      SET
        impressions_ctr = CASE
          WHEN impressions > 0 THEN ROUND((clicks::numeric / impressions) * 100, 5)
          ELSE 0
        END,
        views = CASE WHEN views = 0 THEN clicks ELSE views END,
        metric_version = 1
      WHERE metric_version = 2
        AND views = 0
        AND estimated_minutes_watched = 0
        AND average_view_duration_seconds = 0
    `);

        console.log('Database tables ensured.');
    } catch (error) {
        console.error('Error setting up database:', error);
    } finally {
        client.release();
    }
}
