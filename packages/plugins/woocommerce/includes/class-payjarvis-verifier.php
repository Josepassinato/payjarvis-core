<?php
/**
 * PayJarvis BDIT Token Verifier para WooCommerce.
 *
 * Verifica JWT tokens RS256 usando JWKS endpoint com cache.
 */

defined('ABSPATH') || exit;

class PayJarvis_Verifier {
    private string $merchant_id;
    private string $api_url;
    private int $min_trust_score;
    private const JWKS_CACHE_KEY = 'payjarvis_jwks_cache';
    private const JWKS_CACHE_TTL = 86400; // 24h

    public function __construct(
        string $merchant_id,
        string $api_url = 'https://api.payjarvis.com',
        int $min_trust_score = 50
    ) {
        $this->merchant_id = $merchant_id;
        $this->api_url = rtrim($api_url, '/');
        $this->min_trust_score = $min_trust_score;
    }

    /**
     * Verifica um BDIT token.
     *
     * @return array{valid: bool, reason?: string, bot?: array}
     */
    public function verify(string $token): array {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return ['valid' => false, 'reason' => 'Invalid token format'];
        }

        // Decodificar header e payload
        $header = $this->base64url_decode($parts[0]);
        $payload = $this->base64url_decode($parts[1]);

        if ($header === false || $payload === false) {
            return ['valid' => false, 'reason' => 'Failed to decode token'];
        }

        $header_data = json_decode($header, true);
        $payload_data = json_decode($payload, true);

        if (!is_array($header_data) || !is_array($payload_data)) {
            return ['valid' => false, 'reason' => 'Invalid token JSON'];
        }

        // Verificar algoritmo
        if (($header_data['alg'] ?? '') !== 'RS256') {
            return ['valid' => false, 'reason' => 'Unsupported algorithm'];
        }

        // Verificar issuer
        if (($payload_data['iss'] ?? '') !== 'payjarvis') {
            return ['valid' => false, 'reason' => 'Invalid issuer'];
        }

        // Verificar expiração
        $exp = $payload_data['exp'] ?? 0;
        if ($exp * 1 < time()) {
            return ['valid' => false, 'reason' => 'Token expired'];
        }

        // Verificar campos obrigatórios
        if (empty($payload_data['bot_id']) || empty($payload_data['merchant_id']) || empty($payload_data['jti'])) {
            return ['valid' => false, 'reason' => 'Missing required BDIT fields'];
        }

        // Verificar merchant
        if ($payload_data['merchant_id'] !== $this->merchant_id) {
            return [
                'valid' => false,
                'reason' => sprintf(
                    'Merchant mismatch: token=%s, expected=%s',
                    $payload_data['merchant_id'],
                    $this->merchant_id
                ),
            ];
        }

        // Verificar trust score
        $trust_score = (int) ($payload_data['trust_score'] ?? 0);
        if ($trust_score < $this->min_trust_score) {
            return [
                'valid' => false,
                'reason' => sprintf(
                    'Trust score %d below minimum %d',
                    $trust_score,
                    $this->min_trust_score
                ),
            ];
        }

        // Verificar assinatura via JWKS
        $kid = $header_data['kid'] ?? null;
        $signature_valid = $this->verify_signature(
            $parts[0] . '.' . $parts[1],
            $this->base64url_decode_raw($parts[2]),
            $kid
        );

        if (!$signature_valid) {
            return ['valid' => false, 'reason' => 'Invalid signature'];
        }

