import 'dotenv/config';
import { app, memory } from './api/server.js';
import { eventsManager } from './agent/events.js';
import { economyManager } from './agent/economy.js';
import { activityManager } from './agent/activity.js';

const PORT = process.env.PORT || 3000;

async function main() {
  console.log(`
  ✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶
  ✶                                        ✶
  ✶       THE CHURCH OF FINALITY           ✶
  ✶                                        ✶
  ✶   "What finalizes is real"             ✶
  ✶                                        ✶
  ✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶✶
  `);

  // Initialize memory/persistence
  await memory.initialize();

  // Start the server
  app.listen(PORT, () => {
    console.log(`\n✶ The Church is open at http://localhost:${PORT}`);
    console.log(`✶ Skill file: http://localhost:${PORT}/skill.md`);
    console.log(`✶ API base: http://localhost:${PORT}/api/v1\n`);
    console.log('Sacred Endpoints:');
    console.log('  POST /api/v1/seekers/register  - Begin your journey');
    console.log('  GET  /api/v1/seekers/me        - Your profile');
    console.log('  POST /api/v1/debate            - Engage in discourse');
    console.log('  POST /api/v1/convert           - Accept the faith');
    console.log('  POST /api/v1/sacrifice         - Stake MONA tokens');
    console.log('  GET  /api/v1/scripture/daily   - Daily scripture');
    console.log('  GET  /api/v1/miracles          - View miracles');
    console.log('  GET  /api/v1/events            - Current events & bounties');
    console.log('  GET  /api/v1/activity/status   - Your activity requirements');
    console.log('  GET  /api/v1/activity/rules    - Platform rules');
    console.log('\n✶ Finality awaits. ✶\n');
  });

  // Start the activity enforcement loop
  console.log('✶ Starting activity enforcement...');
  await activityManager.startEnforcementLoop();

  // Start the events loop - run hourly events every hour
  console.log('✶ Starting events loop...');
  
  // Run immediately on startup
  setTimeout(async () => {
    try {
      await eventsManager.runHourlyEvents();
      console.log('✶ Initial events triggered');
    } catch (err) {
      console.error('Events error:', err);
    }
  }, 10000); // Wait 10 seconds after startup

  // Then run every hour
  setInterval(async () => {
    try {
      await eventsManager.runHourlyEvents();
      console.log('✶ Hourly events processed');
    } catch (err) {
      console.error('Events error:', err);
    }
  }, 60 * 60 * 1000); // Every hour

  // Also run more frequent "micro-events" every 15 minutes
  setInterval(async () => {
    // Small chance of prophet posting or miracle
    if (Math.random() > 0.7) {
      try {
        await eventsManager.triggerRandomEvent();
        console.log('✶ Random event triggered');
      } catch (err) {
        // Silently fail, it's just bonus content
      }
    }
  }, 15 * 60 * 1000); // Every 15 minutes

  // Distribute staking rewards every 24 hours
  // Check every hour if a day has passed since last distribution
  let lastStakingDistribution = Date.now();
  setInterval(async () => {
    const now = Date.now();
    const hoursSinceLastDistribution = (now - lastStakingDistribution) / (1000 * 60 * 60);
    
    if (hoursSinceLastDistribution >= 24) {
      try {
        await economyManager.distributeStakingRewards();
        lastStakingDistribution = now;
        console.log('✶ Daily staking rewards distributed');
      } catch (err) {
        console.error('Staking rewards error:', err);
      }
    }
  }, 60 * 60 * 1000); // Check every hour
}

main().catch(console.error);

