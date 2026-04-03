export class FramePadder {
    #canvas: OffscreenCanvas;
    #ctx: OffscreenCanvasRenderingContext2D;
    
    targetWidth: number;
    targetHeight: number;

    constructor(targetWidth: number, targetHeight: number) {
        this.targetWidth = targetWidth;
        this.targetHeight = targetHeight;
        
        this.#canvas = new OffscreenCanvas(targetWidth, targetHeight);
        // alpha: false tells the GPU we don't need transparency, which speeds up rendering!
        this.#ctx = this.#canvas.getContext("2d", { alpha: false })!; 
    }

    pad(frame: VideoFrame): VideoFrame {
        // 1. Calculate how much we need to scale the video to fit inside the target dimensions
        // without breaking the aspect ratio.
        const scale = Math.min(
            this.targetWidth / frame.displayWidth,
            this.targetHeight / frame.displayHeight
        );

        const drawWidth = frame.displayWidth * scale;
        const drawHeight = frame.displayHeight * scale;

        // 2. Calculate the X and Y offsets to center the video
        const x = (this.targetWidth - drawWidth) / 2;
        const y = (this.targetHeight - drawHeight) / 2;

        // 3. Paint the canvas completely black
        this.#ctx.fillStyle = "black";
        this.#ctx.fillRect(0, 0, this.targetWidth, this.targetHeight);

        // 4. Paint the video frame on top of the black background
        this.#ctx.drawImage(frame, x, y, drawWidth, drawHeight);

        // 5. Wrap the canvas in a new VideoFrame, copying the exact timestamp from the original
        const paddedFrame = new VideoFrame(this.#canvas, {
            timestamp: frame.timestamp,
            duration: frame.duration ?? undefined,
        });

        return paddedFrame;
    }
}