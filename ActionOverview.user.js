// ==UserScript==
// @name             Milky way action overview
// @match            https://www.milkywayidle.com/game
// @run-at           document-start
// @grant            none
// @updateURL        https://github.com/Bl00D4NGEL/Milky-Way-Idle-Scripts/raw/main/ActionOverview.user.js
// @downloadURL      https://github.com/Bl00D4NGEL/Milky-Way-Idle-Scripts/raw/main/ActionOverview.user.js
// @description      Adds a small overview of the current action/s
// @version          0.1
// ==/UserScript==

const nativeWebSocket = window.WebSocket;
window.WebSocket = function (...args) {
    const socket = new nativeWebSocket(...args);
    window.milkySocket = socket;
    return socket;
};

const statisticsDiv = document.createElement('div');
Object.assign(statisticsDiv.style, {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#1f2f57',
    lineHeight: 2,
    color: 'var(--color-space-300)',
    padding: '10px',
    zIndex: 100,
});
statisticsDiv.innerHTML = 'Waiting for web socket...';
document.getElementById('root').parentNode.appendChild(statisticsDiv);

const overwriteInterval = setInterval(() => {
    if (window.milkySocket === undefined) {
        return;
    }

    window.milkySocket.addEventListener('message', (e) => {
        const eventData = JSON.parse(e.data);
        if (eventData.type === 'action_completed') {
            actionCompletedCallback(eventData);
        }

        if (eventData.type === 'init_client_info') {
            window.clientInfo = eventData;
        }
        if (eventData.type === 'init_character_info') {
            window.characterInfo = eventData;
        }
    });

    statisticsDiv.innerHTML = 'Waiting for action...';

    clearInterval(overwriteInterval);
}, 10);

const actionCompletedCallback = data => {
    if (!window.clientInfo) {
        return;
    }

    if (data.endCharacterSkills.length !== 1) {
        // Currently unsupported, will probably occur for combat
        return;
    }

    const currentSkill = data.endCharacterSkills[0];
    const currentAction = data.endCharacterAction;
    const currentExperience = currentSkill.experience;

    const actionTimeInSeconds = calculateActionTimeInSeconds(currentAction.actionHrid);
    const skillBoost = getRatioBoostSumForActionAndBuffType(currentAction.actionHrid, '/buff_types/efficiency');

    const infos = [
        [
            `Current action: [${skillHridToName(currentSkill.skillHrid)}] -> [${actionHridToName(currentAction.actionHrid)}]`,
            `Current time per action: ${actionTimeInSeconds.toFixed(2)} seconds.`,
            `Current skill boost: ${skillBoost * 100}%.`,
        ]
    ];

    const experienceGainPerAction = window.clientInfo.actionDetailMap[currentAction.actionHrid].experienceGain.value;
    const actionsPerHour = Math.round(3600 / actionTimeInSeconds);

    const experienceRequiredForNextLevel = getRequiredExperienceUntilNextLevel(currentExperience);
    const actionsForNextLevel = experienceRequiredForNextLevel / experienceGainPerAction;
    // If an action is skipped we can ignore it for "total actions required to level up"
    // 20% skill boost for 100 actions = 80 actions to get exp of 100 actions
    const actualActionsForNextLevel = actionsForNextLevel * (1 - skillBoost);

    infos.push(
        [
            `If you continue your current action for an hour you will be ...`,
            ` ... completing about ${actionsPerHour.toLocaleString()} actions`,
            ` ... skipping about ${Math.round(actionsPerHour * skillBoost).toLocaleString()} actions`,
            ` ... gaining about ${(experienceGainPerAction * actionsPerHour).toLocaleString()} experience`,
            `It will take you about ${secondsToHms(actualActionsForNextLevel * actionTimeInSeconds)} for the next level.`,
        ]
    );

    const leftOverActions = calculateLeftOverActions(currentAction, data.endCharacterItems);
    if (leftOverActions !== -1) {
        const leftOverActionTime = leftOverActions * actionTimeInSeconds;
        const skippedActions = Math.round(leftOverActions * skillBoost);
        const leftOverActionTimeAfterSkillBoost = leftOverActionTime * (1 - skillBoost);
        const totalExperienceGained = experienceGainPerAction * leftOverActions;

        infos.push(
            [
                `Current actions should take ${secondsToHms(leftOverActionTimeAfterSkillBoost)} (including skipped actions).`,
                `In total you will be ...`,
                ` ... skipping about ${skippedActions.toLocaleString()} actions`,
                ` ... gaining ${totalExperienceGained.toLocaleString()} experience`,
                ` ... reaching level ${getLevelForExperience(currentExperience + totalExperienceGained)}`,
            ]
        );
    }

    if (currentAction.hasMaxCount) {
        infos.push([`Already executed ${currentAction.currentCount} out of ${currentAction.maxCount} actions`]);
    }

    statisticsDiv.innerHTML = infos.map(info => info.join('<br>')).join('<hr>');
}

const getLevelForExperience = experience => {
    for (let level = 0; level < window.clientInfo.levelExperienceTable.length; level++) {
        if (window.clientInfo.levelExperienceTable[level] > experience) {
            return level - 1;
        }
    }

    throw new Error(`Cannot determine level for the experience value "${experience}"`);
}

const getRequiredExperienceUntilNextLevel = experience => {
    const currentLevel = getLevelForExperience(experience);
    const experienceForNextLevel = window.clientInfo.levelExperienceTable[currentLevel + 1];
    return experienceForNextLevel - experience;
}


const secondsToHms = seconds => {
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    seconds = Math.round(seconds % 60);
    return `${hours < 10 ? '0' + hours : hours}:${minutes < 10 ? '0' + minutes : minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
};

const calculateActionTimeInSeconds = actionHrid => {
    const timeMultiplier = 1 + getRatioBoostSumForActionAndBuffType(actionHrid, '/buff_types/action_speed');

    // The action time is returned in nano seconds so we should convert it to seconds
    return getActionInfo(actionHrid).baseTimeCost / timeMultiplier / 1e9;
};

const getRatioBoostSumForActionAndBuffType = (actionHrid, typeHrid) => window.characterInfo.skillingActionBuffsMap[actionHrid]
    .filter(buff => buff.typeHrid === typeHrid)
    .map(buff => buff.ratioBoost)
    .reduce((acc, value) => acc + value, 0);

const calculateLeftOverActions = (characterAction, characterItems) => {
    if (characterAction.hasMaxCount) {
        return characterAction.maxCount - characterAction.currentCount;
    }

    const actionInfo = getActionInfo(characterAction.actionHrid);
    if (actionInfo.inputItems === null) {
        return -1;
    }

    const inputItems = {};
    actionInfo.inputItems.forEach(inputItem => {
        inputItems[inputItem.itemHrid] = inputItem.count;
    });

    const requiredItems = characterItems.filter(characterItem => {
        return characterItem.itemHrid in inputItems;
    });

    const possibleCrafts = requiredItems.map(requiredItem => {
        return requiredItem.count / inputItems[requiredItem.itemHrid];
    });

    return Math.min(...possibleCrafts);
};

const getActionInfo = actionHrid => window.clientInfo.actionDetailMap[actionHrid];

const skillHridToName = skillHrid => window.clientInfo.skillDetailMap[skillHrid].name;

const actionHridToName = actionHrid => window.clientInfo.actionDetailMap[actionHrid].name;
