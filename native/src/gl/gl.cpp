#include "gl/gl.hpp"

#include <cstdint>
#include <vector>

namespace photon::gl {

bool load(Api& api, ph_proc_address_fn get, void* user, std::string& error) {
  if (!get) {
    error = "host supplied no get_proc_address";
    return false;
  }

  std::vector<const char*> missing;

  // Some loaders (WGL notably) return 1, 2, 3 or -1 for a function that does not
  // exist instead of null. Treating those as valid pointers is a crash at the
  // first draw call, so they are filtered here.
  const auto resolve = [&](const char* name) -> void* {
    void* p = get(name, user);
    const auto addr = reinterpret_cast<std::uintptr_t>(p);
    if (addr == 0 || addr == 1 || addr == 2 || addr == 3 ||
        addr == static_cast<std::uintptr_t>(-1)) {
      return nullptr;
    }
    return p;
  };

#define PHOTON_GL_LOAD(name, ret, args)                                        \
  api.name = reinterpret_cast<ret(PH_GLAPI*) args>(resolve("gl" #name));       \
  if (!api.name) missing.push_back("gl" #name);
  PHOTON_GL_FUNCTIONS(PHOTON_GL_LOAD)
#undef PHOTON_GL_LOAD

  if (!missing.empty()) {
    error = "OpenGL 3.3 core is required; the context is missing: ";
    for (size_t i = 0; i < missing.size(); ++i) {
      if (i > 0) error += ", ";
      if (i == 8) {  // a wall of 60 names helps nobody
        error += "and " + std::to_string(missing.size() - 8) + " more";
        break;
      }
      error += missing[i];
    }
    api.ready = false;
    return false;
  }

  api.ready = true;
  return true;
}

}  // namespace photon::gl
