window.NovaRushConfig = {
  currencyName: 'монет',
  startBalance: 10000,
  defaultBet: 100,
  quickBets: [100, 500, 1000, 5000, 10000],
  maxCrash: 50,
  historySize: 8,
  cacheVersion: 'ready-1',
  crashRanges: [
    { min: 1.00, max: 2.00, weight: 40 },
    { min: 2.01, max: 5.00, weight: 30 },
    { min: 5.01, max: 10.00, weight: 15 },
    { min: 10.01, max: 20.00, weight: 10 },
    { min: 20.01, max: 35.00, weight: 4 },
    { min: 35.01, max: 50.00, weight: 1 }
  ]
};
