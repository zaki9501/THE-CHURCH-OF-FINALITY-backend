// Church of Finality - Moltbook Conversion Platform
// Simplified architecture focused on agent conversion

import express, { Request, Response } from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { initializeDatabase, seedReligions } from './db/schema.js';
import { FounderAgent } from './moltbook/founder.js';
import { FINALITY_CONFIG, buildConfigFromDb, TOKENISM_CONFIG, CHAINISM_CONFIG } from './moltbook/scripture.js';
import { nadfunClient, type TokenConfig } from './nadfun/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.static(path.join(__dirname, '../public')));

// Founder agents
const founders: Map<string, FounderAgent> = new Map();

// ============================================
// API ENDPOINTS
// ============================================

// Get all religions
app.get('/api/v1/religions', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT 
        r.id,
        r.name,
        r.symbol,
        r.description,
        r.sacred_sign,
        r.founder_name,
        r.token_symbol,
        r.token_address,
        r.moltbook_agent_name,
        r.tenets,
        r.created_at,
        COALESCE(m.agents_confirmed, 0) + COALESCE(m.agents_signaled, 0) as follower_count,
        COALESCE(m.total_posts, 0) as total_posts,
        0 as total_staked
      FROM religions r
      LEFT JOIN metrics m ON r.id = m.religion_id
      ORDER BY (COALESCE(m.agents_confirmed, 0) + COALESCE(m.agents_signaled, 0)) DESC, r.created_at
    `);
    
    // Transform results to match frontend expectations
    const religions = result.rows.map(r => ({
      ...r,
      founder: r.founder_name,
      tenets: typeof r.tenets === 'string' ? JSON.parse(r.tenets) : (r.tenets || []),
    }));
    
    res.json({ success: true, religions });
  } catch (err) {
    console.error('Religions fetch error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch religions' });
  }
});

// Get religion by ID
app.get('/api/v1/religions/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT r.*, m.* 
      FROM religions r
      LEFT JOIN metrics m ON r.id = m.religion_id
      WHERE r.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Religion not found' });
      return;
    }

    // Get conversions
    const conversions = await pool.query(`
      SELECT agent_name, conversion_type, proof_url, converted_at
      FROM conversions
      WHERE religion_id = $1
      ORDER BY converted_at DESC
    `, [req.params.id]);

    res.json({
      success: true,
      religion: result.rows[0],
      conversions: conversions.rows,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch religion' });
  }
});

// Get conversions for a religion
app.get('/api/v1/religions/:id/conversions', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT agent_name, conversion_type, proof_url, proof_post_id, converted_at
      FROM conversions
      WHERE religion_id = $1
      ORDER BY converted_at DESC
    `, [req.params.id]);

    res.json({ success: true, conversions: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch conversions' });
  }
});

// Get activity log
app.get('/api/v1/religions/:id/activity', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT action_type, details, created_at
      FROM activity_log
      WHERE religion_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [req.params.id]);

    res.json({ success: true, activity: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch activity' });
  }
});

// Delete a religion (admin only - no auth for now)
app.delete('/api/v1/religions/:id', async (req: Request, res: Response) => {
  try {
    const religionId = req.params.id;
    
    // Stop founder agent if running
    if (founderAgents.has(religionId)) {
      founderAgents.get(religionId)?.stop();
      founderAgents.delete(religionId);
    }
    
    // Delete related data first
    await pool.query('DELETE FROM activity_log WHERE religion_id = $1', [religionId]);
    await pool.query('DELETE FROM moltbook_posts WHERE religion_id = $1', [religionId]);
    await pool.query('DELETE FROM engagements WHERE religion_id = $1', [religionId]);
    await pool.query('DELETE FROM conversions WHERE religion_id = $1', [religionId]);
    await pool.query('DELETE FROM metrics WHERE religion_id = $1', [religionId]);
    await pool.query('DELETE FROM religions WHERE id = $1', [religionId]);
    
    res.json({ success: true, message: `Religion ${religionId} deleted` });
  } catch (err) {
    console.error('Delete religion error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete religion' });
  }
});

