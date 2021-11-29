'use strict';

const {ElementHomeClient, Brightness} = require('./lib/client');
const {RgbColor, ColorContextData, Color} = require('./lib/color');
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
			this.removeAccessory(this.accessories[accessoryId].accessory, accessoryId);
			var sengledAccessory = this.setService(accessory);
		} catch (error) {
			this.removeAccessory(accessory, accessoryId);
			var sengledAccessory = this.accessories[accessoryId];
		}
	} else {
		var sengledAccessory = this.setService(accessory);
	}

	this.accessories[accessoryId] = sengledAccessory;
};

SengledHubPlatform.prototype.didFinishLaunching = function() {
	let me = this;
	if (me.debug) me.log("didFinishLaunching invoked ");
	if (me.debug) me.log(JSON.stringify(me.accessories, null, 4));

	// // dev-mode
	// for (let index in me.accessories) {
	// 	me.removeAccessory(me.accessories[index].accessory);
	// }

	this.deviceDiscovery();
	setInterval(me.deviceDiscovery.bind(me), this.cache_timeout * 6000);
};

// Update the homebridge context from a Sengled device
function UpdateContextFromDevice(context, device) {
	context.name = device.name;
	context.id = device.id;
	context.status = device.status;
	context.brightness = device.brightness.data;
	context.color = device.color.data;
	context.isOnline = device.isOnline;
	context.signalQuality = device.signalQuality;
	context.manufacturer = "Sengled";
	context.model = (device.productCode != null) ? device.productCode : "Sengled Hub";
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
				let acc = me.accessories[index];
				acc.getState();
				let found = devices.find((device) => {
					return device.id.includes(index);
				});
				if (!found) {
					me.log("Previously configured accessory not found, removing", index);
					me.removeAccessory(me.accessories[index].accessory);
				} else if (found.name != acc.context.name) {
					me.log("Accessory name does not match device name, got " + found.name + " expected " + acc.context.name);
					me.removeAccessory(me.accessories[index].accessory);
					me.addAccessory(found);
					me.log("Accessory removed & readded!");
				}
			}
		}

		if (me.debug) me.log("Discovery complete");
		if (me.debug) me.log(JSON.stringify(me.accessories, null, 4));
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
		let newAccessory = new Accessory(displayName, uuid, 5);
		UpdateContextFromDevice(newAccessory.context, data);

		var sengledAccessory = this.setService(newAccessory);

        	this.api.registerPlatformAccessories(
			'homebridge-sengled-bulbs',
			'SengledHub',
			[newAccessory]
        );
    } else {
	var sengledAccessory = this.accessories[data.id];
	sengledAccessory.getInitState();
    }

    this.accessories[data.id] = sengledAccessory;
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

	return new SengledLightAccessory(me, accessory, me.debug);
};

class SengledLightAccessory {

	constructor(platform, accessory) {
		this.log = platform.log;
		this.context = accessory.context;
		this.api = platform.api;
		this.accessory = accessory;
		this.debug = platform.debug;
		this.username = platform.username;
		this.password = platform.password;
		this.client = platform.client;
		this.platform = platform;

		this.brightness = new Brightness(this.context.brightness);
		this.color = new Color(this.context.color);

		this.lightbulbService = accessory.getService(Service.Lightbulb)
			|| accessory.addService(Service.Lightbulb);

		this.lightbulbService.getCharacteristic(Characteristic.On)
			.on('set', this.setPowerState.bind(this))
			.on('get', this.getPowerState.bind(this));

		if (this.brightness.supportsBrightness())
		{
			this.lightbulbService.getCharacteristic(Characteristic.Brightness)
				.setProps({
					minValue: this.brightness.getMin(),
					maxValue: this.brightness.getMax()
				})
				.on('set', this.setBrightness.bind(this))
				.on('get', this.getBrightness.bind(this));
		}

		// Note: Sengled bulbs like the E12-N1E appear to have leds dedicated to a range of color temperatures for white
		// light in addition to the RGB lights.  The colorMode indicates if using white light or color.  Setting the lights
		// to white light mode is much brighter than setting a color via RGB mode, so it's desirable to use the white light
		// mode. Using Sengled's homekit "capable" hub resulted in Homekit only using the color mode, regardless of the
		// setting. To work-around, this plugin treats setting the color temperature as changing to white light mode, and
		// setting hue or saturation as switching to color mode. Seems to work even if that's not the intended use.

		if (this.color.supportsColorTemperature())
		{
			this.lightbulbService.getCharacteristic(Characteristic.ColorTemperature)
				.setProps({
					minValue: this.color.getMinColorTemperature(),
					maxValue: this.color.getMaxColorTemperature()
			})
			.on('set', this.setColorTemperature.bind(this))
			.on('get', this.getColorTemperature.bind(this));
		}

		if (this.color.supportsRgb())
		{
			this.lightbulbService.getCharacteristic(Characteristic.Hue)
				.on('set', this.setHue.bind(this))
				.on('get', this.getHue.bind(this));

			this.lightbulbService.getCharacteristic(Characteristic.Saturation)
				.on('set', this.setSaturation.bind(this))
				.on('get', this.getSaturation.bind(this));
		}

		this.accessory.on('identify', this.identify.bind(this));

		this.getInitState();
	}

