// adapted from https://github.com/emscripten-core/emscripten/blob/cbc974264e0b0b3f0ce8020fb2f1861376c66545/src/library_fs.js
// flexible chunk size parameter
// Creates a file record for lazy-loading from a URL. XXX This requires a synchronous
// XHR, which is not possible in browsers except in a web worker! Use preloading,
// either --preload-file in emcc or FS.createPreloadedFile
export function createLazyFile(
    FS: any,
    parent: string,
    name: string,
    url: string,
    canRead: boolean,
    canWrite: boolean,
    chunkSize: number = 4096
) {
    // Lazy chunked Uint8Array (implements get and length from Uint8Array). Actual getting is abstracted away for eventual reuse.
    /** @constructor */
    function LazyUint8Array() {
        this.lengthKnown = false;
        this.chunks = []; // Loaded chunks. Index is the chunk number
    }
    LazyUint8Array.prototype.get = /** @this{Object} */ function LazyUint8Array_get(
        idx
    ) {
        if (idx > this.length - 1 || idx < 0) {
            return undefined;
        }
        var chunkOffset = idx % this.chunkSize;
        var chunkNum = (idx / this.chunkSize) | 0;
        return this.getter(chunkNum)[chunkOffset];
    };
    LazyUint8Array.prototype.setDataGetter = function LazyUint8Array_setDataGetter(
        getter
    ) {
        this.getter = getter;
    };
    LazyUint8Array.prototype.cacheLength = function LazyUint8Array_cacheLength() {
        // Find length
        var xhr = new XMLHttpRequest();
        xhr.open("HEAD", url, false);
        xhr.send(null);
        if (!((xhr.status >= 200 && xhr.status < 300) || xhr.status === 304))
            throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
        var datalength = Number(xhr.getResponseHeader("Content-length"));
        var header;
        var hasByteServing =
            (header = xhr.getResponseHeader("Accept-Ranges")) &&
            header === "bytes";
        var usesGzip =
            (header = xhr.getResponseHeader("Content-Encoding")) &&
            header === "gzip";

        if (!hasByteServing) chunkSize = datalength;

        // Function to get a range from the remote URL.
        var doXHR = function (from, to) {
          node.totalFetchedBytes = (node.totalFetchedBytes||0) + to - from;
          node.totalRequests = (node.totalRequests || 0) + 1;
            if (from > to)
                throw new Error(
                    "invalid range (" +
                        from +
                        ", " +
                        to +
                        ") or no bytes requested!"
                );
            if (to > datalength - 1)
                throw new Error(
                    "only " + datalength + " bytes available! programmer error!"
                );

            // TODO: Use mozResponseArrayBuffer, responseStream, etc. if available.
            var xhr = new XMLHttpRequest();
            xhr.open("GET", url, false);
            if (datalength !== chunkSize)
                xhr.setRequestHeader("Range", "bytes=" + from + "-" + to);

            // Some hints to the browser that we want binary data.
            if (typeof Uint8Array != "undefined")
                xhr.responseType = "arraybuffer";
            if (xhr.overrideMimeType) {
                xhr.overrideMimeType("text/plain; charset=x-user-defined");
            }

            xhr.send(null);
            if (
                !((xhr.status >= 200 && xhr.status < 300) || xhr.status === 304)
            )
                throw new Error(
                    "Couldn't load " + url + ". Status: " + xhr.status
                );
            if (xhr.response !== undefined) {
                return new Uint8Array(
                    /** @type{Array<number>} */ xhr.response || []
                );
            } else {
                return intArrayFromString(xhr.responseText || "", true);
            }
        };
        var lazyArray = this;
        lazyArray.setDataGetter(function (chunkNum) {
            var start = chunkNum * chunkSize;
            var end = (chunkNum + 1) * chunkSize - 1; // including this byte
            end = Math.min(end, datalength - 1); // if datalength-1 is selected, this is the last block
            if (typeof lazyArray.chunks[chunkNum] === "undefined") {
                lazyArray.chunks[chunkNum] = doXHR(start, end);
            }
            if (typeof lazyArray.chunks[chunkNum] === "undefined")
                throw new Error("doXHR failed!");
            return lazyArray.chunks[chunkNum];
        });

        if (usesGzip || !datalength) {
            // if the server uses gzip or doesn't supply the length, we have to download the whole file to get the (uncompressed) length
            chunkSize = datalength = 1; // this will force getter(0)/doXHR do download the whole file
            datalength = this.getter(0).length;
            chunkSize = datalength;
            out(
                "LazyFiles on gzip forces download of the whole file when length is accessed"
            );
        }

        this._length = datalength;
        this._chunkSize = chunkSize;
        this.lengthKnown = true;
    };
    if (typeof XMLHttpRequest !== "undefined") {
        var lazyArray = new LazyUint8Array();
        Object.defineProperties(lazyArray, {
            length: {
                get: /** @this{Object} */ function () {
                    if (!this.lengthKnown) {
                        this.cacheLength();
                    }
                    return this._length;
                },
            },
            chunkSize: {
                get: /** @this{Object} */ function () {
                    if (!this.lengthKnown) {
                        this.cacheLength();
                    }
                    return this._chunkSize;
                },
            },
        });

        var properties = { isDevice: false, contents: lazyArray };
    } else {
        var properties = { isDevice: false, url: url };
    }

    var node = FS.createFile(parent, name, properties, canRead, canWrite);
    // This is a total hack, but I want to get this lazy file code out of the
    // core of MEMFS. If we want to keep this lazy file concept I feel it should
    // be its own thin LAZYFS proxying calls to MEMFS.
    if (properties.contents) {
        node.contents = properties.contents;
    } else if (properties.url) {
        node.contents = null;
        node.url = properties.url;
    }
    // Add a function that defers querying the file size until it is asked the first time.
    Object.defineProperties(node, {
        usedBytes: {
            get: /** @this {FSNode} */ function () {
                return this.contents.length;
            },
        },
    });
    // override each stream op with one that tries to force load the lazy file first
    var stream_ops = {};
    var keys = Object.keys(node.stream_ops);
    keys.forEach(function (key) {
        var fn = node.stream_ops[key];
        stream_ops[key] = function forceLoadLazyFile() {
            FS.forceLoadFile(node);
            return fn.apply(null, arguments);
        };
    });
    // use a custom read function
    stream_ops.read = function stream_ops_read(
        stream,
        buffer,
        offset,
        length,
        position
    ) {
        FS.forceLoadFile(node);
        console.log(`[fs: ${length/1024} KiB read request offset @ ${position / 1024} KiB `);
        var contents = stream.node.contents;
        if (position >= contents.length) return 0;
        var size = Math.min(contents.length - position, length);
        if (contents.slice) {
            // normal array
            for (var i = 0; i < size; i++) {
                buffer[offset + i] = contents[position + i];
            }
        } else {
            for (var i = 0; i < size; i++) {
                // LazyUint8Array from sync binary XHR
                buffer[offset + i] = contents.get(position + i);
            }
        }
        return size;
    };
    node.stream_ops = stream_ops;
    return node;
}
