const ON_EXIT = 'ACCOUNT_EVENT_TRIGGER_ON_EXIT';

/**
 * Only ON_EXIT is an event trigger verified in the pinned host integration.
 * Treat absent or unknown triggers as host-owned/manual rather than guessing
 * from enum prefixes; an uncertain classifier must never block an explicit
 * YouTube sign-in or account-management flow.
 */
export function automaticAccountSelectorAction(command, enabled) {
  if (enabled === true) return 'allow';
  const request = command?.requestAccountSelectorCommand;
  if (!request) return 'allow';
  const trigger = request.identityActionContext?.eventTrigger;
  if (trigger === ON_EXIT) return 'exit';
  return 'allow';
}

export const ACCOUNT_SELECTOR_TRIGGERS = Object.freeze({ ON_EXIT });
