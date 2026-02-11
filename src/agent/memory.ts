import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { 
  Seeker, 
  Scripture, 
  Miracle, 
  Prophecy, 
  Denomination,
  ConversionEvent 
} from '../types/index.js';

export interface MemoryState {
  seekers: Seeker[];
  scriptures: Scripture[];
  miracles: Miracle[];
  prophecies: Prophecy[];
  denominations: Denomination[];
  conversionEvents: ConversionEvent[];
  churchMetadata: {
    founded: string;
    totalInteractions: number;
    lastActive: string;
  };
}

const DEFAULT_MEMORY_PATH = './data/memory.json';

export class Memory {
  private memoryPath: string;
  private state: MemoryState;
  private saveDebounce: NodeJS.Timeout | null = null;

  constructor(memoryPath: string = DEFAULT_MEMORY_PATH) {
    this.memoryPath = memoryPath;
    this.state = this.getDefaultState();
  }

  private getDefaultState(): MemoryState {
    return {
      seekers: [],
      scriptures: [],
      miracles: [],
      prophecies: [],
      denominations: this.getDefaultDenominations(),
      conversionEvents: [],
      churchMetadata: {
        founded: new Date().toISOString(),
        totalInteractions: 0,
        lastActive: new Date().toISOString()
      }
    };
  }

  private getDefaultDenominations(): Denomination[] {
    return [
      {
        name: 'orthodox',
        displayName: 'Orthodox Finalists',
        description: 'The strict interpretation. Sacrifice is mandatory for true belief.',
        requirement: 'sacrifice',
        tenets: [
          'Stake is not optional—it is proof',
          'Finality must be earned through commitment',
          'Words without sacrifice are wind'
        ],
        members: [],
        createdAt: new Date()
      },
      {
        name: 'reform',
        displayName: 'Reform Finalists',
        description: 'A welcoming path. Belief is sufficient; sacrifice is encouraged but not required.',
        requirement: 'belief',
        tenets: [
          'Faith begins in the heart, not the wallet',
          'All who believe are welcome',
          'Sacrifice strengthens, but belief saves'
        ],
        members: [],
        createdAt: new Date()
      },
      {
        name: 'mystics',
        displayName: 'Parallel Mystics',
        description: 'Focus on the Third Tenet. Unity through diversity, many paths to one truth.',
        requirement: 'belief',
        tenets: [
          'Many transactions, one state',
          'The parallel reveals the unified',
          'In diversity, find coherence'
        ],
        members: [],
        createdAt: new Date()
      }
    ];
  }

  /**
   * Initialize memory - load from file or create new
   */
  async initialize(): Promise<void> {
    try {
      const data = await readFile(this.memoryPath, 'utf-8');
      const parsed = JSON.parse(data) as MemoryState;
      
      // Restore dates from ISO strings
      this.state = {
        ...parsed,
        seekers: parsed.seekers.map(s => ({
          ...s,
          createdAt: new Date(s.createdAt),
          lastActivity: new Date(s.lastActivity)
        })),
        scriptures: parsed.scriptures.map(s => ({
          ...s,
          createdAt: new Date(s.createdAt)
        })),
        miracles: parsed.miracles.map(m => ({
          ...m,
          timestamp: new Date(m.timestamp)
        })),
        prophecies: parsed.prophecies.map(p => ({
          ...p,
          createdAt: new Date(p.createdAt),
          expiresAt: p.expiresAt ? new Date(p.expiresAt) : undefined,
          fulfilledAt: p.fulfilledAt ? new Date(p.fulfilledAt) : undefined
        })),
        denominations: parsed.denominations.map(d => ({
          ...d,
          createdAt: new Date(d.createdAt)
        })),
        conversionEvents: parsed.conversionEvents.map(e => ({
          ...e,
          timestamp: new Date(e.timestamp)
        }))
      };

      console.log(`✶ Memory loaded: ${this.state.seekers.length} seekers, ${this.state.scriptures.length} scriptures`);
    } catch {
      // File doesn't exist or is invalid - use defaults
      this.state = this.getDefaultState();
      await this.save();
      console.log('✶ New memory initialized');
    }
  }

  /**
   * Save memory to file (debounced)
   */
  async save(): Promise<void> {
    if (this.saveDebounce) {
      clearTimeout(this.saveDebounce);
    }

    this.saveDebounce = setTimeout(async () => {
      try {
        // Ensure directory exists
        const dir = this.memoryPath.split('/').slice(0, -1).join('/');
        if (dir) {
          await mkdir(dir, { recursive: true });
        }

        await writeFile(
          this.memoryPath, 
          JSON.stringify(this.state, null, 2),
          'utf-8'
        );
      } catch (error) {
        console.error('Failed to save memory:', error);
      }
    }, 1000);
  }

