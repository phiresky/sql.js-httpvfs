
export type SegmentUUID = string  & { __segmentUUIDBrand: unknown };
export type VideoID = string & { __videoIDBrand: unknown };
export type VideoDuration = number & { __videoDurationBrand: unknown };
export type Category = string & { __categoryBrand: unknown };
export type VideoIDHash = VideoID;
export type IPAddress = string & { __ipAddressBrand: unknown };
export type HashedIP = IPAddress;
type SBRecord<K extends string, T> = {
  [P in string | K]: T;
};
// Uncomment as needed
export enum Service {
    YouTube = 'YouTube',
    PeerTube = 'PeerTube',
    // Twitch = 'Twitch',
    // Nebula = 'Nebula',
    // RSS = 'RSS',
    // Corridor = 'Corridor',
    // Lbry = 'Lbry'
}

export interface IncomingSegment { 
    category: Category; 
    segment: string[]; 
}

export interface Segment { 
    category: Category; 
    segment: number[]; 
    UUID: SegmentUUID;
    videoDuration: VideoDuration;
}

export enum Visibility {
    VISIBLE = 0,
    HIDDEN = 1
}

export interface DBSegment { 
    category: Category; 
    startTime: number;
    endTime: number;
    UUID: SegmentUUID;
    votes: number;
    locked: boolean;
    shadowHidden: Visibility;
    videoID: VideoID;
    videoDuration: VideoDuration;
    hashedVideoID: VideoIDHash;
}

export interface OverlappingSegmentGroup {
    segments: DBSegment[],
    votes: number;
    locked: boolean; // Contains a locked segment
}

export interface VotableObject {
    votes: number;
}

export interface VotableObjectWithWeight extends VotableObject {
    weight: number;
}

export interface VideoData {
    hash: VideoIDHash;
    segments: Segment[];
}

export interface SegmentCache {
    shadowHiddenSegmentIPs: SBRecord<VideoID, {hashedIP: HashedIP}[]>,
    userHashedIP?: HashedIP
}


//gets a weighted random choice from the choices array based on their `votes` property.
//amountOfChoices specifies the maximum amount of choices to return, 1 or more.
//choices are unique
function getWeightedRandomChoice<T extends VotableObject>(choices: T[], amountOfChoices: number): T[] {
  //trivial case: no need to go through the whole process
  if (amountOfChoices >= choices.length) {
      return choices;
  }

  type TWithWeight = T & {
      weight: number
  }

  //assign a weight to each choice
  let totalWeight = 0;
  let choicesWithWeights: TWithWeight[] = choices.map(choice => {
      //The 3 makes -2 the minimum votes before being ignored completely
      //this can be changed if this system increases in popularity.
      const weight = Math.exp((choice.votes + 3));
      totalWeight += weight;

      return {...choice, weight};
  });

  //iterate and find amountOfChoices choices
  const chosen = [];
  while (amountOfChoices-- > 0) {
      //weighted random draw of one element of choices
      const randomNumber = Math.random() * totalWeight;
      let stackWeight = choicesWithWeights[0].weight;
      let i = 0;
      while (stackWeight < randomNumber) {
          stackWeight += choicesWithWeights[++i].weight;
      }

      //add it to the chosen ones and remove it from the choices before the next iteration
      chosen.push(choicesWithWeights[i]);
      totalWeight -= choicesWithWeights[i].weight;
      choicesWithWeights.splice(i, 1);
  }

  return chosen;
}

//This function will find segments that are contained inside of eachother, called similar segments
//Only one similar time will be returned, randomly generated based on the sqrt of votes.
//This allows new less voted items to still sometimes appear to give them a chance at getting votes.
//Segments with less than -1 votes are already ignored before this function is called
export function chooseSegments(segments: DBSegment[]): DBSegment[] {
  //Create groups of segments that are similar to eachother
  //Segments must be sorted by their startTime so that we can build groups chronologically:
  //1. As long as the segments' startTime fall inside the currentGroup, we keep adding them to that group
  //2. If a segment starts after the end of the currentGroup (> cursor), no other segment will ever fall
  //   inside that group (because they're sorted) so we can create a new one
  const overlappingSegmentsGroups: OverlappingSegmentGroup[] = [];
  let currentGroup: OverlappingSegmentGroup;
  let cursor = -1; //-1 to make sure that, even if the 1st segment starts at 0, a new group is created
  segments.forEach(segment => {
      if (segment.startTime > cursor) {
          currentGroup = {segments: [], votes: 0, locked: false};
          overlappingSegmentsGroups.push(currentGroup);
      }

      currentGroup.segments.push(segment);
      //only if it is a positive vote, otherwise it is probably just a sponsor time with slightly wrong time
      if (segment.votes > 0) {
          currentGroup.votes += segment.votes;
      }

      if (segment.locked) {
          currentGroup.locked = true;
      }

      cursor = Math.max(cursor, segment.endTime);
  });

  overlappingSegmentsGroups.forEach((group) => {
      if (group.locked) {
          group.segments = group.segments.filter((segment) => segment.locked);
      }
  });

  //if there are too many groups, find the best 8
  return getWeightedRandomChoice(overlappingSegmentsGroups, 32).map(
      //randomly choose 1 good segment per group and return them
      group => getWeightedRandomChoice(group.segments, 1)[0],
  );
}
