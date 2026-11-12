// `npm run test:browser`: the both-plugins scenario of the paired matrix, on both
// hosts and both load orders. `npm run test:saved` runs every scenario.
process.env.SAVED_SCENARIOS ||= 'both';
await import('./saved-browser.mjs');
