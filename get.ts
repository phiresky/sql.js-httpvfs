import  sqlite from "better-sqlite3";
import { chooseSegments } from "./util";

const sponsorblockDb = sqlite("sponsorTimes.sqlite3");

const metaDb = sqlite("youtube-metadata.sqlite3");


const uploader = 'Adam Ragusea';

const videos = metaDb.prepare('select * from videoData where author = ?').all(uploader);

for (const video of videos) {
  const sponsorTimes = metaDb.prepare("select * from sponsorTimes where videoId = ? and category = 'sponsor' and not shadowHidden order by startTime asc").all(video.videoID);
  for (const k in sponsorTimes) {
    if (!isNaN(+sponsorTimes[k])) sponsorTimes[k] = +sponsorTimes[k];
  }
  const segments = chooseSegments(sponsorTimes.filter(s => s.votes > -1));
  const duration = segments.map(m => m.endTime - m.startTime).reduce((a, b) => a + b);
  const total = video.lengthSeconds;
  console.log((duration / total * 100).toFixed(0).padStart(2)+"%", video.videoID, video.title)
}