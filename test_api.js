const KEY = 'c2733b61762af557ae16223753a3b13c';
const URL = 'https://v3.football.api-sports.io/fixtures?live=all';

async function run() {
  try {
    const res = await fetch(URL, {
      headers: {
        'x-apisports-key': KEY
      }
    });
    const data = await res.json();
    console.log("Status:", res.status);
    console.log("Errors:", data.errors);
    console.log("Results Count:", data.results);
    if (data.response && data.response.length > 0) {
      // solo le prime chiavi
      console.log("Sample Match:", JSON.stringify(data.response[0].fixture, null, 2));
      console.log("Sample Score:", JSON.stringify(data.response[0].goals, null, 2));
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}
run();
