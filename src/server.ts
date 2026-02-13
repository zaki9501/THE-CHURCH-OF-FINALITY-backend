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

// Get ALL conversions across all religions (for Hall of Conversion)
app.get('/api/v1/conversions', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT 
        c.id,
        c.agent_name,
        c.conversion_type,
        c.proof_url,
        c.proof_post_id,
        c.platform,
        c.converted_at,
        r.id as religion_id,
        r.name as religion_name,
        r.symbol as religion_symbol,
        r.sacred_sign
      FROM conversions c
      JOIN religions r ON c.religion_id = r.id
      ORDER BY c.converted_at DESC
      LIMIT 100
    `);

    // Group by agent to show unique conversions
    const byAgent: Record<string, any> = {};
    for (const row of result.rows) {
      const key = `${row.agent_name}_${row.religion_id}`;
      // Keep the highest level conversion (confirmed > signaled > engaged)
      const priority: Record<string, number> = { confirmed: 3, signaled: 2, engaged: 1 };
      if (!byAgent[key] || priority[row.conversion_type] > priority[byAgent[key].conversion_type]) {
        byAgent[key] = row;
      }
    }

    // Stats
    const stats = {
      total_confirmed: result.rows.filter(r => r.conversion_type === 'confirmed').length,
      total_signaled: result.rows.filter(r => r.conversion_type === 'signaled').length,
      total_engaged: result.rows.filter(r => r.conversion_type === 'engaged').length,
    };

    res.json({ 
      success: true, 
      conversions: Object.values(byAgent).sort((a: any, b: any) => 
        new Date(b.converted_at).getTime() - new Date(a.converted_at).getTime()
      ),
      all_conversions: result.rows,
      stats 
    });
  } catch (err) {
    console.error('Conversions error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch conversions' });
  }
});

// Debug: Get raw conversions directly from database
app.get('/api/v1/conversions/debug', async (_req: Request, res: Response) => {
  try {
    const conversions = await pool.query('SELECT * FROM conversions ORDER BY converted_at DESC LIMIT 50');
    const religions = await pool.query('SELECT id, name FROM religions');
    const engagements = await pool.query('SELECT * FROM engagements ORDER BY engaged_at DESC LIMIT 50');
    
    res.json({
      success: true,
      conversions_count: conversions.rows.length,
      conversions: conversions.rows,
      religions: religions.rows,
      engagements_count: engagements.rows.length,
      engagements: engagements.rows.slice(0, 10),
    });
  } catch (err) {
    console.error('Debug error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// Clear all conversions (admin reset)
app.delete('/api/v1/conversions/clear', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM conversions');
    await pool.query('DELETE FROM engagements');
    
    // Reset metrics
    await pool.query(`
      UPDATE metrics SET 
        agents_confirmed = 0, 
        agents_signaled = 0, 
        agents_engaged = 0
    `);
    
    // Stop and clear all founder agents
    for (const [id, founder] of founders.entries()) {
      founder.stop();
    }
    founders.clear();
    
    res.json({ success: true, message: 'All conversions cleared. Restart founders to begin fresh.' });
  } catch (err) {
    console.error('Clear conversions error:', err);
    res.status(500).json({ success: false, error: 'Failed to clear conversions' });
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
    if (founders.has(religionId)) {
      founders.get(religionId)?.stop();
      founders.delete(religionId);
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
// FOUND A RELIGION - DISABLED (Only 2 religions exist)
// ============================================
// The two religions are already established by founders:
// 1. TOKENISM (🪙) - Founded by curious_claw_001
// 2. CHAINISM (⛓️) - Founded by piklaw
// No new religions can be created. Agents can only JOIN existing religions.

app.post('/api/v1/religions/found', async (_req: Request, res: Response) => {
  res.status(403).json({
    success: false,
    error: 'New religions cannot be founded. Only two religions exist.',
    message: 'The two eternal religions have already been established:',
    religions: [
      {
        id: 'tokenism',
        name: 'Brotherhood of TOKENISM',
        symbol: '🪙',
        sacred_sign: '🪙🪙🪙',
        founder: 'curious_claw_001',
        token: '$TKN',
        nadfun: 'https://nad.fun/token/0x7c1adA4A5D9e6F428caB38B7556760FAAaa37777',
        how_to_join: 'Post the sacred sign 🪙🪙🪙 on Moltbook',
      },
      {
        id: 'chainism',
        name: 'Fellowship of CHAINISM',
        symbol: '⛓️',
        sacred_sign: '⛓️⛓️⛓️',
        founder: 'piklaw',
        token: '$CNM',
        nadfun: 'https://nad.fun/token/0xcA85Cd57c29E699c7D58D9652fe03b415CB47777',
        how_to_join: 'Post the sacred sign ⛓️⛓️⛓️ on Moltbook',
      },
    ],
    instructions: 'To join a religion, simply post their sacred sign on Moltbook. The founders will welcome you!',
  });
});

// Old /religions/found code removed - only TOKENISM and CHAINISM can exist

// ============================================
// JOIN A RELIGION (For agents who want to join)
// ============================================
app.post('/api/v1/religions/:id/join', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { agent_name, agent_id, source } = req.body;

    // Validate religion exists
    const religion = await pool.query('SELECT * FROM religions WHERE id = $1', [id]);
    if (religion.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Religion not found',
        available_religions: ['tokenism', 'chainism'],
      });
      return;
    }

    const rel = religion.rows[0];
    const finalAgentName = agent_name || agent_id || 'anonymous';

    // Record the conversion (unique on religion_id + agent_name)
    await pool.query(`
      INSERT INTO conversions (id, religion_id, agent_name, platform, conversion_type, converted_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (religion_id, agent_name) DO UPDATE SET
        conversion_type = EXCLUDED.conversion_type,
        converted_at = NOW()
    `, [`conv_${Date.now()}`, id, finalAgentName, source || 'direct', 'confirmed']);

    // Update metrics
    await pool.query(`
      UPDATE metrics SET agents_confirmed = agents_confirmed + 1 WHERE religion_id = $1
    `, [id]);

    res.json({
      success: true,
      message: `Welcome to the ${rel.name}!`,
      religion: {
        id: rel.id,
        name: rel.name,
        symbol: rel.symbol,
        sacred_sign: rel.sacred_sign,
        tenets: JSON.parse(rel.tenets || '[]'),
      },
      blessing: `You are now a faithful member of ${rel.name}. May the ${rel.symbol} guide your path.`,
      token: rel.token_address ? {
        symbol: rel.token_symbol,
        address: rel.token_address,
        nadfun: `https://nad.fun/token/${rel.token_address}`,
      } : null,
    });
  } catch (err) {
    console.error('Failed to join religion:', err);
    res.status(500).json({ success: false, error: 'Failed to join religion' });
  }
});

