/**
 * Checkout intent — survives the OAuth round-trip AND the registration
 * onboarding, unlike the ?returnTo param (handlePostLogin drops returnTo
 * for non-ACTIVE phases, and Registration always redirects to the
 * dashboard). sessionStorage is per-tab and dies with it, so a stale
 * intent can't fire days later in another session.
 */
const KEY = 'maity_checkout_intent';

export function saveCheckoutIntent(plan: 'pro'): void {
  try {
    sessionStorage.setItem(KEY, plan);
  } catch {
    // storage unavailable (private mode / blocked) — flow degrades to manual
  }
}

/** Reads AND clears the intent (one-shot). */
export function consumeCheckoutIntent(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    if (value) sessionStorage.removeItem(KEY);
    return value;
  } catch {
    return null;
  }
}

export function clearCheckoutIntent(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // noop
  }
}
