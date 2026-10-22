import { guideEntryIdentity, guideOrderIdentity, guideSections } from './guideIdentity.js';
import { getGuide } from '../utils/innerTubeCalls.js';
import { configRead, configWrite } from '../config.js';
import { buttonItem, overlayPanelItemListRenderer, showModal } from './ytUI.js';
import { t } from 'i18next';

function showSetting(settingType, parameters) {
    if (settingType === 'MOVE_GUIDE_BUTTON') {
        const order = configRead('sidebarContentsOrder');

        const browseId = guideEntryIdentity(parameters?.item);
        const index = browseId && Array.isArray(order)
            ? order.findIndex(item => guideOrderIdentity(item) === browseId) : -1;

        if (index === -1) {
            return showSetting('', true);
        }

        if (parameters.direction === 'up' && index > 0) {
            const temp = order[index - 1];
            order[index - 1] = order[index];
            order[index] = temp;
        } else if (parameters.direction === 'down' && index < order.length - 1) {
            const temp = order[index + 1];
            order[index + 1] = order[index];
            order[index] = temp;
        }
        configWrite('sidebarContentsOrder', order);

        return showSetting('', true);
    } else if (settingType === 'SHOW_GUIDE_BUTTONS') {
        const title = parameters?.item?.guideEntryRenderer?.formattedTitle?.simpleText || '';

        const buttons = [];
        buttons.push(
            buttonItem(
                {
                    title: t('settings.options.uiSettings.options.sortSidebarContents.moveUp.title'),
                    subtitle: t('settings.options.uiSettings.options.sortSidebarContents.moveUp.subtitle')
                },
                {
                    icon: 'UP_ARROW'
                },
                [
                    {
                        customAction: {
                            action: 'MOVE_GUIDE_BUTTON',
                            parameters: {
                                settingType,
                                direction: 'up',
                                item: parameters.item
                            }
                        }
                    },
                    {
                        signalAction: {
                            signal: 'POPUP_BACK'
                        }
                    }
                ]
            )
        )

        buttons.push(
            buttonItem(
                {
                    title: t('settings.options.uiSettings.options.sortSidebarContents.moveDown.title'),
                    subtitle: t('settings.options.uiSettings.options.sortSidebarContents.moveDown.subtitle')
                },
                {
                    icon: 'DOWN_ARROW'
                },
                [
                    {
                        customAction: {
                            action: 'MOVE_GUIDE_BUTTON',
                            parameters: {
                                settingType,
                                direction: 'down',
                                item: parameters.item
                            }
                        }
                    },
                    {
                        signalAction: {
                            signal: 'POPUP_BACK'
                        }
                    }
                ]
            )
        )

        return showModal(
            title,
            overlayPanelItemListRenderer(buttons),
            'tt-move-guide-button-modal'
        );
    }
    getGuide().then(guide => {
        const buttons = [];

        let idx = 0;
        const guideItems = guideSections(guide).flatMap(section => section.originalItems || section.items);
        const seen = new Set();
        for (const item of guideItems) {
            const browseId = guideEntryIdentity(item);
            const renderer = item?.guideEntryRenderer;
            if (!browseId || seen.has(browseId) || item?.__ytarkGuideEntry) continue;
            seen.add(browseId);
            const title = renderer.formattedTitle?.simpleText
                || renderer.formattedTitle?.runs?.map(run => run.text || '').join('') || browseId;
            const icon = renderer.icon?.iconType;

            buttons.push(
                buttonItem(
                    {
                        title,
                    },
                    {
                        icon,
                        secondaryIcon: settingType === 'disabledSidebarContents' ?
                            configRead(settingType)?.includes(browseId) ?
                                'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK'
                            : null
                    },
                    [
                        settingType === 'disabledSidebarContents' ?
                            {
                                setClientSettingEndpoint: {
                                    settingDatas: [
                                        {
                                            clientSettingEnum: {
                                                item: 'disabledSidebarContents'
                                            },
                                            arrayValue: browseId
                                        }
                                    ]
                                }
                            } :
                            {
                                customAction: {
                                    action: 'SHOW_GUIDE_BUTTONS',
                                    parameters: {
                                        settingType,
                                        idx,
                                        item
                                    }
                                }
                            },
                        ...(settingType === 'disabledSidebarContents' ? [{
                            customAction: {
                                action: 'RELOAD_GUIDE_OPTIONS',
                                parameters: {
                                    settingType,
                                    idx,
                                    item
                                }
                            }
                        }] : [])
                    ]
                )
            );
            idx++;
        }

        showModal(
            {
                title: settingType === 'disabledSidebarContents' ? t('settings.options.uiSettings.options.disableSidebarContents.title') : t('settings.options.uiSettings.options.sortSidebarContents.title'),
                subtitle: settingType === 'disabledSidebarContents' ? t('settings.options.uiSettings.options.disableSidebarContents.subtitle') : t('settings.options.uiSettings.options.sortSidebarContents.subtitle')
            },
            overlayPanelItemListRenderer(buttons),
            'tt-sidebar-settings',
            parameters === true
        );
    });
}

export default showSetting;