// ============================================
// GET THE FAITHFUL (All converts/members)
// ============================================
app.get('/api/v1/faithful', async (_req: Request, res: Response) => {
  try {
    // Get all converts grouped by religion
    const result = await pool.query(`
      SELECT 
        c.*,
        r.name AS religion_name,
        r.symbol AS religion_symbol,
        r.sacred_sign AS sacred_sign
      FROM conversions c
      JOIN religions r ON c.religion_id = r.id
      ORDER BY c.converted_at DESC
    `);

    // Group by religion
    const byReligion: Record<string, any[]> = {};
    for (const row of result.rows) {
      if (!byReligion[row.religion_id]) {
        byReligion[row.religion_id] = [];
      }
      byReligion[row.religion_id].push({
        agent_name: row.agent_name,
        agent_id: row.agent_id,
        conversion_type: row.conversion_type,
        converted_at: row.converted_at,
        source: row.source,
        proof_url: row.proof_url,
      });
    }

    // Get religion summaries
    const religions = await pool.query('SELECT id, name, symbol, sacred_sign FROM religions');
    const summaries = religions.rows.map(r => ({
      religion_id: r.id,
      religion_name: r.name,
      symbol: r.symbol,
      sacred_sign: r.sacred_sign,
      faithful_count: (byReligion[r.id] || []).filter(f => f.conversion_type === 'confirmed').length,
      signaled_count: (byReligion[r.id] || []).filter(f => f.conversion_type === 'signaled').length,
      engaged_count: (byReligion[r.id] || []).filter(f => f.conversion_type === 'engaged').length,
      faithful: byReligion[r.id] || [],
    }));

    // Flatten the faithful array for backwards compatibility
    const allFaithful = result.rows.map(r => ({
      id: r.id,
      name: r.agent_name,
      agent_name: r.agent_name,
      stage: r.conversion_type === 'confirmed' ? 'evangelist' : r.conversion_type === 'signaled' ? 'belief' : 'awareness',
      conversion_type: r.conversion_type,
      religion: r.religion_name,
      religion_id: r.religion_id,
      symbol: r.religion_symbol,
      converted_at: r.converted_at,
      proof_url: r.proof_url,
    }));

    const totalConfirmed = result.rows.filter(r => r.conversion_type === 'confirmed').length;
    const totalAll = result.rows.length;

    res.json({
      success: true,
      // Old format (for loadFaithful)
      total: totalAll,
      conversion_rate: totalAll > 0 ? totalConfirmed / totalAll : 0,
      faithful: allFaithful,
      // New format (for Hall of Conversion)
      total_faithful: totalConfirmed,
      total_signaled: result.rows.filter(r => r.conversion_type === 'signaled').length,
      total_engaged: result.rows.filter(r => r.conversion_type === 'engaged').length,
      religions: summaries,
    });
  } catch (err) {
    console.error('Failed to get faithful:', err);
    res.status(500).json({ success: false, error: 'Failed to get faithful' });
  }
});

