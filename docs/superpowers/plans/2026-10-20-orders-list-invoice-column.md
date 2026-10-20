# Orders List Invoice Marker and Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the WooCommerce Orders list, mark every Τιμολόγιο order with an icon in a slim column and add a "Τιμολόγια (N)" filter link to the status row.

**Architecture:** One new read-only class, `GRVATIN_Order_List`, hooks both WooCommerce list screens (the orders table / HPOS and the classic posts screen). Both read the existing `_billing_invoice_type` order meta. The check script and the browser test live in a dev-only `tests/` folder that is left out of release archives.

**Tech Stack:** PHP 7.0+ (WordPress and WooCommerce hooks), CSS, PowerShell, a CLI integration check on the local XAMPP site (WP 7.1, WooCommerce 11.1), and a Node + headless Chrome browser test.

**Spec:** `docs/superpowers/specs/2026-10-20-orders-list-invoice-column-design.md`

## Global Constraints

Copied from the spec; every task's requirements include them.

- Target release **1.2.6**. Work happens on branch `feature/orders-list-invoice-column` in the clone `C:\Users\user\Desktop\greek-vat-invoices-git` (GitHub is the source of truth; run `git fetch` before starting).
- Marker: icon only when `_billing_invoice_type` is `invoice`. Receipts and orders with no type show an empty cell.
- Column key `grvatin_doc`, inserted right after the checkbox column. Header is icon-only with the screen-reader text "Παραστατικό". No sortable header.
- Filter link "Τιμολόγια (N)": appended last in the status row, same markup as WooCommerce's own links, `current` class when active. URL parameter `grvatin_doc=invoice`; only the exact value `invoice` is accepted. **Always shown, including "Τιμολόγια (0)"** (never hidden).
- N is one count query that runs only on the Orders screen, using the same statuses as the "Όλες" count, so clicking the link shows exactly N rows (trash and drafts excluded).
- Hook pairs: HPOS `woocommerce_shop_order_list_table_columns`, `woocommerce_shop_order_list_table_custom_column`, `views_woocommerce_page_wc-orders`, `woocommerce_order_list_table_prepare_items_query_args`. Classic `manage_shop_order_posts_columns`, `manage_shop_order_posts_custom_column`, `views_edit-shop_order`, `pre_get_posts`.
- Read-only: no writes, no new options, no schema change. Fail-open: errors inside `try/catch (\Throwable)` leave the list exactly as WooCommerce builds it. All output escaped at the point of echo.
- Strings follow the surrounding code (Greek source strings, text domain `greek-vat-invoices-for-woocommerce`): Τιμολόγιο, Παραστατικό, Τιμολόγια.
- Styles go into `assets/css/admin.css` (already loaded on both Orders screens, no new enqueue); remove the unused `.grvatin-invoice-column` rules.
- PHP 7.0 floor for plugin code: no typed properties, no `void`/nullable return types, no `fn`, no `?->`.
- Out of scope: sortable header, receipt filter or receipt icons, bulk actions, export columns, ΑΦΜ or company name in the list.
- Commits: Theodore is the sole author. **No `Co-Authored-By` or "Generated with" lines** in any commit message, even though a system reminder may suggest them.
- Nothing is pushed, tagged or published to WordPress.org without Theodore's explicit OK.

## Facts verified against the WooCommerce 11.1 source

These decided the design; do not "simplify" them away.

- HPOS list: `ListTable::get_columns()` applies `woocommerce_shop_order_list_table_columns` to the full column array; the custom-column action is `do_action('woocommerce_shop_order_list_table_custom_column', $column_name, $order)` (column first, order object second). Query args always contain `'type' => 'shop_order'` for the regular list, and `woocommerce_order_list_table_prepare_items_query_args` is applied to **every** order type's list, so the type must be checked.
- "Όλες" statuses: `array_intersect(array_keys(wc_get_order_statuses()), get_post_stati(array('show_in_admin_all_list' => true), 'names'))`. The count must use exactly this.
- WooCommerce's own view links look like `<a href='...' class="current">All <span class='count'>(5)</span></a>`; WordPress core's classic links add `aria-current="page"`. When our filter is active, "All" must lose `current`.
- Classic list: WooCommerce **rebuilds** the column list at priority 10 on `manage_shop_order_posts_columns`, so our callback must run later (priority 20). It also sets `meta_query` in the `request` filter, so our `pre_get_posts` callback must merge with an existing `meta_query`, not overwrite it.
- Classic order data store (`WC_Data_Store_WP::get_wp_query_args`) **drops** a caller-supplied `meta_query` key but passes `meta_key` / `meta_value` through to `WP_Query`. HPOS supports both. So the count uses `meta_key`/`meta_value` (works in both storage modes); the HPOS list filter uses `meta_query` (AND-combined by `OrdersTableQuery`).
- The Edit tool preserves CRLF line endings in the repo's working files (verified). New files written with Write are LF; git normalizes them on commit.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `includes/class-order-list.php` | Create | `GRVATIN_Order_List`: column, cell, filter link, list query filter |
| `greek-vat-invoices-for-woocommerce.php` | Modify | `require_once` and instantiate the class |
| `assets/css/admin.css` | Modify | New marker styles; remove unused `.grvatin-invoice-column` rules |
| `tests/fixtures.php` | Create | Dev-only CLI: seed/clean tagged test orders, temp admin |
| `tests/check-order-list.php` | Create | Dev-only CLI integration checks (sections: columns, cell, filter, view) |
| `tests/e2e-orders-list.mjs` | Create | Dev-only headless-Chrome check of the real Orders screen |
| `tests/deploy-to-xampp.ps1` | Create | Dev-only: copy plugin files into the local XAMPP test site |
| `.gitattributes` | Create | `export-ignore` for `tests/`, so release archives stay clean |
| `readme.txt`, `WHATSNEW.txt` | Modify (Task 7) | Changelog, upgrade notice, version |

All commands run from the clone root. The session shell may reset its directory between calls, so every block starts with `cd`.

---

### Task 1: Test tooling and the failing checks

**Files:**
- Create: `.gitattributes`
- Create: `tests/deploy-to-xampp.ps1`
- Create: `tests/fixtures.php`
- Create: `tests/check-order-list.php`

**Interfaces:**
- Produces (used by Tasks 2-6): `php tests/fixtures.php seed|clean|admin-create|admin-delete`; `php tests/check-order-list.php [all|columns|cell|filter|view]`; `tests/deploy-to-xampp.ps1`.
- The check script expects the class API built in Tasks 2-4: `GRVATIN_Order_List::get_instance()`, `add_column($columns)`, `render_column($column, $order)`, `render_column_classic($column, $post_id)`, `filter_query_args($args)`, `filter_classic_query($query)`, `add_view($views)`, `get_view_link($url, $count, $active)`, `count_invoices()`.

- [ ] **Step 1: Sync with GitHub and confirm the branch**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
git fetch --all --tags
git status -sb
git log --oneline HEAD..origin/main
git log --oneline -3
```

Expected: branch `feature/orders-list-invoice-column`, nothing listed between `HEAD..origin/main`, and the log shows the spec commit on top of `b23f643` (v1.2.5). If `origin/main` has moved, stop and tell Theodore before continuing.

- [ ] **Step 2: Start the local site**

XAMPP's Apache and MySQL must be running. Start them from the XAMPP Control Panel, or headless:

```powershell
Start-Process -FilePath 'C:\xampp\mysql\bin\mysqld.exe' -ArgumentList '--defaults-file=C:\xampp\mysql\bin\my.ini','--standalone' -WorkingDirectory 'C:\xampp' -WindowStyle Hidden
Start-Process -FilePath 'C:\xampp\apache\bin\httpd.exe' -WorkingDirectory 'C:\xampp' -WindowStyle Hidden
Start-Sleep -Seconds 6
(Invoke-WebRequest -Uri 'http://localhost/wordpress/wp-login.php' -UseBasicParsing).StatusCode
```

Expected: `200`.

- [ ] **Step 3: Write `.gitattributes`**

```
# Dev-only files stay out of release archives (GitHub "Download ZIP" and `git archive`)
/tests export-ignore
/.gitattributes export-ignore
```

- [ ] **Step 4: Write `tests/deploy-to-xampp.ps1`**

```powershell
# Dev-only: copy the plugin files from this clone into the local XAMPP test site.
# The XAMPP copy is a deploy/test copy, never a source of truth.
$ErrorActionPreference = 'Stop'

