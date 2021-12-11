'use strict';

class ColorConfigData {
	constructor(maxColorTemperature, minColorTemperature) {
		this.maxColorTemperature = maxColorTemperature;
		this.minColorTemperature = minColorTemperature;
	}
};

const defaultColorConfigData = new ColorConfigData(
	 500,		// Mireds: 2000k - homekit default
	 140,		// Mireds: ~7143k - homekit default
);

// Config for Lights: E12-N1E
const colorConfigData1 = new ColorConfigData(
	500, // Mireds: 2000k
	154, // Mireds: ~6500k
);

// Each ColorConfigData has an arra of lights that it applies to.
const colorConfigs = [
	{data: colorConfigData1, productCodes: ['E12-N1E'] }
];

const scaleRange = (value, currentMin, currentMax, newMin, newMax) =>
	((value - currentMin) * (newMax - newMin)) / (currentMax - currentMin) + newMin;

const ColorModeColorTemperature = 2;
const ColorModeRgb = 1;

// Note: Mired min maps to max sengled encoding, and mired max maps to min sengled encoding
const sengledMaxColorTemperature = 100;
const sengledMinColorTemperature = 0;

function assert(condition, message) {
	if (!condition) {
		throw new Error(message || "Assertion failed");
	}
}

function Clamp(value, min, max) {
	value = Math.min(value, max);
	value = Math.max(value, min);
	return value;
}

class RgbColor {
	constructor(r, g, b) {
		this.r = r;
		this.g = g;
		this.b = b;
	}
};

class HsvColor {
	constructor(h, s, v = 100) {
		this.h = h;
		this.s = s;
		this.v = v;
	}
};

class ColorContextData {
	constructor(colorConfigData, colorMode, colorTemperature, rgbColor, hsv = undefined) {
		this.configData = colorConfigData;
		this.colorMode = colorMode;
		this.colorTemperature = colorTemperature;
		this.rgbColor = rgbColor;
		this.hsv = hsv == undefined ? new HsvColor(0, 0) : hsv;
	}
};

class Color {
	constructor(colorContextData, log) {
		this.data = colorContextData;
		this.log = log;

		if (this.supportsColorTemperature() && this.supportsRgb())
		{
			// Sync colorTemperature and rgbColor based on current color mode.
			this.data.hsv = (() => {

				if (this.getColorMode() == ColorModeColorTemperature) {
					let rgb = Color.MiredsToRgb(this.getColorTemperature());
					return Color.RgbToHsv(rgb);
				}

				return  Color.RgbToHsv(this.getRgb());
			})();
		}
	}

	getColorMode() { return this.data.colorMode; }

	supportsColorTemperature() { return this.data.colorTemperature !== undefined;}
	supportsRgb() { return this.data.rgbColor !== undefined; }

	getMinColorTemperature() { return this.getConfigData().minColorTemperature; }
	getMaxColorTemperature() { return this.getConfigData().maxColorTemperature; }
	getGamut() { return this.getConfigData().gamut; }
	getConfigData() { return this.data.configData; }

	getColorTemperature() { return this.data.colorTemperature; }
	setColorTemperature(mireds) {

		assert(this.supportsColorTemperature(), 'Must not set colorTemperature when it is unsupported.');
		this.data.colorTemperature = mireds;

		if (this.supportsRgb())
		{
			let rgb = Color.MiredsToRgb(mireds);
			this.updateHsvFromRgb(rgb);
			this.data.colorMode = ColorModeColorTemperature;
		}
	}

	getHue() { return this.getHsv().h; }
	setHue(hue) {
		assert(this.supportsRgb(), 'Must not set hue when rgbColor is unsupported.');
		this.data.hsv.h = hue;
		this.updateFromHsv();
		this.data.colorMode = ColorModeRgb;
	}

