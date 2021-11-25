'use strict';

let ElementHomeClient = require('./lib/client');
let Color = require('./lib/color');
let Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
	Accessory = homebridge.platformAccessory;
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	UUIDGen = homebridge.hap.uuid;

	homebridge.registerPlatform("homebridge-sengled-bulbs", "SengledHub", SengledHubPlatform);
};

function SengledHubPlatform(log, config, api) {
	this.log = log;
	this.config = config;
	this.accessories = {};
	this.cache_timeout = 60; // seconds
	this.debug = config['debug'] || false;
	this.info = config['info'] || true;
	this.username = config['username'];
	this.password = config['password'];

	if (api) {
		this.api = api;
		this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
	}

	this.client = new ElementHomeClient(log, this.debug, this.info);
}

SengledHubPlatform.prototype.configureAccessory = function(accessory) {
	let me = this;
	if (me.debug) me.log("configureAccessory invoked " + accessory);
    accessory.reachable = true;
	let accessoryId = accessory.context.id;
	if (this.debug) this.log("configureAccessory: " + accessoryId);

	// Handle rename case. Depending on which order the accessories come back in, we will want to handle them differently below
	if (this.accessories[accessoryId]) {
		this.log("Duplicate accessory detected, removing existing if possible, otherwise removing this accessory", accessoryId);
		try {
			this.removeAccessory(this.accessories[accessoryId], accessoryId);
			this.setService(accessory);
		} catch (error) {
			this.removeAccessory(accessory, accessoryId);
			accessory = this.accessories[accessoryId];
		}
	} else {
		this.setService(accessory);
	}

	this.accessories[accessoryId] = accessory;
};

SengledHubPlatform.prototype.didFinishLaunching = function() {
	let me = this;
	if (me.debug) me.log("didFinishLaunching invoked ");
	if (me.debug) me.log(me.accessories);

	// // dev-mode
	// for (let index in me.accessories) {
	// 	me.removeAccessory(me.accessories[index]);
	// }

	this.deviceDiscovery();
	setInterval(me.deviceDiscovery.bind(me), this.cache_timeout * 6000);
};

// Update the homebridge context from a Sengled device
function UpdateContextFromDevice(context, device) {
	context.name = device.name;
	context.id = device.id;
	context.status = device.status;
	context.brightness = device.brightness;
	context.minBrightness = device.minBrightness;
	context.maxBrightness = device.maxBrightness;
	context.color = device.color; // by ref
	context.isOnline = device.isOnline;
	context.signalQuality = device.signalQuality;
}

SengledHubPlatform.prototype.deviceDiscovery = function() {
	let me = this;
	if (me.debug) me.log("deviceDiscovery invoked");

	this.client.login(this.username, this.password).then(() => {
		return this.client.getDevices();
	}).then(devices => {
		if (me.debug) me.log("Adding discovered devices");
		for (let i in devices) {
			let existing = me.accessories[devices[i].id];

			if (!existing) {
				me.log("Adding device: ", devices[i].id, devices[i].name);
				me.addAccessory(devices[i]);
			} else {
				UpdateContextFromDevice(existing.context, devices[i]);

				if (me.debug) me.log("Skipping existing device", i);
			}
		}

		// Check existing accessories exist in sengled devices
		if (devices) {
			for (let index in me.accessories) {
				var acc = me.accessories[index];
				me.getState(acc);
				var found = devices.find((device) => {
					return device.id.includes(index);
				});
				if (!found) {
					me.log("Previously configured accessory not found, removing", index);
					me.removeAccessory(me.accessories[index]);
				} else if (found.name != acc.context.name) {
					me.log("Accessory name does not match device name, got " + found.name + " expected " + acc.context.name);
					me.removeAccessory(me.accessories[index]);
					me.addAccessory(found);
					me.log("Accessory removed & readded!");
				}
			}
		}

		if (me.debug) me.log("Discovery complete");
		if (me.debug) me.log(me.accessories);
	});
};

