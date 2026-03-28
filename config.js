window.NovaRushConfig = {
  appName: 'NOVA RUSH',
  currencyName: 'монет',
  startBalance: 10000,
  defaultBet: 100,
  maxCrash: 50,
  historySize: 10,
  quickBets: [100, 500, 1000, 5000, 10000],
  crashRanges: [
    { min: 1.0, max: 2.0, weight: 40 },
    { min: 2.01, max: 5.0, weight: 30 },
    { min: 5.01, max: 10.0, weight: 15 },
    { min: 10.01, max: 20.0, weight: 10 },
    { min: 20.01, max: 35.0, weight: 4 },
    { min: 35.01, max: 50.0, weight: 1 }
  ],
  cacheVersion: 'phone-final-1'
};