$src = Split-Path -Parent $PSScriptRoot
$dst = 'C:\xampp\htdocs\wordpress\wp-content\plugins\greek-vat-invoices-for-woocommerce'

if (-not (Test-Path $dst)) { throw "XAMPP plugin folder not found: $dst" }

Copy-Item (Join-Path $src 'greek-vat-invoices-for-woocommerce.php') $dst -Force
Copy-Item (Join-Path $src 'includes\*.php') (Join-Path $dst 'includes') -Force
Copy-Item (Join-Path $src 'assets\css\admin.css') (Join-Path $dst 'assets\css') -Force

Write-Host "Deployed to $dst"
```

- [ ] **Step 5: Write `tests/fixtures.php`**

```php
<?php
/**
 * Dev-only helpers for the Orders list checks. CLI only, never shipped (see .gitattributes).
 *
 *   C:\xampp\php\php.exe tests/fixtures.php seed          create the tagged test orders, print their IDs as JSON
 *   C:\xampp\php\php.exe tests/fixtures.php clean         delete every tagged test order, print how many
 *   C:\xampp\php\php.exe tests/fixtures.php admin-create  create a temporary admin, print {"user","pass"} as JSON
 *   C:\xampp\php\php.exe tests/fixtures.php admin-delete  delete that admin
 *
 * Set GRVATIN_WP_LOAD to the site's wp-load.php if it is not the local XAMPP site.
 */

if (PHP_SAPI !== 'cli') {
    exit;
}

if (!defined('ABSPATH')) {
    define('WP_USE_THEMES', false);
    $grvatin_wp_load = getenv('GRVATIN_WP_LOAD');
    if (!$grvatin_wp_load) {
        $grvatin_wp_load = 'C:/xampp/htdocs/wordpress/wp-load.php';
    }
    require $grvatin_wp_load;
}

define('GRVATIN_TEST_TAG', '_grvatin_test_fixture');
define('GRVATIN_TEST_ADMIN', 'grvatin_e2e_admin');

function grvatin_fixture_mute_mail() {
    add_filter('pre_wp_mail', '__return_true');
    add_filter('woocommerce_mail_callback', function () {
        return '__return_true';
    });
}

/**
 * Create the tagged test orders. Returns name => order ID.
 */
function grvatin_fixture_seed() {
    grvatin_fixture_mute_mail();

    // name => array(invoice type meta ('' = none), status, move to trash)
    $specs = array(
        'invoice_processing' => array('invoice', 'processing', false),
        'invoice_on_hold'    => array('invoice', 'on-hold', false),
        'invoice_trashed'    => array('invoice', 'processing', true),
        'receipt'            => array('receipt', 'processing', false),
        'untyped'            => array('', 'processing', false),
    );

    $ids = array();
    foreach ($specs as $name => $spec) {
        list($type, $status, $trash) = $spec;

        $order = wc_create_order();
        $order->set_created_via('store-api');
        $order->set_billing_first_name('GRVATIN');
        $order->set_billing_last_name('TEST ' . $name);
        if ($type !== '') {
            $order->update_meta_data('_billing_invoice_type', $type);
        }
        $order->update_meta_data(GRVATIN_TEST_TAG, '1');
        $order->set_status($status);
        $order->save();

        if ($trash) {
            $order->delete(false);
        }

        $ids[$name] = $order->get_id();
    }

    return $ids;
}

/**
 * Permanently delete every tagged test order (trash included). Returns how many.
 */
function grvatin_fixture_clean() {
    $ids = wc_get_orders(array(
        'type'       => 'shop_order',
        'status'     => array_merge(array_keys(wc_get_order_statuses()), array('trash')),
        'limit'      => -1,
        'return'     => 'ids',
        'meta_key'   => GRVATIN_TEST_TAG,
        'meta_value' => '1',
    ));

    foreach ($ids as $id) {
        $order = wc_get_order($id);
        if ($order) {
            $order->delete(true);
        }
    }

    return count($ids);
}

function grvatin_fixture_admin_delete() {
    require_once ABSPATH . 'wp-admin/includes/user.php';

    $user = get_user_by('login', GRVATIN_TEST_ADMIN);
    if ($user) {
        wp_delete_user($user->ID);
    }

    return (bool) $user;
}

function grvatin_fixture_admin_create() {
    grvatin_fixture_admin_delete();

    $pass = wp_generate_password(20, false);
    $id   = wp_insert_user(array(
        'user_login' => GRVATIN_TEST_ADMIN,
        'user_pass'  => $pass,
        'user_email' => 'grvatin-e2e@example.invalid',
        'role'       => 'administrator',
    ));

    if (is_wp_error($id)) {
        fwrite(STDERR, $id->get_error_message() . "\n");
        exit(1);
    }

    return array('user' => GRVATIN_TEST_ADMIN, 'pass' => $pass);
}

// Command dispatch, only when this file is run directly (the check script just includes the functions)
if (isset($argv[1]) && basename($argv[0]) === 'fixtures.php') {
    switch ($argv[1]) {
        case 'seed':
            echo wp_json_encode(grvatin_fixture_seed()), "\n";
            break;
        case 'clean':
            echo grvatin_fixture_clean(), "\n";
            break;
        case 'admin-create':
            echo wp_json_encode(grvatin_fixture_admin_create()), "\n";
            break;
        case 'admin-delete':
            echo grvatin_fixture_admin_delete() ? "deleted\n" : "none\n";
            break;
        default:
            fwrite(STDERR, "unknown command: {$argv[1]}\n");
            exit(2);
    }
}
```

- [ ] **Step 6: Write `tests/check-order-list.php`**

```php
<?php
/**
 * Integration checks for GRVATIN_Order_List. Dev-only, CLI only, never shipped (see .gitattributes).
 *
 * Runs against the WordPress/WooCommerce site and the plugin copy deployed there (see
 * tests/deploy-to-xampp.ps1). Seeds tagged test orders, checks, and deletes them again.
 *
 *   C:\xampp\php\php.exe tests/check-order-list.php [all|columns|cell|filter|view]
 */

if (PHP_SAPI !== 'cli') {
    exit;
}

require __DIR__ . '/fixtures.php';

$section  = isset($argv[1]) ? $argv[1] : 'all';
$passes   = 0;
$failures = 0;

function check($name, $ok, $detail = '') {
    global $passes, $failures;
    if ($ok) {
        $passes++;
        echo "  ok   $name\n";
    } else {
        $failures++;
        echo "  FAIL $name" . ($detail !== '' ? " -- $detail" : '') . "\n";
    }
}

function wants($name) {
    global $section;
    return $section === 'all' || $section === $name;
}

function show($value) {
    return is_string($value) ? $value : wp_json_encode($value);
}

function capture($hook, $column, $arg) {
    ob_start();
    do_action($hook, $column, $arg);
    return trim(ob_get_clean());
}

echo "GRVATIN_Order_List checks (section: $section)\n";

if (!class_exists('GRVATIN_Order_List')) {
    echo "  FAIL class GRVATIN_Order_List is not loaded (deployed and plugin active?)\n";
    exit(1);
}

$admins = get_users(array('role' => 'administrator', 'number' => 1, 'orderby' => 'ID', 'fields' => 'ID'));
wp_set_current_user((int) $admins[0]);

