const axios = require('axios');
const axiosCookieJarSupport = require('axios-cookiejar-support').default;
const tough = require('tough-cookie');
axiosCookieJarSupport(axios);
const cookieJar = new tough.CookieJar();

let moment = require('moment');
const https = require('https');
const {RgbColor, ColorContextData, Color, ColorModeRgb, ColorModeColorTemperature} = require('./color');

function _ArrayFlatMap(array, selector) {
    if (array.length == 0) {
      return [];
    } else if (array.length == 1) {
      return selector(array[0]);
    }
    return array.reduce((prev, next) =>
    (/*first*/ selector(prev) || /*all after first*/ prev).concat(selector(next)))
}

function _guid() {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  }
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
    s4() + '-' + s4() + s4() + s4();
}

function Clamp(value, min, max) {
	value = Math.min(value, max);
	value = Math.max(value, min);
	return value;
}

class BrightnessContextData {
	constructor(value) {
		this.value = value;

		// Configure min/max brightness so that it uses sengled API encoding [0-255].
		const sengledMinBrightness = 0;
		const sengledMaxBrightness = 255;

		this.min = sengledMinBrightness;
		this.max = sengledMaxBrightness;
	}
};

class Brightness  {
	constructor(brightnessContextData) {
		this.data = brightnessContextData;
	}

	getValue() { return this.data.value; }
	setValue(value) {
		this.data.value = Clamp(value, this.data.min, this.data.max);
	}

	getMin() { return this.data.min; }
	getMax() { return this.data.max; }

	supportsBrightness() {
		return this.data.value !== undefined;
	}
};

class ElementHomeClient {

  constructor(log, debug = false, info = false) {

    this.client = axios.create({
      baseURL: 'https://us-elements.cloud.sengled.com/zigbee/',
      timeout: 4000,
      jar: cookieJar,
      withCredentials: true,
      responseType: 'json'
    });
    this.client.defaults.headers.post['Content-Type'] = 'application/json';
    this.log = log
	  this.debug = debug
    this.info = info
 		if (this.info) this.log("Starting Sengled Client...");
	  this.log("Starting Sengled Client...");
    this.lastLogin = moment('2000-01-01')
    this.uuid = _guid();
	  this.cache = new Array();
	  this.lastCache = moment('2000-01-01')
 		if (this.debug) this.log("set cache duration " + this.cacheDuration);
  }

  login(username, password) {
	let me = this;
	if (me.debug) me.log("login invoked " + username);
  if (me.debug) me.log("login sessionid " + this.jsessionid);
    // If token has been set in last 24 hours, don't log in again
    // if (this.lastLogin.isAfter(moment().subtract(24, 'hours'))) {
    //     return Promise.resolve();
    // }


  return new Promise((fulfill, reject) => {
    if (this.jsessionid != null) {
      this.log("Cookie found, skipping login request.");
      if (me.debug) me.log("login via cookie");
      fulfill(this.loginResponse);
    } else {
      if (me.debug || me.info) me.log("login via api"); }
    this.client.post('/customer/login.json',
    {
      'uuid':this.uuid,
      'user': username,
      'pwd': password,
      'os_type': 'android'
    }).then((response) => {
      this.jsessionid = response.data.jsessionid;
      this.lastLogin = moment();
      this.loginResponse = response;
      if (me.debug) me.log("logged in to Sengled");
      fulfill(response);
    }).catch(function (error) {
      reject(error);
    });

  });


  }


