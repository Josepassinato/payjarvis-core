package com.payjarvis;

import java.math.BigInteger;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.RSAPublicKeySpec;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * PayJarvis BDIT Verification SDK — Java
 *
 * Verifies BDIT tokens locally using JWKS.
 *
 * <pre>
 * BditVerifier.Result result = BditVerifier.verify(
 *     request.getHeader("X-BDIT-Token"),
 *     "your-merchant-id",
 *     "https://api.payjarvis.com/.well-known/jwks.json"
 * );
 *
 * if (result.isVerified()) {
 *     System.out.println("Bot " + result.getBot().getId() + " authorized");
 * }
 * </pre>
 *
 * Requirements: Java 11+, no external dependencies.
 */
public class BditVerifier {

    private static final String DEFAULT_JWKS_URL = "https://api.payjarvis.com/.well-known/jwks.json";
    private static final HttpClient HTTP = HttpClient.newHttpClient();
    private static final ConcurrentHashMap<String, CachedJwks> JWKS_CACHE = new ConcurrentHashMap<>();

    /**
     * Verify a BDIT token.
     */
    public static Result verify(String token, String merchantId) {
        return verify(token, merchantId, DEFAULT_JWKS_URL, 0);
    }

    public static Result verify(String token, String merchantId, String jwksUrl) {
        return verify(token, merchantId, jwksUrl, 0);
    }

    public static Result verify(String token, String merchantId, String jwksUrl, int minTrustScore) {
        if (token == null || token.isEmpty()) {
            return Result.failure("No token provided");
        }
        if (merchantId == null || merchantId.isEmpty()) {
            return Result.failure("No merchantId provided");
        }

        String[] parts = token.split("\\.");
        if (parts.length != 3) {
            return Result.failure("Invalid token format");
        }

        try {
            // Decode header and payload
            String headerJson = new String(base64UrlDecode(parts[0]));
            String payloadJson = new String(base64UrlDecode(parts[1]));

            // Simple JSON parsing (no external dependency)
            Map<String, Object> header = SimpleJson.parse(headerJson);
            Map<String, Object> payload = SimpleJson.parse(payloadJson);

            // Check algorithm
            if (!"RS256".equals(header.get("alg"))) {
                return Result.failure("Unsupported algorithm");
            }

            // Check issuer
            if (!"payjarvis".equals(payload.get("iss"))) {
                return Result.failure("Invalid issuer");
            }

            // Check expiration
            long exp = ((Number) payload.getOrDefault("exp", 0)).longValue();
            if (exp < Instant.now().getEpochSecond()) {
                return Result.failure("Token expired");
            }

            // Check required fields
            String botId = (String) payload.get("bot_id");
            String tokenMerchantId = (String) payload.get("merchant_id");
            String jti = (String) payload.get("jti");

            if (botId == null || tokenMerchantId == null || jti == null) {
                return Result.failure("Missing required BDIT fields");
            }

            // Merchant match
            if (!merchantId.equals(tokenMerchantId)) {
                return Result.failure("Merchant mismatch: token has '" + tokenMerchantId + "'");
            }

            // Trust score
            int trustScore = ((Number) payload.getOrDefault("trust_score", 0)).intValue();
            if (trustScore < minTrustScore) {
                return Result.failure("Trust score " + trustScore + " below minimum " + minTrustScore);
            }

            // Verify signature
            String kid = (String) header.get("kid");
            PublicKey publicKey = fetchPublicKey(jwksUrl, kid);
            if (publicKey == null) {
                return Result.failure("Could not fetch public key");
            }

            byte[] signedData = (parts[0] + "." + parts[1]).getBytes();
            byte[] signature = base64UrlDecode(parts[2]);

            Signature sig = Signature.getInstance("SHA256withRSA");
            sig.initVerify(publicKey);
            sig.update(signedData);

            if (!sig.verify(signature)) {
                return Result.failure("Invalid signature");
            }

            // Build result
            BotInfo bot = new BotInfo(
                botId,
                (String) payload.get("owner_id"),
                trustScore,
                ((Number) payload.getOrDefault("kyc_level", 0)).intValue()
            );

            Authorization auth = new Authorization(
                ((Number) payload.getOrDefault("amount", 0)).doubleValue(),
                "USD",
                (String) payload.getOrDefault("category", ""),
                tokenMerchantId,
                Instant.ofEpochSecond(exp).toString(),
                true,
                jti
            );

            return Result.success(bot, auth);

        } catch (Exception e) {
            return Result.failure("Verification failed: " + e.getMessage());
        }
    }

    private static PublicKey fetchPublicKey(String jwksUrl, String kid) throws Exception {
        CachedJwks cached = JWKS_CACHE.get(jwksUrl);
        if (cached != null && cached.expiresAt > System.currentTimeMillis()) {
            PublicKey key = findKeyInJwks(cached.body, kid);
            if (key != null) return key;
        }

        HttpRequest req = HttpRequest.newBuilder()
            .uri(URI.create(jwksUrl))
            .timeout(java.time.Duration.ofSeconds(10))
            .GET()
            .build();

        HttpResponse<String> res = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() != 200) return null;

        String body = res.body();
        JWKS_CACHE.put(jwksUrl, new CachedJwks(body, System.currentTimeMillis() + 86400000));

