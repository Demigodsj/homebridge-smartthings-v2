const {
    knownCapabilities
} = require("./Constants");
const _ = require("lodash");
const DeviceTypes = require('./ST_DeviceTypes');
var Service, Characteristic;

module.exports = class ST_Accessories {
    constructor(platform) {
        this.platform = platform;
        this.configItems = platform.getConfigItems();
        this.temperature_unit = platform.temperature_unit;
        this.myUtils = platform.myUtils;
        this.log = platform.log;
        this.hap = platform.hap;
        this.uuid = platform.uuid;
        Service = platform.Service;
        Characteristic = platform.Characteristic;
        this.CommunityTypes = require("./CommunityTypes")(Service, Characteristic);
        this.client = platform.client;
        this.comparator = this.comparator.bind(this);
        this.device_types = new DeviceTypes(this, Service, Characteristic);
        this._accessories = {};
        this._ignored = {};
        this._attributeLookup = {};
    }

    PopulateAccessory(accessory, deviceData) {
        try {
            accessory.deviceid = deviceData.deviceid;
            accessory.name = deviceData.name;
            accessory.state = {};
            //Removing excluded capabilities from config
            deviceData.excludedCapabilities.forEach(cap => {
                if (cap !== undefined) {
                    this.log.debug(`Removing capability: ${cap} from Device: ${deviceData.name}`);
                    delete deviceData.capabilities[cap];
                }
            });
            accessory.context.deviceData = deviceData;
            accessory.context.name = deviceData.name;
            accessory.context.deviceid = deviceData.deviceid;
            accessory.context.uuid = accessory.UUID || this.uuid.generate(`smartthings_v2_${accessory.deviceid}`);
            accessory.getOrAddService = this.getOrAddService.bind(accessory);
            return this.initializeDeviceCharacteristics(accessory);
        } catch (ex) {
            this.log.error(ex);
            return accessory;
        }
    }

    CreateAccessoryFromHomebridgeCache(accessory) {
        try {
            let deviceid = accessory.context.deviceid;
            let name = accessory.context.name;
            this.log.debug(`Initializing Cached Device ${deviceid}`);
            accessory.deviceid = deviceid;
            accessory.name = name;
            accessory.context.uuid = accessory.UUID || this.uuid.generate(`smartthings_v2_${accessory.deviceid}`);
            accessory.getOrAddService = this.getOrAddService.bind(accessory);
            return this.initializeDeviceCharacteristics(accessory);
        } catch (ex) {
            this.log.error(ex);
            return accessory;
        }
    }

    initializeDeviceCharacteristics(accessory) {
        //TODO: Cleanup Unused Services from Cached Devices
        for (let index in accessory.context.deviceData.capabilities) {
            if (knownCapabilities.indexOf(index) === -1 && this.platform.unknownCapabilities.indexOf(index) === -1) {
                this.platform.unknownCapabilities.push(index);
            }
        }

        let that = this;
        let deviceGroups = [];
        let devData = accessory.context.deviceData;
        accessory.reachable = true;
        accessory
            .getOrAddService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.FirmwareRevision, devData.firmwareVersion)
            .setCharacteristic(Characteristic.Manufacturer, devData.manufacturerName)
            .setCharacteristic(Characteristic.Model, `${that.myUtils.toTitleCase(devData.modelName)}`)
            .setCharacteristic(Characteristic.Name, devData.name)
            .setCharacteristic(Characteristic.SerialNumber, devData.serialNumber);

        let hasCapability = (obj) => {
            let keys = Object.keys(devData.capabilities);
            if (keys.includes(obj) || keys.includes(obj.toString().replace(/\s/g, ""))) return true;
            return false;
        };
        let hasAttribute = (attr) => {
            return Object.keys(devData.attributes).includes(attr);
        };
        let hasCommand = (cmd) => {
            return Object.keys(devData.commands).includes(cmd);
        };
        let newAccessory = accessory;
        let isMode = hasCapability("Mode");
        let isRoutine = hasCapability("Routine");
        let isFan = (hasCapability('Fan') || hasCapability('Fan Light') || hasCapability('Fan Speed') || hasCommand('lowSpeed'));
        let isWindowShade = (hasCapability('Window Shade') && (hasCommand('levelOpenClose') || hasCommand('presetPosition')));
        let isLight = (hasCapability('LightBulb') || hasCapability('Fan Light') || hasCapability('Bulb') || devData.name.includes('light'));
        let isSpeaker = hasCapability('Speaker');
        let isSonos = (devData.manufacturerName === "Sonos");
        let isThermostat = (hasCapability('Thermostat') || (hasCapability('Thermostat Operating State') && hasCapability('Thermostat Mode')));
        if (devData && newAccessory.context.deviceData.capabilities) {
            if (hasCapability('Switch Level') && !isSpeaker && !isFan && !isMode && !isRoutine) {
                if (isWindowShade) {
                    // This is a Window Shade
                    deviceGroups.push("window_shade");
                    newAccessory = that.device_types.window_shade(newAccessory, devData);
                } else if (isLight || devData.commands.setLevel) {
                    deviceGroups.push("light");
                    newAccessory = that.device_types.light_bulb(newAccessory, devData);
                    newAccessory = that.device_types.light_level(newAccessory, devData);
                    if (hasCapability("Color Control")) {
                        newAccessory = that.device_types.light_color(newAccessory, devData);
                    }
                }
            }

            if (hasCapability('Garage Door Control')) {
                deviceGroups.push("garage_door");
                newAccessory = that.device_types.garage_door(newAccessory, devData);
            }


            if (hasCapability('Lock')) {
                deviceGroups.push("lock");
                newAccessory = that.device_types.lock(newAccessory, devData);
            }

            if (hasCapability('Valve')) {
                deviceGroups.push("valve");
                newAccessory = that.device_types.valve(newAccessory, devData);
            }

            // GENERIC SPEAKER DEVICE
            if (isSpeaker) {
                deviceGroups.push("speaker");
                newAccessory = that.device_types.generic_speaker(newAccessory, devData);
            }

            //Handles Standalone Fan with no levels
            if (isFan && (hasCapability('Fan Light') || deviceGroups.length < 1)) {
                deviceGroups.push("fan");
                newAccessory = that.device_types.fan(newAccessory, devData);
            }

            if (isMode) {
                deviceGroups.push("mode");
                newAccessory = that.device_types.virtual_mode(newAccessory, devData);
            }

            if (isRoutine) {
                deviceGroups.push("routine");
                newAccessory = that.device_types.virtual_routine(newAccessory, devData);
            }

            if (hasCapability("Button")) {
                deviceGroups.push("button");
                newAccessory = that.device_types.button(newAccessory, devData);
            }

            // This should catch the remaining switch devices that are specially defined
            if (hasCapability("Switch") && isLight && deviceGroups.length < 1) {
                //Handles Standalone Fan with no levels
                deviceGroups.push("light");
                newAccessory = that.device_types.light_bulb(newAccessory, devData);
            }

            if (hasCapability('Switch') && !isLight && deviceGroups.length < 1) {
                deviceGroups.push("switch");
                newAccessory = that.device_types.switch(newAccessory, devData);
            }

            // Smoke Detectors
            if (hasCapability('Smoke Detector') && hasAttribute('smoke')) {
                deviceGroups.push("smoke_detector");
                newAccessory = that.device_types.smoke_detector(newAccessory, devData);
            }

            if (hasCapability("Carbon Monoxide Detector") && hasAttribute('carbonMonoxide')) {
                deviceGroups.push("carbon_monoxide_detector");
                newAccessory = that.device_types.carbon_monoxide(newAccessory, devData);
            }

            if (hasCapability("Carbon Dioxide Measurement") && hasAttribute('carbonDioxideMeasurement')) {
                deviceGroups.push("carbon_dioxide_measure");
                newAccessory = that.device_types.carbon_dioxide(newAccessory, devData);
            }

            if (hasCapability('Motion Sensor')) {
                deviceGroups.push("motion_sensor");
                newAccessory = that.device_types.motion_sensor(newAccessory, devData);
            }

            if (hasCapability("Water Sensor")) {
                deviceGroups.push("water_sensor");
                newAccessory = that.device_types.water_sensor(newAccessory, devData);
            }
            if (hasCapability("Presence Sensor")) {
                deviceGroups.push("presence_sensor");
                newAccessory = that.device_types.presence_sensor(newAccessory, devData);
            }

            if (hasCapability("Relative Humidity Measurement")) {
                deviceGroups.push("humidity_sensor");
                newAccessory = that.device_types.humidity_sensor(newAccessory, devData);
            }

            if (hasCapability("Temperature Measurement")) {
                deviceGroups.push("temp_sensor");
                newAccessory = that.device_types.temperature_sensor(newAccessory, devData);
            }

            if (hasCapability("Illuminance Measurement")) {
                deviceGroups.push("illuminance_sensor");
                newAccessory = that.device_types.illuminance_sensor(newAccessory, devData);
            }

            if (hasCapability('Contact Sensor') && !hasCapability('Garage Door Control')) {
                deviceGroups.push("contact_sensor");
                newAccessory = that.device_types.contact_sensor(newAccessory, devData);
            }

            if (hasCapability("Battery")) {
                deviceGroups.push("battery_level");
                newAccessory = that.device_types.battery(newAccessory, devData);
            }

            if (hasCapability('Energy Meter') && !hasCapability('Switch') && deviceGroups.length < 1) {
                deviceGroups.push("energy_meter");
                newAccessory = that.device_types.energy_meter(newAccessory, devData);
            }

            if (hasCapability('Power Meter') && !hasCapability('Switch') && deviceGroups.length < 1) {
                deviceGroups.push("power_meter");
                newAccessory = that.device_types.power_meter(newAccessory, devData);
            }

            // Thermostat
            if (isThermostat) {
                deviceGroups.push("thermostat");
                newAccessory = that.device_types.thermostat(newAccessory, devData);
            }

            // Alarm System Control/Status
            if (hasAttribute("alarmSystemStatus")) {
                deviceGroups.push("alarm");
                newAccessory = that.device_types.alarm_system(newAccessory, devData);
            }

            // Sonos Speakers
            if (isSonos && deviceGroups.length < 1) {
                deviceGroups.push("speakers");
                newAccessory = that.device_types.sonos_speaker(newAccessory, devData);
            }
            newAccessory.context.deviceGroups = deviceGroups;

            this.log.debug(deviceGroups);
        }
        newAccessory = this.removeDeprecatedServices(accessory, newAccessory);
        return that.loadAccessoryData(newAccessory, devData) || newAccessory;
    }

    processDeviceAttributeUpdate(change) {
        let attrObj = this.getAttributeStoreItem(change.attribute, change.deviceid);
        let accessory = this.getAccessoryFromCache(change);
        if (!attrObj || !accessory) return;
        if (attrObj instanceof Array) {
            attrObj.forEach(characteristic => {
                let newVal = this.attributeStateTransform(change.attribute, change.value, characteristic.displayName);
                accessory.context.deviceData.attributes[change.attribute] = newVal;
                characteristic.updateValue(newVal);
                // characteristic.getValue();
            });
        }
    }

    attributeStateTransform(attr, val, charName) {
        switch (attr) {
            case "switch":
                return (val === 'on');
            case "door":
                switch (val) {
                    case "open":
                        return Characteristic.TargetDoorState.OPEN;
                    case "opening":
                        return charName && charName === "Target Door State" ? Characteristic.TargetDoorState.OPEN : Characteristic.TargetDoorState.OPENING;
                    case "closed":
                        return Characteristic.TargetDoorState.CLOSED;
                    case "closing":
                        return charName && charName === "Target Door State" ? Characteristic.TargetDoorState.CLOSED : Characteristic.TargetDoorState.CLOSING;
                    default:
                        return charName && charName === "Target Door State" ? Characteristic.TargetDoorState.OPEN : Characteristic.TargetDoorState.STOPPED;
                }

            case "lock":
                switch (val) {
                    case "locked":
                        return Characteristic.LockCurrentState.SECURED;
                    case "unlocked":
                        return Characteristic.LockCurrentState.UNSECURED;
                    default:
                        return Characteristic.LockCurrentState.UNKNOWN;
                }

            case "button":
                // case "supportButtonValues":
                switch (val) {
                    case "pushed":
                        return Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS;
                    case "held":
                        return Characteristic.ProgrammableSwitchEvent.LONG_PRESS;
                    case "double":
                        return Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS;
                    default:
                        return undefined;
                }

            case "valve":
                return (val === "open") ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE;
            case "mute":
                return (val === 'muted');
            case "smoke":
                return (val === "clear") ? Characteristic.SmokeDetected.SMOKE_NOT_DETECTED : Characteristic.SmokeDetected.SMOKE_DETECTED;
            case "carbonMonoxide":
                return (val === "clear") ? Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL : Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL;
            case "carbonDioxideMeasurement":
                switch (charName) {
                    case "Carbon Dioxide Detected":
                        return (val < 2000) ? Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL : Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL;
                    default:
                        return parseInt(val);
                }
            case "tamper":
                return (val === "detected") ? Characteristic.StatusTampered.TAMPERED : Characteristic.StatusTampered.NOT_TAMPERED;
            case "motion":
                return (val === "active");
            case "water":
                return (val === "dry") ? Characteristic.LeakDetected.LEAK_NOT_DETECTED : Characteristic.LeakDetected.LEAK_DETECTED;
            case "contact":
                return (val === "closed") ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
            case "presence":
                return (val === "present");
            case "battery":
                if (charName === "Status Low Battery") {
                    return (val < 20) ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
                } else {
                    return Math.round(val);
                }
            case "hue":
                return Math.round(val * 3.6);
            case "temperature":
            case "heatingSetpoint":
            case "coolingSetpoint":
                return this.myUtils.tempConversionFrom_F(val);
            case "level":
            case "fanSpeed":
            case "saturation":
            case "volume":
                return parseInt(val) || 0;
            case "illuminance":
                return Math.ceil(val);

            case "energy":
            case "humidity":
            case "power":
                return Math.round(val);

            case "thermostatOperatingState":
                switch (val) {
                    case "pending cool":
                    case "cooling":
                        return Characteristic.CurrentHeatingCoolingState.COOL;
                    case "pending heat":
                    case "heating":
                        return Characteristic.CurrentHeatingCoolingState.HEAT;
                    default:
                        // The above list should be inclusive, but we need to return something if they change stuff.
                        // TODO: Double check if Smartthings can send "auto" as operatingstate. I don't think it can.
                        return Characteristic.CurrentHeatingCoolingState.OFF;
                }

            case "thermostatMode":
                switch (val) {
                    case "cool":
                        return Characteristic.TargetHeatingCoolingState.COOL;
                    case "emergency heat":
                    case "heat":
                        return Characteristic.TargetHeatingCoolingState.HEAT;
                    case "auto":
                        return Characteristic.TargetHeatingCoolingState.AUTO;
                    default:
                        return Characteristic.TargetHeatingCoolingState.OFF;
                }
            case "alarmSystemStatus":
                return this.myUtils.convertAlarmState(val, true, Characteristic);
            default:
                return val;
        }
    }

    loadAccessoryData(accessory, deviceData) {
        let that = this;
        // return new Promise((resolve, reject) => {
        if (deviceData !== undefined) {
            this.log.debug("Setting device data from existing data");
            accessory.context.deviceData = deviceData;
            for (let i = 0; i < accessory.services.length; i++) {
                for (let j = 0; j < accessory.services[i].characteristics.length; j++) {
                    accessory.services[i].characteristics[j].getValue();
                }
            }
            return accessory;
        } else {
            this.log.debug("Fetching Device Data");
            this.client
                .getDevice(accessory.deviceid)
                .then(data => {
                    if (data === undefined) {
                        return accessory;
                    }
                    accessory.context.deviceData = data;
                    for (let i = 0; i < accessory.services.length; i++) {
                        for (let j = 0; j < accessory.services[i].characteristics.length; j++) {
                            accessory.services[i].characteristics[j].getValue();
                        }
                    }
                    return accessory;
                })
                .catch(err => {
                    that.log.error(
                        "Failed to get Device Data for " + accessory.deviceid,
                        err
                    );
                    return accessory;
                });
        }
        // });
    }

    getOrAddService(svc) {
        let s = this.getService(svc);
        if (!s) {
            s = this.addService(svc);
        }
        return s;
    }

    getOrAddCharacteristic(service, characteristic) {
        return (
            service.getCharacteristic(characteristic) ||
            service.addCharacteristic(characteristic)
        );
    }

    getServices() {
        return this.services;
    }

    removeDeprecatedServices(accessory, newAccessory) {
        const configuredServices = newAccessory.services.map(s => s.UUID);
        // accessory.services.filter(s => !configuredServices.includes(s.UUID)).forEach(s => accessory.removeService(s));
        let remove = accessory.services.filter(s => !configuredServices.includes(s.UUID));
        this.log('removeServices:', remove);
        remove.forEach(s => accessory.removeService(s));
        return accessory;
    }

    storeCharacteristicItem(attr, devid, char) {
        if (!this._attributeLookup[attr]) {
            this._attributeLookup[attr] = {};
        }
        if (!this._attributeLookup[attr][devid]) {
            this._attributeLookup[attr][devid] = [];
        }
        this._attributeLookup[attr][devid].push(char);
    }

    getAttributeStoreItem(attr, devid) {
        if (!this._attributeLookup[attr] || !this._attributeLookup[attr][devid])
            return undefined;
        return this._attributeLookup[attr][devid] || undefined;
    }

    getAccessoryId(accessory) {
        const id = accessory.deviceid || accessory.context.deviceid || undefined;
        return id;
    }

    getAccessoryFromCache(device) {
        const key = this.getAccessoryId(device);
        return this._accessories[key];
    }

    getAllAccessoriesFromCache() {
        return this._accessories;
    }

    addAccessoryToCache(accessory) {
        const key = this.getAccessoryId(accessory);
        return (this._accessories[key] = accessory);
    }

    removeAccessoryFromCache(accessory) {
        const key = this.getAccessoryId(accessory);
        const _accessory = this._accessories[key];
        delete this._accessories[key];
        return _accessory;
    }

    forEach(fn) {
        return _.forEach(this._accessories, fn);
    }

    intersection(devices) {
        const accessories = _.values(this._accessories);
        return _.intersectionWith(devices, accessories, this.comparator);
    }

    diffAdd(devices) {
        const accessories = _.values(this._accessories);
        return _.differenceWith(devices, accessories, this.comparator);
    }

    diffRemove(devices) {
        const accessories = _.values(this._accessories);
        return _.differenceWith(accessories, devices, this.comparator);
    }

    comparator(accessory1, accessory2) {
        return this.getAccessoryId(accessory1) === this.getAccessoryId(accessory2);
    }
};

// eslint-disable-next-line no-unused-vars
function clearAndSetTimeout(timeoutReference, fn, timeoutMs) {
    if (timeoutReference) {
        clearTimeout(timeoutReference);
    }
    return setTimeout(fn, timeoutMs);
}