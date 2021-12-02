const homebridgeLib = require('homebridge-lib')
const {
   hsvToRgb, rgbToHsv
} = homebridgeLib.Colour


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

class ColorContextData {
	constructor(colorConfigData, colorMode, colorTemperature, rgbColor, hue = 0, saturation = 0) {
		this.configData = colorConfigData;
		this.colorMode = colorMode;
		this.colorTemperature = colorTemperature;
		this.rgbColor = rgbColor;
		this.hue = hue;
		this.saturation = saturation;
	}
};

class Color {
	constructor(colorContextData) {
		this.data = colorContextData;


		if (this.supportsColorTemperature() && this.supportsRgb())
		{
			// Sync colorTemperature and rgbColor based on current color mode.
			const hsv = (() => {

				if (this.getColorMode() == ColorModeColorTemperature) {
					let rgb = Color.MiredsToRgb(this.getColorTemperature());
					return rgbToHsv(rgb.r, rgb.g, rgb.b);
				}

				return  rgbToHsv(this.getRgb().r, this.getRgb().g, this.getRgb().b);
			})();

			this.data.hue = hsv.h;
			this.data.saturation = hsv.s;
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

	getHue() { return this.data.hue; }
	setHue(hue) {
		assert(this.supportsRgb(), 'Must not set hue when rgbColor is unsupported.');
		this.data.hue = hue;
		this.updateFromHsv();
		this.data.colorMode = ColorModeRgb;
	}

	getSaturation() { return this.data.saturation; }
	setSaturation(saturation) {
		assert(this.supportsRgb(), 'Must not set saturation when rgbColor is unsupported.');
		this.data.saturation = saturation;
		this.updateFromHsv();
		this.data.colorMode = ColorModeRgb;
	}

	getRgb() { return this.data.rgbColor; }

	updateHsvFromRgb(rgb) {

		const {h, s, v} = rgbToHsv(rgb.r, rgb.g, rgb.b);

		this.data.hue = h;
		this.data.saturation = s;
	}

	updateFromHsv() {
		this.data.rgbColor = hsvToRgb(this.data.hue, this.data.saturation);
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

	static ByteRgbToNormalizedRgb(r, g, b) {
		return new RgbColor(
			r / 255.0,
			g / 255.0,
			b / 255.0
		);
	}

	static SengledRgbToNormalizedRgb(r, g, b) {
		return Color.ByteRgbToNormalizedRgb(r, g, b);
	}

	static NormailizedRgbToByteRgb(r, g, b) {
		return new RgbColor(
			Math.round(r * 255),
			Math.round(g * 255),
			Math.round(b * 255)
		);
	}

	static NormailizedRgbToSengledRgb(r, g, b) {
		return Color.NormalizedRgbToByteRgb(r, g, b);
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
	// Modified to produce normailized rgb.
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
};

module.exports = {
	RgbColor: RgbColor,
	ColorContextData: ColorContextData,
	Color: Color,
	ColorModeRgb: ColorModeRgb,
	ColorModeColorTemperature: ColorModeColorTemperature
}
