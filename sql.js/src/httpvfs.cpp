#include <emscripten/bind.h>
#include "../sqlite-src/sqlite-amalgamation-3350000/sqlite3.h"
#include <iostream>
#include <string>

using std::string;
using namespace emscripten;

extern "C" {
    extern int js_httpvfs_read_request(const char* url, void* outBuffer, sqlite3_int64 offset, int iAmt);
}

struct HttpDbContext {
    sqlite3_file base;
    string url;
};

int vfs_close(sqlite3_file* file)
{
	HttpDbContext* f = (HttpDbContext*)file;
	//f->session->remove_torrent(f->torrent);
    std::cout << "todo: close" << std::endl;
	return SQLITE_OK;
}

int vfs_write(sqlite3_file* file, const void* buffer, int iAmt, sqlite3_int64 iOfst)
{
	assert(false);
	return SQLITE_OK;
}

int vfs_truncate(sqlite3_file* file, sqlite3_int64 size)
{
	assert(false);
	return SQLITE_ERROR;
}

int vfs_sync(sqlite3_file*, int flags)
{
	return SQLITE_OK;
}

int vfs_file_size(sqlite3_file* file, sqlite3_int64 *pSize)
{
	HttpDbContext* f = (HttpDbContext*)file;
    std::cout << "todo: file size" << std::endl;
	*pSize = 9999;
	return SQLITE_OK;
}

int vfs_lock(sqlite3_file*, int)
{
	return SQLITE_OK;
}

int vfs_unlock(sqlite3_file*, int)
{
	return SQLITE_OK;
}

int vfs_check_reserved_lock(sqlite3_file*, int *pResOut)
{
	return SQLITE_OK;
}

int vfs_file_control(sqlite3_file*, int op, void *pArg)
{
	return SQLITE_OK;
}

int vfs_sector_size(sqlite3_file* file)
{
	HttpDbContext* f = (HttpDbContext*)file;
    std::cout << "todo: sector size" << std::endl;
	return 4096; // f->torrent.torrent_file()->piece_length();
}

int vfs_device_characteristics(sqlite3_file*)
{
	return SQLITE_IOCAP_IMMUTABLE;
}

int vfs_read(sqlite3_file* file, void* buffer, int const iAmt, sqlite3_int64 const iOfst)
{
    HttpDbContext *f = (HttpDbContext*)file;
    return js_httpvfs_read_request(f->url.c_str(), buffer, iOfst, iAmt);
}


sqlite3_io_methods httpvfs_io_methods = {
	1,
	vfs_close,
	vfs_read,
	vfs_write,
	vfs_truncate,
	vfs_sync,
	vfs_file_size,
	vfs_lock,
	vfs_unlock,
	vfs_check_reserved_lock,
	vfs_file_control,
	vfs_sector_size,
	vfs_device_characteristics
};


int httpvfs_open(sqlite3_vfs* vfs, const char *zName, sqlite3_file* file, int flags, int *pOutFlags) {
    //mHttpContext* ctx = (HttpContext*) vfs->pAppData;
    HttpDbContext *p = (HttpDbContext*) file;
    p->base.pMethods = &httpvfs_io_methods;
    p->url = zName;
    std::cout << "opened url " << p->url << std::endl;
    *pOutFlags |= SQLITE_OPEN_READONLY | SQLITE_OPEN_EXCLUSIVE;
    return SQLITE_OK;
}

int httpvfs_access(sqlite3_vfs* vfs, const char *zName, int flags, int *pOutFlags) {
    std::cout << "OHBOYACC" << zName << std::endl;
}


int register_httpvfs() {
    std::cout << "Registering VFS" << std::endl;
    static sqlite3_vfs vfs;
    vfs = *sqlite3_vfs_find(nullptr); // copy "default vfs"
    std::cout << "default:" << vfs.zName << std::endl;
    vfs.zName = "httpvfs";
    vfs.pAppData = &vfs;
    vfs.szOsFile = sizeof(HttpDbContext);
    vfs.xOpen = httpvfs_open;
    vfs.xAccess = httpvfs_access;
    return sqlite3_vfs_register(&vfs, false);
}

EMSCRIPTEN_BINDINGS(my_module) {
    function("register_httpvfs", &register_httpvfs);
}