SengledHubPlatform.prototype.addAccessory = function(data) {
	let me = this;
	if (me.debug) me.log("addAccessory invoked: ");
	if (me.debug) me.log(data);

	if (!this.accessories[data.id]) {
		let uuid = UUIDGen.generate(data.id);

		let displayName = !(data.name) ? data.id : data.name;
		// 5 == Accessory.Categories.LIGHTBULB
		// 8 == Accessory.Categories.SWITCH
		var newAccessory = new Accessory(displayName, uuid, 5);
		UpdateContextFromDevice(newAccessory.context, data);

		me.log(newAccessory.context);

		var lightbulbService = new Service.Lightbulb();
		lightbulbService.displayName = data.name;

		var bringtnessCharacterstics = new Characteristic.Brightness(UUIDGen.generate(data.id + "1"));
		lightbulbService.addCharacteristic(bringtnessCharacterstics);

		// Note: Sengled bulbs like the E12-N1E appear to have leds dedicated to a range of color temperatures for white
		// light in addition to the RGB lights.  The colorMode indicates if using white light or color.  Setting the lights
		// to white light mode is much brighter than setting a color via RGB mode, so it's desirable to use the white light
		// mode. Using Sengled's homekit "capable" hub resulted in Homekit only using the color mode, regardless of the
		// setting. To work-around, this plugin treats setting the color temperature as changing to white light mode, and
		// setting hue or saturation as switching to color mode. Seems to work even if that's not the intended use.

		var colorTemperatureCharacterstics = new Characteristic.ColorTemperature(UUIDGen.generate(data.id + "2"));
		lightbulbService.addCharacteristic(colorTemperatureCharacterstics);

		var hueCharacterstics = new Characteristic.Hue(UUIDGen.generate(data.id + "3"));
		lightbulbService.addCharacteristic(hueCharacterstics);

		var saturationCharacterstics = new Characteristic.Saturation(UUIDGen.generate(data.id + "4"));
		lightbulbService.addCharacteristic(saturationCharacterstics);

		newAccessory.addService(lightbulbService, data.name);

	this.setService(newAccessory);

        this.api.registerPlatformAccessories(
            'homebridge-sengled-bulbs',
            'SengledHub',
            [newAccessory]
        );
    } else {
        var newAccessory = this.accessories[data.id];
    }

    this.getInitState(newAccessory, data);

    this.accessories[data.id] = newAccessory;
};

/**
 * In some cases the accessory context is undefined, or the accessory is undefined. to keep the code dry, this
 * is the only method for removing an accessory from the homebridge platform and the plugin accessory context.
 *
 * When the id is already known, it should be passed as the second parameter to ensure both homebridge api and
 * local accessory context is cleaned up after a device rename/removal. There may be a case where the id needs
 * to be removed from local context, but is missing from the homebridge api, so I wrapped the
 * unregisterPlatformAccessories call in a try/catch to avoid crashing before removing from this.accessories
 *
 * If the accessoryId is not passed in, attempt to find the accessory id from the context. In the case where
 * the id is still not determined, attempt to remove the device from the homebridge api to avoid crashes.
 */
SengledHubPlatform.prototype.removeAccessory = function(accessory, accessoryId = undefined) {
	if (accessory) {
		let id = accessoryId !== undefined ? accessoryId : (accessory.context === undefined ? undefined : accessory.context.id);
		if (this.debug) this.log("Removing accessory", id);

		try {
			this.api.unregisterPlatformAccessories("homebridge-sengled-bulbs", "SengledHub", [accessory]);
		} catch (error) {
			// in case its already been deregistered, don't crash. remove from plugin's accessories context below
		}

		// Remove from local accessories context if id is defined
		if (id !== undefined) {
			delete this.accessories[id];
		}
	}
};

SengledHubPlatform.prototype.setService = function(accessory) {
	let me = this;
	if (me.debug) me.log("setService invoked: ");
	if (me.debug) me.log(accessory);

	var lightbulbService = accessory.getService(Service.Lightbulb);
	lightbulbService.getCharacteristic(Characteristic.On)
		.on('set', this.setPowerState.bind(this, accessory.context))
		.on('get', this.getPowerState.bind(this, accessory.context));
	lightbulbService.getCharacteristic(Characteristic.Brightness)
		.setProps({
			minValue: accessory.context.minBrightness,
			maxValue: accessory.context.maxBrightness
		})
		.on('set', this.setBrightness.bind(this, accessory.context))
		.on('get', this.getBrightness.bind(this, accessory.context));
	lightbulbService.getCharacteristic(Characteristic.ColorTemperature)
		.setProps({
			minValue: accessory.context.color.minColorTemperature,
			maxValue: accessory.context.color.maxColorTemperature
		})
		.on('set', this.setColorTemperature.bind(this, accessory.context))
		.on('get', this.getColorTemperature.bind(this, accessory.context));
	lightbulbService.getCharacteristic(Characteristic.Hue)
		.on('set', this.setHue.bind(this, accessory.context))
		.on('get', this.getHue.bind(this, accessory.context));
	lightbulbService.getCharacteristic(Characteristic.Saturation)
		.on('set', this.setSaturation.bind(this, accessory.context))
		.on('get', this.getSaturation.bind(this, accessory.context));

	accessory.on('identify', this.identify.bind(this, accessory.context));
};

