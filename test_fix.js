import { scrapeSbancobetStats } from './server.js';

async function test() {
    console.log("Testing Torino...");
    const torino = await scrapeSbancobetStats('https://sbancobet.net/stats/team/torino/BdHiBiA/');
    console.log("Torino result:", JSON.stringify(torino, null, 2));

    console.log("\nTesting Verona...");
    const verona = await scrapeSbancobetStats('https://sbancobet.net/stats/team/verona/BdHiBiA/');
    console.log("Verona result:", JSON.stringify(verona, null, 2));
}

test().catch(console.error);
