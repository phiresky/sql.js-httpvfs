/// <reference path="./types.d.ts" />

import * as Comlink from "comlink";
import { Database, QueryExecResult } from "sql.js";
import initSqlJs from "../sql.js/dist/sql-wasm.js";
import wasmUrl from "../sql.js/dist/sql-wasm.wasm";
import { createLazyFile, LazyUint8Array, PageReadLog, RangeMapper } from "./lazyFile";
import { SeriesVtab, sqlite3_module, SqljsEmscriptenModuleType } from "./vtab";

wasmUrl;

// https://gist.github.com/frankier/4bbc85f65ad3311ca5134fbc744db711
function initTransferHandlers(sql: typeof import("sql.js")) {
  Comlink.transferHandlers.set("WORKERSQLPROXIES", {
    canHandle: (obj): obj is unknown => {
      let isDB = obj instanceof sql.Database;
      let hasDB =
        obj && (obj as any).db && (obj as any).db instanceof sql.Database; // prepared statements
      return isDB || hasDB;
    },
    serialize(obj) {
      const { port1, port2 } = new MessageChannel();
      Comlink.expose(obj, port1);
      return [port2, [port2]];
    },
    deserialize: (port: MessagePort) => {},
  });
}

async function init(wasmfile: string) {
  const sql = await initSqlJs({
    locateFile: (_file: string) => wasmfile,
  });
  initTransferHandlers(sql);
  return sql;
}

export function toObjects<T>(res: QueryExecResult[]): T[] {
  return res.flatMap(r => r.values.map((v) => {
    const o: any = {};
    for (let i = 0; i < r.columns.length; i++) {
      o[r.columns[i]] = v[i];
    }
    return o as T;
  }));
}

export type SplitFileConfig =
  | SplitFileConfigPure
  | {
      virtualFilename?: string;
      from: "jsonconfig";
      configUrl: string;
    };
export type SplitFileConfigPure = {
  virtualFilename?: string;
  from: "inline";
  config: SplitFileConfigInner;
};
export type SplitFileConfigInner = {
  requestChunkSize: number;
  cacheBust?: string;
} & (
  | {
      serverMode: "chunked";
      urlPrefix: string;
      serverChunkSize: number;
      databaseLengthBytes: number;
      suffixLength: number;
    }
  | {
      serverMode: "full";
      url: string;
      headUrl?: string;
    }
);
export interface LazyHttpDatabase extends Database {
  lazyFiles: Map<string, { contents: LazyUint8Array }>;
  filename: string;
  query: <T = any>(query: string, ...params: any[]) => T[];
  create_vtab: (cons: {
    new (sqljs: SqljsEmscriptenModuleType, db: Database): sqlite3_module;
  }) => void;
}
export type SqliteStats = {
  filename: string;
  totalBytes: number;
  totalFetchedBytes: number;
  totalRequests: number;
};

