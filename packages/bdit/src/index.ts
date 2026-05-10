export { BditIssuer } from "./issuer.js";
export type { IssueTokenParams } from "./issuer.js";
export { BditVerifier } from "./verifier.js";
export type { VerifyResult } from "./verifier.js";
export { extractBditToken } from "./extract.js";
export {
  loadPublicKeys,
  activePrivateKey,
  VERIFIER_ALGORITHMS,
} from "./keys.js";
export type {
  BditAlgorithm,
  PublicKeyEntry,
  PrivateKeyEntry,
} from "./keys.js";

// CTEF outcome receipts — Concordia-stack-aligned attestations.
export {
  canonicalJson,
  buildEnvelope,
  signEnvelope,
  verifyEnvelope,
  buildPaymentOutcomeReceipt,
} from "./ctef.js";
export type {
  CtefEnvelope,
  UnsignedCtefEnvelope,
  CtefReference,
  CtefRefreshHint,
  CtefValidityTemporal,
  CtefProvider,
  CtefSubject,
  CtefSignature,
  BuildEnvelopeParams,
  PaymentOutcomePayload,
  PaymentOutcomeReceiptParams,
  VerifyEnvelopeResult,
} from "./ctef.js";

// Concordia agreement bridge — Agreement -> Settlement boundary.
export {
  verifyConcordiaAgreement,
  extractTermsFromEnvelope,
  extractSourceSession,
  loadConcordiaOptionsFromEnv,
} from "./concordia.js";
export type {
  ConcordiaSourceRef,
  ConcordiaAgreementTerms,
  ConcordiaVerificationOptions,
  ConcordiaVerificationResult,
} from "./concordia.js";
