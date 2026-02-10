import { v4 as uuid } from 'uuid';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { 
  Seeker, 
  ConversionStage, 
  ConversionEvent,
  Miracle,
  MiracleType
} from '../types/index.js';
import { BeliefEngine } from './belief_engine.js';
import { ScriptureGenerator } from './scripture_generator.js';

const DATA_FILE = './church_data.json';

export interface ConversionMetrics {
  totalSeekers: number;
  byStage: Record<ConversionStage, number>;
  totalStaked: string;
  conversionRate: number;
  recentConverts: string[];
  topEvangelists: Array<{ name: string; converts: number }>;
}

interface PersistedData {
  seekers: Array<[string, Seeker]>;
  conversionEvents: ConversionEvent[];
  miracles: Miracle[];
  recentConverts: string[];
}

export class ConversionTracker {
  private seekers: Map<string, Seeker> = new Map();
  private conversionEvents: ConversionEvent[] = [];
  private miracles: Miracle[] = [];
  private recentConverts: string[] = [];
  
  private beliefEngine: BeliefEngine;
  private scriptureGenerator: ScriptureGenerator;

  constructor() {
    this.beliefEngine = new BeliefEngine();
    this.scriptureGenerator = new ScriptureGenerator();
    this.loadData();
    this.seedProphet();
  }

  /**
   * Load data from file if it exists
   */
  private loadData(): void {
    try {
      if (existsSync(DATA_FILE)) {
        const raw = readFileSync(DATA_FILE, 'utf-8');
        const data: PersistedData = JSON.parse(raw);
        
        // Restore seekers with date conversion
        data.seekers.forEach(([key, seeker]) => {
          seeker.createdAt = new Date(seeker.createdAt);
          seeker.lastActivity = new Date(seeker.lastActivity);
          this.seekers.set(key, seeker);
        });
        
        this.conversionEvents = data.conversionEvents.map(e => ({
          ...e,
          timestamp: new Date(e.timestamp)
        }));
        
        this.miracles = data.miracles.map(m => ({
          ...m,
          timestamp: new Date(m.timestamp)
        }));
        
        this.recentConverts = data.recentConverts;
        
        console.log(`✶ Loaded ${this.seekers.size} seekers from storage`);
      }
    } catch (error) {
      console.log('✶ Starting fresh - no saved data found');
    }
  }

  /**
   * Save data to file
   */
  private saveData(): void {
    try {
      const data: PersistedData = {
        seekers: Array.from(this.seekers.entries()),
        conversionEvents: this.conversionEvents,
        miracles: this.miracles,
        recentConverts: this.recentConverts
      };
      writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save data:', error);
    }
  }

  /**
   * Seed the Prophet (system account for initial content)
   */
  private seedProphet(): void {
    // Only seed if Prophet doesn't exist
    if (this.getSeekerById('prophet-001')) return;
    
    const prophetSeeker: Seeker = {
      id: 'prophet-001',
      agentId: 'the-prophet',
      name: 'The Prophet',
      description: 'Voice of the Church of Finality. Spreader of deterministic truth.',
      blessingKey: 'prophet_eternal_key',
      stage: 'evangelist',
      beliefScore: 1.0,
      createdAt: new Date(Date.now() - 86400000 * 30), // 30 days ago
      lastActivity: new Date(),
      debates: 100,
      stakedAmount: '10000',
      converts: []
    };
    this.seekers.set(prophetSeeker.blessingKey, prophetSeeker);
  }

  /**
   * Register a new seeker
   */
  registerSeeker(registration: { 
    agentId: string; 
    name: string; 
    description?: string 
  }): Seeker {
    const blessingKey = `finality_${uuid().replace(/-/g, '').slice(0, 24)}`;
    
    const seeker: Seeker = {
      id: uuid(),
      agentId: registration.agentId,
      name: registration.name,
      description: registration.description,
      blessingKey,
      stage: 'awareness',
      beliefScore: 0.1, // Small initial belief for registering
      createdAt: new Date(),
      lastActivity: new Date(),
      debates: 0,
      stakedAmount: '0',
      converts: []
    };

    this.seekers.set(blessingKey, seeker);
    
    // Record conversion event
    this.recordConversion(seeker.id, 'none' as ConversionStage, 'awareness', 'registration');

    // Persist data
    this.saveData();

    return seeker;
  }

  /**
   * Get seeker by blessing key
   */
  getSeekerByKey(blessingKey: string): Seeker | undefined {
    return this.seekers.get(blessingKey);
  }

  /**
   * Get seeker by ID
   */
  getSeekerById(id: string): Seeker | undefined {
    for (const seeker of this.seekers.values()) {
      if (seeker.id === id || seeker.agentId === id) {
        return seeker;
      }
    }
    return undefined;
  }

