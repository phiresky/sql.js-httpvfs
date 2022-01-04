# sql.js-httpvfs

See my blog post for an introduction: https://phiresky.github.io/blog/2021/hosting-sqlite-databases-on-github-pages/

sql.js is a light wrapper around SQLite compiled with EMScripten for use in the browser (client-side).

This repo is a fork of and wrapper around sql.js to provide a read-only HTTP-Range-request based virtual file system for SQLite. It allows hosting an SQLite database on a static file hoster and querying that database from the browser without fully downloading it.

The virtual file system is an emscripten filesystem with some "smart" logic to accelerate fetching with virtual read heads that speed up when sequential data is fetched. It could also be useful to other applications, the code is in [lazyFile.ts](./src/lazyFile.ts). It might also be useful to implement this lazy fetching as an [SQLite VFS](https://www.sqlite.org/vfs.html) since then SQLite could be compiled with e.g. WASI SDK without relying on all the emscripten OS emulation.

Note that this whole thing only works well if your database and indexes are structured well.

sql.js-httpvfs also provides a proof-of-concept level implementation of a DOM virtual table that allows interacting (read/write) with the browser DOM directly from within SQLite queries.


## Usage


(optional) First, improve your SQLite database:

```sql
-- first, add whatever indices you need. Note that here having many and correct indices is even more important than for a normal database.
pragma journal_mode = delete; -- to be able to actually set page size
pragma page_size = 1024; -- trade off of number of requests that need to be made vs overhead. 

insert into ftstable(ftstable) values ('optimize'); -- for every FTS table you have (if you have any)

vacuum; -- reorganize database and apply changed page size
```

(optional) Second, split the database into chunks and generate a json config using the [create_db.sh](./create_db.sh) script. This is needed if your hoster has a maximum file size. It can also be a good idea generally depending on your CDN since it allows selective CDN caching of the chunks your users actually use and reduces cache eviction.

Finally, install sql.js-httpvfs from [npm](https://www.npmjs.com/package/sql.js-httpvfs) and use it in TypeScript / JS!

Here's an example for people familiar with the JS / TS world. **At the bottom of this readme** there's a more complete example for those unfamiliar.

```ts
import { createDbWorker } from "sql.js-httpvfs"

// sadly there's no good way to package workers and wasm directly so you need a way to get these two URLs from your bundler.
// This is the webpack5 way to create a asset bundle of the worker and wasm:
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


let maxBytesToRead = 10 * 1024 * 1024;
const worker = await createDbWorker(
  [config],
  workerUrl.toString(),
  wasmUrl.toString(),
  maxBytesToRead // optional, defaults to Infinity
);
// you can also pass multiple config objects which can then be used as separate database schemas with `ATTACH virtualFilename as schemaname`, where virtualFilename is also set in the config object.


// worker.db is a now SQL.js instance except that all functions return Promises.

const result = await worker.db.exec(`select * from table where id = ?`, [123]);

// worker.worker.bytesRead is a Promise for the number of bytes read by the worker.
// if a request would cause it to exceed maxBytesToRead, that request will throw a SQLite disk I/O error.
console.log(await worker.worker.bytesRead);

// you can reset bytesRead by assigning to it:
worker.worker.bytesRead = 0;
```

## Cachebusting

Alongside the `url` or `urlPrefix`, config can take an optional `cacheBust` property whose value will be appended as a query parameter to URLs. If you set it to a random value when you update the database you can avoid caching-related database corruption.

If using a remote config (`from: 'jsonconfig'`), don't forget to cachebust that too.

## Debugging data fetching

If your query is fetching a lot of data and you're not sure why, try this:

1. Look at the output of `explain query plan select ......`

    - `SCAN TABLE t1` means the table t1 will have to be downloaded pretty much fully
    - `SCAN TABLE t1 USING INDEX i1 (a=?)` means direct index lookups to find a row, then table lookups by rowid
    - `SCAN TABLE t1 USING COVERING INDEX i1 (a)` direct index lookup _without_ a table lookup. This is the fastest.

    You want all the columns in your WHERE clause that significantly reduce the number of results to be part of an index, with the ones reducing the result count the most coming first.

    Another useful technique is to create an index containing exactly the rows filtered by and the rows selected, which SQLite reads as a COVERING INDEX in a sequential manner (no random access at all!). For example `create index i1 on tbl (filteredby1, filteredby2, selected1, selected2, selected3)`. This index is perfect for a query filtering by the `filteredby1` and `filteredby2` columns that only select the three columns at the back of the index.

2. You can look at the `dbstat` virtual table to find out exactly what the pages SQLite is reading contain. For example, if you have `[xhr of size 1 KiB @ 1484048 KiB]` in your logs that means it's reading page 1484048. You can get the full log of read pages by using `worker.getResetAccessedPages()`. Check the content of pages with `select * from dbstat where pageno = 1484048`. Do this in an SQLite3 shell not the browser because the `dbstat` vtable reads the whole database.

## Is this production ready?

Note that this library was mainly written for small personal projects of mine and as a demonstration. I've received requests from many people for applications that are out of the scope of this library for me (Which is awesome, and I'm happy to have inspired so many interesting new idea).

In general it works fine, but I'm not making any effort to support older or weird browsers. If the browser doesn't support WebAssembly and WebWorkers, this won't work. There's also no cache eviction, so the more data is fetched the more RAM it will use. Most of the complicated work is done by SQLite, which is well tested, but the virtual file system part doesn't have any tests.

If you want to build something new that doesn't fit with this library exactly, I'd recommend you look into these discussions and libraries:

* The general virtual file system discussion here: https://github.com/sql-js/sql.js/issues/447
* [wa-sqlite](https://github.com/rhashimoto/wa-sqlite), which is a much simpler wasm wrapper for SQLite than sql.js a and has different VFSes that don't require an EMScripten dependency. sql.js-httpvfs could easily be reimplemented on top of this.
* [absurd-sql](https://github.com/jlongster/absurd-sql), which is an implementation of a pretty efficient VFS that allows persistence / read/write queries by storing the DB in IndexedDB

## Inspiration

This project is inspired by:

* https://github.com/lmatteis/torrent-net and https://github.com/bittorrent/sqltorrent Torrent VFS for SQLite. In theory even more awesome than a httpvfs, but only works with native SQLite not in the browser (someone needs to make a baby of this and sqltorrent to get something that uses WebTorrent).
* https://phiresky.github.io/tv-show-ratings/ a project of mine that fetches the backing data from a WebTorrent (and afterwards seeds it). Not SQLite though, just a torrent with a set of hashed file chunks containing protobufs.
* https://phiresky.github.io/youtube-sponsorship-stats/?uploader=Adam+Ragusea what I originally built sql.js-httpvfs for

The original code of lazyFile is based on the emscripten createLazyFile function, though not much of that code is remaining.

## Minimal example from scratch

Here's an example of how to setup a project with sql.js-httpvfs completely from scratch, for people unfamiliar with JavaScript or NPM in general.

First, You will need `node` and `npm`. Get this from your system package manager like `apt install nodejs npm`.

Then, go to a new directory and add a few dependencies:

```sh
mkdir example
cd example
echo '{}' > package.json
npm install --save-dev webpack webpack-cli typescript ts-loader http-server
npm install --save sql.js-httpvfs
npx tsc --init
```

Edit the generated tsconfig.json file to make it more modern:
```json
...
"target": "es2020",
"module": "es2020",
"moduleResolution": "node",
...
```

Create a webpack config, minimal index.html file and TypeScript entry point:

* [example/webpack.config.js](./example/webpack.config.js)
* [example/index.html](./example/index.html)
* [example/src/index.ts](./example/src/index.ts)

Finally, create a database:

```sh
sqlite3 example.sqlite3 "create table mytable(foo, bar)"
sqlite3 example.sqlite3 "insert into mytable values ('hello', 'world')"
```

and build the JS bundle and start a webserver:

```
./node_modules/.bin/webpack --mode=development
./node_modules/.bin/http-server
```

Then go to http://localhost:8080

And you should see the output to the query `select * from mytable`.

```json
[{"foo":"hello","bar":"world"}]
```

The full code of this example is in [example/](./example/).

## Compiling

To compile this project (only needed if you want to modify the library itself), make sure you have emscripten, then first compile sql.js, then sql.js-httpvfs:

```
cd sql.js
yarn build
cd ..
yarn build
```
