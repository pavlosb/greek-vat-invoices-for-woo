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
