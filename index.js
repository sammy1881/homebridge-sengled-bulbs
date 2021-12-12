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
	this.useAlternateLoginApi = config['AlternateLoginApi'];
	this.timeout = config['Timeout'];

	if (api) {
		this.api = api;
		this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
	}

	this.client = new ElementHomeClient(this.useAlternateLoginApi, this.timeout, log, this.debug, this.info);
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
			this.accessories[accessoryId] = accessory;

		} catch (error) {
			this.removeAccessory(accessory, accessoryId);
		}
	}
	else {
		this.accessories[accessoryId] = accessory;
	}
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
	context.brightness = device.brightness.data;
	context.color = device.color.data;
	context.isOnline = device.isOnline;
	context.signalQuality = device.signalQuality;
	context.firmwareVersion = device.firmwareVersion;
	context.manufacturer = "Sengled";
	context.model = (device.productCode != null) ? device.productCode : "Sengled Hub";
}

// Use to consistently fall back to id if name is not defined.
function GetDeviceName(device) {
	return !(device.name) ? device.id : device.name;
}

SengledHubPlatform.prototype.deviceDiscovery = function() {
	let me = this;
	if (me.debug) me.log("deviceDiscovery invoked");

	this.client.login(this.username, this.password).then(() => {
		return this.client.getDevices();
	}).then(devices => {
		if (me.debug) me.log("Adding discovered devices");

		// Accessory Registration.  For each device reported by the Sengled API:
		// - Add the accessory if it has not already added.
		// - If the Sengled API reports an updated name, remove and re-create the device.
		// - Otherwise, bind callbacks and update the context sstate.
		devices.forEach((device) => {
			let existing = me.accessories[device.id];
			let deviceName = GetDeviceName(device);

			if (!existing) {
				me.log("Adding device: ", device.id, deviceName);
				me.addAccessory(device);
			} else if (deviceName != existing.displayName) {
				me.log("Accessory name does not match device name, got \"" + deviceName + "\" expected \"" + existing.displayName + "\"");
				me.removeAccessory(existing, device.id);
				me.addAccessory(device);
				me.log("Accessory removed & re-added!");
			}
			else {
				if (me.debug) me.log("Updating existing device: ", device.id, deviceName);
				this.bindAndUpdateAccessory(existing, device);
			}
		});

		// Find all registered accessories that are not in the sengled devices list
		let missingAccessoryKeys = Object.keys(me.accessories).filter(
			index => !devices.some(device => device.id == index));

		// Remove all accessories that are not reported by the Sengled API.
		missingAccessoryKeys.forEach(accessoryKey => {
				me.log("Previously configured accessory not found, removing", accessoryKey);
				me.removeAccessory(me.accessories[accessoryKey], accessoryKey);
		});

		if (me.debug) me.log("Discovery complete");
		if (me.debug) me.log(me.accessories);
	}).catch((err) => {
		this.log("Failed deviceDiscovery: ");
		this.log(me.debug ? err : err.message);
	});
};

SengledHubPlatform.prototype.addAccessory = function(data) {
	let me = this;
	if (me.debug) me.log("addAccessory invoked: ");
	if (me.debug) me.log(data);

	if (this.accessories[data.id]) {
		throw new Error("addAccessory invoked for an existing accessory: " + data.id );
	}

	let uuid = UUIDGen.generate(data.id);

	let displayName = GetDeviceName(data);
	// 5 == Accessory.Categories.LIGHTBULB
	// 8 == Accessory.Categories.SWITCH
	let newAccessory = new Accessory(displayName, uuid, 5);

	this.bindAndUpdateAccessory(newAccessory, data);

	this.api.registerPlatformAccessories(
		'homebridge-sengled-bulbs',
		'SengledHub',
		[newAccessory]);

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

// Bind callbacks for light properties and update context data.
SengledHubPlatform.prototype.bindAndUpdateAccessory = function(accessory, data) {
	let me = this;
	if (me.debug) me.log("bindAndUpdateAccessory invoked: ");
	if (me.debug) me.log(accessory);

	// Update context data for accessory.
	UpdateContextFromDevice(accessory.context, data);

	// Create the accessory wrapper to bind callbacks, track property changes,
	// and update homebridge property values.
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
		this.color = new Color(this.context.color, this.log);

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

		this.InititializeState();
	}

	getName() { return this.context.name; }
	getId() { return this.context.id; }
};

