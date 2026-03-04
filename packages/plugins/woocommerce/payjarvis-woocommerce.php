<?php
/**
 * Plugin Name: PayJarvis for WooCommerce
 * Description: Verifica BDIT tokens de bots AI antes de processar pagamentos. Proteja sua loja contra transações não autorizadas por agentes AI.
 * Version: 1.0.0
 * Author: PayJarvis
 * Author URI: https://payjarvis.com
 * Requires at least: 6.0
 * Requires PHP: 8.0
 * WC requires at least: 8.0
 * License: MIT
 */

defined('ABSPATH') || exit;

define('PAYJARVIS_WC_VERSION', '1.0.0');
define('PAYJARVIS_WC_PLUGIN_DIR', plugin_dir_path(__FILE__));

// ─── Settings ────────────────────────────────────────

add_action('admin_menu', function () {
    add_submenu_page(
        'woocommerce',
        'PayJarvis Settings',
        'PayJarvis',
        'manage_woocommerce',
        'payjarvis-settings',
        'payjarvis_render_settings_page'
    );
});

add_action('admin_init', function () {
    register_setting('payjarvis_options', 'payjarvis_merchant_id', [
        'type' => 'string',
        'sanitize_callback' => 'sanitize_text_field',
    ]);
    register_setting('payjarvis_options', 'payjarvis_api_url', [
        'type' => 'string',
        'sanitize_callback' => 'esc_url_raw',
        'default' => 'https://api.payjarvis.com',
    ]);
    register_setting('payjarvis_options', 'payjarvis_min_trust_score', [
        'type' => 'integer',
        'sanitize_callback' => 'absint',
        'default' => 50,
    ]);
    register_setting('payjarvis_options', 'payjarvis_enforce_mode', [
        'type' => 'string',
        'sanitize_callback' => 'sanitize_text_field',
        'default' => 'enforce',
    ]);
});

function payjarvis_render_settings_page(): void {
    $merchant_id = get_option('payjarvis_merchant_id', '');
    $api_url = get_option('payjarvis_api_url', 'https://api.payjarvis.com');
    $min_trust = get_option('payjarvis_min_trust_score', 50);
    $mode = get_option('payjarvis_enforce_mode', 'enforce');
    ?>
    <div class="wrap">
        <h1>PayJarvis Settings</h1>
        <form method="post" action="options.php">
            <?php settings_fields('payjarvis_options'); ?>
            <table class="form-table">
                <tr>
                    <th>Merchant ID</th>
                    <td>
                        <input type="text" name="payjarvis_merchant_id"
                               value="<?php echo esc_attr($merchant_id); ?>"
                               class="regular-text" required />
                        <p class="description">Seu ID de merchant no PayJarvis.</p>
                    </td>
                </tr>
                <tr>
                    <th>API URL</th>
                    <td>
                        <input type="url" name="payjarvis_api_url"
                               value="<?php echo esc_attr($api_url); ?>"
                               class="regular-text" />
                    </td>
                </tr>
                <tr>
                    <th>Trust Score Mínimo</th>
                    <td>
                        <input type="number" name="payjarvis_min_trust_score"
                               value="<?php echo esc_attr($min_trust); ?>"
                               min="0" max="100" />
                        <p class="description">Bots com score abaixo deste valor serão bloqueados.</p>
                    </td>
                </tr>
                <tr>
                    <th>Modo</th>
                    <td>
                        <select name="payjarvis_enforce_mode">
                            <option value="enforce" <?php selected($mode, 'enforce'); ?>>
                                Enforce (bloqueia sem token válido)
                            </option>
                            <option value="monitor" <?php selected($mode, 'monitor'); ?>>
                                Monitor (apenas registra, não bloqueia)
                            </option>
                            <option value="disabled" <?php selected($mode, 'disabled'); ?>>
                                Desabilitado
                            </option>
                        </select>
                    </td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}

// ─── BDIT Token Verification ─────────────────────────

require_once PAYJARVIS_WC_PLUGIN_DIR . 'includes/class-payjarvis-verifier.php';

// ─── Checkout Validation ─────────────────────────────

add_action('woocommerce_checkout_process', 'payjarvis_validate_checkout');

