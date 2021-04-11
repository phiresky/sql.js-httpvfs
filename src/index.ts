import initSqlJs from "../sql.js/dist/sql-wasm-debug.js";
import wasmfile from "../sql.js/dist/sql-wasm-debug.wasm";
import * as Comlink from "comlink";
import SqliteWorker from "./sqlite.worker";

import { chooseSegments } from "./util";
import { SqliteMod } from "./sqlite.worker.js";

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
    const metaDb = await sqlite.new("youtube-metadata-pg1024.sqlite3", chunkSize);
  const pageSizeResp = await metaDb.exec("pragma page_size");
  console.log(pageSizeResp);
    const pageSize = pageSizeResp[0].values[0][0];
    if (pageSize !== chunkSize)
        console.warn(
            `Chunk size does not match page size: pragma page_size = ${pageSize} but chunkSize = ${chunkSize}`
        );

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

    for (const video of videos) {
        const sponsorTimes = metaDb
            .prepare(
                "select * from sponsorTimes where videoId = ? and category = 'sponsor' and not shadowHidden order by startTime asc"
            )
            .all(video.videoID);
        for (const k in sponsorTimes) {
            if (!isNaN(+sponsorTimes[k])) sponsorTimes[k] = +sponsorTimes[k];
        }
        const segments = chooseSegments(
            sponsorTimes.filter((s) => s.votes > -1)
        );
        const duration = segments
            .map((m) => m.endTime - m.startTime)
            .reduce((a, b) => a + b);
        const total = video.lengthSeconds;
        console.log(
            ((duration / total) * 100).toFixed(0).padStart(2) + "%",
            video.videoID,
            video.title
        );
    }
}
go();