        return findKeyInJwks(body, kid);
    }

    private static PublicKey findKeyInJwks(String jwksBody, String kid) throws Exception {
        // Extract n and e from JWKS JSON (simple parsing)
        // Find the key matching kid
        int idx = 0;
        while (true) {
            int keyStart = jwksBody.indexOf("{", idx + 1);
            if (keyStart < 0) break;
            int keyEnd = jwksBody.indexOf("}", keyStart);
            if (keyEnd < 0) break;

            String keyJson = jwksBody.substring(keyStart, keyEnd + 1);
            idx = keyEnd;

            if (!keyJson.contains("\"RSA\"")) continue;
            if (kid != null && !keyJson.contains("\"" + kid + "\"")) continue;

            String n = extractJsonValue(keyJson, "n");
            String e = extractJsonValue(keyJson, "e");
            if (n == null || e == null) continue;

            BigInteger modulus = new BigInteger(1, base64UrlDecode(n));
            BigInteger exponent = new BigInteger(1, base64UrlDecode(e));

            RSAPublicKeySpec spec = new RSAPublicKeySpec(modulus, exponent);
            return KeyFactory.getInstance("RSA").generatePublic(spec);
        }
        return null;
    }

    private static String extractJsonValue(String json, String key) {
        String search = "\"" + key + "\":\"";
        int start = json.indexOf(search);
        if (start < 0) return null;
        start += search.length();
        int end = json.indexOf("\"", start);
        if (end < 0) return null;
        return json.substring(start, end);
    }

    private static byte[] base64UrlDecode(String data) {
        String padded = data.replace('-', '+').replace('_', '/');
        switch (padded.length() % 4) {
            case 2: padded += "=="; break;
            case 3: padded += "="; break;
        }
        return Base64.getDecoder().decode(padded);
    }

    // ─── Inner Classes ───────────────────────────────

    public static class Result {
        private final boolean verified;
        private final String error;
        private final BotInfo bot;
        private final Authorization authorization;

        private Result(boolean verified, String error, BotInfo bot, Authorization auth) {
            this.verified = verified;
            this.error = error;
            this.bot = bot;
            this.authorization = auth;
        }

        static Result success(BotInfo bot, Authorization auth) {
            return new Result(true, null, bot, auth);
        }

        static Result failure(String error) {
            return new Result(false, error, null, null);
        }

        public boolean isVerified() { return verified; }
        public String getError() { return error; }
        public BotInfo getBot() { return bot; }
        public Authorization getAuthorization() { return authorization; }
    }

    public static class BotInfo {
        private final String id;
        private final String ownerId;
        private final int trustScore;
        private final int kycLevel;

        BotInfo(String id, String ownerId, int trustScore, int kycLevel) {
            this.id = id;
            this.ownerId = ownerId;
            this.trustScore = trustScore;
            this.kycLevel = kycLevel;
        }

        public String getId() { return id; }
        public String getOwnerId() { return ownerId; }
        public int getTrustScore() { return trustScore; }
        public int getKycLevel() { return kycLevel; }
    }

    public static class Authorization {
        private final double amount;
        private final String currency;
        private final String category;
        private final String merchantId;
        private final String validUntil;
        private final boolean oneTimeUse;
        private final String jti;

        Authorization(double amount, String currency, String category,
                     String merchantId, String validUntil, boolean oneTimeUse, String jti) {
            this.amount = amount;
            this.currency = currency;
            this.category = category;
            this.merchantId = merchantId;
            this.validUntil = validUntil;
            this.oneTimeUse = oneTimeUse;
            this.jti = jti;
        }

        public double getAmount() { return amount; }
        public String getCurrency() { return currency; }
        public String getCategory() { return category; }
        public String getMerchantId() { return merchantId; }
        public String getValidUntil() { return validUntil; }
        public boolean isOneTimeUse() { return oneTimeUse; }
        public String getJti() { return jti; }
    }

    private static class CachedJwks {
        final String body;
        final long expiresAt;
        CachedJwks(String body, long expiresAt) {
            this.body = body;
            this.expiresAt = expiresAt;
        }
    }

    /**
     * Minimal JSON parser (no external deps).
     */
    private static class SimpleJson {
        static Map<String, Object> parse(String json) {
            Map<String, Object> map = new java.util.HashMap<>();
            json = json.trim();
            if (json.startsWith("{")) json = json.substring(1);
            if (json.endsWith("}")) json = json.substring(0, json.length() - 1);

            int i = 0;
            while (i < json.length()) {
                // Find key
                int keyStart = json.indexOf('"', i);
                if (keyStart < 0) break;
                int keyEnd = json.indexOf('"', keyStart + 1);
                if (keyEnd < 0) break;
                String key = json.substring(keyStart + 1, keyEnd);

                int colon = json.indexOf(':', keyEnd);
                if (colon < 0) break;
                i = colon + 1;
                while (i < json.length() && json.charAt(i) == ' ') i++;

                if (i >= json.length()) break;
                char c = json.charAt(i);

                if (c == '"') {
                    int valEnd = json.indexOf('"', i + 1);
                    map.put(key, json.substring(i + 1, valEnd));
                    i = valEnd + 1;
                } else if (c == '[') {
                    int depth = 1;
                    int j = i + 1;
                    while (j < json.length() && depth > 0) {
                        if (json.charAt(j) == '[') depth++;
                        if (json.charAt(j) == ']') depth--;
                        j++;
                    }
                    map.put(key, json.substring(i, j));
                    i = j;
                } else {
                    int valEnd = i;
                    while (valEnd < json.length() && json.charAt(valEnd) != ',' && json.charAt(valEnd) != '}') valEnd++;
                    String val = json.substring(i, valEnd).trim();
                    try {
                        if (val.contains(".")) map.put(key, Double.parseDouble(val));
                        else map.put(key, Long.parseLong(val));
                    } catch (NumberFormatException e) {
                        if ("true".equals(val)) map.put(key, true);
                        else if ("false".equals(val)) map.put(key, false);
                        else if ("null".equals(val)) map.put(key, null);
                        else map.put(key, val);
                    }
                    i = valEnd;
                }

                int comma = json.indexOf(',', i);
                if (comma < 0) break;
                i = comma + 1;
            }
            return map;
        }
    }
}
