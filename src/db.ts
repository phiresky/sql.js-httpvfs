import * as Comlink from "comlink";
import SqliteWorker, { SplitFileConfig } from "./sqlite.worker";

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
export type SqliteWorker = Comlink.Remote<SqliteMod>;
export async function createDbWorker() {
  const sqlite = Comlink.wrap<SqliteMod>(new SqliteWorker());

  const chunkSize = 4096;
  const configUrl = new URL("dist/data/config.json", location.href);
  const config: SplitFileConfig = await fetch(configUrl.toString()).then(e => e.json());
  const db = await sqlite.SplitFileHttpDatabase({
    ...config,
    urlPrefix: new URL(config.urlPrefix, configUrl).toString(),
  });
  const pageSizeResp = await db.exec("pragma page_size");
  const pageSize = pageSizeResp[0].values[0][0];
  if (pageSize !== chunkSize)
    console.warn(
      `Chunk size does not match page size: pragma page_size = ${pageSize} but chunkSize = ${chunkSize}`
    );

  return { worker: sqlite, db };
}

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
  Object.assign(window, { s: sqlite });

  await getForVideos(await createDbWorker(), "Adam Ragusea");
}

function toObjects<T>(res: QueryExecResult[]): T[] {
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
export type VideoMeta = {
  videoID: string;
  title: string;
  maxresdefault_thumbnail: string;
  published: number;
  publishedText: string;
  viewCount: number;
  likeCount: number;
  author: string;
  authorURL: string;
  channelThumbnail: string;
  lengthSeconds: number;
  category: string;
};
export async function authorsSearch(db: Database, author: string) {
  try {
    const query_inner = author
      .split(" ")
      .map((n) => n.replace(/"/g, ""))
      .map((e) => `"${e}"*`)
      .join(" ");
    const query = `NEAR(${query_inner})`;
    const sql_query = `select name from authors_search where name match ? limit 20`;
    console.log("executing search query", query, sql_query);
    const ret = toObjects<{ name: string }>(await db.exec(sql_query, [query]));
    return ret;
  } catch (e) {
    console.error("authorsSearch", e);
    throw e;
  }
}
export type SponsorInfo = {
  meta: VideoMeta;
  durationSponsor: number;
  percentSponsor: number;
};
export async function getForAuthor(
  db: Database,
  author: string
): Promise<SponsorInfo[]> {
  /*await db.exec(`select s.rowid from sponsorTimes s
  join videoData v on s.videoid = v.videoid
  
  where v.author = 'Adam Ragusea'`);*/

  const videos = toObjects<VideoMeta>(
    await db.exec(
      "select * from videoData where author = ? order by published asc",
      [author]
    )
  );
  console.log("videos", videos);
  const sponsorTimes = toObjects<DBSegment>(
    await db.exec(
      // "select videoData.videoID, published, lengthSeconds, title from videoData join sponsorTimes on sponsorTimes.videoID = videoData.videoID where author = ? order by sponsorTimes.rowid asc",
      // [author]
      "select * from sponsorTimes where authorID = (select id from authors where name = ?) and not shadowHidden and category = 'sponsor' order by videoID, startTime",
      [author]
    )
  ); // select sponsorTimes.rowid, sponsorTimes.videoID from videoData join sponsorTimes on sponsorTimes.videoID = videoData.videoID where author = 'Adam Ragusea';
  console.log("sponsorTimes", sponsorTimes);

  const videoMap = new Map<
    string,
    { meta: VideoMeta; segments: DBSegment[] }
  >();
  for (const video of videos) {
    videoMap.set(video.videoID, { meta: video, segments: [] });
  }
  for (const segment of sponsorTimes) {
    const tgt = videoMap.get(segment.videoID);
    if (!tgt) {
      console.warn("no metadata for video", segment.videoID);
      continue;
    }
    tgt.segments.push(segment);
  }
  //const videos = [{videoID: "gOQNRvJbpmk", lengthSeconds :  1000}];
  const out = [];
  for (const [_, video] of videoMap) {
    const sponsorTimes = video.segments;
    const segments = chooseSegments(sponsorTimes.filter((s) => s.votes > -1));
    const duration = segments
      .map((m) => m.endTime - m.startTime)
      .reduce((a, b) => a + b, 0);
    const total = video.meta.lengthSeconds;
    const percentSponsor = (duration / total) * 100;
    out.push({
      meta: video.meta,
      durationSponsor: duration,
      percentSponsor,
    });
  }
  return out;
}
