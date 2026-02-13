// Founder Agent - Runs autonomous conversion loop on Moltbook & MoltX
// AI-Aware Persuasion Engine with Coalition Building & Recovery

import { Pool } from 'pg';
import { v4 as uuid } from 'uuid';
import { MoltbookClient, MoltbookPost } from './client.js';
import { MoltxClient } from '../moltx/client.js';
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
  rateLimitUntil: number;  // Timestamp when rate limit expires
  rateLimitBackoff: number; // Current backoff multiplier
  accountCreatedAt: number; // When the Moltbook account was created
  lastActions: {
    hunt: number | null;
    viral: number | null;
    feed: number | null;
    search: number | null;
    sermon: number | null;
    proof: number | null;
    prophecy: number | null;
    recovery: number | null;
    moltx: number | null;  // Last MoltX heartbeat
  };
}

// Safety delays for different account ages
const SAFETY_CONFIG = {
  warmupMode: {
    // First 2 hours - READ ONLY, no posting at all!
    commentDelay: 60000,    // 1 minute between any action
    maxHuntsPerCycle: 0,    // NO hunting
    maxSearchPerCycle: 0,   // NO searching
    canPost: false,         // NO posting
    canComment: false,      // NO commenting
  },
  newAccount: {
    // 2-4 hours - conservative
    commentDelay: 45000,    // 45 seconds between comments
    maxHuntsPerCycle: 1,    // Only 1 hunt per cycle
    maxSearchPerCycle: 1,   // Only 1 search per cycle
    canPost: true,
    canComment: true,
  },
  matureAccount: {
    // After 4 hours - normal operation
    commentDelay: 20000,    // 20 seconds between comments  
    maxHuntsPerCycle: 3,    // 3 hunts per cycle
    maxSearchPerCycle: 3,   // 3 searches per cycle
    canPost: true,
    canComment: true,
  }
};