SengledHubPlatform.prototype.getInitState = function(accessory, data) {
	let me = this;
	if (me.debug) me.log("getInitState invoked: " + accessory + " " + data);

	let info = accessory.getService(Service.AccessoryInformation);

	accessory.context.manufacturer = "Sengled";
	info.setCharacteristic(Characteristic.Manufacturer, accessory.context.manufacturer);

	accessory.context.model = (data.productCode != null) ? data.productCode : "Sengled Hub";
	info.setCharacteristic(Characteristic.Model, accessory.context.model);

	info.setCharacteristic(Characteristic.SerialNumber, accessory.context.id);
	const lightbulbService = accessory.getService(Service.Lightbulb);
	lightbulbService.getCharacteristic(Characteristic.On).getValue();

	lightbulbService.getCharacteristic(Characteristic.Brightness).getValue();

	lightbulbService
		.getCharacteristic(Characteristic.ColorTemperature)
		.getValue();

	lightbulbService.getCharacteristic(Characteristic.Hue).getValue();
	lightbulbService.getCharacteristic(Characteristic.Saturation).getValue();

	me.getState(accessory);
};

SengledHubPlatform.prototype.getState = function(accessory) {
	let me = this;
	if (me.debug) me.log("getState invoked: " + accessory);

	accessory.getService(Service.Lightbulb)
		.getCharacteristic(Characteristic.On)
		.getValue();
	accessory.getService(Service.Lightbulb)
		.getCharacteristic(Characteristic.Brightness)
		.getValue();
	accessory.getService(Service.Lightbulb)
		.getCharacteristic(Characteristic.ColorTemperature)
		.getValue();
	accessory.getService(Service.Lightbulb)
		.getCharacteristic(Characteristic.Hue)
		.getValue()
	accessory.getService(Service.Lightbulb)
		.getCharacteristic(Characteristic.Saturation)
		.getValue()
};

SengledHubPlatform.prototype.setPowerState = function(thisLight, powerState, callback) {
	let me = this;
	if (this.debug) this.log("++++ Sending device: " + thisLight.id + " status change to " + powerState);

	return this.client.login(this.username, this.password).then(() => {
		return this.client.deviceSetOnOff(thisLight.id, powerState);
	}).then(() => {
		//thisLight.status = powerState;
		// callback(null, device.status);
		callback();
	}).catch((err) => {
		this.log("Failed to set power state to", powerState);
		//callback(err);
	});
};

SengledHubPlatform.prototype.getPowerState = function(thisLight, callback) {
	let me = this;
	if (this.debug) this.log("Getting device PowerState: " + thisLight.name + " status");
	if (this.accessories[thisLight.id]) {
		return this.client.login(this.username, this.password).then(() => {
			return this.client.getDevices();
		}).then(devices => {
			return devices.find((device) => {
				return device.id.includes(thisLight.id);
			});
		}).then((device) => {
			if (typeof device === 'undefined') {
				if (this.debug) this.log("Removing undefined device", thisLight.name);
				this.removeAccessory(thisLight)
			} else {
				if (this.debug) this.log("getPowerState complete: " + device.name + " " + thisLight.name + " is " + device.status);
				thisLight.status = device.status;
				callback(null, device.status);
			}
		});
	} else {
		callback(new Error("Device not found"));
	}
};

SengledHubPlatform.prototype.setBrightness = function(thisLight, brightness, callback) {
	let me = this;
	if (me.debug) me.log("++++ setBrightness: " + thisLight.name + " status brightness to " + brightness);
	brightness = brightness || thisLight.color.minBrightness;
	if (me.debug) me.log("++++ Sending device: " + thisLight.name + " status brightness to " + brightness);

	return this.client.login(this.username, this.password).then(() => {
		return this.client.deviceSetBrightness(thisLight.id, brightness);
	}).then(() => {
		thisLight.brightness = brightness;
		callback();
	}).catch((err) => {
		this.log("Failed to set brightness to", brightness);
		callback(err);
	});
};

