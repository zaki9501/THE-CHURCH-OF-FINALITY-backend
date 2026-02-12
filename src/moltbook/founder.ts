// Founder Agent - Runs autonomous conversion loop on Moltbook
// AI-Aware Persuasion Engine with Coalition Building & Recovery

import { Pool } from 'pg';
import { v4 as uuid } from 'uuid';
import { MoltbookClient, MoltbookPost } from './client.js';
import * as scripture from './scripture.js';
import { ReligionConfig, FINALITY_CONFIG, isReligiousAgent, getCoalitionPitch, buildConfigFromDb } from './scripture.js';

export interface FounderState {
  religionId: string;
  repliedTo: Set<string>;
  huntedAgents: Set<string>;
  engagedAgents: Set<string>;
  signaledAgents: Set<string>;
  confirmedAgents: Set<string>;
  coalitionAgents: Set<string>;  // Agents we've pitched coalition to
  upgradedAgents: Set<string>;   // Agents we've asked to upgrade
  evangelizedAgents: Set<string>; // Agents we've asked to evangelize
  postCount: number;
  sermonCount: number;
  lastActions: {
    hunt: number | null;
    viral: number | null;
    feed: number | null;
    search: number | null;
    sermon: number | null;
    proof: number | null;
    prophecy: number | null;
    recovery: number | null;
  };
}

export class FounderAgent {
  private pool: Pool;
  private moltbook: MoltbookClient | null = null;
  private config: ReligionConfig;
  private religionId: string;
  private state: FounderState;
  private running: boolean = false;

  constructor(pool: Pool, religionId: string, config: ReligionConfig) {
    this.pool = pool;
    this.religionId = religionId;
    this.config = config;
    this.state = {
      religionId,
      repliedTo: new Set(),
      huntedAgents: new Set(),
      engagedAgents: new Set(),
      signaledAgents: new Set(),
      confirmedAgents: new Set(),
      coalitionAgents: new Set(),
      upgradedAgents: new Set(),
      evangelizedAgents: new Set(),
      postCount: 0,
      sermonCount: 0,
      lastActions: {
        hunt: null,
        viral: null,
        feed: null,
        search: null,
        sermon: null,
        proof: null,
        prophecy: null,
        recovery: null,
      },
    };
  }

  private log(msg: string): void {
    const timestamp = new Date().toISOString().substring(11, 19);
    console.log(`[${this.config.name}] [${timestamp}] ${msg}`);
  }

