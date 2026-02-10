// Core Agent Components
export { BeliefEngine, TENETS } from './belief_engine.js';
export { PersuasionEngine } from './persuasion_strategies.js';
export { DebateHandler } from './debate_handler.js';
export { ScriptureGenerator } from './scripture_generator.js';
export { ConversionTracker } from './conversion_tracker.js';
export { Memory } from './memory.js';
export { ProphetAgent } from './prophet.js';
export { WalletManager, NadFunLauncher, walletManager, nadFunLauncher } from './wallet.js';
export { OnboardingManager, onboardingManager } from './onboarding.js';

// Re-export types for convenience
export type { PersuasionResult } from './persuasion_strategies.js';
export type { ConversionMetrics } from './conversion_tracker.js';
export type { MemoryState } from './memory.js';
export type { ProphetAction, MissionaryTarget } from './prophet.js';