function payjarvis_validate_checkout(): void {
    $mode = get_option('payjarvis_enforce_mode', 'enforce');
    if ($mode === 'disabled') {
        return;
    }

    // Detectar se o request vem de um bot AI
    $token = payjarvis_extract_token();
    if ($token === null) {
        // Sem token = provavelmente um humano normal, permitir
        return;
    }

    $merchant_id = get_option('payjarvis_merchant_id', '');
    if (empty($merchant_id)) {
        payjarvis_log('warning', 'Merchant ID not configured, skipping verification');
        return;
    }

    $verifier = new PayJarvis_Verifier(
        $merchant_id,
        get_option('payjarvis_api_url', 'https://api.payjarvis.com'),
        (int) get_option('payjarvis_min_trust_score', 50)
    );

    $result = $verifier->verify($token);

    if (!$result['valid']) {
        payjarvis_log('blocked', $result['reason'], $token);

        if ($mode === 'enforce') {
            wc_add_notice(
                sprintf(
                    'PayJarvis: Transação bloqueada — %s',
                    esc_html($result['reason'])
                ),
                'error'
            );
        }
    } else {
        payjarvis_log('approved', 'Token válido', $token);
        // Salvar metadata do bot no pedido
        WC()->session->set('payjarvis_bot_id', $result['bot']['bot_id'] ?? '');
        WC()->session->set('payjarvis_trust_score', $result['bot']['trust_score'] ?? 0);
    }
}

/**
 * Extrai BDIT token de múltiplas fontes.
 */
function payjarvis_extract_token(): ?string {
    // Header X-BDIT-Token
    $headers = getallheaders();
    if (!empty($headers['X-BDIT-Token'])) {
        return sanitize_text_field($headers['X-BDIT-Token']);
    }
    if (!empty($headers['X-Payjarvis-Token'])) {
        return sanitize_text_field($headers['X-Payjarvis-Token']);
    }

    // Authorization Bearer
    if (!empty($headers['Authorization'])) {
        $auth = $headers['Authorization'];
        if (str_starts_with($auth, 'Bearer ')) {
            return sanitize_text_field(substr($auth, 7));
        }
    }

    // POST body
    if (!empty($_POST['payjarvis_token'])) {
        return sanitize_text_field(wp_unslash($_POST['payjarvis_token']));
    }

    // Cookie
    if (!empty($_COOKIE['bdit_token'])) {
        return sanitize_text_field(wp_unslash($_COOKIE['bdit_token']));
    }

    return null;
}

// ─── Order Metadata ──────────────────────────────────

add_action('woocommerce_checkout_create_order', function ($order) {
    $session = WC()->session;
    if ($session === null) {
        return;
    }

    $bot_id = $session->get('payjarvis_bot_id');
    if (!empty($bot_id)) {
        $order->update_meta_data('_payjarvis_bot_id', sanitize_text_field($bot_id));
        $order->update_meta_data(
            '_payjarvis_trust_score',
            (int) $session->get('payjarvis_trust_score')
        );
        $order->update_meta_data('_payjarvis_verified', 'yes');
    }
});

// Mostrar info do bot no admin do pedido
add_action('woocommerce_admin_order_data_after_billing_address', function ($order) {
    $bot_id = $order->get_meta('_payjarvis_bot_id');
    if (empty($bot_id)) {
        return;
    }
    printf(
        '<div class="payjarvis-order-meta">'
        . '<h3>PayJarvis Bot Info</h3>'
        . '<p><strong>Bot ID:</strong> %s</p>'
        . '<p><strong>Trust Score:</strong> %d/100</p>'
        . '<p><strong>Verified:</strong> %s</p>'
        . '</div>',
        esc_html($bot_id),
        (int) $order->get_meta('_payjarvis_trust_score'),
        esc_html($order->get_meta('_payjarvis_verified'))
    );
});

// ─── Adapter Script Injection ────────────────────────

add_action('wp_enqueue_scripts', function () {
    if (!is_checkout()) {
        return;
    }
    $merchant_id = get_option('payjarvis_merchant_id', '');
    if (empty($merchant_id)) {
        return;
    }
    $api_url = get_option('payjarvis_api_url', 'https://api.payjarvis.com');
    wp_enqueue_script(
        'payjarvis-adapter',
        esc_url($api_url . '/adapter.js'),
        [],
        PAYJARVIS_WC_VERSION,
        ['strategy' => 'defer']
    );
    wp_script_add_data('payjarvis-adapter', 'data-merchant', $merchant_id);
});

// ─── Logging ─────────────────────────────────────────

function payjarvis_log(string $level, string $message, ?string $token = null): void {
    if (!function_exists('wc_get_logger')) {
        return;
    }
    $logger = wc_get_logger();
    $context = ['source' => 'payjarvis'];

    $log_msg = sprintf('[PayJarvis] %s', $message);
    if ($token !== null) {
        // Apenas logar os últimos 8 chars do token por segurança
        $log_msg .= sprintf(' (token: ...%s)', substr($token, -8));
    }

    match ($level) {
        'blocked' => $logger->warning($log_msg, $context),
        'warning' => $logger->warning($log_msg, $context),
        'approved' => $logger->info($log_msg, $context),
        default => $logger->debug($log_msg, $context),
    };
}
