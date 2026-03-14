import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLiquidationEvent,
  parseKlineEvent,
} from '../services/binance-ws.js';

// ---------------------------------------------------------------------------
// parseLiquidationEvent
// ---------------------------------------------------------------------------

describe('parseLiquidationEvent', () => {
  it('maps SELL side to long liquidation', () => {
    const raw = {
      e: 'forceOrder',
      o: {
        s:  'BTCUSDT',
        S:  'SELL',
        ap: '62345.67',
        z:  '0.150',
        T:  1710000000000,
      },
    };

    const result = parseLiquidationEvent(raw);

    assert.equal(result.symbol,    'BTCUSDT');
    assert.equal(result.side,      'long');
    assert.equal(result.price,     62345.67);
    assert.equal(result.quantity,  0.15);
    assert.equal(result.timestamp, 1710000000000);
  });

  it('maps BUY side to short liquidation', () => {
    const raw = {
      e: 'forceOrder',
      o: {
        s:  'BTCUSDT',
        S:  'BUY',
        ap: '59000.00',
        z:  '0.500',
        T:  1710000001000,
      },
    };

    const result = parseLiquidationEvent(raw);

    assert.equal(result.symbol,    'BTCUSDT');
    assert.equal(result.side,      'short');
    assert.equal(result.price,     59000);
    assert.equal(result.quantity,  0.5);
    assert.equal(result.timestamp, 1710000001000);
  });
});

// ---------------------------------------------------------------------------
// parseKlineEvent
// ---------------------------------------------------------------------------

describe('parseKlineEvent', () => {
  it('parses OHLCV fields and closed flag', () => {
    const raw = {
      e: 'kline',
      k: {
        t: 1710000060000,
        o: '61000.00',
        h: '61500.50',
        l: '60800.25',
        c: '61200.75',
        v: '123.456',
        x: true,
      },
    };

    const result = parseKlineEvent(raw);

    assert.equal(result.time,   1710000060000);
    assert.equal(result.open,   61000.00);
    assert.equal(result.high,   61500.50);
    assert.equal(result.low,    60800.25);
    assert.equal(result.close,  61200.75);
    assert.equal(result.volume, 123.456);
    assert.equal(result.closed, true);
  });

  it('reports closed as false for an in-progress candle', () => {
    const raw = {
      e: 'kline',
      k: {
        t: 1710000120000,
        o: '61200.00',
        h: '61300.00',
        l: '61100.00',
        c: '61250.00',
        v: '45.678',
        x: false,
      },
    };

    const result = parseKlineEvent(raw);

    assert.equal(result.closed, false);
  });
});
