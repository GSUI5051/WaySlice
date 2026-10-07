import { PROFILE_MESSAGES, PROFILE_TYPES } from './profile.js';
const metersInOneKilometer = 1000;
const secondsInOneHour = 3600;
// according to https://en.wikipedia.org/wiki/Mile
const metersInOneMile = 1609.344;
const centiBarsInOneBar = 100;
const psiInOneBar = 14.5037738;
const options = {
    speedUnits: {
        'm/s': { multiplier: 1, offset: 0 },
        'mph': { multiplier: secondsInOneHour / metersInOneMile, offset: 0 },
        'km/h': { multiplier: secondsInOneHour / metersInOneKilometer, offset: 0 },
    },
    lengthUnits: {
        m: { multiplier: 1, offset: 0 },
        mi: { multiplier: 1 / metersInOneMile, offset: 0 },
        km: { multiplier: 1 / metersInOneKilometer, offset: 0 },
    },
    temperatureUnits: {
        'celsius': { multiplier: 1, offset: 0 },
        '°C': { multiplier: 1, offset: 0 },
        'kelvin': { multiplier: 1, offset: 273.15 },
        'fahrenheit': { multiplier: 9 / 5, offset: 32 },
    },
    pressureUnits: {
        cbar: { multiplier: centiBarsInOneBar, offset: 0 },
        bar: { multiplier: 1, offset: 0 },
        psi: { multiplier: psiInOneBar, offset: 0 },
    },
};
export const FIT = {
    scConst: 180 / Math.pow(2, 31),
    options,
    messages: PROFILE_MESSAGES,
    types: PROFILE_TYPES,
};
