// Package payjarvis provides BDIT token verification for Go applications.
//
// Usage:
//
//	result, err := payjarvis.VerifyBdit(payjarvis.VerifyOptions{
//	    Token:      r.Header.Get("X-BDIT-Token"),
//	    MerchantID: "your-merchant-id",
//	    JwksURL:    "https://api.payjarvis.com/.well-known/jwks.json",
//	})
//
//	if result.Verified {
//	    fmt.Printf("Bot %s authorized for $%.2f\n", result.Bot.ID, result.Authorization.Amount)
//	}
package payjarvis

import (
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

const DefaultJwksURL = "https://api.payjarvis.com/.well-known/jwks.json"

// VerifyOptions configures the BDIT verification.
type VerifyOptions struct {
	Token         string
	MerchantID    string
	JwksURL       string // Default: PayJarvis production
	MinTrustScore int    // Default: 0
}

// VerifyResult contains the verification outcome.
type VerifyResult struct {
	Verified      bool
	Error         string
	Bot           *BotInfo
	Authorization *Authorization
}

// BotInfo contains information about the verified bot.
type BotInfo struct {
	ID         string `json:"id"`
	OwnerID    string `json:"owner_id"`
	TrustScore int    `json:"trust_score"`
	KycLevel   int    `json:"kyc_level"`
}

// Authorization contains the payment authorization details.
type Authorization struct {
	Amount     float64 `json:"amount"`
	Currency   string  `json:"currency"`
	Category   string  `json:"category"`
	MerchantID string  `json:"merchant_id"`
	ValidUntil string  `json:"valid_until"`
	OneTimeUse bool    `json:"one_time_use"`
	JTI        string  `json:"jti"`
}

type jwtHeader struct {
	Alg string `json:"alg"`
	Kid string `json:"kid"`
}

type bditPayload struct {
	Iss        string   `json:"iss"`
	Sub        string   `json:"sub"`
	Exp        int64    `json:"exp"`
	Iat        int64    `json:"iat"`
	Jti        string   `json:"jti"`
	BotID      string   `json:"bot_id"`
	OwnerID    string   `json:"owner_id"`
	TrustScore int      `json:"trust_score"`
	KycLevel   int      `json:"kyc_level"`
	MerchantID string   `json:"merchant_id"`
	Amount     float64  `json:"amount"`
	Category   string   `json:"category"`
	Categories []string `json:"categories"`
	MaxAmount  float64  `json:"max_amount"`
	SessionID  string   `json:"session_id"`
}

type jwksResponse struct {
	Keys []jwkKey `json:"keys"`
}

type jwkKey struct {
	Kty string `json:"kty"`
	Use string `json:"use"`
	Kid string `json:"kid"`
	Alg string `json:"alg"`
	N   string `json:"n"`
	E   string `json:"e"`
}

// JWKS cache
var (
	jwksCache   = make(map[string]*cachedJwks)
	jwksCacheMu sync.RWMutex
)

type cachedJwks struct {
	data      *jwksResponse
	expiresAt time.Time
}

// VerifyBdit verifies a BDIT token locally using JWKS.
func VerifyBdit(opts VerifyOptions) (*VerifyResult, error) {
	if opts.Token == "" {
		return &VerifyResult{Verified: false, Error: "No token provided"}, nil
	}
	if opts.MerchantID == "" {
		return &VerifyResult{Verified: false, Error: "No merchantId provided"}, nil
	}
	if opts.JwksURL == "" {
		opts.JwksURL = DefaultJwksURL
	}

	parts := strings.Split(opts.Token, ".")
	if len(parts) != 3 {
		return &VerifyResult{Verified: false, Error: "Invalid token format"}, nil
	}

	// Decode header
	headerBytes, err := base64URLDecode(parts[0])
	if err != nil {
		return &VerifyResult{Verified: false, Error: "Failed to decode header"}, nil
	}
	var header jwtHeader
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return &VerifyResult{Verified: false, Error: "Invalid header JSON"}, nil
	}

	if header.Alg != "RS256" {
		return &VerifyResult{Verified: false, Error: "Unsupported algorithm"}, nil
	}

	// Decode payload
	payloadBytes, err := base64URLDecode(parts[1])
	if err != nil {
		return &VerifyResult{Verified: false, Error: "Failed to decode payload"}, nil
	}
	var payload bditPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return &VerifyResult{Verified: false, Error: "Invalid payload JSON"}, nil
	}

	// Check issuer
	if payload.Iss != "payjarvis" {
		return &VerifyResult{Verified: false, Error: "Invalid issuer"}, nil
	}

	// Check expiration
	if payload.Exp < time.Now().Unix() {
		return &VerifyResult{Verified: false, Error: "Token expired"}, nil
	}

	// Check required fields
	if payload.BotID == "" || payload.MerchantID == "" || payload.Jti == "" {
		return &VerifyResult{Verified: false, Error: "Missing required BDIT fields"}, nil
	}

	// Merchant match
	if payload.MerchantID != opts.MerchantID {
		return &VerifyResult{
			Verified: false,
			Error:    fmt.Sprintf("Merchant mismatch: token has '%s', expected '%s'", payload.MerchantID, opts.MerchantID),
		}, nil
	}

	// Trust score
	if payload.TrustScore < opts.MinTrustScore {
		return &VerifyResult{
			Verified: false,
			Error:    fmt.Sprintf("Trust score %d below minimum %d", payload.TrustScore, opts.MinTrustScore),
		}, nil
	}

	// Verify signature
	pubKey, err := fetchPublicKey(opts.JwksURL, header.Kid)
	if err != nil {
		return &VerifyResult{Verified: false, Error: "Could not fetch public key: " + err.Error()}, nil
	}

	signedData := []byte(parts[0] + "." + parts[1])
	signature, err := base64URLDecode(parts[2])
	if err != nil {
		return &VerifyResult{Verified: false, Error: "Failed to decode signature"}, nil
	}

	hash := sha256.Sum256(signedData)
	if err := rsa.VerifyPKCS1v15(pubKey, crypto.SHA256, hash[:], signature); err != nil {
		return &VerifyResult{Verified: false, Error: "Invalid signature"}, nil
	}

	return &VerifyResult{
		Verified: true,
		Bot: &BotInfo{
			ID:         payload.BotID,
			OwnerID:    payload.OwnerID,
			TrustScore: payload.TrustScore,
			KycLevel:   payload.KycLevel,
		},
		Authorization: &Authorization{
			Amount:     payload.Amount,
			Currency:   "USD",
			Category:   payload.Category,
			MerchantID: payload.MerchantID,
			ValidUntil: time.Unix(payload.Exp, 0).UTC().Format(time.RFC3339),
			OneTimeUse: true,
			JTI:        payload.Jti,
		},
	}, nil
}

