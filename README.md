# sql.js-httpvfs

sql.js is a light wrapper around SQLite compiled with EMScripten for use in the browser (client-side).

This repo is a fork of and wrapper around sql.js to provide a read-only HTTP-Range-request based virtual file system for SQLite. It allows hosting an SQLite database on a static file hoster and querying that database from the browser without fully downloading it.

Note that this only works well if your database and indices is structured well.

It also provides a proof-of-concept level implementation of a DOM virtual table that allows interacting (read/write) with the browser DOM directly from within SQLite queries.


## Usage


(optional) First, improve your SQLite database:

```sql
-- first, add whatever indices you need. Note that here having many and correct indices is even more important than for a normal database.
pragma journal_mode = delete; -- to be able to actually set page size
pragma page_size = 1024; -- trade off of number of requests that need to be made vs overhead. 
vacuum; -- reorganize database and apply changed page size
```

(optional) Second, split the database into chunks and generate a json config using the [create_db.sh](create_db.sh) script. This is needed if your hoster has a maximum file size. It can also be a good idea generally depending on your CDN since it allows selective caching of the chunks your users actually use and reduces cache eviction.

Finally, use it in TypeScript / JS!

```ts
import { createDbWorker } from "sql.js-httpvfs"

// sadly there's no good way to package workers and wasm directly so you need a way to get these two URLs from your bundler. The below is the webpack5 way:
const workerUrl = new URL(
  "sql.js-httpvfs/dist/sqlite.worker.js",
  import.meta.url,
);
const wasmUrl = new URL(
  "sql.js-httpvfs/dist/sql-wasm.wasm",
  import.meta.url,
);
// the legacy webpack4 way is something like `import wasmUrl from "file-loader!sql.js-httpvfs/dist/sql-wasm.wasm"`.

// the config is either the url to the create_db script, or a inline configuration:
const config = {
  from: "inline",
  config: {
    serverMode: "full", // file is just a plain old full sqlite database
    requestChunkSize: 4096, // the page size of the  sqlite database (by default 4096)
    url: "/foo/bar/test.sqlite3" // url to the database (relative or full)
  }
};
// or:
const config = {
  from: "jsonconfig",
  configUrl: "/foo/bar/config.json"
}

const worker = await createDbWorker(
  [config],
  workerUrl.toString(), wasmUrl.toString()
);
// you can also pass multiple config objects which can then be used as separate database schemas with `ATTACH virtualFilename as schemaname`, where virtualFilename is also set in the config object.


// worker.db is a now SQL.js instance except that all functions return Promises.

const result = await worker.db.exec(`select * from table where id = ?`, [123]);

```



## Inspiration

This project is inspired by:

* https://github.com/lmatteis/torrent-net https://github.com/bittorrent/sqltorrent Torrent VFS for SQLite. In theory even more awesome than a httpvfs, but only works with native SQLite not in the browser (needs extension to use WebTorrent).
* https://phiresky.github.io/tv-show-ratings/ a project of mine that fetches the backing data from a WebTorrent (and afterwards seeds it). Not SQLite though, just a torrent with a set of hashed file chunks.
* https://phiresky.github.io/youtube-sponsorship-stats/?uploader=Adam+Ragusea what I originally built sql.js-httpvfs for