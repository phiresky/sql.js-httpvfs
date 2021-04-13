
select (select max(rowid) from sponsorTimes)
rowid, videoID, startTime, endTime, row_number() over (order by videoID, startTime) from sponsorTimes limit 1000;


update sponsorTimes
    set rowid = newrowid
    from (select sponsorTimes.rowid as oldrowid, (
        select max(sponsorTimes.rowid) from sponsorTimes)
            + row_number() over (order by author, sponsorTimes.videoID, startTime) as newrowid
        from sponsorTimes join videoData on videoData.videoID = sponsorTimes.videoID
        )
    where sponsorTimes.rowid = oldrowid;



update videoData
    set rowid = newrowid
    from (select rowid as oldrowid, (select max(rowid) from videoData) + row_number() over (order by author) as newrowid from videoData)
    where videoData.rowid = oldrowid;
