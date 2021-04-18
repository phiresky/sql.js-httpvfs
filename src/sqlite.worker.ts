/// <reference path="./types.d.ts" />

import * as Comlink from "comlink";
import initSqlJs from "../sql.js/dist/sql-wasm.js";
import wasmUrl from "../sql.js/dist/sql-wasm.wasm";
import { createLazyFile, RangeMapper } from "./lazyFile";
import { Database, QueryExecResult } from "sql.js";
import { SeriesVtab, sqlite3_module, SqljsEmscriptenModuleType } from "./vtab";

wasmUrl;


// https://gist.github.com/frankier/4bbc85f65ad3311ca5134fbc744db711
function initTransferHandlers(sql: typeof import("sql.js")) {
  Comlink.transferHandlers.set("WORKERSQLPROXIES", {
    canHandle: (obj): obj is unknown => {
      let isDB = obj instanceof sql.Database;
      let hasDB = obj && (obj as any).db && (obj as any).db instanceof sql.Database; // prepared statements
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
  const r = res[0];
  if (!r) return [];
  return r.values.map((v) => {
    const o: any = {};
    for (let i = 0; i < r.columns.length; i++) {
      o[r.columns[i]] = v[i];
    }
    return o as T;
  });
}


export type SplitFileConfig = {
  lastUpdated: number;
  urlPrefix: string;
  serverChunkSize: number;
  databaseLengthBytes: number;
  requestChunkSize: number;
};
export interface LazyHttpDatabase extends Database {
  lazyFile: any
  filename: string
  query: <T = any>(query: string, ...params: any[]) => T[]
  create_vtab: (cons: {new(sqljs: SqljsEmscriptenModuleType, db: Database): sqlite3_module}) => void
}
const mod = {
  db: null as null | LazyHttpDatabase,
  sqljs: null as null | Promise<any>,
  async SplitFileHttpDatabase(wasmUrl: string, p: SplitFileConfig): Promise<Database> {
    if (this.db) throw Error(`sorry, only one db is supported right now`);
    if (!this.sqljs) {
      this.sqljs = init(wasmUrl);
    }
    const sql = await this.sqljs;
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
    this.db!.lazyFile = lazyFile;
    this.db!.create_vtab(SeriesVtab);
    this.db!.query = (...args) => toObjects(this.db!.exec(...args));

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
  async evalCode(code: string) {
    return await eval(`(async function (db) {
      ${code}
    })`)(this.db);
  }
};
export type SqliteComlinkMod = typeof mod;
Comlink.expose(mod);
