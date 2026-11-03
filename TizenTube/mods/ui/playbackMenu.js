const ACTIONS = new Set(['ENTER_MP', 'ENTER_PIP', 'SCREEN_OFF', 'SHARE']);
function actionOf(row) {
  const endpoint = row && row.compactLinkRenderer && row.compactLinkRenderer.serviceEndpoint;
  const commands = endpoint && endpoint.commandExecutorCommand && endpoint.commandExecutorCommand.commands;
  return Array.isArray(commands) && commands.some(command => ACTIONS.has(command?.customAction?.action));
}
/** A cached popup may be opened repeatedly. Replace only our rows, once per
 * open, instead of growing the frontend's array on every settings visit. */
export function patchPlaybackMenu(items, { buttonItem, t, pip = false } = {}) {
  if (!Array.isArray(items)) return false;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (actionOf(items[index])) items.splice(index, 1);
  }
  for (const item of items) {
    const row = item?.compactLinkRenderer;
    if (row?.icon?.iconType !== 'SLOW_MOTION_VIDEO') continue;
    if (row.subtitle) row.subtitle.simpleText = t('player.withTizenTube');
    row.serviceEndpoint = { signalAction: { customAction: { action:'TT_SPEED_SETTINGS_SHOW', parameters:[] } } };
  }
  const actions = [
    ['ENTER_MP', 'player.miniPlayer', 'CLEAR_COOKIES'],
    ...(pip ? [['ENTER_PIP', 'player.pictureInPicture', 'TV']] : []),
    ['SCREEN_OFF', 'player.screenOff', 'EYE_OFF'],
    ['SHARE', 'player.share.button', 'OPEN_IN_NEW'],
  ];
  const additions = actions.map(([action, title, icon]) => {
    const commands = [{ customAction: { action } }];
    if (action === 'ENTER_PIP') commands.push({ signalAction: { signal:'POPUP_BACK' } });
    const row = buttonItem({ title:t(title) }, { icon }, commands);
    row.compactLinkRenderer.itemId = `ytark-playback-${action.toLowerCase()}`;
    return row;
  });
  items.splice(Math.min(2, items.length), 0, ...additions);
  return true;
}
