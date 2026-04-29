import * as Catalog from "@moq/hang/catalog";
import { Effect, Signal } from "@moq/signals";
import { Encoder, type EncoderProps } from "./encoder";
import { TrackProcessor } from "./polyfill";
import type { Source } from "./types";

export * from "./encoder";
export * from "./types";

export type Props = {
	source?: Source | Signal<Source | undefined>;
	hd?: EncoderProps;
	sd?: EncoderProps;
	flip?: boolean | Signal<boolean>;
};

export class Root {
	static readonly TRACK_HD = "video/hd";
	static readonly TRACK_SD = "video/sd";
	static readonly PRIORITY = Catalog.PRIORITY.video;

	source: Signal<Source | undefined>;
	hd: Encoder;
	sd: Encoder;

	frame = new Signal<VideoFrame | undefined>(undefined);

	catalog = new Signal<Catalog.Video | undefined>(undefined);
	display = new Signal<{ width: number; height: number } | undefined>(undefined);
	flip = new Signal<boolean>(false);

	signals = new Effect();

	constructor(props?: Props) {
		this.source = Signal.from(props?.source);

		this.hd = new Encoder(this.frame, this.source, props?.hd);
		this.sd = new Encoder(this.frame, this.source, props?.sd);

		this.flip = Signal.from(props?.flip ?? false);

		this.signals.run(this.#runCatalog.bind(this));
		this.signals.run(this.#runFrame.bind(this));
	}

	#runFrame(effect: Effect) {
		const source = effect.get(this.source);
		if (!source) return;

		// NOTE: We modify the stock MediaStreamTrackProcessor so timestamps use our wall clock time.
		// This is so even when the source is changed or encoder reloaded, the timestamps will be consistent.
		const reader = TrackProcessor(source).getReader();
		effect.cleanup(() => reader.cancel());

		effect.spawn(async () => {
			console.log("[Root] 🎞️ Frame reader started...");
			for (;;) {
				const next = await Promise.race([reader.read(), effect.cancel]);
				if (!next?.value) break;
				if (!next || next.done) {
                    console.log("[Root] ⏹️ Frame reader done or cancelled.");
                    break;
                }

				console.log("[Root] 🖼️ New frame received:", next.value.timestamp);

				this.frame.update((prev) => {
					prev?.close();
					return next.value;
				});

				this.display.set({ width: next.value.codedWidth, height: next.value.codedHeight });
			}
		});

		effect.cleanup(() => {
			this.frame.update((prev) => {
				prev?.close();
				return undefined;
			});
			this.display.set(undefined);
		});
	}

	#runCatalog(effect: Effect) {
		const source = effect.get(this.source);
		if (!source) {
			this.catalog.set(undefined);
			return;
		}

		const hdConfig = effect.get(this.hd.catalog);
        const sdConfig = effect.get(this.sd.catalog);

		console.log(`[Root] 📈 Encoder Status -> HD: ${!!hdConfig}, SD: ${!!sdConfig}`);
	
		// --- THE FIX ---
        // If neither encoder has generated a config yet, ABORT.
        // Do not let an empty catalog escape to the relay!
        if (!hdConfig && !sdConfig) {
            console.log("[Publish] ⏳ Waiting for encoders to warm up before publishing catalog...");
            return; 
        }

        const renditions: Record<string, Catalog.VideoConfig> = {};
        if (hdConfig) renditions[Root.TRACK_HD] = hdConfig;
        if (sdConfig) renditions[Root.TRACK_SD] = sdConfig;
		// 1. Get display info but DON'T return if it's missing.
		// We fallback to the track's native settings if the processor hasn't yielded a frame yet.
		const display = effect.get(this.display);
		if (!display) {
			console.log("[Publish] source, display info not ready", source)
		} else {
			console.log("[Publish] source", source, display)
		}
		const settings = source.getSettings();

		const width = display?.width ?? settings.width ?? 0;
		const height = display?.height ?? settings.height ?? 0;

		// 2. Publish the catalog even if dimensions are 0/0. 
		// This ensures the subscriber "sees" the tracks immediately.
		const catalog: Catalog.Video = {
			renditions,
			display: {
				width: Catalog.u53(width),
				height: Catalog.u53(height),
			},
			flip: effect.get(this.flip) ?? undefined,
		};

		console.log("[Publish] 🚀 Publishing full catalog:", catalog);
		this.catalog.set(catalog);
	}

	close() {
		this.signals.close();
		this.hd.close();
		this.sd.close();

		this.frame.update((prev) => {
			prev?.close();
			return undefined;
		});
	}
}
