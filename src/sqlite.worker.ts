import * as Comlink from "comlink";
import wasmfile from "../sql.js/dist/sql-wasm.wasm";
import initSqlJs from "../sql.js/dist/sql-wasm.js";
import { createLazyFile, RangeMapper } from "./lazyFile";
import { getSyntheticTrailingComments } from "typescript";
import { Database } from "sql.js";

// https://gist.github.com/frankier/4bbc85f65ad3311ca5134fbc744db711
function initTransferHandlers(sql: typeof import("sql.js")) {
  Comlink.transferHandlers.set("WORKERSQLPROXIES", {
    canHandle: (obj): obj is unknown => {
      let isDB = obj instanceof sql.Database;
      let hasDB = obj.db && obj.db instanceof sql.Database; // prepared statements
      return isDB || hasDB;
    },
    serialize(obj) {
      const { port1, port2 } = new MessageChannel();
      Comlink.expose(obj, port1);
      return [port2, [port2]];
    },
    deserialize: (port: MessagePort) => {
      port.start();
      return Comlink.wrap(port);
    },
  });
}

async function init() {
  const sql = await initSqlJs({
    locateFile: (_file: string) => wasmfile,
  });
  initTransferHandlers(sql);
  return sql;
}
const sqljs = init();
export type SplitFileConfig = {
  lastUpdated: number;
  urlPrefix: string;
  serverChunkSize: number;
  databaseLengthBytes: number;
  requestChunkSize: number;
};
const mod = {
  db: null as null | Database,
  async SplitFileHttpDatabase(p: SplitFileConfig): Promise<Database> {
    const sql = await sqljs;
    console.log("constructing url database");
    const rangeMapper: RangeMapper = (from: number, to: number) => {
      const serverChunkId = (from / p.serverChunkSize) | 0;
      const serverFrom = from % p.serverChunkSize;
      const serverTo = serverFrom + (to - from);
      return {
        url: p.urlPrefix + String(serverChunkId).padStart(3, "0"),
        fromByte: serverFrom,
        toByte: serverTo,
      };
    };

    const filename = p.urlPrefix.replace(/\//g, "_");
    console.log("filename", filename);
    const lazyFile = createLazyFile(sql.FS, "/", filename, true, true, {
      rangeMapper,
      requestChunkSize: p.requestChunkSize,
      fileLength: p.databaseLengthBytes,
    });

    this.db = new sql.CustomDatabase(filename);
    (this.db as any).lazyFile = lazyFile;

    return this.db!;
  },
  async getStats() {
    const db = this.db;
    if (!db) return null;
    return {
      filename: db.filename,
      totalBytes: db.lazyFile.contents.length,
      totalFetchedBytes: db.lazyFile.contents.totalFetchedBytes,
      totalRequests: db.lazyFile.contents.totalRequests,
    };
  },
};
export type SqliteMod = typeof mod;
Comlink.expose(mod);
