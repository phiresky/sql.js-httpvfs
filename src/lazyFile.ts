// adapted from https://github.com/emscripten-core/emscripten/blob/cbc974264e0b0b3f0ce8020fb2f1861376c66545/src/library_fs.js
// flexible chunk size parameter
// Creates a file record for lazy-loading from a URL. XXX This requires a synchronous
// XHR, which is not possible in browsers except in a web worker!

export type RangeMapper = (
  fromByte: number,
  toByte: number
) => { url: string; headUrl: string; fromByte: number; toByte: number };

export type RequestLimiter = (bytes: number) => void;

export type LazyFileConfig = {
  /** function to map a read request to an url with read request  */
  rangeMapper: RangeMapper;
  /** must be known beforehand if there's multiple server chunks (i.e. rangeMapper returns different urls) */
  fileLength?: number;
  /** chunk size for random access requests (should be same as sqlite page size) */
  requestChunkSize: number;
  /** number of virtual read heads. default: 3 */
  maxReadHeads?: number;
  /** max read speed for sequential access. default: 5 MiB */
  maxReadSpeed?: number;
  /** if true, log all read pages into the `readPages` field for debugging */
  logPageReads?: boolean;
  /** if defined, this is called once per request and passed the number of bytes about to be requested **/
  requestLimiter?: RequestLimiter;
};
export type PageReadLog = {
  pageno: number;
  // if page was already loaded
  wasCached: boolean;
  // how many pages were prefetched
  prefetch: number;
};

type ReadHead = { startChunk: number; speed: number };
export class LazyUint8Array {
  private serverChecked = false;
  private readonly chunks: Uint8Array[] = []; // Loaded chunks. Index is the chunk number
  totalFetchedBytes = 0;
  totalRequests = 0;
  readPages: PageReadLog[] = [];
  private _length?: number;

  // LRU list of read heds, max length = maxReadHeads. first is most recently used
  private readonly readHeads: ReadHead[] = [];
  private readonly _chunkSize: number;
  private readonly rangeMapper: RangeMapper;
  private readonly maxSpeed: number;
  private readonly maxReadHeads: number;
  private readonly logPageReads: boolean;
  private readonly requestLimiter: RequestLimiter;

  constructor(config: LazyFileConfig) {
    this._chunkSize = config.requestChunkSize;
    this.maxSpeed = Math.round(
      (config.maxReadSpeed || 5 * 1024 * 1024) / this._chunkSize
    ); // max 5MiB at once
    this.maxReadHeads = config.maxReadHeads ?? 3;
    this.rangeMapper = config.rangeMapper;
    this.logPageReads = config.logPageReads ?? false;
    if (config.fileLength) {
      this._length = config.fileLength;
    }
    this.requestLimiter = config.requestLimiter == null ? ((ignored) => {}) : config.requestLimiter;
  }
  /**
   * efficiently copy the range [start, start + length) from the http file into the
   * output buffer at position [outOffset, outOffest + length)
   * reads from cache or synchronously fetches via HTTP if needed
   */
  copyInto(
    buffer: Uint8Array,
    outOffset: number,
    length: number,
    start: number
  ): number {
    if (start >= this.length) return 0;
    length = Math.min(this.length - start, length);
    const end = start + length;
    let i = 0;
    while (i < length) {
      // {idx: 24, chunkOffset: 24, chunkNum: 0, wantedSize: 16}
      const idx = start + i;
      const chunkOffset = idx % this.chunkSize;
      const chunkNum = (idx / this.chunkSize) | 0;
      const wantedSize = Math.min(this.chunkSize, end - idx);
      let inChunk = this.getChunk(chunkNum);
      if (chunkOffset !== 0 || wantedSize !== this.chunkSize) {
        inChunk = inChunk.subarray(chunkOffset, chunkOffset + wantedSize);
      }
      buffer.set(inChunk, outOffset + i);
      i += inChunk.length;
    }
    return length;
  }

