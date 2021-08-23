/// <reference lib="webworker" />
import { Database } from "sql.js";
/*
 * This file implements the virtual table that makes interacting with the DOM as a virtual SQLite table possible.
 * It is not required at all for the httpvfs functionality.
 *
 * don't look at it
 *
 *
 *
 *
 *
 *
 * plz
 *
 *
 *
 * if this is ever to be used for a purpose other than to make people say 'wat'
 * it needs to be rewritten
 *
 */

// these types are just to make it easier to understand
type Ptr<T> = number;
type int = number;
interface sqlite3_vtab {
  pModule: Ptr<sqlite3_module>;
  nRef: int;
  zErrMsg: Ptr<string>;
}
type SqliteStatus = int;

interface sqlite3_index_info {}
interface sqlite3_vtab_cursor {
  pVtab: Ptr<sqlite3_vtab>;
}
interface sqlite3_context {}
interface sqlite3_value {}
export interface sqlite3_module {
  iVersion: int;
  xCreate?(
    conn: Ptr<"sqliteconn">,
    pAux: Ptr<void>,
    argc: int,
    argv: Ptr<string[]>,
    ppVTab: Ptr<sqlite3_vtab>,
    pzErr: Ptr<string>
  ): SqliteStatus;
  xConnect(
    conn: Ptr<"sqliteconn">,
    pAux: Ptr<void>,
    argc: int,
    argv: Ptr<string[]>,
    ppVTab: Ptr<sqlite3_vtab[]>,
    pzErr: Ptr<string[]>
  ): SqliteStatus;
  xBestIndex(
    pVTab: Ptr<sqlite3_vtab>,
    sqlite3_index_info: Ptr<sqlite3_index_info>
  ): SqliteStatus;
  xDisconnect(pVTab: Ptr<sqlite3_vtab>): SqliteStatus;
  xDestroy?(pVTab: Ptr<sqlite3_vtab>): SqliteStatus;
  xOpen(
    pVTab: Ptr<sqlite3_vtab>,
    ppCursor: Ptr<sqlite3_vtab_cursor>
  ): SqliteStatus;
  xClose(sqlite3_vtab_cursor: Ptr<sqlite3_vtab_cursor>): SqliteStatus;
  xFilter(
    sqlite3_vtab_cursor: Ptr<sqlite3_vtab_cursor>,
    idxNum: int,
    idxStr: Ptr<string>,
    argc: int,
    argv: Ptr<sqlite3_value[]>
  ): SqliteStatus;
  xNext(sqlite3_vtab_cursor: Ptr<sqlite3_vtab_cursor>): SqliteStatus;
  xEof(sqlite3_vtab_cursor: Ptr<sqlite3_vtab_cursor>): SqliteStatus;
  xColumn(
    sqlite3_vtab_cursor: Ptr<sqlite3_vtab_cursor>,
    sqlite3_context: Ptr<sqlite3_context[]>,
    int: int
  ): SqliteStatus;
  xRowid(
    sqlite3_vtab_cursor: Ptr<sqlite3_vtab_cursor>,
    pRowid: Ptr<int>
  ): SqliteStatus;
  xUpdate?(
    vtab: Ptr<sqlite3_vtab>,
    argc: int,
    argv: Ptr<sqlite3_value[]>,
    pRowid: Ptr<int>
  ): SqliteStatus;
  xBegin?(pVTab: Ptr<sqlite3_vtab>): SqliteStatus;
  xSync?(pVTab: Ptr<sqlite3_vtab>): SqliteStatus;
  xCommit?(pVTab: Ptr<sqlite3_vtab>): SqliteStatus;
  xRollback?(pVTab: Ptr<sqlite3_vtab>): SqliteStatus;
  xFindFunction?(
    pVtab: Ptr<sqlite3_vtab>,
    nArg: int,
    zName: Ptr<string>,
    pxFunc: Ptr<
      (
        sqlite3_context: Ptr<sqlite3_context[]>,
        argc: int,
        argv: Ptr<sqlite3_value[]>
      ) => void
    >,
    ppArg: Ptr<void>
  ): SqliteStatus;

