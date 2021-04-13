// adapted from https://github.com/emscripten-core/emscripten/blob/cbc974264e0b0b3f0ce8020fb2f1861376c66545/src/library_fs.js
// flexible chunk size parameter
// Creates a file record for lazy-loading from a URL. XXX This requires a synchronous
// XHR, which is not possible in browsers except in a web worker! Use preloading,
// either --preload-file in emcc or FS.createPreloadedFile

// Lazy chunked Uint8Array (implements get and length from Uint8Array). Actual getting is abstracted away for eventual reuse.
class LazyUint8Array {
  lengthKnown = false;
  chunks: Uint8Array[] = []; // Loaded chunks. Index is the chunk number
  totalFetchedBytes = 0;
  totalRequests = 0;
  _length?: number;

  lastEnd = 0;
  speed = 1;
  constructor(private _chunkSize: number, private url: string) {}
  get(idx: number) {
    if (idx > this.length - 1 || idx < 0) {
      return undefined;
    }
    var chunkOffset = idx % this.chunkSize;
    var chunkNum = (idx / this.chunkSize) | 0;
    return this.getter(chunkNum)[chunkOffset];
  }
  getter(chunkNum: number) {
    const start = chunkNum * this.chunkSize;
   
    if (typeof this.chunks[chunkNum] === "undefined") {
      if(this.lastEnd === start - 1) {
        this.speed = Math.min(64, this.speed * 2);
      } else {
        this.speed = 1;
      }
      const chunksToFetch = this.speed;
      let end = (chunkNum + chunksToFetch) * this.chunkSize - 1; // including this byte
      end = Math.min(end, this.length - 1); // if datalength-1 is selected, this is the last block

      this.lastEnd = end;
      const buf = this.doXHR(start, end);
      for(let i = 0; i < chunksToFetch; i++) {
        const curChunk = chunkNum + i;
        this.chunks[curChunk] = new Uint8Array(buf, i * this.chunkSize, this.chunkSize);
      }
    }
    if (typeof this.chunks[chunkNum] === "undefined")
      throw new Error("doXHR failed!");
    return this.chunks[chunkNum];
  }
  cacheLength() {
    // Find length
    var xhr = new XMLHttpRequest();
    xhr.open("HEAD", this.url, false);
    xhr.send(null);
    if (!((xhr.status >= 200 && xhr.status < 300) || xhr.status === 304))
      throw new Error("Couldn't load " + this.url + ". Status: " + xhr.status);
    var datalength = Number(xhr.getResponseHeader("Content-length"));

    var header;
    var hasByteServing =
      (header = xhr.getResponseHeader("Accept-Ranges")) && header === "bytes";
    var usesGzip =
      (header = xhr.getResponseHeader("Content-Encoding")) && header === "gzip";

    if (usesGzip || !datalength || !hasByteServing) {
      throw Error("server uses gzip or doesn't have length");
    }

    this._length = datalength;
    this.lengthKnown = true;
  }
  get length() {
    if (!this.lengthKnown) {
      this.cacheLength();
    }
    return this._length!;
  }

  get chunkSize() {
    if (!this.lengthKnown) {
      this.cacheLength();
    }
    return this._chunkSize!;
  }
  private doXHR(from: number, to: number) {
    console.log(`- [xhr of size ${(to + 1-from)/1024} KiB]`);
    this.totalFetchedBytes += to - from;
    this.totalRequests++;
    if (from > to)
      throw new Error(
        "invalid range (" + from + ", " + to + ") or no bytes requested!"
      );
    if (to > this.length - 1)
      throw new Error(
        "only " + this.length + " bytes available! programmer error!"
      );

    // TODO: Use mozResponseArrayBuffer, responseStream, etc. if available.
    var xhr = new XMLHttpRequest();
    xhr.open("GET", this.url, false);
    if (this.length !== this.chunkSize)
      xhr.setRequestHeader("Range", "bytes=" + from + "-" + to);

    // Some hints to the browser that we want binary data.
    xhr.responseType = "arraybuffer";
    if (xhr.overrideMimeType) {
      xhr.overrideMimeType("text/plain; charset=x-user-defined");
    }

    xhr.send(null);
    if (!((xhr.status >= 200 && xhr.status < 300) || xhr.status === 304))
      throw new Error("Couldn't load " + this.url + ". Status: " + xhr.status);
    if (xhr.response !== undefined) {
      return xhr.response as ArrayBuffer;
    } else {
      throw Error("xhr did not return uint8array");
    }
  }
}

export function createLazyFile(
  FS: any,
  parent: string,
  name: string,
  url: string,
  canRead: boolean,
  canWrite: boolean,
  chunkSize: number = 4096
) {
  var lazyArray = new LazyUint8Array(chunkSize, url);
  var properties = { isDevice: false, contents: lazyArray };

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
    console.log(
      `[fs: ${length / 1024} KiB read request offset @ ${position / 1024} KiB `
    );
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