	getName() { return this.context.name; }
	getId() { return this.context.id; }
};

SengledLightAccessory.prototype.getInitState = function() {
	let me = this;
	if (me.debug) me.log("getInitState invoked: " + accessory + " " + data);

	let info = me.accessory.getService(Service.AccessoryInformation);

	info.setCharacteristic(Characteristic.Manufacturer, me.context.manufacturer);
	info.setCharacteristic(Characteristic.Model, me.context.model);
	info.setCharacteristic(Characteristic.SerialNumber, me.context.id);

	this.getState();
};

SengledLightAccessory.prototype.getState = function() {
	let me = this;
	if (me.debug) me.log("getState invoked: " + accessory);

	me.lightbulbService.getCharacteristic(Characteristic.On).getValue();

	if (me.brightness.supportsBrightness())
	{
		me.lightbulbService.getCharacteristic(Characteristic.Brightness).getValue();
	}

	if (me.color.supportsColorTemperature())
	{
		me.lightbulbService
			.getCharacteristic(Characteristic.ColorTemperature)
			.getValue();
	}

	if (me.color.supportsRgb())
	{
		me.lightbulbService.getCharacteristic(Characteristic.Hue).getValue();
		me.lightbulbService.getCharacteristic(Characteristic.Saturation).getValue();
	}
};

SengledLightAccessory.prototype.setPowerState = function(powerState, callback) {
	let me = this;
	if (this.debug) this.log("++++ Sending device: " + this.getId() + " status change to " + powerState);

	return this.client.login(this.username, this.password).then(() => {
		return this.client.deviceSetOnOff(this.getId(), powerState);
	}).then(() => {
		this.context.status = powerState;
		callback(null, powerState);
	}).catch((err) => {
		this.log("Failed to set power state to", powerState);
		this.log(err);
		callback(err);
	});
};

SengledLightAccessory.prototype.getPowerState = function(callback) {
	let me = this;
	if (this.debug) this.log("Getting device PowerState: " + this.getName() + " status");

	return this.client.login(this.username, this.password).then(() => {
		return this.client.getDevices();
	}).then(devices => {
		return devices.find((device) => {
			return device.id.includes(this.getId());
		});
	}).then((device) => {
		if (typeof device === 'undefined') {
			if (this.debug) this.log("Removing undefined device", this.getName());
			this.platform.removeAccessory(this.accessory)
		} else {
			if (this.debug) this.log("getPowerState complete: " + device.name + " " + this.getName() + " is " + device.status);
			this.context.status = device.status;
			callback(null, device.status);
		}
	});
};

SengledLightAccessory.prototype.setBrightness = function(brightness, callback) {
	let me = this;
	if (me.debug) me.log("++++ setBrightness: " + this.getName() + " status brightness to " + brightness);
	brightness = brightness || this.brightness.getMin();
	if (me.debug) me.log("++++ Sending device: " + this.getName() + " status brightness to " + brightness);

	return this.client.login(this.username, this.password).then(() => {
		return this.client.deviceSetBrightness(this.getId(), brightness);
	}).then(() => {
		this.brightness.setValue(brightness);
		callback();
	}).catch((err) => {
		this.log("Failed to set brightness to", brightness);
		this.log(err);
		callback(err);
	});
};