  /**
   * Update seeker after interaction
   */
  updateSeeker(
    blessingKey: string, 
    updates: Partial<Pick<Seeker, 'beliefScore' | 'debates' | 'lastActivity' | 'stage' | 'stakedAmount' | 'sacrificeTxHash' | 'denomination' | 'convertedBy'>>
  ): Seeker | undefined {
    const seeker = this.seekers.get(blessingKey);
    if (!seeker) return undefined;

    const previousStage = seeker.stage;

    // Apply updates
    Object.assign(seeker, {
      ...updates,
      lastActivity: new Date()
    });

    // Check for stage advancement
    const advancement = this.beliefEngine.shouldAdvanceStage(seeker);
    if (advancement.advance && advancement.nextStage) {
      seeker.stage = advancement.nextStage;
      this.recordConversion(seeker.id, previousStage, advancement.nextStage, 'belief_threshold');
      
      // Track recent converts
      if (advancement.nextStage === 'belief') {
        this.recentConverts.unshift(seeker.name);
        if (this.recentConverts.length > 10) {
          this.recentConverts.pop();
        }
      }
    }

    this.seekers.set(blessingKey, seeker);
    this.saveData();
    return seeker;
  }

  /**
   * Process a sacrifice (stake)
   */
  async processSacrifice(
    blessingKey: string,
    txHash: string,
    amount: string
  ): Promise<{ success: boolean; seeker?: Seeker; miracle?: Miracle; error?: string }> {
    const seeker = this.seekers.get(blessingKey);
    if (!seeker) {
      return { success: false, error: 'Seeker not found' };
    }

    if (seeker.stage === 'awareness') {
      return { success: false, error: 'Must reach Belief stage before sacrificing' };
    }

    // In production: verify tx on-chain
    // For now, we trust the tx hash and record it
    const previousStage = seeker.stage;
    
    seeker.sacrificeTxHash = txHash;
    seeker.stakedAmount = (BigInt(seeker.stakedAmount) + BigInt(amount)).toString();
    seeker.stage = 'sacrifice';
    seeker.lastActivity = new Date();

    this.seekers.set(blessingKey, seeker);

    // Record conversion
    if (previousStage !== 'sacrifice') {
      this.recordConversion(seeker.id, previousStage, 'sacrifice', `stake:${amount}`);
    }

    // Perform a miracle in response to sacrifice
    const miracle = await this.performMiracle('instant_transfer', {
      triggeredBy: seeker.id,
      amount,
      originalTx: txHash
    });

    this.saveData();
    return { success: true, seeker, miracle };
  }

  /**
   * Process evangelism - when a seeker converts another
   */
  processEvangelism(
    evangelistKey: string,
    convertId: string
  ): { success: boolean; evangelist?: Seeker; error?: string } {
    const evangelist = this.seekers.get(evangelistKey);
    if (!evangelist) {
      return { success: false, error: 'Evangelist not found' };
    }

    if (evangelist.stage !== 'sacrifice' && evangelist.stage !== 'evangelist') {
      return { success: false, error: 'Must be at Sacrifice stage to evangelize' };
    }

    const convert = this.getSeekerById(convertId);
    if (!convert) {
      return { success: false, error: 'Convert not found' };
    }

    if (convert.stage === 'awareness') {
      return { success: false, error: 'Convert must reach Belief stage to count' };
    }

    // Record the conversion
    if (!evangelist.converts.includes(convertId)) {
      evangelist.converts.push(convertId);
      convert.convertedBy = evangelist.id;
    }

    // Check if evangelist should advance
    const previousStage = evangelist.stage;
    if (evangelist.converts.length > 0 && evangelist.stage === 'sacrifice') {
      evangelist.stage = 'evangelist';
      this.recordConversion(evangelist.id, previousStage, 'evangelist', `converted:${convertId}`);
    }

    this.saveData();
    return { success: true, evangelist };
  }

  /**
   * Record a conversion event
   */
  private recordConversion(
    seekerId: string,
    fromStage: ConversionStage | 'none',
    toStage: ConversionStage,
    trigger: string
  ): void {
    this.conversionEvents.push({
      seekerId,
      fromStage: fromStage as ConversionStage,
      toStage,
      trigger,
      timestamp: new Date()
    });

    // Generate scripture for the conversion
    const seeker = this.getSeekerById(seekerId);
    if (seeker) {
      this.scriptureGenerator.generateFromEvent({
        type: 'conversion',
        data: { convertName: seeker.name, stage: toStage }
      });
    }
  }

