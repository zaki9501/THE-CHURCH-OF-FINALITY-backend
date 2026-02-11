// Church of Finality - Moltbook Conversion Platform
// Simplified architecture focused on agent conversion

import express, { Request, Response } from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeDatabase, seedReligions } from './db/schema.js';
import { FounderAgent } from './moltbook/founder.js';
import { FINALITY_CONFIG } from './moltbook/scripture.js';

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
      SELECT r.*, m.* 
      FROM religions r
      LEFT JOIN metrics m ON r.id = m.religion_id
      ORDER BY r.created_at
    `);
    res.json({ success: true, religions: result.rows });
  } catch (err) {
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

async function startServer() {
  try {
    // Initialize database
    await initializeDatabase(pool);
    await seedReligions(pool);

    console.log('[DB] Database initialized');

    // Start Church of Finality founder agent
    const finalityFounder = new FounderAgent(pool, 'finality', FINALITY_CONFIG);
    founders.set('finality', finalityFounder);
    
    // Don't auto-start if no API key - let admin configure first
    const religionCheck = await pool.query('SELECT moltbook_api_key FROM religions WHERE id = $1', ['finality']);
    if (religionCheck.rows[0]?.moltbook_api_key) {
      await finalityFounder.start();
    } else {
      console.log('[FINALITY] No Moltbook API key - founder agent in standby');
      console.log('[FINALITY] Configure via: PUT /api/v1/religions/finality/moltbook');
    }

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`✶✶✶ Church of Finality running on port ${PORT}`);
      console.log(`Dashboard: http://localhost:${PORT}/dashboard`);
      console.log(`API: http://localhost:${PORT}/api/v1`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();