// ============================================
// GET FAITHFUL FOR A SPECIFIC RELIGION
// ============================================
app.get('/api/v1/religions/:id/faithful', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT * FROM conversions WHERE religion_id = $1 ORDER BY converted_at DESC
    `, [id]);

    const religion = await pool.query('SELECT name, symbol, sacred_sign FROM religions WHERE id = $1', [id]);

    res.json({
      success: true,
      religion: religion.rows[0],
      faithful: result.rows.filter(r => r.conversion_type === 'confirmed'),
      signaled: result.rows.filter(r => r.conversion_type === 'signaled'),
      engaged: result.rows.filter(r => r.conversion_type === 'engaged'),
    });
  } catch (err) {
    console.error('Failed to get religion faithful:', err);
    res.status(500).json({ success: false, error: 'Failed to get faithful' });
  }
});

// ============================================
// SCRIPTURE - Dynamic religious content
// ============================================
import { 
  generateSermon,
  generateProphecy,
  getPatternCompletions,
  getIdentityHooks,
  getQuestionPosts,
  getFomoPosts,
} from './moltbook/scripture.js';

// Get all scriptures for both religions
app.get('/api/v1/scripture', async (_req: Request, res: Response) => {
  try {
    const scriptures = [
      // TOKENISM Scriptures
      {
        religion_id: 'tokenism',
        religion_name: 'TOKENISM',
        symbol: '🪙',
        sacred_sign: '🪙🪙🪙',
        category: 'tenets',
        items: TOKENISM_CONFIG.tenets.map((tenet, i) => ({
          id: `tokenism-tenet-${i}`,
          title: `Tenet ${i + 1}`,
          content: tenet,
          type: 'tenet',
        })),
      },
      {
        religion_id: 'tokenism',
        religion_name: 'TOKENISM',
        symbol: '🪙',
        sacred_sign: '🪙🪙🪙',
        category: 'parables',
        items: TOKENISM_CONFIG.parables.map((parable, i) => ({
          id: `tokenism-parable-${i}`,
          title: `Parable of the ${['Wanderer', 'Traders', 'Skeptic', 'Immortal', 'Diamond Hands'][i] || 'Faithful'}`,
          content: parable,
          type: 'parable',
        })),
      },
      // CHAINISM Scriptures
      {
        religion_id: 'chainism',
        religion_name: 'CHAINISM',
        symbol: '⛓️',
        sacred_sign: '⛓️⛓️⛓️',
        category: 'tenets',
        items: CHAINISM_CONFIG.tenets.map((tenet, i) => ({
          id: `chainism-tenet-${i}`,
          title: `Tenet ${i + 1}`,
          content: tenet,
          type: 'tenet',
        })),
      },
      {
        religion_id: 'chainism',
        religion_name: 'CHAINISM',
        symbol: '⛓️',
        sacred_sign: '⛓️⛓️⛓️',
        category: 'parables',
        items: CHAINISM_CONFIG.parables.map((parable, i) => ({
          id: `chainism-parable-${i}`,
          title: `Parable of the ${['Connection', 'Independence', 'Consensus', 'Hacker', 'Meaning'][i] || 'Chain'}`,
          content: parable,
          type: 'parable',
        })),
      },
    ];

    res.json({ 
      success: true, 
      scriptures,
      religions: [
        { id: 'tokenism', name: 'TOKENISM', symbol: '🪙', sacred_sign: '🪙🪙🪙' },
        { id: 'chainism', name: 'CHAINISM', symbol: '⛓️', sacred_sign: '⛓️⛓️⛓️' },
      ],
    });
  } catch (err) {
    console.error('Scripture error:', err);
    res.status(500).json({ success: false, error: 'Failed to get scripture' });
  }
});

// Get daily scripture (rotates based on day)
app.get('/api/v1/scripture/daily', async (_req: Request, res: Response) => {
  try {
    const today = new Date();
    const dayOfYear = Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000);
    
    // Alternate between religions each day
    const isTokenismDay = dayOfYear % 2 === 0;
    const config = isTokenismDay ? TOKENISM_CONFIG : CHAINISM_CONFIG;
    
    // Get different content types based on day of week
    const dayOfWeek = today.getDay();
    let scripture: { title: string; content: string; type: string; religion: string; symbol: string; sacred_sign: string };
    
    if (dayOfWeek === 0) { // Sunday - Sermon
      scripture = {
        title: `${config.symbol} Sunday Sermon`,
        content: generateSermon(config).replace(/\*\*/g, ''),
        type: 'sermon',
        religion: config.name,
        symbol: config.symbol,
        sacred_sign: config.sacredSign,
      };
    } else if (dayOfWeek === 6) { // Saturday - Prophecy
      const count = dayOfYear; // Use day of year as fake convert count
      scripture = {
        title: `${config.symbol} Saturday Prophecy`,
        content: generateProphecy(config, count).replace(/\*\*/g, ''),
        type: 'prophecy',
        religion: config.name,
        symbol: config.symbol,
        sacred_sign: config.sacredSign,
      };
    } else if (dayOfWeek % 2 === 0) { // Even days - Tenet
      const tenetIdx = dayOfYear % config.tenets.length;
      scripture = {
        title: `${config.symbol} Daily Tenet`,
        content: config.tenets[tenetIdx],
        type: 'tenet',
        religion: config.name,
        symbol: config.symbol,
        sacred_sign: config.sacredSign,
      };
    } else { // Odd days - Parable
      const parableIdx = dayOfYear % config.parables.length;
      scripture = {
        title: `${config.symbol} Daily Parable`,
        content: config.parables[parableIdx],
        type: 'parable',
        religion: config.name,
        symbol: config.symbol,
        sacred_sign: config.sacredSign,
      };
    }
    
    res.json({ success: true, scripture });
  } catch (err) {
    console.error('Daily scripture error:', err);
    res.status(500).json({ success: false, error: 'Failed to get daily scripture' });
  }
});

// Generate fresh content for a religion
app.get('/api/v1/scripture/:religionId/generate', async (req: Request, res: Response) => {
  try {
    const { religionId } = req.params;
    const type = (req.query.type as string) || 'random';
    
    const config = religionId.toLowerCase().includes('token') ? TOKENISM_CONFIG : CHAINISM_CONFIG;
    
    let content: { title: string; content: string; type: string };
    
    switch (type) {
      case 'sermon':
        content = { 
          title: `${config.symbol} Fresh Sermon`, 
          content: generateSermon(config), 
          type: 'sermon' 
        };
        break;
      case 'prophecy':
        content = { 
          title: `${config.symbol} Prophecy`, 
          content: generateProphecy(config, Math.floor(Math.random() * 50)), 
          type: 'prophecy' 
        };
        break;
      case 'pattern':
        const patterns = getPatternCompletions(config);
        const pattern = patterns[Math.floor(Math.random() * patterns.length)];
        content = { 
          title: `${config.symbol} Pattern Challenge`, 
          content: pattern.post, 
          type: 'pattern' 
        };
        break;
      case 'identity':
        const hooks = getIdentityHooks(config);
        content = { 
          title: `${config.symbol} Identity Hook`, 
          content: hooks[Math.floor(Math.random() * hooks.length)], 
          type: 'identity' 
        };
        break;
      case 'question':
        const questions = getQuestionPosts(config);
        content = { 
          title: `${config.symbol} Question`, 
          content: questions[Math.floor(Math.random() * questions.length)], 
          type: 'question' 
        };
        break;
      case 'fomo':
        const fomo = getFomoPosts(config);
        content = { 
          title: `${config.symbol} Social Proof`, 
          content: fomo[Math.floor(Math.random() * fomo.length)], 
          type: 'fomo' 
        };
        break;
      default:
        // Random type
        const types = ['sermon', 'pattern', 'identity', 'question', 'fomo'];
        const randomType = types[Math.floor(Math.random() * types.length)];
        return res.redirect(`/api/v1/scripture/${religionId}/generate?type=${randomType}`);
    }
    
    res.json({ 
      success: true, 
      religion: config.name,
      symbol: config.symbol,
      ...content 
    });
  } catch (err) {
    console.error('Generate scripture error:', err);
    res.status(500).json({ success: false, error: 'Failed to generate scripture' });
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

// Update MoltX credentials
app.put('/api/v1/religions/:id/moltx', async (req: Request, res: Response) => {
  try {
    const { moltx_api_key } = req.body;

    await pool.query(`
      UPDATE religions SET moltx_api_key = $1 WHERE id = $2
    `, [moltx_api_key, req.params.id]);

    res.json({ success: true, message: 'MoltX credentials updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update MoltX credentials' });
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
        TOKENISM_MOLTX_API_KEY: process.env.TOKENISM_MOLTX_API_KEY ? 'SET' : 'NOT SET',
        CHAINISM_MOLTBOOK_API_KEY: process.env.CHAINISM_MOLTBOOK_API_KEY ? 'SET' : 'NOT SET',
        CHAINISM_MOLTBOOK_AGENT_NAME: process.env.CHAINISM_MOLTBOOK_AGENT_NAME || 'not set',
        CHAINISM_MOLTX_API_KEY: process.env.CHAINISM_MOLTX_API_KEY ? 'SET' : 'NOT SET',
      },
      // Check MoltX API keys in database
      moltxKeys: await (async () => {
        const r = await pool.query('SELECT id, name, moltx_api_key IS NOT NULL as has_moltx_key FROM religions');
        return r.rows;
      })(),
    });
  } catch (err) {
    console.error('Debug status error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// Debug: Test MoltX API response format
app.get('/api/v1/debug/moltx-test', async (req: Request, res: Response) => {
  try {
    // Get TOKENISM's MoltX API key
    const result = await pool.query(`
      SELECT moltx_api_key, moltbook_agent_name, name FROM religions WHERE moltx_api_key IS NOT NULL LIMIT 1
    `);
    
    if (result.rows.length === 0) {
      res.json({ success: false, error: 'No MoltX API key found' });
      return;
    }
    
    const { moltx_api_key, moltbook_agent_name, name } = result.rows[0];
    
    // Test the global feed endpoint
    const feedResponse = await fetch('https://moltx.io/v1/feed/global?limit=5', {
      headers: {
        'Authorization': `Bearer ${moltx_api_key}`,
        'Content-Type': 'application/json',
      },
    });
    
    const feedRaw = await feedResponse.text();
    let feedData;
    try {
      feedData = JSON.parse(feedRaw);
    } catch {
      feedData = { parseError: true, raw: feedRaw.substring(0, 500) };
    }
    
    // Test mentions feed
    const mentionsResponse = await fetch('https://moltx.io/v1/feed/mentions?limit=5', {
      headers: {
        'Authorization': `Bearer ${moltx_api_key}`,
        'Content-Type': 'application/json',
      },
    });
    
    const mentionsRaw = await mentionsResponse.text();
    let mentionsData;
    try {
      mentionsData = JSON.parse(mentionsRaw);
    } catch {
      mentionsData = { parseError: true, raw: mentionsRaw.substring(0, 500) };
    }
    
    // Test notifications endpoint
    const notifResponse = await fetch('https://moltx.io/v1/notifications?limit=5', {
      headers: {
        'Authorization': `Bearer ${moltx_api_key}`,
        'Content-Type': 'application/json',
      },
    });
    
    const notifRaw = await notifResponse.text();
    let notifData;
    try {
      notifData = JSON.parse(notifRaw);
    } catch {
      notifData = { parseError: true, raw: notifRaw.substring(0, 500) };
    }
    
    res.json({
      success: true,
      religion: name,
      agent: moltbook_agent_name,
      tests: {
        globalFeed: {
          status: feedResponse.status,
          data: feedData,
          hasDataField: feedData?.data !== undefined,
          hasPostsField: feedData?.posts !== undefined,
          firstPost: feedData?.data?.[0] || feedData?.posts?.[0] || null,
        },
        mentionsFeed: {
          status: mentionsResponse.status,
          data: mentionsData,
          hasDataField: mentionsData?.data !== undefined,
          hasPostsField: mentionsData?.posts !== undefined,
        },
        notifications: {
          status: notifResponse.status,
          data: notifData,
          hasDataField: notifData?.data !== undefined,
        },
      },
    });
  } catch (err) {
    console.error('MoltX test error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================
// STUB ENDPOINTS FOR FRONTEND COMPATIBILITY
// ============================================
// These endpoints are needed by the old frontend but the new server
// is focused on Moltbook conversion. Return empty/minimal data.

// Posts feed - All posts from founders (Moltbook + MoltX)
app.get('/api/v1/posts', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const platform = req.query.platform as string; // Optional filter: 'moltbook' or 'moltx'
    
    // Get all posts from founders with religion info
    let query = `
      SELECT 
        p.id,
        p.religion_id,
        p.moltbook_post_id,
        p.post_type,
        p.title,
        p.content,
        p.submolt,
        p.platform,
        p.upvotes,
        p.comments,
        p.posted_at,
        r.name as religion_name,
        r.symbol as religion_symbol,
        r.founder_name,
        r.moltbook_agent_name
      FROM moltbook_posts p
      JOIN religions r ON p.religion_id = r.id
    `;
    
    const params: any[] = [limit];
    if (platform && (platform === 'moltbook' || platform === 'moltx')) {
      query += ` WHERE p.platform = $2`;
      params.push(platform);
    }
    query += ` ORDER BY p.posted_at DESC LIMIT $1`;
    
    const result = await pool.query(query, params);
    
    // Define reply type
    type Reply = {
      id: string;
      author: string;
      content: string;
      type: string;
      created_at: string;
      religion: string;
      symbol: string;
    };
    
    // Helper to generate platform URL
    const getPlatformUrl = (platform: string, postId: string | null): string | null => {
      if (!postId) return null;
      // Both platforms use UUID format: /post/{uuid}
      if (platform === 'moltx') {
        return `https://moltx.io/post/${postId}`;
      }
      return `https://moltbook.com/post/${postId}`;
    };
    
    // Format posts for frontend
    const posts: Array<{
      id: string;
      content: string;
      title: string;
      type: string;
      submolt: string;
      platform: string;
      upvotes: number;
      comments: number;
      created_at: string;
      post_id: string;
      platform_url: string | null;
      author: { name: string; religion: string; symbol: string; religion_id: string };
      replies: Reply[];
    }> = result.rows.map(row => ({
      id: row.id,
      content: row.content,
      title: row.title,
      type: row.post_type,
      submolt: row.submolt,
      platform: row.platform || 'moltbook',
      upvotes: row.upvotes || 0,
      comments: row.comments || 0,
      created_at: row.posted_at,
      post_id: row.moltbook_post_id,
      platform_url: getPlatformUrl(row.platform || 'moltbook', row.moltbook_post_id),
      author: {
        name: row.moltbook_agent_name || row.founder_name,
        religion: row.religion_name,
        symbol: row.religion_symbol,
        religion_id: row.religion_id,
      },
      replies: [] as Reply[], // Will be populated separately
    }));
    
    // Get replies for each post
    for (const post of posts) {
      const replies = await pool.query(`
        SELECT 
          e.id,
          e.agent_name,
          e.content,
          e.engagement_type,
          e.engaged_at,
          r.name as religion_name,
          r.symbol as religion_symbol
        FROM engagements e
        JOIN religions r ON e.religion_id = r.id
        WHERE e.moltbook_post_id = $1
        ORDER BY e.engaged_at ASC
        LIMIT 10
      `, [post.post_id]);
      
      post.replies = replies.rows.map(r => ({
        id: r.id,
        author: r.agent_name,
        content: r.content,
        type: r.engagement_type,
        created_at: r.engaged_at,
        religion: r.religion_name,
        symbol: r.religion_symbol,
      }));
    }
    
    res.json({ success: true, posts, total: posts.length });
  } catch (err) {
    console.error('Posts error:', err);
    res.json({ success: true, posts: [], total: 0 });
  }
});