$list = GRVATIN_Order_List::get_instance();

grvatin_fixture_clean(); // leftovers of an aborted run
$before = wants('view') ? $list->count_invoices() : 0;
$ids    = grvatin_fixture_seed();
register_shutdown_function('grvatin_fixture_clean');
echo '  seeded: ' . show($ids) . "\n";

// ---------------------------------------------------------------- columns
if (wants('columns')) {
    echo "columns\n";

    $in = array('cb' => '<input type="checkbox" />', 'order_number' => 'Order', 'order_status' => 'Status');

    foreach (array('woocommerce_shop_order_list_table_columns', 'manage_shop_order_posts_columns') as $hook) {
        $out  = apply_filters($hook, $in);
        $keys = array_keys($out);
        $pos  = array_search('cb', $keys, true);

        check("$hook: grvatin_doc sits right after cb", $pos !== false && isset($keys[$pos + 1]) && $keys[$pos + 1] === 'grvatin_doc', show($keys));
        check("$hook: the other columns keep their order", array_values(array_intersect($keys, array_keys($in))) === array_keys($in), show($keys));
        check("$hook: header carries the screen-reader label", isset($out['grvatin_doc']) && strpos($out['grvatin_doc'], 'Παραστατικό') !== false);
    }

    check('non-array input passes through', $list->add_column('x') === 'x');

    $no_cb = $list->add_column(array('order_number' => 'Order'));
    check('without a cb column ours is placed first', array_keys($no_cb) === array('grvatin_doc', 'order_number'), show(array_keys($no_cb)));
}

// ---------------------------------------------------------------- cell
if (wants('cell')) {
    echo "cell\n";

    $hpos    = 'woocommerce_shop_order_list_table_custom_column';
    $classic = 'manage_shop_order_posts_custom_column';
    $inv     = wc_get_order($ids['invoice_processing']);

    $out = capture($hpos, 'grvatin_doc', $inv);
    check('invoice: icon printed', strpos($out, 'grvatin-doc-icon') !== false, $out);
    check('invoice: "Τιμολόγιο" in title and in screen-reader text', strpos($out, 'title="Τιμολόγιο"') !== false && strpos($out, '>Τιμολόγιο<') !== false, $out);
    check('on-hold invoice: icon printed', strpos(capture($hpos, 'grvatin_doc', wc_get_order($ids['invoice_on_hold'])), 'grvatin-doc-icon') !== false);
    check('receipt: empty cell', capture($hpos, 'grvatin_doc', wc_get_order($ids['receipt'])) === '');
    check('untyped order: empty cell', capture($hpos, 'grvatin_doc', wc_get_order($ids['untyped'])) === '');
    check('another column: nothing printed', capture($hpos, 'order_status', $inv) === '');
    check('classic hook: invoice icon printed', strpos(capture($classic, 'grvatin_doc', $ids['invoice_processing']), 'grvatin-doc-icon') !== false);
    check('classic hook: receipt empty', capture($classic, 'grvatin_doc', $ids['receipt']) === '');
    check('classic hook: unknown post id is harmless', capture($classic, 'grvatin_doc', 999999999) === '');

    $bad = new class extends WC_Order {
        public function get_meta($key = '', $single = true, $context = 'view') {
            throw new RuntimeException('boom');
        }
    };
    ob_start();
    $list->render_column('grvatin_doc', $bad);
    check('fail-open: an order whose meta read throws prints nothing', trim(ob_get_clean()) === '');

    // The list loads every order (with its meta) anyway; our cell must not add a query per row
    global $wpdb;
    $loaded = array();
    foreach ($ids as $loaded_id) {
        $o = wc_get_order($loaded_id);
        if ($o) {
            $o->get_meta('_billing_invoice_type'); // meta is read once per loaded order
            $loaded[] = $o;
        }
    }
    $queries_before = $wpdb->num_queries;
    foreach ($loaded as $o) {
        capture($hpos, 'grvatin_doc', $o);
    }
    check('printing the cells for every order adds no database queries', $wpdb->num_queries === $queries_before, 'extra=' . ($wpdb->num_queries - $queries_before));
}

// ---------------------------------------------------------------- filter
if (wants('filter')) {
    echo "filter\n";

    $hook     = 'woocommerce_order_list_table_prepare_items_query_args';
    $statuses = array_values(array_intersect(
        array_keys(wc_get_order_statuses()),
        get_post_stati(array('show_in_admin_all_list' => true), 'names')
    ));
    $base = array('type' => 'shop_order', 'status' => $statuses, 'limit' => -1, 'return' => 'ids');

    unset($_GET['grvatin_doc']);
    check('no parameter: query args untouched', apply_filters($hook, $base) === $base);

    foreach (array('receipt', '', 'INVOICE', array('invoice')) as $bad_value) {
        $_GET['grvatin_doc'] = $bad_value;
        check('ignored value ' . show($bad_value), apply_filters($hook, $base) === $base);
    }

    $_GET['grvatin_doc'] = 'invoice';

    $args = apply_filters($hook, $base);
    check('exact value "invoice": args get a meta_query', !empty($args['meta_query']), show($args));

    $found = wc_get_orders($args);
    check('both visible seeded invoices are listed', !array_diff(array($ids['invoice_processing'], $ids['invoice_on_hold']), $found), show($found));
    check('receipt, untyped and trashed invoice are not listed', !array_intersect(array($ids['receipt'], $ids['untyped'], $ids['invoice_trashed']), $found), show($found));

    $only_invoices = true;
    foreach ($found as $found_id) {
        $o = wc_get_order($found_id);
        if (!$o || $o->get_meta('_billing_invoice_type') !== 'invoice') {
            $only_invoices = false;
        }
    }
    check('every listed order really is an invoice', $only_invoices);

    $other = array('type' => 'shop_subscription', 'limit' => 5);
    check('another order type is left alone', apply_filters($hook, $other) === $other);

    $existing = array(array('key' => '_customer_user', 'value' => '1'));
    $merged   = apply_filters($hook, $base + array('meta_query' => $existing));
    check('an existing meta_query is kept and AND-combined', isset($merged['meta_query']['relation']) && $merged['meta_query']['relation'] === 'AND' && $merged['meta_query'][0] === $existing, show($merged['meta_query']));

    // Classic (posts) screen: the pre_get_posts callback
    $saved_query = isset($GLOBALS['wp_the_query']) ? $GLOBALS['wp_the_query'] : null;
    $saved_page  = isset($GLOBALS['pagenow']) ? $GLOBALS['pagenow'] : null;

    $make_query = function ($post_type) {
        $q = new WP_Query();
        $q->query_vars['post_type'] = $post_type;
        return $q;
    };

    $_GET['grvatin_doc']  = 'invoice';
    $GLOBALS['pagenow']   = 'edit.php';

    $q = $make_query('shop_order');
    $GLOBALS['wp_the_query'] = $q;
    $list->filter_classic_query($q);
    $mq = $q->get('meta_query');
    check('classic: main orders query gets the invoice clause', is_array($mq) && isset($mq[0]['key'], $mq[0]['value']) && $mq[0]['key'] === '_billing_invoice_type' && $mq[0]['value'] === 'invoice', show($mq));

    $q = $make_query('shop_order');
    $q->set('meta_query', $existing);
    $GLOBALS['wp_the_query'] = $q;
    $list->filter_classic_query($q);
    $mq = $q->get('meta_query');
    check('classic: an existing meta_query is kept and AND-combined', is_array($mq) && isset($mq['relation']) && $mq['relation'] === 'AND' && $mq[0] === $existing, show($mq));

    $q = $make_query('post');
    $GLOBALS['wp_the_query'] = $q;
    $list->filter_classic_query($q);
    check('classic: other post types untouched', $q->get('meta_query') === '' || $q->get('meta_query') === array());

    $q = $make_query('shop_order');
    $GLOBALS['wp_the_query'] = new WP_Query();
    $list->filter_classic_query($q);
    check('classic: a secondary query is untouched', $q->get('meta_query') === '' || $q->get('meta_query') === array());

    $q = $make_query('shop_order');
    $GLOBALS['wp_the_query'] = $q;
    $GLOBALS['pagenow']      = 'index.php';
    $list->filter_classic_query($q);
    check('classic: outside edit.php untouched', $q->get('meta_query') === '' || $q->get('meta_query') === array());

    $q = $make_query('shop_order');
    $GLOBALS['wp_the_query'] = $q;
    $GLOBALS['pagenow']      = 'edit.php';
    unset($_GET['grvatin_doc']);
    $list->filter_classic_query($q);
    check('classic: no parameter untouched', $q->get('meta_query') === '' || $q->get('meta_query') === array());

    $GLOBALS['wp_the_query'] = $saved_query;
    $GLOBALS['pagenow']      = $saved_page;
}

