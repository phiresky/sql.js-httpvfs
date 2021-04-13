import { observer, useLocalObservable } from "mobx-react";
import * as React from "react";
import { Database } from "sql.js";
import { authorsSearch, createDbWorker, getForAuthor } from "./db";
import { makeAutoObservable, makeObservable, observable } from "mobx";
import AsyncSelect from 'react-select/async';

@observer
export class UI extends React.Component {
  db: Database | null = null;
  @observable authorSearch = "";
  @observable
  suggestions = {
    error: "type more",
    results: [] as string[],
  };
  @observable
  data: { author: string; segs: any[] } | null = null;

  constructor(p: {}) {
    super(p);
    this.init();
    makeObservable(this);
  }
  async init() {
    this.db = await createDbWorker();
  }
  async setAuthor(t: string) {
    this.authorSearch = t;
    if (this.db) {
      const search = this.authorSearch;
      this.data = {
        author: search,
        segs: await getForAuthor(this.db, search),
      };
      console.log("data", this.data);
    }
  }
  async authorsSearch(search: string) {
    return (await authorsSearch(this.db!, search))
  }

  render() {
    return (
      <div>
        <div>
          Search for author:{" "}
          <AsyncSelect<{name: string}> cacheOptions defaultOptions loadOptions={this.authorsSearch.bind(this)} />
        </div>
        {this.data && (
          <div>
            Found {this.data.segs.length} videos for author "{this.data.author}"
          </div>
        )}
      </div>
    );
  }
}