  private lastGet = -1;
  /* find the best matching existing read head to get the given chunk or create a new one */
  private moveReadHead(wantedChunkNum: number): ReadHead {
    for (const [i, head] of this.readHeads.entries()) {
      const fetchStartChunkNum = head.startChunk + head.speed;
      const newSpeed = Math.min(this.maxSpeed, head.speed * 2);
      const wantedIsInNextFetchOfHead =
        wantedChunkNum >= fetchStartChunkNum &&
        wantedChunkNum < fetchStartChunkNum + newSpeed;
      if (wantedIsInNextFetchOfHead) {
        head.speed = newSpeed;
        head.startChunk = fetchStartChunkNum;
        if (i !== 0) {
          // move head to front
          this.readHeads.splice(i, 1);
          this.readHeads.unshift(head);
        }
        return head;
      }
    }
    const newHead: ReadHead = {
      startChunk: wantedChunkNum,
      speed: 1,
    };
    this.readHeads.unshift(newHead);
    while (this.readHeads.length > this.maxReadHeads) this.readHeads.pop();
    return newHead;
  }
  /** get the given chunk from cache or fetch it from remote */
  private getChunk(wantedChunkNum: number): Uint8Array {
    let wasCached = true;
    if (typeof this.chunks[wantedChunkNum] === "undefined") {
      wasCached = false;
      // double the fetching chunk size if the wanted chunk would be within the next fetch request
      const head = this.moveReadHead(wantedChunkNum);

      const chunksToFetch = head.speed;
      const startByte = head.startChunk * this.chunkSize;
      let endByte = (head.startChunk + chunksToFetch) * this.chunkSize - 1; // including this byte
      endByte = Math.min(endByte, this.length - 1); // if datalength-1 is selected, this is the last block

      const buf = this.doXHR(startByte, endByte);
      for (let i = 0; i < chunksToFetch; i++) {
        const curChunk = head.startChunk + i;
        if (i * this.chunkSize >= buf.byteLength) break; // past end of file
        const curSize =
          (i + 1) * this.chunkSize > buf.byteLength
            ? buf.byteLength - i * this.chunkSize
            : this.chunkSize;
        // console.log("constructing chunk", buf.byteLength, i * this.chunkSize, curSize);
        this.chunks[curChunk] = new Uint8Array(
          buf,
          i * this.chunkSize,
          curSize
        );
      }
    }
    if (typeof this.chunks[wantedChunkNum] === "undefined")
      throw new Error("doXHR failed (bug)!");
    const boring = !this.logPageReads || this.lastGet == wantedChunkNum;
    if (!boring) {
      this.lastGet = wantedChunkNum;
      this.readPages.push({
        pageno: wantedChunkNum,
        wasCached,
        prefetch: wasCached ? 0 : this.readHeads[0].speed - 1,
      });
    }
    return this.chunks[wantedChunkNum];
  }
  /** verify the server supports range requests and find out file length */
  private checkServer() {
    var xhr = new XMLHttpRequest();
    const url = this.rangeMapper(0, 0).headUrl;
    // can't set Accept-Encoding header :( https://stackoverflow.com/questions/41701849/cannot-modify-accept-encoding-with-fetch
    xhr.open("HEAD", url, false);
    // // maybe this will help it not use compression?
    // xhr.setRequestHeader("Range", "bytes=" + 0 + "-" + 1e12);
    xhr.send(null);
    if (!((xhr.status >= 200 && xhr.status < 300) || xhr.status === 304))
      throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
    var datalength: number | null = Number(
      xhr.getResponseHeader("Content-length")
    );

    var hasByteServing = xhr.getResponseHeader("Accept-Ranges") === "bytes";
    const encoding = xhr.getResponseHeader("Content-Encoding");
    var usesCompression = encoding && encoding !== "identity";

    if (!hasByteServing) {
      const msg =
        "Warning: The server did not respond with Accept-Ranges=bytes. It either does not support byte serving or does not advertise it (`Accept-Ranges: bytes` header missing), or your database is hosted on CORS and the server doesn't mark the accept-ranges header as exposed. This may lead to incorrect results.";
      console.warn(
        msg,
        "(seen response headers:",
        xhr.getAllResponseHeaders(),
        ")"
      );
      // throw Error(msg);
    }
    if (usesCompression) {
      console.warn(
        `Warning: The server responded with ${encoding} encoding to a HEAD request. Ignoring since it may not do so for Range HTTP requests, but this will lead to incorrect results otherwise since the ranges will be based on the compressed data instead of the uncompressed data.`
      );
    }
    if (usesCompression) {
      // can't use the given data length if there's compression
      datalength = null;
    }

    if (!this._length) {
      if (!datalength) {
        console.error("response headers", xhr.getAllResponseHeaders());
        throw Error("Length of the file not known. It must either be supplied in the config or given by the HTTP server.");
      }
      this._length = datalength;
    }
    this.serverChecked = true;
  }
  get length() {
    if (!this.serverChecked) {
      this.checkServer();
    }
    return this._length!;
  }