SengledLightAccessory.prototype.getBrightness = function(callback) {
        if (this.debug) this.log('Getting Brightness: %s %s %s', this.getId(), this.getName(), this.brightness.getValue());
        callback( null, this.brightness.getValue());
};

SengledLightAccessory.prototype.setColorTemperature = function(colortemperature, callback) {
	let me = this;
	if (me.debug) me.log("++++ setColortemperature: " + me.context.name + " status colortemperature to " + colortemperature);
	let sengledColorTemperature = colortemperature || this.color.getMinColorTemperature();
	sengledColorTemperature = Color.MiredsToSengledColorTemperature(sengledColorTemperature);
	if (me.debug) me.log("++++ Sending device: " + this.getName() + " status colortemperature to " + colortemperature);

	return this.client.login(this.username, this.password).then(() => {
		return this.client.deviceSetColorTemperature(this.getId(), sengledColorTemperature);
	}).then(() => {
		// Set the new color tempreature to the context.  This also updates hue and saturation.
		this.color.setColorTemperature(colortemperature);

		if (this.color.supportsRgb())
		{
			// The light is now in "white light" mode.  Update hue and saturation to homekit.  This makes the
			// color temperature circle in the color temperature setting match-ish color temperature (warm blue
			// to cool orange-ish).
			this.lightbulbService.getCharacteristic(Characteristic.Hue).updateValue(this.color.getHue());
			this.lightbulbService.getCharacteristic(Characteristic.Saturation).updateValue(this.color.getSaturation());
		}
		callback();
	}).catch((err) => {
		this.log("Failed to set colortemperature to " + colortemperature);
		this.log(err);
		callback(err);
	});
};

SengledLightAccessory.prototype.getColorTemperature = function(callback) {
        if (this.debug) this.log('Getting Color Temperature: %s %s %d', this.getId(), this.getName(), this.color.getColorTemperature());
        callback(null, this.color.getColorTemperature());
};

SengledLightAccessory.prototype.setHue = function(hue, callback) {
	if (this.debug) this.log("+++setHue: " + this.getName() + " status hue to " + hue);
	this.color.setHue(hue);

	// setSaturation is always called after setHue, so avoid updating the rgb twice and update in setSaturation
	callback();
};

SengledLightAccessory.prototype.getHue = function(callback) {
	if (this.debug) this.log("+++getHue: " + this.name + "  hue: " + this.color.getHue());
	callback(null, this.color.getHue());
};

SengledLightAccessory.prototype.setSaturation = function(saturation, callback) {
	if (this.debug) this.log("+++setSaturation: " + this.getName() + " status saturation to " + saturation);

	return this.client.login(this.username, this.password).then(() => {
		this.color.setSaturation(saturation);

		let normalizedRgb = this.color.getRgb();
		let rgbColor = Color.NormailizedRgbToSengledRgb(normalizedRgb.r, normalizedRgb.g, normalizedRgb.b );

		if (this.debug) this.log("++++ Sending device: " + this.getName() + " rgb color to " + "r: " + rgbColor.r + " g: " + rgbColor.g + " b: " + rgbColor.b );

		return this.client.deviceSetRgbColor(this.getId(), rgbColor);
	}).then(() => {

		// The light is now in "color light" mode.
		// TODO: Should color temp be updated
		//
		//	this.lightbulbService.getCharacteristic(Characteristic.ColorTemperature).updateValue(this.color.getColorTemperature());
		// }

		callback();
	}).catch((err) => {
		this.log("Failed to set rgb color to ", this.color.getRgb());
		this.log(err);
		callback(err);
	});
};


SengledLightAccessory.prototype.getSaturation = function(callback) {
	if (this.debug) this.log("+++getSaturation: " + this.getName() + " saturation: " + this.color.getSaturation());
	callback(null, this.color.getSaturation());
};

SengledLightAccessory.prototype.identify = function(paired, callback) {
	let me = this;
	if (me.debug) me.log("identify invoked: " + this.context + " " + paired);
	callback();
};

