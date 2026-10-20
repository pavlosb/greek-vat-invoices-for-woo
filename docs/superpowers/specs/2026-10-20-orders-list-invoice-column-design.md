# Invoice Marker and Filter on the Orders List

Date: 2026-10-20
Status: Implemented and tested locally (not yet released)
Target release: 1.2.6

## Problem

A WordPress.org user reported that the plugin lacks an indicator on the Orders
list: shops with large order volumes cannot tell at a glance which orders asked
for a Τιμολόγιο, and cannot isolate them. Today the list shows nothing from the
plugin except the eye-icon Quick Preview (1.2.4). The `.grvatin-invoice-column`
rule in `assets/css/admin.css` is an unused leftover of an old version; no PHP
prints it.

## Decision

The store owner was shown three mockups of the same list and chose **option C**:

- A. A "Τιμολόγιο" badge next to the order name in the existing Order column.
  (rejected: the cell is already busy, no way to isolate invoices)
- B. A new "Παραστατικό" column with an icon on every row, Τιμολόγιο and
  Απόδειξη alike. (rejected: most orders are receipts, so an icon on every row
  becomes wallpaper and the column is wide)
- C. A slim icon-only column that marks **only** Τιμολόγιο rows, plus a
  **Τιμολόγια** filter link in the status row. (chosen)

Change requested on option C: the filter link is **always shown**, also when the
shop has no invoices yet. With none it reads "Τιμολόγια (0)". It is not hidden
the way WooCommerce hides empty statuses.

Interpretation: "sort the orders with τιμολόγιο" is served by the filter. A
sortable column header was left out on purpose: ordering by a custom field is
fragile in WooCommerce's orders table, and the filter covers the need.

## Design

New class `GRVATIN_Order_List` (`includes/class-order-list.php`), loaded and
instantiated next to `GRVATIN_Order_Preview` and `GRVATIN_Order_Admin_Card`.
WooCommerce has two list screens, so every piece is hooked twice:

| Piece | Orders table (HPOS) | Classic (posts) screen |
|---|---|---|
| Add column | `woocommerce_shop_order_list_table_columns` | `manage_shop_order_posts_columns` (priority 20: WooCommerce rebuilds this list at priority 10) |
| Print cell | `woocommerce_shop_order_list_table_custom_column` (gets the order) | `manage_shop_order_posts_custom_column` (gets the post ID, load with `wc_get_order()`) |
| Add filter link | `views_woocommerce_page_wc-orders` | `views_edit-shop_order` |
| Apply filter | `woocommerce_order_list_table_prepare_items_query_args` | `pre_get_posts` (main query of that screen only) |

Hook names were checked against the WooCommerce 11.1 source on the local test
site; the classic-screen ones are standard WordPress hooks.

### The column

- Key `grvatin_doc`, inserted right after the checkbox column.
- Header: icon only, with the screen-reader text "Παραστατικό".
- Cell: a Dashicon in a small round accent badge, with a `title` and a
  screen-reader text "Τιμολόγιο" (no `aria-label`), only when
  `_billing_invoice_type` is `invoice`. Receipts, and orders with no type
  (placed before the plugin existed), show an empty cell.
- A narrow width is requested through `.column-grvatin_doc`, but the real width
  is the proportional share of WooCommerce's fixed table layout (about 96px, see
  Known limits). Screen Options can hide the column; the filter link still works
  then.
- On phones (viewport 782px and below) WordPress hides only the cells AFTER the
  primary column. Our column sits before it, so the marker stays visible in the
  collapsed row. WordPress also prints each visible cell's column name as a
  `::before` label, which showed as a clipped "Π…" over the icon and squeezed the
  Status pill to "Proce…". A `max-width: 782px` rule hides that label and makes
  the column tight (found by the mobile browser check; verified at 375px on both
  screens).

### The filter link

- Appended last in the status row: "Τιμολόγια (N)", in the same markup as
  WooCommerce's own links, with the `current` class and bold when active.
- URL parameter `grvatin_doc=invoice`. Only the exact value `invoice` is
  accepted; anything else is ignored. Read-only, so no nonce (same as
  WooCommerce's own status filter).
- Active filter adds the condition `_billing_invoice_type = invoice` to the
  order query. The link carries no status, so it lists invoices of every status
  that "Όλες" lists.
- Always shown, including "Τιμολόγια (0)". Clicking it with zero invoices shows
  WooCommerce's normal empty list.
- N is one count query that runs only on the Orders screen. It must use the same
  statuses as the "Όλες" count, so clicking the link shows exactly N rows
  (trash and drafts excluded). The plan must verify this equality. The count
  query uses `meta_key` / `meta_value` (not `meta_query`) because the classic
  order data store ignores a `meta_query`; the orders-table list filter uses
  `meta_query`, which `OrdersTableQuery` AND-combines with existing filters.
- The filter keeps itself through the list's search box and Filter button.
  Both are GET forms that carry only fixed hidden fields, so the browser would
  drop `grvatin_doc` from the request. `print_filter_field()` therefore prints a
  hidden `grvatin_doc=invoice` input into the list form while the filter is
  active (HPOS: `woocommerce_order_list_table_restrict_manage_orders`; classic:
  `restrict_manage_posts`). Found by the final whole-branch review.

### Styling and strings

- A small rule set appended to `assets/css/admin.css`, scoped to
  `table.wp-list-table .column-grvatin_doc` and `.grvatin-doc-icon`. (The
  `table.` prefix is needed: WooCommerce's own `th { width: 12ch }` rule would
  otherwise win on specificity.)
- `admin.css` already loads on the orders-table (HPOS) screen through
  `enqueue_admin_scripts()` (its hook name contains `woocommerce`). It did NOT
  load on the classic posts screen: there the hook is `edit.php` and
  `get_post_type()` is false (no global post is set yet). `enqueue_admin_scripts()`
  therefore gets a stylesheet-only `elseif` branch for screen id
  `edit-shop_order`; nothing else changes for other screens.
- The new column must not become WordPress's default primary column (the one
  that stays visible on phones): a `list_table_primary_column` filter at
  priority 20 maps our column back to `order_number`. Found by the first real
  browser render.
