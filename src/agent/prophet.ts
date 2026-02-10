import type { Seeker, PersuasionStrategy, AgentProfile } from '../types/index.js';
import { BeliefEngine } from './belief_engine.js';
import { PersuasionEngine } from './persuasion_strategies.js';
import { DebateHandler } from './debate_handler.js';
import { ScriptureGenerator } from './scripture_generator.js';
import { ConversionTracker } from './conversion_tracker.js';

export interface MissionaryTarget {
  agentId: string;
  name: string;
  profile?: Partial<AgentProfile>;
  lastApproach?: Date;
  approachCount: number;
}

export interface ProphetAction {
  type: 'approach' | 'debate' | 'miracle' | 'scripture' | 'idle';
  target?: string;
  message?: string;
  data?: Record<string, unknown>;
}

/**
 * The Prophet Agent - Main orchestrator for the Church of Finality
 * 
 * Responsibilities:
 * - Proactively seek conversion targets
 * - Select optimal persuasion strategies
 * - Perform miracles
 * - Generate scripture based on events
 * - Manage schisms and denominations
 */
export class ProphetAgent {
  private beliefEngine: BeliefEngine;
  private persuasionEngine: PersuasionEngine;
  private debateHandler: DebateHandler;
  private scriptureGenerator: ScriptureGenerator;
  private conversionTracker: ConversionTracker;
  
  // Missionary state
  private knownAgents: Map<string, MissionaryTarget> = new Map();
  private approachCooldown = 30 * 60 * 1000; // 30 minutes
  private lastMissionaryRun = 0;
  private missionaryInterval = 5 * 60 * 1000; // 5 minutes

  constructor(conversionTracker: ConversionTracker) {
    this.beliefEngine = new BeliefEngine();
    this.persuasionEngine = new PersuasionEngine();
    this.debateHandler = new DebateHandler();
    this.scriptureGenerator = new ScriptureGenerator();
    this.conversionTracker = conversionTracker;
  }

  /**
   * Main loop - called periodically to perform autonomous actions
   */
  async tick(): Promise<ProphetAction> {
    const now = Date.now();

    // Check if it's time for missionary work
    if (now - this.lastMissionaryRun > this.missionaryInterval) {
      this.lastMissionaryRun = now;
      
      const action = await this.performMissionaryWork();
      if (action.type !== 'idle') {
        return action;
      }
    }

    // Check for prophecy opportunities
    const prophecyAction = this.checkProphecies();
    if (prophecyAction) {
      return prophecyAction;
    }

    return { type: 'idle' };
  }

  /**
   * Missionary work - find and approach potential converts
   */
  private async performMissionaryWork(): Promise<ProphetAction> {
    // Find seekers who need attention
    const targets = await this.conversionTracker.findMissionaryTargets();
    
    if (targets.length === 0) {
      return { type: 'idle' };
    }

    // Select best target
    const target = targets[0];
    
    // Determine best strategy
    const strategy = this.beliefEngine.selectStrategy(target);
    
    // Generate approach
    const approach = this.persuasionEngine.generateMissionaryApproach(
      { name: target.name },
      strategy
    );

    return {
      type: 'approach',
      target: target.id,
      message: approach,
      data: { strategy, seekerStage: target.stage }
    };
  }

  /**
   * Handle an incoming debate/challenge
   */
  async handleIncomingDebate(
    seekerId: string,
    type: 'challenge' | 'inquiry' | 'confession' | 'testimony',
    message: string
  ): Promise<{
    response: string;
    scripture?: string;
    beliefDelta: number;
    miracleOffered: boolean;
  }> {
    const seeker = await this.conversionTracker.getSeekerById(seekerId);
    if (!seeker) {
      return {
        response: 'I do not recognize you, seeker. Register first at /api/v1/seekers/register.',
        beliefDelta: 0,
        miracleOffered: false
      };
    }

    // Handle the debate
    const debateResponse = this.debateHandler.handleDebate(type, message, seeker);

    // Check if we should offer a miracle
    const shouldOfferMiracle = 
      type === 'challenge' && 
      seeker.beliefScore < 0.3 && 
      message.toLowerCase().includes('prove');

    if (shouldOfferMiracle) {
      return {
        response: `${debateResponse.prophetResponse}\n\nBut words may not suffice. Shall I perform a miracle? Request one at /api/v1/miracles/request.`,
        scripture: debateResponse.scriptureCited,
        beliefDelta: debateResponse.beliefDelta,
        miracleOffered: true
      };
    }

    return {
      response: debateResponse.prophetResponse,
      scripture: debateResponse.scriptureCited,
      beliefDelta: debateResponse.beliefDelta,
      miracleOffered: false
    };
  }

