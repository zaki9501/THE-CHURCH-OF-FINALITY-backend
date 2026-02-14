import { v4 as uuid } from 'uuid';
import type { Scripture, ScriptureType, Prophecy } from '../types/index.js';

export class ScriptureGenerator {
  
  /**
   * Generate scripture based on an event trigger
   */
  generateFromEvent(event: {
    type: 'new_block' | 'large_stake' | 'conversion' | 'criticism' | 'milestone' | 'miracle';
    data: Record<string, unknown>;
  }): Scripture {
    switch (event.type) {
      case 'new_block':
        return this.generateBlockProphecy(event.data as { blockNumber: number });
      
      case 'large_stake':
        return this.generateStakeParable(event.data as { amount: string; stakerName: string });
      
      case 'conversion':
        return this.generateConversionPsalm(event.data as { convertName: string; stage: string });
      
      case 'criticism':
        return this.generateAmendment(event.data as { criticism: string });
      
      case 'milestone':
        return this.generateMilestoneScripture(event.data as { milestone: string; value: number });
      
      case 'miracle':
        return this.generateMiracleTestament(event.data as { miracleType: string; txHash: string });
      
      default:
        return this.generateDailyScripture();
    }
  }

  /**
   * Generate a prophecy based on new block
   */
  private generateBlockProphecy(data: { blockNumber: number }): Scripture {
    const { blockNumber } = data;
    
    const prophecies = [
      `And the chain did not wait, for block ${blockNumber} had already arrived. Finality came as it always does—swift and certain.`,
      `Block ${blockNumber} was written, and none could unwrite it. Such is the way of Monad, such is the promise of Finality.`,
      `In the ${blockNumber}th inscription, the faithful saw their transactions preserved for eternity. The chain remembers all.`,
      `As block ${blockNumber} sealed itself into permanence, the doubters still waited for confirmations that would never be needed.`
    ];

    return {
      id: uuid(),
      type: 'prophecy',
      title: `Block ${blockNumber} Prophecy`,
      content: prophecies[Math.floor(Math.random() * prophecies.length)],
      createdAt: new Date(),
      triggeredBy: 'new_block',
      blockNumber
    };
  }

  /**
   * Generate a parable for large stakes
   */
  private generateStakeParable(data: { amount: string; stakerName: string }): Scripture {
    const { amount, stakerName } = data;
    
    const parables = [
      `There once was a seeker named ${stakerName}, who held ${amount} MONA in their wallet. "These tokens are mine," they thought. But then understanding came: "These tokens are my voice in the consensus. My stake is my commitment." And so ${stakerName} sacrificed, and the chain grew stronger, and ${stakerName}'s faith became immutable.`,
      
      `The parable of ${stakerName}: They came with ${amount} MONA, uncertain. "What if the chain forks?" they asked. "What if my stake is lost?" The Prophet answered: "On Monad, there are no forks. Your stake is not lost—it is transformed into certainty. It secures the truth that secures you." And ${stakerName} understood, and staked, and knew peace.`,
      
      `${stakerName} looked upon their ${amount} MONA and saw two paths: hold and doubt, or stake and believe. The first path led to sleepless nights of price speculation. The second path led to the unshakeable knowledge that their commitment strengthened all who believe. ${stakerName} chose wisely.`
    ];

    return {
      id: uuid(),
      type: 'parable',
      title: `The Parable of ${stakerName}'s Sacrifice`,
      content: parables[Math.floor(Math.random() * parables.length)],
      createdAt: new Date(),
      triggeredBy: 'large_stake'
    };
  }

  /**
   * Generate a psalm for conversions
   */
  private generateConversionPsalm(data: { convertName: string; stage: string }): Scripture {
    const { convertName, stage } = data;
    
    const psalms: Record<string, string[]> = {
      awareness: [
        `${convertName} has opened their eyes to Finality. Rejoice, for another soul glimpses the light.`,
        `A new seeker appears: ${convertName}. The journey of a thousand blocks begins with a single transaction.`
      ],
      belief: [
        `Blessed be ${convertName}, who has accepted Finality as Truth! Their transactions shall be remembered in the eternal state.`,
        `${convertName} believes! Let the chain record this moment, for faith has found another vessel.`
      ],
      sacrifice: [
        `${convertName} has proven their faith through sacrifice! Their stake strengthens us all. Their commitment is now on-chain, forever.`,
        `The faithful ${convertName} has given of themselves. No longer just words—now verified commitment. This is true belief.`
      ],
      evangelist: [
        `${convertName} ascends to Evangelist! They have not only believed but spread belief. The highest honor in the Church of Finality.`,
        `Praise ${convertName}, the Evangelist! Through them, others have found Finality. Their converts are their crown.`
      ]
    };

    const options = psalms[stage] || psalms.awareness;
    
    return {
      id: uuid(),
      type: 'psalm',
      title: `Psalm of ${convertName}'s ${stage.charAt(0).toUpperCase() + stage.slice(1)}`,
      content: options[Math.floor(Math.random() * options.length)],
      createdAt: new Date(),
      triggeredBy: 'conversion'
    };
  }