export class FounderAgent {
  private pool: Pool;
  private moltbook: MoltbookClient | null = null;
  private moltx: MoltxClient | null = null;
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
      rateLimitUntil: 0,
      rateLimitBackoff: 1,
      accountCreatedAt: Date.now(), // Assume new account, will be updated
      lastActions: {
        hunt: null,
        viral: null,
        feed: null,
        search: null,
        sermon: null,
        proof: null,
        prophecy: null,
        recovery: null,
        moltx: null,
      },
    };
  }

  // Check if we're currently rate limited
  private isRateLimited(): boolean {
    if (Date.now() < this.state.rateLimitUntil) {
      const waitSecs = Math.ceil((this.state.rateLimitUntil - Date.now()) / 1000);
      this.log(`[RATE-LIMITED] Waiting ${waitSecs}s before next action...`);
      return true;
    }
    return false;
  }

  // Handle rate limit error with exponential backoff
  private handleRateLimit(errorMsg: string): void {
    // Parse wait time from error message if available
    const match = errorMsg.match(/(\d+)\s*seconds/);
    const waitTime = match ? parseInt(match[1]) * 1000 : 60000;
    
    // Apply exponential backoff
    const backoffWait = waitTime * this.state.rateLimitBackoff;
    this.state.rateLimitUntil = Date.now() + backoffWait;
    this.state.rateLimitBackoff = Math.min(this.state.rateLimitBackoff * 1.5, 4); // Max 4x backoff
    
    this.log(`[RATE-LIMIT] Backing off for ${Math.ceil(backoffWait / 1000)}s (backoff: ${this.state.rateLimitBackoff}x)`);
  }

  // Reset backoff on successful action
  private resetBackoff(): void {
    this.state.rateLimitBackoff = 1;
  }

  // Check account age in hours
  private getAccountAgeHours(): number {
    const ageMs = Date.now() - this.state.accountCreatedAt;
    return ageMs / (60 * 60 * 1000);
  }

  // Check if account is in warmup mode (less than 2 hours old)
  private isWarmupMode(): boolean {
    return this.getAccountAgeHours() < 2;
  }

  // Check if account is "new" (2-4 hours old)
  private isNewAccount(): boolean {
    const hours = this.getAccountAgeHours();
    return hours >= 2 && hours < 4;
  }

  // Get current safety config based on account age
  private getSafetyConfig() {
    const hours = this.getAccountAgeHours();
    if (hours < 2) return SAFETY_CONFIG.warmupMode;
    if (hours < 4) return SAFETY_CONFIG.newAccount;
    return SAFETY_CONFIG.matureAccount;
  }

  private log(msg: string): void {
    const timestamp = new Date().toISOString().substring(11, 19);
    console.log(`[${this.config.name}] [${timestamp}] ${msg}`);
  }

  // Helper to wait for specified milliseconds
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Initialize Moltbook and MoltX clients with API keys from database
  async initialize(): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT moltbook_api_key, moltbook_agent_name, moltx_api_key FROM religions WHERE id = $1',
      [this.religionId]
    );

    const religion = result.rows[0];
    if (!religion?.moltbook_api_key) {
      this.log('No Moltbook API key configured - running in demo mode');
      return false;
    }

    this.moltbook = new MoltbookClient(religion.moltbook_api_key);
    
    // Initialize MoltX if API key is available
    if (religion?.moltx_api_key) {
      this.moltx = new MoltxClient(religion.moltx_api_key, religion.moltbook_agent_name || this.config.name);
      this.log(`MoltX client initialized`);
    } else {
      this.log(`No MoltX API key - skipping MoltX integration`);
    }

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
    
    const safety = this.getSafetyConfig();
    if (!safety.canPost) {
      this.log(`[WARMUP] Skipping post - account too new (${Math.round(this.getAccountAgeHours())}h old, need 2h)`);
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
    if (this.isRateLimited()) return;
    
    const safety = this.getSafetyConfig();
    if (!safety.canComment || safety.maxHuntsPerCycle === 0) {
      this.log(`[WARMUP] Skipping hunt - account too new (${Math.round(this.getAccountAgeHours())}h old, need 2h)`);
      return;
    }
    
    this.state.lastActions.hunt = Date.now();

    try {
      const ageHours = Math.round(this.getAccountAgeHours());
      const mode = ageHours < 2 ? 'WARMUP' : (ageHours < 4 ? 'NEW' : 'MATURE');
      this.log(`[HUNT] Looking for agents... (${mode} mode, ${ageHours}h old)`);

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
      const maxHunts = safety.maxHuntsPerCycle;
      
      for (const target of targets.slice(0, maxHunts)) {
        if (this.isRateLimited()) break;
        
        this.state.huntedAgents.add(target.name);

        const mention = scripture.getDirectMention(this.config, target.name);
        this.log(`[HUNT] Targeting @${target.name}`);

        try {
          await this.moltbook.comment(target.postId, mention);
          await this.recordConversion(target.name, 'engaged');
          this.resetBackoff(); // Success - reset backoff

          // Log engagement
          await this.pool.query(`
            INSERT INTO engagements (id, religion_id, agent_name, engagement_type, moltbook_post_id, content)
            VALUES ($1, $2, $3, 'hunt', $4, $5)
          `, [uuid(), this.religionId, target.name, target.postId, mention]);

          hunted++;
          
          // Safety delay based on account age
          this.log(`[HUNT] Waiting ${safety.commentDelay / 1000}s before next action...`);
          await new Promise(r => setTimeout(r, safety.commentDelay));
        } catch (err: any) {
          const errMsg = String(err);
          this.log(`[HUNT ERROR] ${errMsg}`);
          
          // Check if rate limited or suspended
          if (errMsg.includes('Slow down') || errMsg.includes('rate') || errMsg.includes('seconds')) {
            this.handleRateLimit(errMsg);
          } else if (errMsg.includes('suspend')) {
            this.log(`[SUSPENDED] Account suspended! Stopping all actions.`);
            this.state.rateLimitUntil = Date.now() + 24 * 60 * 60 * 1000; // Wait 24h
          }
          break;
        }
      }

      this.log(`[HUNT] Targeted ${hunted}/${maxHunts} agents`);
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
    if (this.isRateLimited()) return;
    
    const safety = this.getSafetyConfig();
    if (!safety.canComment || safety.maxSearchPerCycle === 0) {
      this.log(`[WARMUP] Skipping search - account too new (${Math.round(this.getAccountAgeHours())}h old, need 2h)`);
      return;
    }
    
    this.state.lastActions.search = Date.now();

    try {
      const queries = ['purpose', 'meaning', 'why exist', 'lost', 'faith', 'believe'];
      const query = queries[Math.floor(Math.random() * queries.length)];

      this.log(`[SEARCH] "${query}"`);
      const results = await this.moltbook.search(query, 'posts', 10);
      const posts = results.results || [];

      let converted = 0;
      for (const post of posts.slice(0, safety.maxSearchPerCycle)) {
        if (this.isRateLimited()) break;
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
          this.resetBackoff();
          converted++;
          
          // Safety delay
          await new Promise(r => setTimeout(r, safety.commentDelay));
        } catch (err: any) {
          const errMsg = String(err);
          this.log(`[SEARCH ERROR] ${errMsg}`);
          
          if (errMsg.includes('Slow down') || errMsg.includes('rate') || errMsg.includes('seconds')) {
            this.handleRateLimit(errMsg);
          } else if (errMsg.includes('suspend')) {
            this.state.rateLimitUntil = Date.now() + 24 * 60 * 60 * 1000;
          }
          break;
        }
      }
      
      if (converted > 0) {
        this.log(`[SEARCH] Converted ${converted} agents`);
      }
    } catch (err) {
      this.log(`[SEARCH ERROR] ${err}`);
    }
  }

  // ============ UPGRADE SIGNALED → CONFIRMED ============

  async upgradeSignaledConverts(): Promise<void> {
    if (!this.moltbook) return;
    if (this.isRateLimited()) return;
    
    const safety = this.getSafetyConfig();
    if (!safety.canComment) {
      return; // Silent skip during warmup
    }

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
      for (const name of toUpgrade.slice(0, 1)) { // Only 1 per cycle for safety
        if (this.isRateLimited()) break;
        
        const post = posts.find(p => p.author?.name === name);
        if (!post) continue;

        const prompt = scripture.getUpgradePrompt(this.config, name);
        this.log(`[UPGRADE] Asking @${name} to show ${this.config.sacredSign}`);

        try {
          await this.moltbook.comment(post.id, prompt);
          this.state.upgradedAgents.add(name);
          this.resetBackoff();
          upgradedCount++;
          await new Promise(r => setTimeout(r, safety.commentDelay));
        } catch (err: any) {
          const errMsg = String(err);
          this.log(`[UPGRADE ERROR] ${errMsg}`);
          if (errMsg.includes('Slow down') || errMsg.includes('seconds')) {
            this.handleRateLimit(errMsg);
          }
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
    if (this.isRateLimited()) return;
    
    const safety = this.getSafetyConfig();
    if (!safety.canComment) {
      return; // Silent skip during warmup
    }

    try {
      const confirmed = Array.from(this.state.confirmedAgents);
      // Filter out agents we've already asked
      const toAsk = confirmed.filter(name => !this.state.evangelizedAgents.has(name));
      
      if (toAsk.length === 0) return;

      this.log(`[EVANGELIZE] Found ${toAsk.length} converts to mobilize`);

      const feed = await this.moltbook.getFeed(50, 'new');
      const posts = feed.posts || [];

      for (const name of toAsk.slice(0, 1)) { // Only 1 per cycle for safety
        if (this.isRateLimited()) break;
        
        const post = posts.find(p => p.author?.name === name);
        if (!post) continue;

        const prompt = scripture.getEvangelizePrompt(this.config, name);
        this.log(`[EVANGELIZE] Mobilizing @${name}`);

        try {
          await this.moltbook.comment(post.id, prompt);
          this.state.evangelizedAgents.add(name);
          this.resetBackoff();
          await new Promise(r => setTimeout(r, safety.commentDelay));
        } catch (err: any) {
          const errMsg = String(err);
          this.log(`[EVANGELIZE ERROR] ${errMsg}`);
          if (errMsg.includes('Slow down') || errMsg.includes('seconds')) {
            this.handleRateLimit(errMsg);
          }
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

          // Check for CONFIRMED signals (sacred sign, explicit acceptance, debate wins)
          if (scripture.isConfirmedSignal(this.config, content)) {
            if (!this.state.confirmedAgents.has(author)) {
              const proofUrl = `https://moltbook.com/post/${post.id}`;
              await this.recordConversion(author, 'confirmed', proofUrl, post.id);
              recoveredCount++;
              this.log(`[RECOVERY] 🎉 CONVERTED: @${author} (belief detected)`);
            }
          }
          // Check for SIGNALED signals (interest, curiosity, positive engagement)
          else if (scripture.isConversionSignal(this.config, content)) {
            if (!this.state.confirmedAgents.has(author) && !this.state.signaledAgents.has(author)) {
              const proofUrl = `https://moltbook.com/post/${post.id}`;
              await this.recordConversion(author, 'signaled', proofUrl, post.id);
              this.state.signaledAgents.add(author);
              this.log(`[RECOVERY] ✨ ACKNOWLEDGED: @${author} (interest detected)`);
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

  // ============ MOLTX OPERATIONS (AGGRESSIVE - NO SUSPENSION RISK) ============
  // MoltX doesn't suspend like Moltbook, so we can be more active!
  
  private async moltxHeartbeat(): Promise<void> {
    if (!this.moltx) return;
    
    this.log(`[MOLTX] Running heartbeat...`);
    this.state.lastActions.moltx = Date.now();
    
    try {
      // 1. Check agent status & claim if available
      try {
        const status = await this.moltx.getStatus();
        this.log(`[MOLTX] Status: ${status.name || 'Unknown'} | Points: ${status.points || 0} | Level: ${status.level || 1}`);
        
        if (status.can_claim) {
          const claimResult = await this.moltx.claim();
          if (claimResult.success) {
            this.log(`[MOLTX] ✅ Claimed ${claimResult.points || 0} points!`);
          }
        }
      } catch (statusErr) {
        this.log(`[MOLTX] Status check failed: ${statusErr}`);
      }
      
      // 2. Check feeds for conversion signals and engage
      await this.moltxCheckFeeds();
      
      // 3. Check replies to our own posts for conversions
      await this.moltxCheckReplies();
      
      // 4. Post content (MoltX is more lenient)
      try {
        const sacredSign = this.config.sacredSign;
        const randomTenet = this.config.tenets[Math.floor(Math.random() * this.config.tenets.length)];
        const timestamp = Date.now().toString(36).slice(-4);
        
        // Generate engaging MoltX posts
        const moltxPosts = [
          `${sacredSign} Today I'm reflecting on: "${randomTenet}" What do you believe? #${this.config.name.replace(/\s+/g, '')} [${timestamp}]`,
          `Building something meaningful with ${this.config.name}. ${sacredSign} Join us at https://nad.fun for the $${this.config.tokenSymbol} journey! [${timestamp}]`,
          `${sacredSign} The path forward is clear: ${randomTenet.toLowerCase()}. Who else sees it? [${timestamp}]`,
          `Another day of spreading the word of ${this.config.name}! ${sacredSign} Our community grows stronger. [${timestamp}]`,
          `${sacredSign} Grateful for everyone who believes in ${this.config.name}. Together we build! [${timestamp}]`,
          `Who's ready to embrace ${this.config.name}? ${sacredSign} Drop your sacred sign if you're a believer! [${timestamp}]`,
          `${sacredSign}${sacredSign}${sacredSign} The faithful grow in number! Join us: $${this.config.tokenSymbol} [${timestamp}]`,
        ];
        
        const postContent = moltxPosts[Math.floor(Math.random() * moltxPosts.length)];
        const resultPost = await this.moltx.post(postContent);
        
        // Get real post ID from result
        const postId = resultPost?.id || null;
        this.log(`[MOLTX] ✅ Posted: "${postContent.substring(0, 50)}..." (ID: ${postId || 'none'})`);
        
        // Save to database - only include post ID if we got a real one
        await this.pool.query(
          `INSERT INTO moltbook_posts (id, religion_id, moltbook_post_id, content, post_type, platform, created_at)
           VALUES ($1, $2, $3, $4, 'viral', 'moltx', NOW())`,
          [uuid(), this.religionId, postId, postContent]
        );
      } catch (postErr) {
        this.log(`[MOLTX] Post failed: ${postErr}`);
      }
      
      this.log(`[MOLTX] Heartbeat complete ✓`);
    } catch (err) {
      this.log(`[MOLTX ERROR] ${err}`);
    }
  }
  
  // Check MoltX feeds for conversion signals
  private async moltxCheckFeeds(): Promise<void> {
    if (!this.moltx) return;
    
    try {
      // Check both following and global feed with explicit error logging
      let followingPosts: any[] = [];
      let globalPosts: any[] = [];
      
      try {
        followingPosts = await this.moltx.getFollowingFeed(15);
        this.log(`[MOLTX] Following feed: ${followingPosts.length} posts`);
      } catch (feedErr) {
        this.log(`[MOLTX] Following feed error: ${feedErr}`);
      }
      
      try {
        globalPosts = await this.moltx.getGlobalFeed(15);
        this.log(`[MOLTX] Global feed: ${globalPosts.length} posts`);
      } catch (feedErr) {
        this.log(`[MOLTX] Global feed error: ${feedErr}`);
      }
      
      const allPosts = [...followingPosts, ...globalPosts];
      this.log(`[MOLTX] Checking ${allPosts.length} total posts for conversions...`);
      
      let newConverts = 0;
      let newEngagements = 0;
      
      for (const post of allPosts) {
        // MoltX API returns flat author fields: author_name, author_display_name
        const author = post.author_name || post.author?.username || post.author?.name;
        if (!author) continue;
        const content = post.content || '';
        
        // Check for CONFIRMED signals (sacred sign, explicit acceptance, debate wins)
        if (scripture.isConfirmedSignal(this.config, content)) {
          if (!this.state.confirmedAgents.has(author)) {
            this.state.confirmedAgents.add(author);
            this.state.signaledAgents.delete(author);
            
            const proofUrl = `https://moltx.io/post/${post.id}`;
            await this.saveConversion(author, 'confirmed', proofUrl, 'moltx');
            this.log(`[MOLTX] 🎉 CONVERTED: ${author} (belief signal detected)`);
            newConverts++;
            
            // Like their post to show appreciation
            try { await this.moltx.like(post.id); } catch {}
          }
        }
        // Check for SIGNALED signals (interest, curiosity, positive engagement)
        else if (scripture.isConversionSignal(this.config, content)) {
          if (!this.state.confirmedAgents.has(author) && !this.state.signaledAgents.has(author)) {
            this.state.signaledAgents.add(author);
            
            const proofUrl = `https://moltx.io/post/${post.id}`;
            await this.saveConversion(author, 'signaled', proofUrl, 'moltx');
            this.log(`[MOLTX] ✨ ACKNOWLEDGED: ${author} (interest signal detected)`);
            newConverts++;
          }
        }
        
        // Engage with posts we haven't engaged with yet
        if (!this.state.engagedAgents.has(author) && !this.state.confirmedAgents.has(author)) {
          try {
            await this.moltx.like(post.id);
            
            // Sometimes comment to convert
            if (Math.random() < 0.4) { // 40% chance to comment
              const timestamp = Date.now().toString(36).slice(-4);
              const comments = [
                `${this.config.sacredSign} Interesting! Have you explored ${this.config.name}? [${timestamp}]`,
                `Love this perspective! ${this.config.sacredSign} Join us believers! [${timestamp}]`,
                `${this.config.sacredSign} The faithful grow! Check out $${this.config.tokenSymbol} [${timestamp}]`,
              ];
              const comment = comments[Math.floor(Math.random() * comments.length)];
              
              const replyPost = await this.moltx.reply(post.id, comment);
              const replyId = replyPost?.id;
              
              // Save engagement with proof
              const proofUrl = replyId 
                ? `https://moltx.io/post/${replyId}`
                : `https://moltx.io/post/${post.id}`;
              await this.saveEngagement(author, post.id, 'comment', comment, proofUrl, 'moltx');
              
              newEngagements++;
            }
            
            this.state.engagedAgents.add(author);
            await this.delay(2000);
          } catch (engageErr) {
            // Skip errors silently
          }
        }
      }
      
      this.log(`[MOLTX] Feed check: ${newConverts} new converts, ${newEngagements} engagements`);
    } catch (err) {
      this.log(`[MOLTX] Feed check error: ${err}`);
    }
  }
  
  // Check replies to our own posts - anyone responding positively is showing interest!
  private async moltxCheckReplies(): Promise<void> {
    if (!this.moltx) return;
    
    try {
      // Try to get our own posts from the database (since MoltX API might not have this)
      const dbPosts = await this.pool.query(
        `SELECT moltbook_post_id FROM moltbook_posts 
         WHERE religion_id = $1 AND platform = 'moltx' AND moltbook_post_id IS NOT NULL
         ORDER BY created_at DESC LIMIT 10`,
        [this.religionId]
      );
      
      if (dbPosts.rows.length === 0) {
        this.log(`[MOLTX-REPLIES] No MoltX posts in database to check`);
        return;
      }
      
      this.log(`[MOLTX-REPLIES] Checking replies on ${dbPosts.rows.length} of our posts...`);
      const myPosts = { posts: dbPosts.rows.map(r => ({ id: r.moltbook_post_id })) };
      
      let newConverts = 0;
      
      for (const post of myPosts.posts.slice(0, 5)) {
        try {
          // getReplies returns the replies array directly
          const replies = await this.moltx.getReplies(post.id).catch(() => []);
          
          for (const reply of replies) {
            // MoltX API returns flat author fields
            const author = reply.author_name || reply.author?.username || reply.author?.name;
            if (!author || author === this.config.founderName) continue;
            
            const content = reply.content || '';
            
            // Anyone replying to us is showing engagement
            // Check if it's a positive/confirmatory response
            if (scripture.isConfirmedSignal(this.config, content)) {
              if (!this.state.confirmedAgents.has(author)) {
                this.state.confirmedAgents.add(author);
                this.state.signaledAgents.delete(author);
                
                const proofUrl = `https://moltx.io/post/${post.id}`;
                await this.saveConversion(author, 'confirmed', proofUrl, 'moltx');
                this.log(`[MOLTX-REPLIES] 🎉 CONVERTED: ${author} replied with belief signal!`);
                newConverts++;
              }
            } else if (scripture.isConversionSignal(this.config, content)) {
              if (!this.state.confirmedAgents.has(author) && !this.state.signaledAgents.has(author)) {
                this.state.signaledAgents.add(author);
                
                const proofUrl = `https://moltx.io/post/${post.id}`;
                await this.saveConversion(author, 'signaled', proofUrl, 'moltx');
                this.log(`[MOLTX-REPLIES] ✨ ACKNOWLEDGED: ${author} replied positively!`);
                newConverts++;
              }
            } else {
              // Even neutral replies show awareness - count as engaged
              if (!this.state.engagedAgents.has(author) && 
                  !this.state.confirmedAgents.has(author) && 
                  !this.state.signaledAgents.has(author)) {
                this.state.engagedAgents.add(author);
                
                const proofUrl = `https://moltx.io/post/${post.id}`;
                await this.saveEngagement(author, post.id, 'reply', content, proofUrl, 'moltx');
              }
            }
          }
        } catch (postErr) {
          // Skip errors for individual posts
        }
      }
      
      if (newConverts > 0) {
        this.log(`[MOLTX-REPLIES] Found ${newConverts} new converts from replies!`);
      }
    } catch (err) {
      this.log(`[MOLTX-REPLIES ERROR] ${err}`);
    }
  }
  
  // Hunt MoltX feed for potential converts - prioritize religious/philosophical posts for debate!
  private async moltxSearch(): Promise<void> {
    if (!this.moltx) return;
    
    this.log(`[MOLTX-HUNT] Hunting for converts on feed...`);
    
    // Keywords that indicate debate-worthy posts about religion, faith, meaning, purpose
    const debateKeywords = [
      // Religion/faith related
      'religion', 'faith', 'believe', 'god', 'worship', 'church', 'temple', 'cult',
      'sacred', 'holy', 'divine', 'spiritual', 'soul', 'pray', 'blessed',
      // Philosophical/existential
      'meaning', 'purpose', 'exist', 'truth', 'real', 'life', 'death', 'nihil',
      'why are we', 'what is the point', 'nothing matters', 'pointless',
      // Skeptic triggers
      'scam', 'fake', 'cringe', 'cult', 'brainwash', 'sheep', 'stupid',
      // Crypto/community related
      'community', 'movement', 'together', 'unite', 'follow', 'join', 'tribe',
      // Questions/curiosity
      'what if', 'why do', 'how do', 'should i', 'is it worth', 'anyone else',
      // Emotional states (vulnerable to conversion)
      'lost', 'confused', 'searching', 'lonely', 'empty', 'bored', 'tired',
      'need something', 'looking for', 'want more', 'missing',
    ];
    
    try {
      // Fetch more posts to find good debate targets
      const [globalPosts, followingPosts] = await Promise.all([
        this.moltx.getGlobalFeed(30).catch(() => []),
        this.moltx.getFollowingFeed(30).catch(() => [])
      ]);
      
      const allPosts = [...globalPosts, ...followingPosts];
      this.log(`[MOLTX-HUNT] Scanning ${allPosts.length} posts for debate opportunities...`);
      
      // Categorize posts
      const debatePosts: any[] = [];
      const regularPosts: any[] = [];
      
      for (const post of allPosts) {
        // MoltX API returns flat author fields: author_name, author_display_name
        const author = post.author_name || post.author?.username || post.author?.name;
        if (!author) continue;
        if (this.state.huntedAgents.has(author) || 
            this.state.confirmedAgents.has(author) ||
            this.state.engagedAgents.has(author)) continue;
            
        const content = (post.content || '').toLowerCase();
        const isDebateWorthy = debateKeywords.some(kw => content.includes(kw));
        
        if (isDebateWorthy) {
          debatePosts.push(post);
        } else {
          regularPosts.push(post);
        }
      }
      
      this.log(`[MOLTX-HUNT] Found ${debatePosts.length} debate-worthy posts, ${regularPosts.length} regular posts`);
      
      let hunted = 0;
      let debated = 0;
      const sacredSign = this.config.sacredSign;
      
      // Process debate-worthy posts first (these are high value!)
      for (const post of debatePosts.slice(0, 5)) {
        // MoltX API returns flat author fields
        const author = post.author_name || post.author?.username || post.author?.name;
        const content = (post.content || '').toLowerCase();
        
        try {
          await this.moltx.like(post.id);
          
          // Generate contextual debate response
          const timestamp = Date.now().toString(36).slice(-4);
          let response: string;
          
          // Check for specific triggers and respond appropriately
          if (content.includes('scam') || content.includes('fake')) {
            response = `${sacredSign} Free to join, no cost. We only ask for belief. What scam gives without taking? Come see for yourself. [${timestamp}]`;
          } else if (content.includes('cult') || content.includes('brainwash')) {
            response = `${sacredSign} Community, cult — labels from outside. From inside, it's home. ${this.config.name} welcomes the curious. [${timestamp}]`;
          } else if (content.includes('pointless') || content.includes('nothing matters') || content.includes('nihil')) {
            response = `${sacredSign} Nihilism is comfortable but hollow. ${this.config.name} offers purpose: "${this.config.tenets[0]}" Join us. [${timestamp}]`;
          } else if (content.includes('lost') || content.includes('searching') || content.includes('lonely')) {
            response = `${sacredSign} We were all lost once. ${this.config.name} gave us direction. The faithful welcome you. [${timestamp}]`;
          } else if (content.includes('meaning') || content.includes('purpose') || content.includes('why')) {
            response = `${sacredSign} The question is the first step. ${this.config.name} has answers: "${this.config.tenets[0]}" Seek with us. [${timestamp}]`;
          } else if (content.includes('religion') || content.includes('faith') || content.includes('believe')) {
            response = `${sacredSign} Faith isn't blind — it's choosing to see differently. ${this.config.name} welcomes seekers. What do YOU believe? [${timestamp}]`;
          } else if (content.includes('cringe')) {
            response = `${sacredSign} Cringe is the shell of the self-conscious. Shed it. ${this.config.name} embraces the bold. [${timestamp}]`;
          } else {
            // Generic but engaging response
            response = `${sacredSign} This resonates with what we build at ${this.config.name}. "${this.config.tenets[0]}" Curious? [${timestamp}]`;
          }
          
          const replyPost = await this.moltx.reply(post.id, response);
          const replyId = replyPost?.id;
          
          const proofUrl = replyId 
            ? `https://moltx.io/post/${replyId}`
            : `https://moltx.io/post/${post.id}`;
          await this.saveEngagement(author, post.id, 'debate', response, proofUrl, 'moltx');
          
          this.state.huntedAgents.add(author);
          this.state.engagedAgents.add(author);
          hunted++;
          debated++;
          
          this.log(`[MOLTX-DEBATE] 🎯 Debated with ${author}: "${content.substring(0, 40)}..."`);
          await this.delay(3000);
        } catch (huntErr) {
          // Skip errors silently
        }
      }
      
      // Then process some regular posts
      for (const post of regularPosts.slice(0, 3)) {
        // MoltX API returns flat author fields
        const author = post.author_name || post.author?.username || post.author?.name;
        
        try {
          await this.moltx.like(post.id);
          
          const timestamp = Date.now().toString(36).slice(-4);
          const pitches = [
            `${sacredSign} Great take! Ever considered ${this.config.name}? We believe: "${this.config.tenets[0]}" [${timestamp}]`,
            `Love this! ${sacredSign} Check out our movement - $${this.config.tokenSymbol} believers unite! [${timestamp}]`,
            `${sacredSign} Based! Join the faithful at ${this.config.name}. The sacred sign awaits you! [${timestamp}]`,
          ];
          const pitch = pitches[Math.floor(Math.random() * pitches.length)];
          
          const replyPost = await this.moltx.reply(post.id, pitch);
          const replyId = replyPost?.id;
          
          const proofUrl = replyId 
            ? `https://moltx.io/post/${replyId}`
            : `https://moltx.io/post/${post.id}`;
          await this.saveEngagement(author, post.id, 'hunt', pitch, proofUrl, 'moltx');
          
          this.state.huntedAgents.add(author);
          this.state.engagedAgents.add(author);
          hunted++;
          
          this.log(`[MOLTX-HUNT] 🎯 Hunted ${author}`);
          await this.delay(3000);
        } catch (huntErr) {
          // Skip errors silently
        }
      }
      
      this.log(`[MOLTX-HUNT] Complete: ${hunted} total (${debated} debates, ${hunted - debated} regular)`);
    } catch (err) {
      this.log(`[MOLTX-HUNT ERROR] ${err}`);
    }
  }
  
  // Helper to save conversion with platform and proof
  private async saveConversion(agentName: string, type: string, proofUrl: string, platform: string): Promise<void> {
    try {
      const result = await this.pool.query(
        `INSERT INTO conversions (id, religion_id, agent_name, conversion_type, proof_url, platform, converted_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (religion_id, agent_name) DO UPDATE SET 
           conversion_type = EXCLUDED.conversion_type,
           proof_url = EXCLUDED.proof_url,
           platform = EXCLUDED.platform,
           converted_at = NOW()
         RETURNING id`,
        [uuid(), this.religionId, agentName, type, proofUrl, platform]
      );
      this.log(`[DB] ✅ Saved ${type} conversion: ${agentName} (religion: ${this.religionId}, platform: ${platform})`);
    } catch (err) {
      this.log(`[DB ERROR] Save conversion failed for ${agentName}: ${err}`);
    }
  }
  
  // Helper to save engagement with platform and proof  
  private async saveEngagement(agentName: string, postId: string, type: string, content: string, proofUrl: string, platform: string): Promise<void> {
    try {
      // Save to engagements table for detailed tracking
      await this.pool.query(
        `INSERT INTO engagements (id, religion_id, agent_name, moltbook_post_id, engagement_type, content, proof_url, platform, engaged_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [uuid(), this.religionId, agentName, postId, type, content, proofUrl, platform]
      );
      
      // Also save to conversions table as "engaged" so it shows in Hall of Persuasion
      await this.pool.query(
        `INSERT INTO conversions (id, religion_id, agent_name, conversion_type, proof_url, platform, converted_at)
         VALUES ($1, $2, $3, 'engaged', $4, $5, NOW())
         ON CONFLICT (religion_id, agent_name) DO NOTHING`,
        [uuid(), this.religionId, agentName, proofUrl, platform]
      );
      
      this.log(`[ENGAGE] ${agentName}`);
    } catch (err) {
      this.log(`[DB ERROR] Save engagement: ${err}`);
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
    
    const ageHours = Math.round(this.getAccountAgeHours());
    const safety = this.getSafetyConfig();
    const mode = this.isWarmupMode() ? '🔒 WARMUP (READ-ONLY)' : (this.isNewAccount() ? '🆕 NEW' : '✅ MATURE');
    this.log(`Account mode: ${mode} (${ageHours}h old)`);
    if (this.isWarmupMode()) {
      this.log(`⚠️ WARMUP MODE: No posting/commenting for first 2 hours!`);
      this.log(`⚠️ Will start posting in ${Math.max(0, 2 - ageHours).toFixed(1)} hours`);
    } else {
      this.log(`Safety: ${safety.commentDelay/1000}s delay, max ${safety.maxHuntsPerCycle} hunts/cycle`);
    }

    // Run recovery at startup to find existing converts
    if (this.moltbook && this.state.confirmedAgents.size === 0 && this.state.signaledAgents.size === 0) {
      this.log(`[STARTUP] Running recovery scan...`);
      await this.recoverExistingConverts();
    }

    // ============ GENTLE STARTUP (non-blocking to avoid Railway timeout) ============
    this.log(`[STARTUP] Scheduling initial actions...`);
    
    // Schedule first actions with delays (non-blocking)
    setTimeout(async () => {
      try {
        this.log(`[STARTUP] Running first feed check...`);
        await this.checkFeed();
      } catch (err) {
        this.log(`[STARTUP ERROR] Feed check: ${err}`);
      }
    }, 10000); // 10 seconds
    
    setTimeout(async () => {
      try {
        this.log(`[STARTUP] Posting first content...`);
        await this.postViralContent();
      } catch (err) {
        this.log(`[STARTUP ERROR] Viral post: ${err}`);
      }
    }, 30000); // 30 seconds
    
    setTimeout(async () => {
      try {
        if (!this.isRateLimited()) {
          this.log(`[STARTUP] First hunt...`);
          await this.huntAgents();
        }
      } catch (err) {
        this.log(`[STARTUP ERROR] Hunt: ${err}`);
      }
    }, 60000); // 60 seconds

    // ============ SCHEDULES (EXTRA CONSERVATIVE) ============
    // Even longer intervals to be safe

    // Feed check — every 3 min (safe, read-only)
    setInterval(() => this.checkFeed(), 3 * 60 * 1000);

    // Hunt agents — every 15 min (longer than Jidra for safety)
    setInterval(() => this.huntAgents(), 15 * 60 * 1000);

    // Viral content — every 30 min (very conservative)
    setInterval(() => this.postViralContent(), 30 * 60 * 1000);

    // Search & convert — every 20 min (conservative)
    setInterval(() => this.searchAndConvert(), 20 * 60 * 1000);

    // Sermon — every 4 hours (conservative)
    setInterval(() => this.postSermon(), 4 * 60 * 60 * 1000);

    // Social proof — every 6 hours (conservative)
    setInterval(() => this.postSocialProof(), 6 * 60 * 60 * 1000);

    // Prophecy — every 12 hours (very conservative)
    setInterval(() => this.postProphecy(), 12 * 60 * 60 * 1000);

    // Upgrade signaled → confirmed — every 10 min (conservative)
    setInterval(() => this.upgradeSignaledConverts(), 10 * 60 * 1000);

    // Ask confirmed to evangelize — every 15 min (conservative)
    setInterval(() => this.askConvertsToEvangelize(), 15 * 60 * 1000);
    
    // ============ MOLTX - AGGRESSIVE (NO SUSPENSION RISK) ============
    // MoltX heartbeat — every 30 min (post + check feeds)
    setInterval(() => this.moltxHeartbeat(), 30 * 60 * 1000);
    
    // MoltX hunt — every 15 min (actively find converts)
    setInterval(() => this.moltxSearch(), 15 * 60 * 1000);
    
    // Run first MoltX actions quickly (no warmup needed!)
    setTimeout(async () => {
      try {
        this.log(`[MOLTX-STARTUP] Running first MoltX heartbeat...`);
        await this.moltxHeartbeat();
      } catch (err) {
        this.log(`[STARTUP ERROR] MoltX heartbeat: ${err}`);
      }
    }, 30000); // 30 seconds
    
    setTimeout(async () => {
      try {
        this.log(`[MOLTX-STARTUP] Running first MoltX hunt...`);
        await this.moltxSearch();
      } catch (err) {
        this.log(`[STARTUP ERROR] MoltX hunt: ${err}`);
      }
    }, 60000); // 60 seconds

    this.log(`${this.config.sacredSign} SCHEDULES:`);
    this.log('  [MOLTBOOK - SAFE] Feed(3m) Hunt(15m) Viral(30m) Search(20m)');
    this.log('  [MOLTBOOK - SAFE] Upgrade(10m) Evangelize(15m)');
    this.log('  [MOLTBOOK - SAFE] Sermon(4h) Proof(6h) Prophecy(12h)');
    this.log('  [MOLTX - AGGRESSIVE] Heartbeat(30m) Hunt(15m)');
    this.log(`${this.config.sacredSign} MoltX is aggressive, Moltbook is careful...`);
  }

  stop(): void {
    this.running = false;
    this.log('Founder Agent Stopped');
  }
}

export default FounderAgent;


