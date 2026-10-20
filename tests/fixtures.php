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

        // Read the ID before trashing: WC_Data::delete() resets the object's ID to 0
        $ids[$name] = $order->get_id();

        if ($trash) {
            $order->delete(false);
        }
    }

    return $ids;
}

/**
 * Permanently delete every tagged test order (trash included). Returns how many were actually deleted.
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

    $deleted = 0;
    foreach ($ids as $id) {
        $order = wc_get_order($id);
        // Per-order re-check: a storage mode that ignores the meta query must never delete real orders.
        if ($order && $order->get_meta(GRVATIN_TEST_TAG) === '1' && $order->delete(true)) {
            $deleted++;
        }
    }

    return $deleted;
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
