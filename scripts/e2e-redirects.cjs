// Redirects that Havi Hub follows itself, checked inside real Electron
// (its net.fetch cannot stop at a redirect, so util/http.js uses net.request
// there; the unit tests run on Node and cannot see the difference):
//  - a download that carries a server's own header (CurseForge's API key)
//    follows its redirects, and the header reaches that server and no other;
//  - request(…, { redirect: 'manual' }) returns the redirect itself.
//   xvfb-run -a node_modules/electron/dist/electron --no-sandbox scripts/e2e-redirects.cjs
const { app } = require('electron');
const nodeHttp = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('../src/main/util/http');

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failed++;
};

app.whenReady().then(async () => {
  const seen = [];
  const srv = nodeHttp.createServer((req, res) => {
    const host = req.headers.host.split(':')[0];
    seen.push({ host, url: req.url, key: req.headers['x-api-key'] || '' });
    const port = srv.address().port;
    if (req.url === '/files/a.jar') return res.writeHead(302, { Location: '/files/b.jar' }).end();
    if (req.url === '/files/b.jar') return res.writeHead(302, { Location: `http://localhost:${port}/cdn/a.jar` }).end();
    if (req.url === '/releases/latest') return res.writeHead(302, { Location: '/releases/tag/11.1.1' }).end();
    res.writeHead(200, { 'Content-Type': 'application/java-archive' }).end('JAR');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  // 127.0.0.1 plays CurseForge's file server; localhost, the server it redirects to
  http.setHostRules({ headers: (u) => (new URL(u).hostname === '127.0.0.1' ? { 'x-api-key': 'KEY' } : null) });

  try {
    const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'havihub-redirects-')), 'a.jar');
    await http.download(`${base}/files/a.jar`, dest);
    check('a download with a server header follows two redirects', fs.readFileSync(dest, 'utf8') === 'JAR');
    const keys = seen.map((s) => `${s.host}${s.url}:${s.key || '-'}`).join(' ');
    check('the header goes to that server only', keys === '127.0.0.1/files/a.jar:KEY 127.0.0.1/files/b.jar:KEY localhost/cdn/a.jar:-', keys);
  } catch (e) {
    check('a download with a server header follows two redirects', false, e.message);
  }

  try {
    const res = await http.request(`${base}/releases/latest`, { redirect: 'manual', retries: 0 });
    check("redirect: 'manual' returns the redirect", res.status === 302 && /\/releases\/tag\/11\.1\.1$/.test(res.headers.get('location') || ''), `${res.status}`);
  } catch (e) {
    check("redirect: 'manual' returns the redirect", false, e.message);
  }

  srv.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  app.exit(failed ? 1 : 0);
});
