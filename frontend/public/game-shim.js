(function () {
  'use strict';

  var balance = '0.00';
  var currency = 'USD';
  var listeners = {};

  function on(event, cb) {
    listeners[event] = cb;
  }

  function emit(event, data) {
    if (typeof listeners[event] === 'function') {
      listeners[event](data);
    }
  }

  function post(msg) {
    window.parent.postMessage(msg, '*');
  }

  function generateRoundId() {
    return 'round-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  }

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'BALANCE_UPDATE':
        balance = String(msg.balance);
        currency = String(msg.currency || 'USD');
        emit('balance', { balance: balance, currency: currency });
        break;
      case 'BET_CONFIRMED':
        balance = String(msg.balance);
        emit('bet:confirmed', { roundId: msg.roundId, balance: balance, transactionId: msg.transactionId });
        break;
      case 'WIN_CONFIRMED':
        balance = String(msg.balance);
        emit('win:confirmed', { roundId: msg.roundId, balance: balance });
        break;
      case 'REFUND_CONFIRMED':
        balance = String(msg.balance);
        emit('refund:confirmed', { roundId: msg.roundId, balance: balance });
        break;
      case 'ERROR':
        emit('error', { message: msg.message });
        break;
    }
  });

  window.GameBridge = {
    on: on,
    requestBalance: function () { post({ type: 'GET_BALANCE' }); },
    placeBet: function (amount) {
      var roundId = generateRoundId();
      post({ type: 'PLACE_BET', roundId: roundId, amount: String(amount) });
      return roundId;
    },
    reportWin: function (roundId, amount) {
      post({ type: 'GAME_WIN', roundId: roundId, amount: String(amount) });
    },
    refundRound: function (roundId, amount) {
      post({ type: 'REFUND_ROUND', roundId: roundId, amount: String(amount) });
    },
    exit: function () { post({ type: 'GAME_OVER' }); },
    getBalance: function () { return balance; },
    getCurrency: function () { return currency; },
  };

  post({ type: 'GET_BALANCE' });
  window.dispatchEvent(new CustomEvent('game:init', { detail: window.GameBridge }));
})();
