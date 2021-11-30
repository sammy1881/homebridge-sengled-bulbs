const homebridgeLib = require('homebridge-lib')
const {
   xyToHsv, hsvToXy, hsvToRgb, ctToXy, rgbToHsv, defaultGamut
} = homebridgeLib.Colour


class ColorConfigData {
	constructor(maxColorTemperature, minColorTemperature, gamut) {
		this.maxColorTemperature = maxColorTemperature;
		this.minColorTemperature = minColorTemperature;
		this.gamut = gamut;
	}
};

const defaultColorConfigData = new ColorConfigData(
	 500,		// Mireds: 2000k - homekit default
	 140,		// Mireds: ~7143k - homekit default
	 defaultGamut	// default from homebrige-lib.
);

// Config for Lights: E12-N1E
const colorConfigData1 = new ColorConfigData(
	500, // Mireds: 2000k
	154, // Mireds: ~6500k
	{ // gamut values from an online forum post indicating they were sniffed from zigbee
		r: [0.733, 0.264],
		g: [0.116, 0.818],
		b: [0.157, 0.019]
	}
);

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
				return (this.getColorMode() == ColorModeColorTemperature)
					? xyToHsv(ctToXy(this.getColorTemperature(), this.getGamut()))
					: rgbToHsv(this.getRgb().r, this.getRgb().g, this.getRgb().b);
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
			const xy = ctToXy(mireds);
			const {h, s} = xyToHsv(xy, this.getGamut());

			this.data.hue = h;
			this.data.saturation = s;

			this.updateFromHsv();

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

	static SengledRgbToNormalizedRgb(r, g, b) {
		return {
			r: r / 255.0,
			g: g / 255.0,
			b: b / 255.0
		};
	}

	static NormailizedRgbToSengledRgb(r, g, b) {
		return {
			r: Math.round(r * 255),
			g: Math.round(g * 255),
			b: Math.round(b * 255)
		};
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
};

module.exports = {
	RgbColor: RgbColor,
	ColorContextData: ColorContextData,
	Color: Color,
	ColorModeRgb: ColorModeRgb,
	ColorModeColorTemperature: ColorModeColorTemperature
}