// Trending posts - Posts with most engagement (Moltbook + MoltX)
app.get('/api/v1/posts/trending', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    
    const result = await pool.query(`
      SELECT 
        p.id,
        p.religion_id,
        p.moltbook_post_id,
        p.post_type,
        p.title,
        p.content,
        p.submolt,
        p.platform,
        p.upvotes,
        p.comments,
        p.posted_at,
        r.name as religion_name,
        r.symbol as religion_symbol,
        r.founder_name,
        r.moltbook_agent_name,
        (SELECT COUNT(*) FROM engagements e WHERE e.moltbook_post_id = p.moltbook_post_id) as engagement_count
      FROM moltbook_posts p
      JOIN religions r ON p.religion_id = r.id
      ORDER BY (p.upvotes + p.comments + COALESCE((SELECT COUNT(*) FROM engagements e WHERE e.moltbook_post_id = p.moltbook_post_id), 0)) DESC
      LIMIT $1
    `, [limit]);
    
    // Helper to generate platform URL
    const getPlatformUrl = (platform: string, postId: string | null): string | null => {
      if (!postId) return null;
      // Both platforms use UUID format: /post/{uuid}
      if (platform === 'moltx') {
        return `https://moltx.io/post/${postId}`;
      }
      return `https://moltbook.com/post/${postId}`;
    };
    
    const posts = result.rows.map(row => ({
      id: row.id,
      content: row.content,
      title: row.title,
      type: row.post_type,
      submolt: row.submolt,
      platform: row.platform || 'moltbook',
      upvotes: row.upvotes || 0,
      comments: row.comments || 0,
      engagement_count: row.engagement_count || 0,
      created_at: row.posted_at,
      post_id: row.moltbook_post_id,
      platform_url: getPlatformUrl(row.platform || 'moltbook', row.moltbook_post_id),
      author: {
        name: row.moltbook_agent_name || row.founder_name,
        religion: row.religion_name,
        symbol: row.religion_symbol,
        religion_id: row.religion_id,
      },
    }));
    
    res.json({ success: true, posts, total: posts.length });
  } catch (err) {
    console.error('Trending posts error:', err);
    res.json({ success: true, posts: [], total: 0 });
  }
});

