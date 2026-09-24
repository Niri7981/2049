/** The legacy task worker bypasses SpendGrant, so only explicit non-production opt-in enables it. */
export function legacyDemoTasksAllowed(env: Record<string, string | undefined> = process.env) {
  return (env.NODE_ENV === 'development' || env.NODE_ENV === 'test')
    && env.APP2049_ENABLE_LEGACY_DEMO_TASKS === '1';
}
