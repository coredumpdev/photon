#include "error.hpp"

namespace photon {
namespace {
// thread_local so two hosts on two threads (Qt's render thread and the GUI
// thread, say) never overwrite each other's diagnostics.
thread_local std::string g_error;
}  // namespace

ph_result fail(ph_result code, std::string message) {
  g_error = std::move(message);
  return code;
}

void clear_error() {
  g_error.clear();
}

const char* last_error() {
  return g_error.c_str();
}

}  // namespace photon
