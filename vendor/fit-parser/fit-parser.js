import { calculateCRC, readRecord } from './binary.js';
import { mapDataIntoLap, mapDataIntoSession } from './helper.js';
export { FitBaseType, FitEncoder } from './fit-encoder.js';
export { getFitCoursePointId, getFitGarminProductDisplayName, getFitGarminProductName, getFitManufacturerName, getFitSportId, getFitSportName, getFitSubSportId, getFitSubSportName, } from './profile-lookup.js';
export { FitMessageReaderError, fitTimestampToUnixMilliseconds, getFitBaseTypeId, readFitMessages, readFitStringField, readFitUnsignedField, } from './raw-message-reader.js';
export default class FitParser {
    constructor(options = {}) {
        var _a, _b, _c, _d;
        this.options = {
            force: options.force != null ? options.force : true,
            speedUnit: options.speedUnit || 'm/s',
            lengthUnit: options.lengthUnit || 'm',
            temperatureUnit: options.temperatureUnit || 'celsius',
            elapsedRecordField: options.elapsedRecordField || false,
            pressureUnit: options.pressureUnit || 'bar',
            mode: options.mode || 'list',
            includeRawDeveloperFields: (_a = options.includeRawDeveloperFields) !== null && _a !== void 0 ? _a : false,
            includeRawMessages: (_b = options.includeRawMessages) !== null && _b !== void 0 ? _b : false,
            includeUnmappedMessages: (_c = options.includeUnmappedMessages) !== null && _c !== void 0 ? _c : false,
            rawMessagesOnly: (_d = options.rawMessagesOnly) !== null && _d !== void 0 ? _d : false,
        };
    }
    parseAsync(content) {
        return new Promise((resolve, reject) => {
            this.parse(content, (error, data) => {
                if (error) {
                    reject(error);
                }
                else if (data) {
                    resolve(data);
                }
            });
        });
    }
    parse(content, callback) {
        var _a, _b, _c;
        const blob = content instanceof ArrayBuffer
            ? new Uint8Array(content)
            : new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
        const dataView = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
        if (blob.length < 12) {
            callback('File to small to be a FIT file', undefined);
            return;
        }
        const headerLength = blob[0];
        if (headerLength !== 14 && headerLength !== 12) {
            callback('Incorrect header size', undefined);
            return;
        }
        if (blob.length < headerLength) {
            callback('File to small to be a FIT file', undefined);
            return;
        }
        let fileTypeString = '';
        for (let i = 8; i < 12; i++) {
            fileTypeString += String.fromCharCode(blob[i]);
        }
        if (fileTypeString !== '.FIT') {
            callback('Missing \'.FIT\' in header', undefined);
            return;
        }
        if (headerLength === 14 && !this.options.force) {
            const crcHeader = blob[12] + (blob[13] << 8);
            const crcHeaderCalc = calculateCRC(blob, 0, 12);
            if (crcHeader !== 0 && crcHeader !== crcHeaderCalc) {
                callback('Header CRC mismatch', undefined);
                return;
            }
        }
        const protocolVersion = blob[1];
        const profileVersion = blob[2] + (blob[3] << 8);
        const dataLength = dataView.getUint32(4, true);
        const crcStart = dataLength + headerLength;
        if (crcStart > blob.length) {
            callback('File data exceeds input length', undefined);
            return;
        }
        if (!this.options.force && crcStart + 2 > blob.length) {
            callback('File CRC missing', undefined);
            return;
        }
        if (!this.options.force) {
            const crcFile = blob[crcStart] + (blob[crcStart + 1] << 8);
            const crcFileCalc = calculateCRC(blob, 0, crcStart);
            if (crcFile !== crcFileCalc) {
                callback('File CRC mismatch', undefined);
                return;
            }
        }
        const fitObj = {
            profileVersion,
            protocolVersion,
        };
        const messages = {};
        let sessions = [];
        let laps = [];
        const records = [];
        const events = [];
        const hr_zone = [];
        const power_zone = [];
        const hrv = [];
        const device_infos = [];
        const applications = [];
        const fieldDescriptions = [];
        const dive_gases = [];
        const course_points = [];
        const sports = [];
        const monitors = [];
        const stress = [];
        const definitions = [];
        const file_ids = [];
        const monitor_info = [];
        const lengths = [];
        const tank_updates = [];
        const tank_summaries = [];
        const jumps = [];
        const sets = [];
        const splits = [];
        const split_summaries = [];
        const time_in_zone = [];
        const activity_metrics = [];
        const user_metrics = [];
        const rawDeveloperFields = this.options.includeRawDeveloperFields === true
            || Array.isArray(this.options.includeRawDeveloperFields)
            ? []
            : undefined;
        const rawMessages = this.options.includeRawMessages === true
            || Array.isArray(this.options.includeRawMessages)
            ? []
            : undefined;
        const unmappedMessages = this.options.includeUnmappedMessages ? [] : undefined;
        const messageCountsByGlobalNumber = new Map();
        let loopIndex = headerLength;
        const messageTypes = [];
        const developerFields = [];
        const decoderState = {};
        const isModeCascade = this.options.mode === 'cascade';
        const isCascadeNeeded = isModeCascade || this.options.mode === 'both';
        let startDate;
        let lastStopTimestamp;
        let pausedTime = 0;
        while (loopIndex < crcStart) {
            const { globalMessageNumber, littleEndian, message, messageType, nextIndex, compressedTimestamp, rawFields: recordRawFields, rawDeveloperFields: recordRawDeveloperFields, unmappedFields: recordUnmappedFields, unmappedDeveloperFields: recordUnmappedDeveloperFields, } = readRecord(blob, messageTypes, developerFields, loopIndex, this.options, startDate, pausedTime, dataView, decoderState, crcStart);
            loopIndex = nextIndex;
            if (globalMessageNumber !== undefined) {
                const messageIndex = (_a = messageCountsByGlobalNumber.get(globalMessageNumber)) !== null && _a !== void 0 ? _a : 0;
                messageCountsByGlobalNumber.set(globalMessageNumber, messageIndex + 1);
                if (recordRawFields && littleEndian !== undefined) {
                    rawMessages === null || rawMessages === void 0 ? void 0 : rawMessages.push(Object.assign(Object.assign({ global_message_number: globalMessageNumber, message_index: messageIndex, little_endian: littleEndian }, (compressedTimestamp === undefined
                        ? {}
                        : { compressed_timestamp: compressedTimestamp })), { fields: recordRawFields.map(field => ({
                            field_definition_number: field.fieldDefinitionNumber,
                            base_type: field.baseType,
                            raw_value: field.rawValue,
                        })), developer_fields: (recordRawDeveloperFields !== null && recordRawDeveloperFields !== void 0 ? recordRawDeveloperFields : []).map(field => ({
                            developer_data_index: field.developerDataIndex,
                            field_definition_number: field.fieldDefinitionNumber,
                            raw_value: field.rawValue,
                        })) }));
                }
                recordRawDeveloperFields === null || recordRawDeveloperFields === void 0 ? void 0 : recordRawDeveloperFields.forEach((field) => {
                    rawDeveloperFields === null || rawDeveloperFields === void 0 ? void 0 : rawDeveloperFields.push({
                        global_message_number: globalMessageNumber,
                        message_index: messageIndex,
                        developer_data_index: field.developerDataIndex,
                        field_definition_number: field.fieldDefinitionNumber,
                        raw_value: field.rawValue,
                    });
                });
                if (littleEndian !== undefined
                    && ((recordUnmappedFields === null || recordUnmappedFields === void 0 ? void 0 : recordUnmappedFields.length) || (recordUnmappedDeveloperFields === null || recordUnmappedDeveloperFields === void 0 ? void 0 : recordUnmappedDeveloperFields.length))) {
                    unmappedMessages === null || unmappedMessages === void 0 ? void 0 : unmappedMessages.push(Object.assign(Object.assign({ global_message_number: globalMessageNumber, message_index: messageIndex, little_endian: littleEndian }, (compressedTimestamp === undefined
                        ? {}
                        : { compressed_timestamp: compressedTimestamp })), { fields: (recordUnmappedFields !== null && recordUnmappedFields !== void 0 ? recordUnmappedFields : []).map(field => ({
                            field_definition_number: field.fieldDefinitionNumber,
                            base_type: field.baseType,
                            raw_value: field.rawValue,
                        })), developer_fields: (recordUnmappedDeveloperFields !== null && recordUnmappedDeveloperFields !== void 0 ? recordUnmappedDeveloperFields : []).map(field => ({
                            developer_data_index: field.developerDataIndex,
                            field_definition_number: field.fieldDefinitionNumber,
                            raw_value: field.rawValue,
                        })) }));
                }
            }
            if (this.options.rawMessagesOnly) {
                continue;
            }
            if (messageType !== ''
                && messageType !== 'definition'
                && message !== undefined) {
                ((_b = messages[messageType]) !== null && _b !== void 0 ? _b : (messages[messageType] = [])).push(message);
            }
            switch (messageType) {
                case 'lap':
                    laps.push(message);
                    break;
                case 'session':
                    sessions.push(message);
                    break;
                case 'event':
                    if (message.event === 'timer') {
                        if (message.event_type === 'stop_all') {
                            lastStopTimestamp = message.timestamp;
                        }
                        else if (message.event_type === 'start' && lastStopTimestamp) {
                            pausedTime += (message.timestamp - lastStopTimestamp) / 1000;
                        }
                    }
                    events.push(message);
                    break;
                case 'length':
                    lengths.push(message);
                    break;
                case 'hrv':
                    hrv.push(message);
                    break;
                case 'hr_zone':
                    hr_zone.push(message);
                    break;
                case 'power_zone':
                    power_zone.push(message);
                    break;
                case 'record':
                    if (!startDate) {
                        startDate = message.timestamp;
                        if (this.options.elapsedRecordField) {
                            message.elapsed_time = 0;
                            message.timer_time = 0;
                        }
                    }
                    records.push(message);
                    break;
                case 'field_description':
                    fieldDescriptions.push(message);
                    break;
                case 'device_info':
                    device_infos.push(message);
                    break;
                case 'developer_data_id':
                    applications.push(message);
                    break;
                case 'dive_gas':
                    dive_gases.push(message);
                    break;
                case 'course_point':
                    course_points.push(message);
                    break;
                case 'sport':
                    sports.push(message);
                    break;
                case 'file_id':
                    if (message) {
                        file_ids.push(message);
                    }
                    break;
                case 'definition':
                    if (message) {
                        definitions.push(message);
                    }
                    break;
                case 'monitoring':
                    monitors.push(message);
                    break;
                case 'monitoring_info':
                    monitor_info.push(message);
                    break;
                case 'stress_level':
                    stress.push(message);
                    break;
                case 'software':
                    fitObj.software = message;
                    break;
                case 'tank_update':
                    tank_updates.push(message);
                    break;
                case 'tank_summary':
                    tank_summaries.push(message);
                    break;
                case 'jump':
                    jumps.push(message);
                    break;
                case 'set':
                    sets.push(message);
                    break;
                case 'split':
                    splits.push(message);
                    break;
                case 'split_summary':
                    split_summaries.push(message);
                    break;
                case 'time_in_zone':
                    time_in_zone.push(message);
                    break;
                case 'activity_metrics':
                    activity_metrics.push(message);
                    break;
                case 'user_metrics':
                    user_metrics.push(message);
                    break;
                default:
                    if (messageType !== '') {
                        fitObj[messageType] = message;
                    }
                    break;
            }
        }
        if (this.options.rawMessagesOnly) {
            if (rawDeveloperFields) {
                fitObj.raw_developer_fields = rawDeveloperFields;
            }
            if (rawMessages) {
                fitObj.raw_messages = rawMessages;
            }
            if (unmappedMessages && unmappedMessages.length > 0) {
                fitObj.unmapped_messages = unmappedMessages;
            }
            callback(undefined, fitObj);
            return;
        }
        fitObj.hr_zone = hr_zone;
        fitObj.power_zone = power_zone;
        fitObj.dive_gases = dive_gases;
        fitObj.course_points = course_points;
        fitObj.sports = sports;
        fitObj.monitors = monitors;
        fitObj.stress = stress;
        fitObj.file_ids = file_ids;
        fitObj.monitor_info = monitor_info;
        fitObj.definitions = definitions;
        fitObj.tank_updates = tank_updates;
        fitObj.tank_summaries = tank_summaries;
        fitObj.jumps = jumps;
        fitObj.splits = splits;
        fitObj.split_summaries = split_summaries;
        fitObj.time_in_zone = time_in_zone;
        fitObj.activity_metrics = activity_metrics;
        fitObj.user_metrics = user_metrics;
        fitObj.messages = messages;
        if (rawDeveloperFields) {
            fitObj.raw_developer_fields = rawDeveloperFields;
        }
        if (rawMessages) {
            fitObj.raw_messages = rawMessages;
        }
        if (unmappedMessages && unmappedMessages.length > 0) {
            fitObj.unmapped_messages = unmappedMessages;
        }
        if (isCascadeNeeded) {
            laps = mapDataIntoLap(laps, 'records', records);
            laps = mapDataIntoLap(laps, 'lengths', lengths);
            sessions = mapDataIntoSession(sessions, laps);
            fitObj.activity = Object.assign(Object.assign({}, ((_c = fitObj.activity) !== null && _c !== void 0 ? _c : {})), { // ugly but we assume the activity was parsed correctly with all other members correctly
                sessions,
                events,
                hrv,
                device_infos, developer_data_ids: applications, field_descriptions: fieldDescriptions, sports,
                sets,
                splits,
                split_summaries });
        }
        if (!isModeCascade) {
            fitObj.sessions = sessions;
            fitObj.laps = laps;
            fitObj.lengths = lengths;
            fitObj.records = records;
            fitObj.events = events;
            fitObj.device_infos = device_infos;
            fitObj.developer_data_ids = applications;
            fitObj.field_descriptions = fieldDescriptions;
            fitObj.hrv = hrv;
            fitObj.sets = sets;
        }
        callback(undefined, fitObj);
    }
}