SengledLightAccessory.prototype.InititializeState = function() {
	let me = this;
	if (me.debug) me.log("InitializeState invoked: " + JSON.stringify(this.context, null, 4));

	// Set accessory information
	let info = me.accessory.getService(Service.AccessoryInformation);

	info.setCharacteristic(Characteristic.Manufacturer, me.context.manufacturer);
	info.setCharacteristic(Characteristic.Model, me.context.model);
	info.setCharacteristic(Characteristic.SerialNumber, me.context.id);

	if (me.context.firmwareVersion != undefined){
		info.setCharacteristic(Characteristic.FirmwareRevision, me.context.firmwareVersion);
	}

	// Update homebridge to the latest state from sengled API.

	me.lightbulbService.getCharacteristic(Characteristic.On).updateValue(this.context.status);

	if (me.brightness.supportsBrightness())
	{
		me.lightbulbService
			.getCharacteristic(Characteristic.Brightness)
			.updateValue(this.brightness.getValue());
	}

	if (me.color.supportsColorTemperature())
	{
		me.lightbulbService
			.getCharacteristic(Characteristic.ColorTemperature)
			.updateValue(this.color.getColorTemperature());
	}

	if (me.color.supportsRgb())
	{
		me.lightbulbService
			.getCharacteristic(Characteristic.Hue)
			.updateValue(this.color.getHue());

		me.lightbulbService
			.getCharacteristic(Characteristic.Saturation)
			.updateValue(this.color.getSaturation());
	}
};

SengledLightAccessory.prototype.setPowerState = function(powerState, callback) {
	let me = this;
	if (this.debug) this.log("++++ Sending device: " + this.getId() + " status change to " + powerState);

	return this.client.login(this.username, this.password).then(() => {
		return this.client.deviceSetOnOff(this.getId(), powerState);
	}).then(() => {
		this.context.status = powerState;
		callback();
	}).catch((err) => {
		this.log("Failed to set power state to", powerState);
		this.log(err);
		callback(err);
	});
};

SengledLightAccessory.prototype.getPowerState = function(callback) {
	let me = this;
	if (this.debug) this.log("Getting device PowerState: " + this.getName() + " status");

	callback(null, this.context.status);
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
	if (me.debug) me.log("++++ setColortemperature: " + me.getName() + " status colortemperature to " + colortemperature);

	// Convert to sengleded color temperature range
	colortemperature = colortemperature || this.color.getMinColorTemperature();
	let sengledColorTemperature = Color.MiredsToSengledColorTemperature(colortemperature, this.color.getConfigData());

	if (me.debug) me.log("++++ Sending device: " + this.getName() + " status colortemperature to " + sengledColorTemperature);

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
	if (this.debug) this.log("+++getHue: " + this.getName() + "  hue: " + this.color.getHue());

	callback(null, this.color.getHue());
};

SengledLightAccessory.prototype.setSaturation = function(saturation, callback) {
	if (this.debug) this.log("+++setSaturation: " + this.getName() + " status saturation to " + saturation);

	// Backup color data in the event of failure.
	let oldColorData = this.color.copyData();

	return this.client.login(this.username, this.password).then(() => {

		this.color.setSaturation(saturation);

		let normalizedRgb = this.color.getRgb();
		let rgbColor = Color.NormalizedRgbToSengledRgb(normalizedRgb);

		if (this.debug) this.log("++++ Sending device: " + this.getName() + " rgb color to " + "r: " + rgbColor.r + " g: " + rgbColor.g + " b: " + rgbColor.b );

		return this.client.deviceSetRgbColor(this.getId(), rgbColor);
	}).then(() => {

		// The light is now in "color light" mode.

		// The sengled API for setting RGB turns on the light.  Ideally, this would behave like color temp, but
		// but update to reflect light state for now.
		this.context.status = true;
		this.lightbulbService.getCharacteristic(Characteristic.On).updateValue(this.context.status);

		callback();
	}).catch((err) => {
		this.log("Failed to set rgb color to ", this.color.getRgb());
		this.color.assignData(oldColorData); // restore color state.
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