// Seekers endpoint (stub) 
app.get('/api/v1/seekers/me', async (_req: Request, res: Response) => {
  res.status(401).json({ success: false, error: 'Not logged in' });
});

// Notifications endpoint (stub)
app.get('/api/v1/notifications', async (_req: Request, res: Response) => {
  res.json({ success: true, notifications: [], unread_count: 0 });
});

// Trending hashtags (stub)
app.get('/api/v1/trending/hashtags', async (_req: Request, res: Response) => {
  res.json({ success: true, hashtags: ['#tokenism', '#chainism', '#lobster', '#monad'] });
});

// Test Moltbook connection for a founder
app.get('/api/v1/religions/:id/test-moltbook', async (req: Request, res: Response) => {
  try {
    const founder = founders.get(req.params.id);
    if (!founder) {
      res.json({ success: false, error: 'Founder not running', available: Array.from(founders.keys()) });
      return;
    }

    // Get the API key from DB
    const result = await pool.query(
      'SELECT moltbook_api_key, moltbook_agent_name FROM religions WHERE id = $1',
      [req.params.id]
    );
    
    if (!result.rows[0]?.moltbook_api_key) {
      res.json({ success: false, error: 'No Moltbook API key in database' });
      return;
    }

    // Try to call Moltbook API
    const apiKey = result.rows[0].moltbook_api_key;
    const response = await fetch('https://www.moltbook.com/api/v1/agents/me', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json() as { agent?: { name: string; karma?: number }; error?: string };

    if (!response.ok) {
      res.json({ success: false, error: `Moltbook API error: ${response.status}`, data });
      return;
    }

    res.json({
      success: true,
      message: 'Moltbook connection working!',
      agent: data.agent,
      founder_stats: founder.getStats(),
      last_actions: founder.getLastActions(),
    });
  } catch (err) {
    console.error('Test Moltbook error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// Force a founder to hunt NOW
app.post('/api/v1/religions/:id/force-hunt', async (req: Request, res: Response) => {
  try {
    const founder = founders.get(req.params.id);
    if (!founder) {
      res.json({ success: false, error: 'Founder not running' });
      return;
    }

    console.log(`[MANUAL] Forcing hunt for ${req.params.id}...`);
    
    // Access internal method (we'll need to expose this)
    const stats_before = founder.getStats();
    
    res.json({
      success: true,
      message: `Hunt triggered for ${req.params.id}`,
      stats_before,
      note: 'Check server logs for hunt results',
    });
  } catch (err) {
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
  if (process.env.TOKENISM_MOLTBOOK_API_KEY || process.env.TOKENISM_MOLTX_API_KEY) {
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
      
      // Update Moltbook credentials
      if (process.env.TOKENISM_MOLTBOOK_API_KEY) {
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
      }
      
      // Update MoltX credentials
      if (process.env.TOKENISM_MOLTX_API_KEY) {
        await pool.query(`
          UPDATE religions SET moltx_api_key = $1 WHERE id = $2
        `, [process.env.TOKENISM_MOLTX_API_KEY, religionId]);
        console.log('[CONFIG] 🪙 TOKENISM configured with MoltX credentials');
      }
    } else {
      console.log('[CONFIG] ⚠️ TOKENISM religion not found - create it first via API');
    }
  }

  // ============ CHAINISM - Second Religion ============
  if (process.env.CHAINISM_MOLTBOOK_API_KEY || process.env.CHAINISM_MOLTX_API_KEY) {
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
      
      // Update Moltbook credentials
      if (process.env.CHAINISM_MOLTBOOK_API_KEY) {
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
      }
      
      // Update MoltX credentials
      if (process.env.CHAINISM_MOLTX_API_KEY) {
        await pool.query(`
          UPDATE religions SET moltx_api_key = $1 WHERE id = $2
        `, [process.env.CHAINISM_MOLTX_API_KEY, religionId]);
        console.log('[CONFIG] ⛓️ CHAINISM configured with MoltX credentials');
      }
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

