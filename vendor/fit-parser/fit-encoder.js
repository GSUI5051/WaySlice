const FIT_HEADER_SIZE = 14;
const FIT_EPOCH_MS = 631065600000;
const UINT8_MAX = 0xFF;
const UINT16_MAX = 0xFFFF;
const UINT32_MAX = 0xFFFFFFFF;
const BIGINT_ZERO = BigInt(0);
const BIGINT_EIGHT = BigInt(8);
const BIGINT_BYTE_MASK = BigInt(0xFF);
const UINT64_MAX = BigInt('18446744073709551615');
const UINT64_MODULUS = BigInt('18446744073709551616');
const SINT8_MIN = -0x80;
const SINT8_MAX = 0x7F;
const SINT16_MIN = -0x8000;
const SINT16_MAX = 0x7FFF;
const SINT32_MIN = -0x80000000;
const SINT32_MAX = 0x7FFFFFFF;
const SINT64_MIN = BigInt('-9223372036854775808');
const SINT64_MAX = BigInt('9223372036854775807');
/** FIT definition base-type bytes, including the endian flag where required. */
export var FitBaseType;
(function (FitBaseType) {
    FitBaseType[FitBaseType["Enum"] = 0] = "Enum";
    FitBaseType[FitBaseType["Sint8"] = 1] = "Sint8";
    FitBaseType[FitBaseType["Uint8"] = 2] = "Uint8";
    FitBaseType[FitBaseType["String"] = 7] = "String";
    FitBaseType[FitBaseType["Uint8z"] = 10] = "Uint8z";
    FitBaseType[FitBaseType["Byte"] = 13] = "Byte";
    FitBaseType[FitBaseType["Sint16"] = 131] = "Sint16";
    FitBaseType[FitBaseType["Uint16"] = 132] = "Uint16";
    FitBaseType[FitBaseType["Sint32"] = 133] = "Sint32";
    FitBaseType[FitBaseType["Uint32"] = 134] = "Uint32";
    FitBaseType[FitBaseType["Float32"] = 136] = "Float32";
    FitBaseType[FitBaseType["Float64"] = 137] = "Float64";
    FitBaseType[FitBaseType["Uint16z"] = 139] = "Uint16z";
    FitBaseType[FitBaseType["Uint32z"] = 140] = "Uint32z";
    FitBaseType[FitBaseType["Sint64"] = 142] = "Sint64";
    FitBaseType[FitBaseType["Uint64"] = 143] = "Uint64";
    FitBaseType[FitBaseType["Uint64z"] = 144] = "Uint64z";
})(FitBaseType || (FitBaseType = {}));
/**
 * A generic FIT binary encoder. Callers supply profile-specific field
 * definitions and already-scaled field values. Numeric arrays, strings, and
 * variable-length field values are supplied as raw `Uint8Array` values.
 */
