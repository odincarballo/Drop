// Exercise the pinned EJS solver against Drop's original offline diagnostic.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const fixture = readFileSync(
  new URL(
    '../modules/on-device-youtube/tests/fixtures/drop-ejs-diagnostic.js',
    import.meta.url,
  ),
  'utf8',
);
assert.ok(Buffer.byteLength(fixture) < 4096);
assert.ok(!fixture.toLowerCase().includes('youtube.com'));
assert.equal(
  createHash('sha256').update(fixture).digest('hex'),
  'da37d56875946ef256714d0ad35c485a1414d1abd742d4dc0989d2cc4d4b1683',
);

const solver =
  '../modules/on-device-youtube/vendor/packages/yt_dlp_ejs/yt/solver/';
const lib = readFileSync(
  new URL(`${solver}lib.min.js`, import.meta.url),
  'utf8',
);
const core = readFileSync(
  new URL(`${solver}core.min.js`, import.meta.url),
  'utf8',
);
const context = createContext({ console });
runInContext(`${lib}\nObject.assign(globalThis, lib);\n${core}`, context, {
  timeout: 30_000,
});
const result = context.jsc({
  type: 'player',
  player: fixture,
  requests: [{ type: 'n', challenges: ['drop-diagnostic'] }],
  output_preprocessed: false,
});
assert.equal(result.type, 'result');
assert.equal(result.responses[0].type, 'result');
assert.equal(result.responses[0].data['drop-diagnostic'], 'citsongaid-pord');
console.log('Drop synthetic EJS diagnostic passed');