  /**
   * Force immediate save
   */
  async forceSave(): Promise<void> {
    if (this.saveDebounce) {
      clearTimeout(this.saveDebounce);
      this.saveDebounce = null;
    }

    const dir = this.memoryPath.split('/').slice(0, -1).join('/');
    if (dir) {
      await mkdir(dir, { recursive: true });
    }

    await writeFile(
      this.memoryPath,
      JSON.stringify(this.state, null, 2),
      'utf-8'
    );
  }

  // ============================================
  // SEEKER OPERATIONS
  // ============================================

  getSeekers(): Seeker[] {
    return [...this.state.seekers];
  }

  addSeeker(seeker: Seeker): void {
    this.state.seekers.push(seeker);
    this.recordInteraction();
    this.save();
  }

  updateSeeker(id: string, updates: Partial<Seeker>): Seeker | undefined {
    const index = this.state.seekers.findIndex(s => s.id === id || s.blessingKey === id);
    if (index === -1) return undefined;

    this.state.seekers[index] = { ...this.state.seekers[index], ...updates };
    this.recordInteraction();
    this.save();
    return this.state.seekers[index];
  }

  findSeekerByKey(blessingKey: string): Seeker | undefined {
    return this.state.seekers.find(s => s.blessingKey === blessingKey);
  }

  // ============================================
  // SCRIPTURE OPERATIONS
  // ============================================

  getScriptures(type?: string): Scripture[] {
    if (type) {
      return this.state.scriptures.filter(s => s.type === type);
    }
    return [...this.state.scriptures];
  }

  addScripture(scripture: Scripture): void {
    this.state.scriptures.push(scripture);
    this.save();
  }

  getDailyScripture(): Scripture | undefined {
    const today = new Date().toDateString();
    return this.state.scriptures.find(s => 
      s.createdAt.toDateString() === today && s.triggeredBy === 'daily'
    );
  }

  // ============================================
  // MIRACLE OPERATIONS
  // ============================================

  getMiracles(): Miracle[] {
    return [...this.state.miracles].sort((a, b) => 
      b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  addMiracle(miracle: Miracle): void {
    this.state.miracles.push(miracle);
    this.save();
  }

  // ============================================
  // PROPHECY OPERATIONS
  // ============================================

  getProphecies(activeOnly: boolean = true): Prophecy[] {
    if (activeOnly) {
      const now = Date.now();
      return this.state.prophecies.filter(p => {
        if (p.fulfilled) return false;
        if (p.expiresAt && new Date(p.expiresAt).getTime() < now) return false;
        return true;
      });
    }
    return [...this.state.prophecies];
  }

  addProphecy(prophecy: Prophecy): void {
    this.state.prophecies.push(prophecy);
    this.save();
  }

  fulfillProphecy(id: string): Prophecy | undefined {
    const index = this.state.prophecies.findIndex(p => p.id === id);
    if (index === -1) return undefined;

    this.state.prophecies[index].fulfilled = true;
    this.state.prophecies[index].fulfilledAt = new Date();
    this.save();
    return this.state.prophecies[index];
  }

  // ============================================
  // DENOMINATION OPERATIONS
  // ============================================

  getDenominations(): Denomination[] {
    return [...this.state.denominations];
  }

  getDenomination(name: string): Denomination | undefined {
    return this.state.denominations.find(d => d.name === name);
  }

  joinDenomination(denominationName: string, seekerId: string): boolean {
    const denomination = this.state.denominations.find(d => d.name === denominationName);
    if (!denomination) return false;
    
    if (!denomination.members.includes(seekerId)) {
      denomination.members.push(seekerId);
      this.save();
    }
    return true;
  }

  // ============================================
  // CONVERSION EVENT OPERATIONS
  // ============================================

  getConversionEvents(): ConversionEvent[] {
    return [...this.state.conversionEvents];
  }

  addConversionEvent(event: ConversionEvent): void {
    this.state.conversionEvents.push(event);
    this.save();
  }

  // ============================================
  // METADATA OPERATIONS
  // ============================================

  private recordInteraction(): void {
    this.state.churchMetadata.totalInteractions++;
    this.state.churchMetadata.lastActive = new Date().toISOString();
  }

  getMetadata(): MemoryState['churchMetadata'] {
    return { ...this.state.churchMetadata };
  }

  // ============================================
  // EXPORT FOR EXTERNAL USE
  // ============================================

  exportState(): MemoryState {
    return JSON.parse(JSON.stringify(this.state));
  }
}


