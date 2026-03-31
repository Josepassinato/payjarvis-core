import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN_RULES_ENGINE,
  environment: process.env.NODE_ENV || 'production',
  tracesSampleRate: 0.1,
  release: 'payjarvis-rules-engine@1.0.0',
});

export default Sentry;
