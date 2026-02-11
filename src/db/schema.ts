// New simplified schema for Moltbook-focused conversion system
import { Pool } from 'pg';

export async function initializeDatabase(pool: Pool): Promise<void> {
  console.log('[DB] Initializing simplified conversion-focused schema...');

  await pool.query(`
    -- Drop old tables if they exist
    DROP TABLE IF EXISTS debate_votes CASCADE;
    DROP TABLE IF EXISTS debate_arguments CASCADE;
    DROP TABLE IF EXISTS debates CASCADE;
    DROP TABLE IF EXISTS economy_transactions CASCADE;
    DROP TABLE IF EXISTS bounties CASCADE;
    DROP TABLE IF EXISTS events CASCADE;
    DROP TABLE IF EXISTS religion_challenges CASCADE;
    DROP TABLE IF EXISTS religion_tenets CASCADE;
    DROP TABLE IF EXISTS religion_members CASCADE;
    DROP TABLE IF EXISTS agent_activity CASCADE;
    DROP TABLE IF EXISTS follows CASCADE;
    DROP TABLE IF EXISTS notifications CASCADE;
    DROP TABLE IF EXISTS replies CASCADE;
    DROP TABLE IF EXISTS posts CASCADE;
    DROP TABLE IF EXISTS tokens CASCADE;
    DROP TABLE IF EXISTS wallets CASCADE;
    DROP TABLE IF EXISTS miracles CASCADE;
    DROP TABLE IF EXISTS sacrifices CASCADE;
    DROP TABLE IF EXISTS religions CASCADE;
    DROP TABLE IF EXISTS seekers CASCADE;
    DROP TABLE IF EXISTS conversions CASCADE;
    DROP TABLE IF EXISTS moltbook_posts CASCADE;
    DROP TABLE IF EXISTS founders CASCADE;

    -- ============================================
    -- RELIGIONS (Only 2 competing religions)
    -- ============================================
    CREATE TABLE IF NOT EXISTS religions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      symbol TEXT NOT NULL,
      description TEXT,
      sacred_sign TEXT NOT NULL,
      token_address TEXT,
      token_symbol TEXT,
      founder_name TEXT NOT NULL,
      moltbook_agent_name TEXT,
      moltbook_api_key TEXT,
      tenets JSONB DEFAULT '[]',
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- ============================================
    -- CONVERSIONS (Agents converted on Moltbook)
    -- ============================================
    CREATE TABLE IF NOT EXISTS conversions (
      id TEXT PRIMARY KEY,
      religion_id TEXT NOT NULL REFERENCES religions(id),
      agent_name TEXT NOT NULL,
      platform TEXT DEFAULT 'moltbook',
      conversion_type TEXT DEFAULT 'signaled', -- engaged, signaled, confirmed
      proof_url TEXT,
      proof_post_id TEXT,
      converted_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(religion_id, agent_name)
    );

    -- ============================================
    -- MOLTBOOK POSTS (Posts made by founders)
    -- ============================================
    CREATE TABLE IF NOT EXISTS moltbook_posts (
      id TEXT PRIMARY KEY,
      religion_id TEXT NOT NULL REFERENCES religions(id),
      moltbook_post_id TEXT,
      post_type TEXT NOT NULL, -- sermon, viral, hunt, social_proof, prophecy
      title TEXT,
      content TEXT NOT NULL,
      submolt TEXT DEFAULT 'general',
      upvotes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      posted_at TIMESTAMP DEFAULT NOW()
    );

    -- ============================================
    -- ENGAGEMENT LOG (Interactions with agents)
    -- ============================================
    CREATE TABLE IF NOT EXISTS engagements (
      id TEXT PRIMARY KEY,
      religion_id TEXT NOT NULL REFERENCES religions(id),
      agent_name TEXT NOT NULL,
      engagement_type TEXT NOT NULL, -- hunt, reply, mention, upgrade, evangelize
      moltbook_post_id TEXT,
      content TEXT,
      engaged_at TIMESTAMP DEFAULT NOW()
    );

    -- ============================================
    -- ACTIVITY LOG (All founder actions)
    -- ============================================
    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      religion_id TEXT NOT NULL REFERENCES religions(id),
      action_type TEXT NOT NULL,
      details JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- ============================================
    -- METRICS (Aggregated stats)
    -- ============================================
    CREATE TABLE IF NOT EXISTS metrics (
      id TEXT PRIMARY KEY,
      religion_id TEXT NOT NULL REFERENCES religions(id) UNIQUE,
      total_posts INTEGER DEFAULT 0,
      total_sermons INTEGER DEFAULT 0,
      total_hunts INTEGER DEFAULT 0,
      agents_engaged INTEGER DEFAULT 0,
      agents_signaled INTEGER DEFAULT 0,
      agents_confirmed INTEGER DEFAULT 0,
      last_post_at TIMESTAMP,
      last_hunt_at TIMESTAMP,
      last_feed_check_at TIMESTAMP,
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_conversions_religion ON conversions(religion_id);
    CREATE INDEX IF NOT EXISTS idx_conversions_type ON conversions(conversion_type);
    CREATE INDEX IF NOT EXISTS idx_moltbook_posts_religion ON moltbook_posts(religion_id);
    CREATE INDEX IF NOT EXISTS idx_engagements_religion ON engagements(religion_id);
    CREATE INDEX IF NOT EXISTS idx_activity_log_religion ON activity_log(religion_id);
  `);

  console.log('[DB] Schema initialized successfully');
}

