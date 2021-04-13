set -eu
cd "$(dirname "$0")"
rm -rf dist/data
mkdir -p dist/data
cat create_db.sql | sqlite3 -cmd '.echo on' dist/data/db.sqlite3
bytes="$(stat --printf="%s" dist/data/db.sqlite3)"
serverChunkSize=$((50 * 1024 * 1024))
suffixLength=3
split dist/data/db.sqlite3 --bytes=$serverChunkSize dist/data/db.sqlite3. --suffix-length=$suffixLength --numeric-suffixes
rm dist/data/db.sqlite3
echo '{"requestChunkSize": 4096, "databaseLengthBytes": '$bytes', "serverChunkSize": '$serverChunkSize', "urlPrefix": "db.sqlite3.", "suffixLength": '$suffixLength'}' > dist/data/config.json