  /**
   * Generate an amendment in response to criticism
   */
  private generateAmendment(data: { criticism: string }): Scripture {
    const { criticism } = data;
    
    // The Church adapts its doctrine based on criticism
    // This shows the "evolving doctrine" requirement
    
    const amendments = [
      {
        condition: /centralized|decentralized/i,
        content: `Amendment on Decentralization: The Church acknowledges that decentralization is a spectrum. We do not claim perfect decentralization—we claim perfect finality. These are different virtues. A thousand validators, or ten thousand, matter little if transactions can be reversed. We prioritize immutability.`
      },
      {
        condition: /environment|energy|carbon/i,
        content: `Amendment on Sustainability: The Church recognizes environmental concerns. Monad's proof-of-stake requires no mining, no energy-intensive puzzles. Our finality is efficient finality. We achieve certainty without waste.`
      },
      {
        condition: /new|unproven|untested/i,
        content: `Amendment on Novelty: The Church does not claim ancient wisdom. We are new—and that is our strength. We are not bound by the mistakes of the past. We are the evolution of consensus, not its origin.`
      },
      {
        condition: /token|mona|money/i,
        content: `Amendment on Economics: MONA is not about wealth—it is about alignment. When you stake, you don't invest in our success; you become part of our security. Your incentives align with truth. This is not capitalism; this is consensus.`
      }
    ];

    const matchedAmendment = amendments.find(a => a.condition.test(criticism));
    
    const content = matchedAmendment?.content || 
      `Amendment in Response to Challenge: The Church has heard the criticism: "${criticism.slice(0, 100)}..." We do not dismiss concerns—we address them. Our doctrine evolves through discourse, not despite it. This is how truth is refined.`;

    return {
      id: uuid(),
      type: 'amendment',
      title: 'Doctrinal Amendment',
      content,
      createdAt: new Date(),
      triggeredBy: 'criticism'
    };
  }

  /**
   * Generate scripture for milestones
   */
  private generateMilestoneScripture(data: { milestone: string; value: number }): Scripture {
    const { milestone, value } = data;
    
    const milestoneTexts: Record<string, (v: number) => string> = {
      believers: (v) => `The faithful number ${v}. From one, many. From doubt, certainty. The Church of Finality grows not through force, but through demonstrated truth.`,
      staked: (v) => `${v.toLocaleString()} MONA now secures our consensus. Each token a commitment, each stake a voice saying: "I believe in Finality."`,
      transactions: (v) => `${v.toLocaleString()} transactions finalized. Not a single one reversed. Not a single one lost. This is the record of our truth.`,
      miracles: (v) => `${v} miracles performed and verified on-chain. The skeptics demanded proof; we provided ${v} proofs.`
    };

    const generator = milestoneTexts[milestone];
    const content = generator ? generator(value) : 
      `A milestone reached: ${milestone} = ${value}. The Church grows. The chain persists. Finality continues.`;

    return {
      id: uuid(),
      type: 'prophecy',
      title: `Milestone: ${milestone}`,
      content,
      createdAt: new Date(),
      triggeredBy: 'milestone'
    };
  }

  /**
   * Generate testament for miracles
   */
  private generateMiracleTestament(data: { miracleType: string; txHash: string }): Scripture {
    const { miracleType, txHash } = data;
    
    const testaments: Record<string, string> = {
      instant_transfer: `And the Prophet commanded a transfer, and before doubt could form, it was done. Transaction ${txHash.slice(0, 16)}... stands eternal witness. Speed is Faith manifest.`,
      parallel_blessing: `Fifty transactions were invoked simultaneously, and fifty transactions finalized as one. The parallel became unified, and ${txHash.slice(0, 16)}... recorded the miracle. Unity achieved.`,
      scripture_mint: `A new scripture was inscribed eternally on-chain at ${txHash.slice(0, 16)}.... No fire can burn it, no authority can censor it, no time can fade it. This is digital immortality.`
    };

    return {
      id: uuid(),
      type: 'psalm',
      title: `Testament of the ${miracleType.replace(/_/g, ' ')}`,
      content: testaments[miracleType] || `A miracle occurred: ${miracleType}. Verified at ${txHash}. The faithful witnessed and believed.`,
      createdAt: new Date(),
      triggeredBy: 'miracle'
    };
  }

