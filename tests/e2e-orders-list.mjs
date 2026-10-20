// Dev-only browser check of the Orders list marker and filter (never shipped, see .gitattributes).
//
//   node tests/e2e-orders-list.mjs <siteUrl> <adminUser> <adminPass> [screenshotDir]
//
// Needs Chrome (the CHROME env var overrides the path), a running site, the tagged orders from
// `php tests/fixtures.php seed` and a temporary admin from `php tests/fixtures.php admin-create`.
// Drives headless Chrome through the DevTools protocol with Node's built-in WebSocket.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [site, user, pass, shotDir = '.'] = process.argv.slice(2);
if (!site || !user || !pass) {
  console.error('usage: node tests/e2e-orders-list.mjs <siteUrl> <adminUser> <adminPass> [screenshotDir]');
  process.exit(2);
}

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = mkdtempSync(join(tmpdir(), 'grvatin-e2e-'));
mkdirSync(shotDir, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1500,1100', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

async function pageTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* Chrome is still starting */ }
    await sleep(250);
  }
  throw new Error('Chrome did not start');
}

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ' -- ' + detail : ''}`);
};

// The seeded fixture rows of one kind (invoice_processing, receipt, ...) found in a page's FACTS
const fixtureRows = (facts, kind) => facts.fixtures.filter((f) => f.name.includes(`GRVATIN TEST ${kind}`));
const fixtureNames = (facts) => JSON.stringify(facts.fixtures.map((f) => f.name));

// The order rows of the list table (HPOS rows are order-N, the classic screen's are post-N)
const ROWS = `[...document.querySelectorAll('table.wp-list-table tbody tr[id^="order-"], table.wp-list-table tbody tr[id^="post-"]')]`;

// The seeded invoice order the Quick Preview and the edit screen steps may act on. Never any other row:
// the site also holds real orders, and the only thing that identifies a fixture is its billing last name.
const SEEDED = 'GRVATIN TEST invoice_processing';
const SEEDED_ROW = `(() => ${ROWS}.find((tr) => tr.textContent.replace(/\\s+/g, ' ').includes(${JSON.stringify(SEEDED)}) &&
  tr.querySelector('td.column-grvatin_doc .grvatin-doc-icon')))()`;

// Collected from the page: everything the checks need, as plain data
const FACTS = `(() => {
  const rows = ${ROWS};
  const ours = (tr) => tr.querySelector('td.column-grvatin_doc');
  const link = document.querySelector('ul.subsubsub li.grvatin_invoices a');
  const squash = (s) => s.replace(/\\s+/g, ' ').trim();
  return {
    url: location.href,
    rows: rows.length,
    cells: rows.filter(ours).length,
    icons: rows.filter((tr) => ours(tr) && ours(tr).querySelector('.grvatin-doc-icon')).length,
    // every seeded fixture order in the list, so the checks can name the exact rows they are about
    fixtures: rows.filter((tr) => squash(tr.textContent).includes('GRVATIN TEST')).map((tr) => {
      // match on the class only: the primary column can be rendered as a th (scope=row) instead of a td
      const number = tr.querySelector('.column-order_number');
      return { name: number ? squash(number.textContent) : '', icon: !!(ours(tr) && ours(tr).querySelector('.grvatin-doc-icon')) };
    }),
    head: !!document.querySelector('table.wp-list-table thead th#grvatin_doc'),
    headOrder: [...document.querySelectorAll('table.wp-list-table thead tr > *')].slice(0, 3).map((el) => el.id || ''),
    primary: [...document.querySelectorAll('table.wp-list-table thead .column-primary')].map((el) => el.id),
    linkText: link ? squash(link.textContent) : null,
    linkIsLast: !!link && link.closest('li') === document.querySelector('ul.subsubsub li:last-child'),
    linkHref: link ? link.href : null,
    current: [...document.querySelectorAll('ul.subsubsub a.current')].map((a) => squash(a.textContent)),
    labels: [...document.querySelectorAll('#adv-settings label')].map((l) => squash(l.textContent)),
    phpProblems: /Fatal error|Warning:|Notice:|Deprecated:/.test(document.body.innerText),
  };
})()`;

try {
  const ws = new WebSocket(await pageTarget());
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('websocket failed'));
  });

  let nextId = 1;
  let loadWaiter = null;
  const pending = new Map();
  const jsErrors = [];

  ws.onmessage = (event) => {
    const m = JSON.parse(event.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
    } else if (m.method === 'Page.loadEventFired' && loadWaiter) {
      loadWaiter();
      loadWaiter = null;
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      jsErrors.push(`${d.text} ${(d.exception && d.exception.description) || ''}`.trim());
    }
  };

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  const js = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };

  const afterLoad = async (trigger) => {
    const loaded = new Promise((resolve) => { loadWaiter = resolve; });
    await trigger();
    await Promise.race([loaded, sleep(30000)]);
    await sleep(400);
  };
  const go = (url) => afterLoad(() => send('Page.navigate', { url }));

  // Polls the page until the expression is true (the first AJAX call after idle can be slow)
  const waitFor = async (expression, ms = 30000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await js(expression)) return true;
      await sleep(250);
    }
    return false;
  };

  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(shotDir, name), Buffer.from(r.data, 'base64'));
  };

  await send('Page.enable');
  await send('Runtime.enable');

  // --- log in
  console.log('login');
  await go(`${site}/wp-login.php`);
  await afterLoad(() => js(
    `document.getElementById('user_login').value=${JSON.stringify(user)};` +
    `document.getElementById('user_pass').value=${JSON.stringify(pass)};` +
    `document.getElementById('wp-submit').click();true`
  ).catch(() => {}));
  check('logged in to wp-admin', (await js('location.href')).includes('/wp-admin'));

  // --- the full list
  console.log('orders list, no filter');
  await go(`${site}/wp-admin/admin.php?page=wc-orders`);
  const all = await js(FACTS);
  console.log(`  at ${all.url}`);
  check('column header is present', all.head);
  check('column sits right after the checkbox', all.headOrder[0] === 'cb' && all.headOrder[1] === 'grvatin_doc', JSON.stringify(all.headOrder));
  check('the order number stays the primary column (ours is not)', all.primary.length === 1 && all.primary[0] === 'order_number', JSON.stringify(all.primary));
  check('every row has the marker cell', all.rows > 0 && all.cells === all.rows, `${all.cells}/${all.rows}`);
  // Anchored to the seeded orders: the real invoice orders on the site must never satisfy these
  for (const kind of ['invoice_processing', 'invoice_on_hold']) {
    const found = fixtureRows(all, kind);
    check(`seeded ${kind} row is listed and shows the icon`, found.length > 0 && found.every((f) => f.icon), fixtureNames(all));
  }
  for (const kind of ['receipt', 'untyped']) {
    const found = fixtureRows(all, kind);
    check(`seeded ${kind} row is listed and shows no icon`, found.length > 0 && found.every((f) => !f.icon), fixtureNames(all));
  }
  const m = (all.linkText || '').match(/^Τιμολόγια \((\d[\d.,]*)\)$/);
  check('filter link reads "Τιμολόγια (N)"', !!m, String(all.linkText));
  check('filter link is the last status link', all.linkIsLast);
  check('"All" is the current link while the filter is off', all.current.length === 1 && /^(All|Όλες)/.test(all.current[0]), JSON.stringify(all.current));
  check('Screen Options names the column', all.labels.some((t) => t.includes('Παραστατικό')), JSON.stringify(all.labels));
  check('no PHP problems printed in the page', !all.phpProblems);
  await shot('orders-list-all.png');
  const n = m ? parseInt(m[1].replace(/[.,]/g, ''), 10) : -1;

  // --- the Quick Preview must be unaffected
  // Only the seeded invoice row is ever acted on, never another row with an icon (those are real orders).
  console.log('quick preview (1.2.4) still works');
  const seeded = await js(`(() => {
    const tr = ${SEEDED_ROW};
    if (!tr) return null;
    const view = tr.querySelector('a.order-view, a.row-title');
    return { editUrl: view ? view.href : null };
  })()`);
  check('seeded invoice row found for the preview / edit-screen steps (did seeding fail?)', !!seeded);
  if (seeded) {
    const clicked = await js(`(() => {
      const preview = ${SEEDED_ROW}.querySelector('a.order-preview');
      if (preview) preview.click();
      return !!preview;
    })()`);
    check('preview modal still shows the invoice block', clicked && await waitFor(`!!document.querySelector('.wc-backbone-modal .grvatin-preview-invoice')`), clicked ? '' : 'the seeded row has no preview button');
    await shot('orders-list-preview.png');
  } else {
    console.log('  skip  quick preview (no seeded invoice row, no other row is touched)');
  }

  // --- the filter
  console.log('orders list, filter active');
  await go(all.linkHref);
  const inv = await js(FACTS);
  check('URL carries grvatin_doc=invoice', inv.url.includes('grvatin_doc=invoice'), inv.url);
  if (n >= 0 && n <= 20) check('rows shown equal the N in the link', inv.rows === n, `${inv.rows} vs ${n}`);
  else console.log(n > 20 ? '  skip  rows equal N (N > 20, list is paginated)' : '  skip  rows equal N (the count in the link could not be read)');
  check('every shown row carries the icon', inv.rows > 0 && inv.icons === inv.rows, `${inv.icons}/${inv.rows}`);
  check('the filter lists the seeded invoice_processing order', fixtureRows(inv, 'invoice_processing').length > 0, fixtureNames(inv));
  check('the filter lists the seeded invoice_on_hold order', fixtureRows(inv, 'invoice_on_hold').length > 0, fixtureNames(inv));
  check('the filter leaves out the seeded receipt order', fixtureRows(inv, 'receipt').length === 0, fixtureNames(inv));
  check('the filter leaves out the seeded untyped order', fixtureRows(inv, 'untyped').length === 0, fixtureNames(inv));
  check('only the Τιμολόγια link is current', inv.current.length === 1 && inv.current[0].startsWith('Τιμολόγια'), JSON.stringify(inv.current));
  check('no PHP problems printed in the page', !inv.phpProblems);
  await shot('orders-list-invoices.png');

  // --- the order edit screen (1.2.5 invoice card) must be unaffected
  // Opened only through the seeded invoice row's own link (read above), never through another row.
  console.log('order edit screen (1.2.5 card) still works');
  if (!seeded) {
    console.log('  skip  order edit screen (no seeded invoice row, no other row is touched)');
  } else if (!seeded.editUrl) {
    check('seeded invoice row links to its order edit screen', false);
  } else {
    await go(seeded.editUrl);
    check('order edit screen still shows the invoice card', await js(`!!document.querySelector('.grvatin-order-card')`));
  }

  // --- the filter must survive the list's own search box and Filter button
  // Both are GET forms that carry only fixed hidden fields, so the browser drops grvatin_doc from the request
  // unless the form carries it too. These steps use the real controls, as a user does: the value is typed
  // into the real input and the real button is pressed, so the browser itself builds the request from the form.
  const press = async (fieldSelector, buttonSelector, value) => {
    const found = await js(`!!document.querySelector(${JSON.stringify(fieldSelector)}) && !!document.querySelector(${JSON.stringify(buttonSelector)})`);
    if (!found) return false;
    await afterLoad(() => js(`(() => {
      const field = document.querySelector(${JSON.stringify(fieldSelector)});
      if (${JSON.stringify(value)} !== null) field.value = ${JSON.stringify(value)};
      document.querySelector(${JSON.stringify(buttonSelector)}).click();
      return true;
    })()`));
    return true;
  };

  console.log('filter combined with the list search box');
  await go(all.linkHref);
  const searched = await press('p.search-box input[name="s"]', 'p.search-box #search-submit', 'GRVATIN');
  check('the list search box and its button were found', searched);
  const withSearch = await js(FACTS);
  check('filter + search box: the URL still carries grvatin_doc=invoice (and the search)', withSearch.url.includes('grvatin_doc=invoice') && withSearch.url.includes('s=GRVATIN'), withSearch.url);
  check('filter + search box: no PHP problems, at least one row, never more rows than the filter alone', !withSearch.phpProblems && withSearch.rows >= 1 && withSearch.rows <= inv.rows, `${withSearch.rows} vs ${inv.rows}`);
  check('filter + search box: every shown row carries the icon', withSearch.rows >= 1 && withSearch.icons === withSearch.rows, `${withSearch.icons}/${withSearch.rows}`);
  check('filter + search box: the seeded invoice_processing order is listed', fixtureRows(withSearch, 'invoice_processing').length > 0, fixtureNames(withSearch));
  check('filter + search box: the seeded invoice_on_hold order is listed', fixtureRows(withSearch, 'invoice_on_hold').length > 0, fixtureNames(withSearch));
  check('filter + search box: the seeded receipt order is left out', fixtureRows(withSearch, 'receipt').length === 0, fixtureNames(withSearch));
  check('filter + search box: the seeded untyped order is left out', fixtureRows(withSearch, 'untyped').length === 0, fixtureNames(withSearch));
  await shot('orders-list-invoices-search.png');

  console.log('filter combined with the list Filter button');
  await go(all.linkHref);
  const filtered = await press('input[name="filter_action"]', 'input[name="filter_action"]', null);
  check('the list Filter button was found', filtered);
  const withButton = await js(FACTS);
  check('filter + Filter button: the URL still carries grvatin_doc=invoice', withButton.url.includes('grvatin_doc=invoice') && withButton.url.includes('filter_action='), withButton.url);
  check('filter + Filter button: no PHP problems, at least one row, every shown row carries the icon', !withButton.phpProblems && withButton.rows >= 1 && withButton.icons === withButton.rows, `${withButton.icons}/${withButton.rows}`);
  check('filter + Filter button: the seeded invoice_processing order is listed', fixtureRows(withButton, 'invoice_processing').length > 0, fixtureNames(withButton));
  check('filter + Filter button: the seeded receipt order is left out', fixtureRows(withButton, 'receipt').length === 0, fixtureNames(withButton));

  // --- the filter combined with a status must not break anything
  console.log('filter combined with a status');
  // The status argument differs per screen: the orders table (HPOS) reads status=, the classic posts screen (edit.php) post_status=
  const classicScreen = new URL(all.url).pathname.endsWith('/edit.php');
  await go(`${all.linkHref}&${classicScreen ? 'post_status' : 'status'}=wc-processing`);
  const withStatus = await js(FACTS);
  check('filter + status: no PHP problems, at least one row, every row is still an invoice', !withStatus.phpProblems && withStatus.rows >= 1 && withStatus.icons === withStatus.rows, `${withStatus.icons}/${withStatus.rows}`);
  check('filter + status: the seeded Processing invoice is listed', fixtureRows(withStatus, 'invoice_processing').length > 0, fixtureNames(withStatus));
  check('filter + status: the seeded On hold invoice is left out (the status was honoured)', fixtureRows(withStatus, 'invoice_on_hold').length === 0, fixtureNames(withStatus));

  // --- an unknown value is ignored
  console.log('unknown filter value');
  const joiner = all.url.includes('?') ? '&' : '?';
  await go(`${all.url}${joiner}grvatin_doc=bogus`);
  const bogus = await js(FACTS);
  check('same rows as the plain list', bogus.rows === all.rows, `${bogus.rows} vs ${all.rows}`);
  if (!classicScreen) {
    check('"All" stays current', bogus.current.length === 1 && /^(All|Όλες)/.test(bogus.current[0]), JSON.stringify(bogus.current));
  } else {
    // The classic posts screen drops the "All" highlight for ANY extra query argument (WordPress core,
    // WP_Posts_List_Table::is_base_request()), so a bogus value there must behave exactly like an unrelated unknown
    // argument, and must never highlight our own link.
    await go(`${all.url}${joiner}grvatin_control=bogus`);
    const control = await js(FACTS);
    check('"All" is highlighted exactly as for an unrelated unknown argument, and ours is not current', JSON.stringify(bogus.current) === JSON.stringify(control.current) && !bogus.current.some((t) => t.startsWith('Τιμολόγια')), `bogus=${JSON.stringify(bogus.current)} control=${JSON.stringify(control.current)}`);
  }
  check('no PHP problems printed in the page', !bogus.phpProblems);

  check('no JavaScript exceptions on any page', jsErrors.length === 0, jsErrors.join(' | '));
  ws.close();
} catch (error) {
  failures++;
  console.error(error);
} finally {
  chrome.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* the profile is a temp dir */ }
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll browser checks passed');
process.exit(failures ? 1 : 0);
