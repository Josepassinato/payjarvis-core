export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN_WEB,
      environment: process.env.NODE_ENV || 'production',
      tracesSampleRate: 0.05,
      release: 'payjarvis-web@1.0.0',
    });
  }
}
