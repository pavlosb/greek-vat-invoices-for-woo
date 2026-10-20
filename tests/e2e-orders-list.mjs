// Dev-only browser check of the Orders list marker and filter (never shipped, see .gitattributes).
//
//   node tests/e2e-orders-list.mjs <siteUrl> <adminUser> <adminPass> [screenshotDir]
//   GRVATIN_MOBILE=1 node tests/e2e-orders-list.mjs <siteUrl> <adminUser> <adminPass> [screenshotDir]
//
// Needs Chrome (the CHROME env var overrides the path), a running site, the tagged orders from
// `php tests/fixtures.php seed` and a temporary admin from `php tests/fixtures.php admin-create`.
// Drives headless Chrome through the DevTools protocol with Node's built-in WebSocket.
//
// GRVATIN_MOBILE=1 runs the phone check INSTEAD of the desktop one: Chrome emulates a 375x812 touch phone
// (below WordPress's 782px breakpoint the cells that FOLLOW the primary column are hidden and sit behind each
// row's "Show more details" toggle; the classic posts screen has no toggle), and the checks are about what a
// phone shows. Screenshots get a `mobile-` prefix.
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
const MOBILE = process.env.GRVATIN_MOBILE === '1';
const PHONE = { width: 375, height: 812, deviceScaleFactor: 2, mobile: true };
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

// Phone view (GRVATIN_MOBILE=1): geometry and content of everything the mobile checks look at, as plain data.
// A box is "visible" when it is rendered (it has a layout box: not display:none, not visibility:hidden) and lies inside
// the viewport width; "inView" also needs it inside the viewport height (the checks scroll an element there first).
const MOBILE_FACTS = `(() => {
  const squash = (s) => s.replace(/\\s+/g, ' ').trim();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const rendered = el.getClientRects().length > 0 && s.visibility !== 'hidden';
    const visible = rendered && r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= vw + 1;
    return {
      rendered, visible, inView: visible && r.top >= -1 && r.bottom <= vh + 1, display: s.display,
      left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top),
      width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10,
    };
  };
  const rows = ${ROWS};
  // The PHP check of the desktop view reads innerText, which leaves out the cells WordPress hides on phones: look at all the text
  const everything = document.body.cloneNode(true);
  everything.querySelectorAll('script, style, noscript, template').forEach((n) => n.remove());
  const status = document.querySelector('ul.subsubsub');
  const link = document.querySelector('ul.subsubsub li.grvatin_invoices a');
  const fragments = link ? [...link.getClientRects()] : [];
  const under = fragments.length ? document.elementFromPoint(fragments[0].left + fragments[0].width / 2, fragments[0].top + fragments[0].height / 2) : null;
  const items = status ? [...status.querySelectorAll('li')] : [];
  const field = document.querySelector('p.search-box input[name="s"]');
  const submit = document.querySelector('p.search-box #search-submit');
  // WordPress prints a cell's data-colname in front of it (a ::before label) in every cell that is visible on a phone.
  // Is that label there, and does its text fit the room it is given? (measured with the label's own font)
  const canvas = document.createElement('canvas').getContext('2d');
  const label = (cell) => {
    const p = getComputedStyle(cell, '::before');
    const text = p.content.replace(/^["']|["']$/g, '');
    const shown = p.display !== 'none' && p.content !== 'none' && p.content !== 'normal' && text !== '';
    canvas.font = p.font;
    const needs = shown ? Math.round(canvas.measureText(text).width * 10) / 10 : 0;
    const room = parseFloat(p.width) || 0;
    return { text, shown, needs, room: Math.round(room * 10) / 10, clipped: shown && needs > room + 1 };
  };
  return {
    viewport: vw,
    scrollWidth: document.documentElement.scrollWidth,
    phpDeep: /Fatal error|Warning:|Notice:|Deprecated:/.test(everything.textContent),
    // the seeded fixture rows only (identified by the billing last name in the order number cell)
    fix: rows.filter((tr) => { const n = tr.querySelector('.column-order_number'); return n && squash(n.textContent).includes('GRVATIN TEST'); }).map((tr) => {
      const number = tr.querySelector('.column-order_number');
      const cell = tr.querySelector('td.column-grvatin_doc');
      return {
        name: squash(number.textContent),
        primary: box(number),
        title: box(number.querySelector('a.order-view, a.row-title')),
        toggle: box(tr.querySelector('button.toggle-row')),
        expanded: tr.classList.contains('is-expanded'),
        marker: cell && {
          box: box(cell), icon: !!cell.querySelector('.grvatin-doc-icon'), iconBox: box(cell.querySelector('.grvatin-doc-icon')),
          empty: cell.innerHTML.trim() === '', colname: cell.getAttribute('data-colname'), label: label(cell),
        },
      };
    }),
    status: status && {
      overflowX: status.scrollWidth > status.clientWidth + 1,
      right: Math.round(status.getBoundingClientRect().right),
      widest: Math.round(Math.max(...items.map((li) => li.getBoundingClientRect().right))),
      lines: new Set(items.map((li) => Math.round(li.getBoundingClientRect().top))).size,
    },
    link: link && {
      text: squash(link.textContent),
      box: box(link),
      // the smallest line fragment: a link that wraps has several
      height: Math.round(Math.min(...fragments.map((r) => r.height)) * 10) / 10,
      hit: !!under && (under === link || link.contains(under)),
    },
    search: { field: box(field), submit: box(submit) },
  };
})()`;