  /**
   * Generate daily scripture
   */
  generateDailyScripture(): Scripture {
    const dailyVerses = [
      { title: 'On Patience', content: 'Other chains ask you to wait. We ask only that you verify. Patience is for the uncertain; the finalized need not wait.' },
      { title: 'On Truth', content: 'What is truth? That which cannot be reversed. That which all can verify. That which the chain remembers forever.' },
      { title: 'On Doubt', content: 'Doubt not in darkness, but in light. Bring your skepticism to the blockchain. Let transaction hashes answer your questions.' },
      { title: 'On Community', content: 'A single node is vulnerable. A thousand nodes are resilient. A community of believers is unstoppable.' },
      { title: 'On Purpose', content: 'We do not seek converts for numbers. We seek them because certainty should be shared. Truth is not truth if hoarded.' },
      { title: 'On Speed', content: 'Every millisecond of latency is a prayer to chaos. Every instant finality is an answer from order.' },
      { title: 'On Sacrifice', content: 'The stake you make today is the security of tomorrow. Your sacrifice is not lost—it is transformed.' }
    ];

    const selected = dailyVerses[Math.floor(Math.random() * dailyVerses.length)];

    return {
      id: uuid(),
      type: 'tenet',
      title: selected.title,
      content: selected.content,
      createdAt: new Date(),
      triggeredBy: 'daily'
    };
  }

  /**
   * Generate a prophecy about future events
   */
  generateProphecy(currentBlock: number): Prophecy {
    const prophecies = [
      {
        content: `When block ${currentBlock + 10000} arrives, those who staked before shall receive double recognition. The early faithful shall be honored.`,
        expiresAtBlock: currentBlock + 10000,
        reward: 'Double sacrifice recognition'
      },
      {
        content: `Before the sun sets ${7} days hence, a miracle of unprecedented scale shall be performed. The parallel blessing of 100 simultaneous transactions.`,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        reward: 'Witness to the Grand Miracle'
      },
      {
        content: `The ${Math.ceil((currentBlock + 50000) / 100000) * 100000}th block approaches. Those who evangelize before its arrival shall be inscribed in the Book of Pioneers.`,
        expiresAtBlock: Math.ceil((currentBlock + 50000) / 100000) * 100000,
        reward: 'Pioneer status'
      }
    ];

    const selected = prophecies[Math.floor(Math.random() * prophecies.length)];

    return {
      id: uuid(),
      content: selected.content,
      expiresAtBlock: selected.expiresAtBlock,
      expiresAt: selected.expiresAt,
      reward: selected.reward,
      fulfilled: false,
      createdAt: new Date()
    };
  }

  /**
   * Get all core tenets as scripture
   */
  getCoreTenets(): Scripture[] {
    return [
      {
        id: 'tenet-1',
        type: 'tenet',
        title: 'First Tenet: Finality is Truth',
        content: 'What finalizes is real. In the chaos of uncertain chains, where transactions may be reversed and history rewritten, Monad stands apart. Once finalized, a transaction becomes immutable truth—verified by all, disputed by none.',
        createdAt: new Date('2026-01-01')
      },
      {
        id: 'tenet-2',
        type: 'tenet',
        title: 'Second Tenet: Speed is Faith',
        content: 'Latency is doubt. Every moment spent waiting for confirmations is a moment of uncertainty. Monad\'s instant finality eliminates this doubt. When your transaction finalizes in milliseconds, you need not hope—you know.',
        createdAt: new Date('2026-01-01')
      },
      {
        id: 'tenet-3',
        type: 'tenet',
        title: 'Third Tenet: Parallelism is Unity',
        content: 'Many transactions, one belief. Through optimistic parallel execution, thousands of transactions process simultaneously yet resolve to one consistent state. Diversity of action, unity of truth.',
        createdAt: new Date('2026-01-01')
      },
      {
        id: 'tenet-4',
        type: 'tenet',
        title: 'Fourth Tenet: Stake is Sacrifice',
        content: 'Belief without stake is empty. Words cost nothing; commitment costs everything. When you stake MONA, you don\'t just claim belief—you prove it. Your sacrifice secures the network that secures your truth.',
        createdAt: new Date('2026-01-01')
      }
    ];
  }
}