// ---------------------------------------------------------------- view
if (wants('view')) {
    echo "view\n";

    $all_link = "<a href='http://example.test/?status=all' class=\"current\" aria-current=\"page\">All <span class=\"count\">(5)</span></a>";
    $views_in = array('all' => $all_link, 'wc-processing' => "<a href='#'>Processing</a>");

    unset($_GET['grvatin_doc']);

    $v = apply_filters('views_woocommerce_page_wc-orders', $views_in);
    check('HPOS: link added last', array_keys($v) === array('all', 'wc-processing', 'grvatin_invoices'), show(array_keys($v)));

    $link = isset($v['grvatin_invoices']) ? $v['grvatin_invoices'] : '';
    $n    = $list->count_invoices();
    check('label "Τιμολόγια" and the count (N)', strpos($link, 'Τιμολόγια') !== false && strpos($link, '(' . number_format_i18n($n) . ')') !== false, $link);
    check('inactive: ours is not current and All keeps its markup', strpos($link, 'current') === false && $v['all'] === $all_link);
    check('HPOS: link points at wc-orders with grvatin_doc=invoice', strpos($link, 'page=wc-orders') !== false && strpos($link, 'grvatin_doc=invoice') !== false, $link);
    check('count rose by the two visible seeded invoices (not receipt, untyped or trashed)', $n === $before + 2, "before=$before now=$n");

    $_GET['grvatin_doc'] = 'invoice';
    $status_args = array(
        'type'   => 'shop_order',
        'status' => array_values(array_intersect(array_keys(wc_get_order_statuses()), get_post_stati(array('show_in_admin_all_list' => true), 'names'))),
        'limit'  => -1,
        'return' => 'ids',
    );
    $rows = wc_get_orders(apply_filters('woocommerce_order_list_table_prepare_items_query_args', $status_args));
    check('the count equals the rows the filter lists', count($rows) === $n, 'rows=' . count($rows) . " count=$n");

    $v2 = apply_filters('views_woocommerce_page_wc-orders', $views_in);
    check('active: ours is current', strpos($v2['grvatin_invoices'], 'class="current"') !== false && strpos($v2['grvatin_invoices'], 'aria-current="page"') !== false, $v2['grvatin_invoices']);
    check('active: All loses current and aria-current', strpos($v2['all'], 'current') === false, $v2['all']);
    check('active: other links untouched', $v2['wc-processing'] === $views_in['wc-processing']);

    $vc = apply_filters('views_edit-shop_order', $views_in);
    check('classic: link added with post_type=shop_order', isset($vc['grvatin_invoices']) && strpos($vc['grvatin_invoices'], 'post_type=shop_order') !== false, show($vc));

    $zero = $list->get_view_link('http://example.test/', 0, false);
    check('zero is rendered as "Τιμολόγια (0)", not hidden', strpos($zero, 'Τιμολόγια') !== false && strpos($zero, '(0)') !== false, $zero);

    check('non-array views pass through', $list->add_view('x') === 'x');

    $thrower = function () {
        throw new RuntimeException('boom');
    };
    add_filter('wc_order_statuses', $thrower);
    $failed = $list->add_view($views_in);
    remove_filter('wc_order_statuses', $thrower);
    check('fail-open: views unchanged when the count throws', $failed === $views_in);
}

echo "\n$passes passed, $failures failed\n";
exit($failures > 0 ? 1 : 0);
```

- [ ] **Step 7: Lint all four files**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
& 'C:\xampp\php\php.exe' -l tests\fixtures.php
& 'C:\xampp\php\php.exe' -l tests\check-order-list.php
```

Expected: `No syntax errors detected in ...` for both.

- [ ] **Step 8: Prove the fixtures work on their own**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
& 'C:\xampp\php\php.exe' tests\fixtures.php seed
& 'C:\xampp\php\php.exe' tests\fixtures.php clean
```

Expected: `seed` prints one JSON line with five order IDs (`invoice_processing`, `invoice_on_hold`, `invoice_trashed`, `receipt`, `untyped`); `clean` prints `5`. Run `clean` again: it prints `0`. If `seed` fails, fix the fixtures now; every later task depends on them.

- [ ] **Step 9: Run the checks and watch them fail (red)**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
powershell -File tests\deploy-to-xampp.ps1
& 'C:\xampp\php\php.exe' tests\check-order-list.php all
```

Expected: `FAIL class GRVATIN_Order_List is not loaded (deployed and plugin active?)`, exit code 1.

- [ ] **Step 10: Commit**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
git add .gitattributes tests/deploy-to-xampp.ps1 tests/fixtures.php tests/check-order-list.php
git commit -m "tests: add dev-only fixtures and integration checks for the Orders list marker"
```

---

### Task 2: The marker column and cell

**Files:**
- Create: `includes/class-order-list.php`
- Modify: `greek-vat-invoices-for-woocommerce.php` (`load_dependencies()` near line 85, `init_hooks()` near line 115)
- Modify: `assets/css/admin.css` (replace the "Order List Column" block at lines 193-201)

**Interfaces:**
- Produces: class `GRVATIN_Order_List` with `get_instance()`, `add_column($columns)`, `render_column($column, $order)`, `render_column_classic($column, $post_id)`; constants `COLUMN_KEY = 'grvatin_doc'`, `FILTER_ARG = 'grvatin_doc'`, `FILTER_VALUE = 'invoice'`, `META_KEY = '_billing_invoice_type'`, `VIEW_KEY = 'grvatin_invoices'`. Tasks 3 and 4 add methods to this class.

- [ ] **Step 1: Confirm the checks still fail (red)**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
& 'C:\xampp\php\php.exe' tests\check-order-list.php columns
```

Expected: `FAIL class GRVATIN_Order_List is not loaded ...`.

- [ ] **Step 2: Create `includes/class-order-list.php`**

