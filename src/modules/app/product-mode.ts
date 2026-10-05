/** The legacy task worker bypasses SpendGrant, so only explicit non-production opt-in enables it. */
export function legacyDemoTasksAllowed(env: Record<string, string | undefined> = process.env) {
  const configuration = resolveYoshConfiguration(env);
  return (env.NODE_ENV === 'development' || env.NODE_ENV === 'test')
    && configuration.enableLegacyDemoTasks;
}
import { resolveYoshConfiguration } from './yosh-configuration';