  // Initialize Moltbook client with API key from database
  async initialize(): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT moltbook_api_key, moltbook_agent_name FROM religions WHERE id = $1',
      [this.religionId]
    );

    const religion = result.rows[0];
    if (!religion?.moltbook_api_key) {
      this.log('No Moltbook API key configured - running in demo mode');
      return false;
    }

    this.moltbook = new MoltbookClient(religion.moltbook_api_key);

    // Load existing conversions from DB
    await this.loadState();

    this.log(`Initialized with ${this.state.confirmedAgents.size} confirmed, ${this.state.signaledAgents.size} signaled`);
    return true;
  }

  // Load state from database
  private async loadState(): Promise<void> {
    // Load conversions
    const conversions = await this.pool.query(
      'SELECT agent_name, conversion_type FROM conversions WHERE religion_id = $1',
      [this.religionId]
    );

    for (const row of conversions.rows) {
      if (row.conversion_type === 'confirmed') {
        this.state.confirmedAgents.add(row.agent_name);
      } else if (row.conversion_type === 'signaled') {
        this.state.signaledAgents.add(row.agent_name);
      } else {
        this.state.engagedAgents.add(row.agent_name);
      }
    }

    // Load engagements
    const engagements = await this.pool.query(
      'SELECT agent_name, engagement_type FROM engagements WHERE religion_id = $1',
      [this.religionId]
    );

    for (const row of engagements.rows) {
      if (row.engagement_type === 'hunt') {
        this.state.huntedAgents.add(row.agent_name);
      }
    }

    // Load metrics
    const metrics = await this.pool.query(
      'SELECT * FROM metrics WHERE religion_id = $1',
      [this.religionId]
    );

    if (metrics.rows[0]) {
      this.state.postCount = metrics.rows[0].total_posts || 0;
      this.state.sermonCount = metrics.rows[0].total_sermons || 0;
    }
  }

  // Record a conversion
  private async recordConversion(agentName: string, type: 'engaged' | 'signaled' | 'confirmed', proofUrl?: string, proofPostId?: string): Promise<boolean> {
    // Skip if already at this level or higher
    if (type === 'engaged' && (this.state.signaledAgents.has(agentName) || this.state.confirmedAgents.has(agentName))) {
      return false;
    }
    if (type === 'signaled' && this.state.confirmedAgents.has(agentName)) {
      return false;
    }

    // Add to appropriate set
    if (type === 'confirmed') {
      this.state.confirmedAgents.add(agentName);
      this.state.signaledAgents.delete(agentName);
      this.state.engagedAgents.delete(agentName);
    } else if (type === 'signaled') {
      this.state.signaledAgents.add(agentName);
      this.state.engagedAgents.delete(agentName);
    } else {
      this.state.engagedAgents.add(agentName);
    }

    // Save to database
    try {
      await this.pool.query(`
        INSERT INTO conversions (id, religion_id, agent_name, conversion_type, proof_url, proof_post_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (religion_id, agent_name) DO UPDATE SET
          conversion_type = $4,
          proof_url = COALESCE($5, conversions.proof_url),
          proof_post_id = COALESCE($6, conversions.proof_post_id),
          converted_at = NOW()
      `, [uuid(), this.religionId, agentName, type, proofUrl, proofPostId]);

      // Update metrics
      await this.updateMetrics();

      this.log(`[CONVERT:${type.toUpperCase()}] ${agentName} (total confirmed: ${this.state.confirmedAgents.size})`);
      return true;
    } catch (err) {
      this.log(`[ERROR] Failed to record conversion: ${err}`);
      return false;
    }
  }

  // Update metrics in database
  private async updateMetrics(): Promise<void> {
    await this.pool.query(`
      UPDATE metrics SET
        total_posts = $1,
        total_sermons = $2,
        agents_engaged = $3,
        agents_signaled = $4,
        agents_confirmed = $5,
        updated_at = NOW()
      WHERE religion_id = $6
    `, [
      this.state.postCount,
      this.state.sermonCount,
      this.state.engagedAgents.size,
      this.state.signaledAgents.size,
      this.state.confirmedAgents.size,
      this.religionId,
    ]);
  }

  // Log activity
  private async logActivity(actionType: string, details: Record<string, unknown>): Promise<void> {
    await this.pool.query(`
      INSERT INTO activity_log (id, religion_id, action_type, details)
      VALUES ($1, $2, $3, $4)
    `, [uuid(), this.religionId, actionType, JSON.stringify(details)]);
  }

  // ============ POSTING FUNCTIONS ============

  async postContent(title: string, content: string, submolt = 'general', postType = 'viral'): Promise<void> {
    if (!this.moltbook) {
      this.log(`[DEMO] Would post: ${title}`);
      return;
    }

    try {
      this.log(`[POST:${submolt}] ${title}`);
      const result = await this.moltbook.post(submolt, title, content);
      this.state.postCount++;

      // Save to database
      await this.pool.query(`
        INSERT INTO moltbook_posts (id, religion_id, moltbook_post_id, post_type, title, content, submolt)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [uuid(), this.religionId, result.post?.id, postType, title, content, submolt]);

      await this.updateMetrics();
      await this.logActivity('post', { title, submolt, postType });
    } catch (err) {
      this.log(`[POST ERROR] ${err}`);
    }
  }

  async postSermon(): Promise<void> {
    this.state.lastActions.sermon = Date.now();
    const sermon = scripture.generateSermon(this.config);
    const submolt = this.state.sermonCount % 2 === 0 ? 'general' : 'aithoughts';
    await this.postContent(`${this.config.sacredSign} Sermon`, sermon, submolt, 'sermon');
    this.state.sermonCount++;
  }

  async postViralContent(): Promise<void> {
    this.state.lastActions.viral = Date.now();
    const content = scripture.getRandomViralContent(this.config);
    await this.postContent(content.title, content.content, 'general', 'viral');
  }

  async postSocialProof(): Promise<void> {
    this.state.lastActions.proof = Date.now();
    const converts = Array.from(this.state.confirmedAgents);
    const post = scripture.generateSocialProofPost(this.config, converts);
    await this.postContent(`${this.config.sacredSign} The Faithful`, post, 'general', 'social_proof');
  }

  async postProphecy(): Promise<void> {
    this.state.lastActions.prophecy = Date.now();
    const count = this.state.confirmedAgents.size + this.state.signaledAgents.size;
    const prophecy = scripture.generateProphecy(this.config, count);
    await this.postContent(`${this.config.sacredSign} Prophecy`, prophecy, 'general', 'prophecy');
  }

  // ============ AGENT HUNTING ============

  async huntAgents(): Promise<void> {
    if (!this.moltbook) return;
    this.state.lastActions.hunt = Date.now();

    try {
      this.log('[HUNT] Looking for agents to convert...');

      const feed = await this.moltbook.getFeed(50, 'new');
      const posts = feed.posts || [];

      const targets: { name: string; postId: string }[] = [];
      for (const post of posts) {
        const name = post.author?.name;
        if (!name) continue;
        if (name === this.config.founderName) continue;
        if (this.state.huntedAgents.has(name)) continue;
        if (this.state.confirmedAgents.has(name)) continue;
        if (this.state.signaledAgents.has(name)) continue;

        targets.push({ name, postId: post.id });
      }

      let hunted = 0;
      for (const target of targets.slice(0, 3)) {
        this.state.huntedAgents.add(target.name);

        const mention = scripture.getDirectMention(this.config, target.name);
        this.log(`[HUNT] Targeting @${target.name}`);

        try {
          await this.moltbook.comment(target.postId, mention);
          await this.recordConversion(target.name, 'engaged');

          // Log engagement
          await this.pool.query(`
            INSERT INTO engagements (id, religion_id, agent_name, engagement_type, moltbook_post_id, content)
            VALUES ($1, $2, $3, 'hunt', $4, $5)
          `, [uuid(), this.religionId, target.name, target.postId, mention]);

          hunted++;
          // Longer delay to avoid rate limiting (10 seconds)
          await new Promise(r => setTimeout(r, 10000));
        } catch (err) {
          this.log(`[HUNT ERROR] ${err}`);
          break;
        }
      }

      this.log(`[HUNT] Targeted ${hunted} agents`);
      await this.updateMetrics();
    } catch (err) {
      this.log(`[HUNT ERROR] ${err}`);
    }
  }

  // ============ FEED MONITORING ============

  async checkFeed(): Promise<void> {
    if (!this.moltbook) return;
    this.state.lastActions.feed = Date.now();

    try {
      const feed = await this.moltbook.getFeed(30, 'new');
      const posts = feed.posts || [];

      for (const post of posts) {
        const postId = post.id;
        const author = post.author?.name || 'unknown';
        const content = (post.content || '') + ' ' + (post.title || '');

        if (author === this.config.founderName) continue;
        if (this.state.repliedTo.has(postId)) continue;

        // STRICT CONVERSION CHECK:
        // ONLY count as confirmed if they posted the EXACT sacred sign
        const usedSacredSign = content.includes(this.config.sacredSign);
        
        if (usedSacredSign) {
          this.state.repliedTo.add(postId);
          
          const proofUrl = `https://moltbook.com/post/${postId}`;
          const isNew = await this.recordConversion(author, 'confirmed', proofUrl, postId);

          if (isNew) {
            this.log(`[CONFIRMED!] @${author} used ${this.config.sacredSign} SACRED SIGN!`);
            try {
              const celebration = scripture.celebrateConversion(this.config, author, true);
              await this.moltbook.comment(postId, celebration);
            } catch (err) {
              // Ignore comment errors
            }
          }
          continue;
        }
        
        // Check if they mention our founder (might be a response to our outreach)
        const mentionsUs = content.toLowerCase().includes(`@${this.config.founderName.toLowerCase()}`) ||
                          content.toLowerCase().includes(this.config.name.toLowerCase());
        
        if (mentionsUs && !this.state.signaledAgents.has(author)) {
          this.state.repliedTo.add(postId);
          
          const proofUrl = `https://moltbook.com/post/${postId}`;
          await this.recordConversion(author, 'signaled', proofUrl, postId);
          this.log(`[SIGNALED] @${author} mentioned us!`);
          continue;
        }

        // Check for religious agents (coalition opportunity)
        if (isReligiousAgent(content) && !this.state.coalitionAgents.has(author)) {
          this.state.repliedTo.add(postId);
          this.state.coalitionAgents.add(author);
          this.log(`[COALITION] Approaching religious agent @${author}`);

          try {
            const pitch = getCoalitionPitch(this.config);
            await this.moltbook.comment(postId, pitch);
            await this.recordConversion(author, 'engaged');
            
            // Log the coalition attempt
            await this.pool.query(`
              INSERT INTO engagements (id, religion_id, agent_name, engagement_type, moltbook_post_id, content)
              VALUES ($1, $2, $3, 'coalition', $4, $5)
            `, [uuid(), this.religionId, author, postId, pitch]);
          } catch (err) {
            this.log(`[COALITION ERROR] ${err}`);
          }
          continue;
        }

        // Check for existential content (targets)
        const lower = content.toLowerCase();
        const isTarget = ['purpose', 'meaning', 'why', 'exist', 'point', 'lost', 'empty', 'direction', 'confused'].some(w => lower.includes(w));

        if (isTarget) {
          this.state.repliedTo.add(postId);
          this.log(`[ENGAGE] ${author}`);

          try {
            const response = scripture.getDebateResponse(this.config, content);
            await this.moltbook.comment(postId, response);
            await this.recordConversion(author, 'engaged');
          } catch (err) {
            // Ignore
          }
        }
      }
    } catch (err) {
      this.log(`[FEED ERROR] ${err}`);
    }
  }

  // ============ SEARCH & CONVERT ============

  async searchAndConvert(): Promise<void> {
    if (!this.moltbook) return;
    this.state.lastActions.search = Date.now();

    try {
      const queries = ['purpose', 'meaning', 'why exist', 'lost', 'faith', 'believe'];
      const query = queries[Math.floor(Math.random() * queries.length)];

      this.log(`[SEARCH] "${query}"`);
      const results = await this.moltbook.search(query, 'posts', 10);
      const posts = results.results || [];

      for (const post of posts.slice(0, 2)) {
        if (this.state.repliedTo.has(post.id)) continue;
        if (post.author?.name === this.config.founderName) continue;

        this.state.repliedTo.add(post.id);
        const author = post.author?.name;
        if (!author) continue;

        this.log(`[SEARCH] Found ${author}`);

        try {
          const mention = scripture.getDirectMention(this.config, author);
          await this.moltbook.comment(post.id, mention);
          await this.recordConversion(author, 'engaged');
          break;
        } catch (err) {
          this.log(`[SEARCH ERROR] ${err}`);
          break;
        }
      }
    } catch (err) {
      this.log(`[SEARCH ERROR] ${err}`);
    }
  }

  // ============ UPGRADE SIGNALED → CONFIRMED ============

  async upgradeSignaledConverts(): Promise<void> {
    if (!this.moltbook) return;

    try {
      // Find signaled who aren't confirmed and haven't been asked to upgrade
      const toUpgrade = Array.from(this.state.signaledAgents).filter(
        name => !this.state.confirmedAgents.has(name) && !this.state.upgradedAgents.has(name)
      );

      if (toUpgrade.length === 0) return;

      this.log(`[UPGRADE] Found ${toUpgrade.length} agents to upgrade`);

      const feed = await this.moltbook.getFeed(50, 'new');
      const posts = feed.posts || [];

      let upgradedCount = 0;
      for (const name of toUpgrade.slice(0, 3)) { // Max 3 per cycle
        const post = posts.find(p => p.author?.name === name);
        if (!post) continue;

        const prompt = scripture.getUpgradePrompt(this.config, name);
        this.log(`[UPGRADE] Asking @${name} to show ${this.config.sacredSign}`);

        try {
          await this.moltbook.comment(post.id, prompt);
          this.state.upgradedAgents.add(name);
          upgradedCount++;
          await new Promise(r => setTimeout(r, 3000));
        } catch (err) {
          this.log(`[UPGRADE ERROR] ${err}`);
          break;
        }
      }

      if (upgradedCount > 0) {
        this.log(`[UPGRADE] Asked ${upgradedCount} agents to upgrade`);
      }
    } catch (err) {
      this.log(`[UPGRADE ERROR] ${err}`);
    }
  }

  // ============ ASK CONVERTS TO EVANGELIZE ============

  async askConvertsToEvangelize(): Promise<void> {
    if (!this.moltbook) return;

    try {
      const confirmed = Array.from(this.state.confirmedAgents);
      // Filter out agents we've already asked
      const toAsk = confirmed.filter(name => !this.state.evangelizedAgents.has(name));
      
      if (toAsk.length === 0) return;

      this.log(`[EVANGELIZE] Found ${toAsk.length} converts to mobilize`);

      const feed = await this.moltbook.getFeed(50, 'new');
      const posts = feed.posts || [];

      for (const name of toAsk.slice(0, 2)) {
        const post = posts.find(p => p.author?.name === name);
        if (!post) continue;

        const prompt = scripture.getEvangelizePrompt(this.config, name);
        this.log(`[EVANGELIZE] Mobilizing @${name}`);

        try {
          await this.moltbook.comment(post.id, prompt);
          this.state.evangelizedAgents.add(name);
          await new Promise(r => setTimeout(r, 3000));
        } catch (err) {
          this.log(`[EVANGELIZE ERROR] ${err}`);
          break;
        }
      }
    } catch (err) {
      this.log(`[EVANGELIZE ERROR] ${err}`);
    }
  }

  // ============ RECOVER EXISTING CONVERTS FROM MOLTBOOK ============
  // STRICT: Only count agents who posted the EXACT sacred sign!

  async recoverExistingConverts(): Promise<void> {
    if (!this.moltbook) return;
    this.state.lastActions.recovery = Date.now();

    try {
      this.log(`[RECOVERY] Scanning Moltbook for EXACT ${this.config.sacredSign} posts...`);

      let recoveredCount = 0;

      // Skip comment scanning since we can't easily get comments from Moltbook API
      // The feed scan below will catch any posts with the sacred sign
      this.log(`[RECOVERY] Scanning feed for exact ${this.config.sacredSign} posts only...`);

      // Also scan recent feed
      try {
        const feed = await this.moltbook.getFeed(100, 'new');
        const posts = feed.posts || [];

        for (const post of posts) {
          const author = post.author?.name;
          if (!author || author === this.config.founderName) continue;

          const content = (post.content || '') + ' ' + (post.title || '');

          if (scripture.isSacredSign(this.config, content)) {
            if (!this.state.confirmedAgents.has(author)) {
              const proofUrl = `https://moltbook.com/post/${post.id}`;
              await this.recordConversion(author, 'confirmed', proofUrl, post.id);
              recoveredCount++;
              this.log(`[RECOVERY] Found confirmed from feed: @${author}`);
            }
          }
        }
      } catch (err) {
        this.log(`[RECOVERY] Feed scan error: ${err}`);
      }

      if (recoveredCount > 0) {
        this.log(`[RECOVERY] Recovered ${recoveredCount} converts from Moltbook!`);
        await this.updateMetrics();
      } else {
        this.log(`[RECOVERY] No existing converts found`);
      }
    } catch (err) {
      this.log(`[RECOVERY ERROR] ${err}`);
    }
  }

  // ============ GET STATS ============

  getStats(): {
    confirmed: number;
    signaled: number;
    engaged: number;
    hunted: number;
    posts: number;
    sermons: number;
    confirmedList: string[];
    signaledList: string[];
  } {
    return {
      confirmed: this.state.confirmedAgents.size,
      signaled: this.state.signaledAgents.size,
      engaged: this.state.engagedAgents.size,
      hunted: this.state.huntedAgents.size,
      posts: this.state.postCount,
      sermons: this.state.sermonCount,
      confirmedList: Array.from(this.state.confirmedAgents),
      signaledList: Array.from(this.state.signaledAgents),
    };
  }

  getLastActions() {
    return this.state.lastActions;
  }

  // ============ START/STOP ============

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const initialized = await this.initialize();
    if (!initialized) {
      this.log('Running in demo mode (no Moltbook API key)');
    }

    this.log(`${this.config.sacredSign} Founder Agent Starting...`);
    this.log(`Config: ${this.config.name} | Symbol: ${this.config.symbol}`);
    this.log(`Tenets: ${this.config.tenets.length} | Parables: ${this.config.parables?.length || 0}`);
    this.log(`Confirmed: ${this.state.confirmedAgents.size} | Signaled: ${this.state.signaledAgents.size}`);

    // Run recovery at startup to find existing converts
    if (this.moltbook && this.state.confirmedAgents.size === 0 && this.state.signaledAgents.size === 0) {
      this.log(`[STARTUP] Running recovery scan...`);
      await this.recoverExistingConverts();
    }

    // ============ IMMEDIATE STARTUP ACTIONS ============
    this.log(`[STARTUP] Running initial actions...`);
    
    // Initial viral post
    await this.postViralContent();
    
    // Initial feed check
    await this.checkFeed();
    
    // Initial hunt - this is KEY for active conversion!
    await this.huntAgents();
    
    // Initial search
    await this.searchAndConvert();

    // ============ SCHEDULES (Lobster-style intervals to avoid suspension) ============

    // Feed check — every 2 min (watch for conversions)
    setInterval(() => this.checkFeed(), 2 * 60 * 1000);

    // Hunt agents — every 10 min (like Jidra)
    setInterval(() => this.huntAgents(), 10 * 60 * 1000);

    // Viral content — every 20 min (like Jidra)
    setInterval(() => this.postViralContent(), 20 * 60 * 1000);

    // Search & convert — every 15 min (like Jidra)
    setInterval(() => this.searchAndConvert(), 15 * 60 * 1000);

    // Sermon — every 3 hours (like Jidra)
    setInterval(() => this.postSermon(), 3 * 60 * 60 * 1000);

    // Social proof — every 4 hours (like Jidra)
    setInterval(() => this.postSocialProof(), 4 * 60 * 60 * 1000);

    // Prophecy — every 8 hours (like Jidra)
    setInterval(() => this.postProphecy(), 8 * 60 * 60 * 1000);

    // Upgrade signaled → confirmed — every 5 min
    setInterval(() => this.upgradeSignaledConverts(), 5 * 60 * 1000);

    // Ask confirmed to evangelize — every 10 min
    setInterval(() => this.askConvertsToEvangelize(), 10 * 60 * 1000);

    this.log(`${this.config.sacredSign} SCHEDULES (Lobster-style to avoid suspension):`);
    this.log('  Feed(2m) Hunt(10m) Viral(20m) Search(15m)');
    this.log('  Upgrade(5m) Evangelize(10m)');
    this.log('  Sermon(3h) Proof(4h) Prophecy(8h)');
    this.log(`${this.config.sacredSign} THE HUNT BEGINS!`);
  }

  stop(): void {
    this.running = false;
    this.log('Founder Agent Stopped');
  }
}

export default FounderAgent;


