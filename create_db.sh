set -eu
cd "$(dirname "$0")"


bytes="$(stat --printf="%s" "$1")"
serverChunkSize=$((50 * 1024 * 1024))
suffixLength=3
rm dist/data/*
split "$1" --bytes=$serverChunkSize "dist/data/db.sqlite3." --suffix-length=$suffixLength --numeric-suffixes
requestChunkSize="$(sqlite3 "$1" 'pragma page_size')"
echo '
{
    "requestChunkSize": '$requestChunkSize',
    "databaseLengthBytes": '$bytes',
    "serverChunkSize": '$serverChunkSize',
    "urlPrefix": "db.sqlite3.",
    "suffixLength": '$suffixLength'
}
' > dist/data/config.json