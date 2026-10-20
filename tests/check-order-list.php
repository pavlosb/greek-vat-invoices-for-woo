<?php
/**
 * Integration checks for GRVATIN_Order_List. Dev-only, CLI only, never shipped (see .gitattributes).
 *
 * Runs against the WordPress/WooCommerce site and the plugin copy deployed there (see
 * tests/deploy-to-xampp.ps1). Seeds tagged test orders, checks, and deletes them again.
 *
 *   C:\xampp\php\php.exe tests/check-order-list.php [all|columns|cell|filter|view|enqueue]
 */

if (PHP_SAPI !== 'cli') {
    exit;
}

require __DIR__ . '/fixtures.php';

$section  = isset($argv[1]) ? $argv[1] : 'all';
$passes   = 0;
$failures = 0;

if (!in_array($section, array('all', 'columns', 'cell', 'filter', 'view', 'enqueue'), true)) {
    echo "unknown section: $section (use all|columns|cell|filter|view|enqueue)\n";
    exit(2);
}

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

// The statuses WooCommerce's "All" list shows, written out independently of the class under test
function list_statuses() {
    return array_values(array_intersect(
        array_keys(wc_get_order_statuses()),
        get_post_stati(array('show_in_admin_all_list' => true), 'names')
    ));
}

function has_no_meta_query($query) {
    $mq = $query->get('meta_query');
    return $mq === '' || $mq === array();
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
register_shutdown_function('grvatin_fixture_clean'); // registered before seeding, so a failed seed still cleans up
$before = wants('view') ? $list->count_invoices() : 0;
$ids    = grvatin_fixture_seed();
echo '  seeded: ' . show($ids) . "\n";
check('all five fixtures were created (every ID > 0)', count($ids) === 5 && min($ids) > 0, show($ids));

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

    // WordPress takes the first non-checkbox column as the primary one; that must stay the order number
    check('primary column: ours is never the primary, the order number is', apply_filters('list_table_primary_column', 'grvatin_doc', 'woocommerce_page_wc-orders') === 'order_number');
    check('primary column: another default passes through', apply_filters('list_table_primary_column', 'order_number', 'woocommerce_page_wc-orders') === 'order_number' && apply_filters('list_table_primary_column', 'name', 'plugins') === 'name');

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

    $hook = 'woocommerce_order_list_table_prepare_items_query_args';
    $base = array('type' => 'shop_order', 'status' => list_statuses(), 'limit' => -1, 'return' => 'ids');

    unset($_GET['grvatin_doc']);
    check('no parameter: query args untouched', apply_filters($hook, $base) === $base);

    foreach (array('receipt', '', 'INVOICE', array('invoice'), 'invoice ', ' invoice', "invoice\n", 'invoice<b></b>') as $bad_value) {
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
    check('classic: pre_get_posts is wired to filter_classic_query', has_action('pre_get_posts', array($list, 'filter_classic_query')) !== false);

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
    check('classic: other post types untouched', has_no_meta_query($q));

    $q = $make_query('shop_order');
    $GLOBALS['wp_the_query'] = new WP_Query();
    $list->filter_classic_query($q);
    check('classic: a secondary query is untouched', has_no_meta_query($q));

    $q = $make_query('shop_order');
    $GLOBALS['wp_the_query'] = $q;
    $GLOBALS['pagenow']      = 'index.php';
    $list->filter_classic_query($q);
    check('classic: outside edit.php untouched', has_no_meta_query($q));

    $q = $make_query('shop_order');
    $GLOBALS['wp_the_query'] = $q;
    $GLOBALS['pagenow']      = 'edit.php';
    unset($_GET['grvatin_doc']);
    $list->filter_classic_query($q);
    check('classic: no parameter untouched', has_no_meta_query($q));

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
    $status_args = array('type' => 'shop_order', 'status' => list_statuses(), 'limit' => -1, 'return' => 'ids');
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
    try {
        $failed = $list->add_view($views_in);
    } finally {
        remove_filter('wc_order_statuses', $thrower);
    }
    check('fail-open: views unchanged when the count throws', $failed === $views_in);
}

// ---------------------------------------------------------------- enqueue
if (wants('enqueue')) {
    echo "enqueue\n";

    require_once ABSPATH . 'wp-admin/includes/class-wp-screen.php';
    require_once ABSPATH . 'wp-admin/includes/screen.php';

    $plugin       = GRVATIN_Greek_VAT_Invoices::get_instance();
    $saved_screen = isset($GLOBALS['current_screen']) ? $GLOBALS['current_screen'] : null;

    // hook suffix, screen id, expected: is admin.css enqueued?
    $cases = array(
        array('woocommerce_page_wc-orders', 'woocommerce_page_wc-orders', true),  // orders table (HPOS)
        array('edit.php', 'edit-shop_order', true),                               // classic orders list
        array('edit.php', 'edit-post', false),                                    // a plain posts list
        array('index.php', 'dashboard', false),                                   // dashboard
    );

    foreach ($cases as $case) {
        list($hook, $screen_id, $expected) = $case;
        wp_dequeue_style('wcgvi-admin');
        $GLOBALS['current_screen'] = WP_Screen::get($screen_id);
        $plugin->enqueue_admin_scripts($hook);
        check("admin.css enqueued on $screen_id ($hook) = " . ($expected ? 'yes' : 'no'), wp_style_is('wcgvi-admin', 'enqueued') === $expected);
    }

    wp_dequeue_style('wcgvi-admin');
    $GLOBALS['current_screen'] = $saved_screen;
}

if ($passes + $failures === 0) {
    echo "\nFAIL no checks ran\n";
    exit(1);
}

echo "\n$passes passed, $failures failed\n";
exit($failures > 0 ? 1 : 0);