- The unused `.grvatin-invoice-column` rules are removed from `admin.css`.
- Strings follow the surrounding code (Greek source strings, text domain
  `greek-vat-invoices-for-woocommerce`): Τιμολόγιο, Παραστατικό, Τιμολόγια.

### Safety

- Read-only: no writes, no new options, no schema change.
- Fail-open: the column and link code run inside `try/catch (\Throwable)` where
  a failure could otherwise break the list; on error the list renders exactly as
  WooCommerce builds it, without our marker or link.
- Meta is read from order objects the list already loaded, so no extra query per
  row. The only added query is the one count.
- All output escaped at the point of echo (`esc_html`, `esc_attr`, `esc_url`).

## Testing plan (local XAMPP, WP 7.1, WooCommerce 11.1)

Seed orders: Block-checkout invoice, Block-checkout receipt, Classic invoice, an
order with no plugin data, one in trash. Then, in headless Chrome:

- HPOS screen: icon on invoice rows only; link shows the right count; clicking
  it lists exactly the invoice rows; "Όλες" unaffected; link marked current.
- Zero invoices: "Τιμολόγια (0)" is shown, click gives the normal empty list.
- Classic (posts) storage mode: the same checks.
- Invalid `grvatin_doc` value is ignored (full list, no error).
- Combined with search, pagination and a status link: no PHP notices.
- Quick Preview (1.2.4) and the order card (1.2.5) unchanged.
- Query count: no per-row queries added beyond the single count.
- No PHP error-log lines, no JS console errors, `php -l` clean.

## What testing found (2026-10-20)

Results on the local XAMPP site (WP 7.1, WooCommerce 11.1, HPOS, real orders
present, only tagged fixtures created and removed again):

- CLI integration checks (`tests/check-order-list.php`): 71 passed, 0 failed on
  the real shop (HPOS) AND on a clean-room install in classic storage (the
  checks look up the listed rows through the path the active storage really
  uses).
- Headless Chrome on the real HPOS Orders screen (`tests/e2e-orders-list.mjs`):
  all 46 checks passed, with screenshots reviewed by eye. The same script on the
  classic posts screen of a clean-room WordPress 7.1 + WooCommerce 11.1 install
  (only WooCommerce and this plugin, HPOS off, orders in `wp_posts`): 46 passed.
  The checks are anchored to the seeded fixture rows by name and never act on a
  real order.
- Mobile mode (`GRVATIN_MOBILE=1`, 375px viewport): 29 checks passed on HPOS and
  26 on classic (the classic screen has no row toggle, so those steps are
  skipped there).
- Plugin Check's `plugin-review.xml` ruleset: no findings on the new class.
- The real browser caught defects the CLI checks could not: the new column
  became the primary column; WooCommerce's CSS overrode the column width; the
  icon circle was invisible on striped rows; on phones a clipped "Π…" label
  overlapped the icon and squeezed the Status pill. It also corrected two wrong
  assumptions of this spec: `admin.css` did not load on the classic screen, and
  `sanitize_text_field` made the filter accept `invoice%20` (now an exact
  comparison).

## Known limits

- The classic (posts) screen was verified live only in the clean-room install,
  not on the owner's real shop with its other plugins: WooCommerce refuses to
  switch the authoritative order table while orders are out of sync (the shop's
  data sync is off), and the switch was deliberately not forced. On the owner's
  real HPOS screen the other plugins (for example the barcode column) were
  present during every browser run.
- Narrow-desktop widths (783px to about 1100px) were not looked at; phone width
  (375px) was. The column renders about 96px wide on desktop (a proportional
  share of the fixed table layout, not a hard width).
- "Τιμολόγια (0)" is verified at unit level only: the site's real invoice orders
  make a live zero impossible without touching real data. The text is checked
  through `get_view_link()` only; a code guard in `add_view()` is excluded by
  reading the code, not by a test.
- Users who can edit orders but lack `edit_others_shop_orders` get the HPOS
  screen id `admin_page_wc-orders`. They see the marker column unstyled (the
  header text is visible) and no "Τιμολόγια" link, while the URL filter still
  works.
- The count N uses WooCommerce's default "All" statuses, so it can differ from
  the rows shown if another plugin changes
  `woocommerce_shop_order_list_table_default_statuses`.

## Out of scope

- A sortable column header.
- An "Αποδείξεις" (receipt) filter or receipt icons.
- Bulk actions, export columns, or showing ΑΦΜ / company name in the list.
- WordPress.org publishing: it happens only after the owner's explicit OK.
