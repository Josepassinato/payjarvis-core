import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN_BROWSER_AGENT,
  environment: process.env.NODE_ENV || 'production',
  tracesSampleRate: 0.1,
  release: 'payjarvis-browser-agent@1.0.0',
});

export default Sentry;
