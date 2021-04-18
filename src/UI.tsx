import { observer, useLocalObservable } from "mobx-react";
import * as React from "react";
import { Database } from "sql.js";
import { createDbWorker, getForAuthor, SqliteWorker, toObjects } from "./db";
import { action, makeAutoObservable, makeObservable, observable } from "mobx";
import AsyncSelect from "react-select/async";
import debounce from "debounce-promise";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js/lib/core";
import { textChangeRangeIsUnchanged } from "typescript";

type SqliteStats = {
  filename: string;
  totalBytes: number;
  totalFetchedBytes: number;
  totalRequests: number;
};
function formatBytes(b: number) {
  if (b > 1e6) {
    return (b / 1e6).toFixed(2) + "MB";
  }
  if (b > 1e3) {
    return (b / 1e3).toFixed(2) + "KB";
  }
  return b + "B";
}

const SqliteStats: React.FC<{
  stats: SqliteStats;
  lastUpdated: number;
}> = observer(({ stats, lastUpdated }) => {
  return (
    <>
      Sqlite stats: fetched {formatBytes(stats.totalFetchedBytes)} in{" "}
      {stats.totalRequests} requests (DB size: {formatBytes(stats.totalBytes)}
    </>
  );
});
/*async function query(db: Database, query: string, bindings?: any[]) {
  return toObjects(await db.exec(query, bindings));
}*/

function stripLeadingWS(str: string) {
  if (str[0] === "\n") str = str.slice(1);
  const chars = Math.min(
    ...str.split("\n").map((l) => /^\s*/.exec(l)![0].length)
  );
  return str
    .split("\n")
    .map((line) => line.slice(chars))
    .join("\n");
}

const EvalBox: React.FC<{
  code: string;
  worker: SqliteWorker | null;
}> = observer((p) => {
  const [result, setResult] = React.useState("");
  const [code, setCode] = React.useState(stripLeadingWS(p.code));
  async function run() {
    if (!p.worker) {
      setResult("[worker not connected]");
      return;
    }
    setResult("[...running]");
    try {
      const res = await p.worker.evalCode(code);
      setResult(JSON.stringify(res, null, 2));
    } catch (e) {
      console.error("query", p, e);
      setResult(`${e}`);
    }
  }
  return (
    <div>
      <textarea
        style={{
          display: "inline-block",
          border: "none",
          fontFamily: "monospace",
          width: "100%",
        }}
        value={code}
        onChange={(e) => setCode(e.currentTarget.value)}
      ></textarea>
      <button onClick={run}>Run</button>
      <div>
        <pre>
          <code>{result}</code>
        </pre>
      </div>
    </div>
  );
});
@observer
export class UI extends React.Component {
  worker: SqliteWorker | null = null;
  db: Database | null = null;
  @observable initState = "Loading...";
  @observable
  stats: SqliteStats | null = null;
  @observable
  dbConfig: { lastUpdated: number } | null = null;
  @observable
  focussedVideo: SponsorInfo | null = null;
  @observable searchInput: string = "";

  constructor(p: {}) {
    super(p);
    this.init();
    makeObservable(this);
  }
  interval: any = 0;
  componentDidMount() {
    this.interval = setInterval(async () => {
      this.stats = (await this.worker?.getStats()) || null;
    }, 1000);
  }
  componentWillUnmount() {
    clearInterval(this.interval);
  }
  async init() {
    this.initState = "connecting to sqlite httpvfs database...";
    try {
      const res = await createDbWorker("data/config.json");
      this.db = res.db;
      this.worker = res.worker;
      this.dbConfig = res.config;
    } catch (e) {
      console.error(e);
      this.initState = `Error connecting to database: ${e}`;
      return;
    }
    const initialAuthor = new URLSearchParams(location.search).get("uploader");
    if (initialAuthor) this.setAuthor(initialAuthor);
    this.initState = "";
  }

  render() {
    if (this.initState) return <div>{this.initState}</div>;
    return (
      <div>
        <EvalBox
          code={`return db.query("select selector, textContent from dom where selector match 'div';")`}
          worker={this.worker}
        ></EvalBox>
        <EvalBox
          code={`return db.query("insert into dom (parent, tagName, textContent) select 'ul#outtable1', 'li', long_name from wdi_country")`}
          worker={this.worker}
        ></EvalBox>
        <EvalBox
          code={`return db.query("update dom set textContent='foobar' where selector match 'li'")`}
          worker={this.worker}
        ></EvalBox>
        <div>
          <ul id="outtable1"></ul>
        </div>
        <EvalBox
          code={`return db.query("select textContent from dom where querySelector = 'div';")`}
          worker={this.worker}
        ></EvalBox>
        <EvalBox
          code={`return db.exec("select name from pragma_table_info('wdi_country')")`}
          worker={this.worker}
        ></EvalBox>
        <EvalBox
          code={
            'return db.exec("select count(*) as num_countries from wdi_country")'
          }
          worker={this.worker}
        ></EvalBox>
        <EvalBox
          code={
            'return db.exec("select country_code, long_name, currency_unit from wdi_country limit 5")'
          }
          worker={this.worker}
        ></EvalBox>
        <EvalBox
          code={
            'return db.exec("select series_code, indicator_name from wdi_series order by random() limit 10")'
          }
          worker={this.worker}
        ></EvalBox>
        <EvalBox
          code={`
              
              db.create_function("is_interesting", countryCode => ["USA", "DEU"].includes(countryCode));
              return db.exec("select long_name from wdi_country where is_interesting(country_code) limit 10")
          `}
          worker={this.worker}
        ></EvalBox>
        <EvalBox
          code={`
              return db.exec(${"`"}select country_code, indicator_code, max(year) as year from wdi_data
              where
                indicator_code = (select series_code from wdi_series where indicator_name = 'Literacy rate, youth total (% of people ages 15-24)')
                and year > 2010
                group by country_code${"`"})
          `}
          worker={this.worker}
        />
        <EvalBox
          code={`
              return db.exec(${"`"}select series_code from wdi_series where indicator_name = 'Literacy rate, youth total (% of people ages 15-24)'${"`"})
          `}
          worker={this.worker}
        />
        <EvalBox
          code={`
              return db.exec(${"`"}
                with newest_data as (
                  select country_code, indicator_code, max(year) as year from wdi_data
                  where
                    indicator_code = (select series_code from wdi_series where indicator_name = 'Literacy rate, youth total (% of people ages 15-24)')
                    and year > 2010
                    group by country_code
                )
                select wdi_data.country_code, value from wdi_data, newest_data
                where wdi_data.indicator_code = newest_data.indicator_code and wdi_data.country_code = newest_data.country_code and wdi_data.year = newest_data.year
                order by value asc limit 10
              ${"`"})
          `}
          worker={this.worker}
        />

        <footer style={{ marginTop: "5em", color: "gray" }}>
          <div>
            {this.stats ? (
              <SqliteStats
                stats={this.stats}
                lastUpdated={this.dbConfig.lastUpdated}
              />
            ) : (
              ""
            )}{" "}
          </div>
          <div>
            Source Code:{" "}
            <a href="https://github.com/phiresky/youtube-sponsorship-stats/">
              https://github.com/phiresky/youtube-sponsorship-stats/
            </a>
          </div>
        </footer>
      </div>
    );
  }
}