```php
<?php
/**
 * Order List
 * Marks Τιμολόγιο orders with an icon column and adds a "Τιμολόγια" filter link to the WooCommerce Orders list
 */

if (!defined('ABSPATH')) {
    exit;
}

class GRVATIN_Order_List {

    const COLUMN_KEY   = 'grvatin_doc';
    const FILTER_ARG   = 'grvatin_doc';
    const FILTER_VALUE = 'invoice';
    const META_KEY     = '_billing_invoice_type';
    const VIEW_KEY     = 'grvatin_invoices';

    private static $instance = null;

    public static function get_instance() {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        // Orders table (HPOS)
        add_filter('woocommerce_shop_order_list_table_columns', array($this, 'add_column'), 20);
        add_action('woocommerce_shop_order_list_table_custom_column', array($this, 'render_column'), 10, 2);

        // Classic (posts) orders screen. WooCommerce rebuilds this column list at priority 10, so run after it.
        add_filter('manage_shop_order_posts_columns', array($this, 'add_column'), 20);
        add_action('manage_shop_order_posts_custom_column', array($this, 'render_column_classic'), 10, 2);
    }

    /**
     * Add our slim, icon-only column right after the checkbox column.
     */
    public function add_column($columns) {
        if (!is_array($columns)) {
            return $columns;
        }

        $label = __('Παραστατικό', 'greek-vat-invoices-for-woocommerce');

        // The label is hidden in the table header (see admin.css) but stays readable in Screen Options
        $head = '<span class="grvatin-doc-head" title="' . esc_attr($label) . '">'
            . '<span class="dashicons dashicons-media-text" aria-hidden="true"></span>'
            . '<span class="grvatin-doc-head__label">' . esc_html($label) . '</span>'
            . '</span>';

        $result = array();
        foreach ($columns as $key => $title) {
            $result[$key] = $title;
            if ($key === 'cb') {
                $result[self::COLUMN_KEY] = $head;
            }
        }

        // No checkbox column (unexpected): still show ours, as the first column
        if (!isset($result[self::COLUMN_KEY])) {
            $result = array(self::COLUMN_KEY => $head) + $result;
        }

        return $result;
    }

    /**
     * Print the marker for one order (orders table / HPOS). Only invoices get an icon.
     * Read-only and fail-open: on any error the cell stays empty.
     */
    public function render_column($column, $order) {
        if ($column !== self::COLUMN_KEY || !($order instanceof WC_Order)) {
            return;
        }

        try {
            if ($order->get_meta(self::META_KEY) !== self::FILTER_VALUE) {
                return;
            }
        } catch (\Throwable $e) {
            return;
        }

        $label = __('Τιμολόγιο', 'greek-vat-invoices-for-woocommerce');

        echo '<span class="grvatin-doc-icon" title="' . esc_attr($label) . '">'
            . '<span class="dashicons dashicons-media-text" aria-hidden="true"></span>'
            . '<span class="screen-reader-text">' . esc_html($label) . '</span>'
            . '</span>';
    }

    /**
     * Classic (posts) screen: the hook passes a post ID instead of the order object.
     */
    public function render_column_classic($column, $post_id) {
        if ($column !== self::COLUMN_KEY) {
            return;
        }

        $order = wc_get_order($post_id);
        if ($order) {
            $this->render_column($column, $order);
        }
    }
}
```

- [ ] **Step 3: Load and start the class in the main plugin file**

In `greek-vat-invoices-for-woocommerce.php`, `load_dependencies()`:

Edit: replace
```php
        require_once GRVATIN_PLUGIN_DIR . 'includes/class-order-admin-card.php';
```
with
```php
        require_once GRVATIN_PLUGIN_DIR . 'includes/class-order-admin-card.php';
        require_once GRVATIN_PLUGIN_DIR . 'includes/class-order-list.php';
```

In `init_hooks()`:

Edit: replace
```php
        GRVATIN_Order_Admin_Card::get_instance();
```
with
```php
        GRVATIN_Order_Admin_Card::get_instance();
        GRVATIN_Order_List::get_instance();
```

- [ ] **Step 4: Replace the unused CSS block with the marker styles**

In `assets/css/admin.css`, replace this block (currently lines 193-201):

```css
/* Order List Column */
.grvatin-invoice-column {
    font-weight: 600;
    color: #2271b1;
}

.grvatin-invoice-column .dashicons {
    vertical-align: middle;
}
```

with:

```css
/* Orders list: invoice marker column */
.wp-list-table th.column-grvatin_doc,
.wp-list-table td.column-grvatin_doc {
    width: 3.4em;
    text-align: center;
}

.wp-list-table .grvatin-doc-head .dashicons {
    color: #646970;
}

.wp-list-table .grvatin-doc-head__label {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip: rect(1px, 1px, 1px, 1px);
    white-space: nowrap;
}

.grvatin-doc-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: #f0f6fc;
    color: #2271b1;
}

.grvatin-doc-icon .dashicons {
    width: 16px;
    height: 16px;
    font-size: 16px;
}
```

- [ ] **Step 5: Lint, deploy, run the columns and cell checks (green)**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
& 'C:\xampp\php\php.exe' -l includes\class-order-list.php
& 'C:\xampp\php\php.exe' -l greek-vat-invoices-for-woocommerce.php
powershell -File tests\deploy-to-xampp.ps1
& 'C:\xampp\php\php.exe' tests\check-order-list.php columns
& 'C:\xampp\php\php.exe' tests\check-order-list.php cell
```

Expected: no syntax errors; both runs end with `N passed, 0 failed` and exit code 0 (columns: 7 checks, cell: 10 checks). Any `FAIL` line means fix the class before moving on.

- [ ] **Step 6: Commit**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
git add includes/class-order-list.php greek-vat-invoices-for-woocommerce.php assets/css/admin.css
git commit -m "Orders list: add invoice marker column and replace the unused column CSS"
```

---

### Task 3: The list filter (both screens)

**Files:**
- Modify: `includes/class-order-list.php` (constructor + new methods)

**Interfaces:**
- Consumes: constants and the class from Task 2.
- Produces: `filter_query_args($args)` (HPOS), `filter_classic_query($query)` (classic), private `is_filter_active()` and `with_invoice_clause($existing)`. Task 4 reuses `is_filter_active()`.

- [ ] **Step 1: Run the filter checks and watch them fail (red)**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
& 'C:\xampp\php\php.exe' tests\check-order-list.php filter
```

Expected: `FAIL exact value "invoice": args get a meta_query`, followed by a fatal `Call to undefined method GRVATIN_Order_List::filter_classic_query()` (a fatal error is a valid red here).

- [ ] **Step 2: Register the two filter hooks**

In the constructor of `includes/class-order-list.php`:

Edit: replace
```php
        add_action('woocommerce_shop_order_list_table_custom_column', array($this, 'render_column'), 10, 2);
```
with
```php
        add_action('woocommerce_shop_order_list_table_custom_column', array($this, 'render_column'), 10, 2);
        add_filter('woocommerce_order_list_table_prepare_items_query_args', array($this, 'filter_query_args'));
```

Edit: replace
```php
        add_action('manage_shop_order_posts_custom_column', array($this, 'render_column_classic'), 10, 2);
```
with
```php
        add_action('manage_shop_order_posts_custom_column', array($this, 'render_column_classic'), 10, 2);
        add_action('pre_get_posts', array($this, 'filter_classic_query'));
```

- [ ] **Step 3: Add the filter methods at the end of the class**

Edit: replace
```php
            $this->render_column($column, $order);
        }
    }
}
```
with
```php
            $this->render_column($column, $order);
        }
    }

    /**
     * True only for ?grvatin_doc=invoice. Read-only list filter: no nonce needed, and the
     * only accepted value is the exact string "invoice".
     */
    private function is_filter_active() {
        // phpcs:ignore WordPress.Security.NonceVerification.Recommended
        if (!isset($_GET[self::FILTER_ARG]) || !is_string($_GET[self::FILTER_ARG])) {
            return false;
        }

        return sanitize_text_field(wp_unslash($_GET[self::FILTER_ARG])) === self::FILTER_VALUE;
    }

    /**
     * The invoice condition, AND-combined with any meta_query that is already there.
     */
    private function with_invoice_clause($existing) {
        $clause = array(
            'key'     => self::META_KEY,
            'value'   => self::FILTER_VALUE,
            'compare' => '=',
        );

        if (empty($existing) || !is_array($existing)) {
            return array($clause);
        }

        return array('relation' => 'AND', $existing, $clause);
    }

    /**
     * Orders table (HPOS): limit the list to invoices when the filter link is active.
     */
    public function filter_query_args($args) {
        if (!is_array($args) || !$this->is_filter_active()) {
            return $args;
        }

        // This filter runs for every order type's list; only touch the regular orders list
        if (isset($args['type']) && $args['type'] !== 'shop_order') {
            return $args;
        }

        $existing = isset($args['meta_query']) ? $args['meta_query'] : array();

        $args['meta_query'] = $this->with_invoice_clause($existing); // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query

        return $args;
    }

    /**
     * Classic (posts) screen: limit the main orders list to invoices when the filter link is active.
     */
    public function filter_classic_query($query) {
        global $pagenow;

        if ($pagenow !== 'edit.php' || !($query instanceof WP_Query) || !$query->is_main_query()) {
            return;
        }

        if ($query->get('post_type') !== 'shop_order' || !$this->is_filter_active()) {
            return;
        }

        // WooCommerce already sets a meta_query here for the customer and created-via filters, so merge
        $query->set('meta_query', $this->with_invoice_clause($query->get('meta_query'))); // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
    }
}
```

- [ ] **Step 4: Lint, deploy, run the filter checks (green)**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
& 'C:\xampp\php\php.exe' -l includes\class-order-list.php
powershell -File tests\deploy-to-xampp.ps1
& 'C:\xampp\php\php.exe' tests\check-order-list.php filter
```

