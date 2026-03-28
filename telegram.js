window.NovaTelegram = {
  init() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (!tg) return null;
    try {
      tg.ready();
      tg.expand();
      tg.setHeaderColor('#14083e');
      tg.setBackgroundColor('#09051d');
      return tg;
    } catch (err) {
      console.warn('Telegram WebApp init failed', err);
      return null;
    }
  }
};
