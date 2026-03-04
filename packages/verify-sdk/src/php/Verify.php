<?php
/**
 * PayJarvis BDIT Verification SDK — PHP
 *
 * Verifica BDIT tokens localmente usando JWKS.
 *
 * Usage:
 *   require_once 'Verify.php';
 *   use PayJarvis\Verify;
 *
 *   $result = Verify::bdit(
 *       token: $_SERVER['HTTP_X_BDIT_TOKEN'],
 *       merchantId: 'your-merchant-id'
 *   );
 *
 *   if ($result->verified) {
 *       echo "Bot {$result->bot->id} authorized";
 *   }
 *
 * Requirements: PHP 8.0+, ext-openssl
 */

namespace PayJarvis;

class Verify
{
    private const DEFAULT_JWKS_URL = 'https://api.payjarvis.com/.well-known/jwks.json';
    private const JWKS_CACHE_TTL = 86400; // 24h

    private static array $jwksCache = [];

    /**
     * Verify a BDIT token.
     */
    public static function bdit(
        string $token,
        string $merchantId,
        string $jwksUrl = self::DEFAULT_JWKS_URL,
        int $minTrustScore = 0
    ): object {
        if (empty($token)) {
            return (object) ['verified' => false, 'error' => 'No token provided'];
        }

        if (empty($merchantId)) {
            return (object) ['verified' => false, 'error' => 'No merchantId provided'];
        }

        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return (object) ['verified' => false, 'error' => 'Invalid token format'];
        }

        // Decode header and payload
        $header = json_decode(self::base64urlDecode($parts[0]), true);
        $payload = json_decode(self::base64urlDecode($parts[1]), true);

        if (!is_array($header) || !is_array($payload)) {
            return (object) ['verified' => false, 'error' => 'Invalid token JSON'];
        }

        // Check algorithm
        if (($header['alg'] ?? '') !== 'RS256') {
            return (object) ['verified' => false, 'error' => 'Unsupported algorithm'];
        }

        // Check issuer
        if (($payload['iss'] ?? '') !== 'payjarvis') {
            return (object) ['verified' => false, 'error' => 'Invalid issuer'];
        }

        // Check expiration
        if (($payload['exp'] ?? 0) < time()) {
            return (object) ['verified' => false, 'error' => 'Token expired'];
        }

        // Check required fields
        foreach (['bot_id', 'merchant_id', 'jti'] as $field) {
            if (empty($payload[$field])) {
                return (object) ['verified' => false, 'error' => "Missing required field: {$field}"];
            }
        }

        // Check merchant
        if ($payload['merchant_id'] !== $merchantId) {
            return (object) [
                'verified' => false,
                'error' => "Merchant mismatch: token has '{$payload['merchant_id']}', expected '{$merchantId}'",
            ];
        }

        // Check trust score
        $trustScore = (int) ($payload['trust_score'] ?? 0);
        if ($trustScore < $minTrustScore) {
            return (object) [
                'verified' => false,
                'error' => "Trust score {$trustScore} below minimum {$minTrustScore}",
            ];
        }

        // Verify signature
        $signedData = $parts[0] . '.' . $parts[1];
        $signature = self::base64urlDecode($parts[2]);
        $kid = $header['kid'] ?? null;

        $publicKey = self::getPublicKey($jwksUrl, $kid);
        if ($publicKey === null) {
            return (object) ['verified' => false, 'error' => 'Could not fetch public key'];
        }

        $valid = openssl_verify($signedData, $signature, $publicKey, OPENSSL_ALGO_SHA256);
        if ($valid !== 1) {
            return (object) ['verified' => false, 'error' => 'Invalid signature'];
        }

