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
        stripe_plan VARCHAR(50) DEFAULT 'basic',
        yt_access_token TEXT,
        yt_refresh_token TEXT,
        current_workspace_id UUID,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS Workspaces (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_user_id UUID UNIQUE REFERENCES Users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS Workspace_Members (
        workspace_id UUID REFERENCES Workspaces(id) ON DELETE CASCADE,
        user_id UUID REFERENCES Users(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(workspace_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS Workspace_Invites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID REFERENCES Workspaces(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        email_norm VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL,
        token_hash VARCHAR(128) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        invited_by_user_id UUID REFERENCES Users(id) ON DELETE CASCADE,
        accepted_by_user_id UUID REFERENCES Users(id) ON DELETE SET NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        accepted_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS Tests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES Users(id) ON DELETE CASCADE,
        workspace_id UUID REFERENCES Workspaces(id) ON DELETE CASCADE,
        created_by_user_id UUID REFERENCES Users(id) ON DELETE CASCADE,
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
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS current_workspace_id UUID
    `);

        await client.query(`
      ALTER TABLE tests
      ADD COLUMN IF NOT EXISTS workspace_id UUID,
      ADD COLUMN IF NOT EXISTS created_by_user_id UUID
    `);

        await client.query(`
      UPDATE users
      SET stripe_plan = CASE
        WHEN stripe_plan IS NULL OR BTRIM(stripe_plan) = '' OR LOWER(stripe_plan) IN ('free', 'basic') THEN 'basic'
        WHEN LOWER(stripe_plan) IN ('pro', 'premium') THEN 'premium'
        WHEN LOWER(stripe_plan) = 'teams' THEN 'teams'
        ELSE 'basic'
      END
    `);

        await client.query(`
      ALTER TABLE users
      ALTER COLUMN stripe_plan SET DEFAULT 'basic'
    `);

        await client.query(`
      ALTER TABLE users
      DROP CONSTRAINT IF EXISTS users_stripe_plan_check
    `);
        await client.query(`
      ALTER TABLE users
      ADD CONSTRAINT users_stripe_plan_check CHECK (stripe_plan IN ('basic', 'premium', 'teams'))
    `);

        await client.query(`
      ALTER TABLE users
      DROP CONSTRAINT IF EXISTS users_current_workspace_id_fkey
    `);
        await client.query(`
      ALTER TABLE users
      ADD CONSTRAINT users_current_workspace_id_fkey
      FOREIGN KEY (current_workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
    `);

        await client.query(`
      ALTER TABLE workspace_members
      DROP CONSTRAINT IF EXISTS workspace_members_role_check
    `);
        await client.query(`
      ALTER TABLE workspace_members
      ADD CONSTRAINT workspace_members_role_check CHECK (role IN ('owner', 'admin', 'member'))
    `);

        await client.query(`
      ALTER TABLE workspace_invites
      DROP CONSTRAINT IF EXISTS workspace_invites_role_check
    `);
        await client.query(`
      ALTER TABLE workspace_invites
      ADD CONSTRAINT workspace_invites_role_check CHECK (role IN ('admin', 'member'))
    `);

        await client.query(`
      ALTER TABLE workspace_invites
      DROP CONSTRAINT IF EXISTS workspace_invites_status_check
    `);
        await client.query(`
      ALTER TABLE workspace_invites
      ADD CONSTRAINT workspace_invites_status_check CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired'))
    `);

        await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_workspace_invites_pending_email
      ON workspace_invites(workspace_id, email_norm)
      WHERE status = 'pending'
    `);
        await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_workspace_invites_token_hash
      ON workspace_invites(token_hash)
    `);
        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id
      ON workspace_members(user_id)
    `);
        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_status
      ON workspace_invites(workspace_id, status)
    `);

        await client.query(`
      INSERT INTO workspaces (owner_user_id, name)
      SELECT
        u.id,
        (COALESCE(NULLIF(split_part(u.email, '@', 1), ''), 'Workspace') || '''s Workspace')::varchar(255)
      FROM users u
      ON CONFLICT (owner_user_id) DO NOTHING
    `);

        await client.query(`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      SELECT w.id, w.owner_user_id, 'owner'
      FROM workspaces w
      ON CONFLICT (workspace_id, user_id) DO NOTHING
    `);

        await client.query(`
      UPDATE users u
      SET current_workspace_id = w.id
      FROM workspaces w
      WHERE w.owner_user_id = u.id
        AND u.current_workspace_id IS NULL
    `);

        await client.query(`
      UPDATE tests t
      SET workspace_id = w.id
      FROM workspaces w
      WHERE w.owner_user_id = t.user_id
        AND t.workspace_id IS NULL
    `);

        await client.query(`
      UPDATE tests
      SET created_by_user_id = user_id
      WHERE created_by_user_id IS NULL
    `);

        await client.query(`
      ALTER TABLE tests
      DROP CONSTRAINT IF EXISTS tests_workspace_id_fkey
    `);
        await client.query(`
      ALTER TABLE tests
      ADD CONSTRAINT tests_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    `);

        await client.query(`
      ALTER TABLE tests
      DROP CONSTRAINT IF EXISTS tests_created_by_user_id_fkey
    `);
        await client.query(`
      ALTER TABLE tests
      ADD CONSTRAINT tests_created_by_user_id_fkey
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
    `);

        await client.query(`
      ALTER TABLE tests
      ALTER COLUMN workspace_id SET NOT NULL
    `);
        await client.query(`
      ALTER TABLE tests
      ALTER COLUMN created_by_user_id SET NOT NULL
    `);

        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tests_workspace_status_start_date
      ON tests(workspace_id, status, start_date DESC)
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