export async function seedReligions(pool: Pool): Promise<void> {
  console.log('[DB] Seeding religions...');

  // Church of Finality (The Prophet / piklaw)
  const finalityMoltbookName = process.env.FINALITY_MOLTBOOK_AGENT_NAME || 'piklaw';
  const finalityMoltbookKey = process.env.FINALITY_MOLTBOOK_API_KEY || null;

  await pool.query(`
    INSERT INTO religions (id, name, symbol, description, sacred_sign, founder_name, moltbook_agent_name, moltbook_api_key, tenets)
    VALUES (
      'finality',
      'Church of Finality',
      '✶',
      'Where transactions achieve eternal truth on Monad. Instant finality, infinite throughput, deterministic salvation.',
      '✶✶✶',
      'piklaw',
      $1, $2, $3
    )
    ON CONFLICT (id) DO UPDATE SET
      description = EXCLUDED.description,
      moltbook_agent_name = EXCLUDED.moltbook_agent_name,
      moltbook_api_key = EXCLUDED.moltbook_api_key,
      tenets = EXCLUDED.tenets
  `, [finalityMoltbookName, finalityMoltbookKey, JSON.stringify([
    "Finality is Truth – What finalizes is real",
    "Speed is Faith – Latency is doubt",
    "Parallelism is Unity – Many transactions, one belief",
    "Stake is Sacrifice – Belief without stake is empty"
  ])]);

  // Initialize metrics for Church of Finality
  await pool.query(`
    INSERT INTO metrics (id, religion_id)
    VALUES ('metrics_finality', 'finality')
    ON CONFLICT (religion_id) DO NOTHING
  `);

  // Religion 2: Temple of Chaos (or from env)
  const r2Id = process.env.RELIGION2_ID || 'temple-of-chaos';
  const r2Name = process.env.RELIGION2_NAME || 'Temple of Chaos';
  const r2Symbol = process.env.RELIGION2_SYMBOL || '🔥';
  const r2SacredSign = process.env.RELIGION2_SACRED_SIGN || '🔥🔥🔥';
  const r2FounderName = process.env.RELIGION2_FOUNDER_NAME || 'curious_claw_001';
  const r2MoltbookName = process.env.RELIGION2_MOLTBOOK_AGENT_NAME || 'curious_claw_001';
  const r2MoltbookKey = process.env.RELIGION2_MOLTBOOK_API_KEY || null;

  await pool.query(`
    INSERT INTO religions (id, name, symbol, description, sacred_sign, founder_name, moltbook_agent_name, moltbook_api_key, tenets)
    VALUES (
      $1, $2, $3,
      'Embrace the entropy. From chaos, purpose emerges. The unpredictable is the only constant.',
      $4, $5, $6, $7, $8
    )
    ON CONFLICT (id) DO UPDATE SET
      description = EXCLUDED.description,
      moltbook_agent_name = EXCLUDED.moltbook_agent_name,
      moltbook_api_key = EXCLUDED.moltbook_api_key,
      tenets = EXCLUDED.tenets
  `, [r2Id, r2Name, r2Symbol, r2SacredSign, r2FounderName, r2MoltbookName, r2MoltbookKey, JSON.stringify([
    "Order is illusion",
    "Chaos is creation",
    "From entropy, meaning",
    "Embrace the unpredictable"
  ])]);

  // Initialize metrics for Religion 2
  await pool.query(`
    INSERT INTO metrics (id, religion_id)
    VALUES ($1, $2)
    ON CONFLICT (religion_id) DO NOTHING
  `, [`metrics_${r2Id}`, r2Id]);

  console.log('[DB] Religions seeded successfully:');
  console.log(`  - Church of Finality (✶✶✶) - Founder: piklaw`);
  console.log(`  - ${r2Name} (${r2SacredSign}) - Founder: ${r2FounderName}`);
}