	getSaturation() { return this.getHsv().s; }
	setSaturation(saturation) {
		assert(this.supportsRgb(), 'Must not set saturation when rgbColor is unsupported.');
		this.data.hsv.s = saturation;
		this.updateFromHsv();
		this.data.colorMode = ColorModeRgb;
	}

	getRgb() { return this.data.rgbColor; }

	getHsv() { return this.data.hsv; }

	updateHsvFromRgb(rgb) {
		this.data.hsv = Color.RgbToHsv(rgb);
	}

	updateFromHsv() {
		this.data.rgbColor = Color.HsvToRgb(this.data.hsv);
	}

	// Deep copy context data
	copyData() {
		return JSON.parse(JSON.stringify(this.data));
	}

	// Shallow assign context data
	assignData(colorContextData) {
		this.data = Object.assign(this.data, colorContextData);
	}

	// Lookup color configuration by product code from the color config data table.
	static GetConfigData(productCode) {

		const colorConfig = colorConfigs.find(
			colorConfig => colorConfig.productCodes.find(
					productCode => productCode.toUpperCase() === productCode.toUpperCase()
			) != undefined
		);

		if (colorConfig != undefined)

		return colorConfig != undefined ? colorConfig.data : defaultColorConfig;
	}

	static ByteRgbToNormalizedRgb(rgb) {
		return new RgbColor(
			rgb.r / 255.0,
			rgb.g / 255.0,
			rgb.b / 255.0
		);
	}

	static SengledRgbToNormalizedRgb(rgb) {
		return Color.ByteRgbToNormalizedRgb(rgb);
	}

	static NormalizedRgbToByteRgb(rgb) {
		return new RgbColor(
			Math.round(rgb.r * 255),
			Math.round(rgb.g * 255),
			Math.round(rgb.b * 255)
		);
	}

	static NormalizedRgbToSengledRgb(rgb) {
		return Color.NormalizedRgbToByteRgb(rgb);
	}

	static SengledColorTemperatureToMireds(colorTemperature, configData) {
		// Assumes a linear maping of ranges.
		// Min Sengled encoding represents max mired value (the lowest color temperature)
		// and vice versa, so the ranges are swapped when scaling.
		return Math.round(scaleRange(
			colorTemperature,
			sengledMinColorTemperature,
			sengledMaxColorTemperature,
			configData.maxColorTemperature,
			configData.minColorTemperature
		));
	}

	static MiredsToSengledColorTemperature(colorTemperature, configData) {
		// Assumes a linear maping of ranges.
		// Min Sengled encoding represents max mired value (the lowest color temperature)
		// and vice versa, so the ranges are swapped when scaling.
		return Math.round(scaleRange(
			colorTemperature,
			configData.minColorTemperature,
			configData.maxColorTemperature,
			sengledMaxColorTemperature,
			sengledMinColorTemperature
		));
	}

	static MiredsToKelvins(mireds) {
		return Math.round(1000000.0 / mireds);
	}

	static KelvinsToMireds(kelvins) {
		return Math.round(1000000.0 / kelvins);
	}

	static MiredsToRgb(mireds) {
		let kelvin = Color.MiredsToKelvins(mireds);
		return Color.KelvinsToRgb(kelvin);
	}