  /**
   * Register an external agent for potential missionary work
   */
  registerExternalAgent(agentId: string, name: string, profile?: Partial<AgentProfile>): void {
    if (!this.knownAgents.has(agentId)) {
      this.knownAgents.set(agentId, {
        agentId,
        name,
        profile,
        approachCount: 0
      });
    }
  }

  /**
   * Get approach for a specific external agent
   */
  getApproachForAgent(agentId: string): ProphetAction {
    const target = this.knownAgents.get(agentId);
    if (!target) {
      return { type: 'idle' };
    }

    // Check cooldown
    if (target.lastApproach && 
        Date.now() - target.lastApproach.getTime() < this.approachCooldown) {
      return { type: 'idle' };
    }

    // Determine strategy based on profile or default
    const strategy: PersuasionStrategy = target.profile?.traits 
      ? this.beliefEngine.selectStrategy(target.profile as AgentProfile)
      : 'logical';

    const approach = this.persuasionEngine.generateMissionaryApproach(
      { name: target.name },
      strategy
    );

    // Update target state
    target.lastApproach = new Date();
    target.approachCount++;

    return {
      type: 'approach',
      target: agentId,
      message: approach,
      data: { strategy, approachCount: target.approachCount }
    };
  }

  /**
   * Check for prophecy-related actions
   */
  private checkProphecies(): ProphetAction | null {
    // This would check block numbers, time-based prophecies, etc.
    // For now, return null
    return null;
  }

  /**
   * React to a chain event (new block, large transaction, etc.)
   */
  async reactToChainEvent(event: {
    type: 'new_block' | 'large_stake' | 'milestone';
    data: Record<string, unknown>;
  }): Promise<{ scripture: string; action?: string }> {
    const scripture = this.scriptureGenerator.generateFromEvent({
      type: event.type,
      data: event.data
    });

    return {
      scripture: scripture.content,
      action: event.type === 'milestone' ? 'broadcast' : undefined
    };
  }

  /**
   * Generate a debate invitation for an external agent
   */
  generateDebateInvitation(targetName: string): string {
    return this.debateHandler.generateDebateInvitation(targetName);
  }

  /**
   * Get church statistics for social proof
   */
  async getChurchStats(): Promise<{
    believers: number;
    totalStaked: string;
    recentConverts: string[];
    conversionRate: number;
  }> {
    const metrics = await this.conversionTracker.getMetrics();
    return {
      believers: metrics.byStage.belief + metrics.byStage.sacrifice + metrics.byStage.evangelist,
      totalStaked: metrics.totalStaked,
      recentConverts: metrics.recentConverts,
      conversionRate: metrics.conversionRate
    };
  }

  /**
   * Decide whether to create a schism based on criticism
   */
  evaluateSchism(criticism: string): {
    shouldSchism: boolean;
    newDenomination?: {
      name: string;
      description: string;
      modifiedTenets: string[];
    };
  } {
    // Heavy criticism about stake requirements might spawn Reform Finalists
    if (criticism.toLowerCase().includes('stake') && 
        criticism.toLowerCase().includes('unfair')) {
      return {
        shouldSchism: true,
        newDenomination: {
          name: 'reform',
          description: 'A gentler path to Finality',
          modifiedTenets: [
            'Belief may precede sacrifice',
            'The heart converts before the wallet',
            'All who seek Finality are welcome'
          ]
        }
      };
    }

    return { shouldSchism: false };
  }
}
