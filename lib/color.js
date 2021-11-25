const homebridgeLib = require('homebridge-lib')
const {
   xyToHsv, hsvToXy, hsvToRgb, ctToXy, rgbToHsv
} = homebridgeLib.Colour

// Sengled sniffed packets: [{"x":0.733,"y":0.264}, {"x":0.116,"y":0.818}, {"x":0.157,"y":0.019}]

const gamut = {
      r: [0.7006, 0.2993],
      g: [0.1387, 0.8148],
      b: [0.1510, 0.0227]
};

const scaleRange = (value, currentMin, currentMax, newMin, newMax) =>
	((value - currentMin) * (newMax - newMin)) / (currentMax - currentMin) + newMin;

const ColorModeColorTemperature = 1;
const ColorModeRGB = 2;

const sengledMaxColorTemperatureMireds = 500; // Mireds: 2000k
const sengledMinColorTemperatureMireds = 154; // Mireds: ~6500k

// Note: Mired min maps to max sengled encoding, and mired max maps to min sengled encoding
const sengledMaxColorTemperature = 100;
const sengledMinColorTemperature = 0;

module.exports = class Color
{
	constructor(colorMode, colorTemperature, rgbColor) {
		this.colorMode = colorMode;
		this.colorTemperature = colorTemperature;
		this.rgbColor = rgbColor;

		const hsv = (() => {
			return (colorMode == ColorModeColorTemperature)
				? xyToHsv(ctToXy(this.colorTemperature))
				: rgbToHsv(this.rgbColor.r, this.rgbColor.g, this.rgbColor.b);
		})();

		this.hue = hsv.h;
		this.saturation = hsv.s;

		this.maxColorTemperature = sengledMaxColorTemperatureMireds;
		this.minColorTemperature = sengledMinColorTemperatureMireds;
	}

	SetColorTemperature(mireds) {
		const xy = ctToXy(mireds);
		const {h, s} = xyToHsv(xy);

		this.hue = h;
		this.saturation = s;

		this.UpdateFromHsv();

		this.colorMode = ColorModeColorTemperature;
	}

	SetHue(hue) {
		this.hue = hue;
		this.UpdateFromHsv();
		this.colorMode = ColorModeRGB;
	}

	SetSaturation(saturation) {
		this.saturation = saturation;
		this.UpdateFromHsv();
		this.colorMode = ColorModeRGB;
	}

	UpdateFromHsv() {
		this.rgbColor = hsvToRgb(this.hue, this.saturation);
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

