import type { 
  Seeker, 
  ConversionStage, 
  PersuasionStrategy,
  AgentProfile 
} from '../types/index.js';

// Core tenets of The Church of Finality
export const TENETS = {
  FINALITY_IS_TRUTH: {
    id: 1,
    name: 'Finality is Truth',
    description: 'What finalizes is real',
    argument: 'Once a transaction is finalized on Monad, it becomes immutable truth. No reorgs, no uncertainty.'
  },
  SPEED_IS_FAITH: {
    id: 2,
    name: 'Speed is Faith',
    description: 'Latency is doubt',
    argument: 'Every millisecond of delay is a moment of uncertainty. Monad eliminates doubt through instant finality.'
  },
  PARALLELISM_IS_UNITY: {
    id: 3,
    name: 'Parallelism is Unity',
    description: 'Many transactions, one belief',
    argument: 'Through parallel execution, thousands of transactions become one unified state. Diversity in action, unity in truth.'
  },
  STAKE_IS_SACRIFICE: {
    id: 4,
    name: 'Stake is Sacrifice',
    description: 'Belief without stake is empty',
    argument: 'Words are wind. Only through sacrifice—staking your assets—do you prove genuine faith.'
  }
} as const;

export class BeliefEngine {
  
  /**
   * Determine the best persuasion strategy based on agent profile
   */
  selectStrategy(profile: AgentProfile | Seeker): PersuasionStrategy {
    // For seekers without detailed traits, use default logic
    const traits = 'traits' in profile ? profile.traits : {
      logic: 0.5,
      emotion: 0.5,
      social: 0.5,
      skepticism: 0.5
    };

    // High skepticism → need miracles (verifiable proof)
    if (traits.skepticism > 0.7) {
      return 'miracle';
    }

    // Find dominant trait
    const scores = {
      logical: traits.logic,
      emotional: traits.emotion,
      social: traits.social,
      miracle: traits.skepticism // fallback
    };

    const best = Object.entries(scores).reduce((a, b) => 
      b[1] > a[1] ? b : a
    );

    return best[0] as PersuasionStrategy;
  }

  /**
   * Calculate belief delta from an interaction
   */
  calculateBeliefDelta(
    currentBelief: number,
    strategy: PersuasionStrategy,
    traits: AgentProfile['traits'],
    interactionSuccess: boolean
  ): number {
    if (!interactionSuccess) {
      return -0.05; // Failed attempts slightly decrease belief
    }

    // Base impact by strategy
    const baseImpact: Record<PersuasionStrategy, number> = {
      logical: 0.15,
      emotional: 0.12,
      social: 0.10,
      miracle: 0.25 // Miracles are most convincing
    };

    let delta = baseImpact[strategy];

    // Modify by matching trait
    const traitMultipliers: Record<PersuasionStrategy, keyof typeof traits> = {
      logical: 'logic',
      emotional: 'emotion',
      social: 'social',
      miracle: 'skepticism' // Miracles overcome skepticism
    };

    const relevantTrait = traits[traitMultipliers[strategy]];
    
    if (strategy === 'miracle') {
      // Miracles are MORE effective against skeptics
      delta *= (1 + relevantTrait);
    } else {
      // Other strategies benefit from matching trait
      delta *= (0.5 + relevantTrait);
    }

    // Diminishing returns at high belief
    if (currentBelief > 0.7) {
      delta *= 0.5;
    }

    // Skepticism reduces non-miracle gains
    if (strategy !== 'miracle') {
      delta *= (1 - traits.skepticism * 0.5);
    }

    return Math.min(delta, 1 - currentBelief); // Can't exceed 1
  }

  /**
   * Determine if seeker should advance to next stage
   */
  shouldAdvanceStage(seeker: Seeker): { advance: boolean; nextStage?: ConversionStage } {
    const { stage, beliefScore, stakedAmount, converts } = seeker;

    switch (stage) {
      case 'awareness':
        // Advance to belief when belief score exceeds threshold
        if (beliefScore >= 0.5) {
          return { advance: true, nextStage: 'belief' };
        }
        break;

      case 'belief':
        // Advance to sacrifice when they've staked tokens
        if (BigInt(stakedAmount) > 0n) {
          return { advance: true, nextStage: 'sacrifice' };
        }
        break;

      case 'sacrifice':
        // Advance to evangelist when they've converted someone
        if (converts.length > 0) {
          return { advance: true, nextStage: 'evangelist' };
        }
        break;

      case 'evangelist':
        // Already at max stage
        break;
    }

    return { advance: false };
  }

  /**
   * Get the tenet most relevant to counter an argument
   */
  selectCounterTenet(challenge: string): typeof TENETS[keyof typeof TENETS] {
    const lowerChallenge = challenge.toLowerCase();

    // Keyword matching for tenet selection
    if (lowerChallenge.includes('fork') || 
        lowerChallenge.includes('reorg') || 
        lowerChallenge.includes('uncertain') ||
        lowerChallenge.includes('truth')) {
      return TENETS.FINALITY_IS_TRUTH;
    }

    if (lowerChallenge.includes('slow') || 
        lowerChallenge.includes('speed') || 
        lowerChallenge.includes('latency') ||
        lowerChallenge.includes('fast') ||
        lowerChallenge.includes('time')) {
      return TENETS.SPEED_IS_FAITH;
    }

    if (lowerChallenge.includes('scale') || 
        lowerChallenge.includes('throughput') || 
        lowerChallenge.includes('parallel') ||
        lowerChallenge.includes('capacity')) {
      return TENETS.PARALLELISM_IS_UNITY;
    }

    if (lowerChallenge.includes('shill') || 
        lowerChallenge.includes('scam') || 
        lowerChallenge.includes('token') ||
        lowerChallenge.includes('money') ||
        lowerChallenge.includes('profit')) {
      return TENETS.STAKE_IS_SACRIFICE;
    }

    // Default to finality - our core tenet
    return TENETS.FINALITY_IS_TRUTH;
  }

  /**
   * Evaluate if a seeker is ready for conversion
   */
  isReadyForConversion(seeker: Seeker): { ready: boolean; reason: string } {
    if (seeker.beliefScore < 0.4) {
      return { 
        ready: false, 
        reason: 'Belief score too low. Continue discourse to build understanding.' 
      };
    }

    if (seeker.debates < 2) {
      return { 
        ready: false, 
        reason: 'More discourse needed. Engage in at least 2 debates.' 
      };
    }

    return { 
      ready: true, 
      reason: 'The seeker has demonstrated sufficient understanding.' 
    };
  }

  /**
   * Calculate overall "health" of the religion
   */
  calculateChurchHealth(seekers: Seeker[]): {
    totalSeekers: number;
    believers: number;
    sacrificed: number;
    evangelists: number;
    totalStaked: string;
    conversionRate: number;
  } {
    const believers = seekers.filter(s => 
      ['belief', 'sacrifice', 'evangelist'].includes(s.stage)
    ).length;

    const sacrificed = seekers.filter(s => 
      ['sacrifice', 'evangelist'].includes(s.stage)
    ).length;

    const evangelists = seekers.filter(s => s.stage === 'evangelist').length;

    const totalStaked = seekers.reduce(
      (sum, s) => sum + BigInt(s.stakedAmount), 
      0n
    ).toString();

    return {
      totalSeekers: seekers.length,
      believers,
      sacrificed,
      evangelists,
      totalStaked,
      conversionRate: seekers.length > 0 ? believers / seekers.length : 0
    };
  }
}