async function fetchConfigs(
  configsOrUrls: SplitFileConfig[]
): Promise<SplitFileConfigPure[]> {
  const configs = configsOrUrls.map(async (config) => {
    if (config.from === "jsonconfig") {
      const configUrl = new URL(config.configUrl, location.href);
      const req = await fetch(configUrl.toString());

      if (!req.ok) {
        console.error("httpvfs config error", await req.text());
        throw Error(
          `Could not load httpvfs config: ${req.status}: ${req.statusText}`
        );
      }
      const configOut: SplitFileConfigInner = await req.json();
      return {
        from: "inline",
        // resolve url relative to config file
        config:
          configOut.serverMode === "chunked"
            ? {
                ...configOut,
                urlPrefix: new URL(configOut.urlPrefix, configUrl).toString(),
              }
            : {
                ...configOut,
                url: new URL(configOut.url, configUrl).toString(),
                headUrl: configOut.headUrl ? new URL(configOut.headUrl, configUrl).toString() : new URL(configOut.url, configUrl).toString(),
              },
        virtualFilename: config.virtualFilename,
      } as SplitFileConfigPure;
    } else {
      return config;
    }
  });
  return Promise.all(configs);
}
const mod = {
  db: null as null | LazyHttpDatabase,
  inited: false,
  sqljs: null as null | Promise<any>,
  bytesRead: 0,
  async SplitFileHttpDatabase(
    wasmUrl: string,
    configs: SplitFileConfig[],
    mainVirtualFilename?: string,
    maxBytesToRead: number = Infinity,
  ): Promise<LazyHttpDatabase> {
    if (this.inited) throw Error(`sorry, only one db is supported right now`);
    this.inited = true;
    if (!this.sqljs) {
      this.sqljs = init(wasmUrl);
    }
    const sql = await this.sqljs;

    this.bytesRead = 0;
    let requestLimiter = (bytes: number) => {
      if (this.bytesRead + bytes > maxBytesToRead) {
        this.bytesRead = 0;
        // I couldn't figure out how to get ERRNO_CODES included
        // so just hardcode the actual value
        // https://github.com/emscripten-core/emscripten/blob/565fb3651ed185078df1a13b8edbcb6b2192f29e/system/include/wasi/api.h#L146
        // https://github.com/emscripten-core/emscripten/blob/565fb3651ed185078df1a13b8edbcb6b2192f29e/system/lib/libc/musl/arch/emscripten/bits/errno.h#L13
        throw new sql.FS.ErrnoError(6 /* EAGAIN */);
      }
      this.bytesRead += bytes;
    };

    const lazyFiles = new Map();
    const hydratedConfigs = await fetchConfigs(configs);
    let mainFileConfig;
    for (const { config, virtualFilename } of hydratedConfigs) {
      const id =
        config.serverMode === "chunked" ? config.urlPrefix : config.url;
      console.log("constructing url database", id);
      let rangeMapper: RangeMapper;
      let suffix = config.cacheBust ? "?cb=" + config.cacheBust : "";
      if (config.serverMode == "chunked") {
        rangeMapper = (from: number, to: number) => {
          const serverChunkId = (from / config.serverChunkSize) | 0;
          const serverFrom = from % config.serverChunkSize;
          const serverTo = serverFrom + (to - from);
          return {
            url: config.urlPrefix + String(serverChunkId).padStart(config.suffixLength, "0") + suffix,
            headUrl: config.headUrl ?? config.urlPrefix + String(serverChunkId).padStart(config.suffixLength, "0") + suffix,
            fromByte: serverFrom,
            toByte: serverTo,
          };
        };
      } else {
        rangeMapper = (fromByte, toByte) => ({
          url: config.url + suffix,
          headUrl: config.headUrl ? config.headUrl + suffix : config.url + suffix,
          fromByte,
          toByte,
        });
      }

      const filename = virtualFilename || id.replace(/\//g, "_");

      if (!mainVirtualFilename) {
        mainVirtualFilename = filename;
        mainFileConfig = config
      }

      console.log("constructing url database", id, "filename", filename);
      const lazyFile = createLazyFile(sql.FS, "/", filename, true, true, {
        rangeMapper,
        requestChunkSize: config.requestChunkSize,
        fileLength:
          config.serverMode === "chunked"
            ? config.databaseLengthBytes
            : undefined,
        logPageReads: true,
        maxReadHeads: 3,
        requestLimiter
      });
      lazyFiles.set(filename, lazyFile);
    }

    this.db = new sql.CustomDatabase(mainVirtualFilename) as LazyHttpDatabase;
    if (mainFileConfig) {
      // verify page size and disable cache (since we hold everything in memory anyways)
      const pageSizeResp = await this.db.exec("pragma page_size; pragma cache_size=0");
      const pageSize = pageSizeResp[0].values[0][0];
      if (pageSize !== mainFileConfig.requestChunkSize)
        console.warn(
          `Chunk size does not match page size: pragma page_size = ${pageSize} but chunkSize = ${mainFileConfig.requestChunkSize}`
        );
    }

    this.db.lazyFiles = lazyFiles;
    this.db.create_vtab(SeriesVtab);
    this.db.query = (...args) => toObjects(this.db!.exec(...args));
    return this.db!;
  },
  getResetAccessedPages(virtualFilename?: string): PageReadLog[] {
    if (!this.db) return [];
    const lazyFile = this.db.lazyFiles.get(virtualFilename || this.db.filename);
    if (!lazyFile) throw Error("unknown lazy file");
    const pages = [...lazyFile.contents.readPages];
    lazyFile.contents.readPages = [];
    return pages;
  },
  getStats(virtualFilename?: string): SqliteStats | null {
    const db = this.db;
    if (!db) return null;
    const lazyFile = db.lazyFiles.get(virtualFilename || db.filename);
    if (!lazyFile) throw Error("unknown lazy file");
    const res = {
      filename: db.filename,
      totalBytes: lazyFile.contents.length,
      totalFetchedBytes: lazyFile.contents.totalFetchedBytes,
      totalRequests: lazyFile.contents.totalRequests,
    };
    return res;
  },
  async evalCode(code: string) {
    return await eval(`(async function (db) {
      ${code}
    })`)(this.db);
  },
};
export type SqliteComlinkMod = typeof mod;
Comlink.expose(mod);
