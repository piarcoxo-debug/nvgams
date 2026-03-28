window.NOVA_CONFIG = {
  currencyName: 'монет',
  startBalance: 10000,
  defaultBet: 100,
  minBet: 10,
  maxBet: 1000000,
  maxCrash: 50,
  historySize: 6,
  storageKey: 'novarush_final_state',
  crashDistribution: [
    { chance: 40, min: 1.0, max: 2.0 },
    { chance: 30, min: 2.01, max: 5.0 },
    { chance: 15, min: 5.01, max: 10.0 },
    { chance: 10, min: 10.01, max: 20.0 },
    { chance: 4, min: 20.01, max: 35.0 },
    { chance: 1, min: 35.01, max: 50.0 }
  ],
  minRoundDurationMs: 850,
  maxRoundDurationMs: 5200,
  postCrashResetMs: 700,
  postCashoutResetMs: 500
};
