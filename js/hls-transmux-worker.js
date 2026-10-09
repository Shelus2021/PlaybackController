"use strict";

importScripts("../lib/mux.min.js");

let transmuxer;
let output = null;

function createTransmuxer(keepOriginalTimestamps) {
    const next = new muxjs.mp4.Transmuxer({ remux: true, keepOriginalTimestamps });
    next.on("data", segment => {
        if (!output) return;
        output.push({
            type: segment.type || "",
            initSegment: segment.initSegment && segment.initSegment.byteLength
                ? new Uint8Array(segment.initSegment)
                : null,
            data: segment.data && segment.data.byteLength
                ? new Uint8Array(segment.data)
                : null
        });
    });
    return next;
}

transmuxer = createTransmuxer(false);

self.onmessage = event => {
    const message = event.data || {};
    if (message.type !== "transmux") return;
    try {
        if (message.reset) transmuxer = createTransmuxer(true);
        output = [];
        transmuxer.push(new Uint8Array(message.bytes));
        transmuxer.flush();
        const segments = output;
        output = null;
        const transfers = [];
        segments.forEach(segment => {
            if (segment.initSegment) transfers.push(segment.initSegment.buffer);
            if (segment.data) transfers.push(segment.data.buffer);
        });
        self.postMessage({ id: message.id, ok: true, segments }, transfers);
    } catch (error) {
        output = null;
        self.postMessage({ id: message.id, ok: false, error: error && error.message ? error.message : String(error) });
    }
};
