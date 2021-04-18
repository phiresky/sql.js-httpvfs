set -eu

indb="$1"
outdir="$2"

bytes="$(stat --printf="%s" "$indb")"
serverChunkSize=$((50 * 1024 * 1024))
suffixLength=3
rm -f "$outdir/db.sqlite3"*
split "$indb" --bytes=$serverChunkSize "$outdir/db.sqlite3." --suffix-length=$suffixLength --numeric-suffixes
requestChunkSize="$(sqlite3 "$indb" 'pragma page_size')"
echo '
{
    "requestChunkSize": '$requestChunkSize',
    "databaseLengthBytes": '$bytes',
    "serverChunkSize": '$serverChunkSize',
    "urlPrefix": "db.sqlite3.",
    "suffixLength": '$suffixLength'
}
' > "$outdir/config.json"