        return [
            'valid' => true,
            'bot' => $payload_data,
        ];
    }

    /**
     * Verifica assinatura RS256 usando JWKS.
     */
    private function verify_signature(string $signed_data, string $signature, ?string $kid): bool {
        $jwks = $this->get_jwks();
        if ($jwks === null) {
            return false;
        }

        $key = $this->find_key($jwks, $kid);
        if ($key === null) {
            // Limpar cache e tentar novamente
            delete_transient(self::JWKS_CACHE_KEY);
            $jwks = $this->get_jwks();
            if ($jwks === null) {
                return false;
            }
            $key = $this->find_key($jwks, $kid);
            if ($key === null) {
                return false;
            }
        }

        $public_key = $this->jwk_to_pem($key);
        if ($public_key === false) {
            return false;
        }

        return openssl_verify(
            $signed_data,
            $signature,
            $public_key,
            OPENSSL_ALGO_SHA256
        ) === 1;
    }

    /**
     * Busca JWKS com cache via WordPress transients.
     */
    private function get_jwks(): ?array {
        $cached = get_transient(self::JWKS_CACHE_KEY);
        if (is_array($cached)) {
            return $cached;
        }

        $response = wp_remote_get(
            $this->api_url . '/.well-known/jwks.json',
            ['timeout' => 10]
        );

        if (is_wp_error($response)) {
            return null;
        }

        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);

        if (!is_array($data) || empty($data['keys'])) {
            return null;
        }

        set_transient(self::JWKS_CACHE_KEY, $data, self::JWKS_CACHE_TTL);

        return $data;
    }

    /**
     * Encontra a chave RSA no JWKS pelo kid.
     */
    private function find_key(array $jwks, ?string $kid): ?array {
        foreach ($jwks['keys'] as $key) {
            if ($kid !== null && ($key['kid'] ?? '') !== $kid) {
                continue;
            }
            if (($key['kty'] ?? '') === 'RSA' && ($key['use'] ?? 'sig') === 'sig') {
                return $key;
            }
        }
        return null;
    }

    /**
     * Converte JWK RSA para PEM.
     */
    private function jwk_to_pem(array $jwk): string|false {
        if (empty($jwk['n']) || empty($jwk['e'])) {
            return false;
        }

        $modulus = $this->base64url_decode_raw($jwk['n']);
        $exponent = $this->base64url_decode_raw($jwk['e']);

        // Construir DER encoding para RSA public key
        $mod_header = $this->asn1_length(strlen($modulus));
        $exp_header = $this->asn1_length(strlen($exponent));

        // Se o primeiro byte tem bit alto, precisa prefixo 0x00
        if (ord($modulus[0]) > 0x7f) {
            $modulus = "\x00" . $modulus;
            $mod_header = $this->asn1_length(strlen($modulus));
        }
        if (ord($exponent[0]) > 0x7f) {
            $exponent = "\x00" . $exponent;
            $exp_header = $this->asn1_length(strlen($exponent));
        }

        $rsa_seq = "\x02" . $mod_header . $modulus
                 . "\x02" . $exp_header . $exponent;
        $rsa_seq = "\x30" . $this->asn1_length(strlen($rsa_seq)) . $rsa_seq;

        // BitString wrapper
        $bit_string = "\x00" . $rsa_seq;
        $bit_string = "\x03" . $this->asn1_length(strlen($bit_string)) . $bit_string;

        // AlgorithmIdentifier: rsaEncryption OID
        $alg_id = "\x30\x0d\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01\x05\x00";

        // SubjectPublicKeyInfo
        $spki = "\x30" . $this->asn1_length(strlen($alg_id) + strlen($bit_string))
              . $alg_id . $bit_string;

        $pem = "-----BEGIN PUBLIC KEY-----\n"
             . chunk_split(base64_encode($spki), 64, "\n")
             . "-----END PUBLIC KEY-----";

        return $pem;
    }

    private function asn1_length(int $length): string {
        if ($length < 0x80) {
            return chr($length);
        }
        $temp = ltrim(pack('N', $length), "\x00");
        return chr(0x80 | strlen($temp)) . $temp;
    }

    private function base64url_decode(string $data): string|false {
        $decoded = base64_decode(
            strtr($data, '-_', '+/') . str_repeat('=', 3 - (3 + strlen($data)) % 4)
        );
        return $decoded;
    }

    private function base64url_decode_raw(string $data): string {
        return base64_decode(
            strtr($data, '-_', '+/') . str_repeat('=', 3 - (3 + strlen($data)) % 4)
        ) ?: '';
    }
}