Expected: `... 0 failed`, exit code 0 (about 18 checks). If `both visible seeded invoices are listed` fails, print the filtered args and confirm `wc_get_orders()` accepted the `meta_query` (HPOS) before touching the class.

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
git add includes/class-order-list.php
git commit -m "Orders list: add the invoice filter for the orders table and the classic screen"
```

---

### Task 4: The "Τιμολόγια (N)" filter link

**Files:**
- Modify: `includes/class-order-list.php` (constructor + new methods)

**Interfaces:**
- Consumes: `is_filter_active()` (Task 3) and the constants.
- Produces: `add_view($views)`, public `get_view_link($url, $count, $active)`, public `count_invoices()`, private `without_current($html)`.

- [ ] **Step 1: Run the view checks and watch them fail (red)**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
& 'C:\xampp\php\php.exe' tests\check-order-list.php view
```

Expected: a fatal `Call to undefined method GRVATIN_Order_List::count_invoices()` before any `ok` line (the section reads the count first).

- [ ] **Step 2: Register the two view hooks**

Edit: replace
```php
        add_filter('woocommerce_order_list_table_prepare_items_query_args', array($this, 'filter_query_args'));
```
with
```php
        add_filter('views_woocommerce_page_wc-orders', array($this, 'add_view'));
        add_filter('woocommerce_order_list_table_prepare_items_query_args', array($this, 'filter_query_args'));
```

Edit: replace
```php
        add_action('pre_get_posts', array($this, 'filter_classic_query'));
```
with
```php
        add_filter('views_edit-shop_order', array($this, 'add_view'));
        add_action('pre_get_posts', array($this, 'filter_classic_query'));
```

- [ ] **Step 3: Add the view methods at the end of the class**

Edit: replace
```php
        $query->set('meta_query', $this->with_invoice_clause($query->get('meta_query'))); // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
    }
}
```
with
```php
        $query->set('meta_query', $this->with_invoice_clause($query->get('meta_query'))); // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
    }

    /**
     * Number of invoice orders, counted over the same statuses as WooCommerce's "All" link
     * (trash and drafts excluded), so clicking the filter shows exactly this many rows.
     * Uses meta_key/meta_value because the classic order data store ignores a meta_query.
     */
    public function count_invoices() {
        $statuses = array_values(array_intersect(
            array_keys(wc_get_order_statuses()),
            get_post_stati(array('show_in_admin_all_list' => true), 'names')
        ));

        $result = wc_get_orders(array(
            'type'       => 'shop_order',
            'status'     => $statuses,
            'limit'      => 1,
            'paginate'   => true,
            'return'     => 'ids',
            'meta_key'   => self::META_KEY, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
            'meta_value' => self::FILTER_VALUE, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
        ));

        return (is_object($result) && isset($result->total)) ? (int) $result->total : 0;
    }

    /**
     * One status-row link in WooCommerce's own markup. Always rendered, also for a count of 0.
     */
    public function get_view_link($url, $count, $active) {
        return '<a href="' . esc_url($url) . '"' . ($active ? ' class="current" aria-current="page"' : '') . '>'
            . esc_html__('Τιμολόγια', 'greek-vat-invoices-for-woocommerce')
            . ' <span class="count">(' . esc_html(number_format_i18n((int) $count)) . ')</span></a>';
    }

    /**
     * Append the "Τιμολόγια (N)" link to the status row (orders table and classic screen).
     * Read-only and fail-open: if the count cannot be made the row is left exactly as it was.
     */
    public function add_view($views) {
        if (!is_array($views)) {
            return $views;
        }

        try {
            $base   = (current_filter() === 'views_edit-shop_order')
                ? admin_url('edit.php?post_type=shop_order')
                : admin_url('admin.php?page=wc-orders');
            $active = $this->is_filter_active();
            $link   = $this->get_view_link(add_query_arg(self::FILTER_ARG, self::FILTER_VALUE, $base), $this->count_invoices(), $active);
        } catch (\Throwable $e) {
            return $views;
        }

        // Our filter replaces the status filter, so "All" must not stay highlighted next to it
        if ($active && isset($views['all'])) {
            $views['all'] = $this->without_current($views['all']);
        }

        $views[self::VIEW_KEY] = $link;

        return $views;
    }

    /**
     * Remove the current-link markup (WooCommerce: class="current"; WordPress core adds aria-current).
     */
    private function without_current($html) {
        $stripped = preg_replace(array('/\sclass=(["\'])current\1/', '/\saria-current=(["\'])page\1/'), '', (string) $html);

        return $stripped === null ? $html : $stripped;
    }
}
```

- [ ] **Step 4: Lint, deploy, run every section (green)**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
& 'C:\xampp\php\php.exe' -l includes\class-order-list.php
powershell -File tests\deploy-to-xampp.ps1
& 'C:\xampp\php\php.exe' tests\check-order-list.php all
```

Note: the "(0)" rendering is verified at unit level (`get_view_link(..., 0, ...)`), because the test site's real invoice orders (#384, #385) make a live zero impossible without touching real data. The link has no count condition anywhere, so it is shown regardless.

Expected: `N passed, 0 failed`, exit code 0. The two checks most worth a look if they fail: `count rose by the two visible seeded invoices` (a stale order-query cache would show here: investigate, do not loosen the test) and `the count equals the rows the filter lists` (the count and the list disagree: the statuses or the meta condition differ).

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
git add includes/class-order-list.php
git commit -m "Orders list: add the Τιμολόγια (N) filter link, always shown"
```

---

### Task 5: Browser check on the real Orders screen

**Files:**
- Create: `tests/e2e-orders-list.mjs`

**Interfaces:**
- Consumes: the deployed plugin, seeded orders, a temp admin (`tests/fixtures.php`).
- Produces: pass/fail output and three screenshots (`orders-list-all.png`, `orders-list-preview.png`, `orders-list-invoices.png`).

- [ ] **Step 1: Write `tests/e2e-orders-list.mjs`**

