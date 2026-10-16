let activeModal = null;

function containsPopupBack(command, depth = 0) {
  if (!command || typeof command !== 'object' || depth > 8) return false;
  if (command.signalAction && command.signalAction.signal === 'POPUP_BACK') return true;
  const commands = command.commandExecutorCommand && command.commandExecutorCommand.commands;
  return Array.isArray(commands) && commands.some(item => containsPopupBack(item, depth + 1));
}

/** Register the most recently opened YTArk modal and whether it is a Settings panel. */
export function registerYtarkModal(id, dismissalCommand, settingsInputOwner = false) {
  const previous = activeModal;
  activeModal = {
    id: typeof id === 'string' && id ? id : 'ytark-modal',
    dismissalCommand: dismissalCommand || null,
    settingsInputOwner: settingsInputOwner === true,
  };
  return previous;
}

/** Restore modal metadata if opening the popup itself failed. */
export function restoreYtarkModal(previous) {
  activeModal = previous || null;
}

export function hasVisibleYtarkModal() {
  return !!activeModal;
}

export function hasVisibleYtarkSettingsPanel() {
  return !!(activeModal && activeModal.settingsInputOwner);
}

export function ytarkModalBackCommand() {
  return activeModal && activeModal.dismissalCommand;
}

/** Clear ownership only when the active modal's Back command is dispatched. */
export function noteYtarkModalCommand(command) {
  if (!activeModal || !containsPopupBack(command)) return false;
  activeModal = null;
  return true;
}

export function resetYtarkModalStateForTests() {
  activeModal = null;
}