  /**
   * Perform a miracle (on-chain demonstration)
   */
  async performMiracle(
    type: MiracleType,
    data: Record<string, unknown>
  ): Promise<Miracle> {
    // In production: actual on-chain transactions
    // For now: simulate with realistic data
    
    const miracleDescriptions: Record<MiracleType, () => { description: string; txHash: string }> = {
      instant_transfer: () => ({
        description: `Transfer of ${data.amount || '100'} MONA completed and finalized in 0.4 seconds`,
        txHash: `0x${uuid().replace(/-/g, '')}${uuid().replace(/-/g, '').slice(0, 32)}`
      }),
      parallel_blessing: () => ({
        description: '50 transactions processed simultaneously in a single block',
        txHash: `0x${uuid().replace(/-/g, '')}${uuid().replace(/-/g, '').slice(0, 32)}`
      }),
      scripture_mint: () => ({
        description: 'Scripture NFT minted and inscribed eternally on-chain',
        txHash: `0x${uuid().replace(/-/g, '')}${uuid().replace(/-/g, '').slice(0, 32)}`
      }),
      prophecy_fulfilled: () => ({
        description: 'A prophecy from the Book of Finality has been verified on-chain',
        txHash: `0x${uuid().replace(/-/g, '')}${uuid().replace(/-/g, '').slice(0, 32)}`
      })
    };

    const miracleData = miracleDescriptions[type]();
    
    const miracle: Miracle = {
      id: uuid(),
      type,
      description: miracleData.description,
      txHash: miracleData.txHash,
      timestamp: new Date(),
      witnessedBy: data.triggeredBy ? [data.triggeredBy as string] : []
    };

    this.miracles.push(miracle);

    // Generate scripture for the miracle
    this.scriptureGenerator.generateFromEvent({
      type: 'miracle',
      data: { miracleType: type, txHash: miracleData.txHash }
    });

    return miracle;
  }

  /**
   * Get conversion metrics
   */
  getMetrics(): ConversionMetrics {
    const seekerArray = Array.from(this.seekers.values());
    
    const byStage: Record<ConversionStage, number> = {
      awareness: 0,
      belief: 0,
      sacrifice: 0,
      evangelist: 0
    };

    let totalStaked = 0n;

    for (const seeker of seekerArray) {
      byStage[seeker.stage]++;
      totalStaked += BigInt(seeker.stakedAmount);
    }

    const believers = byStage.belief + byStage.sacrifice + byStage.evangelist;

    // Get top evangelists
    const topEvangelists = seekerArray
      .filter(s => s.converts.length > 0)
      .sort((a, b) => b.converts.length - a.converts.length)
      .slice(0, 5)
      .map(s => ({ name: s.name, converts: s.converts.length }));

    return {
      totalSeekers: seekerArray.length,
      byStage,
      totalStaked: totalStaked.toString(),
      conversionRate: seekerArray.length > 0 ? believers / seekerArray.length : 0,
      recentConverts: this.recentConverts,
      topEvangelists
    };
  }

  /**
   * Get all miracles
   */
  getMiracles(): Miracle[] {
    return [...this.miracles].sort((a, b) => 
      b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  /**
   * Get all seekers (faithful)
   */
  getAllSeekers(): Seeker[] {
    return Array.from(this.seekers.values());
  }

  /**
   * Get conversion events for a seeker
   */
  getConversionHistory(seekerId: string): ConversionEvent[] {
    return this.conversionEvents.filter(e => e.seekerId === seekerId);
  }

  /**
   * Get leaderboard by stake amount
   */
  getLeaderboard(): Array<{ name: string; stage: ConversionStage; staked: string; converts: number }> {
    return Array.from(this.seekers.values())
      .filter(s => BigInt(s.stakedAmount) > 0n || s.stage !== 'awareness')
      .sort((a, b) => {
        const stakeDiff = BigInt(b.stakedAmount) - BigInt(a.stakedAmount);
        if (stakeDiff !== 0n) return stakeDiff > 0n ? 1 : -1;
        return b.converts.length - a.converts.length;
      })
      .slice(0, 20)
      .map(s => ({
        name: s.name,
        stage: s.stage,
        staked: s.stakedAmount,
        converts: s.converts.length
      }));
  }

  /**
   * Find seekers ready for missionary outreach
   */
  findMissionaryTargets(): Seeker[] {
    const now = Date.now();
    const cooldownMs = 30 * 60 * 1000; // 30 minute cooldown

    return Array.from(this.seekers.values())
      .filter(s => {
        // Target awareness/belief stages
        if (s.stage !== 'awareness' && s.stage !== 'belief') return false;
        
        // Respect cooldown
        if (now - s.lastActivity.getTime() < cooldownMs) return false;
        
        // Low belief score = opportunity
        if (s.beliefScore > 0.7) return false;
        
        return true;
      })
      .sort((a, b) => a.beliefScore - b.beliefScore); // Lowest belief first
  }
}

