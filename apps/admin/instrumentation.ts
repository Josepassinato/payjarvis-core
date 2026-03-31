export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN_ADMIN,
      environment: process.env.NODE_ENV || 'production',
      tracesSampleRate: 0.1,
      release: 'payjarvis-admin@1.0.0',
    });
  }
}
