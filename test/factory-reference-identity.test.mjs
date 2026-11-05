import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkedOperation0 as run } from '../src/engineering-code-contracts.mjs';
import { Game } from '../src/game.mjs';
import { createWeiqiGameEngine } from '../src/replay.mjs';
import { createWeiqiGameSession } from '../src/session.mjs';

const config = { size: 9, ruleset: 'chinese' };
const commands = ['C3', 'G7', 'D3', 'F7', 'E3', 'F6'].map(move => ({kind:'play', move}));
const input = () => ({arguments:[config], calls:[
  {method:'initialPosition', arguments:[]},
  ...commands.map((command, index) => ({method:'extend', arguments:[null, command],
    references:[{argument:0, result:index, path:index ? ['state'] : []}]})),
]});

test('the generated factory binds raw state identity: six commands apply exactly six times', async () => {
  const original = Game.prototype.play;
  let applications = 0;
  Game.prototype.play = function (...args) { applications++; return original.apply(this, args); };
  let result;
  try {
    result = await run(input());
    assert.equal(applications, 6, 'JSON-cloned observations would replay prefixes 21 times');
    const engine = createWeiqiGameEngine(config);
    let state = engine.initialPosition();
    for (const command of commands.slice(0, 2)) state = engine.extend(state, command).state;
    applications = 0;
    engine.extend(structuredClone(state), commands[2]);
    assert.equal(applications, 3, 'foreign/imported state still requires full reconstruction');
  } finally { Game.prototype.play = original; }
  assert.deepEqual(result.at(-1).value.state, createWeiqiGameSession(config, commands).state);
  assert.deepEqual(result[0].value, createWeiqiGameSession(config).state);
  assert.deepEqual(result[1].value.state, createWeiqiGameSession(config, commands.slice(0, 1)).state);
});

test('generated references are invocation-local and reject bad targets outside source error capture', async () => {
  const request = input(), before = JSON.stringify(request);
  const [a, b] = await Promise.all([run(request), run(request)]);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(request), before);
  await assert.rejects(() => run({arguments:[config], calls:[{
    method:'extend', arguments:[null, commands[0]], captureError:true,
    references:[{argument:0, result:0, path:[]}],
  }]}), TypeError);
  await assert.rejects(() => run({arguments:[config], calls:[
    {method:'initialPosition', arguments:[]},
    {method:'extend', arguments:[null, commands[0]], captureError:true,
      references:[{argument:0, result:0, path:['toString']}]},
  ]}), TypeError);
});
