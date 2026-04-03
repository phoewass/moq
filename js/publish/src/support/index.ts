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
		capture: boolean;
		encoding: Audio;
	};
	video: {
		capture: Partial;
		encoding: Video | undefined;
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

async function audioEncoderSupported(codec: keyof typeof CODECS): Promise<boolean> {
	if (!globalThis.AudioEncoder) return false;

	const res = await AudioEncoder.isConfigSupported({
		codec: CODECS[codec],
		numberOfChannels: 2,
		sampleRate: 48000,
	});

	return res.supported === true;
}

function mimeType(codec: string): string {
	if (codec.startsWith("aac")) return `audio/mp4; codecs="${codec}"`
	if (codec.startsWith("opus")) return `audio/ogg; codecs="${codec}"`
	if (codec.startsWith("av1")) return `video/mp4; codecs="${codec}"`
	if (codec.startsWith("h264")) return `video/mp4; codecs="${codec}"`
	if (codec.startsWith("h265")) return `video/mp4; codecs="${codec}"`
	if (codec.startsWith("vp9")) return `video/webm; codecs="${codec}"`
	if (codec.startsWith("vp8")) return `video/webm; codecs="${codec}"`
	return ""
}

// --- Media Capabilities ---
async function checkMediaCapabilities(codec: string): Promise<{ supported: boolean; powerEfficient: boolean }> {
	if (!navigator.mediaCapabilities) return { supported: false, powerEfficient: false };

	try {
		const info = await navigator.mediaCapabilities.encodingInfo({
			type: "webrtc",
			video: {
				contentType: mimeType(codec),
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

async function videoEncoderSupported(codecName: keyof typeof CODECS): Promise<Codec> {
	return videoEncoderSupport(CODECS[codecName], 1280, 720)
}

export async function videoEncoderSupport(codec: string,  width: number, height: number): Promise<Codec> {
	const hardware = await VideoEncoder.isConfigSupported({
		codec: codec,
		width: 1920,
		height: 1080,
		latencyMode: "realtime",
		hardwareAcceleration: "prefer-hardware",
		avc: codec.startsWith("avc1") ? { format: "annexb" } : undefined,
		// @ts-expect-error Typescript needs to be updated.
		hevc: codec.startsWith("hev1") ? { format: "annexb" } : undefined,
	});

	const unknown = isFirefox || hardware.config?.hardwareAcceleration !== "prefer-hardware";

	console.groupCollapsed(`[Video Encoding Support] Firefox Heuristics for ${codec.toUpperCase()}`);
	console.log(`WebCodecs HW Supported: ${hardware.supported}`);

	const mc = await checkMediaCapabilities(codec);
	console.log(`MediaCapabilities -> Supported: ${mc.supported}, PowerEfficient: ${mc.powerEfficient}`);

	// If Firefox admits it is power efficient via the older API, we can safely assume HW acceleration.
	if (mc.powerEfficient) {
		console.log(`✅ Conclusion: MediaCapabilities verified power efficiency. Guessing HW is TRUE.`);
	} 
	console.groupEnd();

	return {
		hardware: unknown ? undefined : hardware.supported === true,
		software: false,
	};
}

export async function isSupported(): Promise<Full> {
	return {
		webtransport: typeof WebTransport !== "undefined" ? "full" : "partial",
		audio: {
			capture: typeof AudioWorkletNode !== "undefined",
			encoding: {
				aac: await audioEncoderSupported("aac"),
				opus: (await audioEncoderSupported("opus")) ? "full" : "partial",
			},
		},
		video: {
			capture:
				// We have a fallback for MediaStreamTrackProcessor, but it's pretty gross so no full points.
				// @ts-expect-error No typescript types yet.
				typeof MediaStreamTrackProcessor !== "undefined"
					? "full"
					: typeof OffscreenCanvas !== "undefined"
						? "partial"
						: "none",
			encoding:
				typeof VideoEncoder !== "undefined"
					? {
							h264: await videoEncoderSupported("h264"),
							h265: await videoEncoderSupported("h265"),
							vp8: await videoEncoderSupported("vp8"),
							vp9: await videoEncoderSupported("vp9"),
							av1: await videoEncoderSupported("av1"),
						}
					: undefined,
		},
	};
}