  xRename?(pVtab: Ptr<sqlite3_vtab>, zNew: Ptr<string>): SqliteStatus;
  xSavepoint?(pVTab: Ptr<sqlite3_vtab>, int: int): SqliteStatus;
  xRelease?(pVTab: Ptr<sqlite3_vtab>, int: int): SqliteStatus;
  xRollbackTo?(pVTab: Ptr<sqlite3_vtab>, int: int): SqliteStatus;
  xShadowName?(str: Ptr<string>): SqliteStatus;
}
/*const seriesVfs: sqlite3_module = {
  iVersion: 0,
  xConnect()
}
*/

const SQLITE_OK = 0;
const SQLITE_MISUSE = 21;

// see exported_runtime_methods.json
export interface SqljsEmscriptenModuleType extends EmscriptenModule {
  ccall: typeof ccall;
  setValue: typeof setValue;
  getValue: typeof getValue;
  UTF8ToString: typeof UTF8ToString;
  stringToUTF8: typeof stringToUTF8;
  lengthBytesUTF8: typeof lengthBytesUTF8;
  addFunction: typeof addFunction;
  extract_value: (ptr: Ptr<sqlite3_value>) => null | string | number;
  set_return_value: (
    ptr: Ptr<sqlite3_context>,
    value: string | number | boolean | null
  ) => void;
  sqlite3_malloc: (size: int) => Ptr<void>,
}

type Cursor = {
  elements: ArrayLike<Element>;
  querySelector: string;
  index: number;
};
enum Columns {
  idx,
  id,
  tagName,
  textContent,
  innerHTML,
  outerHTML,
  className,
  parent,
  selector,
  querySelector,
}
const columnNames = Object.keys(Columns)
  .map((key) => Columns[key as any])
  .filter((value) => typeof value === "string");
export interface DomRow {
  idx: number;
  id: string | null;
  tagName: string;
  textContent: string;
  innerHTML: string;
  outerHTML: string;
  className: string | null;
  parent: string | null;
  selector: string;
}
function rowToObject(row: any[]): DomRow {
  const out: any = {};
  for (let i = 0; i < row.length; i++) {
    out[Columns[i]] = row[i];
  }
  return out;
}
export type MainThreadRequest =
  | { type: "select"; selector: string; columns: (keyof DomRow)[] }
  | { type: "delete"; selector: string }
  | { type: "update"; value: Partial<DomRow> }
  | { type: "insert"; value: Partial<DomRow> };
// sends a request to the main thread via postMessage,
// then synchronously waits for the result via a SharedArrayBuffer
function doAsyncRequestToMainThread(request: MainThreadRequest) {
  // todo: dynamically adjust this for response size
  const sab = new SharedArrayBuffer(1024 * 1024);
  // first element is for atomic synchronisation, second element is the length of the response
  const metaArray = new Int32Array(sab, 0, 2);
  metaArray[0] = 1;
  // send message to main thread
  (self as DedicatedWorkerGlobalScope).postMessage({
    action: "eval",
    notify: sab,
    request,
  });
  Atomics.wait(metaArray, 0, 1); // wait until first element is not =1
  const dataLength = metaArray[1];
  // needs to be copied because textdecoder and encoder is not supported on sharedarraybuffers (for now)
  const dataArray = new Uint8Array(sab, 2 * 4, dataLength).slice();
  const resStr = new TextDecoder().decode(dataArray);
  const res: { err: string } | { ok: any } = JSON.parse(resStr);
  if ("err" in res) throw new Error(res.err);
  return res.ok;
}
export class SeriesVtab implements sqlite3_module {
  name = "dom";
  iVersion: number = 2;
  cursors = new Map<number, Cursor>();
  constructor(private module: SqljsEmscriptenModuleType, private db: Database) {
    console.log("constructed vfs");
  }
  getCursor(cursor: Ptr<sqlite3_vtab_cursor>): Cursor {
    const cursorObj = this.cursors.get(cursor);
    if (!cursorObj) throw Error("impl error");
    return cursorObj;
  }
  xConnect(
    conn: Ptr<"sqliteconn">,
    pAux: Ptr<void>,
    argc: int,
    argv: Ptr<string[]>,
    ppVTab: Ptr<Ptr<sqlite3_vtab>>,
    pzErr: Ptr<string[]>
  ): SqliteStatus {
    console.log("xconnect!!");

    const rc = (this.db.handleError as any)(
      this.module.ccall(
        "sqlite3_declare_vtab",
        "number",
        ["number", "string"],
        [
          conn,
          `create table x(
              ${columnNames.slice(0, -1).join(", ")} PRIMARY KEY
          ) WITHOUT ROWID`,
        ]
      )
    );
    const out_ptr = this.module._malloc(12);
    this.module.setValue(ppVTab, out_ptr, "*");
    return SQLITE_OK;
  }