func fetchPublicKey(jwksURL, kid string) (*rsa.PublicKey, error) {
	// Check cache
	jwksCacheMu.RLock()
	cached, ok := jwksCache[jwksURL]
	jwksCacheMu.RUnlock()

	if ok && time.Now().Before(cached.expiresAt) {
		if key := findKey(cached.data, kid); key != nil {
			return jwkToRSA(key)
		}
	}

	// Fetch JWKS
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(jwksURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var jwks jwksResponse
	if err := json.Unmarshal(body, &jwks); err != nil {
		return nil, err
	}

	// Cache
	jwksCacheMu.Lock()
	jwksCache[jwksURL] = &cachedJwks{data: &jwks, expiresAt: time.Now().Add(24 * time.Hour)}
	jwksCacheMu.Unlock()

	key := findKey(&jwks, kid)
	if key == nil {
		return nil, fmt.Errorf("key not found for kid: %s", kid)
	}
	return jwkToRSA(key)
}

func findKey(jwks *jwksResponse, kid string) *jwkKey {
	for i := range jwks.Keys {
		k := &jwks.Keys[i]
		if k.Kty != "RSA" {
			continue
		}
		if kid != "" && k.Kid != kid {
			continue
		}
		return k
	}
	return nil
}

func jwkToRSA(key *jwkKey) (*rsa.PublicKey, error) {
	nBytes, err := base64URLDecode(key.N)
	if err != nil {
		return nil, fmt.Errorf("invalid modulus: %w", err)
	}
	eBytes, err := base64URLDecode(key.E)
	if err != nil {
		return nil, fmt.Errorf("invalid exponent: %w", err)
	}

	n := new(big.Int).SetBytes(nBytes)
	e := new(big.Int).SetBytes(eBytes)

	return &rsa.PublicKey{N: n, E: int(e.Int64())}, nil
}

func base64URLDecode(s string) ([]byte, error) {
	s = strings.ReplaceAll(s, "-", "+")
	s = strings.ReplaceAll(s, "_", "/")
	switch len(s) % 4 {
	case 2:
		s += "=="
	case 3:
		s += "="
	}
	return base64.StdEncoding.DecodeString(s)
}

// ExtractBditToken extracts a BDIT token from common HTTP sources.
func ExtractBditToken(r *http.Request) string {
	if t := r.Header.Get("X-BDIT-Token"); t != "" {
		return t
	}
	if t := r.Header.Get("X-Payjarvis-Token"); t != "" {
		return t
	}
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		return auth[7:]
	}
	if cookie, err := r.Cookie("bdit_token"); err == nil {
		return cookie.Value
	}
	return ""
}
