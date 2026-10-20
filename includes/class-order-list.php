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
        add_filter('woocommerce_order_list_table_prepare_items_query_args', array($this, 'filter_query_args'));

        // Classic (posts) orders screen. WooCommerce rebuilds this column list at priority 10, so run after it.
        add_filter('manage_shop_order_posts_columns', array($this, 'add_column'), 20);
        add_action('manage_shop_order_posts_custom_column', array($this, 'render_column_classic'), 10, 2);
        add_action('pre_get_posts', array($this, 'filter_classic_query'));
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