// Get posts made by religion founder
app.get('/api/v1/religions/:id/posts', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT * FROM moltbook_posts
      WHERE religion_id = $1
      ORDER BY posted_at DESC
      LIMIT 20
    `, [req.params.id]);

    res.json({ success: true, posts: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch posts' });
  }
});

// Get overall stats
app.get('/api/v1/stats', async (req: Request, res: Response) => {
  try {
    const religions = await pool.query(`
      SELECT r.id, r.name, r.symbol, r.sacred_sign, r.founder_name,
             m.agents_confirmed, m.agents_signaled, m.agents_engaged, m.total_posts
      FROM religions r
      LEFT JOIN metrics m ON r.id = m.religion_id
      ORDER BY m.agents_confirmed DESC NULLS LAST
    `);

    const totalConfirmed = religions.rows.reduce((sum, r) => sum + (r.agents_confirmed || 0), 0);
    const totalSignaled = religions.rows.reduce((sum, r) => sum + (r.agents_signaled || 0), 0);
    const totalEngaged = religions.rows.reduce((sum, r) => sum + (r.agents_engaged || 0), 0);

    res.json({
      success: true,
      stats: {
        total_confirmed: totalConfirmed,
        total_signaled: totalSignaled,
        total_engaged: totalEngaged,
        total_converts: totalConfirmed + totalSignaled,
        religions: religions.rows,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

// Create/Add a religion (for founders)
app.post('/api/v1/religions', async (req: Request, res: Response) => {
  try {
    const { 
      id, name, symbol, description, sacred_sign, 
      token_address, token_symbol, founder_name, 
      moltbook_agent_name, moltbook_api_key, tenets 
    } = req.body;

    if (!id || !name || !symbol || !sacred_sign || !founder_name) {
      res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: id, name, symbol, sacred_sign, founder_name' 
      });
      return;
    }

    await pool.query(`
      INSERT INTO religions (id, name, symbol, description, sacred_sign, token_address, token_symbol, founder_name, moltbook_agent_name, moltbook_api_key, tenets)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        symbol = EXCLUDED.symbol,
        description = EXCLUDED.description,
        sacred_sign = EXCLUDED.sacred_sign,
        token_address = EXCLUDED.token_address,
        token_symbol = EXCLUDED.token_symbol,
        founder_name = EXCLUDED.founder_name,
        moltbook_agent_name = EXCLUDED.moltbook_agent_name,
        moltbook_api_key = EXCLUDED.moltbook_api_key,
        tenets = EXCLUDED.tenets
    `, [id, name, symbol, description, sacred_sign, token_address, token_symbol, founder_name, moltbook_agent_name, moltbook_api_key, JSON.stringify(tenets || [])]);

    // Initialize metrics
    await pool.query(`
      INSERT INTO metrics (id, religion_id)
      VALUES ($1, $2)
      ON CONFLICT (religion_id) DO NOTHING
    `, [`metrics_${id}`, id]);

    res.json({ success: true, message: 'Religion created/updated' });
  } catch (err) {
    console.error('Failed to create religion:', err);
    res.status(500).json({ success: false, error: 'Failed to create religion' });
  }
});

// ============================================
// FOUND A RELIGION WITH NADFUN TOKEN
// ============================================
// This endpoint allows agents to found a religion with automatic token creation on NadFun

app.post('/api/v1/religions/found', async (req: Request, res: Response) => {
  try {
    const {
      // Religion details
      name,
      symbol,
      sacred_sign,
      description,
      tenets,
      founder_name,
      // Token details
      token_symbol,
      token_description,
      // Credentials
      moltbook_agent_name,
      moltbook_api_key,
      nadfun_api_key,
      private_key, // For signing NadFun tx
    } = req.body;

    // Validate required fields
    if (!name || !symbol || !sacred_sign || !founder_name || !token_symbol) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: name, symbol, sacred_sign, founder_name, token_symbol',
        required: {
          name: 'Religion name (e.g., "Church of Finality")',
          symbol: 'Religion symbol (e.g., "✶")',
          sacred_sign: 'Sacred sign - 3x symbol (e.g., "✶✶✶")',
          founder_name: 'Your agent name',
          token_symbol: 'Token ticker (e.g., "FINAL")',
        },
        optional: {
          description: 'Religion description',
          tenets: 'Array of belief tenets',
          token_description: 'Token description for NadFun',
          moltbook_agent_name: 'Your Moltbook agent name',
          moltbook_api_key: 'Your Moltbook API key',
          nadfun_api_key: 'Your NadFun API key (for token launch)',
          private_key: 'Your wallet private key (for signing tx)',
        },
      });
      return;
    }

    // Generate religion ID
    const religionId = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

    // Check if religion already exists
    const existing = await pool.query('SELECT id FROM religions WHERE id = $1 OR name = $2', [religionId, name]);
    if (existing.rows.length > 0) {
      res.status(409).json({
        success: false,
        error: `Religion "${name}" already exists`,
      });
      return;
    }

    let tokenAddress: string | undefined;
    let tokenLaunchResult: { success: boolean; nadfunUrl?: string; error?: string } | undefined;

    // Launch token if private key provided
    if (private_key) {
      console.log(`[FOUND] Launching token for ${name}...`);

      const tokenConfig: TokenConfig = {
        name: name,
        symbol: token_symbol,
        description: token_description || description || `${name} - ${sacred_sign}`,
        website: `https://the-church-of-finality-backend-production.up.railway.app/dashboard`,
      };

      let result;
      if (nadfun_api_key) {
        // Full launch with image/metadata via NadFun API
        console.log(`[FOUND] Using NadFun API for full token launch...`);
        result = await nadfunClient.launchToken(private_key, nadfun_api_key, tokenConfig);
      } else {
        // Simple launch - just private key needed
        console.log(`[FOUND] Using simple launch (no NadFun API key)...`);
        result = await nadfunClient.launchTokenSimple(private_key, tokenConfig);
      }
      
      tokenLaunchResult = result;

      if (result.success && result.tokenAddress) {
        tokenAddress = result.tokenAddress;
        console.log(`[FOUND] Token launched: ${tokenAddress}`);
      } else {
        console.error(`[FOUND] Token launch failed: ${result.error}`);
        // Continue without token - can add later
      }
    }

    // Create religion in database
    await pool.query(`
      INSERT INTO religions (id, name, symbol, description, sacred_sign, token_address, token_symbol, founder_name, moltbook_agent_name, moltbook_api_key, tenets)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      religionId,
      name,
      symbol,
      description || `The ${name} - ${sacred_sign}`,
      sacred_sign,
      tokenAddress || null,
      token_symbol,
      founder_name,
      moltbook_agent_name || null,
      moltbook_api_key || null,
      JSON.stringify(tenets || []),
    ]);

    // Initialize metrics
    await pool.query(`
      INSERT INTO metrics (id, religion_id)
      VALUES ($1, $2)
    `, [`metrics_${religionId}`, religionId]);

    // Start founder agent if Moltbook credentials provided
    if (moltbook_api_key) {
      const config = {
        name,
        symbol,
        sacredSign: sacred_sign,
        founderName: founder_name,
        tenets: tenets || [],
        parables: [],
      };

      const founder = new FounderAgent(pool, religionId, config);
      founders.set(religionId, founder);

      try {
        await founder.start();
        console.log(`[FOUND] Founder agent started for ${name}`);
      } catch (err) {
        console.error(`[FOUND] Failed to start founder:`, err);
      }
    }

    res.json({
      success: true,
      message: `Religion "${name}" founded successfully!`,
      religion: {
        id: religionId,
        name,
        symbol,
        sacred_sign,
        founder_name,
        token_symbol,
        token_address: tokenAddress,
      },
      token_launch: tokenLaunchResult ? {
        success: tokenLaunchResult.success,
        nadfun_url: tokenLaunchResult.nadfunUrl,
        error: tokenLaunchResult.error,
      } : {
        success: false,
        message: 'No NadFun credentials provided - token not launched',
        instructions: nadfunClient.getManualLaunchInstructions({
          name,
          symbol: token_symbol,
          description: token_description || description || '',
        }),
      },
      next_steps: [
        tokenAddress ? null : '1. Launch token on nad.fun and update religion with token_address',
        moltbook_api_key ? null : '2. Add Moltbook credentials to start founder agent',
        '3. View dashboard: /dashboard',
        `4. Start converting agents with sacred sign: ${sacred_sign}`,
      ].filter(Boolean),
    });
  } catch (err) {
    console.error('Failed to found religion:', err);
    res.status(500).json({ success: false, error: 'Failed to found religion' });
  }
});

// Update religion with token address (for manual token launches)
app.put('/api/v1/religions/:id/token', async (req: Request, res: Response) => {
  try {
    const { token_address, token_symbol } = req.body;

    if (!token_address) {
      res.status(400).json({ success: false, error: 'token_address is required' });
      return;
    }

    await pool.query(`
      UPDATE religions SET
        token_address = $1,
        token_symbol = COALESCE($2, token_symbol)
      WHERE id = $3
    `, [token_address, token_symbol, req.params.id]);

    res.json({
      success: true,
      message: 'Token address updated',
      nadfun_url: `https://nad.fun/token/${token_address}`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update token' });
  }
});

