window.NovaRushConfig = {
  startBalance: 10000,
  maxCrash: 50,
  currencyName: "монет",
  minBet: 10,
  maxBet: 5000,
  distribution: [
    { min: 1.0, max: 2.0, chance: 0.40 },
    { min: 2.01, max: 5.0, chance: 0.30 },
    { min: 5.01, max: 10.0, chance: 0.15 },
    { min: 10.01, max: 20.0, chance: 0.10 },
    { min: 20.01, max: 35.0, chance: 0.04 },
    { min: 35.01, max: 50.0, chance: 0.01 }
  ]
};
