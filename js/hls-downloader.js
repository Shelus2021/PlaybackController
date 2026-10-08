"use strict";

// 轻量 HLS 点播下载器：解析清单、下载分片，并把常见 MPEG-TS 转封装为 fMP4。
(() => {
    const t = extensionMessage;
    const jobs = new Map();
    const requestReferers = new Map();
    let nextJobId = 1;
    let mp4boxLoader;

    function parseAttributes(value) {
        const result = {};
        const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
        let match;
        while ((match = pattern.exec(value))) {
            let item = match[2].trim();
            if (item.startsWith('"') && item.endsWith('"')) item = item.slice(1, -1);
            result[match[1].toUpperCase()] = item;
        }
        return result;
    }

    function playlistLines(text) {
        const value = String(text || "").replace(/^\uFEFF/, "");
        if (!/^#EXTM3U(?:\r?\n|$)/.test(value)) throw new Error(t("invalidM3u8"));
        return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    }

    function parseMasterPlaylist(text, baseUrl) {
        const lines = playlistLines(text);
        const audioGroups = new Map();
        const variants = [];
        for (const line of lines) {
            if (!line.startsWith("#EXT-X-MEDIA:")) continue;
            const attrs = parseAttributes(line.slice(line.indexOf(":") + 1));
            if (attrs.TYPE === "AUDIO" && attrs["GROUP-ID"] && attrs.URI) {
                const group = audioGroups.get(attrs["GROUP-ID"]) || [];
                group.push(attrs);
                audioGroups.set(attrs["GROUP-ID"], group);
            }
        }
        for (let index = 0; index < lines.length; index++) {
            const line = lines[index];
            if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
            const attrs = parseAttributes(line.slice(line.indexOf(":") + 1));
            let uri = "";
            for (let next = index + 1; next < lines.length; next++) {
                if (!lines[next].startsWith("#")) { uri = lines[next]; break; }
            }
            if (!uri) continue;
            const bandwidth = Number(attrs["AVERAGE-BANDWIDTH"] || attrs.BANDWIDTH) || 0;
            const resolution = attrs.RESOLUTION || "";
            const audioChoices = attrs.AUDIO ? (audioGroups.get(attrs.AUDIO) || []) : [];
            const audio = audioChoices.find(item => item.DEFAULT === "YES") || audioChoices.find(item => item.AUTOSELECT === "YES") || audioChoices[0];
            const codecs = attrs.CODECS || "";
            const unsupportedAudioCodec = audio && /(?:^|,)(?:ac-3|ec-3|opus)(?:,|$)/i.test(codecs.replace(/\s/g, ""));
            const silent = !audio && Boolean(codecs) && !/(?:^|,)(?:mp4a|ac-3|ec-3|opus)(?:[.,]|$)/i.test(codecs.replace(/\s/g, ""));
            const muxedAudio = !audio && /(?:^|,)(?:mp4a|ac-3|ec-3|opus)(?:[.,]|$)/i.test(codecs.replace(/\s/g, ""));
            const parts = [];
            if (resolution) parts.push(resolution);
            if (bandwidth) parts.push((bandwidth / 1000000).toFixed(bandwidth >= 10000000 ? 1 : 2) + " Mbps");
            if (silent) parts.push(t("noAudioTrack"));
            if (!parts.length) parts.push(t("unknownQuality"));
            variants.push({
                url: new URL(uri, baseUrl).href,
                bandwidth,
                resolution,
                codecs,
                label: parts.join(" · "),
                audioUrl: audio ? new URL(audio.URI, baseUrl).href : "",
                audioLabel: audio ? (audio.NAME || audio.LANGUAGE || t("defaultAudioTrack")) : "",
                silent,
                audioStatus: audio ? t(unsupportedAudioCodec ? "separateNonAac" : "separateAudio") : (silent ? t("noAudioTrack") : (muxedAudio ? t("hasAudio") : t("audioPending"))),
                supported: !unsupportedAudioCodec,
                reason: unsupportedAudioCodec ? t("unsupportedSeparateAudio") : ""
            });
        }
        const unique = new Map();
        for (const variant of variants) {
            const existing = unique.get(variant.url);
            if (!existing || (!existing.supported && variant.supported)) unique.set(variant.url, variant);
        }
        return [...unique.values()].sort((a, b) => {
            const area = value => {
                const match = String(value.resolution).match(/^(\d+)x(\d+)$/i);
                return match ? Number(match[1]) * Number(match[2]) : 0;
            };
            return area(b) - area(a) || b.bandwidth - a.bandwidth;
        });
    }

    function parseByteRange(value) {
        const match = String(value || "").replace(/^"|"$/g, "").match(/^(\d+)(?:@(\d+))?$/);
        if (!match) throw new Error(t("invalidByteRange"));
        return { length: Number(match[1]), offset: match[2] === undefined ? null : Number(match[2]) };
    }

    function parseMediaPlaylist(text, baseUrl) {
        const lines = playlistLines(text);
        if (!lines.includes("#EXT-X-ENDLIST")) throw new Error(t("vodOnly"));
        let mediaSequence = 0;
        let key = null;
        let map = null;
        let pendingRange = null;
        let pendingDuration = 0;
        let pendingBitrate = 0;
        let discontinuity = false;
        let lastRangeUrl = "";
        let lastRangeEnd = 0;
        const segments = [];
        for (const line of lines) {
            if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
                mediaSequence = Number(line.slice(line.indexOf(":") + 1)) || 0;
                continue;
            }
            if (line.startsWith("#EXT-X-KEY:")) {
                const attrs = parseAttributes(line.slice(line.indexOf(":") + 1));
                const method = String(attrs.METHOD || "").toUpperCase();
                if (method === "NONE") { key = null; continue; }
                if (method !== "AES-128") throw new Error(t("unsupportedEncryption", method || t("unknown")));
                if (attrs.KEYFORMAT && attrs.KEYFORMAT !== "identity") throw new Error(t("drmUnsupported"));
                if (!attrs.URI) throw new Error(t("missingKeyUrl"));
                key = { url: new URL(attrs.URI, baseUrl).href, iv: attrs.IV || "" };
                continue;
            }
            if (line.startsWith("#EXT-X-MAP:")) {
                const attrs = parseAttributes(line.slice(line.indexOf(":") + 1));
                if (!attrs.URI) throw new Error(t("missingInitUrl"));
                map = { url: new URL(attrs.URI, baseUrl).href, range: attrs.BYTERANGE ? parseByteRange(attrs.BYTERANGE) : null };
                continue;
            }
            if (line.startsWith("#EXT-X-BYTERANGE:")) {
                pendingRange = parseByteRange(line.slice(line.indexOf(":") + 1));
                continue;
            }
            if (line.startsWith("#EXTINF:")) {
                pendingDuration = Number(line.slice(line.indexOf(":") + 1).split(",")[0]) || 0;
                continue;
            }
            if (line.startsWith("#EXT-X-BITRATE:")) {
                pendingBitrate = Number(line.slice(line.indexOf(":") + 1)) || 0;
                continue;
            }
            if (line === "#EXT-X-DISCONTINUITY") {
                discontinuity = true;
                continue;
            }
            if (line.startsWith("#")) continue;
            const url = new URL(line, baseUrl).href;
            let range = pendingRange;
            if (range) {
                if (range.offset === null) range.offset = url === lastRangeUrl ? lastRangeEnd : 0;
                lastRangeUrl = url;
                lastRangeEnd = range.offset + range.length;
            }
            segments.push({
                url,
                range,
                key: key ? { ...key } : null,
                sequence: mediaSequence + segments.length,
                discontinuity,
                duration: pendingDuration,
                bitrate: pendingBitrate
            });
            pendingRange = null;
            pendingDuration = 0;
            pendingBitrate = 0;
            discontinuity = false;
        }
        if (!segments.length) throw new Error(t("noSegments"));
        if (segments.length > 10000) throw new Error(t("tooManySegments"));
        return { segments, map };
    }

    function rememberReferer(url, referer) {
        if (!referer || !/^https?:\/\//i.test(referer)) return null;
        const key = new URL(url).href.split("#")[0];
        const entry = { referer, expires: Date.now() + 30000 };
        requestReferers.set(key, entry);
        return { key, entry };
    }

    function forgetReferer(token) {
        if (token && requestReferers.get(token.key) === token.entry) requestReferers.delete(token.key);
    }

    async function fetchResponse(url, referer, signal, range) {
        const token = rememberReferer(url, referer);
        const headers = {};
        if (range) headers.Range = "bytes=" + range.offset + "-" + (range.offset + range.length - 1);
        try {
            const response = await fetch(url, { credentials: "include", headers, signal });
            if (!response.ok) throw new Error(t("httpFailed", response.status));
            return response;
        } finally {
            forgetReferer(token);
        }
    }

    async function fetchText(url, referer, signal) {
        const response = await fetchResponse(url, referer, signal);
        return response.text();
    }

    async function fetchBytes(url, referer, signal, range) {
        const response = await fetchResponse(url, referer, signal, range);
        let bytes = new Uint8Array(await response.arrayBuffer());
        if (range && response.status !== 206 && bytes.byteLength !== range.length) {
            bytes = bytes.slice(range.offset, range.offset + range.length);
        }
        if (range && bytes.byteLength !== range.length) throw new Error(t("rangeFailed"));
        return bytes;
    }

    function makeIv(value, sequence) {
        if (value) {
            let hex = value.replace(/^0x/i, "");
            if (!/^[0-9a-f]+$/i.test(hex) || hex.length > 32) throw new Error(t("invalidIv"));
            hex = hex.padStart(32, "0");
            return new Uint8Array(hex.match(/../g).map(item => parseInt(item, 16)));
        }
        const iv = new Uint8Array(16);
        let number = BigInt(sequence);
        for (let index = 15; index >= 0; index--) {
            iv[index] = Number(number & 255n);
            number >>= 8n;
        }
        return iv;
    }

    async function decryptSegment(bytes, keyInfo, referer, signal, keyCache) {
        if (!keyInfo) return bytes;
        let key = keyCache.get(keyInfo.url);
        if (!key) {
            const rawKey = await fetchBytes(keyInfo.url, referer, signal);
            if (rawKey.byteLength !== 16) throw new Error(t("invalidKeyLength"));
            key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-CBC" }, false, ["decrypt"]);
            keyCache.set(keyInfo.url, key);
        }
        try {
            const decrypted = await crypto.subtle.decrypt({ name: "AES-CBC", iv: makeIv(keyInfo.iv, keyInfo.sequence) }, key, bytes);
            return new Uint8Array(decrypted);
        } catch (_) {
            throw new Error(t("decryptFailed"));
        }
    }

    function notify(job, state, completed, total, message) {
        chrome.runtime.sendMessage({
            Message: "hlsDownloadProgress",
            jobId: job.id,
            sourceUrl: job.sourceUrl,
            state,
            completed,
            total,
            message
        }, () => void chrome.runtime.lastError);
    }

    async function resolveMediaPlaylist(url, referer, signal, depth = 0) {
        if (depth > 3) throw new Error(t("nestedPlaylist"));
        const text = await fetchText(url, referer, signal);
        const variants = parseMasterPlaylist(text, url);
        if (!variants.length) return { text, url, audioPlaylistUrl: "" };
        const chosen = variants.find(item => item.supported);
        if (!chosen) throw new Error(variants[0].reason || t("noMuxedQuality"));
        const resolved = await resolveMediaPlaylist(chosen.url, referer, signal, depth + 1);
        if (!resolved.audioPlaylistUrl) resolved.audioPlaylistUrl = chosen.audioUrl || "";
        return resolved;
    }

    function reportTrackProgress(job, progress, index, count) {
        const completed = (progress.offset || 0) + index + 1;
        const total = progress.total || count;
        const label = progress.label ? progress.label + " " : "";
        notify(job, "downloading", completed, total, t("downloadingLabel", [label, completed, total]));
    }

    async function transmuxTs(job, playlist, referer, progress = {}) {
        if (typeof muxjs === "undefined" || !muxjs.mp4 || !muxjs.mp4.Transmuxer) throw new Error(t("muxLoadFailed"));
        const chunks = [];
        const keyCache = new Map();
        let initAdded = false;
        let transmuxer = new muxjs.mp4.Transmuxer({ remux: true });
        let emitted = 0;
        let hasAudio = false;
        let hasVideo = false;
        const attach = () => transmuxer.on("data", segment => {
            hasAudio = hasAudio || segment.type === "audio" || segment.type === "combined";
            hasVideo = hasVideo || segment.type === "video" || segment.type === "combined";
            if (!initAdded && segment.initSegment && segment.initSegment.byteLength) {
                chunks.push(new Uint8Array(segment.initSegment));
                initAdded = true;
            }
            if (segment.data && segment.data.byteLength) {
                chunks.push(new Uint8Array(segment.data));
                emitted++;
            }
        });
        attach();
        for (let index = 0; index < playlist.segments.length; index++) {
            const item = playlist.segments[index];
            if (item.discontinuity) {
                transmuxer = new muxjs.mp4.Transmuxer({ remux: true, keepOriginalTimestamps: true });
                attach();
            }
            let bytes = await fetchBytes(item.url, referer, job.controller.signal, item.range);
            if (item.key) bytes = await decryptSegment(bytes, { ...item.key, sequence: item.sequence }, referer, job.controller.signal, keyCache);
            transmuxer.push(bytes);
            transmuxer.flush();
            reportTrackProgress(job, progress, index, playlist.segments.length);
        }
        if (!initAdded || !emitted) throw new Error(t("muxFailed"));
        return { chunks, hasAudio, hasVideo };
    }

    function containsAscii(bytes, value) {
        const target = [...value].map(char => char.charCodeAt(0));
        for (let index = 0; index <= bytes.length - target.length; index++) {
            let match = true;
            for (let offset = 0; offset < target.length; offset++) {
                if (bytes[index + offset] !== target[offset]) { match = false; break; }
            }
            if (match) return true;
        }
        return false;
    }

    async function combineFmp4(job, playlist, referer, progress = {}) {
        const chunks = [];
        const keyCache = new Map();
        if (playlist.map) chunks.push(await fetchBytes(playlist.map.url, referer, job.controller.signal, playlist.map.range));
        for (let index = 0; index < playlist.segments.length; index++) {
            const item = playlist.segments[index];
            let bytes = await fetchBytes(item.url, referer, job.controller.signal, item.range);
            if (item.key) bytes = await decryptSegment(bytes, { ...item.key, sequence: item.sequence }, referer, job.controller.signal, keyCache);
            chunks.push(bytes);
            reportTrackProgress(job, progress, index, playlist.segments.length);
        }
        const init = chunks[0] || new Uint8Array();
        return { chunks, hasAudio: containsAscii(init, "soun"), hasVideo: containsAscii(init, "vide") };
    }

    function downloadTrack(job, playlist, referer, progress) {
        return playlist.map ? combineFmp4(job, playlist, referer, progress) : transmuxTs(job, playlist, referer, progress);
    }

    function joinChunks(chunks) {
        const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
        const joined = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            joined.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return joined;
    }

    function loadMp4Box() {
        if (!mp4boxLoader) mp4boxLoader = import(chrome.runtime.getURL("lib/mp4box.all.mjs"));
        return mp4boxLoader;
    }

    function playlistStats(playlist, fallbackBandwidth = 0) {
        const duration = playlist.segments.reduce((total, segment) => total + (segment.duration || 0), 0);
        const measured = playlist.segments.every(segment => segment.bitrate > 0)
            ? playlist.segments.reduce((total, segment) => total + segment.bitrate * 1000 / 8 * segment.duration, 0)
            : 0;
        return { duration, estimatedSize: measured || (fallbackBandwidth && duration ? fallbackBandwidth * duration / 8 : 0) };
    }

    function formatProbeSize(bytes) {
        if (!bytes || !Number.isFinite(bytes)) return "";
        if (bytes < 1024 * 1024) return t("approximately", (bytes / 1024).toFixed(0) + " KB");
        if (bytes < 1024 * 1024 * 1024) return t("approximately", (bytes / 1024 / 1024).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0) + " MB");
        return t("approximately", (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB");
    }

    function optionLabel(option) {
        const parts = [];
        if (option.resolution) parts.push(option.resolution.replace("x", "×"));
        else if (option.hasAudio && !option.hasVideo) parts.push(t("audioOnly"));
        else parts.push(t("unknownResolution"));
        if (option.bandwidth) parts.push((option.bandwidth / 1000000).toFixed(option.bandwidth >= 10000000 ? 1 : 2) + " Mbps");
        const size = formatProbeSize(option.estimatedSize);
        if (size) parts.push(size);
        parts.push(option.audioStatus || t("unknownAudio"));
        return parts.join(" · ");
    }

    function inspectMp4Info(MP4Box, bytes) {
        const file = MP4Box.createFile();
        let info;
        let parseError;
        file.onError = error => { parseError = new Error(String(error || t("mp4InfoFailed"))); };
        file.onReady = value => { info = value; };
        const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        copy.fileStart = 0;
        file.appendBuffer(copy);
        file.flush();
        if (parseError) throw parseError;
        return info;
    }

    async function inspectDirectOption(text, url, referer, signal) {
        const playlist = parseMediaPlaylist(text, url);
        const first = playlist.segments[0];
        let hasAudio = false;
        let hasVideo = false;
        let initSegment;
        if (playlist.map) {
            initSegment = await fetchBytes(playlist.map.url, referer, signal, playlist.map.range);
            hasAudio = containsAscii(initSegment, "soun");
            hasVideo = containsAscii(initSegment, "vide");
        } else {
            let bytes = await fetchBytes(first.url, referer, signal, first.range);
            if (first.key) bytes = await decryptSegment(bytes, { ...first.key, sequence: first.sequence }, referer, signal, new Map());
            const transmuxer = new muxjs.mp4.Transmuxer({ remux: true });
            transmuxer.on("data", segment => {
                hasAudio = hasAudio || segment.type === "audio" || segment.type === "combined";
                hasVideo = hasVideo || segment.type === "video" || segment.type === "combined";
                if (!initSegment && segment.initSegment) initSegment = new Uint8Array(segment.initSegment);
            });
            transmuxer.push(bytes);
            transmuxer.flush();
        }
        if (!initSegment) throw new Error(t("trackInfoFailed"));
        let resolution = "";
        try {
            const MP4Box = await loadMp4Box();
            const info = inspectMp4Info(MP4Box, initSegment);
            const video = info && info.tracks.find(track => track.video);
            if (video && video.track_width && video.track_height) resolution = Math.round(video.track_width) + "x" + Math.round(video.track_height);
        } catch (_) {}
        const stats = playlistStats(playlist);
        const bandwidth = stats.duration && stats.estimatedSize ? Math.round(stats.estimatedSize * 8 / stats.duration) : 0;
        const option = {
            url,
            audioUrl: "",
            bandwidth,
            resolution,
            estimatedSize: stats.estimatedSize,
            hasAudio,
            hasVideo,
            audioStatus: hasAudio ? (hasVideo ? t("hasAudio") : t("audioOnly")) : (hasVideo ? t("noAudioTrack") : t("unknownAudio")),
            supported: true,
            reason: ""
        };
        option.label = optionLabel(option);
        return option;
    }

    async function probeDownloadOptions(url, referer, signal) {
        const text = await fetchText(url, referer, signal);
        const variants = parseMasterPlaylist(text, url);
        if (!variants.length) return [await inspectDirectOption(text, url, referer, signal)];
        await Promise.all(variants.map(async variant => {
            try {
                const childText = await fetchText(variant.url, referer, signal);
                if (!parseMasterPlaylist(childText, variant.url).length) {
                    const stats = playlistStats(parseMediaPlaylist(childText, variant.url), variant.bandwidth);
                    variant.estimatedSize = variant.audioUrl && variant.bandwidth && stats.duration
                        ? variant.bandwidth * stats.duration / 8
                        : stats.estimatedSize;
                    if (!variant.audioUrl && variant.audioStatus === t("audioPending")) {
                        const inspected = await inspectDirectOption(childText, variant.url, referer, signal);
                        variant.audioStatus = inspected.audioStatus;
                        variant.hasAudio = inspected.hasAudio;
                        variant.hasVideo = inspected.hasVideo;
                        if (!variant.resolution && inspected.resolution) variant.resolution = inspected.resolution;
                    }
                }
            } catch (_) {
                if (variant.audioStatus === t("audioPending")) variant.audioStatus = t("audioDetectionFailed");
            }
            if (typeof variant.hasAudio !== "boolean") {
                variant.hasAudio = variant.audioStatus === t("hasAudio") || variant.audioStatus === t("separateAudio");
            }
            if (typeof variant.hasVideo !== "boolean") variant.hasVideo = true;
            variant.label = optionLabel(variant);
        }));
        return variants;
    }

    function extractMp4Tracks(MP4Box, chunks) {
        const file = MP4Box.createFile();
        const samples = [];
        let info;
        let parseError;
        file.onError = error => { parseError = new Error(String(error || t("mp4TrackFailed"))); };
        file.onReady = value => {
            info = value;
            file.onSamples = (_id, _user, items) => samples.push(...items);
            for (const track of value.tracks) file.setExtractionOptions(track.id, null, { nbSamples: 1000000 });
            file.start();
        };
        const bytes = joinChunks(chunks);
        const buffer = bytes.buffer;
        buffer.fileStart = 0;
        file.appendBuffer(buffer);
        file.flush();
        if (parseError) throw parseError;
        if (!info || !samples.length) throw new Error(t("readTracksFailed"));
        return { info, samples };
    }

    function rebuildMp4(MP4Box, sources) {
        let durationSeconds = 0;
        for (const source of sources) {
            let nextDts = 0;
            source.samples = [...source.samples].sort((a, b) => (a.number || 0) - (b.number || 0));
            source.normalizedSamples = source.samples.map(sample => {
                const compositionOffset = sample.cts - sample.dts;
                const duration = Number(sample.duration) > 0 ? Number(sample.duration) : 1;
                const normalized = { sample, duration, dts: nextDts, cts: nextDts + compositionOffset };
                nextDts += duration;
                return normalized;
            });
            source.duration = nextDts;
            durationSeconds = Math.max(durationSeconds, source.duration / source.samples[0].timescale);
        }
        const output = MP4Box.createFile();
        output.init({ timescale: 1000, duration: Math.ceil(durationSeconds * 1000), brands: ["isom", "iso6", "mp41"] });
        for (const source of sources) {
            const first = source.samples[0];
            const description = first.description;
            source.outputId = output.addTrack({
                type: description.type,
                timescale: first.timescale,
                duration: Math.ceil(source.duration / first.timescale * 1000),
                media_duration: source.duration,
                width: description.width || source.info.track_width,
                height: description.height || source.info.track_height,
                hdlr: source.handler,
                language: source.info.language,
                description_boxes: [...(description.boxes || [])],
                channel_count: description.channel_count,
                samplesize: description.samplesize,
                samplerate: description.samplerate
            });
            if (!source.outputId) throw new Error(t("createTrackFailed", t(source.handler === "soun" ? "audio" : "video")));
        }

        const timeline = [];
        for (const source of sources) {
            for (const normalized of source.normalizedSamples) {
                timeline.push({ source, normalized, time: normalized.dts / normalized.sample.timescale });
            }
        }
        timeline.sort((a, b) => a.time - b.time || a.source.outputId - b.source.outputId);
        for (const { source, normalized } of timeline) {
            const sample = normalized.sample;
            output.addSample(source.outputId, new Uint8Array(sample.data), {
                duration: normalized.duration,
                dts: normalized.dts,
                cts: normalized.cts,
                is_sync: sample.is_sync,
                is_leading: sample.is_leading,
                depends_on: sample.depends_on,
                is_depended_on: sample.is_depended_on,
                has_redundancy: sample.has_redundancy,
                degradation_priority: sample.degradation_priority
            });
        }
        return new Uint8Array(output.getBuffer().buffer);
    }

    async function mergeMp4Tracks(videoChunks, audioChunks) {
        const MP4Box = await loadMp4Box();
        const videoFile = extractMp4Tracks(MP4Box, videoChunks);
        const audioFile = extractMp4Tracks(MP4Box, audioChunks);
        const videoInfo = videoFile.info.tracks.find(track => track.video);
        const audioInfo = audioFile.info.tracks.find(track => track.audio);
        const videoSamples = videoInfo ? videoFile.samples.filter(sample => sample.track_id === videoInfo.id) : [];
        const audioSamples = audioInfo ? audioFile.samples.filter(sample => sample.track_id === audioInfo.id) : [];
        if (!videoInfo || !videoSamples.length) throw new Error(t("noVideoTrack"));
        if (!audioInfo || !audioSamples.length) throw new Error(t("noAacTrack"));
        return rebuildMp4(MP4Box, [
            { info: videoInfo, samples: videoSamples, handler: "vide" },
            { info: audioInfo, samples: audioSamples, handler: "soun" }
        ]);
    }

    async function normalizeMp4Timeline(chunks) {
        const MP4Box = await loadMp4Box();
        const file = extractMp4Tracks(MP4Box, chunks);
        const sources = file.info.tracks
            .filter(track => track.video || track.audio)
            .map(info => ({
                info,
                handler: info.audio ? "soun" : "vide",
                samples: file.samples.filter(sample => sample.track_id === info.id)
            }))
            .filter(source => source.samples.length);
        if (!sources.length) throw new Error(t("readMp4TracksFailed"));
        return rebuildMp4(MP4Box, sources);
    }

    function mp4FileName(value) {
        let name = String(value || "video").replace(/[\\/:*?"<>|]/g, "_").slice(0, 170);
        name = name.replace(/\.(?:m3u8?|ts|m4s)$/i, "");
        return (name || "video") + ".mp4";
    }

    function saveBlob(job, chunks) {
        return new Promise((resolve, reject) => {
            const blobUrl = URL.createObjectURL(new Blob(chunks, { type: "video/mp4" }));
            chrome.downloads.download({ url: blobUrl, filename: mp4FileName(job.fileName), saveAs: false }, downloadId => {
                const error = chrome.runtime.lastError;
                if (error || !Number.isInteger(downloadId)) {
                    URL.revokeObjectURL(blobUrl);
                    reject(new Error(error ? error.message : t("browserDownloadFailed")));
                    return;
                }
                const release = delta => {
                    if (delta.id !== downloadId || (!delta.state && !delta.error)) return;
                    if (delta.state && !["complete", "interrupted"].includes(delta.state.current)) return;
                    chrome.downloads.onChanged.removeListener(release);
                    URL.revokeObjectURL(blobUrl);
                };
                chrome.downloads.onChanged.addListener(release);
                setTimeout(() => {
                    chrome.downloads.onChanged.removeListener(release);
                    URL.revokeObjectURL(blobUrl);
                }, 10 * 60 * 1000);
                resolve(downloadId);
            });
        });
    }

    async function runJob(job) {
        try {
            notify(job, "loading", 0, 0, t("readingPlaylist"));
            const resolved = await resolveMediaPlaylist(job.playlistUrl, job.referer, job.controller.signal);
            const playlist = parseMediaPlaylist(resolved.text, resolved.url);
            const audioPlaylistUrl = job.audioPlaylistUrl || resolved.audioPlaylistUrl;
            let chunks;
            let silent = false;
            let total = playlist.segments.length;
            if (audioPlaylistUrl) {
                const audioResolved = await resolveMediaPlaylist(audioPlaylistUrl, job.referer, job.controller.signal);
                const audioPlaylist = parseMediaPlaylist(audioResolved.text, audioResolved.url);
                total += audioPlaylist.segments.length;
                const videoTrack = await downloadTrack(job, playlist, job.referer, { offset: 0, total, label: t("videoLabel") });
                const audioTrack = await downloadTrack(job, audioPlaylist, job.referer, { offset: playlist.segments.length, total, label: t("audioLabel") });
                if (!videoTrack.hasVideo) throw new Error(t("selectedNoVideo"));
                if (!audioTrack.hasAudio) throw new Error(t("separateNotAac"));
                notify(job, "saving", total, total, t("mergingTracks"));
                chunks = [await mergeMp4Tracks(videoTrack.chunks, audioTrack.chunks)];
            } else {
                const track = await downloadTrack(job, playlist, job.referer, { offset: 0, total, label: "" });
                silent = track.hasVideo && !track.hasAudio;
                notify(job, "saving", total, total, t(silent ? "fixingSilentTimeline" : "generatingMp4"));
                chunks = [await normalizeMp4Timeline(track.chunks)];
            }
            await saveBlob(job, chunks);
            notify(job, "complete", total, total, audioPlaylistUrl
                ? t("completeWithAudio")
                : t(silent ? "silentMp4Started" : "completeMp4Started"));
        } catch (error) {
            const cancelled = error && error.name === "AbortError";
            notify(job, cancelled ? "cancelled" : "error", 0, 0, cancelled ? t("downloadCancelled") : (error.message || t("m3u8DownloadFailed")));
        } finally {
            jobs.delete(job.id);
        }
    }

    chrome.webRequest.onBeforeSendHeaders.addListener(data => {
        const entry = requestReferers.get(data.url.split("#")[0]);
        if (!entry || entry.expires < Date.now()) return;
        const headers = (data.requestHeaders || []).filter(header => !["referer", "origin"].includes(header.name.toLowerCase()));
        headers.push({ name: "Referer", value: entry.referer });
        try { headers.push({ name: "Origin", value: new URL(entry.referer).origin }); } catch (_) {}
        return { requestHeaders: headers };
    }, { urls: ["<all_urls>"] }, ["blocking", "requestHeaders", chrome.webRequest.OnBeforeSendHeadersOptions.EXTRA_HEADERS].filter(Boolean));

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!message || !message.Message) return false;
        if (message.Message === "probeHls") {
            const controller = new AbortController();
            probeDownloadOptions(message.url, message.referer, controller.signal)
                .then(options => sendResponse({ ok: true, variants: options }))
                .catch(error => sendResponse({ ok: false, error: error.message || t("readM3u8Failed") }));
            return true;
        }
        if (message.Message === "startHlsDownload") {
            const id = "hls-" + Date.now() + "-" + nextJobId++;
            const job = {
                id,
                sourceUrl: message.sourceUrl || message.url,
                playlistUrl: message.url,
                audioPlaylistUrl: message.audioUrl || "",
                referer: message.referer || "",
                fileName: message.fileName || "video.mp4",
                controller: new AbortController()
            };
            jobs.set(id, job);
            sendResponse({ ok: true, jobId: id });
            runJob(job);
            return false;
        }
        if (message.Message === "cancelHlsDownload") {
            const job = jobs.get(message.jobId);
            if (job) job.controller.abort();
            sendResponse({ ok: Boolean(job) });
            return false;
        }
        return false;
    });
})();