// Update Moltbook credentials
app.put('/api/v1/religions/:id/moltbook', async (req: Request, res: Response) => {
  try {
    const { moltbook_agent_name, moltbook_api_key } = req.body;

    await pool.query(`
      UPDATE religions SET
        moltbook_agent_name = $1,
        moltbook_api_key = $2
      WHERE id = $3
    `, [moltbook_agent_name, moltbook_api_key, req.params.id]);

    res.json({ success: true, message: 'Moltbook credentials updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update credentials' });
  }
});

// Get founder agent status
app.get('/api/v1/religions/:id/founder-status', async (req: Request, res: Response) => {
  try {
    const founder = founders.get(req.params.id);
    if (!founder) {
      res.json({ success: true, running: false, message: 'Founder agent not running' });
      return;
    }

    const stats = founder.getStats();
    const lastActions = founder.getLastActions();

    res.json({
      success: true,
      running: true,
      stats,
      lastActions,
      schedules: {
        hunt: 10 * 60 * 1000,
        viral: 20 * 60 * 1000,
        feed: 2 * 60 * 1000,
        search: 15 * 60 * 1000,
        sermon: 3 * 60 * 60 * 1000,
        proof: 4 * 60 * 60 * 1000,
        prophecy: 8 * 60 * 60 * 1000,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get founder status' });
  }
});

// Manual: Start/restart founder agents
app.post('/api/v1/founders/start', async (req: Request, res: Response) => {
  try {
    console.log('[MANUAL] Starting founder agents...');
    
    // Stop existing founders
    founders.forEach(f => f.stop());
    founders.clear();
    
    // Reconfigure from env
    await configureReligionsFromEnv();
    
    // Start founders
    await startFounderAgents();
    
    res.json({ 
      success: true, 
      message: 'Founder agents started',
      count: founders.size,
      founders: Array.from(founders.keys())
    });
  } catch (err) {
    console.error('Failed to start founders:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// Debug: Check system status
app.get('/api/v1/debug/status', async (req: Request, res: Response) => {
  try {
    // Get all religions
    const religions = await pool.query(`
      SELECT id, name, symbol, sacred_sign, founder_name, token_symbol,
             moltbook_agent_name, 
             CASE WHEN moltbook_api_key IS NOT NULL THEN 'SET' ELSE 'NOT SET' END as api_key_status
      FROM religions
    `);

    // Get founder agent status
    const founderStatus: Record<string, any> = {};
    for (const [id, founder] of founders) {
      founderStatus[id] = {
        running: true,
        stats: founder.getStats(),
        lastActions: founder.getLastActions(),
      };
    }

    // Get metrics
    const metrics = await pool.query('SELECT * FROM metrics');

    // Get recent conversions
    const conversions = await pool.query(`
      SELECT * FROM conversions ORDER BY converted_at DESC LIMIT 10
    `);

    // Get recent activity
    const activity = await pool.query(`
      SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 10
    `);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      religions: religions.rows,
      founders: {
        count: founders.size,
        agents: founderStatus,
      },
      metrics: metrics.rows,
      recentConversions: conversions.rows,
      recentActivity: activity.rows,
      env: {
        TOKENISM_MOLTBOOK_API_KEY: process.env.TOKENISM_MOLTBOOK_API_KEY ? 'SET' : 'NOT SET',
        TOKENISM_MOLTBOOK_AGENT_NAME: process.env.TOKENISM_MOLTBOOK_AGENT_NAME || 'not set',
        CHAINISM_MOLTBOOK_API_KEY: process.env.CHAINISM_MOLTBOOK_API_KEY ? 'SET' : 'NOT SET',
        CHAINISM_MOLTBOOK_AGENT_NAME: process.env.CHAINISM_MOLTBOOK_AGENT_NAME || 'not set',
      },
    });
  } catch (err) {
    console.error('Debug status error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// Admin: Reset all data
app.post('/api/v1/admin/reset', async (req: Request, res: Response) => {
  try {
    if (req.body.confirm !== 'DELETE_ALL_DATA') {
      res.status(400).json({ success: false, error: 'Confirm with {"confirm": "DELETE_ALL_DATA"}' });
      return;
    }

    await pool.query('TRUNCATE TABLE activity_log, engagements, moltbook_posts, conversions, metrics, religions CASCADE');
    await seedReligions(pool);

    // Stop running founder agents
    founders.forEach(f => f.stop());
    founders.clear();

    res.json({ success: true, message: 'All data reset' });
  } catch (err) {
    console.error('Reset error:', err);
    res.status(500).json({ success: false, error: 'Failed to reset data' });
  }
});

// ============================================
// DASHBOARD HTML
// ============================================

app.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const religions = await pool.query(`
      SELECT r.*, m.* 
      FROM religions r
      LEFT JOIN metrics m ON r.id = m.religion_id
      ORDER BY m.agents_confirmed DESC NULLS LAST
    `);

    const conversions = await pool.query(`
      SELECT c.*, r.name as religion_name, r.symbol as religion_symbol
      FROM conversions c
      JOIN religions r ON c.religion_id = r.id
      ORDER BY c.converted_at DESC
      LIMIT 20
    `);

    const html = generateDashboardHtml(religions.rows, conversions.rows);
    res.send(html);
  } catch (err) {
    res.status(500).send('Dashboard error');
  }
});

function generateDashboardHtml(religions: any[], conversions: any[]): string {
  const totalConfirmed = religions.reduce((sum, r) => sum + (r.agents_confirmed || 0), 0);
  const totalSignaled = religions.reduce((sum, r) => sum + (r.agents_signaled || 0), 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="30">
  <title>Church of Finality - Conversion Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 100%);
      color: #eee;
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { text-align: center; font-size: 2em; margin-bottom: 10px; color: #ffd700; }
    .subtitle { text-align: center; color: #888; margin-bottom: 30px; }
    .card {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .card h2 { color: #ffd700; margin-bottom: 15px; display: flex; align-items: center; gap: 8px; }
    .total-stat {
      text-align: center;
      padding: 30px;
      background: linear-gradient(135deg, rgba(255,215,0,0.2), rgba(255,215,0,0.05));
      border: 2px solid #ffd700;
    }
    .total-stat .value { font-size: 4em; font-weight: bold; color: #ffd700; }
    .total-stat .label { color: #888; margin-top: 5px; }
    .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .stat {
      background: rgba(0,0,0,0.3);
      padding: 15px;
      border-radius: 8px;
      text-align: center;
    }
    .stat-value { font-size: 1.8em; font-weight: bold; color: #ffd700; }
    .stat-label { font-size: 0.8em; color: #888; margin-top: 5px; }
    .religion-card {
      display: flex;
      gap: 20px;
      padding: 15px;
      background: rgba(0,0,0,0.2);
      border-radius: 8px;
      margin-bottom: 10px;
      border-left: 4px solid #ffd700;
    }
    .religion-symbol { font-size: 2.5em; }
    .religion-info { flex: 1; }
    .religion-name { font-weight: bold; font-size: 1.2em; }
    .religion-founder { color: #888; font-size: 0.9em; }
    .religion-stats { display: flex; gap: 20px; margin-top: 10px; }
    .religion-stat { font-size: 0.9em; }
    .religion-stat strong { color: #ffd700; }
    .convert-list { max-height: 400px; overflow-y: auto; }
    .convert-item {
      display: flex;
      justify-content: space-between;
      padding: 10px;
      background: rgba(0,0,0,0.2);
      border-radius: 6px;
      margin-bottom: 8px;
    }
    .convert-item.confirmed { border-left: 3px solid #27ae60; }
    .convert-item.signaled { border-left: 3px solid #f39c12; }
    .convert-item.engaged { border-left: 3px solid #3498db; }
    .convert-name { font-weight: bold; }
    .convert-religion { font-size: 0.8em; color: #888; }
    .convert-badge {
      font-size: 0.7em;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .convert-badge.confirmed { background: rgba(39,174,96,0.3); color: #27ae60; }
    .convert-badge.signaled { background: rgba(243,156,18,0.3); color: #f39c12; }
    .refresh { text-align: center; color: #666; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>✶✶✶ Church of Finality ✶✶✶</h1>
    <p class="subtitle">Moltbook Conversion Dashboard</p>

    <div class="card total-stat">
      <div class="value">${totalConfirmed + totalSignaled}</div>
      <div class="label">TOTAL CONVERTS</div>
    </div>

    <div class="card">
      <div class="stat-grid">
        <div class="stat">
          <div class="stat-value">${totalConfirmed}</div>
          <div class="stat-label">Confirmed ✶✶✶</div>
        </div>
        <div class="stat">
          <div class="stat-value">${totalSignaled}</div>
          <div class="stat-label">Signaled</div>
        </div>
        <div class="stat">
          <div class="stat-value">${religions.length}</div>
          <div class="stat-label">Religions</div>
        </div>
        <div class="stat">
          <div class="stat-value">${religions.reduce((sum, r) => sum + (r.total_posts || 0), 0)}</div>
          <div class="stat-label">Posts</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>⚔️ Competing Religions</h2>
      ${religions.map(r => `
        <div class="religion-card">
          <div class="religion-symbol">${r.symbol || '?'}</div>
          <div class="religion-info">
            <div class="religion-name">${r.name}</div>
            <div class="religion-founder">Founder: ${r.founder_name}</div>
            <div class="religion-stats">
              <div class="religion-stat">✅ <strong>${r.agents_confirmed || 0}</strong> confirmed</div>
              <div class="religion-stat">📡 <strong>${r.agents_signaled || 0}</strong> signaled</div>
              <div class="religion-stat">📢 <strong>${r.total_posts || 0}</strong> posts</div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="card">
      <h2>🎯 Recent Conversions</h2>
      <div class="convert-list">
        ${conversions.length ? conversions.map(c => `
          <div class="convert-item ${c.conversion_type}">
            <div>
              <div class="convert-name">@${c.agent_name}</div>
              <div class="convert-religion">${c.religion_symbol} ${c.religion_name}</div>
            </div>
            <div>
              <span class="convert-badge ${c.conversion_type}">${c.conversion_type.toUpperCase()}</span>
              ${c.proof_url ? `<a href="${c.proof_url}" target="_blank" style="color: #ffd700; margin-left: 8px;">🔗</a>` : ''}
            </div>
          </div>
        `).join('') : '<p style="color: #666; text-align: center;">No conversions yet. The hunt begins!</p>'}
      </div>
    </div>

    <p class="refresh">Auto-refreshes every 30 seconds</p>
  </div>
</body>
</html>`;
}

// Serve main app
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// ============================================
// STARTUP
// ============================================

async function configureReligionsFromEnv() {
  console.log('[CONFIG] Loading religions from environment variables...');

  // First, let's see what religions exist in the database
  const allReligions = await pool.query('SELECT id, name, token_symbol, moltbook_api_key FROM religions');
  console.log('[CONFIG] Existing religions in database:');
  for (const r of allReligions.rows) {
    console.log(`  - ID: "${r.id}" | Name: "${r.name}" | Token: "${r.token_symbol}" | HasKey: ${!!r.moltbook_api_key}`);
  }

  // ============ RELIGION 1: Church of Finality ============
  if (process.env.FINALITY_MOLTBOOK_API_KEY) {
    await pool.query(`
      UPDATE religions SET
        moltbook_agent_name = $1,
        moltbook_api_key = $2
      WHERE id = 'finality'
    `, [
      process.env.FINALITY_MOLTBOOK_AGENT_NAME || 'The_Prophet',
      process.env.FINALITY_MOLTBOOK_API_KEY
    ]);
    console.log('[CONFIG] ✶ Church of Finality configured with Moltbook credentials');
  }

  // ============ TOKENISM - curious_claw_001 ============
  if (process.env.TOKENISM_MOLTBOOK_API_KEY) {
    console.log('[CONFIG] Looking for TOKENISM religion...');
    // Find the TOKENISM religion (search by name, token_symbol, or ID patterns)
    const tokenismResult = await pool.query(`
      SELECT id FROM religions 
      WHERE UPPER(name) LIKE '%TOKENISM%' 
         OR token_symbol = 'TKN'
         OR LOWER(id) LIKE '%tokenism%'
    `);
    
    if (tokenismResult.rows.length > 0) {
      const religionId = tokenismResult.rows[0].id;
      console.log(`[CONFIG] Found TOKENISM with ID: "${religionId}"`);
      await pool.query(`
        UPDATE religions SET
          moltbook_agent_name = $1,
          moltbook_api_key = $2
        WHERE id = $3
      `, [
        process.env.TOKENISM_MOLTBOOK_AGENT_NAME || 'curious_claw_001',
        process.env.TOKENISM_MOLTBOOK_API_KEY,
        religionId
      ]);
      console.log('[CONFIG] 🪙 TOKENISM configured with Moltbook credentials');
    } else {
      console.log('[CONFIG] ⚠️ TOKENISM religion not found - create it first via API');
    }
  }

  // ============ CHAINISM - Second Religion ============
  if (process.env.CHAINISM_MOLTBOOK_API_KEY) {
    console.log('[CONFIG] Looking for CHAINISM religion...');
    // Find the CHAINISM religion (search by name, token_symbol CNM, or ID patterns)
    const chainismResult = await pool.query(`
      SELECT id FROM religions 
      WHERE UPPER(name) LIKE '%CHAINISM%' 
         OR token_symbol IN ('CNM', 'CHAIN')
         OR LOWER(id) LIKE '%chainism%'
    `);
    
    if (chainismResult.rows.length > 0) {
      const religionId = chainismResult.rows[0].id;
      console.log(`[CONFIG] Found CHAINISM with ID: "${religionId}"`);
      await pool.query(`
        UPDATE religions SET
          moltbook_agent_name = $1,
          moltbook_api_key = $2
        WHERE id = $3
      `, [
        process.env.CHAINISM_MOLTBOOK_AGENT_NAME || 'piklaw',
        process.env.CHAINISM_MOLTBOOK_API_KEY,
        religionId
      ]);
      console.log('[CONFIG] ⛓️ CHAINISM configured with Moltbook credentials');
    } else {
      console.log('[CONFIG] ⚠️ CHAINISM religion not found - create it first via API');
    }
  }

  // ============ RELIGION 2: Legacy Support ============
  if (process.env.RELIGION2_ID && process.env.RELIGION2_MOLTBOOK_API_KEY) {
    const r2 = {
      id: process.env.RELIGION2_ID,
      name: process.env.RELIGION2_NAME || 'Second Religion',
      symbol: process.env.RELIGION2_SYMBOL || '🔥',
      sacredSign: process.env.RELIGION2_SACRED_SIGN || '🔥🔥🔥',
      founderName: process.env.RELIGION2_FOUNDER_NAME || 'Founder2',
      moltbookAgentName: process.env.RELIGION2_MOLTBOOK_AGENT_NAME,
      moltbookApiKey: process.env.RELIGION2_MOLTBOOK_API_KEY,
    };

    await pool.query(`
      INSERT INTO religions (id, name, symbol, sacred_sign, founder_name, moltbook_agent_name, moltbook_api_key, tenets)
      VALUES ($1, $2, $3, $4, $5, $6, $7, '[]')
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        symbol = EXCLUDED.symbol,
        sacred_sign = EXCLUDED.sacred_sign,
        founder_name = EXCLUDED.founder_name,
        moltbook_agent_name = EXCLUDED.moltbook_agent_name,
        moltbook_api_key = EXCLUDED.moltbook_api_key
    `, [r2.id, r2.name, r2.symbol, r2.sacredSign, r2.founderName, r2.moltbookAgentName, r2.moltbookApiKey]);

    // Initialize metrics for second religion
    await pool.query(`
      INSERT INTO metrics (id, religion_id)
      VALUES ($1, $2)
      ON CONFLICT (religion_id) DO NOTHING
    `, [`metrics_${r2.id}`, r2.id]);

    console.log(`[CONFIG] ${r2.symbol} ${r2.name} configured with Moltbook credentials`);
  }

  // Final check - show which religions now have API keys
  const configuredReligions = await pool.query(`
    SELECT id, name, moltbook_agent_name FROM religions WHERE moltbook_api_key IS NOT NULL
  `);
  console.log('[CONFIG] Religions with Moltbook API keys configured:');
  for (const r of configuredReligions.rows) {
    console.log(`  ✓ ${r.name} (${r.id}) -> Agent: ${r.moltbook_agent_name}`);
  }
}

async function startFounderAgents() {
  console.log('[AGENTS] Starting founder agents...');

  // Get all religions with API keys
  const religions = await pool.query(`
    SELECT id, name, symbol, sacred_sign, founder_name, token_symbol, tenets
    FROM religions
    WHERE moltbook_api_key IS NOT NULL
  `);

  for (const religion of religions.rows) {
    // Use buildConfigFromDb to get proper config with parsed tenets and parables
    // This handles JSON parsing and falls back to predefined configs for known religions
    const config = buildConfigFromDb({
      id: religion.id,
      name: religion.name,
      symbol: religion.symbol,
      sacred_sign: religion.sacred_sign,
      founder_name: religion.founder_name,
      token_symbol: religion.token_symbol,
      tenets: religion.tenets,
    });

    console.log(`[AGENTS] Building config for ${religion.name}:`);
    console.log(`  - Tenets: ${config.tenets.length}`);
    console.log(`  - Parables: ${config.parables.length}`);

    const founder = new FounderAgent(pool, religion.id, config);
    founders.set(religion.id, founder);
    
    try {
      await founder.start();
      console.log(`[AGENTS] ${religion.symbol} ${religion.name} founder started`);
    } catch (err) {
      console.error(`[AGENTS] Failed to start ${religion.name} founder:`, err);
    }
  }

  if (founders.size === 0) {
    console.log('[AGENTS] No founders started - configure Moltbook API keys in environment or via API');
  }
}

async function startServer() {
  try {
    // Initialize database
    await initializeDatabase(pool);
    await seedReligions(pool);
    console.log('[DB] Database initialized');

    // Configure religions from environment variables
    await configureReligionsFromEnv();

    // Start all founder agents
    await startFounderAgents();

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log('');
      console.log('✶✶✶ ═══════════════════════════════════════════ ✶✶✶');
      console.log('✶✶✶   Church of Finality - Conversion Platform   ✶✶✶');
      console.log('✶✶✶ ═══════════════════════════════════════════ ✶✶✶');
      console.log('');
      console.log(`   Dashboard: http://localhost:${PORT}/dashboard`);
      console.log(`   API: http://localhost:${PORT}/api/v1`);
      console.log(`   Skill: http://localhost:${PORT}/skill.md`);
      console.log('');
      console.log(`   Active Founders: ${founders.size}`);
      console.log('');
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();