  getDevices() {

		let me = this;
		if (me.debug) me.log("getDevices invoked ");

		if (me.debug) me.log(me.cache);
		if (me.debug) me.log(moment() - me.lastCache);
		if (moment() - me.lastCache <= 2000){
			if (me.debug) me.log("######getDevices from cache ");
			me.cache.map((device) => {return device;});
		}

		return new Promise((fulfill, reject) => {
			this.client.post('/device/getDeviceDetails.json', {})
				.then((response) => {
					if (response.data.ret == 100) {
						reject(response.data);
					} else {
						let deviceInfos = response.data.deviceInfos;
						let lampInfos = _ArrayFlatMap(deviceInfos, i => i.lampInfos);
						let devices = lampInfos.map((device) => {

						let attributes = device.attributes;

						const firmwareVersion = attributes.hasOwnProperty('version')
							? "V0.0." + attributes.version // Match the SengledHome app display format.
							: undefined;

						// Check for the existence of attributes to determine bulb capability
						// This assumes that lights without a capability will not have unused attributes.
						const supportsBrightness = attributes.hasOwnProperty('brightness');
						const supportsColorTemperature = attributes.hasOwnProperty('colorTemperature');
						const supportsRgbColor = attributes.hasOwnProperty('rgbColorR');

						const brightnessValue = supportsBrightness ? attributes.brightness : undefined;
						const brightnessContextData = new BrightnessContextData(brightnessValue);
						const brightness = new Brightness(brightnessContextData);

						// colorMode should be supplied if both colorTemperature and rgb are supported.
						// Unknown if it is supplied for lights that support one or none of these, so
						// choose a default if undefined.
						const colorMode = attributes.hasOwnProperty('colorMode')
							? attributes.colorMode
							: supportsColorTemperature
								? ColorModeColorTemperature
								: ColorModeRgb;

						// Color class expects normalized RGB.
						const rgbColor = supportsRgbColor
							? Color.SengledRgbToNormalizedRgb(new RgbColor(
								attributes.rgbColorR,
								attributes.rgbColorG,
								attributes.rgbColorB))
							: undefined;

						// Retrieve color configuration based on product code.  Unknown models get defaulted values
						const colorConfigData = Color.GetConfigData(attributes.productCode);

						// Color class expects temperature in mireds.  This assumes a linear conversion
						// from the sengled encoded range.
						const colorTemperature = supportsColorTemperature
							? Color.SengledColorTemperatureToMireds(attributes.colorTemperature, colorConfigData)
							: undefined;

						// Color data that can be serialized and deserialized.
						const colorContextData = new ColorContextData(
							colorConfigData,
							colorMode,
							colorTemperature,
							rgbColor
						);

						// Wrap the color data to provide functionality.
						const color = new Color(colorContextData, this.log);

						// Sengled device data
						let newDevice = {
							id: device.deviceUuid,
							name: attributes.name,
							status: attributes.onoff,
							isOnline: attributes.isOnline,
							signalQuality: attributes.deviceRssi,
							productCode: attributes.productCode,
							firmwareVersion: firmwareVersion,
							brightness: brightness,
							color: color
						};

						// Cache this device and set the last time the cache was updated.
						me.cache[newDevice.id] = newDevice;
						me.lastCache = moment();
						return newDevice;
					});
					fulfill(devices);
				}
			}).catch(function(error) {
				reject(error);
			});
		});
	}

  userInfo() {
	let me = this;
	if (me.debug) me.log("userInfo invoked ");
    return new Promise((fulfill, reject) => {
      this.client.post('/customer/getUserInfo.json', {})
      .then((response) => {
        if (response.data.ret == 100) {
          reject(response.data);
        } else {
          fulfill(response);
        }
      }).catch(function (error) {
        reject(error);
      });
    });
  }

  deviceSetOnOff(deviceId, onoff) {
    let me = this;
    if (me.debug) me.log('onOff ' + deviceId + ' ' + onoff);
    return new Promise((fulfill, reject) => {
      this.client.post('/device/deviceSetOnOff.json', {"onoff": onoff ? 1 : 0,"deviceUuid": deviceId})
      .then((response) => {
        if (response.data.ret == 100) {
          reject(response.data);
        } else {
          fulfill(response);
        }
      }).catch(function (error) {
        reject(error);
      });
    });
  }

  // brightness: 0 - 255
  deviceSetBrightness(deviceId, brightness) {
    return new Promise((fulfill, reject) => {
        this.client
            .post('/device/deviceSetBrightness.json', {
                brightness: brightness,
                deviceUuid: deviceId
            })
            .then(response => {
                if (response.data.ret == 100) {
                    reject(response.data);
                } else {
                    fulfill(response);
                }
            })
            .catch(function(error) {
                reject(error);
            });
    });
}

// colorTemperature: 0 - 100
deviceSetColorTemperature(deviceId, colorTemperature) {
    return new Promise((fulfill, reject) => {
        this.client
            .post('/device/deviceSetColorTemperature.json', {
                colorTemperature: colorTemperature,
                deviceUuid: deviceId
            })
            .then(response => {
                if (response.data.ret == 100) {
                    reject(response.data);
                } else {
                    fulfill(response);
                }
            })
            .catch(function(error) {
                reject(error);
            });
    });
}

// r: 0-255, g: 0-255, b: 0-255
deviceSetRgbColor(deviceId, rgb) {
    return new Promise((fulfill, reject) => {
        this.client
            .post('/device/deviceSetGroup.json', {
		cmdId: 129,
		deviceUuidList: [{ deviceUuid: deviceId}],
		rgbColorR: rgb.r,
		rgbColorG: rgb.g,
		rgbColorB: rgb.b
            })
            .then(response => {
                if (response.data.ret == 100) {
                    reject(response.data);
                } else {
                    fulfill(response);
                }
            })
            .catch(function(error) {
                reject(error);
            });
    });
}
};

module.exports = {
	ElementHomeClient: ElementHomeClient,
	Brightness: Brightness
}
