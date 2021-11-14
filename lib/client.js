const axios = require('axios');
const axiosCookieJarSupport = require('axios-cookiejar-support').default;
const tough = require('tough-cookie');
axiosCookieJarSupport(axios);
const cookieJar = new tough.CookieJar();

let moment = require('moment');
const https = require('https');

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

module.exports = class ElementHomeClient {



  constructor(log, debug = false, info = false) {

    this.client = axios.create({
      baseURL: 'https://us-elements.cloud.sengled.com/zigbee/',
      timeout: 2000,
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
			me.cache.map((device) => {return newDevice;});
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
							var newDevice = {
								id: device.deviceUuid,
								name: device.attributes.name,
								status: device.attributes.onoff,
								brightness: device.attributes.brightness,
								colortemperature: device.attributes.colorTemperature,
								isOnline: device.attributes.isOnline,
								signalQuality: device.attributes.deviceRssi,
								productCode: device.attributes.productCode,
								colorMode: device.attributes.colorMode,
								rgbColorR: device.attributes.rgbColorR,
								rgbColorG: device.attributes.rgbColorG,
								rgbColorB: device.attributes.rgbColorB
							};
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
};