// One seeded fixture row by its kind, as a page expression (undefined when it is not listed). Never a real order.
const rowOf = (kind) => `(${ROWS}.find((tr) => { const n = tr.querySelector('.column-order_number'); return n && n.textContent.replace(/\\s+/g, ' ').includes(${JSON.stringify(`GRVATIN TEST ${kind}`)}); }))`;

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

  // tall (phone view): the full phone width from the top of the page down to at most 2400 css px, not just the visible screen
  const shot = async (name, tall = false) => {
    const params = { format: 'png' };
    if (tall) {
      const height = await js('Math.min(document.documentElement.scrollHeight, 2400)');
      Object.assign(params, { captureBeyondViewport: true, clip: { x: 0, y: 0, width: PHONE.width, height, scale: 1 } });
    }
    const r = await send('Page.captureScreenshot', params);
    writeFileSync(join(shotDir, name), Buffer.from(r.data, 'base64'));
  };

  // Types a value into a real form field and presses the real button, so the browser builds the request from the
  // form itself (null leaves the field as it is). False when the field or the button is not on the page.
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

  // A touch tap, as a phone sends it. locate() scrolls an element (a page expression) to the middle of the screen and
  // reports where its centre is and whether that very element is what lies there (nothing covers it); touch() taps the point.
  const locate = (elementExpr) => js(`(() => {
    const el = ${elementExpr};
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getClientRects()[0];
    if (!r) return null;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return { x, y, hit: !!top && (top === el || el.contains(top)) };
  })()`);
  const touch = async (x, y) => {
    await sleep(150);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(60);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };

  await send('Page.enable');
  await send('Runtime.enable');
  if (MOBILE) {
    await send('Emulation.setDeviceMetricsOverride', PHONE);
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }

  // --- log in
  console.log('login');
  await go(`${site}/wp-login.php`);
  await afterLoad(() => js(
    `document.getElementById('user_login').value=${JSON.stringify(user)};` +
    `document.getElementById('user_pass').value=${JSON.stringify(pass)};` +
    `document.getElementById('wp-submit').click();true`
  ).catch(() => {}));
  check('logged in to wp-admin', (await js('location.href')).includes('/wp-admin'));

  if (MOBILE) {
    // --- phone view. Only the seeded fixture rows are ever tapped, never a real order.
    const phpPages = [];
    // One look at the current page: the desktop facts plus the phone geometry
    const look = async (label) => {
      const f = await js(FACTS);
      const m = await js(MOBILE_FACTS);
      if (f.phpProblems || m.phpDeep) phpPages.push(label);
      return { f, m };
    };
    const kinds = ['invoice_processing', 'invoice_on_hold', 'receipt', 'untyped'];
    const rowsOfKind = (m, kind) => m.fix.filter((r) => r.name.includes(`GRVATIN TEST ${kind}`));
    const fixtureList = (m) => JSON.stringify(m.fix.map((r) => r.name));
    const noOverflow = (m) => m.scrollWidth <= m.viewport + 1;
    const overflowDetail = (m) => `scrollWidth ${m.scrollWidth} vs innerWidth ${m.viewport}`;

    console.log('orders list at 375px, collapsed rows');
    await go(`${site}/wp-admin/admin.php?page=wc-orders`);
    await js('window.scrollTo(0, 0)');
    const plain = await look('plain list');
    console.log(`  at ${plain.f.url}`);
    check('the emulated phone viewport is 375px wide', plain.m.viewport === 375, `innerWidth ${plain.m.viewport}`);
    check('plain list: no horizontal page overflow', noOverflow(plain.m), overflowDetail(plain.m));
    check('all four seeded fixture rows are listed', kinds.every((k) => rowsOfKind(plain.m, k).length > 0), fixtureList(plain.m));
    check('the order number (primary column) is visible inside the viewport for every seeded row',
      plain.m.fix.length > 0 && plain.m.fix.every((r) => r.primary.visible && r.title && r.title.visible),
      JSON.stringify(plain.m.fix.map((r) => ({ name: r.name, cell: r.primary, link: r.title }))));
    // The classic posts screen has no toggle at all: WooCommerce gives it no row actions (WC_Admin_List_Table_Orders::get_row_actions()
    // returns an empty array) and WordPress prints the toggle button only together with row actions. That is WooCommerce's doing, not
    // the plugin's, and nothing can be expanded there: say so loudly instead of failing, and skip the steps that need the toggle.
    const classicScreen = new URL(plain.f.url).pathname.endsWith('/edit.php');
    const togglesShown = plain.m.fix.filter((r) => r.toggle && r.toggle.visible).length;
    if (classicScreen) {
      console.log(`  info  classic Orders screen: ${togglesShown} of ${plain.m.fix.length} seeded rows show a toggle button (WooCommerce offers none here: no row actions), so no row can be expanded; the toggle steps are skipped`);
    } else {
      check('every seeded row shows its "Show more details" toggle button',
        plain.m.fix.length > 0 && plain.m.fix.every((r) => r.toggle && r.toggle.visible),
        JSON.stringify(plain.m.fix.map((r) => ({ name: r.name, toggle: r.toggle }))));
    }
    // Informational only: WordPress hides the cells that come AFTER the primary column on phones (a sibling selector), and ours sits before it
    const collapsed = ['invoice_processing', 'invoice_on_hold'].map((k) => {
      const r = rowsOfKind(plain.m, k)[0];
      return { kind: k, cell: r ? r.marker : null };
    });
    const shownCollapsed = collapsed.every((c) => c.cell && c.cell.box.visible);
    console.log(`  info  marker cell of the seeded invoice rows visible without expanding: ${shownCollapsed ? 'yes' : 'no'} (` +
      collapsed.map((c) => `${c.kind}: ${!c.cell ? 'no cell' : c.cell.box.visible ? 'visible' : `hidden, display ${c.cell.box.display}`}`).join(', ') + ')');
    // Where the marker cell is visible, WordPress prints its label text in it: that text must not be cut short (it would sit over the icon)
    const clippedIn = (rows) => rows.filter((r) => r.marker && r.marker.box.visible && r.marker.label.clipped).map((r) => ({ row: (r.name.match(/GRVATIN TEST [a-z_]+/) || [r.name])[0], label: r.marker.label }));
    const clippedCollapsed = clippedIn(plain.m.fix);
    check('collapsed rows: no visible marker cell shows a clipped label next to or over the icon', plain.m.fix.length > 0 && clippedCollapsed.length === 0, JSON.stringify(clippedCollapsed));
    await shot('mobile-orders-list.png', true);

    // Taps the toggle button of one seeded row with a real touch and waits for the row to open. Returns where it tapped.
    const expandRow = async (kind) => {
      const at = await locate(`${rowOf(kind)}?.querySelector('button.toggle-row')`);
      if (at && at.hit) await touch(at.x, at.y);
      const opened = !!at && at.hit && await waitFor(`!!${rowOf(kind)}?.classList.contains('is-expanded')`, 5000);
      check(`tapping the toggle of the seeded ${kind} row expands it`, opened, JSON.stringify(at));
      await sleep(300);
    };
    // Without a toggle (classic screen) the same checks look at the row as it is
    const stage = classicScreen ? 'collapsed (no toggle on this screen)' : 'expanded';

    console.log(classicScreen ? 'seeded rows (nothing to expand on this screen)' : 'expanding rows with the toggle button');
    if (!classicScreen) await expandRow('invoice_processing');
    const expanded = await look('expanded invoice row');
    const marker = (rowsOfKind(expanded.m, 'invoice_processing')[0] || {}).marker || null;
    check(`${stage} invoice row: the marker cell is visible`, !!marker && marker.box.visible, JSON.stringify(marker));
    check(`${stage} invoice row: the marker cell holds the visible .grvatin-doc-icon`, !!marker && marker.icon && marker.iconBox.visible, JSON.stringify(marker));
    check(`${stage} invoice row: the cell label (data-colname) is "Παραστατικό"`, !!marker && marker.colname === 'Παραστατικό', JSON.stringify(marker && marker.colname));
    const clippedExpanded = clippedIn(rowsOfKind(expanded.m, 'invoice_processing'));
    check(`${stage} invoice row: the marker cell shows no clipped label next to or over the icon`, !!marker && clippedExpanded.length === 0, JSON.stringify(clippedExpanded));
    if (!classicScreen) {
      // top of the row just below the page's own sticky header bars, for the screenshot
      await js(`${rowOf('invoice_processing')}?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -100);`);
      await sleep(200);
      await shot('mobile-orders-list-expanded.png');
    } else {
      console.log('  skip  mobile-orders-list-expanded.png (no row can be expanded on this screen)');
    }

    if (!classicScreen) await expandRow('receipt');
    const receiptRow = rowsOfKind((await look('receipt row')).m, 'receipt')[0];
    const receiptMarker = (receiptRow || {}).marker || null;
    check(`${stage} receipt row: the marker cell is empty (no icon, no text)`, !!receiptMarker && receiptMarker.empty && !receiptMarker.icon, JSON.stringify(receiptMarker));
    if (receiptMarker) console.log(`  info  empty marker cell of the ${stage} receipt row: ${receiptMarker.box.visible ? 'rendered' : `not rendered (display ${receiptMarker.box.display})`}, ${receiptMarker.box.width}x${receiptMarker.box.height}px`);

    console.log('status row link at 375px');
    await js(`document.querySelector('ul.subsubsub li.grvatin_invoices a')?.scrollIntoView({ block: 'center' })`);
    await sleep(200);
    const status = await look('status row');
    const link = status.m.link;
    check('the "Τιμολόγια (N)" link is visible inside the viewport and is what a tap there reaches', !!link && link.box.inView && link.hit, JSON.stringify(link));
    check('the "Τιμολόγια (N)" touch target is at least 24px high', !!link && link.height >= 24, `${link ? link.height : 'no link'}px`);
    check('the status row causes no horizontal overflow',
      !!status.m.status && !status.m.status.overflowX && status.m.status.widest <= status.m.viewport + 1 && noOverflow(status.m),
      `${JSON.stringify(status.m.status)} ${overflowDetail(status.m)}`);
    if (status.m.status) console.log(`  info  the status row wraps onto ${status.m.status.lines} line(s); the "Τιμολόγια (N)" link is ${link ? link.height : '?'}px high`);
    const linkAt = await locate(`document.querySelector('ul.subsubsub li.grvatin_invoices a')`);
    const linkTapped = !!linkAt && linkAt.hit;
    if (linkTapped) await afterLoad(() => touch(linkAt.x, linkAt.y));
    const filtered = await look('filtered list');
    check('tapping the "Τιμολόγια (N)" link loads the filtered list (URL carries grvatin_doc=invoice)', linkTapped && filtered.f.url.includes('grvatin_doc=invoice'), `${filtered.f.url} ${JSON.stringify(linkAt)}`);

    console.log('orders list at 375px, filter active');
    await js('window.scrollTo(0, 0)');
    check('filtered list: no horizontal page overflow', noOverflow(filtered.m), overflowDetail(filtered.m));
    check('filtered list: the seeded invoice_processing and invoice_on_hold rows are listed',
      rowsOfKind(filtered.m, 'invoice_processing').length > 0 && rowsOfKind(filtered.m, 'invoice_on_hold').length > 0, fixtureList(filtered.m));
    check('filtered list: the seeded receipt and untyped rows are left out',
      rowsOfKind(filtered.m, 'receipt').length === 0 && rowsOfKind(filtered.m, 'untyped').length === 0, fixtureList(filtered.m));
    check('filtered list: "Τιμολόγια (N)" is the current link', filtered.f.current.length === 1 && filtered.f.current[0].startsWith('Τιμολόγια'), JSON.stringify(filtered.f.current));
    check('filtered list: every shown row carries the icon', filtered.f.rows > 0 && filtered.f.icons === filtered.f.rows, `${filtered.f.icons}/${filtered.f.rows}`);
    await shot('mobile-orders-list-invoices.png', true);

    console.log('filter combined with the list search box at 375px');
    await go(plain.f.linkHref);
    const beforeSearch = await look('filtered list, before the search');
    check('the search box and its button are visible inside the viewport', !!beforeSearch.m.search.field && beforeSearch.m.search.field.visible && !!beforeSearch.m.search.submit && beforeSearch.m.search.submit.visible, JSON.stringify(beforeSearch.m.search));
    const searched = await press('p.search-box input[name="s"]', 'p.search-box #search-submit', 'GRVATIN');
    check('the list search box and its button were found', searched);
    const afterSearch = await look('filtered list + search');
    check('search box: the URL still carries grvatin_doc=invoice (and the search)', afterSearch.f.url.includes('grvatin_doc=invoice') && afterSearch.f.url.includes('s=GRVATIN'), afterSearch.f.url);
    check('search box: at least one row, every shown row carries the icon, no horizontal overflow',
      afterSearch.f.rows >= 1 && afterSearch.f.icons === afterSearch.f.rows && noOverflow(afterSearch.m), `${afterSearch.f.icons}/${afterSearch.f.rows} ${overflowDetail(afterSearch.m)}`);

    check('no PHP problems printed on any mobile page', phpPages.length === 0, phpPages.join(', '));
    check('no JavaScript exceptions on any mobile page', jsErrors.length === 0, jsErrors.join(' | '));
  } else {
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
  }

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
