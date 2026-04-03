// https://bugzilla.mozilla.org/show_bug.cgi?id=1967793
const isFirefox = navigator.userAgent.toLowerCase().includes("firefox");

export type Partial = "full" | "partial" | "none";

export type Codec = {
	hardware?: boolean; // undefined when we can't detect hardware acceleration
	software: boolean;
};

export type Audio = {
	aac: boolean;
	opus: Partial;
};

export type Video = {
	h264: Codec;
	h265: Codec;
	vp8: Codec;
	vp9: Codec;
	av1: Codec;
};

export type Full = {
	webtransport: Partial;
	audio: {
		decoding: Audio;
		render: boolean;
	};
	video: {
		decoding: Video | undefined;
		render: boolean;
	};
};

// Pick a codec string for each codec.
// This is not strictly correct, as browsers may not support every profile or level.
const CODECS = {
	aac: "mp4a.40.2",
	opus: "opus",
	av1: "av01.0.08M.08",
	h264: "avc1.640028",
	h265: "hev1.1.6.L93.B0",
	vp9: "vp09.00.10.08",
	vp8: "vp8",
};

const CODEC_TO_NAME: Record<string, keyof typeof CODECS> = {
	"av01.0.08M.08": "av1",
	"avc1.640028": "h264",
	"hev1.1.6.L93.B0": "h265",
	"vp09.00.10.08": "vp9",
	"vp8": "vp8",
};

// MediaCapabilities requires full MIME types, not just the codec string.
const MIME_TYPES: Record<keyof typeof CODECS, string> = {
	aac: `audio/mp4; codecs="${CODECS.aac}"`,
	opus: `audio/ogg; codecs="${CODECS.opus}"`,
	av1: `video/mp4; codecs="${CODECS.av1}"`,
	h264: `video/mp4; codecs="${CODECS.h264}"`,
	h265: `video/mp4; codecs="${CODECS.h265}"`,
	vp9: `video/webm; codecs="${CODECS.vp9}"`,
	vp8: `video/webm; codecs="${CODECS.vp8}"`,
};

// --- HACK 1: GPU Sniffing ---
// Cache the GPU string so we don't create multiple canvas elements.
let cachedGPU: string | null | undefined = undefined;

function getGPUModel(): string | null | undefined {
	if (cachedGPU !== undefined) return cachedGPU;

	try {
		const canvas = document.createElement("canvas");
		const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
		
		if (!gl) {
			cachedGPU = null;
			return null;
		}

		const debugInfo = (gl as WebGLRenderingContext).getExtension("WEBGL_debug_renderer_info");
		if (!debugInfo) {
			cachedGPU = null;
			return null;
		}

		cachedGPU = (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
		return cachedGPU;
	} catch (e) {
		cachedGPU = null;
		return null;
	}
}

// --- HACK 2: Media Capabilities ---
async function checkMediaCapabilities(codecName: keyof typeof CODECS): Promise<{ supported: boolean; powerEfficient: boolean }> {
	if (!navigator.mediaCapabilities) return { supported: false, powerEfficient: false };

	try {
		const info = await navigator.mediaCapabilities.decodingInfo({
			type: "file",
			video: {
				contentType: MIME_TYPES[codecName],
				width: 1920,
				height: 1080,
				bitrate: 5000000,
				framerate: 30,
			},
		});
		return { supported: info.supported, powerEfficient: info.powerEfficient };
	} catch (e) {
		return { supported: false, powerEfficient: false };
	}
}

async function audioDecoderSupported(codec: keyof typeof CODECS): Promise<boolean> {
	if (!globalThis.AudioDecoder) return false;

	const res = await AudioDecoder.isConfigSupported({
		codec: CODECS[codec],
		numberOfChannels: 2,
		sampleRate: 48000,
	});

	return res.supported === true;
}

export async function videoDecoderSupport(codec: string): Promise<Codec> {
	const codecName = CODEC_TO_NAME[codec]
	if (codecName === undefined) return {
		hardware:false,
		software: false,
	}

	const software = await VideoDecoder.isConfigSupported({
		codec: codec,
		hardwareAcceleration: "prefer-software",
	});

	const hardware = await VideoDecoder.isConfigSupported({
		codec: codec,
		hardwareAcceleration: "prefer-hardware",
	});
		// Standard WebCodecs evaluation 
	const webCodecsSaysUnknown = hardware.config?.hardwareAcceleration !== "prefer-hardware";

	// If we aren't on Firefox and WebCodecs is confident, trust it and return early.
	if (!isFirefox && !webCodecsSaysUnknown) {
		return {
			hardware: hardware.supported === true,
			software: software.supported === true,
		};
	}

	// --- FIREFOX HEURISTIC FALLBACKS ---
	console.groupCollapsed(`[Video Decoding Support] Firefox Heuristics for ${codecName.toUpperCase()}`);
	console.log(`WebCodecs HW Supported: ${hardware.supported}`);
	console.log(`WebCodecs SW Supported: ${software.supported}`);

	let guessedHardware: boolean | undefined = undefined;

	// Run our secondary checks
	const mc = await checkMediaCapabilities(codecName);
	console.log(`MediaCapabilities -> Supported: ${mc.supported}, PowerEfficient: ${mc.powerEfficient}`);

	// If Firefox admits it is power efficient via the older API, we can safely assume HW acceleration.
	if (mc.powerEfficient) {
		console.log(`✅ Conclusion: MediaCapabilities verified power efficiency. Guessing HW is TRUE.`);
		guessedHardware = true;
	} 
	// else {
	// 	// If it's not power efficient, check the GPU string as a sanity check.
	// 	const gpu = getGPUModel();
	// 	console.log(`WebGL Unmasked GPU -> ${gpu || "Hidden/Unknown"}`);
	// 	// E.g., Apple M-series, Nvidia RTX, AMD Radeon, Intel Iris.
	// 	const hasGoodGPU = gpu ? /(nvidia|amd|apple|radeon|geforce|intel.*(uhd|iris|hd))/i.test(gpu) : false;

	// 	if (hasGoodGPU && software.supported) {
	// 		console.log(`⚠️ Conclusion: User has a known GPU, but Firefox denies power efficiency. Leaving HW as UNDEFINED to be safe.`);
	// 		guessedHardware = undefined;
	// 	} else {
	// 		console.log(`❌ Conclusion: No strong signals for HW acceleration. Leaving HW as UNDEFINED.`);
	// 		guessedHardware = undefined;
	// 	}
	// }

	console.groupEnd();

	return {
		hardware: guessedHardware,
		software: software.supported === true,
	};
}

async function videoDecoderSupported(codecName: keyof typeof CODECS): Promise<Codec> {
	return videoDecoderSupport(CODECS[codecName])
}

export async function isSupported(): Promise<Full> {
	return {
		webtransport: typeof WebTransport !== "undefined" ? "full" : "partial",
		audio: {
			decoding: {
				aac: await audioDecoderSupported("aac"),
				opus: (await audioDecoderSupported("opus")) ? "full" : "partial",
			},
			render: typeof AudioContext !== "undefined" && typeof AudioBufferSourceNode !== "undefined",
		},
		video: {
			decoding:
				typeof VideoDecoder !== "undefined"
					? {
							h264: await videoDecoderSupported("h264"),
							h265: await videoDecoderSupported("h265"),
							vp8: await videoDecoderSupported("vp8"),
							vp9: await videoDecoderSupported("vp9"),
							av1: await videoDecoderSupported("av1"),
						}
					: undefined,
			render: typeof OffscreenCanvas !== "undefined" && typeof CanvasRenderingContext2D !== "undefined",
		},
	};
}
