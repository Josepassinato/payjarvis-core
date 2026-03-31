import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN_API,
  environment: process.env.NODE_ENV || 'production',
  tracesSampleRate: 0.05,
  release: 'payjarvis-api@1.0.0',
});

export default Sentry;
