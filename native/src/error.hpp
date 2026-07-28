// Thread-local error reporting. Exceptions must never cross the C ABI, so every
// internal failure becomes a ph_result plus a message the caller can read back
// with ph_last_error().
#pragma once

#include <photon/photon.h>

#include <string>

namespace photon {

/// Record `message` as this thread's last error and return `code` unchanged.
ph_result fail(ph_result code, std::string message);

/// Clear this thread's error string. Called at the top of every successful ABI entry.
void clear_error();

/// The calling thread's last error, or "" when there is none.
const char* last_error();

}  // namespace photon