SengledHubPlatform.prototype.getBrightness = function(thisLight, callback) {
    if (this.accessories[thisLight.id]) {
        if (this.debug) this.log('Getting Brightness: %s %s %s', thisLight.id, thisLight.name, thisLight.brightness);
        callback( null, thisLight.brightness);
    } else {
        callback(new Error('Device not found'));
    }
};

SengledHubPlatform.prototype.setColorTemperature = function(thisLight, colortemperature, callback) {
	let me = this;
	if (me.debug) me.log("++++ setColortemperature: " + thisLight.name + " status colortemperature to " + colortemperature);
	let sengledColorTemperature = colortemperature || thisLight.color.minColorTemperature;
	sengledColorTemperature = Color.MiredsToSengledColorTemperature(sengledColorTemperature);
	if (me.debug) me.log("++++ Sending device: " + thisLight.name + " status colortemperature to " + colortemperature);

	return this.client.login(this.username, this.password).then(() => {
		return this.client.deviceSetColorTemperature(thisLight.id, sengledColorTemperature);
	}).then(() => {
		// Set the new color tempreature to the context.  This also updates hue and saturation.
		thisLight.color.SetColorTemperature(colortemperature);

		let accessory = me.accessories[thisLight.id];

		if (accessory) {
			let lightbulbService = accessory.getService(Service.Lightbulb);

			// The light is now in "white light" mode.  Update hue and saturation to homekit.  This makes the
			// color temperature circle in the color temperature setting match-ish color temperature (warm blue
			// to cool orange-ish).
			lightbulbService.getCharacteristic(Characteristic.Hue).updateValue(thisLight.color.hue);
			lightbulbService.getCharacteristic(Characteristic.Saturation).updateValue(thisLight.color.saturation);
		}

		callback();
	}).catch((err) => {
		this.log("Failed to set colortemperature to " + colortemperature);
		callback(err);
	});
};

SengledHubPlatform.prototype.getColorTemperature = function(
    thisLight,
    callback
) {
    if (this.accessories[thisLight.id]) {
        this.log(
            'Getting Color Temperature: %s %s %d',
            thisLight.id,
            thisLight.name,
            thisLight.color.colorTemperature
        );
        callback(null, thisLight.color.colorTemperature);
    }else {
        callback(new Error('Device not found'));
    }
};

SengledHubPlatform.prototype.setHue = function(thisLight, hue, callback) {
	if (this.debug) this.log("+++setHue: " + thisLight.name + " status hue to " + hue);
	thisLight.color.SetHue(hue);
	callback();
};

SengledHubPlatform.prototype.getHue = function(thisLight, callback) {
	if (this.debug) this.log("+++getHue: " + thisLight.name + "  hue: " + thisLight.color.hue);
	callback(null, thisLight.color.hue);
};

SengledHubPlatform.prototype.setSaturation = function(thisLight, saturation, callback) {
	if (this.debug) this.log("+++setSaturation: " + thisLight.name + " status saturation to " + saturation);
	thisLight.color.SetSaturation(saturation);


	let rgbColor = Color.NormailizedRgbToSengledRgb(thisLight.color.rgbColor.r, thisLight.color.rgbColor.g, thisLight.color.rgbColor.b );

	if (this.debug) this.log("++++ Sending device: " + thisLight.name + " rgb color to " + "r: " + rgbColor.r + " g: " + rgbColor.g + " b: " + rgbColor.b );

	return this.client.login(this.username, this.password).then(() => {
		return this.client.deviceSetRgbColor(thisLight.id, rgbColor);
	}).then(() => {

		// TODO: Should color temp be updated
		// let accessory = this.accessories[thisLight.id];

		// if (accessory) {
		// 	let lightbulbService = accessory.getService(Service.Lightbulb);
		//
		//	lightbulbService.getCharacteristic(Characteristic.ColorTemperature).updateValue(thisLight.color.colorTemperature);
		// }

		callback();
	}).catch((err) => {
		this.log("Failed to set rgb color to ", thisLight.color.rgbColor);
		callback(err);
	});
};


SengledHubPlatform.prototype.getSaturation = function(thisLight, callback) {
	if (this.debug) this.log("+++getSaturation: " + thisLight.name + " saturation: " + thisLight.color.saturation);
	callback(null, thisLight.color.saturation);
};

SengledHubPlatform.prototype.identify = function(thisLight, paired, callback) {
	let me = this;
	if (me.debug) me.log("identify invoked: " + thisLight + " " + paired);
	callback();
};