  xDisconnect(pVTab: Ptr<sqlite3_vtab>): SqliteStatus {
    this.module._free(pVTab);
    return SQLITE_OK;
  }
  xOpen(
    pVTab: Ptr<sqlite3_vtab>,
    ppCursor: Ptr<Ptr<sqlite3_vtab_cursor>>
  ): SqliteStatus {
    const cursor = this.module._malloc(4);
    // this.module.setValue(series_cursor + 4, cursorId, "i32");
    this.cursors.set(cursor, { elements: [], index: 0, querySelector: "" });
    this.module.setValue(ppCursor, cursor, "*");
    return SQLITE_OK;
  }
  xClose(sqlite3_vtab_cursor: Ptr<sqlite3_vtab_cursor>): SqliteStatus {
    this.module._free(sqlite3_vtab_cursor);
    return SQLITE_OK;
  }
  /*setErrorMessage(cursorPtr: Ptr<sqlite3_vtab_cursor>) {
    const vtabPointer: Ptr<sqlite3_vtab> = this.module.getValue(cursorPtr, "i32");
    const before = this.module.getValue(vtabPointer + 8, "i32");
    console.log("err before", before);
    this.module.setValue(vtabPointer + 8, intArrayFromString("FLONKITAL"), "i32");
  }*/
  xBestIndex(
    pVTab: Ptr<sqlite3_vtab>,
    info: Ptr<sqlite3_index_info>
  ): SqliteStatus {
    try {
      const nConstraint = this.module.getValue(info + 0, "i32");
      const aConstraint = this.module.getValue(info + 4, "i32");

      // const constraint = this.module.getValue(aConstraint, "i32");
      // don't care
      const SQLITE_INDEX_CONSTRAINT_MATCH = 64;
      let haveSelectorMatchConstraint = false;
      for (let i = 0; i < nConstraint; i++) {
        const sizeofconstraint = 12;
        const curConstraint = aConstraint + i * sizeofconstraint;
        const iColumn = this.module.getValue(curConstraint, "i32");
        const op = this.module.getValue(curConstraint + 4, "i8");
        const usable = this.module.getValue(curConstraint + 5, "i8");
        if (!usable) continue;
        if (op === SQLITE_INDEX_CONSTRAINT_MATCH) {
          if (iColumn === Columns.selector) {
            // this is the one
            haveSelectorMatchConstraint = true;
            const aConstraintUsage = this.module.getValue(info + 4 * 4, "i32");
            const sizeofconstraintusage = 8;
            this.module.setValue(
              aConstraintUsage + i * sizeofconstraintusage,
              1,
              "i32"
            );
          } else {
            throw Error(`The match operator can only be applied to the selector column!`);
          }
        }
        console.log(`constraint ${i}: ${Columns[iColumn]} (op=${op})`);
      }

      if (!haveSelectorMatchConstraint) {
        throw Error(
          "You must query the dom using `select ... from dom where selector MATCH <css-selector>`"
        );
      }

      // const aConstraintUsage0 = this.module.getValue(aConstraintUsageArr, "i32");

      const usedColumnsFlag = this.module.getValue(info + 16 * 4, "i32");
      this.module.setValue(info + 5 * 4, usedColumnsFlag, "i32"); // just save the used columns instead of an index id
      return SQLITE_OK;
    } catch (e) {
      console.error("xbestindex", e);
      this.setVtabError(pVTab, String(e));
      return SQLITE_MISUSE;
    }
  }
  xFilter(
    cursorPtr: Ptr<sqlite3_vtab_cursor>,
    idxNum: int,
    idxStr: Ptr<string>,
    argc: int,
    argv: Ptr<sqlite3_value[]>
  ): SqliteStatus {
    console.log("xfilter", argc);
    if (argc !== 1) {
      console.error("did not get a single argument to xFilter");
      return SQLITE_MISUSE;
    }
    const querySelector = this.module.extract_value(argv + 0) as string;
    const cursor = this.getCursor(cursorPtr);
    // await new Promise(e => setTimeout(e, 1000));
    cursor.querySelector = querySelector;
    const usedColumnsFlag = idxNum;
    const usedColumns = columnNames.filter(
      (c) => usedColumnsFlag & (1 << (Columns as any)[c])
    ) as (keyof DomRow)[];
    console.log("used columns", usedColumns);
    cursor.elements = doAsyncRequestToMainThread({
      type: "select",
      selector: querySelector,
      columns: usedColumns,
    }); // document.querySelectorAll(str);
    // don't filter anything
    return SQLITE_OK;
  }
  xNext(cursorPtr: Ptr<sqlite3_vtab_cursor>): SqliteStatus {
    const cursor = this.getCursor(cursorPtr);
    cursor.index++;
    return SQLITE_OK;
  }
  xEof(cursorPtr: Ptr<sqlite3_vtab_cursor>): SqliteStatus {
    const cursor = this.getCursor(cursorPtr);
    return +(cursor.index >= cursor.elements.length);
  }
  xColumn(
    cursorPtr: Ptr<sqlite3_vtab_cursor>,
    ctx: Ptr<sqlite3_context[]>,
    column: int
  ): SqliteStatus {
    const cursor = this.getCursor(cursorPtr);
    const ele = cursor.elements[cursor.index];
    if (Columns[column] in ele) {
      this.module.set_return_value(ctx, (ele as any)[Columns[column]]);
    } else {
      switch (column) {
        case Columns.idx: {
          this.module.set_return_value(ctx, cursor.index);
          break;
        }
        case Columns.querySelector: {
          this.module.set_return_value(ctx, cursor.querySelector);
          break;
        }
        default: {
          throw Error(`unknown column ${Columns[column]}`);
        }
      }
    }
    return SQLITE_OK;
  }
  setVtabError(vtab: Ptr<sqlite3_vtab>, err: string) {
    const len = this.module.lengthBytesUTF8(err) + 1;
    const ptr = this.module.sqlite3_malloc(len);
    console.log("writing error", err, len);
    this.module.stringToUTF8(err, ptr, len);
    this.module.setValue(vtab + 8, ptr, "i32");
  }
  xUpdate(
    vtab: Ptr<sqlite3_vtab>,
    argc: int,
    argv: Ptr<sqlite3_value[]>,
    pRowid: Ptr<int>
  ): SqliteStatus {
    try {
      // https://www.sqlite.org/vtab.html#xupdate
      const [oldPrimaryKey, newPrimaryKey, ...args] = Array.from(
        { length: argc },
        (_, i) => this.module.extract_value(argv + 4 * i)
      );
      if (!oldPrimaryKey) {
        console.assert(newPrimaryKey === null);
        // INSERT
        doAsyncRequestToMainThread({
          type: "insert",
          value: rowToObject(args),
        });
      } else if (oldPrimaryKey && !newPrimaryKey) {
        console.log("DELETE", oldPrimaryKey);
        doAsyncRequestToMainThread({
          type: "delete",
          selector: oldPrimaryKey as string,
        });
        // DELETE
      } else {
        // UPDATE
        if (oldPrimaryKey !== newPrimaryKey) {
          throw "The selector row can't be set";
        }
        doAsyncRequestToMainThread({
          type: "update",
          value: rowToObject(args),
        });
      }

      return SQLITE_OK;
    } catch (e) {
      this.setVtabError(vtab, String(e));
      return SQLITE_MISUSE;
    }
  }

  xRowid(
    sqlite3_vtab_cursor: Ptr<sqlite3_vtab_cursor>,
    pRowid: Ptr<int>
  ): SqliteStatus {
    throw Error("xRowid not implemented");
  }

  xFindFunction(
    pVtab: Ptr<sqlite3_vtab>,
    nArg: int,
    zName: Ptr<string>,
    pxFunc: Ptr<
      (
        sqlite3_context: Ptr<sqlite3_context>,
        argc: int,
        argv: Ptr<sqlite3_value[]>
      ) => void
    >,
    ppArg: Ptr<void>
  ): SqliteStatus {
    const name = this.module.UTF8ToString(zName);
    if (name !== "match") {
      return SQLITE_OK;
    }
    const SQLITE_INDEX_CONSTRAINT_FUNCTION = 150;
    this.module.setValue(
      pxFunc,
      this.module.addFunction(
        (ctx: Ptr<sqlite3_context>, argc: int, argv: Ptr<sqlite3_value[]>) => {
          // always return true since we apply this filter in the xFilter function
          this.module.set_return_value(ctx, true);
        },
        "viii"
      ),
      "i32"
    );
    return SQLITE_INDEX_CONSTRAINT_FUNCTION;
  }
}
