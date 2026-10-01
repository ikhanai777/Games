const pw = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs');
(async () => {
  const [from, to, only] = [+(process.argv[2] || 0), +(process.argv[3] || 780), process.argv[4]];
  const b = await pw.chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + __dirname + '/reel.html');
  await pg.evaluate(m => init(m), JSON.parse(fs.readFileSync(__dirname + '/meta.json')));
  await pg.evaluate(() => document.fonts.ready);
  for (let f = from; f < to; f++) {
    if (only && !only.split(',').map(Number).includes(f)) continue;
    await pg.evaluate(f => setFrame(f), f);
    await pg.screenshot({ path: `${__dirname}/out/${String(f).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 93 });
  }
  console.log('errors', errs); await b.close();
})();
