import { searchSbancobetTeam, scrapeSbancobetStats } from './server.js';

async function test() {
  const leagueUrl = 'https://sbancobet.net/stats/league/serie-a/BdF/';
  const teamName = 'Inter';

  console.log(`--- TESTING SBANCOBET SCRAPER ---`);
  console.log(`Target: ${teamName} in Serie A`);

  try {
    const teamUrl = await searchSbancobetTeam(teamName, leagueUrl);
    if (!teamUrl) {
      console.log('❌ Team URL not found.');
      return;
    }
    console.log(`✅ Found Team URL: ${teamUrl}`);

    const stats = await scrapeSbancobetStats(teamUrl);
    if (!stats) {
      console.log('❌ Failed to scrape stats.');
      return;
    }
    console.log('✅ Scraped Stats:', JSON.stringify(stats, null, 2));

  } catch (err) {
    console.error('💥 TEST FAILED:', err);
  }
}

test();
