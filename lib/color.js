const homebridgeLib = require('homebridge-lib')
const {
   xyToHsv, hsvToXy, hsvToRgb, ctToXy, rgbToHsv
} = homebridgeLib.Colour

// Sengled sniffed packets: [{"x":0.733,"y":0.264}, {"x":0.116,"y":0.818}, {"x":0.157,"y":0.019}]

const gamut = {
      r: [0.733, 0.264],
      g: [0.116, 0.818],
      b: [0.157, 0.019]
};

const scaleRange = (value, currentMin, currentMax, newMin, newMax) =>
	((value - currentMin) * (newMax - newMin)) / (currentMax - currentMin) + newMin;

const ColorModeColorTemperature = 2;
const ColorModeRgb = 1;

const sengledMaxColorTemperatureMireds = 500; // Mireds: 2000k
const sengledMinColorTemperatureMireds = 154; // Mireds: ~6500k

// Note: Mired min maps to max sengled encoding, and mired max maps to min sengled encoding
const sengledMaxColorTemperature = 100;
const sengledMinColorTemperature = 0;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || "Assertion failed");
    }
}

class RgbColor
{
	constructor(r, g, b) {
		this.r = r;
		this.g = g;
		this.b = b;
	}
};

class ColorContextData {
	constructor(colorMode, colorTemperature, rgbColor, hue = 0, saturation = 0) {
		this.colorMode = colorMode;
		this.colorTemperature = colorTemperature;
		this.rgbColor = rgbColor;
		this.hue = hue;
		this.saturation = saturation;

		this.maxColorTemperature = sengledMaxColorTemperatureMireds;
		this.minColorTemperature = sengledMinColorTemperatureMireds;
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
					? xyToHsv(ctToXy(this.getColorTemperature(), gamut))
					: rgbToHsv(this.getRgb().r, this.getRgb().g, this.getRgb().b);
			})();

			this.data.hue = hsv.h;
			this.data.saturation = hsv.s;
		}
	}

	getColorMode() { return this.data.colorMode; }

	supportsColorTemperature() { return this.data.colorTemperature !== undefined;}
	supportsRgb() { return this.data.rgbColor !== undefined; }

	getMinColorTemperature() { return this.data.minColorTemperature; }
	getMaxColorTemperature() { return this.data.maxColorTemperature; }

	getColorTemperature() { return this.data.colorTemperature; }
	setColorTemperature(mireds) {

		assert(this.supportsColorTemperature(), 'Must not set colorTemperature when it is unsupported.');
		this.data.colorTemperature = mireds;

		if (this.supportsRgb())
		{
			const xy = ctToXy(mireds);
			const {h, s} = xyToHsv(xy, gamut);

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

	static SengledColorTemperatureToMireds(colorTemperature) {
		return Math.round(scaleRange(
			colorTemperature,
			sengledMinColorTemperature,
			sengledMaxColorTemperature,
			sengledMaxColorTemperatureMireds,
			sengledMinColorTemperatureMireds
		));
	}

	static MiredsToSengledColorTemperature(colorTemperature) {
		return Math.round(scaleRange(
			colorTemperature,
			sengledMinColorTemperatureMireds,
			sengledMaxColorTemperatureMireds,
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