        return (object) [
            'verified' => true,
            'bot' => (object) [
                'id' => $payload['bot_id'],
                'ownerId' => $payload['owner_id'] ?? null,
                'trustScore' => $trustScore,
                'kycLevel' => (int) ($payload['kyc_level'] ?? 0),
            ],
            'authorization' => (object) [
                'amount' => (float) ($payload['amount'] ?? 0),
                'currency' => 'USD',
                'category' => $payload['category'] ?? '',
                'merchantId' => $payload['merchant_id'],
                'validUntil' => gmdate('Y-m-d\TH:i:s\Z', $payload['exp']),
                'oneTimeUse' => true,
                'jti' => $payload['jti'],
            ],
        ];
    }

    /**
     * Extract BDIT token from HTTP request sources.
     */
    public static function extractToken(): ?string
    {
        $headers = function_exists('getallheaders') ? getallheaders() : [];

        if (!empty($headers['X-BDIT-Token'])) return $headers['X-BDIT-Token'];
        if (!empty($headers['X-Payjarvis-Token'])) return $headers['X-Payjarvis-Token'];

        $auth = $headers['Authorization'] ?? '';
        if (str_starts_with($auth, 'Bearer ')) return substr($auth, 7);

        if (!empty($_COOKIE['bdit_token'])) return $_COOKIE['bdit_token'];
        if (!empty($_POST['bditToken'])) return $_POST['bditToken'];

        return null;
    }

    private static function getPublicKey(string $jwksUrl, ?string $kid): string|false|null
    {
        $jwks = self::fetchJwks($jwksUrl);
        if ($jwks === null) return null;

        $key = self::findKey($jwks, $kid);
        if ($key === null) {
            // Clear cache and retry
            unset(self::$jwksCache[$jwksUrl]);
            $jwks = self::fetchJwks($jwksUrl);
            if ($jwks === null) return null;
            $key = self::findKey($jwks, $kid);
        }

        if ($key === null) return null;
        return self::jwkToPem($key);
    }

    private static function fetchJwks(string $url): ?array
    {
        if (isset(self::$jwksCache[$url])) {
            $cached = self::$jwksCache[$url];
            if ($cached['expires'] > time()) {
                return $cached['data'];
            }
        }

        $context = stream_context_create(['http' => ['timeout' => 10]]);
        $body = @file_get_contents($url, false, $context);
        if ($body === false) return null;

        $data = json_decode($body, true);
        if (!is_array($data) || empty($data['keys'])) return null;

        self::$jwksCache[$url] = [
            'data' => $data,
            'expires' => time() + self::JWKS_CACHE_TTL,
        ];

        return $data;
    }

    private static function findKey(array $jwks, ?string $kid): ?array
    {
        foreach ($jwks['keys'] as $key) {
            if ($kid !== null && ($key['kid'] ?? '') !== $kid) continue;
            if (($key['kty'] ?? '') === 'RSA' && ($key['use'] ?? 'sig') === 'sig') {
                return $key;
            }
        }
        return null;
    }

    private static function jwkToPem(array $jwk): string|false
    {
        if (empty($jwk['n']) || empty($jwk['e'])) return false;

        $modulus = self::base64urlDecode($jwk['n']);
        $exponent = self::base64urlDecode($jwk['e']);

        if (ord($modulus[0]) > 0x7f) $modulus = "\x00" . $modulus;
        if (ord($exponent[0]) > 0x7f) $exponent = "\x00" . $exponent;

        $modLen = self::asn1Length(strlen($modulus));
        $expLen = self::asn1Length(strlen($exponent));

        $rsaSeq = "\x02" . $modLen . $modulus . "\x02" . $expLen . $exponent;
        $rsaSeq = "\x30" . self::asn1Length(strlen($rsaSeq)) . $rsaSeq;

        $bitString = "\x00" . $rsaSeq;
        $bitString = "\x03" . self::asn1Length(strlen($bitString)) . $bitString;

        $algId = "\x30\x0d\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01\x05\x00";

        $spki = "\x30" . self::asn1Length(strlen($algId) + strlen($bitString)) . $algId . $bitString;

        return "-----BEGIN PUBLIC KEY-----\n" .
            chunk_split(base64_encode($spki), 64, "\n") .
            "-----END PUBLIC KEY-----";
    }

    private static function asn1Length(int $len): string
    {
        if ($len < 0x80) return chr($len);
        $temp = ltrim(pack('N', $len), "\x00");
        return chr(0x80 | strlen($temp)) . $temp;
    }

    private static function base64urlDecode(string $data): string
    {
        return base64_decode(strtr($data, '-_', '+/') . str_repeat('=', 3 - (3 + strlen($data)) % 4)) ?: '';
    }
}
