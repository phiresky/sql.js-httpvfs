import * as Comlink from "comlink";
import SqliteWorker, { SplitFileConfig } from "./sqlite.worker";

import { chooseSegments, DBSegment } from "./util";
import { SqliteMod } from "./sqlite.worker.js";
import { Database, QueryExecResult } from "sql.js";
import { DomRow, MainThreadRequest } from "./vtab";

Comlink.transferHandlers.set("WORKERSQLPROXIES", {
  canHandle: (obj) => false,
  serialize(obj) {
    throw Error("no");
  },
  deserialize: (port: MessagePort) => {
    port.start();
    return Comlink.wrap(port);
  },
});
export type SqliteWorker = Comlink.Remote<SqliteMod>;
interface  DatabaseOutput extends Database {
  worker: Comlink.Remote<SqliteMod>
}
export async function createDbWorker(databaseConfigUrl: string) {
  const worker: Worker = new SqliteWorker();
  const sqlite = Comlink.wrap<SqliteMod>(worker);

  const configUrl = new URL(databaseConfigUrl, location.href);
  const config: SplitFileConfig = await fetch(configUrl.toString()).then((e) =>
    e.json()
  );
  const db = await sqlite.SplitFileHttpDatabase({
    ...config,
    urlPrefix: new URL(config.urlPrefix, configUrl).toString(),
  });
  db.worker = sqlite;
  const pageSizeResp = await db.exec("pragma page_size");
  const pageSize = pageSizeResp[0].values[0][0];
  if (pageSize !== config.requestChunkSize)
    console.warn(
      `Chunk size does not match page size: pragma page_size = ${pageSize} but chunkSize = ${config.requestChunkSize}`
    );

  worker.addEventListener("message", async (ev) => {
    if (ev.data && ev.data.action === "eval") {
      const metaArray = new Int32Array(ev.data.notify, 0, 2);
      const dataArray = new Uint8Array(ev.data.notify, 2 * 4);
      let response;
      try {
        response = { ok: await handleRequest(ev.data.request) };
      } catch (e) {
        console.error("worker request error", ev.data.request, e);
        response = { err: String(e) };
      }
      const text = new TextEncoder().encode(JSON.stringify(response));
      dataArray.set(text, 0); // need to copy here because:
      // sadly TextEncoder.encodeInto: Argument 2 can't be a SharedArrayBuffer or an ArrayBufferView backed by a SharedArrayBuffer [AllowShared]
      // otherwise this would be better:
      /*const encodeRes = new TextEncoder().encodeInto(response, data);
      if (encodeRes.read !== response.length) {
        console.log(encodeRes, response.length)
        throw Error(`not enough space for response: ${response.length} > ${data.byteLength}`);
      }*/
      metaArray[1] = text.length;
      Atomics.notify(metaArray, 0);
    }
  });
  return { config, worker: sqlite, db };
}
function getUniqueSelector(elm: Element) {
  if (elm.tagName === "BODY") return "body";
  const names = [];
  while (elm.parentElement && elm.tagName !== "BODY") {
    if (elm.id) {
      // assume id is unique (which it isn't)
      names.unshift("#" + elm.id);
      break;
    } else {
      let c = 1;
      let e = elm;
      while (e.previousElementSibling) {
        e = e.previousElementSibling;
        c++;
      }
      names.unshift(elm.tagName.toLowerCase() + ":nth-child(" + c + ")");
    }
    elm = elm.parentElement;
  }
  return names.join(" > ");
}

function keys<T>(o: T): (keyof T)[] {
  return Object.keys(o) as (keyof T)[];
}
async function handleRequest(req: MainThreadRequest) {
  console.log("dom vtable request", req);
  if (req.type === "select") {
    return [...document.querySelectorAll(req.selector)].map((e) => {
      const out: Partial<DomRow> = {};
      for (const column of req.columns) {
        if (column === "selector") {
          out.selector = getUniqueSelector(e);
        } else if (column === "parent") {
          out.parent = getUniqueSelector(e.parentElement);
        } else {
          out[column] = e[column];
        }
      }
      return out;
    });
  } else if (req.type === "insert") {
    if (!req.value.parent)
      throw Error(`"parent" column must be set when inserting`);
    const target = document.querySelectorAll(req.value.parent);
    if (target.length === 0)
      throw Error(`Parent element ${req.value.parent} could not be found`);
    if (target.length > 1)
      throw Error(
        `Parent element ${req.value.parent} ambiguous (${target.length} results)`
      );
    const parent = target[0];
    if (!req.value.tagName) throw Error(`tagName must be set for inserting`);
    const ele = document.createElement(req.value.tagName);
    const cantSet = ["idx"];
    for (const i of keys(req.value)) {
      if (req.value[i] !== null) {
        if (i === "tagName" || i === "parent") continue;
        if (i === "idx" || i === "selector") throw Error(`${i} can't be set`);

        ele[i] = req.value[i] as any;
      }
    }
    parent.appendChild(ele);
  } else if (req.type === "update") {
    const targetElement = document.querySelector(req.value.selector!);
    if (!targetElement) throw Error(`Element ${req.value.selector} not found!`);
    const toSet: (
      | "innerHTML"
      | "id"
      | "textContent"
      | "innerHTML"
      | "outerHTML"
      | "className"
    )[] = [];
    for (const k of keys(req.value)) {
      const v = req.value[k];
      if (k === "parent") {
        if (v !== getUniqueSelector(targetElement.parentElement!)) {
          const targetParent = document.querySelectorAll(v);
          if (targetParent.length !== 1)
            throw Error(
              `Invalid target parent: found ${targetParent.length} matches`
            );
          targetParent[0].appendChild(targetElement);
        }
        continue;
      }
      if (k === "idx" || k === "selector") continue;
      if (v !== targetElement[k]) {
        console.log("SETTING ", k, targetElement[k], "->", v);
        if (k === "tagName") throw Error("can't change tagName");
        toSet.push(k); // defer setting to prevent setting multiple interdependent values (e.g. textContent and innerHTML)
      }
    }
    for (const k of toSet) {
      targetElement[k] = req.value[k];
    }
  }
}