export class FitEncoder {
    constructor(options = {}) {
        var _a, _b;
        this.data = [];
        this.activeDefinitions = new Map();
        this.protocolVersion = FitEncoder.assertIntegerInRange((_a = options.protocolVersion) !== null && _a !== void 0 ? _a : 2, 0, UINT8_MAX, 'FIT protocol version');
        this.profileVersion = FitEncoder.assertIntegerInRange((_b = options.profileVersion) !== null && _b !== void 0 ? _b : 21188, 0, UINT16_MAX, 'FIT profile version');
    }
    writeMessage(globalMessageNumber, fields, localMessageNumber = 0) {
        this.validateMessage(globalMessageNumber, fields, localMessageNumber);
        const definitionSignature = JSON.stringify({
            globalMessageNumber,
            fields: fields.map(field => this.getFieldDefinition(field)),
        });
        if (this.activeDefinitions.get(localMessageNumber) !== definitionSignature) {
            this.writeDefinition(localMessageNumber, globalMessageNumber, fields);
            this.activeDefinitions.set(localMessageNumber, definitionSignature);
        }
        this.writeUInt8(localMessageNumber);
        fields.forEach(field => this.writeFieldValue(field));
        return this;
    }
    close() {
        if (this.data.length > UINT32_MAX) {
            throw new RangeError('FIT data section cannot exceed 4294967295 bytes');
        }
        const header = [
            FIT_HEADER_SIZE,
            this.protocolVersion,
            this.profileVersion & UINT8_MAX,
            (this.profileVersion >>> 8) & UINT8_MAX,
            this.data.length & UINT8_MAX,
            (this.data.length >>> 8) & UINT8_MAX,
            (this.data.length >>> 16) & UINT8_MAX,
            (this.data.length >>> 24) & UINT8_MAX,
            0x2E,
            0x46,
            0x49,
            0x54,
        ];
        const headerCRC = FitEncoder.calculateCRC(header);
        const output = header.concat([headerCRC & UINT8_MAX, (headerCRC >>> 8) & UINT8_MAX], this.data);
        const fileCRC = FitEncoder.calculateCRC(output);
        output.push(fileCRC & UINT8_MAX, (fileCRC >>> 8) & UINT8_MAX);
        return new Uint8Array(output);
    }
    static string(value) {
        const bytes = new TextEncoder().encode(value);
        if (bytes.length > UINT8_MAX - 1) {
            throw new RangeError('FIT string fields can contain at most 254 UTF-8 bytes plus the null terminator');
        }
        const output = new Uint8Array(bytes.length + 1);
        output.set(bytes);
        return output;
    }
    static toFitTimestamp(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
            throw new TypeError('FIT timestamp requires a valid Date');
        }
        const timestamp = Math.floor((date.getTime() - FIT_EPOCH_MS) / 1000);
        return FitEncoder.assertIntegerInRange(timestamp, 0, UINT32_MAX, 'FIT timestamp');
    }
    static calculateCRC(bytes) {
        let crc = 0;
        for (let index = 0; index < bytes.length; index++) {
            let value = crc ^ bytes[index];
            for (let bit = 0; bit < 8; bit++) {
                value = value & 1 ? (value >>> 1) ^ 0xA001 : value >>> 1;
            }
            crc = value;
        }
        return crc;
    }
    validateMessage(globalMessageNumber, fields, localMessageNumber) {
        FitEncoder.assertIntegerInRange(globalMessageNumber, 0, UINT16_MAX, 'FIT global message number');
        FitEncoder.assertIntegerInRange(localMessageNumber, 0, 0x0F, 'FIT local message number');
        if (!Array.isArray(fields) || fields.length > UINT8_MAX) {
            throw new RangeError('FIT message definitions support between 0 and 255 fields');
        }
        fields.forEach(field => this.validateField(field));
    }
    validateField(field) {
        if (!field || typeof field !== 'object') {
            throw new TypeError('FIT field definitions must be objects');
        }
        FitEncoder.assertIntegerInRange(field.number, 0, UINT8_MAX, 'FIT field number');
        FitEncoder.assertIntegerInRange(field.size, 1, UINT8_MAX, 'FIT field size');
        FitEncoder.assertIntegerInRange(field.baseType, 0, UINT8_MAX, 'FIT base type');
        if (!this.isSupportedBaseType(field.baseType)) {
            throw new RangeError(`Unsupported FIT base type ${field.baseType}`);
        }
        if (field.value instanceof Uint8Array) {
            if (field.value.length !== field.size) {
                throw new RangeError(`FIT field ${field.number} expected ${field.size} bytes, received ${field.value.length}`);
            }
            const baseTypeSize = this.getBaseTypeSize(field.baseType);
            if (baseTypeSize && field.size % baseTypeSize !== 0) {
                throw new RangeError(`FIT field ${field.number} size must be a multiple of ${baseTypeSize}`);
            }
            return;
        }
        const baseTypeSize = this.getBaseTypeSize(field.baseType);
        if (baseTypeSize === undefined || field.size !== baseTypeSize) {
            throw new RangeError(`FIT field ${field.number} has an invalid size for base type ${field.baseType}`);
        }
        switch (field.baseType) {
            case FitBaseType.Sint64:
                this.assertBigIntInRange(field.value, SINT64_MIN, SINT64_MAX, field.number);
                return;
            case FitBaseType.Uint64:
            case FitBaseType.Uint64z:
                this.assertBigIntInRange(field.value, BIGINT_ZERO, UINT64_MAX, field.number);
                return;
            case FitBaseType.Sint8:
                this.assertNumberInRange(field.value, SINT8_MIN, SINT8_MAX, field.number);
                return;
            case FitBaseType.Sint16:
                this.assertNumberInRange(field.value, SINT16_MIN, SINT16_MAX, field.number);
                return;
            case FitBaseType.Sint32:
                this.assertNumberInRange(field.value, SINT32_MIN, SINT32_MAX, field.number);
                return;
            case FitBaseType.Float32:
                if (typeof field.value !== 'number' || !Number.isFinite(field.value)) {
                    throw new RangeError(`FIT field ${field.number} requires a finite numeric value`);
                }
                if (!Number.isFinite(Math.fround(field.value))) {
                    throw new RangeError(`FIT field ${field.number} must be representable as a finite float32`);
                }
                return;
            case FitBaseType.Float64:
                if (typeof field.value !== 'number' || !Number.isFinite(field.value)) {
                    throw new RangeError(`FIT field ${field.number} requires a finite numeric value`);
                }
                return;
            default:
                this.assertNumberInRange(field.value, 0, this.getUnsignedMaximum(field.baseType), field.number);
        }
    }
    assertNumberInRange(value, minimum, maximum, fieldNumber) {
        if (typeof value !== 'number'
            || !Number.isInteger(value)
            || value < minimum
            || value > maximum) {
            throw new RangeError(`FIT field ${fieldNumber} must be an integer between ${minimum} and ${maximum}`);
        }
    }
    assertBigIntInRange(value, minimum, maximum, fieldNumber) {
        if (typeof value !== 'bigint' || value < minimum || value > maximum) {
            throw new RangeError(`FIT field ${fieldNumber} must be a bigint between ${minimum} and ${maximum}`);
        }
    }
    getUnsignedMaximum(baseType) {
        switch (baseType) {
            case FitBaseType.Enum:
            case FitBaseType.Uint8:
            case FitBaseType.Uint8z:
            case FitBaseType.Byte:
                return UINT8_MAX;
            case FitBaseType.Uint16:
            case FitBaseType.Uint16z:
                return UINT16_MAX;
            case FitBaseType.Uint32:
            case FitBaseType.Uint32z:
                return UINT32_MAX;
            default:
                throw new RangeError(`Unsupported FIT base type ${baseType}`);
        }
    }
    getFieldDefinition(field) {
        return { number: field.number, size: field.size, baseType: field.baseType };
    }
    writeDefinition(localMessageNumber, globalMessageNumber, fields) {
        this.writeUInt8(0x40 | localMessageNumber);
        this.writeUInt8(0);
        this.writeUInt8(0);
        this.writeUInt16(globalMessageNumber);
        this.writeUInt8(fields.length);
        fields.forEach((field) => {
            this.writeUInt8(field.number);
            this.writeUInt8(field.size);
            this.writeUInt8(field.baseType);
        });
    }
    writeFieldValue(field) {
        if (field.value instanceof Uint8Array) {
            field.value.forEach(value => this.writeUInt8(value));
            return;
        }
        switch (field.baseType) {
            case FitBaseType.Enum:
            case FitBaseType.Uint8:
            case FitBaseType.Uint8z:
            case FitBaseType.Byte:
                this.writeUInt8(field.value);
                return;
            case FitBaseType.Sint8:
                this.writeInt8(field.value);
                return;
            case FitBaseType.Uint16:
            case FitBaseType.Uint16z:
                this.writeUInt16(field.value);
                return;
            case FitBaseType.Sint16:
                this.writeInt16(field.value);
                return;
            case FitBaseType.Uint32:
            case FitBaseType.Uint32z:
                this.writeUInt32(field.value);
                return;
            case FitBaseType.Sint32:
                this.writeInt32(field.value);
                return;
            case FitBaseType.Float32:
                this.writeFloat32(field.value);
                return;
            case FitBaseType.Float64:
                this.writeFloat64(field.value);
                return;
            case FitBaseType.Sint64:
                this.writeInt64(field.value);
                return;
            case FitBaseType.Uint64:
            case FitBaseType.Uint64z:
                this.writeUInt64(field.value);
                return;
            default:
                throw new Error(`Unsupported FIT base type ${field.baseType}`);
        }
    }
    getBaseTypeSize(baseType) {
        switch (baseType) {
            case FitBaseType.Enum:
            case FitBaseType.Sint8:
            case FitBaseType.Uint8:
            case FitBaseType.Uint8z:
            case FitBaseType.Byte:
                return 1;
            case FitBaseType.Sint16:
            case FitBaseType.Uint16:
            case FitBaseType.Uint16z:
                return 2;
            case FitBaseType.Sint32:
            case FitBaseType.Uint32:
            case FitBaseType.Uint32z:
            case FitBaseType.Float32:
                return 4;
            case FitBaseType.Float64:
            case FitBaseType.Sint64:
            case FitBaseType.Uint64:
            case FitBaseType.Uint64z:
                return 8;
            default:
                return undefined;
        }
    }
    isSupportedBaseType(baseType) {
        return (baseType === FitBaseType.String
            || this.getBaseTypeSize(baseType) !== undefined);
    }
    writeUInt8(value) {
        this.data.push(value);
    }
    writeUInt16(value) {
        this.data.push(value & UINT8_MAX, (value >>> 8) & UINT8_MAX);
    }
    writeInt8(value) {
        this.writeUInt8(value < 0 ? 0x100 + value : value);
    }
    writeInt16(value) {
        this.writeUInt16(value < 0 ? 0x10000 + value : value);
    }
    writeUInt32(value) {
        this.data.push(value & UINT8_MAX, Math.floor(value / 0x100) & UINT8_MAX, Math.floor(value / 0x10000) & UINT8_MAX, Math.floor(value / 0x1000000) & UINT8_MAX);
    }
    writeInt32(value) {
        this.writeUInt32(value < 0 ? 0x100000000 + value : value);
    }
    writeUInt64(value) {
        for (let byteIndex = BIGINT_ZERO; byteIndex < BIGINT_EIGHT; byteIndex++) {
            this.writeUInt8(Number((value >> (byteIndex * BIGINT_EIGHT)) & BIGINT_BYTE_MASK));
        }
    }
    writeInt64(value) {
        this.writeUInt64(value < BIGINT_ZERO ? UINT64_MODULUS + value : value);
    }
    writeFloat32(value) {
        const bytes = new Uint8Array(4);
        new DataView(bytes.buffer).setFloat32(0, value, true);
        bytes.forEach(byte => this.writeUInt8(byte));
    }
    writeFloat64(value) {
        const bytes = new Uint8Array(8);
        new DataView(bytes.buffer).setFloat64(0, value, true);
        bytes.forEach(byte => this.writeUInt8(byte));
    }
    static assertIntegerInRange(value, minimum, maximum, label) {
        if (typeof value !== 'number'
            || !Number.isInteger(value)
            || value < minimum
            || value > maximum) {
            throw new RangeError(`${label} must be an integer between ${minimum} and ${maximum}`);
        }
        return value;
    }
}
