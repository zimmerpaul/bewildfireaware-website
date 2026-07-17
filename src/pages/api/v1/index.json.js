// Public API v1: discovery document.
export function GET() {
  return new Response(JSON.stringify({
    name: 'BeWildfireAware public data API',
    version: 1,
    endpoints: {
      fireDanger: 'https://bewildfireaware.com/api/v1/fire-danger.json',
      boundaries: 'https://bewildfireaware.com/api/v1/fdra-boundaries.json',
    },
    updateSchedule: 'fire-danger.json regenerates daily around 03:20 America/Denver, shortly after NFDRS data publishes (~03:11); boundaries change rarely',
    coverage: 'Nine Fire Danger Rating Areas across the Grand Junction, Montrose, and Durango interagency dispatch areas, Western Colorado',
    docs: 'https://bewildfireaware.com/data-sources.html#api',
    contact: 'gunnisonbc71@gmail.com',
  }, null, 1), { headers: { 'Content-Type': 'application/json' } });
}