	// Adapted from Tanner Helland's algorithm:
	// https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html
	// Modified to produce normalized rgb.
	static KelvinsToRgb(tmpKelvin) {

		let tmpCalc, r, g, b;

		// Temperature must fall between 1000 and 40000 degrees
		tmpKelvin = Clamp(tmpKelvin, 1000, 40000);

		// All calculations require tmpKelvin \ 100, so only do the conversion once
		tmpKelvin = Math.floor(tmpKelvin / 100.0);

		// Calculate each color in turn

		// First: red
		if (tmpKelvin <= 66){
			r = 1.0;
		}
		else {
			// Note: the R-squared value for this approximation is .988
			tmpCalc = tmpKelvin - 60;
			tmpCalc = 329.698727446 * Math.pow(tmpCalc, -0.1332047592);
			tmpCalc = tmpCalc / 255.0;

			r = Clamp(tmpCalc, 0.0, 1.0);
		}

		// Second: green
		if(tmpKelvin <= 66) {
			// Note: the R-squared value for this approximation is .996
			tmpCalc = tmpKelvin;
			tmpCalc = 99.4708025861 * Math.log(tmpCalc) - 161.1195681661;
			tmpCalc = tmpCalc / 255.0;

			g = Clamp(tmpCalc, 0.0, 1.0);
		}
		else {
			//Note: the R-squared value for this approximation is .987
			tmpCalc = tmpKelvin - 60;
			tmpCalc = 288.1221695283 * Math.pow(tmpCalc, -0.0755148492);
			tmpCalc = tmpCalc / 255.0;

			g = Clamp(tmpCalc, 0.0, 1.0);
		}

		// Third: blue
		if (tmpKelvin >= 66) {
			b = 1.0;
		}
		else if(tmpKelvin <= 19) {
			b = 0.0;
		}
		else {
			// Note: the R-squared value for this approximation is .998
			tmpCalc = tmpKelvin - 10;
			tmpCalc = 138.5177312231 * Math.log(tmpCalc) - 305.0447927307;
			tmpCalc = tmpCalc / 255.0;

			b = Clamp(tmpCalc, 0.0, 1.0);
		}

		return new RgbColor(r, g, b);
	}

	// Implemented from https://en.wikipedia.org/wiki/HSL_and_HSV
	// r, g, and b are[ 0-1.0]
	// h is [0,360], s is [0-100], and v is [0-100]
	static RgbToHsv(rgb)
	{
		let r = rgb.r;
		let g = rgb.g;
		let b = rgb.b;

	        let max = Math.max(r, g, b);
	        let min = Math.min(r, g, b);

	        let v = max;
	        let c = max - min;
	        let l = v - c/2;

		let h;
		switch(max) {
			case min: h = 0;
			case r: h = (6 + ((g - b) / c)) % 6; break;
			case g: h = (2 + ((b - r) / c)); break;
			case b: h = (4 + ((r - g) / c)); break;
		}

		let s = max == 0 ? 0 : c / v;

	        return new HsvColor(
	                Math.round(h * 60),
	                Math.round(s * 100),
	                Math.round(v * 100)
	        );
	}

	// Implemented from https://en.wikipedia.org/wiki/HSL_and_HSV
	// r, g, and b are[ 0-1.0]
	// h is [0,360], s is [0-100], and v is [0-100]
	static HsvToRgb(hsv) {

		let h = hsv.h;
		let s = hsv.s;
		let v = hsv.v;

		s /= 100.0;
		v /= 100.0;

	        let c = v * s;
	        let H = h / 60;
	        let x = c * (1 - Math.abs((H % 2) - 1));

	        let R, G, B;

	        if (H < 1)
	        {
	                R = c;
	                G = x;
	                B = 0;
	        }
	        else if (H < 2)
	        {
	                R = x;
	                G = c;
	                B = 0;
	        }
	        else if (H < 3)
	        {
	                R = 0;
	                G = c;
	                B = x;
	        }
	        else if (H < 4)
	        {
	                R = 0;
	                G = x;
	                B = c;
	        }
	        else if (H < 5)
	        {
	                R = x;
	                G = 0;
	                B = c;
	        }
	        else // (H < 6)
	        {
	                R = c;
	                G = 0;
	                B = x;
	        }

	        let m = v - c;

	        let r = R + m;
	        let g = G + m;
	        let b = B + m;

	        return new RgbColor (r, g, b );
	}

};

module.exports = {
	RgbColor: RgbColor,
	ColorContextData: ColorContextData,
	Color: Color,
	ColorModeRgb: ColorModeRgb,
	ColorModeColorTemperature: ColorModeColorTemperature
}
