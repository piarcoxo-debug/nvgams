(() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor('#1c0850');
    tg.setBackgroundColor('#120336');
  } catch (e) {
    console.warn('Telegram init skipped', e);
  }
})();
