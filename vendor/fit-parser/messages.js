import { FIT } from './fit.js';
function getFieldObject(fieldNum, messageNum) {
    const message = FIT.messages[messageNum];
    if (!message) {
        return {};
    }
    return message[fieldNum] || {};
}
function getMessageName(messageNum) {
    const message = FIT.messages[messageNum];
    return message ? message.name : '';
}
export function getFitMessage(messageNum) {
    return {
        name: getMessageName(messageNum),
        getAttributes: (fieldNum) => getFieldObject(fieldNum, messageNum),
    };
}
// TODO
export function getFitMessageBaseType(inp) {
    return inp;
}