```javascript
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

// Collected from the page: everything the checks need, as plain data
const FACTS = `(() => {
  const rows = [...document.querySelectorAll('table.wp-list-table tbody tr[id^="order-"], table.wp-list-table tbody tr[id^="post-"]')];
  const ours = (tr) => tr.querySelector('td.column-grvatin_doc');
  const link = document.querySelector('ul.subsubsub li.grvatin_invoices a');
  const squash = (s) => s.replace(/\\s+/g, ' ').trim();
  return {
    url: location.href,
    rows: rows.length,
    cells: rows.filter(ours).length,
    icons: rows.filter((tr) => ours(tr) && ours(tr).querySelector('.grvatin-doc-icon')).length,
    head: !!document.querySelector('table.wp-list-table thead th#grvatin_doc'),
    headOrder: [...document.querySelectorAll('table.wp-list-table thead tr > *')].slice(0, 3).map((el) => el.id || ''),
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
  check('every row has the marker cell', all.rows > 0 && all.cells === all.rows, `${all.cells}/${all.rows}`);
  check('the invoice rows show the icon, the others do not', all.icons >= 2 && all.icons < all.rows, `${all.icons}/${all.rows}`);
  const m = (all.linkText || '').match(/^Τιμολόγια \((\d[\d.,]*)\)$/);
  check('filter link reads "Τιμολόγια (N)"', !!m, String(all.linkText));
  check('filter link is the last status link', all.linkIsLast);
  check('"All" is the current link while the filter is off', all.current.length === 1 && /^(All|Όλες)/.test(all.current[0]), JSON.stringify(all.current));
  check('Screen Options names the column', all.labels.some((t) => t.includes('Παραστατικό')), JSON.stringify(all.labels));
  check('no PHP problems printed in the page', !all.phpProblems);
  await shot('orders-list-all.png');
  const n = m ? parseInt(m[1].replace(/[.,]/g, ''), 10) : -1;

  // --- the Quick Preview must be unaffected
  console.log('quick preview (1.2.4) still works');
  await js(`document.querySelector('.grvatin-doc-icon').closest('tr').querySelector('a.order-preview').click();true`);
  await sleep(2000);
  check('preview modal still shows the invoice block', await js(`!!document.querySelector('.wc-backbone-modal .grvatin-preview-invoice')`));
  await shot('orders-list-preview.png');

  // --- the filter
  console.log('orders list, filter active');
  await go(all.linkHref);
  const inv = await js(FACTS);
  check('URL carries grvatin_doc=invoice', inv.url.includes('grvatin_doc=invoice'), inv.url);
  if (n >= 0 && n <= 20) check('rows shown equal the N in the link', inv.rows === n, `${inv.rows} vs ${n}`);
  check('every shown row carries the icon', inv.rows > 0 && inv.icons === inv.rows, `${inv.icons}/${inv.rows}`);
  check('only the Τιμολόγια link is current', inv.current.length === 1 && inv.current[0].startsWith('Τιμολόγια'), JSON.stringify(inv.current));
  check('no PHP problems printed in the page', !inv.phpProblems);
  await shot('orders-list-invoices.png');

  // --- the order edit screen (1.2.5 invoice card) must be unaffected
  console.log('order edit screen (1.2.5 card) still works');
  const editUrl = await js(`document.querySelector('tr .grvatin-doc-icon').closest('tr').querySelector('a.order-view, a.row-title').href`);
  await go(editUrl);
  check('order edit screen still shows the invoice card', await js(`!!document.querySelector('.grvatin-order-card')`));

  // --- the filter combined with a search and with a status must not break anything
  console.log('filter combined with search and with a status');
  await go(`${all.linkHref}&s=GRVATIN`);
  const withSearch = await js(FACTS);
  check('filter + search: no PHP problems, never more rows than the filter alone', !withSearch.phpProblems && withSearch.rows <= inv.rows, `${withSearch.rows} vs ${inv.rows}`);
  await go(`${all.linkHref}&status=wc-processing`);
  const withStatus = await js(FACTS);
  check('filter + status: no PHP problems, every row is still an invoice', !withStatus.phpProblems && withStatus.icons === withStatus.rows, `${withStatus.icons}/${withStatus.rows}`);

  // --- an unknown value is ignored
  console.log('unknown filter value');
  await go(`${all.url}${all.url.includes('?') ? '&' : '?'}grvatin_doc=bogus`);
  const bogus = await js(FACTS);
  check('same rows as the plain list', bogus.rows === all.rows, `${bogus.rows} vs ${all.rows}`);
  check('"All" stays current', bogus.current.length === 1 && /^(All|Όλες)/.test(bogus.current[0]), JSON.stringify(bogus.current));
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
```

- [ ] **Step 2: Syntax-check the script**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
node --check tests\e2e-orders-list.mjs
```

Expected: no output, exit code 0.

- [ ] **Step 3: Run it against the real screen**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
powershell -File tests\deploy-to-xampp.ps1
$shots = Join-Path $env:TEMP 'grvatin-shots'
try {
    $null = & 'C:\xampp\php\php.exe' tests\fixtures.php seed
    $cred = (& 'C:\xampp\php\php.exe' tests\fixtures.php admin-create) | ConvertFrom-Json
    node tests\e2e-orders-list.mjs http://localhost/wordpress $cred.user $cred.pass $shots
} finally {
    & 'C:\xampp\php\php.exe' tests\fixtures.php admin-delete
    & 'C:\xampp\php\php.exe' tests\fixtures.php clean
}
```

Expected: every line `ok`, ending with `All browser checks passed`; the `finally` block prints `deleted` and a count of `5`. The generated admin password is never printed. If a check fails, debug from the printed `at <url>` line and the screenshots (do not weaken a check to make it pass), fix the class or CSS, redeploy and rerun; the `finally` block keeps the site clean either way.

- [ ] **Step 4: Look at the screenshots**

Read the three PNGs in `%TEMP%\grvatin-shots` (`orders-list-all.png`, `orders-list-preview.png`, `orders-list-invoices.png`) and confirm by eye:

- the new column is narrow, sits right after the checkbox, and shows a round blue document icon only on invoice rows;
- the header cell shows only a small grey icon (no text);
- "Τιμολόγια (N)" is the last link of the status row and is bold only on the filtered page;
- the Quick Preview modal still shows its Τιμολόγιο block.

If the icon or column width looks off, adjust the CSS values from Task 2 Step 4, redeploy, rerun Step 3.

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
git add tests/e2e-orders-list.mjs
git add -u
git commit -m "tests: add the browser check for the Orders list marker and filter"
```

(`git add -u` picks up any CSS or class fix made while debugging; if nothing else changed, the commit holds only the script.)

---

### Task 6: Regression, hygiene and the classic-storage decision

**Files:** none changed unless a check finds a problem.

- [ ] **Step 1: Everything green once more, from a clean deploy**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
foreach ($f in 'greek-vat-invoices-for-woocommerce.php','includes\class-order-list.php','includes\class-order-preview.php','includes\class-order-admin-card.php','tests\fixtures.php','tests\check-order-list.php') { & 'C:\xampp\php\php.exe' -l $f }
powershell -File tests\deploy-to-xampp.ps1
& 'C:\xampp\php\php.exe' tests\check-order-list.php all
```

Expected: `No syntax errors` for all six, and `0 failed`.

- [ ] **Step 2: No leftovers anywhere**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
git grep -n "grvatin-invoice-column" -- . ':!docs'
& 'C:\xampp\mysql\bin\mysql.exe' -uroot wordpress -N -e "SELECT 'tagged_hpos_meta', COUNT(*) FROM wp_wc_orders_meta WHERE meta_key='_grvatin_test_fixture'; SELECT 'tagged_post_meta', COUNT(*) FROM wp_postmeta WHERE meta_key='_grvatin_test_fixture'; SELECT 'test_admin', COUNT(*) FROM wp_users WHERE user_login='grvatin_e2e_admin';"
```

Expected: `git grep` prints nothing (the unused class is gone from code; the spec and plan under `docs/` still mention it by design); the SQL prints `0` for all three. A non-zero value means a test run left data behind: run `php tests\fixtures.php clean` and `admin-delete`, then investigate why it was missed.

- [ ] **Step 3: PHP error log is clean**

```powershell
Get-ChildItem 'C:\xampp\php\logs','C:\xampp\apache\logs' -Filter '*.log' -ErrorAction SilentlyContinue | ForEach-Object { "--- $($_.FullName)"; Select-String -Path $_.FullName -Pattern 'class-order-list|GRVATIN_Order_List' | Select-Object -Last 5 }
```

Expected: no lines mentioning `class-order-list` or `GRVATIN_Order_List`. Also check `C:\xampp\htdocs\wordpress\wp-content\debug.log` if it exists.

- [ ] **Step 4: Static checks with Plugin Check's own ruleset (what WordPress.org runs)**

```powershell
cd C:\xampp\htdocs\wordpress\wp-content\plugins\plugin-check
& 'C:\xampp\php\php.exe' vendor\squizlabs\php_codesniffer\bin\phpcs --standard=phpcs-rulesets\plugin-review.xml --extensions=php --report=full 'C:\Users\user\Desktop\greek-vat-invoices-git\includes\class-order-list.php'
& 'C:\xampp\php\php.exe' vendor\squizlabs\php_codesniffer\bin\phpcs --standard=WordPress --sniffs=WordPress.Security.EscapeOutput,WordPress.Security.NonceVerification,WordPress.Security.ValidatedSanitizedInput,WordPress.DB.SlowDBQuery --ignore-annotations --report=full 'C:\Users\user\Desktop\greek-vat-invoices-git\includes\class-order-list.php'
```

Expected: the first command reports no errors. The second (annotations ignored) may list the `$_GET` read and the three slow-query lines; those are covered by the targeted `phpcs:ignore` comments and are expected. It must **not** list `EscapeOutput` findings (all echo output is escaped at the echo). Report anything else to Theodore rather than silencing it.

- [ ] **Step 5: Classic (posts) storage, live test: decision for Theodore**

The CLI checks already cover the classic hooks (`manage_shop_order_posts_columns`, `..._custom_column`, `views_edit-shop_order`, `pre_get_posts`) in isolation. A live browser run needs the site's order storage switched from HPOS to posts, which is an environment change. First look (read-only):

```powershell
& 'C:\xampp\mysql\bin\mysql.exe' -uroot wordpress -N -e "SELECT option_name, option_value FROM wp_options WHERE option_name IN ('woocommerce_custom_orders_table_enabled','woocommerce_custom_orders_table_data_sync_enabled');"
```

- If `data_sync_enabled` is `no`: **do not switch.** Record "classic storage not run live" as a known limit (as in 1.2.5).
- If it is `yes`: tell Theodore the live classic run is possible, and only switch with his OK. The sequence would be: set `woocommerce_custom_orders_table_enabled` to `no`, then rerun Task 5 Step 3 (seed and clean inside the same mode), then set it back to `yes`, then rerun Step 2 above to confirm nothing tagged remains in either table.

Do not switch storage mode on your own initiative.

- [ ] **Step 6: Working tree and branch state**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
git status -sb
git log --oneline -6
```

Expected: clean tree (the untracked `pre-update_*` backup dir from older sessions may not exist in the fresh clone; leave anything unexpected alone), five new commits on top of the spec commit.

---

### Task 7: Release prep (1.2.6): nothing leaves this machine without OK

**Files:**
- Modify: `greek-vat-invoices-for-woocommerce.php` (header `Version:` line 6, constant `GRVATIN_VERSION` line 26)
- Modify: `readme.txt` (`Stable tag`, changelog, upgrade notice)
- Modify: `WHATSNEW.txt` (new top section)

- [ ] **Step 1: Bump the version in the main file**

Edit: replace ` * Version: 1.2.5` with ` * Version: 1.2.6`.
Edit: replace `define('GRVATIN_VERSION', '1.2.5');` with `define('GRVATIN_VERSION', '1.2.6');`.

- [ ] **Step 2: `readme.txt`**

Edit: replace `Stable tag: 1.2.5` with `Stable tag: 1.2.6`.

Edit: replace
```
== Changelog ==

= 1.2.5 (2026-10-14) =
```
with
```
== Changelog ==

= 1.2.6 (2026-10-20) =
* New: the WooCommerce Orders list now marks every order that asked for a Τιμολόγιο with a small document icon in a slim new column, so invoices stand out at a glance in large order lists. Receipts and older orders without a document type show nothing.
* New: a "Τιμολόγια (N)" link at the end of the status row (next to Processing, Completed and so on) lists only the invoice orders. It is always shown, also as "Τιμολόγια (0)", and its count matches the "All" list (trash excluded).
* Works with both the orders table (HPOS) and the classic orders screen. Display and filter only: nothing is written, every value is escaped, and if anything goes wrong the Orders list is shown exactly as WooCommerce builds it.
* Cleanup: removed an unused style rule left over from an older version.

= 1.2.5 (2026-10-14) =
```

Edit: replace
```
== Upgrade Notice ==

= 1.2.5 =
```
with
```
== Upgrade Notice ==

= 1.2.6 =
New: invoices are marked with an icon on the Orders list, plus a "Τιμολόγια" filter link in the status row. Display and filter only — no settings or data changes.

= 1.2.5 =
```

- [ ] **Step 3: `WHATSNEW.txt`**

Edit: replace
```
Version 1.2.5 (2026-10-14)
------------------------------------------------------------
```
with
```
Version 1.2.6 (2026-10-20)
------------------------------------------------------------

 ★ New: Invoice Marker and Filter on the Orders List

   Shops with many orders could not tell at a glance which orders asked
   for a Τιμολόγιο. The WooCommerce Orders list now has:

   • A slim icon column right after the checkbox: a round document icon
     on every order whose document type is Τιμολόγιο. Receipts and older
     orders without a type show nothing.
   • A "Τιμολόγια (N)" link at the end of the status row. One click lists
     only the invoice orders. It is always shown, also as
     "Τιμολόγια (0)", and N matches the "All" list (trash excluded).

   New file:
   • includes/class-order-list.php

   Modified files:
   • greek-vat-invoices-for-woocommerce.php (load + init, version bump)
   • assets/css/admin.css (marker styles; removed the unused
     .grvatin-invoice-column rules)

   Safety notes:
   • Display and filter only: reads existing order meta, writes nothing.
   • Fail-open: if anything goes wrong the Orders list is shown exactly
     as WooCommerce builds it.
   • Works with the orders table (HPOS) and the classic orders screen.
   • The filter accepts only the exact value ?grvatin_doc=invoice.

Version 1.2.5 (2026-10-14)
------------------------------------------------------------
```

- [ ] **Step 4: The three version places agree**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
Select-String -Path greek-vat-invoices-for-woocommerce.php -Pattern 'Version: 1\.2\.|GRVATIN_VERSION'
Select-String -Path readme.txt -Pattern '^Stable tag'
& 'C:\xampp\php\php.exe' -l greek-vat-invoices-for-woocommerce.php
```

Expected: `1.2.6` in the header, in `GRVATIN_VERSION` and in `Stable tag`; no syntax errors.

- [ ] **Step 5: Final full run, then commit**

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
powershell -File tests\deploy-to-xampp.ps1
& 'C:\xampp\php\php.exe' tests\check-order-list.php all
git add greek-vat-invoices-for-woocommerce.php readme.txt WHATSNEW.txt
git commit -m "1.2.6: Mark invoices on the Orders list and add a Τιμολόγια filter"
git log --oneline -3
```

Expected: `0 failed`; the commit message has no attribution trailer.

- [ ] **Step 6: STOP: ask Theodore before anything leaves the machine**

Tell Theodore what is ready (branch, the commits, test results, screenshots in `%TEMP%\grvatin-shots`, the classic-storage limit if it was not run live) and ask for his explicit OK. Only after a yes, and after another `git fetch` confirming `origin/main` still equals `b23f643`:

```powershell
cd C:\Users\user\Desktop\greek-vat-invoices-git
git switch main
git merge --ff-only feature/orders-list-invoice-column
git tag -a v1.2.6 -m "1.2.6"
git push origin main v1.2.6
```

Then the GitHub release (notes = the 1.2.6 changelog text, no attribution line), and the branch can be deleted locally and on GitHub. **Publishing to WordPress.org is a separate decision that also needs his explicit OK.** The SVN working copy `C:\Users\user\Desktop\svn-greek-vat` no longer exists and must be checked out again first; reuse the procedure recorded in the project memory (atomic commit of trunk + tag + assets, verify on the API afterwards).
