/**
 * Rotates a provider API key via the configured `on401Script` after an auth failure.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { formatErrorMessage } from "../../../infra/errors.js";
import type { Model } from "../../../llm/types.js";
import type { ResolvedProviderAuth } from "../../model-auth.js";
import type { RunEmbeddedAgentParams } from "./params.js";

const execFileAsync = promisify(execFile);

const ON_401_SCRIPT_TIMEOUT_MS = 10_000;

export type ApiKeyRotationDeps = {
  config: RunEmbeddedAgentParams["config"];
  authStorage: { setRuntimeApiKey(provider: string, apiKey: string): void };
  getProvider(): string;
  getRuntimeModel(): Model;
  getApiKeyInfo(): ResolvedProviderAuth | null;
  classifyAuthError(errorText: string, provider: string): boolean;
  log: { info(msg: string): void; warn(msg: string): void };
};

/**
 * Binds the auth controller's accessors into a rotation callback.
 *
 * Wraps each accessor in an arrow so the controller's methods are never passed
 * unbound, and keeps the wiring here rather than inflating the controller.
 */
export function createApiKeyRotationHook(source: {
  config: RunEmbeddedAgentParams["config"];
  authStorage: { setRuntimeApiKey(provider: string, apiKey: string): void };
  getProvider(): string;
  getRuntimeModel(): Model;
  getApiKeyInfo(): ResolvedProviderAuth | null;
  classifyAuthError(errorText: string, provider: string): boolean;
  log: { info(msg: string): void; warn(msg: string): void };
}): (errorText: string, retried: boolean) => Promise<boolean> {
  const deps: ApiKeyRotationDeps = {
    config: source.config,
    authStorage: source.authStorage,
    getProvider: () => source.getProvider(),
    getRuntimeModel: () => source.getRuntimeModel(),
    getApiKeyInfo: () => source.getApiKeyInfo(),
    classifyAuthError: (errorText, provider) => source.classifyAuthError(errorText, provider),
    log: source.log,
  };
  return async (errorText, retried) =>
    await maybeRotateApiKeyForAuthError(deps, errorText, retried);
}

/**
 * Runs the provider's `on401Script` and installs the key it prints.
 *
 * Returns true only when a genuinely different key was stored, so callers can
 * treat that as "retry is worthwhile". Skips when the attempt already retried,
 * when the failure is not an auth failure, or when no script is configured.
 */
export async function maybeRotateApiKeyForAuthError(
  deps: ApiKeyRotationDeps,
  errorText: string,
  retried: boolean,
): Promise<boolean> {
  if (retried) {
    return false;
  }
  if (!deps.classifyAuthError(errorText, deps.getProvider())) {
    return false;
  }
  const providerName = deps.getRuntimeModel().provider;
  const on401Script = deps.config?.models?.providers?.[providerName]?.on401Script;
  if (!on401Script) {
    return false;
  }
  const currentKey = deps.getApiKeyInfo()?.apiKey ?? "";
  try {
    const { stdout } = await execFileAsync(on401Script, currentKey ? [currentKey] : [], {
      timeout: ON_401_SCRIPT_TIMEOUT_MS,
    });
    const newKey = stdout.trim();
    if (newKey && newKey !== currentKey) {
      deps.authStorage.setRuntimeApiKey(providerName, newKey);
      deps.log.info(`[on401] Rotated API key for provider "${providerName}"`);
      return true;
    }
  } catch (err) {
    deps.log.warn(`[on401] Key rotation script failed: ${formatErrorMessage(err)}`);
  }
  return false;
}