  get chunkSize() {
    if (!this.serverChecked) {
      this.checkServer();
    }
    return this._chunkSize!;
  }
  private doXHR(absoluteFrom: number, absoluteTo: number) {
    console.log(
      `[xhr of size ${(absoluteTo + 1 - absoluteFrom) / 1024} KiB @ ${
        absoluteFrom / 1024
      } KiB]`
    );
    this.requestLimiter(absoluteTo - absoluteFrom);
    this.totalFetchedBytes += absoluteTo - absoluteFrom;
    this.totalRequests++;
    if (absoluteFrom > absoluteTo)
      throw new Error(
        "invalid range (" +
          absoluteFrom +
          ", " +
          absoluteTo +
          ") or no bytes requested!"
      );
    if (absoluteTo > this.length - 1)
      throw new Error(
        "only " + this.length + " bytes available! programmer error!"
      );
    const {
      fromByte: from,
      toByte: to,
      url,
    } = this.rangeMapper(absoluteFrom, absoluteTo);

    // TODO: Use mozResponseArrayBuffer, responseStream, etc. if available.
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);
    if (this.length !== this.chunkSize)
      xhr.setRequestHeader("Range", "bytes=" + from + "-" + to);

    // Some hints to the browser that we want binary data.
    xhr.responseType = "arraybuffer";
    if (xhr.overrideMimeType) {
      xhr.overrideMimeType("text/plain; charset=x-user-defined");
    }

    xhr.send(null);
    if (!((xhr.status >= 200 && xhr.status < 300) || xhr.status === 304))
      throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
    if (xhr.response !== undefined) {
      return xhr.response as ArrayBuffer;
    } else {
      throw Error("xhr did not return uint8array");
    }
  }
}
/** create the actual file object for the emscripten file system */
export function createLazyFile(
  FS: any,
  parent: string,
  name: string,
  canRead: boolean,
  canWrite: boolean,
  lazyFileConfig: LazyFileConfig
) {
  var lazyArray = new LazyUint8Array(lazyFileConfig);
  var properties = { isDevice: false, contents: lazyArray };

  var node = FS.createFile(parent, name, properties, canRead, canWrite);
  node.contents = lazyArray;
  // Add a function that defers querying the file size until it is asked the first time.
  Object.defineProperties(node, {
    usedBytes: {
      get: /** @this {FSNode} */ function () {
        return this.contents.length;
      },
    },
  });
  // override each stream op with one that tries to force load the lazy file first
  var stream_ops: any = {};
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
    stream: { node: { contents: LazyUint8Array } },
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number
  ) {
    FS.forceLoadFile(node);

    const contents = stream.node.contents;

    return contents.copyInto(buffer, offset, length, position);
  };
  node.stream_ops = stream_ops;
  return node;
}
