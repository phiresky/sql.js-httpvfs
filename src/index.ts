import initSqlJs from "../sql.js/dist/sql-wasm-debug.js";
import wasmfile from "../sql.js/dist/sql-wasm-debug.wasm";
import * as Comlink from "comlink";
import SqliteWorker from "./sqlite.worker";

import { chooseSegments, DBSegment } from "./util";
import { SqliteMod } from "./sqlite.worker.js";
import { Database, QueryExecResult } from "sql.js";

Comlink.transferHandlers.set("WORKERSQLPROXIES", {
  canHandle: (obj) => false,
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
const sqlite = Comlink.wrap<SqliteMod>(new SqliteWorker());

async function testLoop(metaDb: Database) {
  const uploader = "Adam Ragusea";

  const videos = await metaDb.prepare(
    "select * from videoData where author = ? limit 20"
  );
  await videos.bind2([uploader]);
  // const res = await videos.bind([uploader]);
  // console.log("bind res", res);
  while (await videos.step()) {
    console.log("got", await videos.get());
  }
  return;
}
async function go() {
  /*const sqlite = await initSqlJs({
    locateFile: () => wasmfile
  });*/
  Object.assign(window, { s: sqlite });
  // console.log("register return", sqlite.register_httpvfs());
  //const db = new sqlite.VfsDatabase("testfile", "httpvfs");
  // const db = new sqlite.UrlDatabase("http://localhost/test.sqlite3");
  // const sponsorblockDb = await sqlite.new("sponsorTimes.sqlite3");

  const chunkSize = 1024;
  const metaDb = await sqlite.new("youtube-metadata-pg1024-aligned-st-sma.sqlite3", chunkSize);
  const pageSizeResp = await metaDb.exec("pragma page_size");
  const pageSize = pageSizeResp[0].values[0][0];
  if (pageSize !== chunkSize)
    console.warn(
      `Chunk size does not match page size: pragma page_size = ${pageSize} but chunkSize = ${chunkSize}`
    );

  await getForVideos(metaDb, "Adam Ragusea");
}

function toObjects<T>(res: QueryExecResult[]): T[] {
  const r = res[0];
  return r.values.map((v) => {
    const o: any = {};
    for (let i = 0; i < r.columns.length; i++) {
      o[r.columns[i]] = v[i];
    }
    return o as T;
  });
}
async function getForVideos(db: Database, author: string) {
  const videos = toObjects<{
    videoID: string;
    published: number;
    lengthSeconds: number;
    title: string;
  }>(
    await db.exec(
      "select videoID, published, lengthSeconds, title from videoData where author = ? limit 20",
      [author]
    )
  );
  console.log("videos", videos);
  for (const video of videos) {
    await db.exec("select rowid from sponsorTimes where videoId = ?");
    console.log("got for video", video.title);
    continue;
    const sponsorTimes = toObjects<DBSegment>(
      await db.exec(
        "select * from sponsorTimes where videoId = ?", // and category = 'sponsor' and not shadowHidden order by startTime asc",
        [video.videoID]
      )
    );

    /*for (const k in sponsorTimes) {
      if (!isNaN(+sponsorTimes[k])) sponsorTimes[k] = +sponsorTimes[k];
    }*/
    const segments = chooseSegments(sponsorTimes.filter((s) => s.votes > -1));
    const duration = segments
      .map((m) => m.endTime - m.startTime)
      .reduce((a, b) => a + b);
    const total = video.lengthSeconds;
    const percent = ((duration / total) * 100);
    console.log(
      percent.toFixed(0).padStart(2) + "%",
      video.videoID,
      video.title,
      new Date(video.published)
    );
    
  }
}
go();
